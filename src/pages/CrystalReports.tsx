import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { apiRequest, ApiError, csrfToken } from "../services/api";
import { workspaceRequest } from "../services/liveRepository";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, CalendarDays, Check, ChevronDown, Clock3, Database, Download, ExternalLink, FileSpreadsheet,
  Eye, FileText, Maximize, Minimize, Plus, Printer, RotateCcw, Search, SlidersHorizontal, Table2, X,
} from "lucide-react";
import { ErrorState } from "../components/Workspace";
import { ReportFormSkeleton, Skeleton } from "../components/Skeleton";
import { DatabaseLoginForm } from "../components/DatabaseLoginForm";
import { useHub } from "../services/HubContext";
import { ReportGlyph } from "../components/ReportGlyph";
import { Modal } from "../components/Dialog";
import { readWorkbook } from "../services/xlsx";
import { PdfViewer } from "../components/PdfViewer";
import { RunProgress, rememberRun, type RunPhase } from "../components/RunProgress";
import { useBlockingOperation, useOperation } from "../services/operations";
import type { Report } from "../types";

type Entry = { id: string; name: string; category: string };
type Prompt = {
  name: string; label: string; kind: string; optional: boolean;
  multiple: boolean; range: boolean; choices: string[];
};
// A database a report uses, as an administrator sees it. People who are not administrators get no
// connection details at all: only whether the report is ready to run.
type Connection = { id: string; label: string; status: "ready" | "needs-login" | "unconfigured" };
// When setupRequired is true the server withholds the prompts: the report cannot run yet.
type Detail = Omit<Entry, "category"> & {
  version: string; prompts: Prompt[]; setupRequired?: boolean; canConfigure?: boolean; connections?: Connection[];
};

type Range = { start: string; end: string };
/** What a parameter holds while it is being filled in. */
type Value = string | string[] | Range | Range[];
type Values = Record<string, Value>;
type Format = "pdf" | "xlsx";

class PromptError extends Error {
  constructor(readonly errors: Record<string, string[]>) {
    super("Check the highlighted report parameters.");
  }
}
class RenderError extends Error {}
/** The report's database login is missing or no longer accepted: only an administrator can fix it. */
class SetupError extends Error {}

const notReady = "An administrator still needs to connect it to its database. Try again later, or contact your "
  + "administrator if you need it now.";
const setupMessages: Record<string, string> = {
  "datasource-needs-setup": notReady,
  "datasource-signin-failed": "Its saved database login is no longer accepted. Please contact your administrator.",
};

const maxRenderRequestBytes = 128 * 1024;
const oversizedRequest = "The report parameters are too large. Reduce the number or length of values.";
// Longer than the server's own limit for a run (Crystal:RenderTimeoutSeconds, 300 s by default), so the
// server's "took too long" answer arrives before the browser gives up. Raise both together.
const runTimeout = 330000;

async function renderReport(report: Detail, values: Record<string, unknown>, format: Format, signal: AbortSignal,
  onReceiving?: () => void) {
  const body = JSON.stringify({
    version: report.version, values, interactionId: crypto.randomUUID(), ...(format === "pdf" ? {} : { format }),
  });
  if (new TextEncoder().encode(body).length > maxRenderRequestBytes) throw new RenderError(oversizedRequest);
  const token = await csrfToken(signal);
  const response = await apiRequest(`reports/${report.id}/render`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
    body,
  });
  if (response.status === 409) throw new ApiError(409);
  const problem = response.ok ? null : await response.json().catch(() => null);
  const code = typeof problem?.code === "string" ? problem.code : "";
  if (Object.hasOwn(setupMessages, code)) throw new SetupError(setupMessages[code]);
  if (code === "datasource-unavailable")
    throw new RenderError("The report's database could not be reached. Try again or contact your administrator.");
  if (response.status === 413) throw new RenderError(oversizedRequest);
  if (response.status === 429) throw new RenderError("The report engine is busy. Try again shortly.");
  if (response.status === 504) throw new RenderError("The report took too long. Try again.");
  if (response.status === 503) throw new RenderError("The report catalog is unavailable. Try again shortly.");
  if (response.status === 403 || response.status === 404)
    throw new RenderError("This report is no longer available to your account.");
  if (response.status === 400 && problem?.errors && typeof problem.errors === "object") {
    const errors = Object.fromEntries(Object.keys(problem.errors).map(name => [
      name, [name === "values" ? "Check the submitted parameters." : "Enter a valid value for this parameter."],
    ]));
    throw new PromptError(errors);
  }
  const type = response.headers.get("Content-Type")?.split(";")[0] ?? "";
  const expected = format === "pdf" ? type === "application/pdf" : /spreadsheetml|ms-excel/.test(type);
  if (!response.ok || !expected)
    throw new RenderError(format === "pdf" ? "The report could not be generated. Try again."
      : "The Excel file could not be prepared. Try again.");
  // The server has finished its work; what is left is receiving the file.
  onReceiving?.();
  return response.blob();
}

/* ---------------------------------------------------------------- parameters */

const isChoice = (prompt: Prompt) => prompt.choices.length > 0;
const isDateKind = (kind: string) => kind === "Date" || kind === "DateTime";

function emptyValue(prompt: Prompt): Value {
  if (prompt.range) return prompt.multiple ? [{ start: "", end: "" }] : { start: "", end: "" };
  return prompt.multiple ? [] : "";
}

function inputType(kind: string) {
  return ({ Number: "number", Currency: "number", Date: "date", DateTime: "datetime-local", Time: "time" } as
    Record<string, string>)[kind] ?? "text";
}

function inputStep(kind: string) {
  return ["Number", "Currency"].includes(kind) ? "any" : ["Time", "DateTime"].includes(kind) ? 1 : undefined;
}

function comparable(kind: string, value: string) {
  if (kind === "Number" || kind === "Currency") return Number(value);
  return value;
}

/** Turns what was entered into the values the server expects, with a message for every problem. */
function collect(prompts: Prompt[], values: Values) {
  const submitted: Record<string, unknown> = Object.create(null);
  const errors: Record<string, string[]> = Object.create(null);
  for (const prompt of prompts) {
    const value = values[prompt.name];
    const ranges = prompt.range ? (prompt.multiple ? value as Range[] : [value as Range]) : [];
    if (prompt.range) {
      const complete: Range[] = [];
      for (const range of ranges) {
        if (!range.start && !range.end) continue;
        if (!range.start || !range.end) { errors[prompt.name] = ["Enter both range endpoints."]; break; }
        if (comparable(prompt.kind, range.start) > comparable(prompt.kind, range.end)) {
          errors[prompt.name] = ["The start must come before the end."]; break;
        }
        complete.push({ start: range.start, end: range.end });
      }
      if (errors[prompt.name]) continue;
      if (complete.length) submitted[prompt.name] = prompt.multiple ? complete : complete[0];
      else if (!prompt.optional) errors[prompt.name] = ["Enter a start and an end."];
      continue;
    }
    const items = (prompt.multiple ? value as string[] : [value as string]).map(item => item.trim()).filter(Boolean);
    if (["Number", "Currency"].includes(prompt.kind) && items.some(item => !Number.isFinite(Number(item)))) {
      errors[prompt.name] = ["Enter a number."]; continue;
    }
    if (items.length) submitted[prompt.name] = prompt.multiple ? items : items[0];
    else if (!prompt.optional) errors[prompt.name] = [isChoice(prompt) || prompt.kind === "Boolean"
      ? (prompt.multiple ? "Choose at least one value." : "Choose a value.")
      : prompt.multiple ? "Add at least one value." : "Enter a value."];
  }
  return { submitted, errors };
}

function FieldLabel({ prompt, htmlFor, id }: { prompt: Prompt; htmlFor?: string; id?: string }) {
  const Tag = htmlFor ? "label" : "span";
  // The "*" and "Optional" markers are drawn by CSS, so the label text stays the parameter's name.
  return <Tag className={`rv-label ${prompt.optional ? "optional" : "required"}`} htmlFor={htmlFor} id={id}>
    {prompt.label}
  </Tag>;
}

function hint(prompt: Prompt) {
  if (prompt.range && isDateKind(prompt.kind)) return "Pick a date range or use a shortcut.";
  if (prompt.multiple && !isChoice(prompt) && !prompt.range) return "Type a value and press Enter to add it.";
  if (prompt.multiple && isChoice(prompt)) return "Tick one or more, or type a value to add it.";
  return "";
}

/** Shortcuts for date ranges, in local time. */
function datePresets(kind: string): { label: string; range: () => Range }[] {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const format = (date: Date, end: boolean) => kind === "DateTime" ? `${day(date)}T${end ? "23:59:59" : "00:00:00"}` : day(date);
  const span = (start: Date, end: Date): Range => ({ start: format(start, false), end: format(end, true) });
  const today = () => new Date();
  return [
    { label: "Today", range: () => span(today(), today()) },
    { label: "Yesterday", range: () => { const date = today(); date.setDate(date.getDate() - 1); return span(date, date); } },
    { label: "Last 7 days", range: () => { const start = today(); start.setDate(start.getDate() - 6); return span(start, today()); } },
    { label: "This month", range: () => { const now = today(); return span(new Date(now.getFullYear(), now.getMonth(), 1), now); } },
    { label: "Last month", range: () => { const now = today();
      return span(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)); } },
  ];
}

type ControlProps = {
  prompt: Prompt; id: string; value: Value; onChange: (value: Value) => void; invalid: boolean; describedBy?: string;
};

function ScalarInput({ prompt, id, value, onChange, invalid, describedBy, label }: ControlProps & { label?: string }) {
  const validation = { "aria-invalid": invalid || undefined, "aria-describedby": describedBy,
    "aria-required": !prompt.optional || undefined };
  if (isChoice(prompt))
    return <ComboInput prompt={prompt} id={id} value={value as string} onChange={onChange} label={label} validation={validation} />;
  const numeric = ["Number", "Currency"].includes(prompt.kind);
  return <input id={id} className="rv-input" value={value as string} aria-label={label}
    type={inputType(prompt.kind)} step={inputStep(prompt.kind)} inputMode={numeric ? "decimal" : undefined}
    maxLength={2048} autoComplete="off" spellCheck={false}
    onChange={event => onChange(event.target.value)} {...validation} />;
}

/** A text field with the parameter's list of values as suggestions: pick one, or type any other value. */
function ComboInput({ prompt, id, value, onChange, label, validation }: {
  prompt: Prompt; id: string; value: string; onChange: (value: Value) => void; label?: string;
  validation: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const term = value.trim().toLowerCase();
  const options = !term || prompt.choices.includes(value) ? prompt.choices
    : prompt.choices.filter(choice => choice.toLowerCase().includes(term));
  const listId = `${id}-list`;
  const showing = open && options.length > 0;
  // The list floats over everything (it is not clipped by a scrolling dialog), below the field or above
  // it when there is no room. Scrolling or resizing closes it rather than leaving it behind.
  const [place, setPlace] = useState<CSSProperties>();
  useEffect(() => {
    if (!showing || !input.current) return;
    const box = input.current.getBoundingClientRect();
    const height = Math.min(220, options.length * 34 + 10);
    const below = window.innerHeight - box.bottom - 8 >= height || box.top < height + 8;
    setPlace({ position: "fixed", left: box.left, width: box.width,
      ...(below ? { top: box.bottom + 4 } : { bottom: window.innerHeight - box.top + 4 }) });
    const close = (event: Event) => { if (!(event.target instanceof Node && listRef.current?.contains(event.target))) setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [showing, options.length]);
  const listRef = useRef<HTMLUListElement>(null);
  const pick = (choice: string) => { onChange(choice); setOpen(false); setActive(-1); };
  return <div className="rv-combo">
    <input ref={input} id={id} className="rv-input" role="combobox" aria-label={label} aria-autocomplete="list"
      aria-expanded={showing} aria-controls={listId} aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
      value={value} placeholder="Select or type a value" autoComplete="off" spellCheck={false} maxLength={2048}
      inputMode={["Number", "Currency"].includes(prompt.kind) ? "decimal" : undefined}
      onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onClick={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive(current => (current + step + options.length) % Math.max(options.length, 1));
        } else if (event.key === "Enter" && showing && active >= 0) {
          event.preventDefault();
          pick(options[active]);
        } else if (event.key === "Escape" && showing) {
          // Close the list, not the dialog around it.
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }} {...validation} />
    <button type="button" className="rv-combo-toggle" tabIndex={-1} aria-label={`Show ${prompt.label} values`}
      onMouseDown={event => event.preventDefault()}
      onClick={() => { setOpen(current => !current); input.current?.focus(); }}><ChevronDown size={15} /></button>
    {showing && <ul ref={listRef} id={listId} role="listbox" className="rv-combo-list" style={place}
      aria-label={`${prompt.label} values`}>
      {options.map((choice, index) => <li key={choice} id={`${listId}-${index}`} role="option" aria-selected={choice === value}
        className={index === active ? "active" : undefined}
        onMouseDown={event => { event.preventDefault(); pick(choice); }}>
        <span>{choice}</span>{choice === value && <Check size={14} aria-hidden="true" />}
      </li>)}
    </ul>}
  </div>;
}

function BooleanInput({ prompt, id, value, onChange, invalid, describedBy }: ControlProps) {
  return <div className="rv-segmented" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy}
    aria-invalid={invalid || undefined}>
    {[["true", "Yes"], ["false", "No"]].map(([choice, text]) => <label key={choice} className="rv-segment">
      <input type="radio" name={id} value={choice} checked={value === choice} onChange={() => onChange(choice)} />
      <span>{text}</span>
    </label>)}
    {prompt.optional && value !== "" && <button type="button" className="rv-link" onClick={() => onChange("")}>Clear</button>}
  </div>;
}

function ChoiceList({ prompt, id, value, onChange, invalid, describedBy }: ControlProps) {
  const selected = value as string[];
  const [filter, setFilter] = useState("");
  const typed = filter.trim();
  const term = typed.toLowerCase();
  // Values someone typed in that are not in the report's list are shown, ticked, first.
  const all = [...selected.filter(item => !prompt.choices.includes(item)), ...prompt.choices];
  const shown = all.filter(choice => choice.toLowerCase().includes(term));
  const canAdd = typed !== "" && !all.some(choice => choice.toLowerCase() === term) && selected.length < 100;
  const toggle = (choice: string) => onChange(selected.includes(choice)
    ? selected.filter(item => item !== choice) : [...selected, choice]);
  const add = () => { if (canAdd) { onChange([...selected, typed]); setFilter(""); } };
  return <div className={`rv-choice-list${invalid ? " invalid" : ""}`}>
    <div className="rv-choice-search">
      <Search size={14} aria-hidden="true" />
      <input type="search" placeholder="Search or add a value" aria-label={`Search or add ${prompt.label}`} value={filter}
        onChange={event => setFilter(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      {canAdd && <button type="button" className="rv-link" onClick={add}><Plus size={13} /> Add “{typed}”</button>}
    </div>
    <div className="rv-choice-options" role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
      {shown.map(choice => <label key={choice} className="rv-check">
        <input type="checkbox" checked={selected.includes(choice)} onChange={() => toggle(choice)} />
        <span>{choice}</span>
      </label>)}
      {!shown.length && <p className="rv-muted">{canAdd ? "Not in the list. Press Enter to add it." : "No values match."}</p>}
    </div>
    <div className="rv-choice-footer">
      <span>{selected.length} selected</span>
      <span>
        <button type="button" className="rv-link" onClick={() => onChange([...new Set([...selected, ...shown])])}>Select all</button>
        <button type="button" className="rv-link" disabled={!selected.length} onClick={() => onChange([])}>Clear</button>
      </span>
    </div>
  </div>;
}

function TagInput({ prompt, id, value, onChange, invalid, describedBy }: ControlProps) {
  const items = value as string[];
  const [draft, setDraft] = useState("");
  const add = () => {
    const next = draft.split(/[,\n]/).map(item => item.trim()).filter(item => item && !items.includes(item));
    if (next.length) onChange([...items, ...next].slice(0, 100));
    setDraft("");
  };
  return <div className={`rv-tags${invalid ? " invalid" : ""}`}>
    {items.map(item => <span key={item} className="rv-tag">{item}
      <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter(other => other !== item))}>
        <X size={12} /></button></span>)}
    <input id={id} className="rv-tag-input" value={draft} type={inputType(prompt.kind) === "number" ? "text" : inputType(prompt.kind)}
      inputMode={["Number", "Currency"].includes(prompt.kind) ? "decimal" : undefined}
      placeholder={items.length ? "Add another" : "Type and press Enter"} aria-invalid={invalid || undefined}
      aria-describedby={describedBy} autoComplete="off"
      onChange={event => setDraft(event.target.value)} onBlur={add}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); }
        else if (event.key === "Backspace" && !draft && items.length) onChange(items.slice(0, -1));
      }} />
  </div>;
}

function RangeInput({ prompt, id, value, onChange, invalid, describedBy }: ControlProps) {
  const ranges = prompt.multiple ? value as Range[] : [value as Range];
  const update = (index: number, next: Range) => {
    const all = ranges.map((range, position) => position === index ? next : range);
    onChange(prompt.multiple ? all : all[0]);
  };
  const scalar = { ...prompt, range: false, multiple: false };
  return <div className="rv-ranges">
    {ranges.map((range, index) => <div key={index} className="rv-range">
      <div className="rv-range-end">
        <label htmlFor={`${id}-${index}-start`} className="rv-sublabel">From</label>
        <ScalarInput prompt={scalar} id={`${id}-${index}-start`} value={range.start} invalid={invalid} describedBy={describedBy}
          onChange={start => update(index, { ...range, start: start as string })} />
      </div>
      <span className="rv-range-dash" aria-hidden="true">–</span>
      <div className="rv-range-end">
        <label htmlFor={`${id}-${index}-end`} className="rv-sublabel">To</label>
        <ScalarInput prompt={scalar} id={`${id}-${index}-end`} value={range.end} invalid={invalid} describedBy={describedBy}
          onChange={end => update(index, { ...range, end: end as string })} />
      </div>
      {prompt.multiple && ranges.length > 1 && <button type="button" className="icon-button rv-remove"
        aria-label="Remove this range" onClick={() => onChange(ranges.filter((_, position) => position !== index))}>
        <X size={14} /></button>}
    </div>)}
    {isDateKind(prompt.kind) && !prompt.multiple && <div className="rv-presets" aria-label={`${prompt.label} shortcuts`}>
      <CalendarDays size={14} aria-hidden="true" />
      {datePresets(prompt.kind).map(preset => <button type="button" key={preset.label} className="rv-chip"
        onClick={() => onChange(preset.range())}>{preset.label}</button>)}
    </div>}
    {prompt.multiple && ranges.length < 100 && <button type="button" className="rv-link rv-add"
      onClick={() => onChange([...ranges, { start: "", end: "" }])}><Plus size={14} /> Add range</button>}
  </div>;
}

function ParameterField({ prompt, index, value, onChange, errors }: {
  prompt: Prompt; index: number; value: Value; onChange: (value: Value) => void; errors?: string[];
}) {
  const id = `rv-param-${index}`;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const hintText = hint(prompt);
  const hintId = hintText ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const props: ControlProps = { prompt, id, value, onChange, invalid: !!errorId, describedBy };
  const wide = prompt.range || (prompt.multiple && (isChoice(prompt) || !prompt.range));
  const labelled = !prompt.range && !(prompt.multiple && isChoice(prompt)) && !(prompt.kind === "Boolean" && !isChoice(prompt));
  let control: ReactNode;
  if (prompt.range) control = <RangeInput {...props} />;
  else if (prompt.multiple && isChoice(prompt)) control = <ChoiceList {...props} />;
  else if (prompt.multiple) control = <TagInput {...props} />;
  else if (prompt.kind === "Boolean" && !isChoice(prompt)) control = <BooleanInput {...props} />;
  else control = <ScalarInput {...props} />;
  return <div className={`rv-field${wide ? " wide" : ""}`} role={labelled ? undefined : "group"}
    aria-labelledby={labelled ? undefined : `${id}-label`}>
    <FieldLabel prompt={prompt} htmlFor={labelled ? id : undefined} id={`${id}-label`} />
    {control}
    {hintId && <p id={hintId} className="rv-hint">{hintText}</p>}
    {errorId && <p id={errorId} className="rv-error">{errors!.join(" ")}</p>}
  </div>;
}

/* ---------------------------------------------------------------- setup notices */

/** Shown instead of the report to people who cannot set up its database connection. */
function NotReady({ title = "This report isn't ready yet", text = notReady, onBack, backLabel }: {
  title?: string; text?: string; onBack: () => void; backLabel: string;
}) {
  return <section className="rv-card rv-notice" aria-labelledby="report-not-ready-title">
    <span className="rv-notice-icon" aria-hidden="true"><Clock3 size={20} /></span>
    <div>
      <h2 id="report-not-ready-title">{title}</h2>
      <p>{text}</p>
      <button className="button" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button>
    </div>
  </section>;
}

/** Lets an administrator save the missing database logins a report needs, right where it was opened. */
function AdminSetup({ connections, onDone }: { connections: Connection[]; onDone: () => void }) {
  const [saved, setSaved] = useState<string[]>([]);
  const missing = connections.filter(connection => connection.status === "needs-login" && !saved.includes(connection.id));
  const unconfigured = connections.filter(connection => connection.status === "unconfigured");
  const finished = useRef(onDone);
  finished.current = onDone;
  useEffect(() => {
    if (!missing.length && !unconfigured.length) finished.current();
  }, [missing.length, unconfigured.length]);
  return <section className="rv-card" aria-labelledby="report-setup-title">
    <header className="rv-card-header">
      <span className="rv-card-icon" aria-hidden="true"><Database size={16} /></span>
      <div>
        <h2 id="report-setup-title">Finish setting up this report</h2>
        <p>Only administrators see this. Save a read-only login for each database this report reads from; everyone
          who runs it then uses that login and is never asked for one.</p>
      </div>
    </header>
    <div className="rv-card-body">
      {unconfigured.length > 0 && <p className="error-banner" role="alert">
        {unconfigured.map(connection => connection.label).join(", ")} can't be set up here because the server's report
        settings for it are ambiguous or unusable. Check the Crystal connection settings on the server.
      </p>}
      {missing.map(connection => <DatabaseLoginForm key={connection.id} connection={connection}
        onSaved={() => setSaved(previous => [...previous, connection.id])} />)}
    </div>
  </section>;
}

/* ---------------------------------------------------------------- results */

type Run = { values: Record<string, unknown>; startedAt: number };
/** A finished run: its PDF and the run it came from (so exports use the values that produced it). */
type Output = { pdf: string; finishedAt: number; seconds: number; run: Run };

/** The values a run was asked for, briefly, for the progress view: "Date 01 Nov 2026 · EstCode E-1043". */
function runContext(prompts: Prompt[], values: Record<string, unknown>) {
  const date = (kind: string, value: string) => {
    if (!isDateKind(kind) || !value) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value
      : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };
  const show = (kind: string, value: unknown): string => {
    if (typeof value === "string") return date(kind, value);
    if (Array.isArray(value)) return value.length > 2 ? `${value.length} selected` : value.map(item => show(kind, item)).join(", ");
    if (value && typeof value === "object" && "start" in value) {
      const range = value as { start: string; end: string };
      return range.start === range.end ? date(kind, range.start) : `${date(kind, range.start)} – ${date(kind, range.end)}`;
    }
    return "";
  };
  const shorten = (text: string) => text.length > 28 ? `${text.slice(0, 27)}…` : text;
  return prompts.map(prompt => [prompt.label, show(prompt.kind, values[prompt.name])] as const)
    .filter(([, text]) => text)
    .slice(0, 3)
    .map(([label, text]) => `${shorten(label)} ${shorten(text)}`)
    .join(" · ");
}

function IdleState({ onStart }: { onStart?: () => void }) {
  return <div className="rv-state rv-idle">
    <span className="rv-state-icon" aria-hidden="true"><FileText size={22} /></span>
    <h3>No results yet</h3>
    <p>Select View to see this report.</p>
    {onStart && <button type="button" className="button primary" onClick={onStart}><Eye size={15} /> View</button>}
  </div>;
}

function FailedState({ message, onRetry, retryLabel = "Try again", onChangeParameters }: {
  message: string; onRetry?: () => void; retryLabel?: string; onChangeParameters?: () => void;
}) {
  return <div className="rv-state rv-failed">
    <span className="rv-state-icon" aria-hidden="true"><AlertCircle size={22} /></span>
    <h3>The report didn't run</h3>
    <p role="alert">{message}</p>
    <div className="rv-state-actions">
      {onChangeParameters && <button type="button" className="button" onClick={onChangeParameters}>
        <SlidersHorizontal size={15} /> Change parameters</button>}
      {onRetry && <button type="button" className="button primary" onClick={onRetry}><RotateCcw size={15} /> {retryLabel}</button>}
    </div>
  </div>;
}

function useExcel(report: Detail, values: Record<string, unknown>) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "failed"; blob?: Blob; error?: string }>(
    { status: "idle" });
  const pending = useRef<Promise<Blob | undefined> | null>(null);
  const controller = useRef<AbortController | null>(null);
  useOperation(state.status === "loading", "Preparing the Excel file", false);
  useEffect(() => () => controller.current?.abort(), []);
  const load = () => {
    if (state.blob) return Promise.resolve(state.blob);
    if (pending.current) return pending.current;
    controller.current = new AbortController();
    const signal = AbortSignal.any([controller.current.signal, AbortSignal.timeout(runTimeout)]);
    setState({ status: "loading" });
    pending.current = renderReport(report, values, "xlsx", signal).then(blob => {
      setState({ status: "ready", blob });
      return blob;
    }, (failure: unknown) => {
      if (controller.current?.signal.aborted) return undefined;
      setState({ status: "failed", error: failure instanceof RenderError || failure instanceof SetupError
        ? failure.message : signal.aborted ? "Preparing the Excel file timed out." : "The Excel file could not be prepared. Try again." });
      return undefined;
    }).finally(() => { pending.current = null; });
    return pending.current;
  };
  return { ...state, load };
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
/** Thousands separators for plain numbers; anything else (codes, percentages) is shown as exported. */
function formatNumber(value: string | undefined) {
  if (!value || !/^-?\d+(\.\d+)?$/.test(value)) return value;
  return numberFormat.format(Number(value));
}

type Sort = { column: number; descending: boolean } | null;

/**
 * The Table view: the same data as the Report view's layout, as plain rows and columns (one row per record,
 * no page headers, totals or formatting) so it can be searched, sorted and checked or copied without Excel.
 */
function DataTable({ rows }: { rows: string[][] }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [header, ...body] = rows;
  const numeric = useMemo(() => header.map((_, column) => {
    const cells = body.map(row => row[column]).filter(value => value !== "");
    return cells.length > 0 && cells.filter(value => /^-?[\d,]*\.?\d+%?$/.test(value)).length / cells.length >= 0.8;
  }), [header, body]);
  // Identifiers (barcodes, job or document numbers) stay exactly as exported.
  const identifier = header.map(cell => /code|barcode|\bno\b|no\.|number|\bid\b|#|phone|pin|zip/i.test(cell));
  const term = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    const matching = term ? body.filter(row => row.some(value => value.toLowerCase().includes(term))) : body;
    if (!sort) return matching;
    const { column, descending } = sort;
    const value = (row: string[]) => row[column] ?? "";
    const compare = numeric[column]
      ? (a: string[], b: string[]) => (Number(value(a).replace(/[,%]/g, "")) || 0) - (Number(value(b).replace(/[,%]/g, "")) || 0)
      : (a: string[], b: string[]) => value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: "base" });
    // Blank cells always go last, whichever way the column is sorted.
    return [...matching].sort((a, b) => {
      const blankA = value(a) === "", blankB = value(b) === "";
      if (blankA || blankB) return Number(blankA) - Number(blankB);
      return descending ? compare(b, a) : compare(a, b);
    });
  }, [body, term, sort, numeric]);
  const toggleSort = (column: number) => setSort(current => current?.column !== column ? { column, descending: false }
    : !current.descending ? { column, descending: true } : null);
  const limit = 2000;
  return <div className="rv-table-wrap">
    <p className="rv-table-intro">
      <Table2 size={14} aria-hidden="true" />
      <span>The report's data as rows and columns, without the page layout. Search or sort any column to check
        figures quickly; use <strong>Report</strong> to print and <strong>Excel</strong> to work with the data.</span>
    </p>
    <div className="rv-table-tools">
      <span className="rv-muted">{term ? `${shown.length} of ${body.length}` : body.length} {body.length === 1 ? "row" : "rows"}
        {" · "}{header.length} {header.length === 1 ? "column" : "columns"}</span>
      <div className="rv-table-search">
        <Search size={14} aria-hidden="true" />
        <input type="search" placeholder="Search rows" aria-label="Search rows" value={filter}
          onChange={event => setFilter(event.target.value)} />
      </div>
    </div>
    <div className="rv-table-scroll" tabIndex={0} aria-label="Report data table">
      <table className="rv-table">
        <thead><tr>{header.map((cell, column) => {
          const sorted = sort?.column === column ? sort.descending ? "descending" : "ascending" : undefined;
          const name = cell || `Column ${column + 1}`;
          return <th key={column} scope="col" className={numeric[column] ? "num" : undefined} aria-sort={sorted ?? "none"}>
            <button type="button" className="rv-sort" onClick={() => toggleSort(column)} title={`Sort by ${name}`}>
              {name}
              {sorted === "ascending" ? <ArrowUp size={12} aria-hidden="true" />
                : sorted === "descending" ? <ArrowDown size={12} aria-hidden="true" />
                : <ArrowUpDown size={12} aria-hidden="true" className="rv-sort-idle" />}
            </button></th>;
        })}</tr></thead>
        <tbody>
          {shown.slice(0, limit).map((row, index) => <tr key={index}>
            {header.map((_, column) => <td key={column} className={numeric[column] ? "num" : undefined}>
              {numeric[column] && !identifier[column] ? formatNumber(row[column]) : row[column]}</td>)}
          </tr>)}
        </tbody>
      </table>
      {!shown.length && <p className="rv-table-empty">No rows match “{filter}”.</p>}
    </div>
    {shown.length > limit && <p className="rv-muted rv-table-note">Showing the first {limit} rows. Download Excel for all {shown.length}.</p>}
  </div>;
}

function TableView({ excel, onDownload }: { excel: ReturnType<typeof useExcel>; onDownload: () => void }) {
  const [rows, setRows] = useState<string[][] | null | undefined>();
  const { status, blob, error, load } = excel;
  useEffect(() => { if (status === "idle") void load(); }, [status, load]);
  useEffect(() => {
    if (!blob) return;
    let current = true;
    void blob.arrayBuffer().then(readWorkbook).catch(() => null).then(result => { if (current) setRows(result); });
    return () => { current = false; };
  }, [blob]);
  if (status === "failed") return <FailedState message={error ?? ""} onRetry={() => void load()} />;
  if (status !== "ready" || rows === undefined) return <div className="run-progress" role="status" aria-live="polite">
    <div className="run-sheet" aria-hidden="true"><span /><span /><span /><span /></div>
    {/* Two real steps: the server exports the data, then the browser arranges it into rows. */}
    <p className="run-message" key={status}>
      {status !== "ready" ? "Exporting the report's data" : "Arranging the rows"}
      <span className="run-ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
    </p>
  </div>;
  if (rows === null) return <div className="rv-state">
    <span className="rv-state-icon" aria-hidden="true"><FileSpreadsheet size={22} /></span>
    <h3>This report's data can't be shown as a table</h3>
    <p>Its layout doesn't export as simple rows and columns. Download it as Excel to work with the data, or use the
      Report view to read and print it.</p>
    <button type="button" className="button primary" onClick={onDownload}><FileSpreadsheet size={15} /> Download Excel</button>
  </div>;
  if (rows.length < 2) return <div className="rv-state">
    <span className="rv-state-icon" aria-hidden="true"><Table2 size={22} /></span>
    <h3>No data for these parameters</h3>
    <p>The report ran but returned no rows. Try a wider date range or different values.</p>
  </div>;
  return <DataTable rows={rows} />;
}

/** Prints the PDF through a hidden frame, so printing never depends on how the page is shown. */
function printPdf(url: string) {
  const frame = document.createElement("iframe");
  frame.className = "rv-print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
    catch { window.open(url, "_blank", "noopener"); }
    window.setTimeout(() => frame.remove(), 60000);
  };
  document.body.append(frame);
}

function Results({ report, output, refreshing, onChangeParameters }: {
  report: Detail; output: Output;
  /** A newer run in progress: its progress shows here, and this report stays visible but can't be used. */
  refreshing?: ReactNode;
  onChangeParameters?: () => void;
}) {
  const [view, setView] = useState<"layout" | "table">("layout");
  // Full screen: the result fills the browser window, so a long report can be read without the page around it.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const exit = (event: globalThis.KeyboardEvent) => {
      // Leave a dialog's own Escape alone (none is open over the report, but be safe).
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) { event.preventDefault(); setExpanded(false); }
    };
    document.documentElement.classList.add("rv-fullscreen-open");
    window.addEventListener("keydown", exit);
    return () => {
      document.documentElement.classList.remove("rv-fullscreen-open");
      window.removeEventListener("keydown", exit);
    };
  }, [expanded]);
  const excel = useExcel(report, output.run.values);
  const downloadExcel = async () => {
    const blob = await excel.load();
    if (blob) save(blob, `${report.name}.${blob.type.includes("ms-excel") ? "xls" : "xlsx"}`);
  };
  const generated = new Date(output.finishedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return <section className={`rv-card rv-results${refreshing ? " refreshing" : ""}${expanded ? " expanded" : ""}`} aria-label="Report results"
    aria-busy={!!refreshing}>
    {refreshing}
    <div className="rv-results-bar" inert={!!refreshing}>
      <div className="rv-tabs" role="tablist" aria-label="Result view">
        <button role="tab" aria-selected={view === "layout"} className="rv-tab" onClick={() => setView("layout")}
          title="The report as it prints: its pages, headings and totals">
          <FileText size={15} aria-hidden="true" /> Report</button>
        <button role="tab" aria-selected={view === "table"} className="rv-tab" onClick={() => setView("table")}
          title="The report's data as rows and columns you can search and sort">
          <Table2 size={15} aria-hidden="true" /> Table</button>
      </div>
      <p className="rv-results-meta" role="status"><Check size={13} aria-hidden="true" /> {generated} · {output.seconds}s</p>
      <div className="rv-results-actions">
        {onChangeParameters && <button type="button" className="button" onClick={onChangeParameters}>
          <SlidersHorizontal size={15} /> Change parameters</button>}
        <div className="rv-btn-group" role="group" aria-label="Export">
          <button type="button" className="rv-btn" onClick={() => void downloadExcel()} disabled={excel.status === "loading"}
            title="Download the data as an Excel workbook">
            {excel.status === "loading" ? <span className="spinner" aria-hidden="true" /> : <FileSpreadsheet size={15} />}
            <span>{excel.status === "loading" ? "Preparing…" : "Excel"}</span></button>
          <a className="rv-btn" href={output.pdf} download={`${report.name}.pdf`} title="Download the PDF">
            <Download size={15} /><span>PDF</span></a>
          <button type="button" className="rv-btn" onClick={() => printPdf(output.pdf)} title="Print the report">
            <Printer size={15} /><span>Print</span></button>
          <a className="rv-btn rv-btn-icon" href={output.pdf} target="_blank" rel="noopener noreferrer"
            aria-label="Open the PDF in a new tab" title="Open in a new tab"><ExternalLink size={15} /></a>
        </div>
        <button type="button" className={`button rv-expand${expanded ? " active" : ""}`} aria-pressed={expanded}
          onClick={() => setExpanded(value => !value)} title={expanded ? "Exit full screen (Esc)" : "Show the report full screen"}>
          {expanded ? <Minimize size={15} /> : <Maximize size={15} />}
          <span>{expanded ? "Exit full screen" : "Full screen"}</span></button>
      </div>
    </div>
    {excel.status === "failed" && view === "layout" && <p className="error-banner rv-inline-error" role="alert">{excel.error}</p>}
    <div className="rv-results-body" inert={!!refreshing}>
      {view === "layout" ? <PdfViewer url={output.pdf} title={report.name} /> : <TableView excel={excel} onDownload={() => void downloadExcel()} />}
    </div>
  </section>;
}

/* ---------------------------------------------------------------- the working area */

/**
 * The parameters of the last run of each report, for this browser tab only (session storage is cleared
 * when the tab closes), so a page refresh brings the report straight back instead of asking again.
 */
const lastRunKey = (report: Detail) => `1reports:last-run:${report.id}:${report.version}`;

function readLastRun(report: Detail): Values | null {
  let saved: unknown;
  try { saved = JSON.parse(sessionStorage.getItem(lastRunKey(report)) ?? "null"); } catch { return null; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  const stored = saved as Record<string, unknown>;
  // Keep a saved value only if it still has the shape this parameter expects.
  return Object.fromEntries(report.prompts.map(prompt => {
    const empty = emptyValue(prompt);
    const value = stored[prompt.name];
    const fits = Array.isArray(empty) ? Array.isArray(value)
      && value.every(item => typeof item === (prompt.range ? "object" : "string") && item !== null)
      : typeof empty === "string" ? typeof value === "string"
      : !!value && typeof value === "object" && !Array.isArray(value)
        && typeof (value as Range).start === "string" && typeof (value as Range).end === "string";
    return [prompt.name, fits ? value as Value : empty];
  })) as Values;
}

function saveLastRun(report: Detail, values: Values) {
  try { sessionStorage.setItem(lastRunKey(report), JSON.stringify(values)); } catch { /* storage full or blocked */ }
}

/** Where a report stands, for a page that runs several at once. */
export type RunStatus = "loading" | "idle" | "running" | "done" | "failed" | "invalid" | "blocked";

/** Options for a report shown among others (see BatchReports). */
type BatchOptions = {
  /** Parameters stay in the side panel from the start, never in a popup. */
  inline?: boolean;
  /** Each new value asks the report to run with its current parameters, as if View were selected. */
  runToken?: number;
  onStatus?: (status: RunStatus) => void;
};

function ReportRunner({ report, onActivity, onReload, onBack, backLabel, inline = false, runToken = 0, onStatus }: {
  report: Detail; onActivity: () => void; onReload: () => void; onBack: () => void; backLabel: string;
} & BatchOptions) {
  const initial = () => Object.fromEntries(report.prompts.map(prompt => [prompt.name, emptyValue(prompt)])) as Values;
  // After a refresh the last run's parameters come back and the report runs again straight away.
  const [restored] = useState(() => report.setupRequired ? null : readLastRun(report));
  const [values, setValues] = useState<Values>(() => restored ?? initial());
  const [run, setRun] = useState<Run | null>(() => {
    // Among several reports the values come back but nothing runs until asked: the engine runs few at a time.
    if (!restored || inline) return null;
    const { submitted, errors } = collect(report.prompts, restored);
    return Object.keys(errors).length ? null : { values: submitted, startedAt: Date.now() };
  });
  const [output, setOutput] = useState<Output | null>(null);
  /** The run whose request has ended (finished, failed or cancelled); `run` differs while one is in flight. */
  const [settled, setSettled] = useState<Run | null>(null);
  const [phase, setPhase] = useState<RunPhase>("working");
  const [error, setError] = useState("");
  const [setupProblem, setSetupProblem] = useState("");
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  // The parameters popup opens straight away when the report has any (unless it is being restored).
  const [editing, setEditing] = useState(report.prompts.length > 0 && !report.setupRequired && !run && !inline);
  // On narrow screens the docked parameters fold away after each view, to give the results the screen.
  const [collapsed, setCollapsed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const outputArea = useRef<HTMLDivElement>(null);
  const cancel = useRef<() => void>(() => undefined);
  // Set the moment a run is requested, before React re-renders: a second click (or Ctrl+Enter) in the same
  // instant can't start a second request.
  const inFlight = useRef(false);
  const refresh = useRef(onActivity);
  refresh.current = onActivity;
  const busy = !!run && settled !== run;
  // While it runs, the parts of the app that would close this report step aside (see services/operations).
  useOperation(busy, `Generating ${report.name}`);
  // Each result's PDF stays available until a newer result replaces it, or the report closes.
  useEffect(() => () => { if (output) URL.revokeObjectURL(output.pdf); }, [output]);

  useEffect(() => {
    // Take the person straight to the first field that needs attention.
    const first = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (first) {
      first.focus({ preventScroll: true });
      first.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  }, [fieldErrors]);

  useEffect(() => {
    if (!run || settled === run) return;
    inFlight.current = true;
    // Bring the progress, and then the results in the same place, into view.
    outputArea.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    const controller = new AbortController();
    cancel.current = () => controller.abort("cancelled");
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(runTimeout)]);
    // Every update below first checks that this request is still the current one: a cancelled, replaced or
    // closed run can't overwrite what is on screen.
    const current = () => !controller.signal.aborted;
    const end = () => { inFlight.current = false; setSettled(run); };
    setPhase("working");
    void renderReport(report, run.values, "pdf", signal, () => {
      if (current()) setPhase("receiving");
    }).then(blob => {
      if (!current()) return;
      const finishedAt = Date.now();
      const seconds = Math.max(1, Math.round((finishedAt - run.startedAt) / 100) / 10);
      rememberRun(report.id, seconds);
      setOutput({ pdf: URL.createObjectURL(blob), finishedAt, seconds, run });
      setError("");
      end();
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) {
        // Cancelled: back to what was on screen before (the previous result, if there was one).
        if (controller.signal.reason === "cancelled") { inFlight.current = false; setRun(output?.run ?? null); }
        return;
      }
      end();
      if (failure instanceof ApiError && failure.status === 409) {
        setStale(true);
        setError("The report changed. Reload it to get the current parameters.");
        return;
      }
      if (failure instanceof SetupError) { setSetupProblem(failure.message); return; }
      if (failure instanceof PromptError) setFieldErrors(failure.errors);
      setError(signal.aborted ? "The report took too long. Try again, or narrow the parameters."
        : failure instanceof PromptError || failure instanceof RenderError ? failure.message
        : !navigator.onLine ? "You appear to be offline. Check your connection and try again."
        : "Unable to generate the report. Check your connection and try again.");
    }).finally(() => {
      if (current()) refresh.current();
    });
    return () => { controller.abort(); inFlight.current = false; };
    // `settled` and `output` are read, not watched: a run starts only when `run` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, run]);

  // Tell a page running several reports where this one stands.
  const submitRef = useRef<() => "started" | "invalid" | "unavailable">(() => "unavailable");
  const status: RunStatus = report.setupRequired || setupProblem || stale ? "blocked"
    : busy ? "running"
    : Object.keys(fieldErrors).length ? "invalid"
    : error ? "failed"
    : output ? "done" : "idle";
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  useEffect(() => { statusRef.current?.(status); }, [status]);
  const lastToken = useRef(runToken);
  useEffect(() => {
    if (runToken === lastToken.current) return;
    lastToken.current = runToken;
    // Report the outcome straight away: an unchanged status (invalid twice running) would otherwise say nothing.
    const outcome = submitRef.current();
    statusRef.current?.(outcome === "started" ? "running" : outcome === "invalid" ? "invalid" : "blocked");
  }, [runToken]);

  if (report.setupRequired) return report.canConfigure
    ? <AdminSetup connections={report.connections ?? []} onDone={onReload} />
    : <NotReady onBack={onBack} backLabel={backLabel} />;
  if (setupProblem) return <>
    <NotReady title={setupProblem === notReady ? undefined : "This report can't run right now"} text={setupProblem}
      onBack={onBack} backLabel={backLabel} />
    {report.canConfigure && <p className="rv-hint rv-admin-hint">Update the database login under Settings → Report databases.</p>}
  </>;

  const submit = (): "started" | "invalid" | "unavailable" => {
    if (inFlight.current || busy) return "started";
    if (stale) return "unavailable";
    const { submitted, errors } = collect(report.prompts, values);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError("");
      // Asked to run with parameters missing: say so (a page running several reports moves on to the next).
      if (inline) setCollapsed(false);
      return "invalid";
    }
    inFlight.current = true;
    setError("");
    // The current result stays on screen until the new one is ready (or kept if the new run fails).
    setEditing(false);
    if (window.matchMedia?.("(max-width: 960px)").matches) setCollapsed(true);
    saveLastRun(report, values);
    setRun({ values: submitted, startedAt: Date.now() });
    return "started";
  };
  const reset = () => {
    setValues(initial());
    setFieldErrors({});
  };
  submitRef.current = submit;
  const hasParameters = report.prompts.length > 0;
  const invalidCount = Object.keys(fieldErrors).filter(name => name !== "values").length;
  const runAgain = () => {
    if (inFlight.current || busy) return;
    if (!run) { submit(); return; }
    inFlight.current = true;
    setError("");
    setRun({ ...run, startedAt: Date.now() });
  };
  // First the parameters are asked for in a popup. Once the report has been viewed they stay in a panel
  // beside the results, so a value can be changed and viewed again straight away.
  const docked = hasParameters && (inline || !!run || !!output);

  const fields = <>
    {report.prompts.map((prompt, index) => <ParameterField key={prompt.name} prompt={prompt} index={index}
      value={values[prompt.name]} errors={Object.hasOwn(fieldErrors, prompt.name) ? fieldErrors[prompt.name] : undefined}
      onChange={value => {
        setValues(previous => ({ ...previous, [prompt.name]: value }));
        if (Object.hasOwn(fieldErrors, prompt.name)) setFieldErrors(({ [prompt.name]: _, ...rest }) => rest);
      }} />)}
    {fieldErrors.values?.map(message => <p className="error-banner" role="alert" key={message}>{message}</p>)}
  </>;
  const formProps = {
    ref: form, noValidate: true, "aria-busy": busy,
    onSubmit: (event: FormEvent) => { event.preventDefault(); submit(); },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
    },
  };
  const problems = invalidCount > 0 && <p className="rv-error rv-summary" role="alert">
    {invalidCount === 1 ? "Check the highlighted parameter." : `Check the ${invalidCount} highlighted parameters.`}</p>;

  const progress = (compact: boolean) => run && <RunProgress reportId={report.id} startedAt={run.startedAt} phase={phase}
    database={report.connections?.length === 1 ? report.connections[0].label : null} compact={compact}
    context={runContext(report.prompts, run.values)} onCancel={() => cancel.current()} />;
  const results = <div className="rv-output" ref={outputArea}>
    {/* A failed or timed-out run over an earlier result keeps that result, and says so. */}
    {error && output && !busy && <div className="error-banner rv-kept" role="alert">
      <span>{error} Showing the earlier result from {new Date(output.finishedAt).toLocaleTimeString(undefined,
        { hour: "2-digit", minute: "2-digit" })}.</span>
      {!stale && <button type="button" className="text-button" onClick={runAgain}>Try again</button>}
    </div>}
    {busy && run && !output ? <section className="rv-card">{progress(false)}</section>
      : output ? <Results key={output.pdf} report={report} output={output} refreshing={busy ? progress(true) : undefined}
          onChangeParameters={docked ? undefined : hasParameters ? () => setEditing(true) : undefined} />
      : error ? <section className="rv-card"><FailedState message={error}
          onRetry={stale ? onReload : runAgain} retryLabel={stale ? "Reload report" : "Try again"} /></section>
      : <section className="rv-card"><IdleState
          onStart={editing ? undefined : hasParameters && !docked ? () => setEditing(true) : submit} /></section>}
  </div>;

  if (!docked) return <>
    {editing && hasParameters && <Modal title="Report parameters" className="rv-dialog" onClose={() => setEditing(false)}>
      <form {...formProps} className="rv-dialog-form">
        <fieldset disabled={busy || stale} className="rv-fieldset">
          <div className="rv-dialog-body">
            {fields}
          </div>
          <footer className="rv-actions">
            <button type="button" className="rv-link rv-reset" onClick={reset}><RotateCcw size={14} /> Reset</button>
            {problems}
            <div className="rv-action-buttons">
              <button type="button" className="button" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="button primary rv-run"><Eye size={15} /> View</button>
            </div>
          </footer>
        </fieldset>
      </form>
    </Modal>}
    {results}
  </>;

  return <div className={`rv-workspace${collapsed ? " collapsed" : ""}`}>
    <aside className="rv-card rv-panel" aria-labelledby="report-parameters-title">
      <header className="rv-panel-head">
        <h2 id="report-parameters-title"><SlidersHorizontal size={15} aria-hidden="true" /> Parameters</h2>
        <button type="button" className="rv-link rv-panel-toggle" aria-expanded={!collapsed}
          onClick={() => setCollapsed(value => !value)}>{collapsed ? "Show" : "Hide"}</button>
      </header>
      <form {...formProps} className="rv-panel-form">
        <fieldset disabled={busy || stale} className="rv-fieldset">
          <div className="rv-panel-body">{fields}</div>
          <footer className="rv-panel-foot">
            {problems}
            <div className="rv-action-buttons">
              <button type="button" className="button rv-reset" onClick={reset}><RotateCcw size={15} /> Reset</button>
              <button type="submit" className="button primary rv-run">
                {busy ? <span className="spinner" aria-hidden="true" /> : <Eye size={15} />} View</button>
            </div>
          </footer>
        </fieldset>
      </form>
    </aside>
    {results}
  </div>;
}

/* ---------------------------------------------------------------- page */

export function CrystalReports({ reportId, returnLabel, onClose, onActivity, embedded = false, runToken, onStatus }: {
  reportId: string; returnLabel: string; onClose: () => void; onActivity: () => void;
  /** Shown as one of several reports: no back link of its own (the page around it has one). */
  embedded?: boolean;
} & Omit<BatchOptions, "inline">) {
  const { repository } = useHub();
  const [detail, setDetail] = useState<Detail>();
  const [summary, setSummary] = useState<Report>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const refresh = useRef(onActivity);
  refresh.current = onActivity;
  const view = useRef<{ reportId: string; id: string } | null>(null);
  useEffect(() => {
    let current = true;
    void repository.getReport(reportId).then(report => { if (current) setSummary(report); }, () => undefined);
    return () => { current = false; };
  }, [repository, reportId]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setDetail(undefined);
    const route = `reports/${encodeURIComponent(reportId)}`;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    if (view.current?.reportId !== reportId) view.current = { reportId, id: crypto.randomUUID() };
    const interactionId = view.current.id;
    void workspaceRequest<Detail>(route, { signal }).then(async body => {
      signal.throwIfAborted();
      const token = await csrfToken(signal);
      const response = await apiRequest(`${route}/view`, {
        signal, method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({ interactionId }),
      });
      if (!response.ok) throw new Error();
      signal.throwIfAborted();
      setDetail(body);
      refresh.current();
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      setError(signal.aborted ? "The report took too long to load."
        : failure instanceof ApiError && [403, 404].includes(failure.status)
          ? "This report is unavailable or you do not have access."
          : "Unable to open the report. Check your connection and try again.");
    });
    return () => controller.abort();
  }, [reportId, retry]);

  const failedRef = useRef(onStatus);
  failedRef.current = onStatus;
  useEffect(() => { if (error) failedRef.current?.("blocked"); }, [error]);
  const loaded = detail?.id === reportId ? detail : undefined;
  const name = loaded?.name ?? summary?.name;
  const parent = returnLabel.replace(/^back to\s*/i, "");
  // Going back closes the report, which would cancel a run in progress: wait for it (or cancel it) first.
  const running = useBlockingOperation();
  const crumb = parent ? parent.charAt(0).toUpperCase() + parent.slice(1) : "Reports";
  return <div className="rv-page">
    <header className="rv-header">
      {!embedded && <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li><button className="crumb-link" aria-label={returnLabel} onClick={onClose}
            disabled={!!running} title={running ? "Available when the report is ready" : undefined}>
            <ArrowLeft size={14} aria-hidden="true" /> {crumb}</button></li>
        </ol>
      </nav>}
      <div className="rv-title-row">
        <span className="rv-glyph" aria-hidden="true"><ReportGlyph name={name ?? ""} size={30} /></span>
        <div className="rv-title-text">
          <div className="rv-title-line">
            <h1>{name ?? <><span className="sr-only">Loading report…</span><Skeleton width={260} height={26} radius={6} /></>}</h1>
            {loaded && (loaded.setupRequired
              ? <span className="status-pill status-needs-login">{loaded.canConfigure ? "Setup required" : "Not available yet"}</span>
              : <span className="status-pill status-ready">Ready to run</span>)}
          </div>
        </div>
      </div>
    </header>
    <div className="rv-body">
      {error ? <section className="rv-card"><ErrorState text={error} retry={() => setRetry(value => value + 1)} /></section>
        : loaded
          ? <ReportRunner key={`${loaded.id}:${loaded.version}:${loaded.setupRequired}`} report={loaded} onActivity={onActivity}
              onReload={() => setRetry(value => value + 1)} onBack={onClose} backLabel={returnLabel}
              inline={embedded} runToken={runToken} onStatus={onStatus} />
          : <section className="rv-card"><ReportFormSkeleton /></section>}
    </div>
  </div>;
}
