import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { navigate, readRoute } from "../hooks/useHub";
import { useHub } from "../services/HubContext";
import { defaultQuery } from "../services/catalog";
import { ReportGlyph } from "./ReportGlyph";
import type { Report } from "../types";

/** Pages where the box searches something other than reports, so report suggestions would be wrong. */
const otherLists = new Set(["users", "access"]);
const maxSuggestions = 6;

/** Pages whose list the search box filters in place. Anywhere else, submitting a search opens Reports. */
const listPages = new Set(["reports", "favorites", "users", "access"]);
const labels: Record<string, string> = {
  favorites: "Search favorites", users: "Search users", access: "Search available reports",
};

/**
 * The workspace's one search box. It lives in the shell, so it is in the same place on every page:
 * - on Reports, Favorites, Users or Report access it filters that list as you type (the term is kept in the URL);
 * - anywhere else, Enter opens Reports with the term.
 * "/" focuses it from anywhere; Escape closes the suggestions, then clears it.
 * While typing, matching reports drop down below the box: pick one to open it straight away.
 */
export function ReportSearch({ page, term, paused = false }: {
  page: string; term: string;
  /** While a report is generating a search would close it, so the box waits (and says why). */
  paused?: boolean;
}) {
  const inList = listPages.has(page);
  const [value, setValue] = useState(inList ? term : "");
  const field = useRef<HTMLInputElement>(null);
  const { repository } = useHub();
  const suggesting = !otherLists.has(page) && !paused;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<{ term: string; items: Report[]; total: number; loading: boolean }>(
    { term: "", items: [], total: 0, loading: false });
  const listId = useId();

  // Look up matching reports as the user types (debounced; a newer keystroke discards an older answer).
  const typed = value.trim();
  useEffect(() => {
    if (!suggesting || !open || !typed) return;
    let current = true;
    setSuggestions(previous => ({ ...previous, loading: true }));
    const timer = setTimeout(() => {
      repository.getReports({ ...defaultQuery, search: typed, page: 1 }).then(result => {
        if (current) setSuggestions({ term: typed, items: result.items.slice(0, maxSuggestions), total: result.total, loading: false });
      }, () => { if (current) setSuggestions({ term: typed, items: [], total: 0, loading: false }); });
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [typed, open, suggesting, repository]);
  useEffect(() => setActive(-1), [suggestions.term]);
  const showing = suggesting && open && !!typed && (suggestions.term === typed || suggestions.items.length > 0);
  const items = showing ? suggestions.items : [];
  const openReport = (report: Report) => {
    setOpen(false);
    setValue("");
    navigate("reports", { report: report.id });
  };

  // Follow the URL: a new page, a cleared filter or back/forward all change what the box should say.
  useEffect(() => setValue(inList ? term : ""), [page, term, inList]);

  // Filter the current list as the user types, without adding a history entry per keystroke.
  useEffect(() => {
    if (!inList || value === term) return;
    const timer = setTimeout(() => {
      // If the URL moved on (another page, or the term changed elsewhere), this keystroke is stale.
      const route = readRoute();
      if (route.page !== page || (route.params.get("search") ?? "") !== term) return;
      apply(route.page, route.params, value, true);
    }, 250);
    return () => clearTimeout(timer);
  }, [value, term, page, inList]);

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || field.current?.disabled) return;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (paused) return;
    setOpen(false);
    if (active >= 0 && items[active]) { openReport(items[active]); return; }
    const route = readRoute();
    if (inList) apply(route.page, route.params, value, false);
    else navigate("reports", value.trim() ? { search: value.trim() } : {});
  }
  function clear() {
    setValue("");
    if (inList && term) apply(page, readRoute().params, "", true);
    field.current?.focus();
  }
  const label = labels[page] ?? "Search reports";

  return (
    <form className={`report-search${paused ? " paused" : ""}`} role="search" onSubmit={submit}
      title={paused ? "Search is available when the report is ready" : undefined}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={field}
        type="search"
        aria-label={label}
        disabled={paused}
        placeholder={paused ? "Search paused while generating" : label}
        value={value}
        role={suggesting ? "combobox" : undefined}
        aria-autocomplete={suggesting ? "list" : undefined}
        aria-expanded={suggesting ? showing : undefined}
        aria-controls={suggesting ? listId : undefined}
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={event => { setValue(event.target.value); setOpen(true); }}
        onFocus={() => { if (value.trim()) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onKeyDown={event => {
          if (showing && (event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            // Cycles through the suggestions and back to the typed text (-1).
            setActive(current => (current + 1 + step + items.length + 1) % (items.length + 1) - 1);
            return;
          }
          if (event.key === "Escape" && showing) {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === "Escape" && value) {
            event.preventDefault();
            clear();
          }
        }}
      />
      {value && !paused
        ? <button type="button" className="icon-button" aria-label="Clear search" onClick={clear}><X size={14} /></button>
        : !paused && <kbd aria-hidden="true">/</kbd>}
      {showing && <div className="search-suggestions" onMouseDown={event => event.preventDefault()}>
        <ul id={listId} role="listbox" aria-label="Matching reports">
          {items.map((report, index) => <li key={report.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
            className={index === active ? "active" : undefined} onMouseEnter={() => setActive(index)}
            onClick={() => openReport(report)}>
            <ReportGlyph name={report.name} size={24} />
            <span className="search-suggestion-text">
              <strong><Highlight text={report.name} term={typed} /></strong>
              {(report.code || report.description) && <small>{report.code || report.description}</small>}
            </span>
            <ArrowRight size={14} aria-hidden="true" className="search-suggestion-go" />
          </li>)}
        </ul>
        {!items.length && <p className="search-suggestions-empty">
          {suggestions.loading ? "Searching…" : `No reports match “${typed}”.`}</p>}
        {items.length > 0 && <button type="submit" className="search-suggestions-all" tabIndex={-1}>
          <Search size={13} aria-hidden="true" />
          {suggestions.total > items.length ? `See all ${suggestions.total} results` : "Show in Reports"} for “{typed}”
        </button>}
      </div>}
    </form>
  );
}

/** The report name with the typed text in bold, so it is clear why each suggestion matched. */
function Highlight({ text, term }: { text: string; term: string }) {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + term.length)}</mark>{text.slice(at + term.length)}</>;
}

/** Put a term into a list page's URL: a new search starts at page 1 and closes any open report. */
function apply(page: string, current: URLSearchParams, term: string, replace: boolean) {
  const params = new URLSearchParams(current);
  // Keep the term as typed (a trailing space mid-phrase must survive); the catalog trims when matching.
  if (term.trim()) params.set("search", term);
  else params.delete("search");
  params.delete("page");
  params.delete("report");
  params.delete("batch");
  navigate(page, Object.fromEntries(params), replace);
}
