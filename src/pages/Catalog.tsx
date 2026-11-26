import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Grid2X2, Layers, List, X } from "lucide-react";
import { maxBatch } from "./BatchReports";
import type { CatalogQuery, Preferences } from "../types";
import { useHub, type Audience } from "../services/HubContext";
import { normalizeQuery, queryParams, paginationWindow } from "../services/catalog";
import { navigate, readRoute, useAsync } from "../hooks/useHub";
import { ReportCollection } from "../components/Reports";
import { Empty, ErrorState, PageHeader } from "../components/Workspace";
import { CatalogSkeleton, RefreshBar } from "../components/Skeleton";

const pageSize = 20;

/**
 * The report list, in one of two scopes: every report ("reports") or the ones you starred ("favorites").
 * Both share the same toolbar, list and pagination; the shell's search box drives `query.search` for both.
 * Discovery filters belong to the full catalog only — Favorites is a short list you already chose.
 */
export function Catalog({
  page,
  query,
  favorites,
  revision,
  live = false,
  preferences,
  onPreferences,
  onOpen,
  onToggle,
}: {
  page: "reports" | "favorites";
  query: CatalogQuery;
  favorites: string[];
  revision: number;
  live?: boolean;
  preferences: Preferences;
  onPreferences: (p: Preferences) => void;
  onOpen: (id: string, run?: boolean) => void;
  onToggle: (id: string) => void;
}) {
  const { repository, metadata, audience } = useHub();
  const scopedToFavorites = page === "favorites";
  const categories = metadata?.categories ?? [];
  const normalized = normalizeQuery(
    new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])),
    metadata,
    live,
  );
  // Keep showing the current results while a new filter, sort or page loads, rather than blanking the list.
  const result = useAsync(
    () => repository.getReports(normalized, scopedToFavorites ? favorites : undefined),
    [repository, JSON.stringify(normalized), favorites.join(","), page, revision],
    true,
  );
  const refreshing = result.loading && !!result.data;
  // Reports ticked to run together (live reports only). Kept across pages, filters and searches.
  const [selected, setSelected] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (result.data) setNames(previous => ({ ...previous, ...Object.fromEntries(result.data!.items.map(r => [r.id, r.name])) }));
  }, [result.data]);
  const select = (id: string) => setSelected(current => current.includes(id) ? current.filter(other => other !== id)
    : current.length < maxBatch ? [...current, id] : current);
  const runTogether = () => navigate(page, { ...Object.fromEntries(readRoute().params), batch: selected.join(",") });
  /** Change the list's URL state. Reads the live URL, so a search still being typed in the shell is kept. */
  function update(p: Partial<CatalogQuery>, replace = false) {
    const current = normalizeQuery(readRoute().params, metadata, live);
    navigate(page, queryParams({ ...current, ...p, page: p.page ?? 1 }), replace);
  }
  useEffect(() => {
    // Only settle the URL against results for the current query, never against ones kept on screen.
    if (!result.data || result.loading) return;
    const current = normalizeQuery(readRoute().params, metadata, live);
    if (JSON.stringify(current) !== JSON.stringify(normalized)) return;
    const params = queryParams({ ...normalized, page: result.data.page });
    const report = readRoute().params.get("report");
    if (report) params.report = report;
    if (new URLSearchParams(params).toString() !== readRoute().params.toString())
      navigate(page, params, true);
  }, [result.data, page, JSON.stringify(normalized)]);

  const filtered = !!(query.category || query.department || query.type || query.usage);
  const currentPage = result.data?.page ?? normalized.page;
  const pages = result.data?.pages ?? 1;

  const empty = query.search || filtered ? undefined
    : scopedToFavorites
      ? <Empty title="No favorites yet"
          text="Select the star beside any report to keep it here."
          action={<button className="button" onClick={() => navigate("reports")}>Browse reports</button>} />
      : <Empty action={null} {...noReports(audience)} />;

  return (
    <div className="catalog">
      <PageHeader title={scopedToFavorites ? "Favorites" : "Reports"} count={result.data?.total} />

      <div className="catalog-bar">
        {!scopedToFavorites && (
          <div className="filters" role="group" aria-label="Filter reports">
            <Pill label="Filter by category" value={query.category} onChange={category => update({ category })}>
              <option value="">All categories</option>
              {categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
            </Pill>
            {(!live || (metadata?.departments.length ?? 0) > 0) && (
              <Pill label="Filter by department" value={query.department} onChange={department => update({ department })}>
                <option value="">All departments</option>
                {(metadata?.departments ?? []).map(d => <option key={d}>{d}</option>)}
              </Pill>
            )}
            {(!live || (metadata?.reportTypes.length ?? 0) > 1) && (
              <Pill label="Filter by report type" value={query.type} onChange={type => update({ type })}>
                <option value="">All types</option>
                {(metadata?.reportTypes ?? []).map(t => <option key={t}>{t}</option>)}
              </Pill>
            )}
            <Pill label="Filter by usage or date added" value={normalized.usage}
              onChange={usage => update({ usage: usage as CatalogQuery["usage"] })}>
              <option value="">Any usage</option>
              <option value="frequent">Frequently used</option>
              {!live && <option value="new">Recently added</option>}
            </Pill>
            {filtered && (
              <button className="text-button clear-filters"
                onClick={() => update({ category: "", department: "", type: "", usage: "" })}>
                Clear filters
              </button>
            )}
          </div>
        )}
        <div className="catalog-bar-end">
          <Pill label="Sort reports" prefix="Sort" value={normalized.sort}
            onChange={sort => update({ sort: sort as CatalogQuery["sort"] })}>
            <option value="name">Name (A–Z)</option>
            <option value="usage">Most used</option>
            {live ? <option value="updated">Recently updated</option> : <>
              <option value="time">Execution time</option>
              <option value="added">Recently added</option>
            </>}
          </Pill>
          <div className="view-toggle" role="group" aria-label="Report view">
            {([["list", "List view", List], ["grid", "Grid view", Grid2X2]] as const).map(([view, label, Icon]) => (
              <button key={view} aria-label={label} aria-pressed={preferences.view === view}
                className={preferences.view === view ? "active" : ""}
                onClick={() => onPreferences({ ...preferences, view })}>
                <Icon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="catalog-surface" aria-label={scopedToFavorites ? "Favorite reports" : "Reports"}
        aria-busy={result.loading}>
        <RefreshBar active={refreshing} />
        {result.error ? (
          <ErrorState text={result.error} retry={result.retry} />
        ) : !result.data ? (
          <CatalogSkeleton />
        ) : (
          <div className={refreshing ? "is-refreshing" : undefined}>
          <ReportCollection
            items={result.data.items}
            view={preferences.view}
            favorites={favorites}
            onToggle={onToggle}
            onOpen={onOpen}
            empty={empty}
            selected={live ? selected : undefined}
            onSelect={live ? select : undefined}
            selectionFull={selected.length >= maxBatch}
          />
          </div>
        )}
        {pages > 1 && result.data && (
          <nav className="pagination" aria-label="Pagination">
            <span>
              Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, result.data.total)} of{" "}
              {result.data.total} reports
            </span>
            <div>
              <button className="button" aria-label="Previous page" disabled={currentPage <= 1}
                onClick={() => update({ page: currentPage - 1 })}>
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              {paginationWindow(currentPage, pages).map((number, index) =>
                number === "ellipsis" ? (
                  <span key={"gap-" + index} aria-hidden="true">…</span>
                ) : (
                  <button key={number} aria-label={`Page ${number}`}
                    aria-current={currentPage === number ? "page" : undefined}
                    className={`page-number ${currentPage === number ? "active" : ""}`}
                    onClick={() => update({ page: number })}>
                    {number}
                  </button>
                ))}
              <button className="button" aria-label="Next page" disabled={currentPage >= pages}
                onClick={() => update({ page: currentPage + 1 })}>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
          </nav>
        )}
      </section>
      {live && selected.length > 0 && (
        <div className="selection-bar" role="region" aria-label="Selected reports">
          <span className="selection-count"><Layers size={16} aria-hidden="true" />
            <strong>{selected.length}</strong> {selected.length === 1 ? "report" : "reports"} selected
            {selected.length >= maxBatch && <small> (most at once)</small>}</span>
          <span className="selection-names">{selected.map(id => names[id] ?? "Report").join(", ")}</span>
          <button type="button" className="button" onClick={() => setSelected([])}><X size={15} /> Clear</button>
          <button type="button" className="button primary" disabled={selected.length < 2} onClick={runTogether}
            title={selected.length < 2 ? "Select at least two reports" : undefined}>
            <Layers size={15} /> Open together</button>
        </div>
      )}
      {!live && <p className="catalog-footnote">
        Execution times are illustrative estimates.
      </p>}
    </div>
  );
}

/** Why someone sees no reports at all, in their terms: their department decides what they see. */
export function noReports(audience?: Audience): { title: string; text: string } {
  if (!audience || audience.administrator)
    return { title: "No reports yet", text: "Reports appear here once they're published." };
  if (!audience.department)
    return { title: "You're not in a department yet", text: "An administrator assigns you to a department, which decides the reports you can open." };
  return { title: `No reports for ${audience.department} yet`, text: "An administrator assigns reports to your department. They'll appear here." };
}

/** A compact select styled as a pill; the one filter/sort control used across the module. */
function Pill({
  label,
  prefix,
  value,
  onChange,
  children,
}: {
  label: string;
  prefix?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={`pill-select${prefix ? " has-prefix" : ""}`}>
      {prefix && <span className="pill-prefix" aria-hidden="true">{prefix}</span>}
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
