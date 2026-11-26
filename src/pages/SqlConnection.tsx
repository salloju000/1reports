import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError, csrfToken } from "../services/api";

type ConnectionDetails = {
  host: string;
  port: number;
  database: string;
  encryption: string;
};

function requestError(status: number) {
  if (status === 400) return "Check the approved database name and SQL credentials, then try again.";
  if (status === 401) return "Sign in to 1Reports before checking the connection.";
  if (status === 403) return "Use an administrator account and the approved read-only SQL login.";
  if (status === 422) return "SQL Server rejected the login or database access. Check your credentials.";
  if (status === 429) return "Too many checks. Wait a minute and try again.";
  if (status === 504) return "The connection check timed out. Try again.";
  return "The connection check is unavailable. Try again or contact your administrator.";
}

export function SqlConnection({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<ConnectionDetails>();

  useEffect(() => () => {
    active.current?.abort();
  }, []);

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;

    const form = event.currentTarget;
    const passwordField = form.elements.namedItem("password") as HTMLInputElement;
    const values = new FormData(form);
    passwordField.value = "";
    setError("");
    setDetails(undefined);

    if (window.location.protocol !== "https:") {
      setError("Open 1Reports over HTTPS to send database credentials.");
      return;
    }

    const database = String(values.get("database") ?? "").trim();
    const login = String(values.get("login") ?? "").trim();
    if (login.toLowerCase() === "sa") {
      setError("The Hub blocks the SQL Server administrator login (sa). Use a dedicated read-only login for the approved database.");
      return;
    }
    if (!database || !login) {
      setError("Enter the approved database name and a dedicated SQL login.");
      return;
    }

    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    active.current = controller;
    setBusy(true);
    try {
      const token = await csrfToken(signal);
      const response = await apiRequest("sql/check", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({ database, login, password: values.get("password") }),
      });
      const result = await response.json().catch(() => undefined);
      if (!response.ok) {
        if (response.status === 401) onUnauthorized?.();
        throw new ApiError(response.status);
      }
      if (
        typeof result?.host !== "string" || !Number.isInteger(result.port) ||
        typeof result.database !== "string" || typeof result.encryption !== "string"
      ) {
        throw new Error();
      }
      setDetails(result);
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof ApiError && failure.status === 401) onUnauthorized?.();
        setError(signal.aborted
          ? "The connection check timed out. Try again."
          : failure instanceof ApiError
            ? requestError(failure.status)
            : "Unable to verify the SQL connection. Try again.");
      }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="settings-group report-admin" aria-labelledby="sql-connection-title">
      <header className="settings-group-head"><div>
        <h3 id="sql-connection-title">SQL Server connection</h3>
        <p>Test a read-only login. Nothing is saved.</p>
      </div></header>
      <form method="post" onSubmit={check} aria-busy={busy} className="connection-check">
        <fieldset disabled={busy}>
          <label>
            Database name
            <input name="database" required maxLength={128} />
          </label>
          <label>
            SQL login
            <input name="login" required maxLength={128} autoComplete="off" />
          </label>
          <label>
            SQL password
            <input name="password" type="password" required maxLength={128} autoComplete="off" />
          </label>
          <button className="button primary" type="submit">
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "Checking connection…" : "Check connection"}
          </button>
        </fieldset>
      </form>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {details && (
        <div role="status">
          <p className="success-status">Connected successfully.</p>
          <dl className="metadata">
            <div><dt>SQL Server</dt><dd>{details.host}:{details.port}</dd></div>
            <div><dt>Database</dt><dd>{details.database}</dd></div>
            <div><dt>Encryption</dt><dd>{details.encryption}</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}
