const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const StreamZip = require("node-stream-zip");
const tar = require("tar-stream");

function safeDestination(root, relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const rootPath = path.resolve(root);
  const destination = path.resolve(rootPath, normalized);
  if (
    destination !== rootPath &&
    !destination.startsWith(`${rootPath}${path.sep}`)
  ) {
    throw new Error(`Unsafe path inside the archive: ${relativePath}`);
  }
  return destination;
}

async function readZipJson(zipPath, entryName) {
  const zip = new StreamZip.async({ file: zipPath });
  try {
    const data = await zip.entryData(entryName);
    return JSON.parse(data.toString("utf8"));
  } finally {
    await zip.close();
  }
}

async function extractZip(zipPath, destination, options = {}) {
  const zip = new StreamZip.async({ file: zipPath });
  let extracted = 0;
  try {
    const entries = Object.values(await zip.entries());
    const files = entries.filter((entry) => !entry.isDirectory);
    for (const entry of files) {
      let relative = entry.name;
      if (options.mapPath) relative = options.mapPath(entry.name);
      if (relative == null) continue;
      const output = safeDestination(destination, relative);
      await fsp.mkdir(path.dirname(output), { recursive: true });
      await zip.extract(entry.name, output);
      extracted += 1;
      options.onProgress?.({
        extracted,
        count: files.length,
        current: relative,
      });
    }
  } finally {
    await zip.close();
  }
}

async function drainStream(stream) {
  for await (const _chunk of stream) {
    // Drain metadata-only tar entries before asking tar-stream for the next one.
  }
}

function safeLinkTarget(root, destination, linkName) {
  const target = path.resolve(path.dirname(destination), linkName);
  const rootPath = path.resolve(root);
  if (target !== rootPath && !target.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`Unsafe link inside the archive: ${linkName}`);
  }
  return target;
}

async function extractTarGz(archivePath, destination, options = {}) {
  await fsp.mkdir(destination, { recursive: true });
  const extract = tar.extract();
  let extracted = 0;

  extract.on("entry", (header, stream, next) => {
    void (async () => {
      options.signal?.throwIfAborted();
      let relative = header.name;
      if (options.mapPath) relative = options.mapPath(header.name);
      if (relative == null) {
        stream.resume();
        stream.once("end", next);
        return;
      }

      const output = safeDestination(destination, relative);
      if (header.type === "directory") {
        await drainStream(stream);
        await fsp.mkdir(output, { recursive: true });
      } else if (header.type === "file") {
        await fsp.mkdir(path.dirname(output), { recursive: true });
        await pipeline(stream, fs.createWriteStream(output));
        if (header.mode != null) await fsp.chmod(output, header.mode & 0o777);
      } else if (header.type === "symlink") {
        await drainStream(stream);
        safeLinkTarget(destination, output, header.linkname);
        await fsp.mkdir(path.dirname(output), { recursive: true });
        await fsp.rm(output, { force: true }).catch(() => undefined);
        await fsp.symlink(header.linkname, output);
      } else if (header.type === "link") {
        await drainStream(stream);
        const target = safeDestination(destination, header.linkname);
        await fsp.mkdir(path.dirname(output), { recursive: true });
        await fsp.rm(output, { force: true }).catch(() => undefined);
        await fsp.link(target, output);
      } else {
        await drainStream(stream);
      }

      extracted += 1;
      options.onProgress?.({ extracted, count: 0, current: relative });
      next();
    })().catch((error) => extract.destroy(error));
  });

  await pipeline(
    fs.createReadStream(archivePath),
    zlib.createGunzip(),
    extract,
    ...(options.signal ? [{ signal: options.signal }] : []),
  );
}

async function extractArchive(archivePath, destination, options = {}) {
  const normalized = archivePath.toLowerCase();
  if (normalized.endsWith(".zip")) {
    return extractZip(archivePath, destination, options);
  }
  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz")) {
    return extractTarGz(archivePath, destination, options);
  }
  throw new Error(`Unsupported archive format: ${path.basename(archivePath)}`);
}

async function findFile(root, predicate, maxDepth = 4) {
  async function walk(directory, depth) {
    if (depth > maxDepth) return null;
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && predicate(candidate, entry.name)) return candidate;
      if (entry.isDirectory()) {
        const nested = await walk(candidate, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }
  return walk(root, 0);
}

module.exports = {
  safeDestination,
  readZipJson,
  extractZip,
  extractTarGz,
  extractArchive,
  findFile,
};
