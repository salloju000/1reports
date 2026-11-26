import { useMemo, useState, type FormEvent } from "react";
import { Check, Copy, Link2, Pencil, UserPlus, X } from "lucide-react";
import { Field, Modal } from "../components/Dialog";
import { Empty, ErrorState, PageHeader } from "../components/Workspace";
import { UsersSkeleton } from "../components/Skeleton";
import { navigate, useAsync } from "../hooks/useHub";
import {
  FormError, invitationLink, initials, people, suggestUserName,
  type Department, type Person, type PersonInput,
} from "../services/people";

type Status = "" | "active" | "inactive" | "pending";
const noDepartment = "none";

/**
 * Users: accounts, their role and their department. Departments are the index on the left; the list on the
 * right is the selected department, or everyone grouped by department. The shell's search box filters it by
 * name, username or email. Departments themselves are managed on the Departments page.
 */
export function UsersPage({ params, currentEmail }: { params: URLSearchParams; currentEmail: string }) {
  const [revision, setRevision] = useState(0);
  const data = useAsync(() => Promise.all([people.list(), people.departments()])
    .then(([users, departments]) => ({ users, departments })), [revision], true);
  const [editing, setEditing] = useState<Person | "new">();
  const [notice, setNotice] = useState("");
  const [rowError, setRowError] = useState("");
  const [pending, setPending] = useState<string>();
  const refresh = () => setRevision(value => value + 1);

  const department = params.get("department") ?? "";
  const status = (["active", "inactive", "pending"].includes(params.get("status") ?? "") ? params.get("status") : "") as Status;
  const search = (params.get("search") ?? "").trim().toLowerCase();
  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    navigate("users", Object.fromEntries(next), true);
  };

  const users = data.data?.users ?? [];
  const departments = data.data?.departments ?? [];
  const departmentName = useMemo(() => new Map(departments.map(row => [row.id, row.name])), [departments]);
  const unassigned = users.filter(user => !user.departmentId || !departmentName.has(user.departmentId)).length;
  const visible = users.filter(user =>
    (!department || (department === noDepartment
      ? !user.departmentId || !departmentName.has(user.departmentId) : user.departmentId === department)) &&
    (!status || (status === "pending" ? user.invitationPending : status === "active" ? user.active : !user.active)) &&
    (!search || [user.fullName, user.userName, user.email].some(text => text.toLowerCase().includes(search))));

  // Everyone at once is shown department by department; a single department is one plain list.
  const groups = department ? [{ id: department, name: "", rows: visible }]
    : [...departments.map(row => ({ id: row.id, name: row.name, rows: visible.filter(user => user.departmentId === row.id) })),
      { id: noDepartment, name: "No department", rows: visible.filter(user => !user.departmentId || !departmentName.has(user.departmentId)) }]
      .filter(group => group.rows.length > 0);

  async function toggleActive(person: Person) {
    setRowError("");
    setPending(person.id);
    try {
      await people.setActive(person.id, !person.active);
      setNotice(`${person.fullName || person.email} is now ${person.active ? "inactive" : "active"}.`);
      refresh();
    } catch (failure) {
      setRowError(failure instanceof FormError ? failure.message : "Unable to change the account status. Try again.");
    } finally {
      setPending(undefined);
    }
  }

  if (data.error && !data.data) return <><PageHeader title="Users" /><ErrorState text={data.error} retry={data.retry} /></>;
  if (!data.data) return <div className="people"><PageHeader title="Users" /><UsersSkeleton /></div>;

  const selected = department === noDepartment ? "No department" : departmentName.get(department);
  return (
    <div className="people">
      <PageHeader title="Users" count={visible.length} actions={
        <button className="button primary" onClick={() => setEditing("new")}>
          <UserPlus size={15} aria-hidden="true" /> Add user
        </button>
      } />
      {notice && <p className="people-notice" role="status"><Check size={15} aria-hidden="true" />{notice}
        <button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></p>}
      {rowError && <p className="error-banner" role="alert">{rowError}</p>}

      <div className="people-layout">
        <nav className="people-index" aria-label="Departments">
          <ul>
            <IndexItem label="Everyone" count={users.length} active={!department} onSelect={() => setFilter("department", "")} />
          </ul>
          <h2>Departments</h2>
          <ul>
            {departments.map(row => (
              <IndexItem key={row.id} label={row.name} count={row.users} active={department === row.id}
                onSelect={() => setFilter("department", row.id)} />
            ))}
            {unassigned > 0 && <IndexItem label="No department" count={unassigned} active={department === noDepartment}
              onSelect={() => setFilter("department", noDepartment)} />}
          </ul>
        </nav>

        <section className="people-list" aria-label={selected ? `People in ${selected}` : "Everyone"}>
          <div className="catalog-bar">
            <div className="filters">
              {department && <h2 className="people-list-title">{selected ?? "Department"}</h2>}
            </div>
            <label className="pill-select">
              <select aria-label="Filter by account status" value={status} onChange={event => setFilter("status", event.target.value)}>
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Invitation pending</option>
              </select>
            </label>
          </div>
          {visible.length === 0 ? (
            <div className="catalog-surface">
              <Empty title={search || status ? "No one matches" : "No one here yet"}
                text={search || status ? "Try another search or status." : "Add a person and choose this department."}
                action={search || status ? null
                  : <button className="button" onClick={() => setEditing("new")}><UserPlus size={15} aria-hidden="true" /> Add user</button>} />
            </div>
          ) : (
            <div className="catalog-surface report-table-wrap">
              <table className="people-table">
                <caption className="sr-only">{selected ? `People in ${selected}` : "Everyone, by department"}</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                {groups.map(group => (
                  <tbody key={group.id}>
                    {group.name && <tr className="people-group"><th scope="rowgroup" colSpan={5}>
                      {group.name}<span className="count">{group.rows.length}</span></th></tr>}
                    {group.rows.map(person => (
                      <tr key={person.id}>
                        <td>
                          <div className="person">
                            <span className="avatar" aria-hidden="true">{initials(person)}</span>
                            <span>
                              <button className="person-name" onClick={() => setEditing(person)}>
                                {person.fullName || person.email}
                              </button>
                              <small>{person.userName}</small>
                            </span>
                          </div>
                        </td>
                        <td><span className="person-email" title={person.email}>{person.email}</span></td>
                        <td>{person.administrator ? <span className="role-pill">Administrator</span> : "User"}</td>
                        <td><StatusPill person={person} /></td>
                        <td>
                          <div className="row-actions">
                            <button className="icon-button" aria-label={`Edit ${person.fullName || person.email}`}
                              data-tooltip="Edit" onClick={() => setEditing(person)}>
                              <Pencil size={15} />
                            </button>
                            <button className="button small-button" disabled={pending === person.id ||
                              (person.active && person.email.toLowerCase() === currentEmail.toLowerCase())}
                              onClick={() => void toggleActive(person)}
                              aria-label={`${person.active ? "Deactivate" : "Activate"} ${person.fullName || person.email}`}>
                              {pending === person.id && <span className="spinner" aria-hidden="true" />}
                              {person.active ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </section>
      </div>

      {editing && (
        <PersonDialog
          person={editing === "new" ? undefined : editing}
          departments={departments}
          defaultDepartment={department && department !== noDepartment ? department : ""}
          self={editing !== "new" && editing.email.toLowerCase() === currentEmail.toLowerCase()}
          onClose={() => setEditing(undefined)}
          onSaved={message => { setNotice(message); refresh(); }}
        />
      )}
    </div>
  );
}

function IndexItem({ label, count, active, onSelect }: { label: string; count: number; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button aria-pressed={active} onClick={onSelect}>
        <span>{label}</span><span className="count">{count}</span>
      </button>
    </li>
  );
}

function StatusPill({ person }: { person: Person }) {
  if (!person.active) return <span className="status-pill status-inactive">Inactive</span>;
  if (person.invitationPending) return <span className="status-pill status-needs-login">Invitation pending</span>;
  return <span className="status-pill status-ready">Active</span>;
}

function PersonDialog({ person, departments, defaultDepartment, self, onClose, onSaved }: {
  person?: Person;
  departments: Department[];
  defaultDepartment: string;
  self: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const creating = !person;
  const [form, setForm] = useState<Required<Omit<PersonInput, "password">> & { password: string }>({
    role: person?.administrator ? "administrator" : "user",
    fullName: person?.fullName ?? "",
    userName: person?.userName ?? "",
    email: person?.email ?? "",
    departmentId: person?.departmentId ?? defaultDepartment,
    access: "invite",
    password: "",
    active: person?.active ?? true,
  });
  const [userNameTouched, setUserNameTouched] = useState(!creating);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState<{ name: string; link: string }>();

  const set = <K extends keyof typeof form>(name: K, value: (typeof form)[K]) => setForm(current => {
    const next = { ...current, [name]: value };
    if (name === "fullName" && !userNameTouched) next.userName = suggestUserName(String(value));
    return next;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure("");
    const input: PersonInput = {
      fullName: form.fullName, userName: form.userName, email: form.email, departmentId: form.departmentId,
      role: form.role,
    };
    try {
      if (creating) {
        const result = await people.create({
          ...input, access: form.access, active: form.active,
          password: form.access === "password" ? form.password : undefined,
        });
        if (result.invitation) {
          setInvitation({ name: result.user.fullName, link: invitationLink(result.invitation) });
          onSaved(`${result.user.fullName} was added. Share the invitation link to finish.`);
        } else {
          onSaved(`${result.user.fullName} was added and can sign in now.`);
          onClose();
        }
      } else {
        await people.update(person.id, input);
        if (form.active !== person.active) await people.setActive(person.id, form.active);
        onSaved(`${form.fullName.trim()}'s details were saved.`);
        onClose();
      }
    } catch (error) {
      if (error instanceof FormError) {
        setErrors(error.fields);
        setFailure(Object.keys(error.fields).length ? "" : error.message);
        if (error.fields.form) setFailure(error.fields.form);
      } else setFailure("Unable to save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reissue() {
    if (!person) return;
    setBusy(true);
    setFailure("");
    try {
      setInvitation({ name: person.fullName, link: invitationLink(await people.reissueInvitation(person.id)) });
    } catch (error) {
      setFailure(error instanceof FormError ? error.message : "Unable to create a new link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (invitation) return (
    <Modal title="Invitation link" onClose={onClose}>
      <InvitationShare name={invitation.name} link={invitation.link} onDone={onClose} />
    </Modal>
  );

  return (
    <Modal title={creating ? "Add user" : `Edit ${person.fullName || person.email}`} onClose={onClose}>
      <form className="people-form" onSubmit={submit} noValidate>
        <fieldset disabled={busy}>
          <Field label="Full name" error={errors.fullName}>
            <input value={form.fullName} maxLength={200} autoComplete="off" required
              aria-invalid={!!errors.fullName} onChange={event => set("fullName", event.target.value)} />
          </Field>
          <div className="people-form-row">
            <Field label="Username" error={errors.userName} hint="Used to sign in, along with the email address.">
              <input value={form.userName} maxLength={256} autoComplete="off" spellCheck={false} required
                aria-invalid={!!errors.userName}
                onChange={event => { setUserNameTouched(true); set("userName", event.target.value); }} />
            </Field>
            <Field label="Email" error={errors.email}>
              <input type="email" value={form.email} maxLength={254} autoComplete="off" required
                aria-invalid={!!errors.email} onChange={event => set("email", event.target.value)} />
            </Field>
          </div>
          <div className="people-form-row">
            <Field label="Department" error={errors.departmentId}
              hint="They see only the reports assigned to this department.">
              <select value={form.departmentId} required aria-invalid={!!errors.departmentId}
                onChange={event => set("departmentId", event.target.value)}>
                <option value="" disabled>Choose a department</option>
                {departments.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Role" error={errors.role}
              hint={self && form.role === "administrator" ? "You can't remove your own administrator role."
                : form.role === "administrator" ? "Sees every report and manages the workspace." : "Uses reports only."}>
              <select value={form.role} aria-invalid={!!errors.role} disabled={self && form.role === "administrator"}
                onChange={event => set("role", event.target.value as PersonInput["role"] & string)}>
                <option value="user">User</option>
                <option value="administrator">Administrator</option>
              </select>
            </Field>
          </div>

          {creating ? (
            <fieldset className="people-choice">
              <legend>How they get access</legend>
              <label className="choice">
                <input type="radio" name="access" checked={form.access === "invite"} onChange={() => set("access", "invite")} />
                <span><strong>Invitation link</strong><small>They choose their own password. The link works once, for 24 hours.</small></span>
              </label>
              <label className="choice">
                <input type="radio" name="access" checked={form.access === "password"} onChange={() => set("access", "password")} />
                <span><strong>Set a password now</strong><small>Share it with them in person.</small></span>
              </label>
              {form.access === "password" && (
                <Field label="Password" error={errors.password}
                  hint="At least 12 characters, with upper and lower case letters, a number and a symbol.">
                  <input type="password" value={form.password} maxLength={1024} autoComplete="new-password"
                    aria-invalid={!!errors.password} onChange={event => set("password", event.target.value)} />
                </Field>
              )}
            </fieldset>
          ) : person.invitationPending && (
            <div className="people-invite-row">
              <p><Link2 size={15} aria-hidden="true" /> {person.fullName || person.email} hasn't set a password yet.</p>
              <button type="button" className="button" onClick={() => void reissue()}>Create new invitation link</button>
            </div>
          )}

          <label className="checkbox people-active">
            <input type="checkbox" checked={form.active} disabled={self && form.active}
              onChange={event => set("active", event.target.checked)} />
            <span>Active account<small>{self ? "You can't deactivate your own account."
              : "Inactive people can't sign in and are signed out within a minute."}</small></span>
          </label>

          {failure && <p className="error-banner" role="alert">{failure}</p>}
          <footer className="people-dialog-foot">
            <button type="button" className="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary">
              {busy && <span className="spinner" aria-hidden="true" />}
              {creating ? "Add user" : "Save changes"}
            </button>
          </footer>
        </fieldset>
      </form>
    </Modal>
  );
}

function InvitationShare({ name, link, onDone }: { name: string; link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="people-form">
      <p>Send this link to <strong>{name}</strong>. They'll choose a password and can then sign in.
        It works once and expires in 24 hours.</p>
      <div className="invite-link">
        <input readOnly value={link} aria-label="Invitation link" onFocus={event => event.currentTarget.select()} />
        <button type="button" className="button" onClick={() => {
          void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
        }}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <footer className="people-dialog-foot">
        <button type="button" className="button primary" onClick={onDone}>Done</button>
      </footer>
    </div>
  );
}
