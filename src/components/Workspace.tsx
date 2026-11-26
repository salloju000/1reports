import type { ReactNode } from "react";
import { CircleAlert, FolderOpen, ChevronRight } from "lucide-react";
import { navigate } from "../hooks/useHub";
import { useHub } from "../services/HubContext";
import { categoryIcons } from "../data/categoryIcons";
/** The one heading a page carries. The shell never repeats it; a count, when given, is the live result size. */
export function PageHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <h1>
        {title}
        {count !== undefined && <span className="heading-count">{count}</span>}
      </h1>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
/** A titled block inside a page, with an optional trailing link ("View all"). */
export function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Progress({ text }: { text: string }) {
  return <p className="progress-status" role="status"><span className="spinner" aria-hidden="true" />{text}</p>;
}

export function Loading({ text = "Loading workspace…", layout = "rows" }: {
  text?: string;
  layout?: "rows" | "overview" | "form";
}) {
  return (
    <div className={`loading-placeholder loading-${layout}`} role="status">
      <span className="sr-only">{text}</span>
      <div className="skeleton-blocks" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    </div>
  );
}
export function ErrorState({
  text,
  retry,
}: {
  text: string;
  retry: () => void;
}) {
  return (
    <div className="empty error-state" role="alert">
      <CircleAlert size={24} aria-hidden="true" />
      <h3>Something went wrong</h3>
      <p>{text}</p>
      <button className="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <FolderOpen size={30} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{text}</p>
      {action === undefined
        ? <button className="button" onClick={() => navigate("reports")}>Browse reports</button>
        : action}
    </div>
  );
}
export function CategoryCards() {
  const { metadata } = useHub();
  if (!metadata?.categories.length)
    return <Empty title="No categories available" text="Categories appear when reports are available to your account." />;
  return (
    <div className="category-grid">
      {metadata?.categories.map((c) => {
        const Icon = categoryIcons[c.id] ?? FolderOpen;
        return (
          <button
            key={c.id}
            className="category-card"
            onClick={() => navigate("reports", { category: c.id })}
          >
            <span className={`category-icon ${c.color}`}>
              <Icon size={20} />
            </span>
            <div>
              <h3>{c.name}</h3>
              <span>{c.reportCount} {c.reportCount === 1 ? "report" : "reports"}</span>
            </div>
            <ChevronRight size={16} />
          </button>
        );
      })}
    </div>
  );
}
