import { useEffect, useRef } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Play,
  Star,
  X,
} from "lucide-react";
import type { Report } from "../types";
import { useHub } from "../services/HubContext";
import { ParameterForm } from "../features/reports/ParameterForm";
import { useDemoExecution } from "../features/reports/useDemoExecution";
import { useMediaQuery } from "../hooks/useMediaQuery";
export const date = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
export function Favorite({
  report,
  favorites,
  onToggle,
}: {
  report: Report;
  favorites: string[];
  onToggle: (id: string) => void;
}) {
  const active = favorites.includes(report.id);
  return (
    <button
      className={`icon-button favorite ${active ? "selected" : ""}`}
      aria-label={`${active ? "Remove" : "Add"} ${report.name} ${active ? "from" : "to"} favorites`}
      aria-pressed={active}
      onClick={() => onToggle(report.id)}
    >
      <Star size={17} fill={active ? "currentColor" : "none"} />
    </button>
  );
}
type CollectionProps = {
  items: Report[];
  view: "list" | "grid";
  favorites: string[];
  onToggle: (id: string) => void;
  onOpen: (id: string, run?: boolean) => void;
};
export function ReportCollection({
  items,
  view,
  favorites,
  onToggle,
  onOpen,
}: CollectionProps) {
  const { metadata } = useHub();
  const mobile = useMediaQuery("(max-width: 760px)");
  if (!items.length)
    return (
      <div className="empty">
        <FileText size={30} />
        <h3>No reports found</h3>
        <p>Try another search or clear your filters to explore the catalog.</p>
      </div>
    );
  const category = (r: Report) =>
    metadata?.categories.find((c) => c.id === r.categoryId);
  const identity = (r: Report) => (
    <div className="report-identity">
      <span className={`file-icon ${category(r)?.color ?? "blue"}`}>
        <FileText size={19} />
      </span>
      <div>
        <button className="report-name" onClick={() => onOpen(r.id)}>
          {r.name}
        </button>
        <p>{r.description}</p>
      </div>
    </div>
  );
  const tag = (r: Report) => (
    <span className={`tag ${category(r)?.color ?? "blue"}`}>
      {category(r)?.name ?? r.categoryId}
    </span>
  );
  const actions = (r: Report) => (
    <div className="row-actions">
      <button
        className="icon-button run-demo"
        aria-label={`Run report demo: ${r.name}`}
        title="Run report demo"
        onClick={() => onOpen(r.id, true)}
      >
        <Play size={16} />
      </button>
      <button
        className="icon-button"
        aria-label={`Open ${r.name} details`}
        onClick={() => onOpen(r.id)}
      >
        <ArrowRight size={17} />
      </button>
    </div>
  );
  const cards = (className: string) => (
    <div className={className}>
      {items.map((r) => (
        <article key={r.id} className="report-item grid">
          {identity(r)}
          <span className="report-code">{r.code}</span>
          <span>{tag(r)}</span>
          <span className="execution-time">
            <Clock3 size={13} />
            {r.typicalExecutionTimeSeconds}s
          </span>
          <div className="card-actions">
            <Favorite report={r} favorites={favorites} onToggle={onToggle} />
            {actions(r)}
          </div>
        </article>
      ))}
    </div>
  );
  if (view === "grid") return cards("report-grid");
  if (mobile) return cards("mobile-report-list");
  return (
    <>
      <div className="report-table-wrap desktop-report-list">
        <table className="semantic-report-table">
          <caption className="sr-only">Report catalog results</caption>
          <thead>
            <tr>
              {[
                "Report name",
                "Report code",
                "Category",
                "Type",
                "Typical time",
                "Updated",
                "Favorite",
                "Actions",
              ].map((title) => (
                <th scope="col" key={title}>
                  {title === "Favorite" ? (
                    <>
                      <Star size={14} aria-hidden="true" />
                      <span className="sr-only">Favorite</span>
                    </>
                  ) : (
                    title
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{identity(r)}</td>
                <td>
                  <span className="report-code">{r.code}</span>
                </td>
                <td>{tag(r)}</td>
                <td>
                  <span className="type-label">{r.reportType}</span>
                </td>
                <td>
                  <span className="execution-time">
                    <Clock3 size={13} />
                    {r.typicalExecutionTimeSeconds}s
                  </span>
                </td>
                <td>
                  <time className="updated" dateTime={r.updatedAt}>
                    {date(r.updatedAt)}
                  </time>
                </td>
                <td>
                  <Favorite
                    report={r}
                    favorites={favorites}
                    onToggle={onToggle}
                  />
                </td>
                <td>{actions(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
export function Details({
  report,
  onClose,
  favorites,
  onToggle,
  onChange,
  focusParameters = false,
}: {
  report: Report;
  onClose: () => void;
  favorites: string[];
  onToggle: (id: string) => void;
  onChange: () => void;
  focusParameters?: boolean;
}) {
  const { repository, metadata } = useHub();
  const dialog = useRef<HTMLDialogElement>(null);
  const parameterSection = useRef<HTMLElement>(null);
  const demo = useDemoExecution(report, repository, onChange);
  const previousState = useRef(demo.state);
  useEffect(() => {
    if (previousState.current === demo.state) return;
    previousState.current = demo.state;
    const selector =
      demo.state === "processing"
        ? "[data-demo-next]"
        : demo.state === "success"
          ? "[data-demo-result]"
          : "input,select";
    dialog.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [demo.state]);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current;
    element?.showModal();
    if (focusParameters) {
      parameterSection.current?.scrollIntoView?.({ block: "start" });
      parameterSection.current
        ?.querySelector<HTMLElement>("input,select")
        ?.focus();
    }
    return () => {
      element?.close?.();
      if (previous?.isConnected) previous.focus();
      else
        document
          .querySelector<HTMLElement>(
            "#main-content input, #main-content button, #main-content",
          )
          ?.focus();
    };
  }, []);
  useEffect(() => {
    if (focusParameters)
      parameterSection.current
        ?.querySelector<HTMLElement>("input,select")
        ?.focus();
  }, [focusParameters]);
  useEffect(() => {
    if (Object.keys(demo.errors).length)
      dialog.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [demo.errors]);
  const category = metadata?.categories.find((c) => c.id === report.categoryId);
  return (
    <dialog
      ref={dialog}
      className="details-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="details-title"
    >
      <div className="details-content">
        <div className="details-top">
          <span className="eyebrow">
            REPORT DETAILS <span> / {report.code}</span>
          </span>
          <button
            className="icon-button"
            aria-label="Close report details"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="detail-title">
          <span className={`file-icon large ${category?.color ?? "blue"}`}>
            <FileText size={27} />
          </span>
          <Favorite report={report} favorites={favorites} onToggle={onToggle} />
        </div>
        <h2 id="details-title">{report.name}</h2>
        <p className="muted">{report.description}</p>
        <dl className="metadata">
          <div>
            <dt>Category</dt>
            <dd>{category?.name ?? report.categoryId}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{report.department}</dd>
          </div>
          <div>
            <dt>Report owner</dt>
            <dd>{report.owner}</dd>
          </div>
          <div>
            <dt>Typical execution</dt>
            <dd>
              {report.typicalExecutionTimeSeconds} seconds · sample estimate
            </dd>
          </div>
          <div>
            <dt>Output formats</dt>
            <dd>{report.outputFormats.join(", ")}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{date(report.updatedAt)}</dd>
          </div>
        </dl>
        <div className="demo-note">
          <strong>Frontend demonstration</strong>
          <p>
            No connection to EFI Radius or Crystal Reports. Parameters and
            output are sample data.
          </p>
        </div>
        <section ref={parameterSection} aria-labelledby="parameter-heading">
          <h3 id="parameter-heading">Report parameters</h3>
          <p className="muted small">
            Choose the scope for your demonstration. * Required
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void demo.advance("run");
            }}
          >
            <ParameterForm
              parameters={report.parameters}
              values={demo.values}
              errors={demo.errors}
              disabled={demo.state !== "idle" || demo.busy}
              onChange={demo.changeValue}
            />
            {demo.state === "idle" && (
              <button
                className="button primary wide"
                type="submit"
                disabled={demo.busy}
              >
                <Play size={15} />
                Run demonstration
              </button>
            )}
          </form>
        </section>
        {demo.state === "processing" && (
          <div className="execution-box" role="status">
            <span className="demo-status">
              <Clock3 size={22} />
            </span>
            <h3>Demo processing state</h3>
            <p>
              No job is running. Continue when you are ready to inspect the
              sample output.
            </p>
            <button
              data-demo-next
              disabled={demo.busy}
              className="button primary"
              onClick={() => void demo.advance("complete")}
            >
              Show demo result
              <ArrowRight size={15} />
            </button>
            <button
              disabled={demo.busy}
              className="button"
              onClick={() => void demo.advance("reset")}
            >
              Cancel demo
            </button>
          </div>
        )}
        {demo.state === "success" && demo.preview && (
          <section className="preview" aria-live="polite">
            <div className="success-title" data-demo-result tabIndex={-1}>
              <CheckCircle2 size={20} />
              <strong>Demonstration complete</strong>
            </div>
            <p className="muted small">
              Illustrative sample output — not a Crystal Report. Values are
              unrelated to your parameters.
            </p>
            <div className="sample-paper">
              <span className="eyebrow">SAMPLE PREVIEW</span>
              <h3>{report.name}</h3>
              <p>{demo.preview.company}</p>
              <table>
                <caption className="sr-only">
                  Category-specific demonstration output
                </caption>
                <thead>
                  <tr>
                    {demo.preview.columns.map((column) => (
                      <th scope="col" key={column}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {demo.preview.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((value, column) => (
                        <td key={column}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="export-actions">
              {report.outputFormats.map((format) => (
                <button
                  key={format}
                  className="button"
                  onClick={() =>
                    demo.setNotice(
                      `${format} export is unavailable in this frontend demonstration. No file has been generated.`,
                    )
                  }
                >
                  <ArrowDownToLine size={15} />
                  {format} · demo only
                </button>
              ))}
              <button
                disabled={demo.busy}
                className="text-button"
                onClick={() => void demo.advance("reset")}
              >
                Reset demo
              </button>
            </div>
          </section>
        )}
        {demo.failure && (
          <p role="alert" className="field-error">
            {demo.failure}
          </p>
        )}
        {demo.notice && (
          <p role="status" className="demo-note">
            {demo.notice}
          </p>
        )}
      </div>
    </dialog>
  );
}
