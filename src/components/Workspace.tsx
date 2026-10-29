import { FolderOpen, ChevronRight } from "lucide-react";
import { navigate } from "../hooks/useHub";
import { useHub } from "../services/HubContext";
import { categoryIcons } from "../data/categoryIcons";
export function PageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty" role="status">
      Loading workspace…
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
    <div className="empty" role="alert">
      <h3>{text}</h3>
      <button className="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <FolderOpen size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="button" onClick={() => navigate("reports")}>
        Browse all reports
      </button>
    </div>
  );
}
export function CategoryCards({ detailed = false }: { detailed?: boolean }) {
  const { metadata } = useHub();
  return (
    <div className={`category-grid ${detailed ? "detailed" : ""}`}>
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
              {detailed && <p>{c.description}</p>}
              <span>
                {c.reportCount} reports{detailed ? ` · ${c.department}` : ""}
              </span>
            </div>
            <ChevronRight size={16} />
          </button>
        );
      })}
    </div>
  );
}
