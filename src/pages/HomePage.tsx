import { motion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  ChevronRight,
  Clock3,
  Compass,
  Layers3,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { GameInstance, PlaySession, RouteId } from "../types";
import { formatPlaytime } from "../utils";

interface HomePageProps {
  instances: GameInstance[];
  sessions: PlaySession[];
  profileName: string;
  onNavigate: (route: RouteId) => void;
  onPlay: (instance: GameInstance) => void;
  onOpen: (instance: GameInstance) => void;
  onCreate: () => void;
  onConfigure: (instance: GameInstance) => void;
}

export function HomePage({
  instances,
  sessions,
  profileName,
  onNavigate,
  onPlay,
  onOpen,
  onCreate,
  onConfigure,
}: HomePageProps) {
  const { locale, t } = useI18n();
  const hour = new Date().getHours();
  const greeting =
    hour < 6
      ? t("home.greeting.night")
      : hour < 12
        ? t("home.greeting.morning")
        : hour < 18
          ? t("home.greeting.day")
          : t("home.greeting.evening");
  const featured =
    instances.find((instance) => instance.favorite) ?? instances[0];
  const recent = instances.slice(0, 3);
  const displayName = (instance: GameInstance) =>
    instance.id === "vanilla-start" && instance.name === "Pure Game"
      ? t("home.defaultName")
      : instance.name;
  const displayDescription = (instance: GameInstance) =>
    instance.id === "vanilla-start" && instance.description === "Minecraft without modifications"
      ? t("home.defaultDescription")
      : instance.description;
  const totalMinutes = instances.reduce(
    (sum, instance) => sum + instance.playtimeMinutes,
    0,
  );
  const latestSession = sessions[0];
  const failedInstance =
    latestSession?.exitCode !== undefined &&
    latestSession?.exitCode !== null &&
    latestSession.exitCode !== 0
      ? instances.find(
          (instance) => instance.id === latestSession.instanceId,
        )
      : undefined;
  const updatesAvailable = instances.filter(
    (instance) => instance.updateAvailable,
  ).length;
  const activity = [
    {
      id: "picks",
      route: "picks" as RouteId,
      tone: "violet",
      icon: Sparkles,
      category: t("home.feed.picks.category"),
      title: t("home.feed.picks.title"),
      text: t("home.feed.picks.text"),
    },
    failedInstance
      ? {
          id: "guard",
          route: "library" as RouteId,
          tone: "rose",
          icon: ShieldAlert,
          category: t("home.feed.guard.category"),
          title: t("home.feed.guard.title", {
            name: displayName(failedInstance),
          }),
          text:
            failedInstance.lastDiagnosis?.message ||
            t("home.feed.guard.text"),
        }
      : updatesAvailable
        ? {
            id: "updates",
            route: "library" as RouteId,
            tone: "lime",
            icon: RefreshCw,
            category: t("home.feed.updates.category"),
            title: t("home.feed.updates.title", {
              count: updatesAvailable,
            }),
            text: t("home.feed.updates.text"),
          }
        : {
            id: "catalog",
            route: "discover" as RouteId,
            tone: "lime",
            icon: Compass,
            category: t("home.feed.catalog.category"),
            title: t("home.feed.catalog.title"),
            text: t("home.feed.catalog.text"),
          },
  ];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    const minutes = sessions
      .filter((session) => {
        const endedAt = new Date(session.endedAt).getTime();
        return endedAt >= date.getTime() && endedAt < next.getTime();
      })
      .reduce((sum, session) => sum + session.durationMinutes, 0);
    return {
      date,
      minutes,
      label: new Intl.DateTimeFormat("en-US", {
        weekday: "narrow",
      }).format(date),
    };
  });
  const weekMaximum = Math.max(1, ...week.map((day) => day.minutes));
  const weekMinutes = week.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <motion.div
      className="page home-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.24 }}
    >
      <div className="page-heading page-heading--home">
        <div>
          <p className="eyebrow">{t("home.eyebrow")}</p>
          <h1>
            {greeting}, <span>{profileName === "Player" ? t("profile.player") : profileName}</span>
          </h1>
          <p>{t("home.subtitle")}</p>
        </div>
        <button className="button button--secondary" onClick={onCreate}>
          <Plus size={16} />
          {t("home.newInstance")}
        </button>
      </div>

      {featured && (
        <section className={`hero hero--${featured.color}`}>
          <div className="hero__noise" />
          <div className="hero__copy">
            <div className="hero__tag">
              <span>
                <Sparkles size={13} />
                {featured.status === "running"
                  ? t("home.status.running")
                  : featured.status === "setup" ||
                      featured.status === "pack-ready"
                    ? t("home.status.setup")
                    : featured.status === "error"
                      ? t("home.status.error")
                      : t("home.status.continue")}
              </span>
              <i />
              {featured.lastPlayed === "Never played" ? t("home.neverPlayed") : featured.lastPlayed}
            </div>
            <h2>{displayName(featured)}</h2>
            <p>{displayDescription(featured)}</p>
            <div className="hero__meta">
              <span>
                <Layers3 size={15} />
                Minecraft {featured.version}
              </span>
              <span>
                <Boxes size={15} />
                {featured.loader}
              </span>
              <span>
                <Clock3 size={15} />
                {formatPlaytime(featured.playtimeMinutes, locale)}
              </span>
            </div>
            <div className="hero__actions">
              <button
                className="button button--primary button--play"
                onClick={() => onPlay(featured)}
              >
                <Play size={18} fill="currentColor" />
                {featured.status === "running"
                  ? t("home.action.stop")
                  : featured.status === "setup" ||
                      featured.status === "pack-ready"
                    ? t("home.action.install")
                    : featured.status === "error"
                      ? t("home.action.retry")
                      : t("home.action.play")}
              </button>
              <button
                className="button button--glass"
                onClick={() => onConfigure(featured)}
              >
                {t("home.action.configure")}
              </button>
            </div>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="hero-art__planet" />
            <div className="hero-art__ring hero-art__ring--one" />
            <div className="hero-art__ring hero-art__ring--two" />
            <div className="voxel voxel--one">
              <i />
              <b />
              <span />
            </div>
            <div className="voxel voxel--two">
              <i />
              <b />
              <span />
            </div>
            <div className="voxel voxel--three">
              <i />
              <b />
              <span />
            </div>
            <div className="hero-art__label">
              <span>{featured.version}</span>
              <small>{t("home.modsActive", { count: featured.modCount })}</small>
            </div>
          </div>
        </section>
      )}

      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>{t("home.recent")}</h2>
            <p>{t("home.recentHint")}</p>
          </div>
          <button
            className="text-button"
            onClick={() => onNavigate("library")}
          >
            {t("home.library")} <ArrowRight size={15} />
          </button>
        </div>

        <div className="recent-grid">
          {recent.map((instance, index) => (
            <motion.article
              className={`recent-card recent-card--instance recent-card--${instance.color}`}
              key={instance.id}
              role='button'
              tabIndex={0}
              onClick={() => onOpen(instance)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen(instance);
                }
              }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 * index }}
            >
              <span className="recent-card__icon">
                {instance.iconUrl ? (
                  <img src={instance.iconUrl} alt="" />
                ) : (
                  instance.glyph
                )}
              </span>
              <span className="recent-card__copy">
                <strong>{displayName(instance)}</strong>
                <small>
                  {instance.version} · {instance.loader.split(" ")[0]}
                </small>
              </span>
              <button
                className="recent-card__play"
                aria-label={t("home.action.play")}
                onClick={(event) => {
                  event.stopPropagation();
                  onPlay(instance);
                }}
              >
                <Play size={15} fill="currentColor" />
              </button>
            </motion.article>
          ))}
          <button className="recent-card recent-card--new" onClick={onCreate}>
            <span className="recent-card__icon">
              <Plus size={20} />
            </span>
            <span className="recent-card__copy">
              <strong>{t("home.newInstance")}</strong>
              <small>{t("home.newHint")}</small>
            </span>
          </button>
        </div>
      </section>

      <div className="home-lower">
        <section className="dashboard-section news-section">
          <div className="section-heading">
            <div>
              <h2>{t("home.feed")}</h2>
              <p>{t("home.feedHint")}</p>
            </div>
          </div>
          <div className="news-list">
            {activity.map((item) => {
              const Icon = item.icon;
              return (
              <button
                className={`news-card news-card--${item.tone}`}
                key={item.id}
                onClick={() => onNavigate(item.route)}
              >
                <span className="news-card__art">
                  <Icon size={25} />
                </span>
                <span className="news-card__copy">
                  <small>{item.category}</small>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </span>
                <ChevronRight size={18} />
              </button>
            )})}
          </div>
        </section>

        <aside className="stats-card">
          <div className="stats-card__head">
            <span className="stats-card__icon">
              <Sparkles size={18} />
            </span>
            <div>
              <p>{t("home.week")}</p>
              <strong>
                {weekMinutes > 0
                  ? t("home.pace")
                  : t("home.pace.empty")}
              </strong>
            </div>
          </div>
          <div className="stats-card__chart">
            {week.map((day) => (
              <span
                key={day.date.toISOString()}
                title={t("home.dayPlaytime", {
                  minutes: day.minutes,
                })}
              >
                <i
                  style={{
                    height: `${
                      day.minutes
                        ? Math.max(10, (day.minutes / weekMaximum) * 100)
                        : 4
                    }%`,
                  }}
                />
                <small>{day.label}</small>
              </span>
            ))}
          </div>
          <div className="stats-card__metrics">
            <div>
              <strong>{Math.round(totalMinutes / 60)} {t("common.hours")}</strong>
              <small>{t("home.played")}</small>
            </div>
            <div>
              <strong>{instances.length}</strong>
              <small>{t("home.instances")}</small>
            </div>
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
