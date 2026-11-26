import { useEffect, useState } from "react";

/**
 * What a report run is doing, as far as the browser can tell:
 * - "working": the request is with the server, which signs in to the database, reads the data and lays out
 *   the pages in that order. The server doesn't report its steps, so the message moves through them at the
 *   pace this report usually takes (its past runs), never claiming a step is finished.
 * - "receiving": the server has answered and the pages are arriving. This one is observed, not estimated.
 */
export type RunPhase = "working" | "receiving";

type Step = { at: number; text: string };

/** The server's steps in their real order, each starting at a share of the usual run time. */
function steps(database: string | null): Step[] {
  return [
    { at: 0, text: "Preparing your report" },
    { at: 0.12, text: database ? `Connecting to ${database}` : "Connecting to the database" },
    { at: 0.3, text: "Reading the data" },
    { at: 0.62, text: "Laying out the pages" },
  ];
}

/** Without history, a report is paced as if it usually took this long. */
const defaultSeconds = 8;
const historyKey = (reportId: string) => `1reports:run-seconds:${reportId}`;

/** How long this report has usually taken here (the last few successful runs), or null before the first. */
export function usualSeconds(reportId: string): number | null {
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey(reportId)) ?? "[]");
    const times = Array.isArray(saved) ? saved.filter((value): value is number => typeof value === "number" && value > 0) : [];
    if (!times.length) return null;
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  } catch {
    return null;
  }
}

/** Remembers a successful run's duration, keeping the last five. */
export function rememberRun(reportId: string, seconds: number) {
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey(reportId)) ?? "[]");
    const times = Array.isArray(saved) ? saved.filter((value): value is number => typeof value === "number") : [];
    localStorage.setItem(historyKey(reportId), JSON.stringify([...times, seconds].slice(-5)));
  } catch { /* storage full or blocked: pacing falls back to the default */ }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** The message for this moment of a run. */
export function runMessage(phase: RunPhase, elapsedSeconds: number, usual: number | null, database: string | null) {
  if (phase === "receiving") return { text: "Almost there — opening the pages", slow: false };
  const pace = usual ?? defaultSeconds;
  const share = elapsedSeconds / pace;
  const current = [...steps(database)].reverse().find(step => share >= step.at)!;
  // Well past the usual time the step stays, with an honest note that this run is slower.
  const slow = elapsedSeconds >= Math.max(20, pace * 2);
  return { text: current.text, slow };
}

function seconds(value: number) {
  return value < 60 ? `${value}s` : `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s`;
}

/**
 * The report-run status: a small page being set line by line, a message for what is happening now (it
 * changes with a soft cross-fade), what is being run, and the time so far against the usual time.
 */
export function RunProgress({ reportId, startedAt, phase, database, context, onCancel, compact = false }: {
  reportId: string;
  startedAt: number;
  phase: RunPhase;
  /** The database's name, when the person may see it (administrators), else null. */
  database: string | null;
  /** The parameter values, briefly ("Date 01 Nov 2026 · EstCode E-1043"). */
  context: string;
  onCancel: () => void;
  /** A slim strip above an earlier result that stays on screen while the new one is generated. */
  compact?: boolean;
}) {
  const now = useNow(true);
  const [usual] = useState(() => usualSeconds(reportId));
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const { text, slow } = runMessage(phase, elapsed, usual, database);

  if (compact) return (
    <div className="run-strip" role="status" aria-live="polite">
      <div className={`run-sheet small${phase === "receiving" ? " done" : ""}`} aria-hidden="true"><span /><span /><span /></div>
      <p className="run-message" key={text}>
        {text}<span className="run-ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
      </p>
      <span className="run-strip-note" aria-live="off">
        {slow ? "Taking longer than usual · " : "Updating the report · "}{seconds(elapsed)}
      </span>
      <button type="button" className="button run-cancel" onClick={onCancel}>Cancel</button>
      <span className="run-strip-bar" aria-hidden="true" />
    </div>
  );

  return (
    <div className="run-progress" role="status" aria-live="polite" aria-atomic="false">
      <div className={`run-sheet${phase === "receiving" ? " done" : ""}`} aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      {/* Only the message is announced, once per change; the timer below is not. */}
      <p className="run-message" key={text}>
        {text}<span className="run-ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
      </p>
      <p className={`run-note${slow ? " visible" : ""}`} aria-hidden={!slow}>
        {slow ? "This run is taking longer than usual. Larger ranges of data take more time." : " "}
      </p>
      {context && <p className="run-context" aria-live="off">{context}</p>}
      <p className="run-time" aria-live="off">
        <span>{seconds(elapsed)}</span>
        {usual !== null && <span className="run-usual"> · usually about {seconds(Math.max(1, Math.round(usual)))}</span>}
      </p>
      <button type="button" className="button run-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}
