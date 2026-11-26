import { useEffect, useRef, useState } from "react";
import { Database, Lock } from "lucide-react";
import { apiRequest, csrfToken } from "../services/api";

const messages: Record<string, string> = {
  "credentials-invalid": "Enter a valid database login and password. The SQL Server administrator login (sa) cannot be used.",
  "credentials-rejected": "The database did not accept this login. Check the login and password.",
  "credentials-throttled": "Too many logins were rejected. Wait a few minutes and try again.",
  "datasource-unavailable": "The database could not be reached. Check that its ODBC data source exists on the server.",
  "connection-not-saved": "This database signs in through the server's own settings.",
  "https-required": "Open 1Reports over HTTPS to save database logins.",
};

/**
 * Administrator-only form that tests a database login and, when the database accepts it, saves it
 * (encrypted on the server) for every report that uses this database. The password is sent once
 * in the request body and is never shown, stored in the browser or returned by the server.
 */
export function DatabaseLoginForm({ connection, upload, savedLogin, onSaved, onCancel }: {
  connection: { id: string; label: string };
  upload?: string;
  savedLogin?: string;
  onSaved: (login: string) => void;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const id = `database-login-${connection.id}`;

  return <form ref={form} className="database-login" aria-busy={busy} aria-labelledby={`${id}-title`} onSubmit={event => {
    event.preventDefault();
    if (pending.current) return;
    if (window.location.protocol !== "https:") {
      setError(messages["https-required"]);
      return;
    }
    const data = new FormData(event.currentTarget);
    const login = String(data.get("login") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (login.toLowerCase() === "sa") {
      setError(messages["credentials-invalid"]);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(75000)]);
    setBusy(true);
    setError("");
    void (async () => {
      const token = await csrfToken(signal);
      const response = await apiRequest(`admin/report-databases/${encodeURIComponent(connection.id)}`, {
        method: "PUT", signal,
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({ login, password, ...(upload ? { upload } : {}) }),
      });
      if (response.ok) return true;
      const problem = await response.json().catch(() => null);
      const code = typeof problem?.code === "string" ? problem.code : "";
      throw new Error(messages[code]
        ?? (response.status === 429 ? messages["credentials-throttled"]
          : response.status === 404 ? "This database is no longer used by any report. Reload the page."
          : "The login could not be saved. Try again."));
    })().then(() => {
      if (controller.signal.aborted) return;
      form.current?.reset();
      onSaved(login);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const field = form.current?.elements.namedItem("password");
      if (field instanceof HTMLInputElement) field.value = "";
      setError(signal.aborted ? "The database took too long to respond. Try again."
        : failure instanceof Error && failure.message ? failure.message : "The login could not be saved. Try again.");
    }).finally(() => {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    });
  }}>
    <fieldset disabled={busy}>
      <legend id={`${id}-title`} className="connection-title">
        <span className="connection-icon" aria-hidden="true"><Database size={17} strokeWidth={1.8} /></span>
        <span className="connection-name"><span className="sr-only">Database login: </span>{connection.label}</span>
      </legend>
      <p className="connection-hint">
        {savedLogin
          ? <>Currently saved as <strong>{savedLogin}</strong>. Enter a new login to replace it.</>
          : "Use a dedicated read-only SQL login for this database."}
      </p>
      <div className="connection-fields">
        <label>Login
          <input name="login" required maxLength={128} autoComplete="off" data-1p-ignore data-lpignore="true"
            spellCheck={false} aria-invalid={!!error} />
        </label>
        <label>Password
          {/* "new-password" stops browsers filling in the administrator's own Hub sign-in. */}
          <input name="password" type="password" required maxLength={128} autoComplete="new-password"
            data-1p-ignore data-lpignore="true" aria-invalid={!!error} />
        </label>
      </div>
      {error && <p className="error-banner connection-error" role="alert">{error}</p>}
      <div className="connection-footer">
        <p className="connection-note"><Lock size={14} aria-hidden="true" />
          Tested against the database before it's saved. Stored encrypted and never shown again.</p>
        <div className="database-login-actions">
          {onCancel && <button type="button" className="button" onClick={onCancel}>Cancel</button>}
          <button className="button primary">{busy ? "Testing login…" : "Test and save login"}</button>
        </div>
      </div>
    </fieldset>
  </form>;
}
