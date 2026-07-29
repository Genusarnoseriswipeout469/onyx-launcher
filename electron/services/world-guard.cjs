const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { ZipArchive } = require("archiver");
const { extractZip, readZipJson } = require("./archive.cjs");
const { directoryStats, safeChild } = require("./maintenance.cjs");

const SNAPSHOT_SCHEMA = 1;

function snapshotDirectory(worldGuardRoot, instanceId) {
  return safeChild(worldGuardRoot, String(instanceId));
}

function safeSnapshotId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(id)) {
    throw new Error("Некорректный идентификатор снимка мира");
  }
  return id;
}

async function renameWithRetry(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fsp.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 40 * (attempt + 1)),
      );
    }
  }
  try {
    await fsp.cp(source, destination, {
      recursive: true,
      errorOnExist: true,
    });
    await fsp.rm(source, { recursive: true, force: true });
  } catch {
    throw lastError;
  }
}

async function worldNames(savesDirectory) {
  const entries = await fsp
    .readdir(savesDirectory, { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function createWorldSnapshot({
  instancesRoot,
  worldGuardRoot,
  instanceId,
  reason = "manual",
  retention = 8,
  onProgress,
}) {
  const instanceDirectory = safeChild(instancesRoot, String(instanceId));
  const savesDirectory = path.join(instanceDirectory, "saves");
  const worlds = await worldNames(savesDirectory);
  if (!worlds.length) return null;
  const totals = await directoryStats(savesDirectory);
  if (!["manual", "pre-restore"].includes(reason)) {
    const recent = (
      await listWorldSnapshots({ worldGuardRoot, instanceId })
    )[0];
    if (
      recent &&
      recent.reason === reason &&
      recent.sourceBytes === totals.bytes &&
      recent.files === totals.files &&
      Date.now() - new Date(recent.createdAt).getTime() < 30 * 60_000
    ) {
      return recent;
    }
  }
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, "-")}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
  const outputDirectory = snapshotDirectory(worldGuardRoot, instanceId);
  const destination = path.join(outputDirectory, `${id}.zip`);
  const temporary = `${destination}.part`;
  const manifest = {
    schema: SNAPSHOT_SCHEMA,
    id,
    instanceId: String(instanceId),
    createdAt,
    reason: String(reason).slice(0, 40),
    worlds,
    sourceBytes: totals.bytes,
    files: totals.files,
  };
  await fsp.mkdir(outputDirectory, { recursive: true });
  await fsp.rm(temporary, { force: true });
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporary);
      const archive = new ZipArchive({ zlib: { level: 3 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("warning", (error) => {
        if (error.code !== "ENOENT") reject(error);
      });
      archive.on("error", reject);
      archive.on("progress", (progress) => {
        const processed = Number(progress.fs.processedBytes || 0);
        onProgress?.({
          processed,
          total: totals.bytes,
          progress: totals.bytes
            ? Math.min(99, Math.round((processed / totals.bytes) * 100))
            : 50,
        });
      });
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), {
        name: "world-guard.json",
      });
      archive.directory(savesDirectory, "saves");
      void archive.finalize();
    });
    await fsp.rename(temporary, destination);
    const stats = await fsp.stat(destination);
    const result = { ...manifest, bytes: stats.size };
    onProgress?.({
      processed: totals.bytes,
      total: totals.bytes,
      progress: 100,
    });
    const snapshots = await listWorldSnapshots({
      worldGuardRoot,
      instanceId,
    });
    await Promise.all(
      snapshots
        .slice(Math.max(1, Math.trunc(retention)))
        .map((snapshot) =>
          fsp.rm(path.join(outputDirectory, `${snapshot.id}.zip`), {
            force: true,
          }),
        ),
    );
    return result;
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function listWorldSnapshots({ worldGuardRoot, instanceId }) {
  const directory = snapshotDirectory(worldGuardRoot, instanceId);
  const entries = await fsp
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) continue;
    const archivePath = path.join(directory, entry.name);
    try {
      const [manifest, stats] = await Promise.all([
        readZipJson(archivePath, "world-guard.json"),
        fsp.stat(archivePath),
      ]);
      if (
        manifest?.schema !== SNAPSHOT_SCHEMA ||
        manifest.instanceId !== String(instanceId)
      ) {
        continue;
      }
      snapshots.push({
        id: safeSnapshotId(manifest.id),
        instanceId: String(instanceId),
        createdAt: manifest.createdAt,
        reason: manifest.reason,
        worlds: Array.isArray(manifest.worlds)
          ? manifest.worlds.map(String).slice(0, 100)
          : [],
        sourceBytes: Number(manifest.sourceBytes || 0),
        files: Number(manifest.files || 0),
        bytes: stats.size,
      });
    } catch {
      // A partial or foreign archive is ignored.
    }
  }
  return snapshots.sort(
    (left, right) =>
      new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime(),
  );
}

async function restoreWorldSnapshot({
  instancesRoot,
  worldGuardRoot,
  instanceId,
  snapshotId,
  onProgress,
}) {
  const safeId = safeSnapshotId(snapshotId);
  const instanceDirectory = safeChild(instancesRoot, String(instanceId));
  const archivePath = path.join(
    snapshotDirectory(worldGuardRoot, instanceId),
    `${safeId}.zip`,
  );
  const manifest = await readZipJson(archivePath, "world-guard.json");
  if (
    manifest?.schema !== SNAPSHOT_SCHEMA ||
    manifest.instanceId !== String(instanceId) ||
    manifest.id !== safeId
  ) {
    throw new Error("Снимок мира повреждён или относится к другому инстансу");
  }
  const safetySnapshot = await createWorldSnapshot({
    instancesRoot,
    worldGuardRoot,
    instanceId,
    reason: "pre-restore",
    retention: 8,
  });
  const staging = path.join(
    instanceDirectory,
    `.onyx-world-restore-${crypto.randomUUID()}`,
  );
  const previous = path.join(
    instanceDirectory,
    `.onyx-world-previous-${crypto.randomUUID()}`,
  );
  const savesDirectory = path.join(instanceDirectory, "saves");
  await fsp.mkdir(staging, { recursive: true });
  try {
    await extractZip(archivePath, staging, {
      mapPath: (entryName) => {
        const normalized = entryName.replaceAll("\\", "/");
        if (!normalized.startsWith("saves/")) return null;
        return normalized.slice("saves/".length) || null;
      },
      onProgress: ({ extracted, count, current }) =>
        onProgress?.({
          progress: Math.round((extracted / Math.max(count, 1)) * 100),
          current,
          extracted,
          count,
        }),
    });
    const current = await fsp.stat(savesDirectory).catch(() => null);
    if (current?.isDirectory()) {
      await renameWithRetry(savesDirectory, previous);
    }
    try {
      await renameWithRetry(staging, savesDirectory);
    } catch (error) {
      if (current?.isDirectory()) {
        await renameWithRetry(previous, savesDirectory).catch(
          () => undefined,
        );
      }
      throw error;
    }
    await fsp.rm(previous, { recursive: true, force: true });
    return {
      restored: true,
      snapshotId: safeId,
      worlds: Array.isArray(manifest.worlds) ? manifest.worlds.map(String) : [],
      safetySnapshot,
    };
  } catch (error) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

module.exports = {
  safeSnapshotId,
  createWorldSnapshot,
  listWorldSnapshots,
  restoreWorldSnapshot,
};
