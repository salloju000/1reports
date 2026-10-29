import { ArrowRight, FileText } from "lucide-react";
import {
  PageHeading,
  Loading,
  ErrorState,
  Empty,
} from "../components/Workspace";
import { useHub } from "../services/HubContext";
import { useAsync } from "../hooks/useHub";
import { eventLabels } from "../data/activityLabels";

export function RecentPage({
  revision,
  onOpen,
}: {
  revision: number;
  onOpen: (id: string) => void;
}) {
  const { repository } = useHub();
  const result = useAsync(
    () => repository.getRecentReports(),
    [repository, revision],
  );
  return (
    <>
      <PageHeading
        title="Recent Reports"
        description="Return to reports you have explored. Includes clearly labeled sample history."
      />
      {result.error ? (
        <ErrorState text={result.error} retry={result.retry} />
      ) : !result.data ? (
        <Loading />
      ) : (
        <section className="panel">
          {!result.data.length ? (
            <Empty
              title="No recent reports"
              text="Open a report from the catalog to start your history."
            />
          ) : (
            result.data.map((item) => (
              <div className="history-row" key={item.report.id}>
                <span className="file-icon blue">
                  <FileText size={19} />
                </span>
                <div>
                  <button
                    className="report-name"
                    onClick={() => onOpen(item.report.id)}
                  >
                    {item.report.name}
                  </button>
                  <p>
                    {item.categoryName} · {eventLabels[item.status]}
                  </p>
                </div>
                <time dateTime={item.accessedAt}>
                  {new Date(item.accessedAt).toLocaleString("en-IN")}
                </time>
                <span
                  className={`tag ${item.status.startsWith("demo") ? "orange" : "slate"}`}
                >
                  {item.source === "seed"
                    ? "Sample history · "
                    : "Prototype · "}
                  {item.status.startsWith("demo")
                    ? "Simulated execution"
                    : "Viewed"}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Reopen ${item.report.name}`}
                  onClick={() => onOpen(item.report.id)}
                >
                  <ArrowRight size={17} />
                </button>
              </div>
            ))
          )}
        </section>
      )}
    </>
  );
}
