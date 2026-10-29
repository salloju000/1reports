import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  Star,
  TrendingUp,
} from "lucide-react";
import type { ElementType } from "react";
import { CategoryCards, ErrorState, Loading } from "../components/Workspace";
import { Favorite, date } from "../components/Reports";
import { navigate, useAsync } from "../hooks/useHub";
import { useHub } from "../services/HubContext";

export function Overview({
  revision,
  favorites,
  onOpen,
  onToggle,
}: {
  revision: number;
  favorites: string[];
  onOpen: (id: string, run?: boolean) => void;
  onToggle: (id: string) => void;
}) {
  const { repository, metadata } = useHub();
  const result = useAsync(
    () => repository.getDashboard(),
    [repository, revision],
  );
  if (result.error)
    return <ErrorState text={result.error} retry={result.retry} />;
  if (!result.data) return <Loading />;
  const dashboard = result.data;
  const stats: [number, string, string, ElementType, string][] = [
    [
      dashboard.total,
      "Total Reports",
      "Across your organization",
      FileText,
      "reports",
    ],
    [
      dashboard.categoryCount,
      "Categories",
      "Organized by business function",
      FolderOpen,
      "categories",
    ],
    [
      dashboard.favoriteCount,
      "Favorites",
      "Your personal report collection",
      Star,
      "favorites",
    ],
    [
      dashboard.recent.length,
      "Recently Used",
      "Sample and prototype activity",
      Clock3,
      "recent",
    ],
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR REPORTING WORKSPACE</div>
          <h1>Everything you need. All in one place.</h1>
          <p>
            Welcome back, {metadata?.user.name.split(" ")[0]}. Find the right
            report and get straight to work.
          </p>
        </div>
        <button className="button primary" onClick={() => navigate("reports")}>
          Browse all reports
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="stats-grid">
        {stats.map(([value, label, sub, Icon, page], i) => (
          <button
            className="stat-card"
            key={label}
            onClick={() => navigate(page)}
          >
            <div>
              <span>{label}</span>
              <span className={`stat-icon stat-${i}`}>
                <Icon size={19} />
              </span>
            </div>
            <strong>{value}</strong>
            <small>
              {sub}
              <ArrowUpRight size={13} />
            </small>
          </button>
        ))}
      </div>
      <div className="overview-columns">
        <section className="panel popular">
          <div className="section-heading">
            <div>
              <h2>
                <TrendingUp size={18} />
                Frequently accessed
              </h2>
              <p>Your team's go-to reports, ready when you are.</p>
            </div>
            <button
              className="text-button"
              onClick={() =>
                navigate("reports", { sort: "usage", usage: "frequent" })
              }
            >
              View all
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="popular-head">
            <span>REPORT NAME</span>
            <span>LAST USED</span>
            <span>TYPICAL TIME</span>
            <span />
          </div>
          {dashboard.frequent.map((report) => (
            <div className="popular-row" key={report.id}>
              <div className="report-identity">
                <span className="file-icon blue">
                  <FileText size={18} />
                </span>
                <div>
                  <button
                    className="report-name"
                    onClick={() => onOpen(report.id)}
                  >
                    {report.name}
                  </button>
                  <p>
                    {
                      metadata?.categories.find(
                        (c) => c.id === report.categoryId,
                      )?.name
                    }{" "}
                    <span>· {report.code}</span>
                  </p>
                </div>
              </div>
              <span className="small muted">
                {dashboard.lastAccess[report.id]
                  ? date(dashboard.lastAccess[report.id])
                  : "Not accessed"}
              </span>
              <span className="execution-time">
                <Clock3 size={13} />
                {report.typicalExecutionTimeSeconds}s
              </span>
              <div className="row-actions">
                <Favorite
                  report={report}
                  favorites={favorites}
                  onToggle={onToggle}
                />
                <button
                  className="icon-button"
                  aria-label={`Open ${report.name}`}
                  onClick={() => onOpen(report.id)}
                >
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </div>
          ))}
        </section>
        <section className="panel recent-panel">
          <div className="section-heading">
            <div>
              <h2>
                <Clock3 size={18} />
                Pick up where you left off
              </h2>
              <p>Your recently accessed reports.</p>
            </div>
          </div>
          {!dashboard.recent.length && (
            <p className="recent-item muted">
              Open a report to start your history.
            </p>
          )}
          {dashboard.recent.slice(0, 4).map((item, i) => (
            <button
              className="recent-item"
              key={item.report.id}
              onClick={() => onOpen(item.report.id)}
            >
              <span className="timeline-dot">{i + 1}</span>
              <span>
                <strong>{item.report.name}</strong>
                <small>
                  {date(item.accessedAt)} ·{" "}
                  {item.source === "seed"
                    ? "Sample activity"
                    : "Prototype access"}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
          <button className="recent-link" onClick={() => navigate("recent")}>
            View recent reports
            <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <section className="category-section">
        <div className="section-heading">
          <div>
            <h2>Browse by category</h2>
            <p>A clear path to the reports you need.</p>
          </div>
          <button
            className="text-button"
            onClick={() => navigate("categories")}
          >
            Explore categories
            <ArrowRight size={14} />
          </button>
        </div>
        <CategoryCards />
      </section>
      <section className="quick-access">
        <div>
          <span className="quick-icon">
            <BookOpen size={22} />
          </span>
          <div>
            <h3>A faster route to your next answer</h3>
            <p>
              Discover reports, build your favorites, and keep your work moving.
            </p>
          </div>
        </div>
        <button className="button" onClick={() => navigate("favorites")}>
          <Star size={15} />
          Open favorites
        </button>
        <button className="button" onClick={() => navigate("reports")}>
          Explore the catalog
          <ArrowRight size={15} />
        </button>
      </section>
    </>
  );
}
