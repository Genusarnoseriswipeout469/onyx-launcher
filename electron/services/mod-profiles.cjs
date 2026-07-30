const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PROFILE_SCHEMA = 1;
const MAX_PROFILES = 12;
const MAX_PROFILE_NAME = 48;
const STORE_DIRECTORY = ".onyx";
const STORE_FILE = "mod-profiles.json";

function instanceDirectory(instancesRoot, instanceId) {
  const id = String(instanceId || "");
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) {
    throw new Error("Invalid instance ID");
  }
  return path.join(path.resolve(instancesRoot), id);
}

function profileStorePath(instancesRoot, instanceId) {
  return path.join(
    instanceDirectory(instancesRoot, instanceId),
    STORE_DIRECTORY,
    STORE_FILE,
  );
}

function canonicalModName(value) {
  const name = String(value || "").trim();
  if (
    !name ||
    name.length > 240 ||
    name.includes("/") ||
    name.includes("\\") ||
    path.basename(name) !== name
  ) {
    return null;
  }
  const canonical = name.replace(/\.disabled$/i, "");
  if (!canonical.toLowerCase().endsWith(".jar")) return null;
  return canonical;
}

function normalizedProfileName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Enter a profile name");
  if (name.length > MAX_PROFILE_NAME) {
    throw new Error(`The profile name cannot be longer than ${MAX_PROFILE_NAME} characters`);
  }
  return name;
}

function normalizeStoredProfile(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "");
  const name = String(value.name || "").trim();
  if (!/^[a-f0-9-]{8,64}$/i.test(id) || !name || name.length > MAX_PROFILE_NAME) {
    return null;
  }

  const seen = new Set();
  const entries = [];
  for (const rawEntry of Array.isArray(value.entries) ? value.entries : []) {
    const modName = canonicalModName(rawEntry?.name);
    const key = modName?.toLowerCase();
    if (!modName || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      name: modName,
      enabled: rawEntry?.enabled !== false,
    });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, "ru"));

  return {
    schema: PROFILE_SCHEMA,
    id,
    name,
    createdAt:
      typeof value.createdAt === "string"
        ? value.createdAt
        : new Date(0).toISOString(),
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date(0).toISOString(),
    modCount: entries.length,
    enabledCount: entries.filter((entry) => entry.enabled).length,
    entries,
  };
}

async function readStore(instancesRoot, instanceId) {
  const filePath = profileStorePath(instancesRoot, instanceId);
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { schema: PROFILE_SCHEMA, profiles: [] };
    }
    if (error instanceof SyntaxError) {
      throw new Error("The mod profile file is corrupted");
    }
    throw error;
  }

  if (parsed?.schema !== PROFILE_SCHEMA || !Array.isArray(parsed.profiles)) {
    throw new Error("The mod profile format is not supported");
  }

  const ids = new Set();
  const profiles = [];
  for (const value of parsed.profiles) {
    const profile = normalizeStoredProfile(value);
    if (!profile || ids.has(profile.id)) continue;
    ids.add(profile.id);
    profiles.push(profile);
  }
  return { schema: PROFILE_SCHEMA, profiles };
}

async function writeStore(instancesRoot, instanceId, store) {
  const filePath = profileStorePath(instancesRoot, instanceId);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        schema: PROFILE_SCHEMA,
        profiles: store.profiles,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  try {
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
      await fsp.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    await fsp.rm(filePath, { force: true });
    await fsp.rename(temporaryPath, filePath);
  }
}

async function scanModStates(instancesRoot, instanceId) {
  const modsDirectory = path.join(
    instanceDirectory(instancesRoot, instanceId),
    "mods",
  );
  let directoryEntries;
  try {
    directoryEntries = await fsp.readdir(modsDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return { modsDirectory, entries: [] };
    throw error;
  }

  const entries = [];
  const byCanonicalName = new Map();
  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile()) continue;
    const name = canonicalModName(directoryEntry.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (byCanonicalName.has(key)) {
      const other = byCanonicalName.get(key);
      throw new Error(
        `Conflicting mod files: ${other.fileName} and ${directoryEntry.name}`,
      );
    }
    const entry = {
      name,
      fileName: directoryEntry.name,
      enabled: !directoryEntry.name.toLowerCase().endsWith(".disabled"),
    };
    byCanonicalName.set(key, entry);
    entries.push(entry);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  return { modsDirectory, entries };
}

async function listModProfiles({ instancesRoot, instanceId }) {
  const [store, scan] = await Promise.all([
    readStore(instancesRoot, instanceId),
    scanModStates(instancesRoot, instanceId),
  ]);
  const currentByName = new Map(
    scan.entries.map((entry) => [entry.name.toLowerCase(), entry]),
  );
  return store.profiles
    .map((profile) => {
      let changeCount = 0;
      let missingCount = 0;
      for (const desired of profile.entries) {
        const current = currentByName.get(desired.name.toLowerCase());
        if (!current) missingCount += 1;
        else if (current.enabled !== desired.enabled) changeCount += 1;
      }
      return {
        ...profile,
        matchesCurrent: changeCount === 0 && missingCount === 0,
        changeCount,
        missingCount,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    );
}

async function saveModProfile({
  instancesRoot,
  instanceId,
  name,
  profileId,
  now = () => new Date(),
  idFactory = () => crypto.randomUUID(),
}) {
  const profileName = normalizedProfileName(name);
  const [{ entries }, store] = await Promise.all([
    scanModStates(instancesRoot, instanceId),
    readStore(instancesRoot, instanceId),
  ]);
  const existingIndex = profileId
    ? store.profiles.findIndex((profile) => profile.id === profileId)
    : -1;
  if (profileId && existingIndex < 0) {
    throw new Error("Mod profile not found");
  }
  if (existingIndex < 0 && store.profiles.length >= MAX_PROFILES) {
    throw new Error(`You can save no more than ${MAX_PROFILES} profiles`);
  }

  const timestamp = now().toISOString();
  const existing = existingIndex >= 0 ? store.profiles[existingIndex] : null;
  const profile = {
    schema: PROFILE_SCHEMA,
    id: existing?.id || idFactory(),
    name: profileName,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    modCount: entries.length,
    enabledCount: entries.filter((entry) => entry.enabled).length,
    entries: entries.map(({ name: modName, enabled }) => ({
      name: modName,
      enabled,
    })),
  };

  if (existingIndex >= 0) {
    store.profiles.splice(existingIndex, 1, profile);
  } else {
    store.profiles.push(profile);
  }
  await writeStore(instancesRoot, instanceId, store);
  return profile;
}

async function pathExists(filePath) {
  try {
    await fsp.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function applyModProfile({
  instancesRoot,
  instanceId,
  profileId,
  renameFile = (source, destination) => fsp.rename(source, destination),
}) {
  const [store, scan] = await Promise.all([
    readStore(instancesRoot, instanceId),
    scanModStates(instancesRoot, instanceId),
  ]);
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("Mod profile not found");

  const currentByName = new Map(
    scan.entries.map((entry) => [entry.name.toLowerCase(), entry]),
  );
  const operations = [];
  const missing = [];
  let unchanged = 0;

  for (const desired of profile.entries) {
    const current = currentByName.get(desired.name.toLowerCase());
    if (!current) {
      missing.push(desired.name);
      continue;
    }
    if (current.enabled === desired.enabled) {
      unchanged += 1;
      continue;
    }
    const destinationName = desired.enabled
      ? desired.name
      : `${desired.name}.disabled`;
    const source = path.join(scan.modsDirectory, current.fileName);
    const destination = path.join(scan.modsDirectory, destinationName);
    if (await pathExists(destination)) {
      throw new Error(`Cannot switch ${desired.name}: the destination file already exists`);
    }
    operations.push({
      name: desired.name,
      source,
      destination,
    });
  }

  const completed = [];
  try {
    for (const operation of operations) {
      await renameFile(operation.source, operation.destination);
      completed.push(operation);
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const operation of completed.reverse()) {
      try {
        await renameFile(operation.destination, operation.source);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      throw new Error(
        "The profile could not be applied and the changes could not be fully rolled back. Check the mods folder.",
      );
    }
    throw new Error(
      `The profile could not be applied; changes were rolled back: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    profile,
    changed: operations.map((operation) => operation.name),
    missing,
    unchanged,
  };
}

async function deleteModProfile({ instancesRoot, instanceId, profileId }) {
  const store = await readStore(instancesRoot, instanceId);
  const nextProfiles = store.profiles.filter(
    (profile) => profile.id !== profileId,
  );
  if (nextProfiles.length === store.profiles.length) {
    throw new Error("Mod profile not found");
  }
  await writeStore(instancesRoot, instanceId, {
    schema: PROFILE_SCHEMA,
    profiles: nextProfiles,
  });
  return true;
}

module.exports = {
  MAX_PROFILES,
  applyModProfile,
  canonicalModName,
  deleteModProfile,
  listModProfiles,
  saveModProfile,
  scanModStates,
};
