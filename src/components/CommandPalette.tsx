import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Box,
  Command,
  Compass,
  Download,
  Home,
  Library,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import type { GameInstance, RouteId } from "../types";

interface CommandPaletteProps {
  open: boolean;
  instances: GameInstance[];
  onClose: () => void;
  onNavigate: (route: RouteId) => void;
  onPlay: (instance: GameInstance) => void;
  onCreate: () => void;
}

const commands: Array<{
  id: RouteId;
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  icon: typeof Home;
}> = [
  { id: "home", titleKey: "nav.home", hintKey: "command.homeHint", icon: Home },
  {
    id: "library",
    titleKey: "nav.library",
    hintKey: "command.libraryHint",
    icon: Library,
  },
  {
    id: "discover",
    titleKey: "nav.discover",
    hintKey: "command.discoverHint",
    icon: Compass,
  },
  {
    id: "picks",
    titleKey: "nav.picks",
    hintKey: "command.picksHint",
    icon: Sparkles,
  },
  {
    id: "downloads",
    titleKey: "nav.downloads",
    hintKey: "command.downloadsHint",
    icon: Download,
  },
  {
    id: "settings",
    titleKey: "nav.settings",
    hintKey: "command.settingsHint",
    icon: Settings,
  },
];

export function CommandPalette({
  open,
  instances,
  onClose,
  onNavigate,
  onPlay,
  onCreate,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const matchingInstances = useMemo(
    () =>
      instances.filter((instance) =>
        `${instance.name} ${instance.version} ${instance.loader}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [instances, query],
  );

  const matchingCommands = useMemo(
    () =>
      commands.filter((command) =>
        `${t(command.titleKey)} ${t(command.hintKey)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, t],
  );

  const act = (callback: () => void) => {
    callback();
    onClose();
  };

  const visibleInstances = matchingInstances.slice(0, 4);
  const actionCount =
    visibleInstances.length + matchingCommands.length + 1;
  const runActive = () => {
    if (activeIndex < visibleInstances.length) {
      act(() => onPlay(visibleInstances[activeIndex]));
      return;
    }
    const commandIndex = activeIndex - visibleInstances.length;
    if (commandIndex < matchingCommands.length) {
      act(() => onNavigate(matchingCommands[commandIndex].id));
      return;
    }
    act(onCreate);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="command-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("command.dialog")}
            initial={{ opacity: 0, scale: 0.97, y: -18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ type: "spring", stiffness: 450, damping: 36 }}
          >
            <div className="command-search">
              <Search size={19} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("command.placeholder")}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((value) => (value + 1) % actionCount);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex(
                      (value) => (value - 1 + actionCount) % actionCount,
                    );
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    runActive();
                  }
                }}
              />
              <button onClick={onClose}>
                <X size={16} />
              </button>
            </div>

            <div className="command-results">
              {matchingInstances.length > 0 && (
                <div className="command-group">
                  <p>{t("command.instances")}</p>
                  {visibleInstances.map((instance, index) => (
                    <button
                      key={instance.id}
                      className={activeIndex === index ? "is-selected" : ""}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => act(() => onPlay(instance))}
                    >
                      <span className={`command-icon command-icon--${instance.color}`}>
                        {instance.iconUrl ? (
                          <img src={instance.iconUrl} alt="" />
                        ) : (
                          instance.glyph
                        )}
                      </span>
                      <span>
                        <strong>{instance.name}</strong>
                        <small>
                          {instance.version} · {instance.loader}
                        </small>
                      </span>
                      <kbd>{t("command.play")}</kbd>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              )}

              {matchingCommands.length > 0 && (
                <div className="command-group">
                  <p>{t("command.go")}</p>
                  {matchingCommands.map((command, index) => {
                    const Icon = command.icon;
                    const itemIndex = visibleInstances.length + index;
                    return (
                      <button
                        key={command.id}
                        className={
                          activeIndex === itemIndex ? "is-selected" : ""
                        }
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        onClick={() => act(() => onNavigate(command.id))}
                      >
                        <span className="command-icon">
                          <Icon size={17} />
                        </span>
                        <span>
                          <strong>{t(command.titleKey)}</strong>
                          <small>{t(command.hintKey)}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="command-group">
                <p>{t("command.actions")}</p>
                <button
                  className={
                    activeIndex === actionCount - 1 ? "is-selected" : ""
                  }
                  onMouseEnter={() => setActiveIndex(actionCount - 1)}
                  onClick={() => act(onCreate)}
                >
                  <span className="command-icon">
                    <Plus size={17} />
                  </span>
                  <span>
                    <strong>{t("command.create")}</strong>
                    <small>{t("command.createHint")}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              </div>

              {!matchingInstances.length && !matchingCommands.length && (
                <div className="command-empty">
                  <Box size={22} />
                  <strong>{t("command.empty")}</strong>
                  <p>{t("command.emptyHint")}</p>
                </div>
              )}
            </div>

            <div className="command-footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> {t("command.navigation")}
              </span>
              <span>
                <kbd>Enter</kbd> {t("command.select")}
              </span>
              <span>
                <kbd>Esc</kbd> {t("command.dismiss")}
              </span>
              <i>
                <Command size={12} /> {t("command.label")}
              </i>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
