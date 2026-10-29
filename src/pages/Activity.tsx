import { useState } from "react";
import { Activity as ActivityIcon, ArrowRight } from "lucide-react";
import type { ActivityRecord } from "../types";
import { eventLabels } from "../data/activityLabels";
import {
  PageHeading,
  Loading,
  ErrorState,
  Empty,
} from "../components/Workspace";
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
  return (
    <>
      <PageHeading
        title="My Activity"
        description="Your prototype interactions and sample events. This is not a company audit log."
      />
      <section className="panel">
        <div className="activity-filters">
          <label>
            Event type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All events</option>
              {Object.entries(eventLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            From date
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <button
            className="text-button"
            onClick={() => {
              setKind("");
              setFrom("");
            }}
          >
            Clear filters
          </button>
          <span className="muted small">{filtered.length} events</span>
        </div>
        {error ? (
          <ErrorState text={error} retry={retry} />
        ) : loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty
            title="No activity matches"
            text="Adjust your filters or explore a report to create prototype activity."
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
                  {a.source === "seed"
                    ? "Sample event"
                    : a.kind.startsWith("demo")
                      ? "Simulated execution"
                      : "Prototype event"}
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
