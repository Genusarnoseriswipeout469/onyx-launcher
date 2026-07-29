import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

export interface ToastMessage {
  id: number;
  tone: "success" | "info" | "warning";
  title: string;
  message: string;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon =
            toast.tone === "success"
              ? CheckCircle2
              : toast.tone === "warning"
                ? TriangleAlert
                : Info;
          return (
            <motion.div
              className={`toast toast--${toast.tone}`}
              role="status"
              key={toast.id}
              initial={{ opacity: 0, x: 34, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 26, scale: 0.97 }}
            >
              <span>
                <Icon size={18} />
              </span>
              <div>
                <strong>{toast.title}</strong>
                <p>{toast.message}</p>
              </div>
              <button onClick={() => onDismiss(toast.id)}>
                <X size={15} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
