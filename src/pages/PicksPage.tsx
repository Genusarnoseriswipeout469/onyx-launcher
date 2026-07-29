import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Dice5,
  Download,
  ExternalLink,
  Gauge,
  LoaderCircle,
  MemoryStick,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useI18n } from "../i18n";
import type {
  CatalogProject,
  DownloadTask,
  OnyxPick,
  OnyxPickMood,
} from "../types";
import { compactNumber } from "../utils";

interface PicksPageProps {
  downloads: DownloadTask[];
  allocatedMemory: number;
  onInstall: (project: CatalogProject) => void;
  onExplore: () => void;
}

type MoodFilter = "all" | OnyxPickMood;

const moodFilters: MoodFilter[] = [
  "all",
  "performance",
  "adventure",
  "rpg",
  "cozy",
];

function currentMinecraftVersions(versions: string[], limit = 1) {
  return versions
    .filter((version) => /^\d+(?:\.\d+){1,2}$/.test(version))
    .sort((left, right) => {
      const leftParts = left.split(".").map(Number);
      const rightParts = right.split(".").map(Number);
      const length = Math.max(leftParts.length, rightParts.length);
      for (let index = 0; index < length; index += 1) {
        const difference =
          (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
        if (difference) return difference;
      }
      return 0;
    })
    .slice(0, limit);
}

export function PicksPage({
  downloads,
  allocatedMemory,
  onInstall,
  onExplore,
}: PicksPageProps) {
  const { locale, t } = useI18n();
  const [picks, setPicks] = useState<OnyxPick[]>([]);
  const [mood, setMood] = useState<MoodFilter>("all");
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void window.onyx.catalog
      .picks()
      .then((result) => {
        if (!cancelled) setPicks(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : t("picks.error"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, t]);

  const visible = useMemo(() => {
    const filtered =
      mood === "all" ? picks : picks.filter((pick) => pick.mood === mood);
    if (!spotlightId) return filtered;
    return [...filtered].sort((left, right) => {
      if (left.id === spotlightId) return -1;
      if (right.id === spotlightId) return 1;
      return 0;
    });
  }, [mood, picks, spotlightId]);

  const featured = visible[0];
  const rest = visible.slice(1);

  const taskFor = (projectId: string) =>
    downloads.find((download) => download.projectId === projectId);

  const reason = (pick: OnyxPick) => {
    switch (pick.reason) {
      case "fast-and-familiar":
        return t("picks.reason.performance");
      case "creature-adventure":
        return t("picks.reason.cobblemon");
      case "story-rpg":
        return t("picks.reason.rpg");
      case "better-vanilla":
        return t("picks.reason.vanilla");
      case "cozy-long-haul":
        return t("picks.reason.cozy");
      default:
        return pick.project.description;
    }
  };

  const moodLabel = (value: MoodFilter) => {
    switch (value) {
      case "performance":
        return t("picks.mood.performance");
      case "adventure":
        return t("picks.mood.adventure");
      case "rpg":
        return t("picks.mood.rpg");
      case "cozy":
        return t("picks.mood.cozy");
      default:
        return t("picks.mood.all");
    }
  };

  const memoryLabel = (pick: OnyxPick) => {
    if (allocatedMemory >= pick.recommendedMemoryGiB) {
      return t("picks.memory.ready", {
        memory: pick.recommendedMemoryGiB,
      });
    }
    if (allocatedMemory >= pick.minimumMemoryGiB) {
      return t("picks.memory.minimum", {
        memory: pick.minimumMemoryGiB,
      });
    }
    return t("picks.memory.low", { memory: pick.minimumMemoryGiB });
  };

  const surprise = () => {
    const compatible = picks.filter(
      (pick) => pick.minimumMemoryGiB <= allocatedMemory,
    );
    const pool = compatible.length ? compatible : picks;
    if (!pool.length) return;
    const current = Math.max(
      -1,
      pool.findIndex((pick) => pick.id === spotlightId),
    );
    const next = pool[(current + 1) % pool.length];
    setMood("all");
    setSpotlightId(next.id);
  };

  return (
    <motion.div
      className="page picks-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <Sparkles size={13} /> ONYX PICKS
          </p>
          <h1>{t("picks.title")}</h1>
          <p>{t("picks.subtitle")}</p>
        </div>
        <div className="source-pill">
          <ShieldCheck size={14} />
          {t("picks.liveSource")}
        </div>
      </div>

      <div className="picks-controls">
        <div className="picks-moods" aria-label={t("picks.chooseMood")}>
          {moodFilters.map((item) => (
            <button
              key={item}
              className={mood === item ? "is-active" : ""}
              onClick={() => {
                setMood(item);
                setSpotlightId(null);
              }}
            >
              {moodLabel(item)}
            </button>
          ))}
        </div>
        <button
          className="button button--secondary picks-surprise"
          onClick={surprise}
          disabled={!picks.length}
        >
          <Dice5 size={16} />
          {t("picks.surprise")}
        </button>
      </div>

      {loading && (
        <div className="picks-loading">
          <LoaderCircle className="spin" size={22} />
          <span>{t("picks.loading")}</span>
        </div>
      )}

      {!loading && error && (
        <div className="picks-error">
          <span>
            <WandSparkles size={24} />
          </span>
          <div>
            <h2>{t("picks.errorTitle")}</h2>
            <p>{error}</p>
          </div>
          <button
            className="button button--secondary"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            {t("common.retry")}
          </button>
          <button className="text-button" onClick={onExplore}>
            {t("picks.openDiscover")} <ArrowRight size={14} />
          </button>
        </div>
      )}

      {!loading && featured && (
        <>
          <section
            className={`picks-feature picks-feature--${featured.accent}`}
          >
            <div className="picks-feature__art">
              {featured.project.icon_url ? (
                <img src={featured.project.icon_url} alt="" />
              ) : (
                <span>{featured.project.title.slice(0, 2).toUpperCase()}</span>
              )}
              <i />
            </div>
            <div className="picks-feature__copy">
              <div className="picks-feature__label">
                <Sparkles size={14} />
                {spotlightId === featured.id
                  ? t("picks.surpriseResult")
                  : t("picks.editorChoice")}
              </div>
              <h2>{featured.project.title}</h2>
              <p>{reason(featured)}</p>
              <div className="picks-fit">
                <span
                  className={
                    allocatedMemory >= featured.minimumMemoryGiB
                      ? "is-ready"
                      : "is-warning"
                  }
                >
                  <MemoryStick size={14} />
                  {memoryLabel(featured)}
                </span>
                <span>
                  <Gauge size={14} />
                  {moodLabel(featured.mood)}
                </span>
                <span>
                  Minecraft{" "}
                  {currentMinecraftVersions(featured.project.versions)[0] ||
                    "—"}
                </span>
              </div>
              <div className="picks-feature__actions">
                <PickInstallButton
                  task={taskFor(featured.project.project_id)}
                  onClick={() => onInstall(featured.project)}
                />
                <button
                  className="button button--glass"
                  onClick={() =>
                    window.open(
                      `https://modrinth.com/modpack/${featured.project.slug}`,
                      "_blank",
                    )
                  }
                >
                  <ExternalLink size={15} />
                  {t("discover.details")}
                </button>
              </div>
            </div>
            <div className="picks-feature__stats">
              <span>
                <Download size={13} />
                {compactNumber(featured.project.downloads, locale)}
              </span>
              <small>
                {t("discover.by", { author: featured.project.author })}
              </small>
            </div>
          </section>

          {rest.length > 0 && (
            <section className="dashboard-section">
              <div className="section-heading">
                <div>
                  <h2>{t("picks.moreTitle")}</h2>
                  <p>{t("picks.moreHint")}</p>
                </div>
                <button className="text-button" onClick={onExplore}>
                  {t("picks.openDiscover")} <ArrowRight size={14} />
                </button>
              </div>
              <div className="picks-grid">
                {rest.map((pick, index) => {
                  const task = taskFor(pick.project.project_id);
                  const compatible =
                    allocatedMemory >= pick.minimumMemoryGiB;
                  return (
                    <motion.article
                      className={`pick-card pick-card--${pick.accent}`}
                      key={pick.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index * 0.04, 0.2) }}
                    >
                      <div className="pick-card__head">
                        <span>
                          {pick.project.icon_url ? (
                            <img src={pick.project.icon_url} alt="" />
                          ) : (
                            pick.project.title.slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <div>
                          <small>{moodLabel(pick.mood)}</small>
                          <h3 title={pick.project.title}>
                            {pick.project.title}
                          </h3>
                        </div>
                      </div>
                      <p>{reason(pick)}</p>
                      <div className="pick-card__meta">
                        <span className={compatible ? "is-ready" : "is-warning"}>
                          <MemoryStick size={13} />
                          {memoryLabel(pick)}
                        </span>
                        <span>
                          <Download size={13} />
                          {compactNumber(pick.project.downloads, locale)}
                        </span>
                      </div>
                      <div className="pick-card__footer">
                        <small>
                          {currentMinecraftVersions(
                            pick.project.versions,
                            2,
                          ).join(" · ")}
                        </small>
                        <PickInstallButton
                          compact
                          task={task}
                          onClick={() => onInstall(pick.project)}
                        />
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </motion.div>
  );
}

function PickInstallButton({
  task,
  compact = false,
  onClick,
}: {
  task?: DownloadTask;
  compact?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const active =
    task?.status === "queued" ||
    task?.status === "downloading" ||
    task?.status === "installing";
  const done = task?.status === "done";
  return (
    <button
      className={compact ? "project-install" : "button button--primary"}
      onClick={onClick}
      disabled={active || done}
      title={compact ? t("discover.install") : undefined}
    >
      {done ? (
        <>
          <Check size={16} />
          {!compact && t("discover.inLibrary")}
        </>
      ) : active ? (
        <>
          <LoaderCircle className="spin" size={16} />
          {!compact && `${task.progress}%`}
        </>
      ) : (
        <>
          <Download size={16} />
          {!compact && t("discover.install")}
        </>
      )}
    </button>
  );
}
