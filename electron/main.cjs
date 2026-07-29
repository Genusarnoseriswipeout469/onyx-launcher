const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  nativeTheme,
} = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { version: ONYX_VERSION } = require("../package.json");
const { AuthService } = require("./services/auth.cjs");
const { defaultDataRoot } = require("./services/platform.cjs");
const { JavaService, inspectJava, findSystemJava } = require("./services/java.cjs");
const {
  MinecraftService,
  loaderInfo,
  normalizeResolvedVersionId,
  parseServerAddress,
} = require("./services/minecraft.cjs");
const { ModpackService } = require("./services/modpack.cjs");
const {
  checkModUpdates,
  listModHistory,
  rollbackModUpdate,
  updateMod,
  safeModrinthDownload,
} = require("./services/content.cjs");
const {
  directoryStats,
  createInstanceBackup,
  importInstanceBackup,
  removePartialFiles,
} = require("./services/maintenance.cjs");
const {
  analyzeInstanceStorage,
  cleanupInstanceStorage,
} = require("./services/instance-storage.cjs");
const { analyzeMinecraftLog } = require("./services/log-analysis.cjs");
const { checkInstanceHealth } = require("./services/preflight.cjs");
const { getOnyxPicks } = require("./services/picks.cjs");
const {
  recommendInstanceResources,
} = require("./services/tuning.cjs");
const { pingMinecraftServer } = require("./services/server-status.cjs");
const {
  snapshotMods,
  readModBaseline,
  writeModBaseline,
  recentModChanges,
  disableSuspectMods,
} = require("./services/guard.cjs");
const {
  readBisectSession,
  startBisect,
  reportBisectResult,
  cancelBisect,
  finishBisect,
} = require("./services/bisect.cjs");
const {
  applyModProfile,
  deleteModProfile,
  listModProfiles,
  saveModProfile,
} = require("./services/mod-profiles.cjs");
const {
  createWorldSnapshot,
  listWorldSnapshots,
  restoreWorldSnapshot,
} = require("./services/world-guard.cjs");
const {
  createSyncProfile,
  validateSyncProfile,
  identifySyncMods,
  installSyncMods,
} = require("./services/sync.cjs");
const {
  FlightRecorder,
  buildRegressionInsights,
} = require("./services/flight-recorder.cjs");
const {
  detectFpsRecorder,
  buildFpsInsights,
  FpsRecorder,
} = require("./services/fps-recorder.cjs");
const {
  createSupportBundle,
} = require("./services/support-bundle.cjs");
const {
  fetchJson,
  downloadFile,
  hashFile,
} = require("./services/network.cjs");

if (process.env.ONYX_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.ONYX_USER_DATA));
}

try {
  const bootstrapState = JSON.parse(
    fs.readFileSync(path.join(app.getPath("userData"), "state.json"), "utf8"),
  );
  if (bootstrapState?.settings?.hardwareAcceleration === false) {
    app.disableHardwareAcceleration();
  }
} catch {
  // First launch or an unreadable state is handled by the normal migration.
}

const DEFAULT_STATE = {
  profile: {
    name: "Игрок",
    kind: "local",
  },
  settings: {
    language: "ru",
    memory: 6,
    gameDirectory: "",
    javaPath: "",
    closeOnLaunch: false,
    keepLauncherOpen: true,
    ghostMode: false,
    hardwareAcceleration: true,
    showSnapshots: false,
    notifications: true,
    autoCheckUpdates: true,
    reducedMotion: false,
    onboardingComplete: false,
    accent: "lime",
    windowWidth: 1280,
    windowHeight: 720,
    fullscreen: false,
  },
  instances: [
    {
      id: "vanilla-start",
      name: "Чистая игра",
      version: "1.21.1",
      loader: "Vanilla",
      description: "Minecraft без модификаций",
      color: "lime",
      glyph: "MC",
      favorite: true,
      status: "setup",
      lastPlayed: "Ещё не запускался",
      playtimeMinutes: 0,
      modCount: 0,
    },
  ],
  downloads: [],
  sessions: [],
};

let mainWindow;
let ghostModeActive = false;
let statePath;
let state = structuredClone(DEFAULT_STATE);
let authService;
let javaService;
const runningGames = new Map();
const installLocks = new Map();
const installControllers = new Map();
const downloadControllers = new Map();
const instanceStorageCache = new Map();

function getStatePath() {
  return path.join(app.getPath("userData"), "state.json");
}

function onyxRoot() {
  const preferred = defaultDataRoot({
    env: process.env,
    home: app.getPath("home"),
    appData: app.getPath("appData"),
  });
  if (process.platform !== "linux" || process.env.ONYX_DATA_ROOT) {
    return preferred;
  }
  const legacy = path.join(app.getPath("appData"), ".onyx");
  const configuredDirectory = state.settings?.gameDirectory;
  const usesLegacyDirectory =
    typeof configuredDirectory === "string" &&
    (path.resolve(configuredDirectory) === path.resolve(legacy) ||
      path.resolve(configuredDirectory).startsWith(
        `${path.resolve(legacy)}${path.sep}`,
      ));
  if (
    usesLegacyDirectory ||
    (fs.existsSync(legacy) && !fs.existsSync(preferred))
  ) {
    return legacy;
  }
  return preferred;
}

function createServices() {
  const sharedRoot = path.join(onyxRoot(), "shared");
  const minecraftService = new MinecraftService({
    sharedRoot,
    instancesRoot: state.settings.gameDirectory,
    javaService,
  });
  const modpackService = new ModpackService({
    packsRoot: path.join(onyxRoot(), "packs"),
    instancesRoot: state.settings.gameDirectory,
    minecraftService,
  });
  return { minecraftService, modpackService };
}

function effectiveSettings(instance) {
  const overrides = instance?.settings || {};
  const servers = Array.isArray(overrides.servers) ? overrides.servers : [];
  const selectedServer =
    servers.find((server) => server.id === overrides.selectedServerId) ||
    servers[0];
  return {
    ...state.settings,
    ...overrides,
    javaPath: overrides.javaPath || state.settings.javaPath,
    serverAddress: selectedServer?.address || overrides.serverAddress || "",
  };
}

async function preflightInstance(instance, persist = true) {
  const health = await checkInstanceHealth({
    instance,
    settings: effectiveSettings(instance),
    sharedRoot: path.join(onyxRoot(), "shared"),
    instancesRoot: state.settings.gameDirectory,
  });
  instance.health = health;
  instanceUpdate(instance, { health });
  if (persist) await saveState();
  return structuredClone(health);
}

function preflightBlockedMessage(health) {
  if (health.blocker === "disk-critical") {
    return "Недостаточно места на диске для безопасного запуска";
  }
  if (health.blocker === "memory-impossible") {
    return "Инстансу выделено больше памяти, чем безопасно доступно системе";
  }
  if (health.blocker === "instance-directory-readonly") {
    return "Папка инстанса недоступна для записи";
  }
  return "Инстанс не прошёл предварительную проверку";
}

function sanitizeSettingsPatch(input = {}) {
  const output = {};
  const booleans = [
    "closeOnLaunch",
    "keepLauncherOpen",
    "ghostMode",
    "hardwareAcceleration",
    "showSnapshots",
    "notifications",
    "autoCheckUpdates",
    "reducedMotion",
    "onboardingComplete",
    "fullscreen",
  ];
  for (const key of booleans) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  if (Number.isFinite(input.memory)) {
    output.memory = Math.max(2, Math.min(64, Math.round(input.memory)));
  }
  if (Number.isFinite(input.windowWidth)) {
    output.windowWidth = Math.max(
      640,
      Math.min(7680, Math.round(input.windowWidth)),
    );
  }
  if (Number.isFinite(input.windowHeight)) {
    output.windowHeight = Math.max(
      480,
      Math.min(4320, Math.round(input.windowHeight)),
    );
  }
  if (["lime", "violet", "cyan"].includes(input.accent)) {
    output.accent = input.accent;
  }
  if (["ru", "en"].includes(input.language)) {
    output.language = input.language;
  }
  if (typeof input.javaPath === "string") {
    output.javaPath = input.javaPath.trim().slice(0, 1024);
  }
  return output;
}

async function loadState() {
  statePath = getStatePath();
  try {
    const parsed = JSON.parse(await fsp.readFile(statePath, "utf8"));
    state = {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      profile: {
        ...DEFAULT_STATE.profile,
        ...(parsed.profile || {}),
      },
      settings: {
        ...DEFAULT_STATE.settings,
        ...(parsed.settings || {}),
      },
      instances: Array.isArray(parsed.instances)
        ? parsed.instances
        : structuredClone(DEFAULT_STATE.instances),
      downloads: Array.isArray(parsed.downloads) ? parsed.downloads : [],
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.slice(0, 500)
        : [],
    };
    if (typeof parsed.settings?.onboardingComplete !== "boolean") {
      state.settings.onboardingComplete = true;
    }
  } catch {
    state = structuredClone(DEFAULT_STATE);
  }

  if (!state.settings.gameDirectory) {
    state.settings.gameDirectory = path.join(onyxRoot(), "instances");
  }
  for (const instance of state.instances) {
    normalizeResolvedVersionId(instance);
    if (
      instance.status === "running" ||
      instance.status === "installing" ||
      (instance.status === "ready" && !instance.resolvedVersionId)
    ) {
      instance.status = instance.resolvedVersionId ? "ready" : "setup";
    }
  }
  for (const task of state.downloads) {
    if (
      task.status === "queued" ||
      task.status === "downloading" ||
      task.status === "installing"
    ) {
      task.status = "error";
      task.error = "Загрузка прервалась при закрытии лаунчера";
      if (
        /^[a-f0-9-]{36}$/i.test(task.instanceId || "") &&
        !state.instances.some((instance) => instance.id === task.instanceId)
      ) {
        await fsp
          .rm(
            path.join(state.settings.gameDirectory, task.instanceId),
            { recursive: true, force: true },
          )
          .catch(() => undefined);
      }
    }
  }
  state.downloads = state.downloads.slice(0, 50);
  await saveState();
}

async function saveState() {
  if (!statePath) statePath = getStatePath();
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
  await fsp.rm(statePath, { force: true }).catch(() => undefined);
  await fsp.rename(temporaryPath, statePath);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function serializeState() {
  return structuredClone({
    ...state,
    instances: state.instances.map((instance) => ({
      ...instance,
      status: runningGames.has(instance.id) ? "running" : instance.status,
    })),
  });
}

async function createWindow() {
  const capturePath = process.env.ONYX_CAPTURE_PATH;
  const bounds = state.settings.launcherBounds || {};
  const launcherWindow = new BrowserWindow({
    width: bounds.width || 1440,
    height: bounds.height || 900,
    x: capturePath ? -10_000 : bounds.x,
    y: capturePath ? -10_000 : bounds.y,
    minWidth: 1120,
    minHeight: 700,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#090b0d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      spellcheck: false,
      enableWebSQL: false,
    },
  });
  mainWindow = launcherWindow;

  launcherWindow.once("ready-to-show", () => {
    if (state.settings.launcherMaximized) launcherWindow.maximize();
    if (capturePath) launcherWindow.showInactive();
    else launcherWindow.show();
  });
  launcherWindow.on("maximize", () => send("window:maximized", true));
  launcherWindow.on("unmaximize", () => send("window:maximized", false));
  launcherWindow.on("close", () => {
    if (!launcherWindow.isMaximized()) {
      state.settings.launcherBounds = launcherWindow.getBounds();
    }
    state.settings.launcherMaximized = launcherWindow.isMaximized();
    void saveState();
  });
  launcherWindow.on("closed", () => {
    if (mainWindow === launcherWindow) mainWindow = null;
  });
  launcherWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  launcherWindow.webContents.on("will-navigate", (event, url) => {
    const current = launcherWindow.webContents.getURL();
    if (url !== current && !url.startsWith("file:")) event.preventDefault();
  });
  launcherWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  const rendererSession = launcherWindow.webContents.session;
  rendererSession.setPermissionRequestHandler(
    (_webContents, permission, callback) =>
      callback(permission === "clipboard-sanitized-write"),
  );
  rendererSession.setPermissionCheckHandler(
    (_webContents, permission) =>
      permission === "clipboard-sanitized-write",
  );

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await launcherWindow.loadURL(devUrl);
  else
    await launcherWindow.loadFile(
      path.join(__dirname, "..", "dist", "index.html"),
    );

  if (capturePath) {
    if (process.env.ONYX_CAPTURE_TARGET) {
      const targets = process.env.ONYX_CAPTURE_TARGET.split(">")
        .map((target) => target.trim())
        .filter(Boolean);
      for (const target of targets) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await launcherWindow.webContents.executeJavaScript(
          `(() => {
            const target = ${JSON.stringify(target)};
            const element = [
              ...document.querySelectorAll("button, [data-capture-target]")
            ].find(
              (item) =>
                [
                  item.textContent,
                  item.getAttribute("aria-label"),
                  item.getAttribute("data-capture-target"),
                  item.title
                ]
                  .filter(Boolean)
                  .some((value) => value.includes(target))
            );
            if (element) {
              element.scrollIntoView({ block: "center", inline: "nearest" });
              element.click();
            }
          })()`,
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1350));
    const image = await launcherWindow.capturePage();
    await fsp.writeFile(path.resolve(capturePath), image.toPNG());
    app.quit();
  }
}

function enterGhostMode() {
  const launcherWindow = mainWindow;
  if (
    !state.settings.ghostMode ||
    !launcherWindow ||
    launcherWindow.isDestroyed()
  ) {
    return;
  }
  if (!launcherWindow.isMaximized()) {
    state.settings.launcherBounds = launcherWindow.getBounds();
  }
  state.settings.launcherMaximized = launcherWindow.isMaximized();
  ghostModeActive = true;
  void saveState();
  launcherWindow.destroy();
}

async function restoreLauncherWindow() {
  ghostModeActive = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function taskUpdate(task, patch) {
  Object.assign(task, patch);
  send("download:progress", structuredClone(task));
  if (
    patch.status === "done" &&
    state.settings.notifications &&
    Notification.isSupported()
  ) {
    new Notification({
      title: "Onyx Launcher",
      body: `${task.name}: установка завершена`,
      silent: false,
    }).show();
  }
}

function instanceUpdate(instance, patch) {
  Object.assign(instance, patch);
  send("instance:updated", structuredClone(instance));
}

async function runInstall(instance) {
  if (installLocks.has(instance.id)) return installLocks.get(instance.id);
  const controller = new AbortController();
  installControllers.set(instance.id, controller);
  const promise = (async () => {
    const { minecraftService } = createServices();
    instanceUpdate(instance, { status: "installing", installProgress: 0 });
    await saveState();
    try {
      const installed = await minecraftService.installInstance(
        instance,
        effectiveSettings(instance),
        (progress) => {
          instanceUpdate(instance, {
            status: "installing",
            installProgress: progress.progress,
            installMessage: progress.message,
          });
          send("launcher:progress", {
            instanceId: instance.id,
            ...progress,
          });
        },
        controller.signal,
      );
      instanceUpdate(instance, {
        ...installed,
        status: "ready",
        installProgress: 100,
        installMessage: "Готово",
        installedAt: new Date().toISOString(),
      });
      await saveState();
      return instance;
    } catch (error) {
      const cancelled =
        controller.signal.aborted || error?.name === "AbortError";
      instanceUpdate(instance, {
        status: cancelled
          ? instance.resolvedVersionId
            ? "ready"
            : "setup"
          : "error",
        installProgress: 0,
        installMessage: cancelled ? "Установка отменена" : null,
        lastError:
          cancelled
            ? null
            : error instanceof Error
              ? error.message
              : "Ошибка установки",
      });
      await saveState();
      throw error;
    } finally {
      installLocks.delete(instance.id);
      installControllers.delete(instance.id);
    }
  })();
  installLocks.set(instance.id, promise);
  return promise;
}

function selectModFile(version) {
  return (
    version?.files?.find(
      (item) =>
        item.primary &&
        item.filename.endsWith(".jar") &&
        !/(?:sources|javadoc|dev)\.jar$/i.test(item.filename),
    ) ||
    version?.files?.find(
      (item) =>
        item.filename.endsWith(".jar") &&
        !/(?:sources|javadoc|dev)\.jar$/i.test(item.filename),
    ) ||
    null
  );
}

async function dependencyVersion(dependency, profile, signal) {
  if (dependency.version_id) {
    return fetchJson(
      `https://api.modrinth.com/v2/version/${encodeURIComponent(
        dependency.version_id,
      )}`,
      { signal },
    );
  }
  if (!dependency.project_id) return null;
  const facets = [
    `game_versions=${encodeURIComponent(
      JSON.stringify([profile.minecraftVersion]),
    )}`,
    `loaders=${encodeURIComponent(JSON.stringify([profile.loader]))}`,
  ].join("&");
  const versions = await fetchJson(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(
      dependency.project_id,
    )}/version?${facets}`,
    { signal },
  );
  return (
    versions.find((item) => item.version_type === "release") ||
    versions[0] ||
    null
  );
}

async function resolveRequiredModVersions(rootVersion, profile, signal) {
  const resolved = [];
  const queue = [rootVersion];
  const seen = new Set();
  while (queue.length) {
    signal?.throwIfAborted();
    const version = queue.shift();
    if (!version?.id || seen.has(version.id)) continue;
    seen.add(version.id);
    resolved.push(version);
    if (resolved.length > 64) {
      throw new Error("Слишком длинная цепочка зависимостей мода");
    }
    for (const dependency of version.dependencies || []) {
      if (dependency.dependency_type !== "required") continue;
      const next = await dependencyVersion(dependency, profile, signal);
      if (next && !seen.has(next.id)) queue.push(next);
    }
  }
  return resolved;
}

async function installModToInstance(project, targetInstance, task, signal) {
  const profile = loaderInfo(targetInstance);
  if (profile.loader === "vanilla" || profile.loader === "без") {
    throw new Error(
      "Для JAR-модов нужен Fabric, Quilt, Forge или NeoForge инстанс",
    );
  }
  const loaderFacet =
    profile.loader === "vanilla" ? null : profile.loader.toLowerCase();
  const facets = [
    `game_versions=${encodeURIComponent(
      JSON.stringify([profile.minecraftVersion]),
    )}`,
    loaderFacet
      ? `loaders=${encodeURIComponent(JSON.stringify([loaderFacet]))}`
      : "",
  ]
    .filter(Boolean)
    .join("&");
  const versions = await fetchJson(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(
      project.project_id,
    )}/version?${facets}`,
    { signal },
  );
  const version =
    versions.find((item) => item.version_type === "release") || versions[0];
  if (!version) {
    throw new Error(
      `Нет версии мода для Minecraft ${profile.minecraftVersion} и ${profile.loader}`,
    );
  }
  const resolvedVersions = await resolveRequiredModVersions(
    version,
    profile,
    signal,
  );
  const modsDirectory = path.join(
    state.settings.gameDirectory,
    targetInstance.id,
    "mods",
  );
  const installed = [];
  for (let index = 0; index < resolvedVersions.length; index += 1) {
    const currentVersion = resolvedVersions[index];
    const file = selectModFile(currentVersion);
    if (!file) {
      if (currentVersion.id === version.id) {
        throw new Error("В версии проекта не найден JAR-файл");
      }
      continue;
    }
    const destination = path.join(
      modsDirectory,
      file.filename.replace(/[^a-zA-Z0-9._+()-]/g, "_"),
    );
    const result = await downloadFile({
      url: safeModrinthDownload(file.url),
      destination,
      sha1: file.hashes?.sha1,
      sha512: file.hashes?.sha512,
      size: file.size,
      signal,
      onProgress: ({ received, total }) => {
        const fileProgress = total ? received / total : 0.05;
        taskUpdate(task, {
          status: "downloading",
          progress: Math.round(
            ((index + fileProgress) / resolvedVersions.length) * 100,
          ),
          received,
          total,
          subtitle:
            index === 0
              ? `${targetInstance.name} · ${version.name}`
              : `Зависимость ${index}/${resolvedVersions.length - 1}: ${currentVersion.name}`,
        });
      },
    });
    installed.push({
      destination,
      version: currentVersion,
      cached: result.cached,
    });
  }
  return {
    destination: installed[0]?.destination,
    version,
    installed,
    dependencies: Math.max(0, installed.length - 1),
  };
}

function findInstance(id) {
  const instance = state.instances.find((item) => item.id === id);
  if (!instance) throw new Error("Инстанс не найден");
  return instance;
}

async function listInstanceContent(id, kind = "mods") {
  const instance = findInstance(id);
  const folders = {
    mods: { directory: "mods", extension: ".jar" },
    resourcepacks: { directory: "resourcepacks", extension: ".zip" },
    shaderpacks: { directory: "shaderpacks", extension: ".zip" },
  };
  const selected = folders[kind] || folders.mods;
  const contentDirectory = path.join(
    state.settings.gameDirectory,
    instance.id,
    selected.directory,
  );
  try {
    const entries = await fsp.readdir(contentDirectory, {
      withFileTypes: true,
    });
    const content = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            (entry.name.toLowerCase().endsWith(selected.extension) ||
              entry.name
                .toLowerCase()
                .endsWith(`${selected.extension}.disabled`)),
        )
        .map(async (entry) => {
          const filePath = path.join(contentDirectory, entry.name);
          const stat = await fsp.stat(filePath);
          return {
            name: entry.name.replace(/\.disabled$/, ""),
            path: filePath,
            enabled: !entry.name.endsWith(".disabled"),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            kind,
          };
        }),
    );
    if (kind === "mods" && instance.modCount !== content.length) {
      instance.modCount = content.length;
      await saveState();
      send("instance:updated", structuredClone(instance));
    }
    return content.sort((left, right) =>
      left.name.localeCompare(right.name, "ru"),
    );
  } catch {
    return [];
  }
}

async function diskSpace(targetPath) {
  try {
    await fsp.mkdir(targetPath, { recursive: true });
    const stats = await fsp.statfs(targetPath);
    return {
      total: Number(stats.blocks) * Number(stats.bsize),
      free: Number(stats.bavail) * Number(stats.bsize),
    };
  } catch {
    return { total: 0, free: 0 };
  }
}

async function endpointHealth(name, url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": `OnyxLauncher/${ONYX_VERSION} diagnostics`,
      },
      signal: AbortSignal.timeout(6_000),
    });
    return {
      name,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Ошибка сети",
    };
  }
}

async function buildDiagnostics() {
  const [instances, data, disk, java, endpoints] = await Promise.all([
    directoryStats(state.settings.gameDirectory),
    directoryStats(onyxRoot()),
    diskSpace(state.settings.gameDirectory),
    state.settings.javaPath
      ? inspectJava(state.settings.javaPath)
      : findSystemJava(),
    Promise.all([
      endpointHealth(
        "Mojang",
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
      ),
      endpointHealth(
        "Modrinth",
        "https://api.modrinth.com/v2/tag/game_version",
      ),
      endpointHealth(
        "Microsoft",
        "https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration",
      ),
    ]),
  ]);
  const processMetrics = app.getAppMetrics();
  const processMemoryByType = Object.values(
    processMetrics.reduce((groups, metric) => {
      const type = metric.type || "Unknown";
      const bytes = Number(metric.memory?.workingSetSize || 0) * 1024;
      groups[type] ||= { type, bytes: 0, processes: 0 };
      groups[type].bytes += bytes;
      groups[type].processes += 1;
      return groups;
    }, {}),
  ).sort((left, right) => right.bytes - left.bytes);
  return {
    generatedAt: new Date().toISOString(),
    launcher: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      processMemory: {
        workingSet: processMemoryByType.reduce(
          (total, item) => total + item.bytes,
          0,
        ),
        processes: processMetrics.length,
        byType: processMemoryByType,
      },
    },
    system: {
      platform: process.platform,
      release: os.release(),
      architecture: process.arch,
      cpu: os.cpus()[0]?.model || "Неизвестно",
      cpuThreads: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
    },
    storage: {
      disk,
      instances,
      data,
      gameDirectory: state.settings.gameDirectory,
      dataDirectory: onyxRoot(),
    },
    java: java || null,
    profile: {
      kind: state.profile.kind,
      name: state.profile.name,
    },
    counts: {
      instances: state.instances.length,
      downloads: state.downloads.length,
      running: runningGames.size,
    },
    endpoints,
  };
}

async function clearInstallerCache() {
  const packsRoot = path.join(onyxRoot(), "packs");
  const before = await directoryStats(packsRoot);
  await fsp.rm(packsRoot, { recursive: true, force: true });
  await fsp.mkdir(packsRoot, { recursive: true });
  const [sharedParts, instanceParts] = await Promise.all([
    removePartialFiles(path.join(onyxRoot(), "shared")),
    removePartialFiles(state.settings.gameDirectory),
  ]);
  return {
    bytes: before.bytes + sharedParts.bytes + instanceParts.bytes,
    files: before.files + sharedParts.files + instanceParts.files,
  };
}

function registerIpc() {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle("state:get", () => serializeState());
  ipcMain.handle("state:update-settings", async (_event, settings) => {
    if (
      typeof settings?.gameDirectory === "string" &&
      settings.gameDirectory !== state.settings.gameDirectory
    ) {
      throw new Error(
        "Папка инстансов изменяется через безопасный перенос данных",
      );
    }
    state.settings = {
      ...state.settings,
      ...sanitizeSettingsPatch(settings),
    };
    await saveState();
    return structuredClone(state.settings);
  });
  ipcMain.handle("state:move-game-directory", async (_event, targetPath) => {
    if (runningGames.size || installControllers.size) {
      throw new Error("Сначала завершите игры и активные установки");
    }
    const sourceRoot = path.resolve(state.settings.gameDirectory);
    const destinationRoot = path.resolve(String(targetPath || ""));
    if (!destinationRoot || destinationRoot === sourceRoot) {
      return {
        settings: structuredClone(state.settings),
        copied: 0,
        oldDirectory: sourceRoot,
        newDirectory: sourceRoot,
        sourceRetained: true,
      };
    }
    if (destinationRoot.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error("Новая папка не может находиться внутри текущей");
    }
    await fsp.mkdir(destinationRoot, { recursive: true });
    for (const instance of state.instances) {
      const destination = path.join(destinationRoot, instance.id);
      const existing = await fsp.stat(destination).catch(() => null);
      if (existing) {
        throw new Error(
          `В новой папке уже есть данные инстанса ${instance.name}`,
        );
      }
    }
    let copied = 0;
    const copiedPaths = [];
    try {
      for (const instance of state.instances) {
        const source = path.join(sourceRoot, instance.id);
        const exists = await fsp.stat(source).catch(() => null);
        if (!exists?.isDirectory()) continue;
        send("maintenance:progress", {
          instanceId: instance.id,
          operation: "move",
          progress: Math.round(
            (copied / Math.max(state.instances.length, 1)) * 100,
          ),
          message: `Переношу ${instance.name}…`,
        });
        const destination = path.join(destinationRoot, instance.id);
        copiedPaths.push(destination);
        await fsp.cp(source, destination, {
          recursive: true,
          errorOnExist: true,
        });
        copied += 1;
      }
    } catch (error) {
      await Promise.all(
        copiedPaths.map((destination) =>
          fsp.rm(destination, { recursive: true, force: true }),
        ),
      );
      throw error;
    }
    state.settings.gameDirectory = destinationRoot;
    await saveState();
    send("maintenance:progress", {
      operation: "move",
      progress: 100,
      message: "Инстансы перенесены",
      done: true,
    });
    return {
      settings: structuredClone(state.settings),
      copied,
      oldDirectory: sourceRoot,
      newDirectory: destinationRoot,
      sourceRetained: true,
    };
  });
  ipcMain.handle("instance:create", async (_event, input) => {
    const instance = {
      id: crypto.randomUUID(),
      name: String(input.name || "Новая сборка").slice(0, 48),
      version: String(input.version || "1.21.1"),
      loader: String(input.loader || "Fabric"),
      description: String(input.description || "Пользовательский инстанс"),
      color: input.color || "lime",
      glyph: String(input.name || "NX").slice(0, 2).toUpperCase(),
      favorite: false,
      status: "setup",
      lastPlayed: "Ещё не запускался",
      playtimeMinutes: 0,
      modCount: 0,
    };
    state.instances.unshift(instance);
    await saveState();
    return structuredClone(instance);
  });
  ipcMain.handle("instance:delete", async (_event, id) => {
    if (runningGames.has(id)) throw new Error("Сначала завершите игру");
    const instance = state.instances.find((item) => item.id === id);
    if (!instance) return false;
    const directory = path.join(state.settings.gameDirectory, id);
    try {
      await shell.trashItem(directory);
    } catch {
      // The directory may not exist yet.
    }
    state.instances = state.instances.filter((item) => item.id !== id);
    instanceStorageCache.delete(id);
    await saveState();
    return true;
  });
  ipcMain.handle("instance:favorite", async (_event, id) => {
    const instance = state.instances.find((item) => item.id === id);
    if (!instance) return null;
    instance.favorite = !instance.favorite;
    await saveState();
    return structuredClone(instance);
  });
  ipcMain.handle("instance:update", async (_event, id, patch) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Сначала завершите игру");
    if (typeof patch?.name === "string") {
      const name = patch.name.trim().slice(0, 48);
      if (!name) throw new Error("Название инстанса не может быть пустым");
      instance.name = name;
      instance.glyph = name.slice(0, 2).toUpperCase();
    }
    if (typeof patch?.description === "string") {
      instance.description = patch.description.trim().slice(0, 180);
    }
    if (
      typeof patch?.color === "string" &&
      ["lime", "amber", "violet", "cyan", "rose"].includes(patch.color)
    ) {
      instance.color = patch.color;
    }
    if (patch?.settings && typeof patch.settings === "object") {
      const current = instance.settings || {};
      const next = { ...current };
      if (Number.isFinite(patch.settings.memory)) {
        next.memory = Math.max(
          2,
          Math.min(64, Math.round(patch.settings.memory)),
        );
      }
      if (Number.isFinite(patch.settings.windowWidth)) {
        next.windowWidth = Math.max(
          640,
          Math.min(7680, Math.round(patch.settings.windowWidth)),
        );
      }
      if (Number.isFinite(patch.settings.windowHeight)) {
        next.windowHeight = Math.max(
          480,
          Math.min(4320, Math.round(patch.settings.windowHeight)),
        );
      }
      if (typeof patch.settings.fullscreen === "boolean") {
        next.fullscreen = patch.settings.fullscreen;
      }
      if (typeof patch.settings.recordFps === "boolean") {
        next.recordFps = patch.settings.recordFps;
      }
      if (
        typeof patch.settings.performanceBaselineSessionId === "string"
      ) {
        const sessionId = patch.settings.performanceBaselineSessionId
          .trim()
          .slice(0, 80);
        next.performanceBaselineSessionId =
          /^[a-zA-Z0-9_-]{0,80}$/.test(sessionId) ? sessionId : "";
      }
      if (typeof patch.settings.javaPath === "string") {
        next.javaPath = patch.settings.javaPath.trim().slice(0, 1024);
      }
      if (Array.isArray(patch.settings.jvmArguments)) {
        next.jvmArguments = patch.settings.jvmArguments
          .filter((argument) => typeof argument === "string")
          .map((argument) => argument.trim().slice(0, 180))
          .filter(Boolean)
          .slice(0, 24);
      }
      if (typeof patch.settings.serverAddress === "string") {
        const quickJoin = parseServerAddress(patch.settings.serverAddress);
        next.serverAddress = quickJoin?.address || "";
      }
      if (Array.isArray(patch.settings.servers)) {
        const ids = new Set();
        next.servers = patch.settings.servers
          .filter((server) => server && typeof server === "object")
          .map((server) => {
            const quickJoin = parseServerAddress(server.address);
            if (!quickJoin) return null;
            let id =
              typeof server.id === "string" &&
              /^[a-zA-Z0-9_-]{1,64}$/.test(server.id)
                ? server.id
                : crypto.randomUUID();
            while (ids.has(id)) id = crypto.randomUUID();
            ids.add(id);
            const name =
              typeof server.name === "string"
                ? server.name.trim().slice(0, 48)
                : "";
            return {
              id,
              name: name || quickJoin.address,
              address: quickJoin.address,
              createdAt:
                typeof server.createdAt === "string" &&
                !Number.isNaN(Date.parse(server.createdAt))
                  ? server.createdAt
                  : new Date().toISOString(),
            };
          })
          .filter(Boolean)
          .slice(0, 24);
        if (
          typeof patch.settings.selectedServerId !== "string" ||
          !next.servers.some(
            (server) => server.id === patch.settings.selectedServerId,
          )
        ) {
          next.selectedServerId = next.servers[0]?.id || "";
        }
      }
      if (
        typeof patch.settings.selectedServerId === "string" &&
        Array.isArray(next.servers) &&
        next.servers.some(
          (server) => server.id === patch.settings.selectedServerId,
        )
      ) {
        next.selectedServerId = patch.settings.selectedServerId;
      }
      instance.settings = next;
    }
    await saveState();
    send("instance:updated", structuredClone(instance));
    return structuredClone(instance);
  });
  ipcMain.handle("instance:duplicate", async (_event, id) => {
    const source = state.instances.find((item) => item.id === id);
    if (!source) throw new Error("Инстанс не найден");
    const duplicate = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name} — копия`,
      favorite: false,
      status: source.resolvedVersionId ? "ready" : "setup",
      lastPlayed: "Ещё не запускался",
      playtimeMinutes: 0,
    };
    const sourceDirectory = path.join(state.settings.gameDirectory, id);
    const destination = path.join(
      state.settings.gameDirectory,
      duplicate.id,
    );
    try {
      await fsp.cp(sourceDirectory, destination, {
        recursive: true,
        errorOnExist: true,
      });
    } catch {
      await fsp.mkdir(destination, { recursive: true });
    }
    state.instances.unshift(duplicate);
    await saveState();
    return structuredClone(duplicate);
  });
  ipcMain.handle("instance:open-folder", async (_event, id) => {
    const directory = path.join(state.settings.gameDirectory, id);
    await fsp.mkdir(directory, { recursive: true });
    return shell.openPath(directory);
  });
  ipcMain.handle("instance:storage-analyze", async (_event, id, force) => {
    findInstance(id);
    const cached = instanceStorageCache.get(id);
    if (
      !force &&
      cached &&
      Date.now() - cached.createdAt < 30_000
    ) {
      return structuredClone(cached.report);
    }
    const report = await analyzeInstanceStorage({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
    instanceStorageCache.set(id, {
      createdAt: Date.now(),
      report,
    });
    return report;
  });
  ipcMain.handle("instance:storage-cleanup", async (_event, id) => {
    findInstance(id);
    if (runningGames.has(id) || installControllers.has(id)) {
      throw new Error("Сначала завершите игру или установку");
    }
    const result = await cleanupInstanceStorage({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
    instanceStorageCache.set(id, {
      createdAt: Date.now(),
      report: result.report,
    });
    return result;
  });
  ipcMain.handle("instance:list-content", (_event, id, kind) =>
    listInstanceContent(id, kind),
  );
  ipcMain.handle("instance:check-content-updates", async (_event, id) => {
    const instance = findInstance(id);
    const profile = loaderInfo(instance);
    const items = await listInstanceContent(id);
    return checkModUpdates({
      items,
      loader: profile.loader,
      minecraftVersion: profile.minecraftVersion,
    });
  });
  ipcMain.handle(
    "instance:update-content",
    async (_event, id, filePath) => {
      const instance = findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите игру");
      }
      await createWorldSnapshot({
        instancesRoot: state.settings.gameDirectory,
        worldGuardRoot: path.join(onyxRoot(), "world-guard"),
        instanceId: id,
        reason: "mod-update",
      });
      const profile = loaderInfo(instance);
      const result = await updateMod({
        instancesRoot: state.settings.gameDirectory,
        filePath,
        loader: profile.loader,
        minecraftVersion: profile.minecraftVersion,
        onProgress: ({ received, total }) =>
          send("content:update-progress", {
            instanceId: id,
            path: filePath,
            received,
            total,
            progress: total ? Math.round((received / total) * 100) : 5,
          }),
      });
      if (result.updated) {
        send("content:update-progress", {
          instanceId: id,
          path: filePath,
          progress: 100,
          done: true,
        });
      }
      return result;
    },
  );
  ipcMain.handle("instance:list-content-history", (_event, id) => {
    findInstance(id);
    return listModHistory({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle("instance:mod-profiles-list", (_event, id) => {
    findInstance(id);
    return listModProfiles({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle(
    "instance:mod-profile-save",
    async (_event, id, name, profileId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите игру");
      }
      const bisect = await readBisectSession({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
      });
      if (bisect) {
        throw new Error("Сначала завершите или отмените Crash Bisect");
      }
      return saveModProfile({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        name,
        profileId,
      });
    },
  );
  ipcMain.handle(
    "instance:mod-profile-apply",
    async (_event, id, profileId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите игру");
      }
      const bisect = await readBisectSession({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
      });
      if (bisect) {
        throw new Error("Сначала завершите или отмените Crash Bisect");
      }
      const result = await applyModProfile({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        profileId,
      });
      await listInstanceContent(id, "mods");
      return result;
    },
  );
  ipcMain.handle(
    "instance:mod-profile-delete",
    async (_event, id, profileId) => {
      findInstance(id);
      return deleteModProfile({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        profileId,
      });
    },
  );
  ipcMain.handle(
    "instance:rollback-content",
    async (_event, id, transactionId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите игру");
      }
      return rollbackModUpdate({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        transactionId,
      });
    },
  );
  ipcMain.handle(
    "instance:disable-suspects",
    async (_event, id, names) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите игру");
      }
      return disableSuspectMods({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        names,
      });
    },
  );
  ipcMain.handle("instance:bisect-get", (_event, id) => {
    findInstance(id);
    return readBisectSession({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle("instance:bisect-start", async (_event, id, names) => {
    findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Сначала завершите игру");
    }
    return startBisect({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
      names,
    });
  });
  ipcMain.handle(
    "instance:bisect-report",
    async (_event, id, gameStarted) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите тестовый запуск");
      }
      return reportBisectResult({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        gameStarted: Boolean(gameStarted),
      });
    },
  );
  ipcMain.handle("instance:bisect-cancel", async (_event, id) => {
    findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Сначала завершите тестовый запуск");
    }
    return cancelBisect({
      instancesRoot: state.settings.gameDirectory,
      instanceId: id,
    });
  });
  ipcMain.handle(
    "instance:bisect-finish",
    async (_event, id, disableCulprit) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите игру");
      }
      return finishBisect({
        instancesRoot: state.settings.gameDirectory,
        instanceId: id,
        disableCulprit: Boolean(disableCulprit),
      });
    },
  );
  ipcMain.handle("instance:world-snapshots", (_event, id) => {
    findInstance(id);
    return listWorldSnapshots({
      worldGuardRoot: path.join(onyxRoot(), "world-guard"),
      instanceId: id,
    });
  });
  ipcMain.handle("instance:world-snapshot-create", async (_event, id) => {
    findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Сначала завершите игру, чтобы снимок был целостным");
    }
    return createWorldSnapshot({
      instancesRoot: state.settings.gameDirectory,
      worldGuardRoot: path.join(onyxRoot(), "world-guard"),
      instanceId: id,
      reason: "manual",
      onProgress: (progress) =>
        send("maintenance:progress", {
          instanceId: id,
          kind: "world-snapshot",
          ...progress,
        }),
    });
  });
  ipcMain.handle(
    "instance:world-snapshot-restore",
    async (_event, id, snapshotId) => {
      findInstance(id);
      if (runningGames.has(id)) {
        throw new Error("Сначала завершите игру");
      }
      return restoreWorldSnapshot({
        instancesRoot: state.settings.gameDirectory,
        worldGuardRoot: path.join(onyxRoot(), "world-guard"),
        instanceId: id,
        snapshotId,
        onProgress: (progress) =>
          send("maintenance:progress", {
            instanceId: id,
            kind: "world-restore",
            ...progress,
          }),
      });
    },
  );
  ipcMain.handle("instance:toggle-content", async (_event, filePath) => {
    const instancesRoot = path.resolve(state.settings.gameDirectory);
    const source = path.resolve(filePath);
    if (!source.startsWith(`${instancesRoot}${path.sep}`)) {
      throw new Error("Файл находится вне папки инстансов");
    }
    const destination = source.endsWith(".disabled")
      ? source.replace(/\.disabled$/, "")
      : `${source}.disabled`;
    await fsp.rename(source, destination);
    return destination;
  });
  ipcMain.handle("instance:delete-content", async (_event, filePath) => {
    const instancesRoot = path.resolve(state.settings.gameDirectory);
    const target = path.resolve(filePath);
    if (!target.startsWith(`${instancesRoot}${path.sep}`)) {
      throw new Error("Файл находится вне папки инстансов");
    }
    await shell.trashItem(target);
    return true;
  });
  ipcMain.handle("instance:repair", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Сначала завершите игру");
    await runInstall(instance);
    return structuredClone(instance);
  });
  ipcMain.handle("instance:check-updates", async () => {
    const { modpackService } = createServices();
    const candidates = state.instances.filter(
      (instance) => instance.sourceProjectId && !runningGames.has(instance.id),
    );
    await Promise.allSettled(
      candidates.map(async (instance) => {
        const updateAvailable =
          await modpackService.checkProjectUpdate(instance);
        instance.updateAvailable = updateAvailable;
        send("instance:updated", structuredClone(instance));
      }),
    );
    await saveState();
    return candidates.map((instance) => structuredClone(instance));
  });
  ipcMain.handle("instance:update-preview", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Сначала завершите игру");
    }
    const { modpackService } = createServices();
    return modpackService.previewProjectUpdate({
      instance,
      onProgress: ({ received, total }) =>
        send("content:update-progress", {
          instanceId: id,
          path: "pack-preview",
          received,
          total,
          progress: total ? Math.round((received / total) * 100) : 5,
        }),
    });
  });
  ipcMain.handle("instance:update-pack", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Сначала завершите игру");
    if (!instance.sourceProjectId) {
      throw new Error("Инстанс не связан с проектом Modrinth");
    }
    const originalStatus = instance.resolvedVersionId ? "ready" : "setup";
    const controller = new AbortController();
    installControllers.set(id, controller);
    instanceUpdate(instance, {
      status: "installing",
      installProgress: 1,
      installMessage: "Создаю точку восстановления…",
    });
    await saveState();
    try {
      const backupsRoot = path.join(onyxRoot(), "backups", instance.id);
      const backupPath = path.join(
        backupsRoot,
        `${new Date().toISOString().replace(/[:.]/g, "-")}.onyxpack`,
      );
      await createInstanceBackup({
        instance,
        instancesRoot: state.settings.gameDirectory,
        destination: backupPath,
        onProgress: (progress) =>
          send("launcher:progress", {
            instanceId: id,
            stage: "backup",
            progress: Math.max(1, Math.round(progress.progress * 0.1)),
            message: "Создаю точку восстановления перед обновлением…",
          }),
      });
      const automaticBackups = (
        await fsp.readdir(backupsRoot, { withFileTypes: true })
      )
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".onyxpack"),
        )
        .map((entry) => entry.name)
        .sort()
        .reverse();
      await Promise.all(
        automaticBackups
          .slice(5)
          .map((name) =>
            fsp.rm(path.join(backupsRoot, name), { force: true }),
          ),
      );
      const { modpackService } = createServices();
      const result = await modpackService.updateProject({
        instance,
        settings: effectiveSettings(instance),
        signal: controller.signal,
        onProgress: (progress) => {
          const adjusted = 10 + Math.round((progress.progress || 0) * 0.9);
          instanceUpdate(instance, {
            status: "installing",
            installProgress: adjusted,
            installMessage: progress.message,
          });
          send("launcher:progress", {
            instanceId: id,
            ...progress,
            progress: adjusted,
          });
        },
      });
      Object.assign(instance, result.instance, {
        status: "ready",
        installProgress: 100,
        installMessage: "Сборка обновлена",
        lastError: null,
      });
      await saveState();
      send("instance:updated", structuredClone(instance));
      return {
        updated: result.updated,
        instance: structuredClone(instance),
        backupPath,
        obsoleteFiles: result.obsoleteFiles || 0,
        versionNumber: result.release?.version_number || null,
      };
    } catch (error) {
      const cancelled =
        controller.signal.aborted || error?.name === "AbortError";
      instanceUpdate(instance, {
        status: originalStatus,
        installProgress: 0,
        installMessage: cancelled ? "Обновление отменено" : null,
        lastError:
          cancelled
            ? null
            : error instanceof Error
              ? error.message
              : "Ошибка обновления сборки",
      });
      await saveState();
      throw error;
    } finally {
      installControllers.delete(id);
    }
  });
  ipcMain.handle("instance:backup", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) throw new Error("Сначала завершите игру");
    const safeName =
      instance.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() ||
      "Onyx instance";
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Резервная копия — ${instance.name}`,
      defaultPath: path.join(
        app.getPath("documents"),
        `${safeName}-${date}.onyxpack`,
      ),
      filters: [{ name: "Резервная копия Onyx", extensions: ["onyxpack"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const backup = await createInstanceBackup({
      instance,
      instancesRoot: state.settings.gameDirectory,
      destination: result.filePath,
      onProgress: (progress) =>
        send("maintenance:progress", {
          instanceId: id,
          operation: "backup",
          message: `Создаю резервную копию ${instance.name}`,
          ...progress,
        }),
    });
    send("maintenance:progress", {
      instanceId: id,
      operation: "backup",
      message: "Резервная копия готова",
      progress: 100,
      done: true,
    });
    return backup;
  });
  ipcMain.handle("instance:import-backup", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Импорт резервной копии Onyx",
      filters: [
        { name: "Резервная копия Onyx", extensions: ["onyxpack"] },
        { name: "ZIP-архив", extensions: ["zip"] },
      ],
    });
    if (result.canceled) return null;
    const backupPath = result.filePaths[0];
    const instance = await importInstanceBackup({
      backupPath,
      instancesRoot: state.settings.gameDirectory,
      onProgress: (progress) =>
        send("maintenance:progress", {
          operation: "import",
          message: `Импортирую ${path.basename(backupPath)}`,
          ...progress,
        }),
    });
    state.instances.unshift(instance);
    const content = await listInstanceContent(instance.id).catch(() => []);
    instance.modCount = content.length;
    await saveState();
    send("instance:updated", structuredClone(instance));
    send("maintenance:progress", {
      instanceId: instance.id,
      operation: "import",
      message: "Инстанс импортирован",
      progress: 100,
      done: true,
    });
    return structuredClone(instance);
  });
  ipcMain.handle("instance:sync-export", async (_event, id) => {
    const instance = findInstance(id);
    if (runningGames.has(id)) {
      throw new Error("Сначала завершите игру");
    }
    const items = await listInstanceContent(id, "mods");
    const mods = await identifySyncMods(items);
    const profile = createSyncProfile({ instance, mods });
    const safeName =
      instance.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() ||
      "Onyx profile";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Onyx Sync — ${instance.name}`,
      defaultPath: path.join(
        app.getPath("documents"),
        `${safeName}.onyxprofile`,
      ),
      filters: [
        { name: "Профиль Onyx Sync", extensions: ["onyxprofile"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(
      result.filePath,
      JSON.stringify(profile, null, 2),
      "utf8",
    );
    return {
      path: result.filePath,
      total: profile.mods.length,
      recognized: profile.mods.filter((mod) => mod.versionId).length,
    };
  });
  ipcMain.handle("instance:sync-import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Импорт профиля Onyx Sync",
      filters: [
        { name: "Профиль Onyx Sync", extensions: ["onyxprofile"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const profilePath = result.filePaths[0];
    const stats = await fsp.stat(profilePath);
    if (stats.size > 5 * 1024 * 1024) {
      throw new Error("Профиль Onyx Sync слишком большой");
    }
    const profile = validateSyncProfile(
      JSON.parse(await fsp.readFile(profilePath, "utf8")),
    );
    const id = crypto.randomUUID();
    const source = profile.instance;
    const instance = {
      id,
      name: source.name,
      version: source.version,
      loader: source.loader,
      description: source.description,
      color: source.color,
      glyph: source.glyph,
      iconUrl: source.iconUrl,
      installProfile: source.installProfile || undefined,
      settings: source.settings,
      favorite: false,
      status: "setup",
      lastPlayed: "Ещё не запускался",
      playtimeMinutes: 0,
      modCount: 0,
      importedAt: new Date().toISOString(),
      syncSource: path.basename(profilePath),
    };
    state.instances.unshift(instance);
    await saveState();
    try {
      await runInstall(instance);
      const instanceDirectory = path.join(state.settings.gameDirectory, id);
      const installed = await installSyncMods({
        profile,
        instanceDirectory,
        onProgress: ({ completed, count, received, total, current }) =>
          send("launcher:progress", {
            instanceId: id,
            stage: "sync-mods",
            progress: total
              ? Math.round((received / total) * 100)
              : Math.round((completed / Math.max(count, 1)) * 100),
            message: `Onyx Sync: ${current}`,
          }),
      });
      instance.modCount = installed.installed;
      instance.status = "ready";
      instance.syncSkippedMods = installed.skipped;
      await preflightInstance(instance, false);
      await saveState();
      send("instance:updated", structuredClone(instance));
      return {
        instance: structuredClone(instance),
        installed: installed.installed,
        skipped: installed.skipped,
      };
    } catch (error) {
      instance.status = instance.resolvedVersionId ? "ready" : "error";
      instance.lastError =
        error instanceof Error ? error.message : "Ошибка импорта Onyx Sync";
      await saveState();
      send("instance:updated", structuredClone(instance));
      throw error;
    }
  });

  ipcMain.handle("system:choose-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Папка игровых инстансов Onyx",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("system:choose-java", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Выберите исполняемый файл Java",
      filters: [{ name: "Java", extensions: ["exe"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("system:open-path", async (_event, targetPath) => {
    if (!targetPath) return "Путь не указан";
    return shell.openPath(targetPath);
  });
  ipcMain.handle("system:java-status", async () => {
    if (state.settings.javaPath) {
      const custom = await inspectJava(state.settings.javaPath);
      if (custom) return { ...custom, source: "custom" };
    }
    const system = await findSystemJava();
    return system ? { ...system, source: "system" } : null;
  });
  ipcMain.handle("system:recommend-instance", (_event, id) =>
    recommendInstanceResources({ instance: findInstance(id) }),
  );
  ipcMain.handle("system:fps-recorder-status", () => detectFpsRecorder());
  ipcMain.handle("system:server-status", (_event, address) =>
    pingMinecraftServer(address),
  );
  ipcMain.handle("system:diagnostics", () => buildDiagnostics());
  ipcMain.handle("system:export-diagnostics", async () => {
    const diagnostics = await buildDiagnostics();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Сохранить диагностику Onyx",
      defaultPath: path.join(
        app.getPath("documents"),
        `onyx-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: "Отчёт JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(
      result.filePath,
      JSON.stringify(diagnostics, null, 2),
      "utf8",
    );
    return result.filePath;
  });
  ipcMain.handle("system:clear-cache", () => clearInstallerCache());

  ipcMain.handle("auth:start", async () => {
    const login = await authService.beginLogin();
    await shell.openExternal(
      `${login.verificationUri}?otc=${encodeURIComponent(login.userCode)}`,
    );
    return login;
  });
  ipcMain.handle("auth:wait", async (_event, sessionId) => {
    const profile = await authService.waitForLogin(sessionId, (message) =>
      send("auth:status", { sessionId, message }),
    );
    state.profile = profile;
    await saveState();
    send("auth:changed", profile);
    return profile;
  });
  ipcMain.handle("auth:cancel", (_event, sessionId) =>
    authService.cancelLogin(sessionId),
  );
  ipcMain.handle("auth:list", () => authService.listAccounts());
  ipcMain.handle("auth:switch", async (_event, accountId) => {
    const profile = await authService.switchAccount(accountId);
    state.profile = profile;
    await saveState();
    send("auth:changed", profile);
    return profile;
  });
  ipcMain.handle("auth:remove", async (_event, accountId) => {
    const next = await authService.removeAccount(accountId);
    state.profile = next || structuredClone(DEFAULT_STATE.profile);
    await saveState();
    send("auth:changed", state.profile);
    return state.profile;
  });
  ipcMain.handle("auth:sign-out", async () => {
    const next = await authService.signOut();
    state.profile = next || structuredClone(DEFAULT_STATE.profile);
    await saveState();
    send("auth:changed", state.profile);
    return state.profile;
  });

  ipcMain.handle("minecraft:versions", async () => {
    const { minecraftService } = createServices();
    return minecraftService.listVersions(state.settings.showSnapshots);
  });

  ipcMain.handle("catalog:search", async (_event, query, projectType, options = {}) => {
    const type = projectType === "mod" ? "mod" : "modpack";
    const facets = [[`project_type:${type}`]];
    if (/^[a-zA-Z0-9._+-]{1,32}$/.test(options.version || "")) {
      facets.push([`versions:${options.version}`]);
    }
    if (/^[a-zA-Z0-9_-]{1,32}$/.test(options.loader || "")) {
      facets.push([`categories:${options.loader}`]);
    }
    const indexes = new Set([
      "relevance",
      "downloads",
      "follows",
      "newest",
      "updated",
    ]);
    const selectedIndex = indexes.has(options.index)
      ? options.index
      : query
        ? "relevance"
        : "downloads";
    const params = new URLSearchParams({
      query: query || "",
      limit: "24",
      offset: String(
        Math.max(0, Math.min(10_000, Math.round(options.offset || 0))),
      ),
      index: selectedIndex,
      facets: JSON.stringify(facets),
    });
    return fetchJson(`https://api.modrinth.com/v2/search?${params.toString()}`);
  });
  ipcMain.handle("catalog:picks", () => getOnyxPicks());
  ipcMain.handle(
    "catalog:install",
    async (_event, project, targetInstanceId) => {
      const existing = state.downloads.find(
        (item) =>
          item.projectId === project.project_id &&
          ["queued", "downloading", "installing"].includes(item.status),
      );
      if (existing) return structuredClone(existing);

      const task = {
        id: crypto.randomUUID(),
        projectId: project.project_id,
        projectType: project.project_type,
        name: project.title,
        subtitle: "Подготовка установки",
        iconUrl: project.icon_url || null,
        progress: 1,
        status: "queued",
        createdAt: new Date().toISOString(),
        targetInstanceId: targetInstanceId || null,
        instanceId:
          project.project_type === "modpack" ? crypto.randomUUID() : null,
      };
      state.downloads.unshift(task);
      state.downloads = state.downloads.slice(0, 50);
      await saveState();
      taskUpdate(task, {});
      const controller = new AbortController();
      downloadControllers.set(task.id, controller);

      void (async () => {
        try {
          if (project.project_type === "mod") {
            const target =
              state.instances.find((item) => item.id === targetInstanceId) ||
              state.instances.find(
                (item) => item.favorite && item.status === "ready",
              ) ||
              state.instances.find((item) => item.status === "ready");
            if (!target) {
              throw new Error(
                "Сначала установите игровой инстанс, затем добавьте в него мод",
              );
            }
            const result = await installModToInstance(
              project,
              target,
              task,
              controller.signal,
            );
            taskUpdate(task, {
              status: "done",
              progress: 100,
              subtitle: result.dependencies
                ? `Установлено в «${target.name}» · зависимостей: ${result.dependencies}`
                : `Установлено в «${target.name}»`,
              localPath: result.destination,
            });
            const content = await listInstanceContent(target.id);
            instanceUpdate(target, {
              modCount: content.length,
            });
          } else {
            const { modpackService } = createServices();
            taskUpdate(task, {
              status: "downloading",
              subtitle: "Загрузка сборки",
            });
            const instance = await modpackService.installProject({
              project,
              settings: state.settings,
              instanceId: task.instanceId,
              onProgress: (progress) =>
                taskUpdate(task, {
                  status:
                    progress.stage === "pack" ? "downloading" : "installing",
                  progress: progress.progress,
                  subtitle: progress.message,
                  received: progress.received,
                  total: progress.total,
                }),
              signal: controller.signal,
            });
            state.instances.unshift(instance);
            taskUpdate(task, {
              status: "done",
              progress: 100,
              subtitle: "Сборка установлена и готова к игре",
              localPath: path.join(
                state.settings.gameDirectory,
                instance.id,
              ),
              instanceId: instance.id,
            });
            send("instance:updated", structuredClone(instance));
          }
          await saveState();
        } catch (error) {
          const cancelled =
            controller.signal.aborted || error?.name === "AbortError";
          taskUpdate(task, {
            status: cancelled ? "cancelled" : "error",
            error:
              cancelled
                ? "Установка отменена пользователем"
                : error instanceof Error
                  ? error.message
                  : "Неизвестная ошибка установки",
          });
          if (project.project_type === "modpack" && task.instanceId) {
            await fsp
              .rm(
                path.join(state.settings.gameDirectory, task.instanceId),
                { recursive: true, force: true },
              )
              .catch(() => undefined);
          }
          await saveState();
        } finally {
          downloadControllers.delete(task.id);
        }
      })();
      return structuredClone(task);
    },
  );
  ipcMain.handle("catalog:import-pack", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Импорт сборки Modrinth",
      filters: [
        { name: "Сборка Modrinth", extensions: ["mrpack"] },
        { name: "ZIP-архив", extensions: ["zip"] },
      ],
    });
    if (result.canceled) return null;
    const packPath = result.filePaths[0];
    const task = {
      id: crypto.randomUUID(),
      name: path.basename(packPath),
      subtitle: "Импорт локальной сборки",
      progress: 1,
      status: "installing",
      createdAt: new Date().toISOString(),
      instanceId: crypto.randomUUID(),
    };
    state.downloads.unshift(task);
    await saveState();
    taskUpdate(task, {});
    const controller = new AbortController();
    downloadControllers.set(task.id, controller);
    void (async () => {
      try {
        const { modpackService } = createServices();
        const instance = await modpackService.installPack({
          packPath,
          settings: state.settings,
          instanceId: task.instanceId,
          onProgress: (progress) =>
            taskUpdate(task, {
              status: "installing",
              progress: progress.progress,
              subtitle: progress.message,
            }),
          signal: controller.signal,
        });
        state.instances.unshift(instance);
        taskUpdate(task, {
          status: "done",
          progress: 100,
          subtitle: "Сборка импортирована",
          instanceId: instance.id,
          localPath: path.join(state.settings.gameDirectory, instance.id),
        });
        send("instance:updated", structuredClone(instance));
        await saveState();
      } catch (error) {
        const cancelled =
          controller.signal.aborted || error?.name === "AbortError";
        taskUpdate(task, {
          status: cancelled ? "cancelled" : "error",
          error:
            cancelled
              ? "Импорт отменён пользователем"
              : error instanceof Error
                ? error.message
                : "Ошибка импорта сборки",
        });
        if (task.instanceId) {
          await fsp
            .rm(
              path.join(state.settings.gameDirectory, task.instanceId),
              { recursive: true, force: true },
            )
            .catch(() => undefined);
        }
        await saveState();
      } finally {
        downloadControllers.delete(task.id);
      }
    })();
    return structuredClone(task);
  });
  ipcMain.handle("catalog:cancel", async (_event, taskId) => {
    const controller = downloadControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    const task = state.downloads.find((item) => item.id === taskId);
    if (task) {
      taskUpdate(task, {
        status: "cancelled",
        error: "Операция отменена пользователем",
      });
      await saveState();
    }
    return true;
  });
  ipcMain.handle("catalog:clear-history", async () => {
    state.downloads = state.downloads.filter((task) =>
      ["queued", "downloading", "installing"].includes(task.status),
    );
    await saveState();
    return structuredClone(state.downloads);
  });

  ipcMain.handle("launcher:preflight", async (_event, instanceId) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) throw new Error("Инстанс не найден");
    return preflightInstance(instance);
  });
  ipcMain.handle("launcher:play", async (_event, instanceId) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return { ok: false, reason: "instance-not-found" };
    if (runningGames.has(instanceId)) {
      return {
        ok: false,
        reason: "already-running",
        message: "Этот инстанс уже запущен",
      };
    }
    try {
      send("launcher:progress", {
        instanceId,
        stage: "preflight",
        progress: 1,
        message: "Проверяю инстанс перед запуском…",
      });
      const health = await preflightInstance(instance);
      if (!health.canLaunch) {
        const message = preflightBlockedMessage(health);
        instance.lastError = message;
        await saveState();
        return {
          ok: false,
          reason: `preflight-${health.blocker || "blocked"}`,
          message,
          health,
        };
      }
      if (
        health.repairNeeded ||
        !instance.resolvedVersionId ||
        instance.status !== "ready"
      ) {
        await runInstall(instance);
        await preflightInstance(instance);
      }
      const instanceDirectory = path.join(
        state.settings.gameDirectory,
        instance.id,
      );
      const [launchMods, modBaseline] = await Promise.all([
        snapshotMods(instanceDirectory),
        readModBaseline(instanceDirectory),
      ]);
      const changedMods = recentModChanges(modBaseline, launchMods);
      if (changedMods.length) {
        send("launcher:progress", {
          instanceId,
          stage: "world-guard",
          progress: 100,
          message: "World Guard сохраняет миры перед запуском с изменёнными модами…",
        });
        await createWorldSnapshot({
          instancesRoot: state.settings.gameDirectory,
          worldGuardRoot: path.join(onyxRoot(), "world-guard"),
          instanceId,
          reason: "mod-change-launch",
        });
      }
      let account = null;
      let demo = true;
      if (state.profile.kind === "microsoft") {
        send("launcher:progress", {
          instanceId,
          stage: "auth",
          progress: 100,
          message: "Обновляю сессию Microsoft…",
        });
        account = await authService.getLaunchAccount();
        if (!account) throw new Error("Войдите в Microsoft-аккаунт");
        demo = false;
      }
      const { minecraftService } = createServices();
      const startedAt = Date.now();
      const sessionId = crypto.randomUUID();
      const recorder = new FlightRecorder({
        startedAt,
        allocatedMemoryGiB: effectiveSettings(instance).memory,
        sampleIntervalMs: process.platform === "win32" ? 10_000 : 5_000,
      });
      const fpsRecorder = new FpsRecorder({
        enabled: Boolean(instance.settings?.recordFps),
        outputDirectory: path.join(
          instanceDirectory,
          ".onyx",
          "telemetry",
          sessionId,
        ),
      });
      const fpsLaunch = await fpsRecorder.prepare().catch(() => ({
        wrapper: null,
        status: null,
      }));
      const launch = await minecraftService.buildLaunch({
        instance,
        settings: effectiveSettings(instance),
        account,
        demo,
        launchWrapper: fpsLaunch.wrapper,
        onSpawn: (pid) => {
          recorder.attach(pid);
          fpsRecorder.attach(pid);
        },
        onLog: (payload) => {
          recorder.ingestLog(payload.text);
          send("launcher:log", { instanceId, ...payload });
        },
        onExit: async ({ code, logPath }) => {
          runningGames.delete(instanceId);
          const endedAt = Date.now();
          const [performance, fps] = await Promise.all([
            recorder.stop({
              exitCode: code,
              endedAt,
            }),
            fpsRecorder.stop(),
          ]);
          performance.fps = fps;
          const fpsInsights = buildFpsInsights(fps);
          if (fpsInsights.length) {
            performance.insights = [
              ...fpsInsights,
              ...performance.insights.filter(
                (insight) => insight.code !== "stable-session",
              ),
            ].slice(0, 6);
          }
          const pinnedPerformanceBaseline =
            state.sessions.find(
              (session) =>
                session.id ===
                  instance.settings?.performanceBaselineSessionId &&
                session.instanceId === instance.id &&
                session.performance?.available,
            )?.performance || null;
          const previousPerformance =
            state.sessions.find(
              (session) =>
                session.instanceId === instance.id &&
                session.performance?.available,
            )?.performance || null;
          const regressionInsights = buildRegressionInsights(
            performance,
            pinnedPerformanceBaseline || previousPerformance,
          );
          if (regressionInsights.length) {
            performance.insights = [
              ...regressionInsights,
              ...performance.insights.filter(
                (insight) => insight.code !== "stable-session",
              ),
            ].slice(0, 6);
          }
          const logContent = await fsp
            .readFile(logPath, "utf8")
            .catch(() => "");
          const diagnoses = analyzeMinecraftLog(logContent);
          if (code === 0) {
            await writeModBaseline(instanceDirectory, launchMods).catch(
              () => undefined,
            );
          } else {
            const suspects = changedMods;
            const likelyModFailure =
              diagnoses.length === 0 ||
              diagnoses.some((diagnosis) =>
                [
                  "missing-dependency",
                  "mixin-conflict",
                  "native-crash",
                  "graphics-init",
                  "corrupted-file",
                ].includes(diagnosis.code),
              );
            if (suspects.length && likelyModFailure) {
              diagnoses.unshift({
                code: "recent-mod-changes",
                severity: "warning",
                title: "Подозрение на недавно изменённые моды",
                message:
                  "После последнего успешного запуска изменились моды. Onyx может временно отключить их и повторить запуск.",
                suspects: suspects.slice(0, 12),
              });
            }
          }
          const minutes = Math.max(
            1,
            Math.round((Date.now() - startedAt) / 60_000),
          );
          const session = {
            id: sessionId,
            instanceId: instance.id,
            instanceName: instance.name,
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
            durationMinutes: minutes,
            exitCode: Number.isFinite(code) ? code : null,
            performance,
          };
          state.sessions.unshift(session);
          state.sessions = state.sessions.slice(0, 500);
          instance.playtimeMinutes =
            Number(instance.playtimeMinutes || 0) + minutes;
          instance.status = "ready";
          instance.lastExitCode = code;
          instance.lastLogPath = logPath;
          instance.lastDiagnosis = diagnoses[0] || null;
          instance.lastPerformance = performance;
          instanceUpdate(instance, {
            status: "ready",
            playtimeMinutes: instance.playtimeMinutes,
            lastExitCode: code,
            lastDiagnosis: instance.lastDiagnosis,
            lastPerformance: performance,
          });
          await saveState();
          send("session:recorded", structuredClone(session));
          if (ghostModeActive) {
            await restoreLauncherWindow();
          } else if (
            state.settings.closeOnLaunch &&
            mainWindow?.isVisible() === false
          ) {
            mainWindow.show();
          }
        },
      });
      runningGames.set(instanceId, launch);
      instanceUpdate(instance, {
        status: "running",
        lastPlayed: "Только что",
        lastLogPath: launch.logPath,
        javaPath: launch.executable,
      });
      await saveState();
      if (state.settings.ghostMode) {
        setTimeout(() => enterGhostMode(), 350);
      } else if (state.settings.closeOnLaunch) {
        mainWindow?.hide();
      }
      return {
        ok: true,
        pid: launch.child.pid,
        demo,
        message: demo
          ? "Игра запущена в официальном демо-режиме"
          : "Игра запущена",
      };
    } catch (error) {
      instanceUpdate(instance, {
        status: instance.resolvedVersionId ? "ready" : "error",
        lastError:
          error instanceof Error ? error.message : "Ошибка запуска игры",
      });
      await saveState();
      return {
        ok: false,
        reason: "launch-failed",
        message:
          error instanceof Error ? error.message : "Не удалось запустить игру",
      };
    }
  });
  ipcMain.handle("launcher:stop", async (_event, instanceId) => {
    const launch = runningGames.get(instanceId);
    if (launch) {
      launch.child.kill();
      return true;
    }
    const installation = installControllers.get(instanceId);
    if (installation) {
      installation.abort();
      return true;
    }
    return false;
  });
  ipcMain.handle("launcher:get-log", async (_event, instanceId) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    const logPath =
      runningGames.get(instanceId)?.logPath || instance?.lastLogPath;
    if (!logPath) return { path: null, content: "", analysis: [] };
    try {
      const content = await fsp.readFile(logPath, "utf8");
      const analysis = analyzeMinecraftLog(content);
      if (
        instance?.lastDiagnosis?.code === "recent-mod-changes" &&
        !analysis.some(
          (diagnosis) => diagnosis.code === "recent-mod-changes",
        )
      ) {
        analysis.unshift(instance.lastDiagnosis);
      }
      return {
        path: logPath,
        content: content.slice(-120_000),
        analysis,
      };
    } catch {
      return { path: logPath, content: "", analysis: [] };
    }
  });
  ipcMain.handle(
    "launcher:export-support-bundle",
    async (_event, instanceId) => {
      const instance = findInstance(instanceId);
      const safeName =
        String(instance.name || "instance")
          .toLowerCase()
          .replace(/[^a-zа-яё0-9]+/gi, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 42) || "instance";
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "Сохранить пакет диагностики Onyx",
        defaultPath: path.join(
          app.getPath("documents"),
          `onyx-support-${safeName}-${new Date().toISOString().slice(0, 10)}.zip`,
        ),
        filters: [{ name: "Пакет диагностики ZIP", extensions: ["zip"] }],
      });
      if (result.canceled || !result.filePath) return null;

      const logPath =
        runningGames.get(instanceId)?.logPath || instance.lastLogPath;
      const [diagnostics, logContent] = await Promise.all([
        buildDiagnostics(),
        logPath
          ? fsp.readFile(logPath, "utf8").catch(() => "")
          : Promise.resolve(""),
      ]);
      const analysis = analyzeMinecraftLog(logContent);
      if (
        instance.lastDiagnosis &&
        !analysis.some(
          (diagnosis) => diagnosis.code === instance.lastDiagnosis.code,
        )
      ) {
        analysis.unshift(instance.lastDiagnosis);
      }
      const sessions = state.sessions
        .filter((session) => session.instanceId === instanceId)
        .sort(
          (left, right) =>
            new Date(right.endedAt).getTime() -
            new Date(left.endedAt).getTime(),
        );
      return createSupportBundle({
        destination: result.filePath,
        instance,
        sessions,
        diagnostics,
        logContent,
        analysis,
      });
    },
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void restoreLauncherWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("app.onyx.launcher");
    nativeTheme.themeSource = "dark";
    await loadState();
    authService = new AuthService(app.getPath("userData"));
    javaService = new JavaService(path.join(onyxRoot(), "runtimes"));
    const storedProfile = await authService.getProfile();
    if (storedProfile) {
      state.profile = storedProfile;
      await saveState();
    } else if (state.profile.kind === "microsoft") {
      state.profile = structuredClone(DEFAULT_STATE.profile);
      await saveState();
    }
    registerIpc();
    await createWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await restoreLauncherWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (!ghostModeActive && process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  ghostModeActive = false;
  const reason = { preservePartial: true };
  for (const controller of installControllers.values()) {
    controller.abort(reason);
  }
  for (const controller of downloadControllers.values()) {
    controller.abort(reason);
  }
});

async function writeCrashLog(kind, reason) {
  const error =
    reason instanceof Error ? reason : new Error(String(reason ?? "Unknown error"));
  const logPath = path.join(app.getPath("userData"), "onyx-crash.log");
  await fsp
    .appendFile(
      logPath,
      `[${new Date().toISOString()}] ${kind}\n${error.stack || error.message}\n\n`,
      "utf8",
    )
    .catch(() => undefined);
}

process.on("uncaughtException", async (error) => {
  await writeCrashLog("uncaughtException", error);
});

process.on("unhandledRejection", async (reason) => {
  await writeCrashLog("unhandledRejection", reason);
});
