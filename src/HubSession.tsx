import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { App } from "./App";
import { BrandLogo, productName } from "./components/Brand";
import { ShellSkeleton } from "./components/Skeleton";
import { apiRequest, ApiError, csrfToken } from "./services/api";
import { FormError, people } from "./services/people";
import { readOrganization, type Organization } from "./services/organization";
import { Eye, EyeOff, LockKeyhole, ShieldAlert, UserRound, X, type LucideIcon } from "lucide-react";

type Account = {
  id: string; email: string; roles: string[];
  fullName?: string; userName?: string; department?: { id: string; name: string } | null;
  preferences?: { view: "list" | "grid"; density: "comfortable" | "compact" } | null;
  organization: Organization;
};

async function readAccount(signal: AbortSignal): Promise<Account | null> {
  const response = await apiRequest("auth/me", { signal });
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError(response.status);
  const account = await response.json();
  if (typeof account?.id !== "string" || typeof account.email !== "string" ||
      !Array.isArray(account.roles) || !account.roles.every((role: unknown) => typeof role === "string")) {
    throw new Error("Invalid Hub session response.");
  }
  return { ...account, organization: readOrganization(account.organization) };
}

function sessionError(error: unknown, action: "sign in" | "sign out") {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sign-in failed. Check your email or username and password.";
    if (error.status === 403) return "You do not have permission to complete this request.";
    if (error.status === 429) return "Too many requests. Wait a minute and try again.";
    if (error.status === 400) return "The request could not be verified. Try again.";
  }
  return `Unable to ${action}. Try again or contact your administrator.`;
}

export function HubSession() {
  const [account, setAccount] = useState<Account | null>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const active = useRef<AbortController | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [notice, setNotice] = useState("");
  const invitation = readInvitation();
  const secure = window.location.protocol === "https:";

  useEffect(() => {
    if (!secure) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    void readAccount(signal).then(
      (user) => { if (!controller.signal.aborted) setAccount(user); },
      () => {
        if (!controller.signal.aborted) {
          setError("Unable to restore your session.");
          setAccount(null);
        }
      },
    );
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [secure, restoreAttempt]);

  useEffect(() => {
    if (!account) return;
    let pending: AbortController | undefined;
    async function checkSession() {
      if (active.current || pending) return;
      const controller = new AbortController();
      pending = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
      try {
        const user = await readAccount(signal);
        if (!controller.signal.aborted && !active.current) {
          if (!user) expire();
          else if (user.id !== account?.id || user.email !== account?.email ||
              user.roles.join() !== account?.roles.join() ||
              user.department?.id !== account?.department?.id ||
              JSON.stringify(user.organization) !== JSON.stringify(account?.organization)) setAccount(user);
        }
      } catch {
        // A network failure does not establish that the session expired.
      } finally {
        pending = undefined;
      }
    }
    window.addEventListener("focus", checkSession);
    window.addEventListener("hub-unauthorized", expire);
    const interval = window.setInterval(checkSession, 60_000);
    return () => {
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("hub-unauthorized", expire);
      window.clearInterval(interval);
      pending?.abort();
    };
  }, [account]);

  function expire() {
    setAccount(null);
    setError("Your session expired. Sign in again.");
  }

  async function changeSession(action: "sign in" | "sign out", credentials?: FormData) {
    if (!secure || active.current) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const token = await csrfToken(signal);
      const headers: Record<string, string> = { "X-CSRF-TOKEN": token };
      if (credentials) headers["Content-Type"] = "application/json";
      const response = await apiRequest(credentials ? "auth/login" : "auth/logout", {
        method: "POST",
        headers,
        signal,
        body: credentials ? JSON.stringify({
          email: credentials.get("email"), password: credentials.get("password"),
        }) : undefined,
      });
      if (!response.ok) throw new ApiError(response.status);
      if (!credentials) {
        setAccount(null);
        return;
      }
      const user = await readAccount(signal);
      if (!user) throw new Error("The browser could not establish a Hub session.");
      setAccount(user);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (action === "sign out" && failure instanceof ApiError && failure.status === 401) expire();
      else setError(sessionError(failure, action));
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const credentials = new FormData(form);
    (form.elements.namedItem("password") as HTMLInputElement).value = "";
    void changeSession("sign in", credentials);
  }

  useEffect(() => {
    if (!account && (secure || !import.meta.env.DEV)) document.title = `Sign in · ${productName}`;
  }, [account, secure]);

  if (!secure && import.meta.env.DEV) return (
    <>
      {!noticeDismissed && (
        <div className="preview-notice" role="status">
          <span className="preview-notice-icon"><ShieldAlert size={15} aria-hidden="true" /></span>
          <p><strong>Secure connection required</strong><span>Open {productName} over HTTPS to sign in.</span></p>
          <button type="button" className="icon-button" aria-label="Dismiss notice" data-tooltip="Dismiss"
            onClick={() => setNoticeDismissed(true)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <App />
    </>
  );

  // Most visits are by people already signed in: show the workspace taking shape while the session is checked.
  if (secure && account === undefined && !error) return <ShellSkeleton label="Restoring your session…" />;

  if (account) return (
    <App key={JSON.stringify([account.id, account.roles, account.department?.id])} session={{
      email: account.email,
      administrator: account.roles.includes("Administrator"),
      fullName: account.fullName,
      userName: account.userName,
      department: account.department ?? null,
      preferences: account.preferences ?? null,
      organization: account.organization,
      onOrganizationChange: organization => setAccount(current => current && { ...current, organization }),
      busy,
      error,
      signOut: () => void changeSession("sign out"),
      onUnauthorized: expire,
    }} />
  );

  return (
    <main className="sign-in-layout">
      <div className="sign-in-backdrop" aria-hidden="true" />
      <section className="sign-in-hero" aria-hidden="true">
        <BrandLogo />
        <p className="sign-in-tagline">Find <span>|</span> Run <span>|</span> Print</p>
      </section>
      <section className="hub-sign-in" aria-label={`${productName} sign in`}>
      <BrandLogo className="sign-in-compact-logo" />
      <h1>Login</h1>
      <p className="sign-in-intro">Sign in with your work account to access Radius Classic reports.</p>
      {!secure ? <p className="error-banner" role="alert">A secure connection is required. Open {productName} over HTTPS to sign in.</p>
        : invitation ? <AcceptInvitation invitation={invitation} onAccepted={() => {
            window.history.replaceState(null, "", "#/overview");
            setNotice("Your password is set. Sign in with your username or email.");
          }} />
        : <form method="post" onSubmit={signIn}>
          {notice && <p className="success-status" role="status">{notice}</p>}
          <fieldset disabled={busy}>
            <LoginField label="Email or username" icon={UserRound}>
              <input type="text" name="email" autoComplete="username" autoCapitalize="none" placeholder="Enter email or username"
                spellCheck={false} maxLength={256} required />
            </LoginField>
            <LoginField label="Password" icon={LockKeyhole}>
              <PasswordInput name="password" autoComplete="current-password" placeholder="Enter password" />
            </LoginField>
            <button className="button primary sign-in-submit" type="submit">
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </fieldset>
        </form>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {error === "Unable to restore your session." && (
        <button className="text-button" onClick={() => {
          setAccount(undefined);
          setError("");
          setRestoreAttempt((value) => value + 1);
        }}>Retry session restoration</button>
      )}
      </section>
      <footer className="sign-in-footer">© {new Date().getFullYear()} {productName}. All rights reserved.</footer>
    </main>
  );
}

/** A sign-in field in the login card's style: an icon addon beside the input; the label stays for screen readers. */
function LoginField({ label, icon: Icon, children }: { label: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <label className="login-field">
      <span className="sr-only">{label}</span>
      <span className="login-field-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.6} /></span>
      {children}
    </label>
  );
}

/** A password input with a show/hide button. It hides again on submit, so the password never stays on screen. */
function PasswordInput({ name, autoComplete, placeholder }: { name: string; autoComplete: string; placeholder: string }) {
  const [visible, setVisible] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = field.current?.form;
    if (!form) return;
    const hide = () => setVisible(false);
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);
  return <>
    <input ref={field} type={visible ? "text" : "password"} name={name} autoComplete={autoComplete} placeholder={placeholder}
      autoCapitalize="none" spellCheck={false} maxLength={1024} required />
    <button type="button" className="login-field-reveal" aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible} title={visible ? "Hide password" : "Show password"}
      onMouseDown={event => event.preventDefault()}
      onClick={() => { setVisible(value => !value); field.current?.focus(); }}>
      {visible ? <EyeOff size={18} strokeWidth={1.6} /> : <Eye size={18} strokeWidth={1.6} />}
    </button>
  </>;
}

/** An invitation link: #/invite?user=…&token=… — present only until the person has chosen a password. */
function readInvitation() {
  const [page, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  if (page !== "invite") return null;
  const params = new URLSearchParams(query);
  const userId = params.get("user"), token = params.get("token");
  return userId && token ? { userId, token } : null;
}

function AcceptInvitation({ invitation, onAccepted }: {
  invitation: { userId: string; token: string };
  onAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? ""), confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await people.acceptInvitation({ ...invitation, password });
      onAccepted();
    } catch (failure) {
      setError(failure instanceof FormError
        ? failure.fields.password ?? failure.message
        : "Unable to set your password. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form method="post" onSubmit={submit}>
      <p className="sign-in-intro">Choose a password to finish setting up your account.</p>
      <fieldset disabled={busy}>
        <LoginField label="New password" icon={LockKeyhole}>
          <PasswordInput name="password" autoComplete="new-password" placeholder="New password" />
        </LoginField>
        <LoginField label="Confirm password" icon={LockKeyhole}>
          <PasswordInput name="confirm" autoComplete="new-password" placeholder="Confirm password" />
        </LoginField>
        <p className="muted small">At least 12 characters, with upper and lower case letters, a number and a symbol.</p>
        <button className="button primary sign-in-submit" type="submit">
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Saving…" : "Set password"}
        </button>
      </fieldset>
      {error && <p className="error-banner" role="alert">{error}</p>}
    </form>
  );
}
