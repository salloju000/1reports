import { useEffect, useRef, useState, type ElementType, type FormEvent } from "react";
import {
  Building2, Check, Database, Grid2X2, ImageUp, KeyRound, LayoutList, Palette, Rows2, Rows4, SlidersHorizontal,
  Trash2, UserRound,
} from "lucide-react";
import type { MockUser, Preferences } from "../types";
import { PageHeader } from "../components/Workspace";
import { Segmented, SettingRow, SettingsGroup, SettingsSection } from "../components/SettingsKit";
import { SqlConnection } from "./SqlConnection";
import { ReportDatabases, ReportUpload } from "./ReportAdministration";
import { account } from "../services/account";
import { FormError } from "../services/api";
import type { SessionControls } from "../App";
import { useOperation } from "../services/operations";
import {
  logoTypes, logoUrl, maxLogoBytes, noOrganization, organization as organizationApi, type Organization,
} from "../services/organization";

type SectionId = "account" | "security" | "appearance" | "reports" | "organization" | "report-setup";
type Entry = { id: SectionId; label: string; icon: ElementType };

/**
 * Settings: a grouped index on the left and one section at a time on the right (the section is in the URL,
 * so it can be linked and survives a reload). Only settings that do something are here:
 * - Account: who you are, read from the directory (administrators manage it on Users).
 * - Security: change your password (signed-in accounts only).
 * - Appearance and Report preferences: density and the default report view, saved together with one
 *   Save button, to your account when signed in and to this browser otherwise.
 * - Organization (administrators): the organisation name and logo shown in the header.
 * - Report setup (administrators): publishing reports and the database logins they run with.
 */
export function SettingsPage({ user, session, preferences, onChange, params }: {
  user: MockUser | null;
  session?: SessionControls;
  preferences: Preferences;
  onChange: (preferences: Preferences) => Promise<void>;
  params: URLSearchParams;
}) {
  const personal: Entry[] = [
    { id: "account", label: "Account", icon: UserRound },
    ...(session ? [{ id: "security" as const, label: "Security", icon: KeyRound }] : []),
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "reports", label: "Report preferences", icon: SlidersHorizontal },
  ];
  const administration: Entry[] = session?.administrator
    ? [
      { id: "organization", label: "Organization", icon: Building2 },
      { id: "report-setup", label: "Report setup", icon: Database },
    ] : [];
  const requested = params.get("section");
  const section = [...personal, ...administration].find(entry => entry.id === requested)?.id ?? "account";

  // Appearance and Report preferences edit one draft, saved or discarded together.
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [failure, setFailure] = useState("");
  useEffect(() => setDraft(preferences), [preferences.view, preferences.density]);
  const dirty = draft.view !== preferences.view || draft.density !== preferences.density;
  const edit = (next: Partial<Preferences>) => { setSaved(""); setFailure(""); setDraft({ ...draft, ...next }); };
  async function save() {
    setSaving(true);
    setFailure("");
    try {
      await onChange(draft);
      setSaved(session ? "Preferences saved to your account." : "Preferences saved in this browser.");
    } catch {
      setFailure("Saved in this browser only: your account couldn't be updated. Try again.");
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(""), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  const link = (entry: Entry) => (
    <li key={entry.id}>
      <a href={`#/settings?section=${entry.id}`} aria-current={section === entry.id ? "page" : undefined}>
        <entry.icon size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{entry.label}</span>
      </a>
    </li>
  );

  return (
    <div className="settings">
      <PageHeader title="Settings" />
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings">
          <h2>Personal</h2>
          <ul>{personal.map(link)}</ul>
          {administration.length > 0 && <>
            <h2>Administration</h2>
            <ul>{administration.map(link)}</ul>
          </>}
        </nav>

        <div className="settings-content">
          {section === "account" && <AccountSection user={user} session={session} />}
          {section === "security" && session && <SecuritySection />}
          {section === "appearance" && (
            <SettingsSection id="appearance" title="Appearance">
              <SettingsGroup>
                <SettingRow label="Density" description="Compact fits more rows on screen; comfortable gives them more room.">
                  <Segmented label="Density" value={draft.density} onChange={density => edit({ density })} options={[
                    { value: "comfortable", label: "Comfortable", icon: <Rows2 size={15} aria-hidden="true" /> },
                    { value: "compact", label: "Compact", icon: <Rows4 size={15} aria-hidden="true" /> },
                  ]} />
                </SettingRow>
              </SettingsGroup>
            </SettingsSection>
          )}
          {section === "reports" && (
            <SettingsSection id="reports" title="Report preferences">
              <SettingsGroup>
                <SettingRow label="Default view" description="How Reports and Favorites open. You can still switch on the page.">
                  <Segmented label="Default view" value={draft.view} onChange={view => edit({ view })} options={[
                    { value: "list", label: "List", icon: <LayoutList size={15} aria-hidden="true" /> },
                    { value: "grid", label: "Grid", icon: <Grid2X2 size={15} aria-hidden="true" /> },
                  ]} />
                </SettingRow>
              </SettingsGroup>
            </SettingsSection>
          )}
          {section === "organization" && session?.administrator && (
            <OrganizationSection value={session.organization ?? noOrganization}
              onChange={next => session.onOrganizationChange?.(next)} />
          )}
          {section === "report-setup" && session?.administrator && <ReportSetupSection onUnauthorized={session.onUnauthorized} />}

          {(section === "appearance" || section === "reports") && (dirty || saved || failure) && (
            <div className={`settings-savebar${dirty ? " dirty" : ""}`} role={failure ? "alert" : "status"}>
              <p>
                {failure ? failure : dirty ? "You have unsaved changes." : <><Check size={15} aria-hidden="true" /> {saved}</>}
              </p>
              {dirty && <div className="settings-savebar-actions">
                <button className="button" disabled={saving} onClick={() => { setDraft(preferences); setFailure(""); }}>Cancel</button>
                <button className="button primary" disabled={saving} onClick={() => void save()}>
                  {saving && <span className="spinner" aria-hidden="true" />} Save changes
                </button>
              </div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountSection({ user, session }: { user: MockUser | null; session?: SessionControls }) {
  const rows: [string, string][] = session ? [
    ["Name", session.fullName || "Not set"],
    ["Username", session.userName || session.email],
    ["Email", session.email],
    ["Department", session.department?.name ?? "No department"],
    ["Role", session.administrator ? "Administrator" : "User"],
  ] : user ? [
    ["Name", user.name], ["Email", user.email], ["Company", user.company], ["Role", user.role],
  ] : [];
  return (
    <SettingsSection id="account" title="Account">
      {rows.length === 0 ? <p className="settings-empty">Profile details appear once you sign in.</p> : (
        <SettingsGroup description={session && (session.administrator
          ? <>Directory details are managed on <a href="#/users">Users</a>.</>
          : "Your name, department and role are managed by an administrator.")}
          title={session ? "Profile" : undefined}>
          {rows.map(([label, value]) => (
            <SettingRow key={label} label={label}><span className="setting-value">{value}</span></SettingRow>
          ))}
        </SettingsGroup>
      )}
    </SettingsSection>
  );
}

function SecuritySection() {
  const empty = { current: "", next: "", confirm: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const touched = form.current || form.next || form.confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    const local: Record<string, string> = {};
    if (!form.current) local.currentPassword = "Enter your current password.";
    if (!form.next) local.newPassword = "Enter a new password.";
    else if (form.next !== form.confirm) local.confirm = "The new passwords don't match.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await account.changePassword(form.current, form.next);
      setForm(empty);
      setDone(true);
    } catch (failure) {
      setErrors(failure instanceof FormError && Object.keys(failure.fields).length ? failure.fields
        : { form: failure instanceof FormError ? failure.message : "Unable to change your password. Try again." });
    } finally {
      setBusy(false);
    }
  }
  const field = (name: keyof typeof empty, error: string | undefined, autoComplete: string) => (
    <input id={`password-${name}`} type="password" value={form[name]} maxLength={1024} autoComplete={autoComplete}
      aria-invalid={!!error} aria-describedby={error ? `password-${name}-error` : undefined}
      onChange={event => { setDone(false); setForm({ ...form, [name]: event.target.value }); }} />
  );
  const error = (name: string, key: string) => errors[key] &&
    <p id={`password-${name}-error`} className="field-error">{errors[key]}</p>;

  return (
    <SettingsSection id="security" title="Security">
      <form onSubmit={submit} noValidate>
        <fieldset disabled={busy} className="settings-fieldset">
          <SettingsGroup title="Password"
            description="Changing it keeps you signed in here and signs you out everywhere else within a minute.">
            <SettingRow label="Current password" htmlFor="password-current">
              {field("current", errors.currentPassword, "current-password")}{error("current", "currentPassword")}
            </SettingRow>
            <SettingRow label="New password" htmlFor="password-next"
              description="At least 12 characters, with upper and lower case letters, a number and a symbol.">
              {field("next", errors.newPassword, "new-password")}{error("next", "newPassword")}
            </SettingRow>
            <SettingRow label="Confirm new password" htmlFor="password-confirm">
              {field("confirm", errors.confirm, "new-password")}{error("confirm", "confirm")}
            </SettingRow>
          </SettingsGroup>
          {errors.form && <p className="error-banner" role="alert">{errors.form}</p>}
          <div className="settings-actions">
            {done && <p className="success-status" role="status"><Check size={15} aria-hidden="true" /> Password changed.</p>}
            <button type="button" className="button" disabled={!touched}
              onClick={() => { setForm(empty); setErrors({}); }}>Cancel</button>
            <button type="submit" className="button primary" disabled={!touched}>
              {busy && <span className="spinner" aria-hidden="true" />} Change password
            </button>
          </div>
        </fieldset>
      </form>
    </SettingsSection>
  );
}

/** Administrators: publishing reports and the database logins every report runs with. */
function ReportSetupSection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [revision, setRevision] = useState(0);
  return (
    <SettingsSection id="report-setup" title="Report setup">
      <ReportUpload onPublished={() => setTimeout(() => setRevision(value => value + 1), 3000)} />
      <ReportDatabases revision={revision} />
      <SqlConnection onUnauthorized={onUnauthorized} />
    </SettingsSection>
  );
}

/**
 * Administrators: the organisation's name and logo, shown at the start of everyone's header. The logo is
 * saved as soon as it is chosen; the name with its own Save button.
 */
function OrganizationSection({ value, onChange }: { value: Organization; onChange: (organization: Organization) => void }) {
  const [name, setName] = useState(value.name ?? "");
  const [busy, setBusy] = useState<"" | "name" | "logo">("");
  const [errors, setErrors] = useState<{ name?: string; logo?: string }>({});
  const [done, setDone] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  useOperation(!!busy, "Saving the organization branding", false);
  useEffect(() => setName(value.name ?? ""), [value.name]);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(""), 4000);
    return () => clearTimeout(timer);
  }, [done]);
  const changed = name.trim() !== (value.name ?? "");
  const logo = logoUrl(value);

  async function run(kind: "name" | "logo", action: () => Promise<Organization>, message: string) {
    if (busy) return;
    setBusy(kind);
    setErrors({});
    setDone("");
    try {
      onChange(await action());
      setDone(message);
    } catch (failure) {
      const text = failure instanceof FormError ? Object.values(failure.fields)[0] ?? failure.message
        : "The change couldn't be saved. Try again.";
      setErrors({ [kind]: text });
    } finally {
      setBusy("");
    }
  }
  function chooseLogo(file?: File) {
    if (picker.current) picker.current.value = "";
    if (!file) return;
    if (!logoTypes.includes(file.type)) { setErrors({ logo: "Use a PNG, JPEG or WebP image." }); return; }
    if (file.size > maxLogoBytes) { setErrors({ logo: "Use an image of 512 KB or less." }); return; }
    void run("logo", () => organizationApi.saveLogo(file), "Logo updated.");
  }
  function saveName(event: FormEvent) {
    event.preventDefault();
    if (!changed) return;
    if (name.trim().length > 100) { setErrors({ name: "Use at most 100 characters." }); return; }
    void run("name", () => organizationApi.saveName(name), name.trim() ? "Organization name saved." : "Organization name removed.");
  }

  return (
    <SettingsSection id="organization" title="Organization">
      <SettingsGroup title="Branding" description="Shown at the start of the header for everyone.">
        <SettingRow label="Logo" description="PNG, JPEG or WebP, up to 512 KB. A wide or square logo works best.">
          <div className="organization-logo-control">
            <span className="organization-logo-preview" aria-hidden={!logo}>
              {logo ? <img src={logo} alt="Current logo" /> : <Building2 size={22} aria-hidden="true" />}
            </span>
            <input ref={picker} type="file" accept={logoTypes.join(",")} className="sr-only" tabIndex={-1}
              aria-label="Logo image" onChange={event => chooseLogo(event.target.files?.[0])} />
            <div className="organization-logo-actions">
              <button type="button" className="button" disabled={!!busy} onClick={() => picker.current?.click()}>
                {busy === "logo" ? <span className="spinner" aria-hidden="true" /> : <ImageUp size={15} aria-hidden="true" />}
                {logo ? "Replace logo" : "Upload logo"}
              </button>
              {logo && (
                <button type="button" className="button" disabled={!!busy}
                  onClick={() => void run("logo", organizationApi.removeLogo, "Logo removed.")}>
                  <Trash2 size={15} aria-hidden="true" /> Remove
                </button>
              )}
            </div>
          </div>
          {errors.logo && <p className="field-error" role="alert">{errors.logo}</p>}
        </SettingRow>
        <SettingRow label="Organization name" htmlFor="organization-name">
          <form className="organization-name-form" onSubmit={saveName} noValidate>
            <input id="organization-name" value={name} maxLength={100} autoComplete="organization"
              placeholder="e.g. Shree Rama Packaging" aria-invalid={!!errors.name}
              onChange={event => { setDone(""); setErrors({}); setName(event.target.value); }} />
            <button type="submit" className="button primary" disabled={!changed || !!busy}>
              {busy === "name" && <span className="spinner" aria-hidden="true" />} Save
            </button>
          </form>
          {errors.name && <p className="field-error" role="alert">{errors.name}</p>}
        </SettingRow>
      </SettingsGroup>
      {done && <p className="success-status organization-done" role="status"><Check size={15} aria-hidden="true" /> {done}</p>}
    </SettingsSection>
  );
}
