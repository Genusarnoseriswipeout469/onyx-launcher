const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { fetchJson, downloadFile } = require("./network.cjs");
const { extractArchive, findFile } = require("./archive.cjs");
const {
  adoptiumOsName,
  adoptiumArchitecture,
  javaExecutableNames,
  isJavaExecutableName,
} = require("./platform.cjs");

const execFileAsync = promisify(execFile);

async function inspectJava(executable) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["-version"], {
      windowsHide: true,
      timeout: 10_000,
    });
    const output = `${stderr}\n${stdout}`;
    const match = output.match(/version\s+"([^"]+)"/i);
    if (!match) return null;
    const raw = match[1];
    const major = raw.startsWith("1.")
      ? Number(raw.split(".")[1])
      : Number(raw.split(/[.+_-]/)[0]);
    if (!Number.isFinite(major)) return null;
    return { executable, major, version: raw };
  } catch {
    return null;
  }
}

async function findSystemJava(platform = process.platform) {
  const candidates = javaExecutableNames(platform);
  for (const candidate of candidates) {
    const inspected = await inspectJava(candidate);
    if (inspected) return inspected;
  }
  return null;
}

class JavaService {
  constructor(runtimeRoot) {
    this.runtimeRoot = runtimeRoot;
  }

  async resolve(requiredMajor, customPath, onProgress, signal) {
    signal?.throwIfAborted();
    if (customPath) {
      const custom = await inspectJava(customPath);
      if (custom && custom.major === requiredMajor) return custom.executable;
      if (custom && requiredMajor >= 17 && custom.major > requiredMajor) {
        return custom.executable;
      }
    }

    const cachedRoot = path.join(this.runtimeRoot, `java-${requiredMajor}`);
    const cached = await findFile(
      cachedRoot,
      (_file, name) => isJavaExecutableName(name),
      5,
    ).catch(() => null);
    if (cached && (await inspectJava(cached))) return cached;

    const system = await findSystemJava();
    if (system && system.major === requiredMajor) {
      return system.executable;
    }

    return this.install(requiredMajor, onProgress, signal);
  }

  async install(requiredMajor, onProgress, signal) {
    signal?.throwIfAborted();
    onProgress?.({
      stage: "java",
      progress: 1,
      message: `Selecting Java ${requiredMajor}…`,
    });
    const architecture = adoptiumArchitecture();
    const operatingSystem = adoptiumOsName();
    const assets = await fetchJson(
      `https://api.adoptium.net/v3/assets/latest/${requiredMajor}/hotspot?architecture=${architecture}&image_type=jre&os=${operatingSystem}&vendor=eclipse`,
      { signal },
    );
    const selected = assets.find(
      (asset) => asset.binary?.package?.link && asset.binary?.package?.name,
    );
    if (!selected) {
      throw new Error(`No prebuilt Java runtime was found for Java ${requiredMajor}`);
    }

    const runtimeDirectory = path.join(
      this.runtimeRoot,
      `java-${requiredMajor}`,
    );
    const archive = path.join(
      this.runtimeRoot,
      "downloads",
      selected.binary.package.name,
    );
    await downloadFile({
      url: selected.binary.package.link,
      destination: archive,
      sha256: selected.binary.package.checksum,
      size: selected.binary.package.size,
      signal,
      onProgress: ({ received, total }) => {
        const progress = total ? Math.round((received / total) * 72) : 8;
        onProgress?.({
          stage: "java",
          progress: Math.max(2, progress),
          message: `Downloading Java ${requiredMajor}…`,
          received,
          total,
        });
      },
    });

    signal?.throwIfAborted();
    await fsp.rm(runtimeDirectory, { recursive: true, force: true });
    await fsp.mkdir(runtimeDirectory, { recursive: true });
    await extractArchive(archive, runtimeDirectory, {
      signal,
      onProgress: ({ extracted, count }) => {
        const extractionProgress = count
          ? Math.round((extracted / Math.max(count, 1)) * 27)
          : Math.min(extracted, 26);
        onProgress?.({
          stage: "java",
          progress: 72 + extractionProgress,
          message: `Extracting Java ${requiredMajor}…`,
        });
      },
    });
    signal?.throwIfAborted();
    const executable = await findFile(
      runtimeDirectory,
      (_file, name) => isJavaExecutableName(name),
      5,
    );
    if (!executable) throw new Error("The Java archive does not contain an executable");
    onProgress?.({
      stage: "java",
      progress: 100,
      message: `Java ${requiredMajor} is ready`,
    });
    return executable;
  }
}

module.exports = {
  JavaService,
  inspectJava,
  findSystemJava,
};
