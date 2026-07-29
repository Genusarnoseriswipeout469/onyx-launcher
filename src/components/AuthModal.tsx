import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { AuthLogin, Profile } from "../types";

interface AuthModalProps {
  open: boolean;
  profile: Profile;
  onClose: () => void;
  onChanged: (profile: Profile) => void;
}

export function AuthModal({
  open,
  profile,
  onClose,
  onChanged,
}: AuthModalProps) {
  const { t } = useI18n();
  const [login, setLogin] = useState<AuthLogin | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [accounts, setAccounts] = useState<Profile[]>([]);
  const [persistentStorage, setPersistentStorage] = useState(true);
  const [adding, setAdding] = useState(false);

  const refreshAccounts = async () => {
    const result = await window.onyx.auth.list();
    setAccounts(result.profiles);
    setPersistentStorage(result.storage.persistent);
  };

  useEffect(() => {
    return window.onyx.onAuthStatus((event) => {
      if (event.sessionId !== login?.sessionId) return;
      setStatus(
        event.message === "Ожидаю подтверждение Microsoft…"
          ? t("auth.status.waitMicrosoft")
          : event.message === "Проверяю профиль Xbox…"
            ? t("auth.status.xbox")
            : event.message,
      );
    });
  }, [login?.sessionId, t]);

  useEffect(() => {
    if (!open) {
      setError("");
      setStatus("");
      setCopied(false);
      setAdding(false);
    } else {
      void refreshAccounts();
    }
  }, [open]);

  const begin = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await window.onyx.auth.start();
      setLogin(next);
      setStatus(t("auth.status.confirm"));
      void window.onyx.auth
        .wait(next.sessionId)
        .then((nextProfile) => {
          onChanged(nextProfile);
          void refreshAccounts();
          setAdding(false);
          setStatus(t("auth.status.connected"));
          setLogin(null);
        })
        .catch((reason: unknown) => {
          setError(
            reason instanceof Error
              ? reason.message
              : t("auth.error.finish"),
          );
          setLogin(null);
        })
        .finally(() => setBusy(false));
    } catch (reason) {
      setBusy(false);
      setError(
        reason instanceof Error
          ? reason.message
          : t("auth.error.start"),
      );
    }
  };

  const close = () => {
    if (login) void window.onyx.auth.cancel(login.sessionId);
    setLogin(null);
    setBusy(false);
    onClose();
  };

  const signOut = async () => {
    setBusy(true);
    try {
      const local = await window.onyx.auth.signOut();
      onChanged(local);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async (account: Profile) => {
    if (!account.uuid || account.uuid === profile.uuid) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.onyx.auth.switch(account.uuid);
      onChanged(next);
      await refreshAccounts();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("auth.error.switch"),
      );
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (account: Profile) => {
    if (!account.uuid) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.onyx.auth.remove(account.uuid);
      onChanged(next);
      await refreshAccounts();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("auth.error.remove"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) close();
          }}
        >
          <motion.div
            className="modal auth-modal"
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
          >
            <button className="modal__close" onClick={close} aria-label={t("common.close")}>
              <X size={18} />
            </button>

            {profile.kind === "microsoft" && !adding && !login ? (
              <div className="auth-connected">
                <span className="auth-connected__avatar">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" />
                  ) : (
                    <UserRound size={30} />
                  )}
                  <i>
                    <Check size={10} />
                  </i>
                </span>
                <p className="modal__eyebrow">
                  <ShieldCheck size={14} /> {t("auth.license")}
                </p>
                <h2>{profile.name}</h2>
                <p>{t("auth.connected")}</p>
                {accounts.length > 0 && (
                  <div className="account-switcher">
                    <small>{t("auth.savedAccounts")}</small>
                    {accounts.map((account) => {
                      const active = account.uuid === profile.uuid;
                      return (
                        <div
                          className={`account-switcher__row ${active ? "is-active" : ""}`}
                          key={account.uuid}
                        >
                          <button
                            className="account-switcher__select"
                            disabled={busy || active}
                            onClick={() => void switchAccount(account)}
                          >
                            <span>
                              {account.avatarUrl ? (
                                <img src={account.avatarUrl} alt="" />
                              ) : (
                                <UserRound size={17} />
                              )}
                            </span>
                            <div>
                              <strong>{account.name}</strong>
                              <small>
                                {active ? t("auth.active") : t("auth.ready")}
                              </small>
                            </div>
                            {active && <Check size={15} />}
                          </button>
                          <button
                            className="account-switcher__remove"
                            title={t("auth.remove")}
                            disabled={busy}
                            onClick={() => void removeAccount(account)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {error && <div className="auth-error">{error}</div>}
                <div className="auth-connected__actions">
                  <button
                    className="button button--secondary"
                    onClick={() => {
                      setAdding(true);
                      void begin();
                    }}
                    disabled={busy}
                  >
                    <Plus size={15} /> {t("auth.add")}
                  </button>
                  <button className="button button--secondary" onClick={onClose}>
                    {t("common.done")}
                  </button>
                  <button
                    className="button button--danger-quiet"
                    onClick={() => void signOut()}
                    disabled={busy}
                  >
                    <LogOut size={15} /> {t("auth.signOut")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="modal__eyebrow">
                  <ShieldCheck size={14} /> {t("auth.secure")}
                </div>
                <h2>{t("auth.connect")}</h2>
                <p className="modal__subtitle">{t("auth.subtitle")}</p>

                {!login ? (
                  <div className="auth-intro">
                    <div className="auth-intro__visual">
                      <span>
                        <UserRound size={28} />
                      </span>
                      <i />
                      <span>
                        <ShieldCheck size={28} />
                      </span>
                    </div>
                    <div className="auth-benefits">
                      <span>
                        <Check size={13} /> {t("auth.benefit.license")}
                      </span>
                      <span>
                        <Check size={13} /> {t("auth.benefit.online")}
                      </span>
                      <span>
                        <Check size={13} /> {t(persistentStorage ? "auth.benefit.storage" : "auth.benefit.storageVolatile")}
                      </span>
                    </div>
                    {error && <div className="auth-error">{error}</div>}
                    <button
                      className="button button--primary auth-primary"
                      onClick={() => void begin()}
                      disabled={busy}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <ExternalLink size={16} />
                      )}
                      {t("auth.signIn")}
                    </button>
                    {adding && (
                      <button
                        className="button button--ghost auth-cancel-add"
                        onClick={() => {
                          setAdding(false);
                          setError("");
                        }}
                      >
                        {t("auth.return")}
                      </button>
                    )}
                    <small className="auth-demo-note">
                      {t("auth.demo")}
                    </small>
                  </div>
                ) : (
                  <div className="device-login">
                    <div className="device-login__pulse">
                      <span />
                      <ShieldCheck size={26} />
                    </div>
                    <p>{t("auth.code")}</p>
                    <button
                      className="device-code"
                      onClick={async () => {
                        await navigator.clipboard.writeText(login.userCode);
                        setCopied(true);
                      }}
                    >
                      {login.userCode}
                      {copied ? <Check size={17} /> : <Clipboard size={17} />}
                    </button>
                    <button
                      className="button button--secondary"
                      onClick={() =>
                        window.open(
                          `${login.verificationUri}?otc=${encodeURIComponent(
                            login.userCode,
                          )}`,
                          "_blank",
                        )
                      }
                    >
                      <ExternalLink size={15} /> {t("auth.openAgain")}
                    </button>
                    <div className="device-login__status">
                      <LoaderCircle className="spin" size={14} />
                      {status}
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
