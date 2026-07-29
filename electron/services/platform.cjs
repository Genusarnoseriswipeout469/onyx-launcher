const path = require("node:path");

function minecraftOsName(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "osx";
  return "linux";
}

function adoptiumOsName(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "mac";
  return "linux";
}

function adoptiumArchitecture(architecture = process.arch) {
  if (architecture === "arm64") return "aarch64";
  if (architecture === "ia32") return "x86";
  return "x64";
}

function minecraftArchitecture(architecture = process.arch) {
  if (architecture === "x64") return "x86_64";
  if (architecture === "ia32") return "x86";
  return architecture;
}

function nativeArchitectureToken(architecture = process.arch) {
  return architecture.includes("64") ? "64" : "32";
}

function javaExecutableNames(platform = process.platform) {
  return platform === "win32" ? ["javaw.exe", "java.exe"] : ["java"];
}

function isJavaExecutableName(name, platform = process.platform) {
  const normalized = String(name || "").toLowerCase();
  return javaExecutableNames(platform).includes(normalized);
}

function javaConsoleExecutable(executable, platform = process.platform) {
  return platform === "win32"
    ? executable.replace(/javaw\.exe$/i, "java.exe")
    : executable;
}

function defaultDataRoot({
  platform = process.platform,
  env = process.env,
  home,
  appData,
}) {
  if (env.ONYX_DATA_ROOT) return path.resolve(env.ONYX_DATA_ROOT);
  if (platform === "win32") return path.join(appData, ".onyx");
  if (platform === "darwin") return path.join(appData, "Onyx Launcher");
  if (env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME)) {
    return path.join(env.XDG_DATA_HOME, "onyx-launcher");
  }
  return path.join(home, ".local", "share", "onyx-launcher");
}

module.exports = {
  minecraftOsName,
  adoptiumOsName,
  adoptiumArchitecture,
  minecraftArchitecture,
  nativeArchitectureToken,
  javaExecutableNames,
  isJavaExecutableName,
  javaConsoleExecutable,
  defaultDataRoot,
};
