import { useState } from "react";
import { Activity as ActivityIcon, ArrowRight } from "lucide-react";
import type { ActivityRecord } from "../types";
import { eventLabels } from "../data/activityLabels";
import {
  PageHeader,
  ErrorState,
  Empty,
} from "../components/Workspace";
import { ActivitySkeleton } from "../components/Skeleton";
export function ActivityPage({
  activity,
  error,
  loading,
  retry,
  onOpen,
}: {
  activity: ActivityRecord[];
  error: string;
  loading: boolean;
  retry: () => void;
  onOpen: (id: string) => void;
}) {
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const filtered = activity.filter(
    (a) => (!kind || a.kind === kind) && (!from || a.at.slice(0, 10) >= from),
  );
  // The event types offered are the ones that actually occur, with how often; a choice of one is no choice.
  const kinds = Object.entries(eventLabels)
    .map(([value, label]) => ({ value, label, count: activity.filter((a) => a.kind === value).length }))
    .filter((option) => option.count > 0 || option.value === kind);
  const filtering = !!kind || !!from;
  return (
    <>
      <PageHeader title="Activity" />
      <section className="panel">
        <div className="activity-filters" role="group" aria-label="Filter activity">
          {kinds.length > 1 && (
            <label className="activity-filter">
              <span>Event</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All events</option>
                {kinds.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="activity-filter">
            <span>From</span>
            <input
              type="date"
              value={from}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          {filtering && (
            <button
              className="text-button"
              onClick={() => {
                setKind("");
                setFrom("");
              }}
            >
              Clear filters
            </button>
          )}
          <span className="activity-count" role="status">
            {filtering ? `${filtered.length} of ${activity.length}` : activity.length}{" "}
            {activity.length === 1 ? "event" : "events"}
          </span>
        </div>
        {error ? (
          <ErrorState text={error} retry={retry} />
        ) : loading ? (
          <ActivitySkeleton />
        ) : !filtered.length ? (
          <Empty
            title="No activity matches"
            text="Adjust your filters or open a report to record activity."
          />
        ) : (
          filtered.map((a) => {
            const r = a.report;
            return (
              <div className="history-row" key={a.id}>
                <span className="file-icon slate">
                  <ActivityIcon size={18} />
                </span>
                <div>
                  <button
                    className="report-name"
                    title={r?.name}
                    onClick={() => onOpen(a.reportId)}
                  >
                    {r?.name ?? "Report unavailable"}
                  </button>
                  <p>
                    {eventLabels[a.kind]} · {a.categoryName}
                  </p>
                </div>
                <time>{new Date(a.at).toLocaleString("en-IN")}</time>
                <span
                  className={`tag ${a.kind.startsWith("demo") ? "orange" : "slate"}`}
                >
                  {a.source === "server" ? eventLabels[a.kind] : a.source === "seed"
                    ? "Sample event"
                    : a.kind.startsWith("demo")
                      ? "Simulated execution"
                      : eventLabels[a.kind]}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Reopen ${r?.name ?? "report"}`}
                  onClick={() => onOpen(a.reportId)}
                >
                  <ArrowRight size={17} />
                </button>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
