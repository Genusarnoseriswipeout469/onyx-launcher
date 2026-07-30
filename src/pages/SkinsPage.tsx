import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type { Profile } from '../types';

type SkinPart = 'head' | 'body' | 'right-arm' | 'left-arm' | 'right-leg' | 'left-leg';

const skinParts: SkinPart[] = [
  'head',
  'body',
  'right-arm',
  'left-arm',
  'right-leg',
  'left-leg',
];

const skinFaces = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;

function SkinCuboid({ part }: { part: SkinPart }) {
  return (
    <div className={`skin-model__part skin-model__part--${part}`}>
      {skinFaces.map((face) => (
        <i className={`skin-model__face skin-model__face--${face}`} key={face} />
      ))}
    </div>
  );
}

function SkinModel({
  url,
  variant,
}: {
  url: string;
  variant?: string;
}) {
  const style = {
    '--skin-url': `url("${url}")`,
  } as CSSProperties & Record<'--skin-url', string>;

  return (
    <div
      className={`skin-model ${variant === 'slim' ? 'skin-model--slim' : ''}`}
      style={style}
      aria-hidden='true'
    >
      <div className='skin-model__scene'>
        {skinParts.map((part) => (
          <SkinCuboid part={part} key={part} />
        ))}
      </div>
    </div>
  );
}

interface SkinsPageProps {
  profile: Profile;
  onAccount: () => void;
  onNotify: (
    tone: 'success' | 'warning' | 'info',
    title: string,
    message: string,
  ) => void;
}

export function SkinsPage({ profile, onAccount, onNotify }: SkinsPageProps) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Profile[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    profile.uuid || null,
  );
  const [skinVariant, setSkinVariant] = useState<'classic' | 'slim'>('classic');
  const [skinBusy, setSkinBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const refreshedAccountIds = useRef(new Set<string>());

  useEffect(() => {
    let mounted = true;
    void window.onyx.auth.list().then((result) => {
      if (!mounted) return;
      setAccounts(result.profiles);
      setSelectedAccountId((current) =>
        result.profiles.some((account) => account.uuid === current)
          ? current
          : profile.uuid || result.profiles[0]?.uuid || null,
      );
    });
    return () => {
      mounted = false;
    };
  }, [profile.uuid]);

  useEffect(
    () =>
      window.onyx.onAuthChanged((updated) => {
        setAccounts((current) =>
          current.some((account) => account.uuid === updated.uuid)
            ? current.map((account) =>
                account.uuid === updated.uuid ? updated : account,
              )
            : current,
        );
      }),
    [],
  );

  const selectedAccount = accounts.find(
    (account) => account.uuid === selectedAccountId,
  );
  const selectedSkin =
    selectedAccount?.skins?.find((skin) => skin.state === 'ACTIVE') ||
    selectedAccount?.skins?.[0];

  useEffect(() => {
    setSkinVariant(selectedSkin?.variant === 'slim' ? 'slim' : 'classic');
  }, [selectedAccountId, selectedSkin?.id, selectedSkin?.variant]);

  useEffect(() => {
    if (
      selectedAccount?.kind !== 'microsoft' ||
      !selectedAccount.uuid ||
      refreshedAccountIds.current.has(selectedAccount.uuid)
    ) {
      return;
    }
    refreshedAccountIds.current.add(selectedAccount.uuid);
    let mounted = true;
    setProfileBusy(true);
    void window.onyx.auth
      .refreshProfile(selectedAccount.uuid)
      .then((updated) => {
        if (!mounted) return;
        setAccounts((current) =>
          current.map((account) =>
            account.uuid === updated.uuid ? updated : account,
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setProfileBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedAccount?.kind, selectedAccount?.uuid]);

  const refreshSelectedProfile = async () => {
    if (selectedAccount?.kind !== 'microsoft' || !selectedAccount.uuid) return;
    setProfileBusy(true);
    try {
      const updated = await window.onyx.auth.refreshProfile(selectedAccount.uuid);
      refreshedAccountIds.current.add(updated.uuid || selectedAccount.uuid);
      setAccounts((current) =>
        current.map((account) =>
          account.uuid === updated.uuid ? updated : account,
        ),
      );
      onNotify(
        'success',
        t('settings.skins.synced'),
        t('settings.skins.syncedHint', { name: updated.name }),
      );
    } catch (error) {
      onNotify(
        'warning',
        t('settings.skins.failed'),
        error instanceof Error ? error.message : t('auth.error.finish'),
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const chooseSkin = async () => {
    if (!selectedAccount?.uuid) return;
    setSkinBusy(true);
    try {
      const updated = await window.onyx.auth.chooseSkin(
        selectedAccount.uuid,
        skinVariant,
      );
      if (!updated) return;
      setAccounts((current) =>
        current.map((account) =>
          account.uuid === updated.uuid ? updated : account,
        ),
      );
      onNotify(
        'success',
        t('settings.skins.updated'),
        t('settings.skins.updatedHint', { name: updated.name }),
      );
    } catch (error) {
      onNotify(
        'warning',
        t('settings.skins.failed'),
        error instanceof Error ? error.message : t('auth.error.finish'),
      );
    } finally {
      setSkinBusy(false);
    }
  };

  return (
    <motion.div
      className='page skins-page'
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      <div className='page-heading'>
        <div>
          <p className='eyebrow'>{t('nav.skins')}</p>
          <h1>{t('settings.skins.title')}</h1>
          <p>{t('settings.skins.subtitle')}</p>
        </div>
      </div>

      {accounts.length ? (
        <div className='skin-manager'>
          <div className='skin-manager__accounts'>
            <div className='skin-manager__accounts-heading'>
              <strong>{t('auth.savedAccounts')}</strong>
              <button className='button button--ghost' onClick={onAccount}>
                {t('settings.skins.add')}
              </button>
            </div>
            <div className='skin-manager__account-list'>
              {accounts.map((account) => {
                const accountSkin =
                  account.skins?.find((skin) => skin.state === 'ACTIVE') ||
                  account.skins?.[0];
                const selected = account.uuid === selectedAccountId;
                const active = account.uuid === profile.uuid;
                return (
                  <button
                    className={`skin-manager__account ${selected ? 'is-selected' : ''}`}
                    key={account.uuid || account.name}
                    type='button'
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedAccountId(account.uuid || null);
                      setSkinVariant(
                        accountSkin?.variant === 'slim' ? 'slim' : 'classic',
                      );
                    }}
                  >
                    <span>
                      {accountSkin ? (
                        <img src={accountSkin.url} alt='' />
                      ) : (
                        <UserRound size={20} />
                      )}
                    </span>
                    <div>
                      <strong>{account.name}</strong>
                      <small>
                        {account.kind === 'microsoft'
                          ? t('profile.microsoft')
                          : t('profile.offline')}
                      </small>
                    </div>
                    {active && <Check size={15} />}
                  </button>
                );
              })}
            </div>
          </div>
          {selectedAccount ? (
            <div className='skin-manager__editor'>
              <div className='skin-manager__preview'>
                {selectedSkin ? (
                  <SkinModel
                    url={selectedSkin.url}
                    variant={selectedSkin.variant}
                  />
                ) : (
                  <ImagePlus size={34} />
                )}
              </div>
              <div className='skin-manager__details'>
                <p className='eyebrow'>{t('auth.skin')}</p>
                <h3>{selectedAccount.name}</h3>
                <p>
                  {selectedAccount.kind === 'offline'
                    ? t('auth.skin.offlineHint')
                    : t('settings.skins.licensedHint')}
                </p>
                <label>
                  {t('auth.skin.variant')}
                  <select
                    value={skinVariant}
                    onChange={(event) =>
                      setSkinVariant(
                        event.target.value === 'slim' ? 'slim' : 'classic',
                      )
                    }
                    disabled={skinBusy}
                  >
                    <option value='classic'>{t('auth.skin.classic')}</option>
                    <option value='slim'>{t('auth.skin.slim')}</option>
                  </select>
                </label>
                <div className='skin-manager__actions'>
                  <button
                    className='button button--primary'
                    type='button'
                    onClick={() => void chooseSkin()}
                    disabled={skinBusy || profileBusy}
                  >
                    {skinBusy ? (
                      <LoaderCircle className='spin' size={16} />
                    ) : (
                      <ImagePlus size={16} />
                    )}
                    {skinBusy
                      ? t('settings.skins.uploading')
                      : t('auth.skin.change')}
                  </button>
                  {selectedAccount.kind === 'microsoft' && (
                    <button
                      className='button button--secondary'
                      type='button'
                      onClick={() => void refreshSelectedProfile()}
                      disabled={skinBusy || profileBusy}
                    >
                      <RefreshCw
                        className={profileBusy ? 'spin' : undefined}
                        size={16}
                      />
                      {profileBusy
                        ? t('settings.skins.refreshing')
                        : t('settings.skins.refresh')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className='skin-manager__empty'>
          <ImagePlus size={30} />
          <h3>{t('settings.skins.empty')}</h3>
          <p>{t('settings.skins.emptyHint')}</p>
          <button className='button button--primary' type='button' onClick={onAccount}>
            {t('settings.skins.add')}
          </button>
        </div>
      )}
    </motion.div>
  );
}
