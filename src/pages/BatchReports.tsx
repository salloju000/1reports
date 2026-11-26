import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Check, Clock3, Layers, Play, X } from "lucide-react";
import { CrystalReports, type RunStatus } from "./CrystalReports";
import { useHub } from "../services/HubContext";
import { useBlockingOperation } from "../services/operations";
import { ReportGlyph } from "../components/ReportGlyph";

/** The most reports one workspace holds. */
export const maxBatch = 8;
/**
 * How many run at the same time. The server renders two reports at once and turns a third away as busy
 * (Crystal `renders` in server/CrystalReports.cs), so the rest wait here for a free slot instead.
 */
const parallel = 2;

type Status = RunStatus | "queued" | "starting";

const statusText: Record<Status, string> = {
  loading: "Opening", idle: "Not run yet", queued: "Waiting its turn", starting: "Starting", running: "Generating",
  done: "Ready", failed: "Didn't run", invalid: "Needs parameters", blocked: "Can't run",
};

/**
 * Several reports side by side, one tab each. Each keeps its own parameters and results; "Run all" runs every
 * one with its current parameters, two at a time. A report whose parameters are incomplete is skipped and
 * marked, so the others still run.
 */
export function BatchReports({ ids, onClose, onRemove, onActivity }: {
  ids: string[]; onClose: () => void; onRemove: (id: string) => void; onActivity: () => void;
}) {
  const { repository } = useHub();
  const [names, setNames] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [tokens, setTokens] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [active, setActive] = useState(ids[0]);
  const running = useBlockingOperation();

  useEffect(() => {
    let current = true;
    void Promise.all(ids.map(id => repository.getReport(id).then(report => [id, report?.name ?? "Report"] as const,
      () => [id, "Report"] as const))).then(entries => { if (current) setNames(Object.fromEntries(entries)); });
    return () => { current = false; };
  }, [repository, ids.join(",")]);
  useEffect(() => { if (!ids.includes(active)) setActive(ids[0]); }, [ids.join(","), active]);

  const status = (id: string): Status => statuses[id] ?? "loading";
  // Start queued reports while there is a free slot.
  useEffect(() => {
    if (!queue.length) return;
    const busy = ids.filter(id => ["running", "starting"].includes(status(id))).length;
    if (busy >= parallel) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    if (!ids.includes(next)) return;
    setStatuses(previous => ({ ...previous, [next]: "starting" }));
    setTokens(previous => ({ ...previous, [next]: (previous[next] ?? 0) + 1 }));
  }, [queue, statuses, ids.join(",")]);

  const runnable = ids.filter(id => !["loading", "blocked", "running", "starting", "queued"].includes(status(id)));
  const stillOpening = ids.some(id => status(id) === "loading");
  const runAll = () => {
    setQueue(previous => [...previous, ...runnable]);
    setStatuses(previous => ({ ...previous, ...Object.fromEntries(runnable.map(id => [id, "queued" as Status])) }));
  };
  const counts = { done: ids.filter(id => status(id) === "done").length,
    working: ids.filter(id => ["running", "starting", "queued"].includes(status(id))).length,
    attention: ids.filter(id => ["invalid", "failed"].includes(status(id))).length };

  return <div className="rv-page batch-page">
    <header className="rv-header">
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li><button className="crumb-link" onClick={onClose} disabled={!!running}
            title={running ? "Available when the reports are ready" : undefined}>
            <ArrowLeft size={14} aria-hidden="true" /> Reports</button></li>
        </ol>
      </nav>
      <div className="batch-head">
        <h1><Layers size={18} aria-hidden="true" /> Run {ids.length} reports</h1>
        <p className="batch-intro">Fill in each tab's parameters, then <strong>Run all</strong>. {parallel} run at a time.</p>
        <p className="batch-summary" role="status">
          {counts.working > 0 && <span>{counts.working} in progress</span>}
          {counts.done > 0 && <span className="ok">{counts.done} ready</span>}
          {counts.attention > 0 && <span className="warn">{counts.attention} need attention</span>}
        </p>
        <button type="button" className="button primary" onClick={runAll} disabled={!runnable.length || stillOpening}
          title={stillOpening ? "Available once every report has opened" : undefined}>
          <Play size={15} /> Run all{runnable.length && runnable.length !== ids.length ? ` (${runnable.length})` : ""}</button>
      </div>
      <div className="batch-tabs" role="tablist" aria-label="Selected reports">
        {ids.map(id => {
          const state = status(id);
          return <div key={id} className={`batch-tab ${state}`} data-active={id === active || undefined}>
            <button role="tab" id={`batch-tab-${id}`} aria-selected={id === active} aria-controls={`batch-panel-${id}`}
              onClick={() => setActive(id)}>
              <ReportGlyph name={names[id] ?? ""} size={20} />
              <span className="batch-tab-text">
                <strong>{names[id] ?? "Report"}</strong>
                <small><StatusIcon status={state} /> {statusText[state]}</small>
              </span>
            </button>
            {ids.length > 1 && <button type="button" className="icon-button batch-tab-remove"
              aria-label={`Remove ${names[id] ?? "report"} from this set`}
              disabled={["running", "starting"].includes(state)} onClick={() => onRemove(id)}><X size={13} /></button>}
          </div>;
        })}
      </div>
    </header>
    {/* Every report stays open (hidden when not shown), so each keeps running while you look at another. */}
    {ids.map(id => <section key={id} id={`batch-panel-${id}`} role="tabpanel" aria-labelledby={`batch-tab-${id}`}
      hidden={id !== active} className="batch-panel">
      <CrystalReports reportId={id} returnLabel="Back to reports" onClose={onClose} onActivity={onActivity} embedded
        runToken={tokens[id] ?? 0}
        onStatus={next => setStatuses(previous => previous[id] === next ? previous : { ...previous, [id]: next })} />
    </section>)}
  </div>;
}

function StatusIcon({ status }: { status: Status }) {
  if (["running", "starting"].includes(status)) return <span className="spinner" aria-hidden="true" />;
  if (status === "done") return <Check size={12} aria-hidden="true" />;
  if (["failed", "invalid", "blocked"].includes(status)) return <AlertCircle size={12} aria-hidden="true" />;
  if (status === "queued") return <Clock3 size={12} aria-hidden="true" />;
  return null;
}
