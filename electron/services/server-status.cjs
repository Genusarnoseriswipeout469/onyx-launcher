const net = require("node:net");
const dns = require("node:dns/promises");
const { parseServerAddress } = require("./minecraft.cjs");

const MAX_STATUS_PACKET = 1024 * 1024;

function encodeVarInt(input) {
  let value = input >>> 0;
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function decodeVarInt(buffer, offset = 0) {
  let value = 0;
  let size = 0;
  while (offset + size < buffer.length) {
    const byte = buffer[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
    if (size > 5) throw new Error("Некорректный ответ Minecraft-сервера");
    if ((byte & 0x80) === 0) return { value: value >>> 0, size };
  }
  return null;
}

function encodeString(value) {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(data.length), data]);
}

function createStatusRequest(host, port, protocolVersion = 767) {
  const portBuffer = Buffer.allocUnsafe(2);
  portBuffer.writeUInt16BE(port);
  const handshake = Buffer.concat([
    encodeVarInt(0),
    encodeVarInt(protocolVersion),
    encodeString(host),
    portBuffer,
    encodeVarInt(1),
  ]);
  return Buffer.concat([
    encodeVarInt(handshake.length),
    handshake,
    Buffer.from([0x01, 0x00]),
  ]);
}

function parseStatusResponse(buffer) {
  const packetLength = decodeVarInt(buffer);
  if (!packetLength) return null;
  if (packetLength.value > MAX_STATUS_PACKET) {
    throw new Error("Ответ Minecraft-сервера слишком большой");
  }
  const packetStart = packetLength.size;
  const packetEnd = packetStart + packetLength.value;
  if (buffer.length < packetEnd) return null;

  const packetId = decodeVarInt(buffer, packetStart);
  if (!packetId) return null;
  if (packetId.value !== 0) {
    throw new Error("Сервер вернул неожиданный status packet");
  }
  const jsonOffset = packetStart + packetId.size;
  const jsonLength = decodeVarInt(buffer, jsonOffset);
  if (!jsonLength) return null;
  const contentStart = jsonOffset + jsonLength.size;
  const contentEnd = contentStart + jsonLength.value;
  if (contentEnd > packetEnd) {
    throw new Error("Повреждённый ответ Minecraft-сервера");
  }
  return JSON.parse(buffer.subarray(contentStart, contentEnd).toString("utf8"));
}

function motdToText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const ownText =
    typeof value.text === "string"
      ? value.text
      : typeof value.translate === "string"
        ? value.translate
        : "";
  const extras = Array.isArray(value.extra)
    ? value.extra.map(motdToText).join("")
    : "";
  return `${ownText}${extras}`
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function friendlySocketError(error) {
  if (error?.code === "ECONNREFUSED") return "Сервер отклонил подключение";
  if (error?.code === "ENOTFOUND") return "Адрес сервера не найден";
  if (error?.code === "ETIMEDOUT") return "Сервер не ответил вовремя";
  return error instanceof Error ? error.message : "Сервер недоступен";
}

function inputHasExplicitPort(input) {
  const value = String(input || "").trim();
  if (/^\[[^\]]+\]:\d{1,5}$/.test(value)) return true;
  return (value.match(/:/g) || []).length === 1 && /:\d{1,5}$/.test(value);
}

async function resolveMinecraftEndpoint(
  address,
  input,
  { resolveSrvFn = dns.resolveSrv } = {},
) {
  if (
    inputHasExplicitPort(input) ||
    net.isIP(address.host) ||
    address.host === "localhost"
  ) {
    return { host: address.host, port: address.port, viaSrv: false };
  }
  try {
    const records = await resolveSrvFn(`_minecraft._tcp.${address.host}`);
    const record = [...records]
      .filter(
        (item) =>
          item &&
          typeof item.name === "string" &&
          Number.isInteger(item.port) &&
          item.port >= 1 &&
          item.port <= 65535,
      )
      .sort(
        (left, right) =>
          left.priority - right.priority || right.weight - left.weight,
      )[0];
    if (!record) {
      return { host: address.host, port: address.port, viaSrv: false };
    }
    return {
      host: record.name.replace(/\.$/, ""),
      port: record.port,
      viaSrv: true,
    };
  } catch {
    return { host: address.host, port: address.port, viaSrv: false };
  }
}

async function pingMinecraftServer(input, { timeoutMs = 4000 } = {}) {
  const address = parseServerAddress(input);
  if (!address) throw new Error("Сначала укажите адрес сервера");
  const endpoint = await resolveMinecraftEndpoint(address, input);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let response = Buffer.alloc(0);
    let finished = false;
    const socket = net.createConnection({
      host: endpoint.host,
      port: endpoint.port,
    });

    const finish = (result) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(Math.max(750, Math.min(10_000, timeoutMs)));
    socket.once("connect", () => {
      socket.write(createStatusRequest(address.host, address.port));
    });
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > MAX_STATUS_PACKET + 16) {
        finish({
          online: false,
          address: address.address,
          resolvedAddress: endpoint.viaSrv
            ? `${endpoint.host}:${endpoint.port}`
            : undefined,
          error: "Ответ Minecraft-сервера слишком большой",
        });
        return;
      }
      try {
        const status = parseStatusResponse(response);
        if (!status) return;
        finish({
          online: true,
          address: address.address,
          latencyMs: Date.now() - startedAt,
          version: String(status.version?.name || ""),
          protocol: Number(status.version?.protocol) || null,
          playersOnline: Math.max(0, Number(status.players?.online) || 0),
          playersMax: Math.max(0, Number(status.players?.max) || 0),
          motd: motdToText(status.description),
        });
      } catch (error) {
        finish({
          online: false,
          address: address.address,
          error: friendlySocketError(error),
        });
      }
    });
    socket.once("timeout", () =>
      finish({
        online: false,
        address: address.address,
        error: "Сервер не ответил вовремя",
      }),
    );
    socket.once("error", (error) =>
      finish({
        online: false,
        address: address.address,
        error: friendlySocketError(error),
      }),
    );
    socket.once("end", () => {
      if (!finished) {
        finish({
          online: false,
          address: address.address,
          error: "Сервер закрыл соединение без ответа",
        });
      }
    });
  });
}

module.exports = {
  createStatusRequest,
  decodeVarInt,
  encodeString,
  encodeVarInt,
  motdToText,
  parseStatusResponse,
  pingMinecraftServer,
  resolveMinecraftEndpoint,
};
