/* eslint-disable react-refresh/only-export-components */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a useful breadcrumb in DevTools without exposing account data.
    console.error("Onyx renderer crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <FatalScreen error={this.state.error} />;
  }
}
function FatalScreen({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <main className="fatal-screen">
      <div className="fatal-screen__icon">
        <CircleAlert size={30} />
      </div>
      <p className="eyebrow">{t("fatal.eyebrow")}</p>
      <h1>{t("fatal.title")}</h1>
      <p>{t("fatal.message")}</p>
      <pre>{error.message}</pre>
      <button
        className="button button--primary"
        onClick={() => window.location.reload()}
      >
        <RefreshCw size={16} /> {t("fatal.restart")}
      </button>
    </main>
  );
}