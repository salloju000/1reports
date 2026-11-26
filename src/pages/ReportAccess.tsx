import { useMemo, useRef, useState, type DragEvent } from "react";
import { Check, ChevronDown, GripVertical, Search, Users, X } from "lucide-react";
import { ErrorState, PageHeader } from "../components/Workspace";
import { ReportAccessSkeleton } from "../components/Skeleton";
import { ReportGlyph } from "../components/ReportGlyph";
import { navigate, useAsync } from "../hooks/useHub";
import {
  FormError, reportAccess, type Assignments, type DepartmentCollection, type LibraryReport,
} from "../services/people";

/** What is being dragged: a report from the library, or a report out of one department's collection. */
type Drag = { reportId: string; from?: string };
const dragType = "application/x-efi-report";

/**
 * Which reports each department's people can open. The library on the left is every published report;
 * each department on the right holds its own collection. Dropping a report into a department copies it
 * there — the library and every other department are untouched. Dragging between departments moves it
 * (hold Ctrl to copy instead); dragging a report back to the library takes it out of that department.
 * Everything can also be done without a mouse from each report's "Departments" button.
 */
export function ReportAccessPage({ params }: { params: URLSearchParams }) {
  const [revision, setRevision] = useState(0);
  const loaded = useAsync(() => reportAccess.list(), [revision]);
  // Local copy of the collections, updated optimistically while requests are in flight.
  const [edited, setEdited] = useState<{ revision: number; departments: DepartmentCollection[] }>();
  const [drag, setDrag] = useState<Drag>();
  const [over, setOver] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const queue = useRef(Promise.resolve());
  const [saving, setSaving] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);

  const data: Assignments | undefined = loaded.data && {
    ...loaded.data,
    departments: edited?.revision === revision ? edited.departments : loaded.data.departments,
  };
  const reports = data?.reports ?? [];
  const departments = data?.departments ?? [];
  const byId = useMemo(() => new Map(reports.map(report => [report.id, report])), [reports]);
  const holders = useMemo(() => {
    const map = new Map<string, DepartmentCollection[]>();
    for (const department of departments)
      for (const id of department.reportIds) map.set(id, [...(map.get(id) ?? []), department]);
    return map;
  }, [departments]);

  const search = (params.get("search") ?? "").trim().toLowerCase();
  const category = params.get("category") ?? "";
  const unassignedOnly = params.get("show") === "unassigned";
  const categories = [...new Set(reports.map(report => report.category).filter(Boolean))].sort();
  const available = reports.filter(report =>
    (!search || `${report.name} ${report.category}`.toLowerCase().includes(search)) &&
    (!category || report.category === category) &&
    (!unassignedOnly || !holders.get(report.id)?.length));
  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    navigate("access", Object.fromEntries(next), true);
  };

  /** Applies a change locally at once, then saves it; requests run one at a time, and a failure reloads. */
  function change(describe: string, update: (rows: DepartmentCollection[]) => DepartmentCollection[], save: () => Promise<void>) {
    setError("");
    setEdited({ revision, departments: update(departments) });
    setAnnouncement(describe);
    setSaving(count => count + 1);
    queue.current = queue.current.then(save).then(() => setSavedOnce(true)).catch((failure: unknown) => {
      setError(failure instanceof FormError ? failure.message : "That change couldn't be saved. The board has been reloaded.");
      setAnnouncement("");
      setEdited(undefined);
      setRevision(value => value + 1);
    }).finally(() => setSaving(count => count - 1));
  }
  const name = (id: string) => byId.get(id)?.name ?? "Report";
  const departmentName = (id: string) => departments.find(row => row.id === id)?.name ?? "department";
  const add = (rows: DepartmentCollection[], department: string, report: string) => rows.map(row =>
    row.id === department && !row.reportIds.includes(report) ? { ...row, reportIds: [...row.reportIds, report] } : row);
  const drop = (rows: DepartmentCollection[], department: string, report: string) => rows.map(row =>
    row.id === department ? { ...row, reportIds: row.reportIds.filter(id => id !== report) } : row);

  function assign(department: string, report: string) {
    if (departments.find(row => row.id === department)?.reportIds.includes(report)) {
      setAnnouncement(`${departmentName(department)} already has ${name(report)}.`);
      return;
    }
    change(`${name(report)} added to ${departmentName(department)}.`,
      rows => add(rows, department, report), () => reportAccess.assign(department, report));
  }
  function unassign(department: string, report: string) {
    change(`${name(report)} removed from ${departmentName(department)}.`,
      rows => drop(rows, department, report), () => reportAccess.unassign(department, report));
  }
  function move(report: string, from: string, to: string) {
    change(`${name(report)} moved from ${departmentName(from)} to ${departmentName(to)}.`,
      rows => drop(add(rows, to, report), from, report), () => reportAccess.move(report, from, to));
  }

  // ── Drag and drop ──
  function start(event: DragEvent, value: Drag) {
    event.dataTransfer.setData(dragType, JSON.stringify(value));
    event.dataTransfer.setData("text/plain", name(value.reportId));
    event.dataTransfer.effectAllowed = value.from ? "copyMove" : "copy";
    setDrag(value);
  }
  function end() {
    setDrag(undefined);
    setOver(undefined);
  }
  function read(event: DragEvent): Drag | undefined {
    try {
      return drag ?? JSON.parse(event.dataTransfer.getData(dragType));
    } catch {
      return undefined;
    }
  }
  /** Copy when coming from the library or when Ctrl/Alt is held; otherwise a department-to-department drag moves. */
  const copying = (event: DragEvent, value?: Drag) => !value?.from || event.ctrlKey || event.altKey;
  const zone = (target: string, onDrop: (value: Drag, event: DragEvent) => void, accepts: (value?: Drag) => boolean) => ({
    onDragOver: (event: DragEvent) => {
      if (!accepts(drag)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = target === "library" ? "move" : copying(event, drag) ? "copy" : "move";
      if (over !== target) setOver(target);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(current => current === target ? undefined : current);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const value = read(event);
      end();
      if (value && accepts(value)) onDrop(value, event);
    },
  });
  const departmentZone = (department: DepartmentCollection) => zone(department.id, (value, event) => {
    if (value.from === department.id) return;
    if (value.from && !copying(event, value)) move(value.reportId, value.from, department.id);
    else assign(department.id, value.reportId);
  }, value => !value || value.from !== department.id);
  const libraryZone = zone("library", value => { if (value.from) unassign(value.from, value.reportId); },
    value => !!value?.from);

  if (loaded.error && !loaded.data) return <><PageHeader title="Report access" /><ErrorState text={loaded.error} retry={loaded.retry} /></>;
  if (!data) return <div className="access"><PageHeader title="Report access" /><ReportAccessSkeleton /></div>;

  const dropping = drag?.from ? "Drop on a department to move it (hold Ctrl to copy), or back here to remove it"
    : "Drop on a department to give its people access";

  return (
    <div className="access">
      <PageHeader title="Report access" />
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {error && <p className="error-banner" role="alert">{error}</p>}

      <div className="access-layout">
        <section className={`access-library${over === "library" ? " drop-over" : ""}${drag?.from ? " drop-ready" : ""}`}
          aria-labelledby="library-title" {...libraryZone}>
          <header className="access-library-head">
            <h2 id="library-title">Available reports <span className="count">{available.length}</span></h2>
            <div className="access-filters">
              {categories.length > 1 && (
                <label className="pill-select">
                  <select aria-label="Filter by category" value={category} onChange={event => setFilter("category", event.target.value)}>
                    <option value="">All categories</option>
                    {categories.map(item => <option key={item}>{item}</option>)}
                  </select>
                </label>
              )}
              <label className="pill-select">
                <select aria-label="Filter by department access" value={unassignedOnly ? "unassigned" : ""}
                  onChange={event => setFilter("show", event.target.value)}>
                  <option value="">Any access</option>
                  <option value="unassigned">In no department</option>
                </select>
              </label>
            </div>
          </header>
          {drag?.from && <p className="access-drop-hint" aria-hidden="true">Drop here to remove from {departmentName(drag.from)}</p>}
          {available.length === 0 ? (
            <p className="access-empty">{reports.length ? "No reports match." : "No reports are published yet."}</p>
          ) : (
            <ul className="access-reports">
              {available.map(report => {
                const access = holders.get(report.id) ?? [];
                const open = expanded === report.id;
                return (
                  <li key={report.id} className={`access-report${drag?.reportId === report.id && !drag.from ? " dragging" : ""}`}
                    draggable onDragStart={event => start(event, { reportId: report.id })} onDragEnd={end}>
                    <div className="access-report-main">
                      <GripVertical size={14} className="grip" aria-hidden="true" />
                      <ReportGlyph name={report.name} size={26} />
                      <div className="access-report-text">
                        <strong title={report.name}>{report.name}</strong>
                        <span>{report.category}</span>
                      </div>
                      <button className="button small-button" aria-expanded={open} aria-controls={`access-${report.id}`}
                        aria-label={`Departments for ${report.name}`} onClick={() => setExpanded(open ? undefined : report.id)}>
                        {access.length || "None"} <ChevronDown size={13} aria-hidden="true" />
                      </button>
                    </div>
                    <AccessSummary access={access} />
                    {open && (
                      <DepartmentPicker id={`access-${report.id}`} report={report} departments={departments}
                        onChange={(departmentId, add) => add ? assign(departmentId, report.id) : unassign(departmentId, report.id)} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="access-board" aria-labelledby="board-title">
          <header className="access-board-head">
            <h2 id="board-title">Departments</h2>
            {saving > 0 ? <span className="save-status"><span className="spinner" aria-hidden="true" /> Saving…</span>
              : savedOnce && <span className="save-status"><Check size={13} aria-hidden="true" /> All changes saved</span>}
            <p>{drag ? dropping : "Drag reports onto a department. Its people can then open and run them."}</p>
          </header>
          <div className="access-departments">
            {departments.map(department => (
              <DepartmentCard key={department.id} department={department} reports={byId}
                over={over === department.id} dragging={drag}
                zone={departmentZone(department)}
                onDragStart={(event, reportId) => start(event, { reportId, from: department.id })}
                onDragEnd={end}
                onRemove={reportId => unassign(department.id, reportId)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * The keyboard-friendly way to choose which departments can open a report: a compact checklist, with a
 * filter once there are more departments than fit comfortably at a glance.
 */
function DepartmentPicker({ id, report, departments, onChange }: {
  id: string;
  report: LibraryReport;
  departments: DepartmentCollection[];
  onChange: (departmentId: string, add: boolean) => void;
}) {
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLowerCase();
  const shown = term ? departments.filter(department => department.name.toLowerCase().includes(term)) : departments;
  const selected = departments.filter(department => department.reportIds.includes(report.id)).length;
  return (
    <fieldset id={id} className="access-picker">
      <legend className="sr-only">Departments that can open {report.name}</legend>
      <div className="access-picker-head" aria-hidden="true">
        <span>Departments</span>
        <span>{selected} of {departments.length} selected</span>
      </div>
      {departments.length > 8 && (
        <label className="access-picker-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={filter} placeholder="Find a department" aria-label="Find a department"
            onChange={event => setFilter(event.target.value)} />
        </label>
      )}
      <div className="access-picker-list">
        {shown.map(department => {
          const has = department.reportIds.includes(report.id);
          return (
            <label key={department.id} className={`access-picker-option${has ? " checked" : ""}`}>
              <input type="checkbox" checked={has} onChange={() => onChange(department.id, !has)} />
              <span title={department.name}>{department.name}</span>
            </label>
          );
        })}
        {!shown.length && <p className="access-picker-empty">No department matches “{filter.trim()}”.</p>}
      </div>
    </fieldset>
  );
}

/** Which departments can already open a report, at a glance. */
function AccessSummary({ access }: { access: DepartmentCollection[] }) {
  if (!access.length) return <p className="access-summary none">In no department</p>;
  const shown = access.slice(0, 3);
  return (
    <ul className="access-summary" aria-label="Departments with access">
      {shown.map(department => <li key={department.id}>{department.name}</li>)}
      {access.length > shown.length && <li className="more">+{access.length - shown.length}</li>}
    </ul>
  );
}

function DepartmentCard({ department, reports, over, dragging, zone, onDragStart, onDragEnd, onRemove }: {
  department: DepartmentCollection;
  reports: Map<string, LibraryReport>;
  over: boolean;
  dragging?: Drag;
  zone: Record<string, (event: DragEvent) => void>;
  onDragStart: (event: DragEvent, reportId: string) => void;
  onDragEnd: () => void;
  onRemove: (reportId: string) => void;
}) {
  const held = department.reportIds.map(id => reports.get(id)).filter((report): report is LibraryReport => !!report)
    .sort((left, right) => left.name.localeCompare(right.name));
  const duplicate = !!dragging && dragging.from !== department.id && department.reportIds.includes(dragging.reportId);
  const target = !!dragging && dragging.from !== department.id;
  return (
    <section className={`access-department${over ? " drop-over" : ""}${target ? " drop-ready" : ""}${duplicate ? " has-it" : ""}`}
      aria-labelledby={`department-${department.id}`} {...zone}>
      <header>
        <h3 id={`department-${department.id}`}>{department.name}</h3>
        <span className="access-department-meta">
          {held.length} {held.length === 1 ? "report" : "reports"}
          <span aria-hidden="true"> · </span>
          <Users size={12} aria-hidden="true" /> <span className="sr-only">People: </span>{department.users}
        </span>
      </header>
      {held.length === 0 ? (
        <p className="access-department-empty">{over ? "Release to add" : "Drop reports here"}</p>
      ) : (
        <ul className={held.length > 3 ? "scrolls" : undefined} tabIndex={held.length > 3 ? 0 : undefined}
          aria-label={`Reports in ${department.name}`}>
          {held.map(report => (
            <li key={report.id} draggable onDragStart={event => onDragStart(event, report.id)} onDragEnd={onDragEnd}
              className={dragging?.from === department.id && dragging.reportId === report.id ? "dragging" : ""}>
              <GripVertical size={12} className="grip" aria-hidden="true" />
              <span title={report.name}>{report.name}</span>
              <button className="icon-button" aria-label={`Remove ${report.name} from ${department.name}`}
                data-tooltip="Remove" onClick={() => onRemove(report.id)}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {duplicate && over && <p className="access-department-note">Already has this report</p>}
    </section>
  );
}
