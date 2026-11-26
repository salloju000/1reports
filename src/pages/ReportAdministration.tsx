import { useCallback, useEffect, useRef, useState } from "react";
import { SettingRowsSkeleton } from "../components/Skeleton";
import { CheckCircle2, Database, FileText, Upload, X } from "lucide-react";
import { apiRequest, csrfToken } from "../services/api";
import { DatabaseLoginForm } from "../components/DatabaseLoginForm";
import { useOperation } from "../services/operations";

type Folder = { key: string; category: string };
type UploadConnection = { id: string; label: string; database: string; status: "server" | "saved" | "needs-login" | "unconfigured" };
type Staged = {
  token: string; fileName: string; folder: string; category: string; prompts: number; exists: boolean;
  connections: UploadConnection[];
};
type DatabaseView = {
  id: string; label: string; source: string; database: string; provider: string;
  status: "server" | "saved" | "needs-login" | "unconfigured"; login?: string; updatedAt?: string; reports: string[];
};

const statusText: Record<DatabaseView["status"], string> = {
  server: "Signed in by the server",
  saved: "Login saved",
  "needs-login": "Needs a login",
  unconfigured: "Server settings need fixing",
};

async function send(route: string, method: string, body?: BodyInit, json = true) {
  const controller = AbortSignal.timeout(90000);
  const token = await csrfToken(controller);
  return apiRequest(route, {
    method, signal: controller, body,
    headers: { "X-CSRF-TOKEN": token, ...(json && body ? { "Content-Type": "application/json" } : {}) },
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function problemText(response: Response, fallback: string) {
  const problem = await response.json().catch(() => null);
  return typeof problem?.detail === "string" && problem.detail ? problem.detail : fallback;
}

/**
 * Administrator upload flow: choose a .rpt file, see which databases it uses, save a login for any
 * database that has none yet, then publish. Regular users never see this screen.
 */
export function ReportUpload({ onPublished }: { onPublished: () => void }) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // An upload or publish in progress asks before the tab is closed; the form itself is locked meanwhile.
  useOperation(!!busy, busy === "Publishing…" ? "Publishing the report" : "Uploading the report", false);

  useEffect(() => {
    void apiRequest("admin/report-folders").then(async response => {
      setFolders(response.ok ? await response.json() : []);
    }).catch(() => setFolders([]));
  }, []);

  const pending = staged?.connections.filter(connection => connection.status === "needs-login") ?? [];
  const blocked = staged?.connections.filter(connection => connection.status === "unconfigured") ?? [];

  const choose = (picked?: File | null) => {
    setError("");
    setDone("");
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".rpt")) { setFile(null); setError("Choose a Crystal Reports file with a .rpt name."); return; }
    setFile(picked);
  };
  const upload = (folder: string) => {
    if (busy) return;
    if (!file) { setError("Choose a .rpt file."); return; }
    const data = new FormData();
    data.append("file", file, file.name);
    data.append("folder", folder);
    setBusy("Reading report…");
    setError("");
    setDone("");
    void send("admin/report-uploads", "POST", data, false).then(async response => {
      if (!response.ok) throw new Error(await problemText(response, "The report could not be uploaded. Try again."));
      setStaged(await response.json());
      setReplace(false);
      setFile(null);
    }).catch((failure: unknown) => setError(failure instanceof Error && failure.message ? failure.message
      : "The report could not be uploaded. Try again.")).finally(() => setBusy(""));
  };

  return <section className="settings-group report-admin" aria-labelledby="report-upload-title">
    <header className="settings-group-head"><div>
      <h3 id="report-upload-title"><Upload size={15} aria-hidden="true" /> Upload a report</h3>
    </div></header>
    {done && <p className="success-status" role="status"><CheckCircle2 size={18} /> {done}</p>}
    {folders === null && <SettingRowsSkeleton rows={1} label="Loading report folders…" />}
    {folders?.length === 0 && <p className="error-banner" role="alert">No report folder accepts uploads. Configure a
      Crystal report folder with roles (and without a pinned approved file) on the server.</p>}
    {!staged && !!folders?.length && <form ref={form} className="report-upload" aria-busy={!!busy} onSubmit={event => {
      event.preventDefault();
      const folder = event.currentTarget.elements.namedItem("folder");
      upload(folder instanceof HTMLSelectElement ? folder.value : "");
    }}>
      <fieldset disabled={!!busy}>
        <label className={`upload-drop${dragOver ? " over" : ""}${file ? " has-file" : ""}`}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={event => { event.preventDefault(); setDragOver(false); choose(event.dataTransfer.files?.[0]); }}>
          <input ref={picker} name="file" type="file" accept=".rpt" aria-label="Report file" className="upload-input"
            onChange={event => choose(event.target.files?.[0])} />
          {file ? <>
            <span className="upload-icon file" aria-hidden="true"><FileText size={20} /></span>
            <span className="upload-text">
              <strong>{file.name}</strong>
              <small>{formatSize(file.size)} · Crystal Reports file</small>
            </span>
            <button type="button" className="icon-button upload-clear" aria-label="Remove the chosen file"
              onClick={event => { event.preventDefault(); setFile(null); if (picker.current) picker.current.value = ""; }}>
              <X size={16} />
            </button>
          </> : <>
            <span className="upload-icon" aria-hidden="true"><Upload size={20} /></span>
            <span className="upload-text">
              <strong>Drop a .rpt file here, or <span className="upload-browse">browse</span></strong>
              <small>Crystal Reports files only</small>
            </span>
          </>}
        </label>
        <div className="upload-actions">
          <label className="upload-folder">
            <span>Folder</span>
            <select name="folder" required defaultValue={folders[0].key}>
              {folders.map(folder => <option key={folder.key} value={folder.key}>{folder.category}</option>)}
            </select>
          </label>
          <button className="button primary" disabled={!file}>
            {busy ? <><span className="spinner" aria-hidden="true" /> {busy}</> : <><Upload size={15} aria-hidden="true" /> Upload</>}
          </button>
        </div>
      </fieldset>
    </form>}

    {staged && <div className="upload-review">
      <h3>{staged.fileName}</h3>
      <p className="muted">Folder: {staged.category} · {staged.prompts} parameter{staged.prompts === 1 ? "" : "s"}</p>
      <ul className="database-status-list" aria-label="Databases this report uses">
        {staged.connections.map(connection => <li key={connection.id}>
          <Database size={16} aria-hidden="true" /> <strong>{connection.label}</strong>
          <span className={`status-pill status-${connection.status}`}>{statusText[connection.status]}</span>
        </li>)}
        {staged.connections.length === 0 && <li>This report doesn't read from a database.</li>}
      </ul>
      {blocked.length > 0 && <p className="error-banner" role="alert">This report can't be published until the
        server's settings for {blocked.map(item => item.label).join(", ")} are fixed.</p>}
      {pending.map(connection => <DatabaseLoginForm key={connection.id} connection={connection} upload={staged.token}
        onSaved={() => setStaged(current => current && {
          ...current,
          connections: current.connections.map(item => item.id === connection.id ? { ...item, status: "saved" } : item),
        })} />)}
      {staged.exists && <label className="checkbox">
        <input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />
        Replace the existing report with this name
      </label>}
      <div className="database-login-actions">
        <button className="button primary" disabled={!!busy || pending.length > 0 || blocked.length > 0
          || (staged.exists && !replace)} onClick={() => {
          setBusy("Publishing…");
          setError("");
          void send(`admin/report-uploads/${staged.token}/publish`, "POST", JSON.stringify({ replace })).then(async response => {
            if (!response.ok) throw new Error(await problemText(response, "The report could not be published. Try again."));
            setDone(`${staged.fileName} is published. It will appear in the catalog within a few seconds.`);
            setStaged(null);
            onPublished();
          }).catch((failure: unknown) => setError(failure instanceof Error && failure.message ? failure.message
            : "The report could not be published. Try again.")).finally(() => setBusy(""));
        }}>{busy === "Publishing…" ? busy : "Publish report"}</button>
        <button type="button" className="button" disabled={!!busy} onClick={() => {
          void send(`admin/report-uploads/${staged.token}`, "DELETE").catch(() => undefined);
          setStaged(null);
        }}>Cancel upload</button>
      </div>
      {pending.length > 0 && <p className="muted small">Save a login for every database above to publish.</p>}
    </div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </section>;
}

/** Administrator list of every database the reports use, with its saved login (never the password). */
export function ReportDatabases({ revision }: { revision: number }) {
  const [databases, setDatabases] = useState<DatabaseView[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const load = useCallback(() => {
    setError("");
    void apiRequest("admin/report-databases").then(async response => {
      if (!response.ok) throw new Error();
      setDatabases(await response.json());
    }).catch(() => setError("Unable to load the report databases. Try again."));
  }, []);
  useEffect(load, [load, revision]);

  return <section className="settings-group report-admin" aria-labelledby="report-databases-title">
    <header className="settings-group-head"><div>
      <h3 id="report-databases-title"><Database size={15} aria-hidden="true" /> Database logins</h3>
    </div></header>
    {databases === null && !error && <SettingRowsSkeleton rows={2} label="Loading database logins…" />}
    {databases?.length === 0 && <p className="muted">No reports use a database yet.</p>}
    {!!databases?.length && <ul className="database-list">
      {databases.map(database => <li key={database.id}>
        <div className="database-row">
          <div className="database-identity">
            <strong>{database.label}</strong>
            <span className={`status-pill status-${database.status}`}>{statusText[database.status]}</span>
            <p className="database-meta">
              {database.login && <span>Login: {database.login}</span>}
              <span title={database.reports.join("\n") || undefined}>
                {database.reports.length ? `${database.reports.length} ${database.reports.length === 1 ? "report" : "reports"}` : "No reports"}
              </span>
            </p>
          </div>
          {(database.status === "saved" || database.status === "needs-login") && editing !== database.id &&
            <div className="database-login-actions">
              <button className="button" onClick={() => setEditing(database.id)}>
                {database.status === "saved" ? "Change login" : "Add login"}
              </button>
              {database.status === "saved" && <button className="button" onClick={() => {
                if (!window.confirm(`Remove the saved login for ${database.label}? Reports that use it will stop running until a new login is saved.`)) return;
                void send(`admin/report-databases/${encodeURIComponent(database.id)}`, "DELETE")
                  .then(response => { if (!response.ok && response.status !== 404) throw new Error(); load(); })
                  .catch(() => setError("The login could not be removed. Try again."));
              }}>Remove login</button>}
            </div>}
        </div>
        {editing === database.id && <DatabaseLoginForm connection={database} savedLogin={database.login}
          onCancel={() => setEditing("")} onSaved={() => { setEditing(""); load(); }} />}
      </li>)}
    </ul>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </section>;
}
