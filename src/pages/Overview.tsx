import { ArrowRight } from "lucide-react";
import { CategoryCards, ErrorState, PageHeader, Section } from "../components/Workspace";
import { OverviewSkeleton } from "../components/Skeleton";
import { eventLabels } from "../data/activityLabels";
import { ReportRow, ReportRows, date } from "../components/Reports";
import { ReportGlyph } from "../components/ReportGlyph";
import { navigate, useAsync } from "../hooks/useHub";
import { useHub } from "../services/HubContext";
import { defaultQuery } from "../services/catalog";
import { noReports } from "./Catalog";

/** "Today", "Yesterday", "3 days ago", then the date: how recently something happened, at a glance. */
export function relativeDay(value?: string) {
  if (!value) return "";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date(value);
}

/** The same moment as a phrase to follow an action: "today", "3 days ago", "on 14 Nov 2026". */
function when(value: string) {
  const day = relativeDay(value);
  return day === "Today" || day === "Yesterday" || day.endsWith("ago") ? day.toLowerCase() : day ? `on ${day}` : "";
}

const shelf = 5;

/**
 * The starting point of the Reports module. It does not list or search the catalog — Reports does that.
 * It answers "where do I pick up?": what you were last working on, what you keep close, and where to browse.
 */
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
  const { repository, metadata, audience } = useHub();
  // Categories are only a way in when there is more than one; otherwise the Overview lists the reports.
  const byCategory = (metadata?.categories.length ?? 0) > 1;
  const result = useAsync(
    () => Promise.all([
      repository.getDashboard(),
      favorites.length ? repository.getReports({ ...defaultQuery, sort: "usage" }, favorites) : undefined,
      byCategory ? undefined : repository.getReports({ ...defaultQuery, sort: "usage" }),
    ]).then(([dashboard, pinned, library]) => ({ dashboard, pinned, library })),
    [repository, revision, favorites.join(","), byCategory],
    true,
  );

  if (result.error) return <ErrorState text={result.error} retry={result.retry} />;
  if (!result.data) return <div className="overview"><PageHeader title="Overview" /><OverviewSkeleton /></div>;
  const { dashboard, pinned, library } = result.data;
  // Reports already on the Favorites shelf are not repeated here.
  const others = library?.items.filter(report => !favorites.includes(report.id)) ?? [];
  const categoryName = (id: string) => metadata?.categories.find(category => category.id === id)?.name ?? id;
  const viewAll = (page: string, label: string) => (
    <button className="text-button section-link" aria-label={label} onClick={() => navigate(page)}>
      View all <ArrowRight size={14} aria-hidden="true" />
    </button>
  );

  return (
    <div className="overview">
      <PageHeader title="Overview" />
      {dashboard.total === 0 ? <EmptyLibrary {...noReports(audience)} /> : <>
        {dashboard.recent.length > 0 && (
          <Section id="continue-title" title="Continue">
            <ReportRows label="Recently opened reports">
              {dashboard.recent.slice(0, 3).map(item => (
                <ReportRow key={item.report.id} report={item.report} onOpen={onOpen}
                  meta={`${item.source === "seed" ? "Sample activity" : eventLabels[item.status]} ${when(item.accessedAt)}`} />
              ))}
            </ReportRows>
          </Section>
        )}
        {pinned && pinned.items.length > 0 && (
          <Section id="favorites-title" title="Favorites"
            action={pinned.total > shelf ? viewAll("favorites", "View all favorites") : undefined}>
            <ReportRows label="Favorite reports">
              {pinned.items.slice(0, shelf).map(report => (
                <ReportRow key={report.id} report={report} onOpen={onOpen} favorites={favorites} onToggle={onToggle}
                  meta={categoryName(report.categoryId)}
                  fact={relativeDay(dashboard.lastAccess[report.id]) || undefined} />
              ))}
            </ReportRows>
          </Section>
        )}
        {byCategory ? (
          <Section id="categories-title" title="Browse by category">
            <CategoryCards />
          </Section>
        ) : others.length > 0 && (
          <Section id="library-title" title={pinned?.items.length ? "More reports" : "Reports"}
            action={library && library.total > shelf ? viewAll("reports", "View all reports") : undefined}>
            <ReportRows label="Reports">
              {others.slice(0, shelf).map(report => (
                <ReportRow key={report.id} report={report} onOpen={onOpen} favorites={favorites} onToggle={onToggle}
                  meta={categoryName(report.categoryId)}
                  fact={relativeDay(dashboard.lastAccess[report.id]) || undefined} />
              ))}
            </ReportRows>
          </Section>
        )}
      </>}
    </div>
  );
}

/** What the Overview shows before any report is published to the account: why, and what happens next. */
function EmptyLibrary({ title, text }: { title: string; text: string }) {
  return (
    <section className="library-void" aria-labelledby="library-void-title">
      <div className="void-stock" aria-hidden="true">
        <ReportGlyph name="Document" size={64} />
        <ReportGlyph name="Label 4x6" size={64} />
        <ReportGlyph name="Label 3x2" size={64} />
      </div>
      <h2 id="library-void-title">{title}</h2>
      <p>{text}</p>
    </section>
  );
}
