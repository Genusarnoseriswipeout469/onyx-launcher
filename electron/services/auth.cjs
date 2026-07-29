const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { safeStorage } = require("electron");
const {
  fetchJson,
  fetchJsonResponse,
  delay,
} = require("./network.cjs");

const DEFAULT_CLIENT_ID = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";
const CLIENT_ID = (
  process.env.ONYX_MICROSOFT_CLIENT_ID || DEFAULT_CLIENT_ID
).trim();
const DEVICE_CODE_ENDPOINT =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE = "XboxLive.SignIn XboxLive.offline_access";
const STORE_VERSION = 3;
const XBOX_AUTH = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN = "https://api.minecraftservices.com/launcher/login";
const MC_ENTITLEMENTS =
  "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE = "https://api.minecraftservices.com/minecraft/profile";

class AuthService {
  constructor(userDataPath) {
    this.accountPath = path.join(userDataPath, "account.json");
    this.sessions = new Map();
    this.cachedMinecraft = null;
    this.cachedAccountId = null;
    this.volatileStore = null;
  }

  encryptionAvailable() {
    try {
      if (!safeStorage?.isEncryptionAvailable?.()) return false;
      const backend = safeStorage?.getSelectedStorageBackend?.();
      return backend !== "basic_text";
    } catch {
      return false;
    }
  }

  storageStatus() {
    let backend = null;
    try {
      backend = safeStorage?.getSelectedStorageBackend?.() || null;
    } catch {
      backend = null;
    }
    const persistent = this.encryptionAvailable();
    return { persistent, encrypted: persistent, backend };
  }

  async beginLogin() {
    const { response, payload } = await fetchJsonResponse(DEVICE_CODE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPE,
      }),
    });
    if (!response.ok || !payload.device_code) {
      throw new Error(
        payload.error_description ||
          "Microsoft не выдал код для авторизации",
      );
    }
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      ...payload,
      createdAt: Date.now(),
      cancelled: false,
    });
    return {
      sessionId,
      userCode: payload.user_code,
      verificationUri:
        payload.verification_uri || "https://microsoft.com/link",
      expiresIn: payload.expires_in,
      message: payload.message,
    };
  }

  cancelLogin(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.cancelled = true;
  }

  async waitForLogin(sessionId, onStatus) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Сессия авторизации не найдена");
    const deadline = session.createdAt + session.expires_in * 1000;
    let interval = Math.max(3, session.interval || 5);

    try {
      while (Date.now() < deadline) {
        if (session.cancelled) throw new Error("Авторизация отменена");
        await delay(interval * 1000);
        onStatus?.("Ожидаю подтверждение Microsoft…");
        const { response, payload } = await fetchJsonResponse(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            device_code: session.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        if (response.ok && payload.access_token) {
          onStatus?.("Проверяю профиль Xbox…");
          const account = await this.exchangeMicrosoftToken(payload);
          await this.saveAccount({
            profile: account.profile,
            refreshToken: payload.refresh_token,
            oauthClientId: CLIENT_ID,
            signedInAt: new Date().toISOString(),
          });
          this.cachedMinecraft = account.launchAccount;
          this.cachedAccountId = account.profile.uuid;
          return account.profile;
        }
        if (payload.error === "authorization_pending") continue;
        if (payload.error === "slow_down") {
          interval += 5;
          continue;
        }
        if (payload.error === "authorization_declined") {
          throw new Error("Вход отклонён в окне Microsoft");
        }
        if (payload.error === "expired_token") {
          throw new Error("Код входа истёк — начните авторизацию заново");
        }
        throw new Error(
          payload.error_description || "Microsoft не завершил авторизацию",
        );
      }
      throw new Error("Время ожидания авторизации истекло");
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async exchangeMicrosoftToken(msToken) {
    const xbox = await this.postJson(XBOX_AUTH, {
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msToken.access_token}`,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    });

    const xsts = await this.postJson(XSTS_AUTH, {
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [xbox.Token],
      },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    });

    const userHash = xsts.DisplayClaims?.xui?.[0]?.uhs;
    if (!userHash || !xsts.Token) {
      throw new Error("Xbox не вернул данные профиля");
    }

    const minecraft = await this.postJson(
      MC_LOGIN,
      this.minecraftLoginPayload(userHash, xsts.Token),
      { xboxContract: false },
    );
    if (!minecraft.access_token) {
      throw new Error("Minecraft Services не вернул access token");
    }
    const headers = {
      Authorization: `Bearer ${minecraft.access_token}`,
    };
    const [entitlements, profile] = await Promise.all([
      fetchJson(MC_ENTITLEMENTS, { headers }),
      fetchJson(MC_PROFILE, { headers }),
    ]);
    if (!Array.isArray(entitlements.items) || entitlements.items.length === 0) {
      throw new Error(
        "На аккаунте не найдена лицензия Minecraft: Java Edition",
      );
    }
    if (!profile.id || !profile.name) {
      throw new Error("Minecraft-профиль ещё не создан");
    }
    return {
      profile: {
        name: profile.name,
        uuid: profile.id,
        kind: "microsoft",
        skins: profile.skins || [],
        avatarUrl: `https://mc-heads.net/avatar/${profile.id}/64`,
      },
      launchAccount: {
        accessToken: minecraft.access_token,
        expiresAt: Date.now() + Number(minecraft.expires_in || 86_400) * 1000,
        uuid: profile.id,
        name: profile.name,
        userType: "msa",
        xuid: minecraft.username || "",
        clientId: CLIENT_ID,
      },
    };
  }

  minecraftLoginPayload(userHash, xstsToken) {
    return {
      xtoken: `XBL3.0 x=${userHash};${xstsToken}`,
      platform: "PC_LAUNCHER",
    };
  }

  async postJson(url, body, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (options.xboxContract !== false) {
      headers["x-xbl-contract-version"] = "1";
    }
    const { response, payload } = await fetchJsonResponse(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const code = payload.XErr;
      const known = {
        2148916233: "У Microsoft-аккаунта нет профиля Xbox",
        2148916235: "Xbox Live недоступен в регионе аккаунта",
        2148916238:
          "Детскому аккаунту требуется разрешение взрослого в Microsoft Family",
      };
      const statusMessage =
        response.status === 401
          ? "Xbox отклонил токен Microsoft (401). Удалите аккаунт из Onyx и выполните вход заново"
          : `Ошибка авторизации Xbox (${response.status})`;
      throw new Error(
        known[code] ||
          payload.Message ||
          payload.errorMessage ||
          statusMessage,
      );
    }
    return payload;
  }

  async refreshMicrosoft(refreshToken) {
    const { response, payload } = await fetchJsonResponse(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPE,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_description ||
          "Сессия Microsoft истекла — войдите снова",
      );
    }
    return payload;
  }

  async getLaunchAccount() {
    const stored = await this.loadAccount();
    const accountId = stored?.profile?.uuid;
    if (
      this.cachedMinecraft &&
      this.cachedAccountId === accountId &&
      this.cachedMinecraft.expiresAt > Date.now() + 120_000
    ) {
      return this.cachedMinecraft;
    }
    if (!stored?.refreshToken) return null;
    if (!this.sameClientId(stored.oauthClientId, CLIENT_ID)) {
      throw new Error(
        "Аккаунт сохранён старой схемой Microsoft OAuth. Добавьте его заново, чтобы обновить вход",
      );
    }
    const refreshed = await this.refreshMicrosoft(stored.refreshToken);
    const account = await this.exchangeMicrosoftToken(refreshed);
    await this.saveAccount({
      profile: account.profile,
      refreshToken: refreshed.refresh_token || stored.refreshToken,
      oauthClientId: CLIENT_ID,
      signedInAt: stored.signedInAt,
    });
    this.cachedMinecraft = account.launchAccount;
    this.cachedAccountId = account.profile.uuid;
    return account.launchAccount;
  }

  async getProfile() {
    const stored = await this.loadAccount();
    return stored?.profile || null;
  }

  async saveAccount(account) {
    await fsp.mkdir(path.dirname(this.accountPath), { recursive: true });
    const store = await this.loadStore();
    const accountId = account.profile.uuid;
    const nextAccount = {
      profile: account.profile,
      refreshToken: account.refreshToken,
      oauthClientId: account.oauthClientId || CLIENT_ID,
      signedInAt: account.signedInAt,
    };
    const existingIndex = store.accounts.findIndex(
      (item) => item.profile.uuid === accountId,
    );
    if (existingIndex >= 0) store.accounts[existingIndex] = nextAccount;
    else store.accounts.push(nextAccount);
    store.activeId = accountId;
    await this.saveStore(store);
  }

  protectToken(refreshToken) {
    if (!this.encryptionAvailable()) {
      throw new Error("Системное защищённое хранилище недоступно");
    }
    return {
      encrypted: true,
      value: safeStorage.encryptString(refreshToken).toString("base64"),
    };
  }

  unprotectToken(token) {
    if (!token?.value) return null;
    return token.encrypted
      ? safeStorage.decryptString(Buffer.from(token.value, "base64"))
      : Buffer.from(token.value, "base64").toString("utf8");
  }

  sameClientId(left, right) {
    return (
      typeof left === "string" &&
      typeof right === "string" &&
      left.trim().toLowerCase() === right.trim().toLowerCase()
    );
  }

  async saveStore(store) {
    if (!this.encryptionAvailable()) {
      this.volatileStore = structuredClone({
        version: STORE_VERSION,
        activeId: store.activeId || null,
        accounts: store.accounts,
      });
      await fsp.rm(this.accountPath, { force: true }).catch(() => undefined);
      return;
    }
    this.volatileStore = null;
    const serialized = {
      version: STORE_VERSION,
      activeId: store.activeId || null,
      accounts: store.accounts.map((account) => ({
        profile: account.profile,
        refreshToken: this.protectToken(account.refreshToken),
        oauthClientId: account.oauthClientId || null,
        signedInAt: account.signedInAt,
      })),
    };
    const temporary = `${this.accountPath}.tmp`;
    await fsp.writeFile(
      temporary,
      JSON.stringify(serialized, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    await fsp.rm(this.accountPath, { force: true }).catch(() => undefined);
    await fsp.rename(temporary, this.accountPath);
  }

  async loadStore() {
    if (this.volatileStore) return structuredClone(this.volatileStore);
    try {
      const parsed = JSON.parse(await fsp.readFile(this.accountPath, "utf8"));
      const rawAccounts =
        (parsed.version === 2 || parsed.version === STORE_VERSION) &&
        Array.isArray(parsed.accounts)
          ? parsed.accounts
          : parsed.profile
            ? [parsed]
            : [];
      const accounts = [];
      for (const account of rawAccounts) {
        try {
          const refreshToken = this.unprotectToken(account.refreshToken);
          if (account.profile?.uuid && refreshToken) {
            accounts.push({
              ...account,
              refreshToken,
              oauthClientId: account.oauthClientId || null,
            });
          }
        } catch {
          // A damaged token does not invalidate the other saved accounts.
        }
      }
      const activeId =
        accounts.find((item) => item.profile.uuid === parsed.activeId)?.profile
          .uuid ||
        accounts[0]?.profile.uuid ||
        null;
      const store = { version: STORE_VERSION, activeId, accounts };
      const containsPlaintext = rawAccounts.some(
        (account) => account.refreshToken?.encrypted === false,
      );
      if (containsPlaintext && accounts.length) {
        if (this.encryptionAvailable()) await this.saveStore(store);
        else {
          this.volatileStore = structuredClone(store);
          await fsp.rm(this.accountPath, { force: true }).catch(() => undefined);
        }
      }
      return store;
    } catch {
      return { version: STORE_VERSION, activeId: null, accounts: [] };
    }
  }

  async loadAccount() {
    const store = await this.loadStore();
    return (
      store.accounts.find(
        (account) => account.profile.uuid === store.activeId,
      ) || null
    );
  }

  async listAccounts() {
    const store = await this.loadStore();
    return {
      activeId: store.activeId,
      storage: this.storageStatus(),
      profiles: store.accounts.map((account) => ({
        ...account.profile,
        signedInAt: account.signedInAt,
      })),
    };
  }

  async switchAccount(accountId) {
    const store = await this.loadStore();
    const account = store.accounts.find(
      (item) => item.profile.uuid === accountId,
    );
    if (!account) throw new Error("Сохранённый аккаунт не найден");
    store.activeId = accountId;
    await this.saveStore(store);
    this.cachedMinecraft = null;
    this.cachedAccountId = null;
    return account.profile;
  }

  async removeAccount(accountId) {
    const store = await this.loadStore();
    store.accounts = store.accounts.filter(
      (account) => account.profile.uuid !== accountId,
    );
    if (store.activeId === accountId) {
      store.activeId = store.accounts[0]?.profile.uuid || null;
    }
    this.cachedMinecraft = null;
    this.cachedAccountId = null;
    if (store.accounts.length) await this.saveStore(store);
    else {
      this.volatileStore = {
        version: STORE_VERSION,
        activeId: null,
        accounts: [],
      };
      await fsp.rm(this.accountPath, { force: true });
    }
    return (
      store.accounts.find(
        (account) => account.profile.uuid === store.activeId,
      )?.profile || null
    );
  }

  async signOut() {
    const active = await this.loadAccount();
    if (!active) return null;
    return this.removeAccount(active.profile.uuid);
  }
}

module.exports = {
  AuthService,
  CLIENT_ID,
  DEFAULT_CLIENT_ID,
  DEVICE_CODE_ENDPOINT,
  TOKEN_ENDPOINT,
  SCOPE,
  MC_LOGIN,
};
