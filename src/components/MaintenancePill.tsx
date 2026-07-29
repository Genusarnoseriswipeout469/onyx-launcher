import { AnimatePresence, motion } from "framer-motion";
import { Check, LoaderCircle } from "lucide-react";

export interface MaintenanceState {
  instanceId?: string;
  operation: "backup" | "import" | "move";
  message: string;
  progress: number;
  processed?: number;
  total?: number;
  done?: boolean;
}

export function MaintenancePill({
  progress,
}: {
  progress: MaintenanceState | null;
}) {
  return (
    <AnimatePresence>
      {progress && (
        <motion.div
          className={`maintenance-pill ${progress.done ? "is-done" : ""}`}
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          role="status"
          aria-live="polite"
        >
          <span>
            {progress.done ? (
              <Check size={15} />
            ) : (
              <LoaderCircle className="spin" size={15} />
            )}
          </span>
          <div>
            <strong>{progress.message}</strong>
            <i>
              <b
                style={{
                  width: `${Math.max(2, Math.min(progress.progress, 100))}%`,
                }}
              />
            </i>
          </div>
          <small>{Math.round(progress.progress)}%</small>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
