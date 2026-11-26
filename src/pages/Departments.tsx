import { useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Empty, ErrorState, PageHeader } from "../components/Workspace";
import { DepartmentsSkeleton } from "../components/Skeleton";
import { Field, Modal } from "../components/Dialog";
import { useAsync } from "../hooks/useHub";
import { FormError, people, type Department } from "../services/people";

/**
 * Departments: the units people belong to and reports are assigned to. Each row says how many users and
 * reports the department has, and links to them on the Users and Report access pages.
 */
export function DepartmentsPage() {
  const [revision, setRevision] = useState(0);
  const data = useAsync(() => people.departments(), [revision], true);
  const [editing, setEditing] = useState<Department | "new">();
  const [removing, setRemoving] = useState<Department>();
  const [notice, setNotice] = useState("");
  const refresh = () => setRevision(value => value + 1);
  const saved = (message: string) => { setNotice(message); refresh(); };

  if (data.error && !data.data) return <><PageHeader title="Departments" /><ErrorState text={data.error} retry={data.retry} /></>;
  if (!data.data) return <div className="people"><PageHeader title="Departments" /><DepartmentsSkeleton /></div>;
  const departments = data.data;

  return (
    <div className="people">
      <PageHeader title="Departments" count={departments.length} actions={
        <button className="button primary" onClick={() => setEditing("new")}>
          <Plus size={15} aria-hidden="true" /> Add department
        </button>
      } />
      {notice && <p className="people-notice" role="status"><Check size={15} aria-hidden="true" />{notice}
        <button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></p>}

      {departments.length === 0 ? (
        <div className="catalog-surface">
          <Empty title="No departments yet" text="Add a department, then assign users and reports to it."
            action={<button className="button" onClick={() => setEditing("new")}><Plus size={15} aria-hidden="true" /> Add department</button>} />
        </div>
      ) : (
        <div className="catalog-surface report-table-wrap">
          <table className="people-table departments-table">
            <caption className="sr-only">Departments</caption>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Users</th>
                <th scope="col">Reports</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {departments.map(department => (
                <tr key={department.id}>
                  <td>
                    <div className="department-cell">
                      <button className="person-name" onClick={() => setEditing(department)}>{department.name}</button>
                      {department.description && <small>{department.description}</small>}
                    </div>
                  </td>
                  <td><a className="count-link" href={`#/users?department=${encodeURIComponent(department.id)}`}
                    aria-label={`${department.users} users in ${department.name}`}>{department.users}</a></td>
                  <td><a className="count-link" href="#/access"
                    aria-label={`${department.reports ?? 0} reports assigned to ${department.name}`}>{department.reports ?? 0}</a></td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-button" aria-label={`Edit ${department.name}`} data-tooltip="Edit"
                        onClick={() => setEditing(department)}><Pencil size={15} /></button>
                      <button className="icon-button" aria-label={`Delete ${department.name}`}
                        data-tooltip={department.users ? "Move its users first" : "Delete"}
                        disabled={department.users > 0} onClick={() => setRemoving(department)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <DepartmentDialog department={editing === "new" ? undefined : editing}
        onClose={() => setEditing(undefined)} onSaved={saved} />}
      {removing && <DeleteDialog department={removing} onClose={() => setRemoving(undefined)} onDeleted={saved} />}
    </div>
  );
}

function DepartmentDialog({ department, onClose, onSaved }: {
  department?: Department; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(department?.name ?? "");
  const [description, setDescription] = useState(department?.description ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure("");
    try {
      const input = { name, description: description.trim() || null };
      if (department) await people.updateDepartment(department.id, input);
      else await people.createDepartment({ name, description: input.description ?? undefined });
      onSaved(department ? `${name.trim()} was saved.` : `${name.trim()} was added.`);
      onClose();
    } catch (error) {
      if (error instanceof FormError) {
        setErrors(error.fields);
        if (!Object.keys(error.fields).length) setFailure(error.message);
      } else setFailure("Unable to save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={department ? `Edit ${department.name}` : "Add department"} onClose={onClose}>
      <form className="people-form" onSubmit={submit} noValidate>
        <fieldset disabled={busy}>
          <Field label="Name" error={errors.name}>
            <input value={name} maxLength={100} required aria-invalid={!!errors.name}
              onChange={event => setName(event.target.value)} />
          </Field>
          <Field label="Description" error={errors.description} hint="Optional. What the department does.">
            <textarea value={description} maxLength={300} rows={3} aria-invalid={!!errors.description}
              onChange={event => setDescription(event.target.value)} />
          </Field>
          {failure && <p className="error-banner" role="alert">{failure}</p>}
          <footer className="people-dialog-foot">
            <button type="button" className="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary">
              {busy && <span className="spinner" aria-hidden="true" />}
              {department ? "Save changes" : "Add department"}
            </button>
          </footer>
        </fieldset>
      </form>
    </Modal>
  );
}

/** Deleting asks first: it also clears the department's report collection. */
function DeleteDialog({ department, onClose, onDeleted }: {
  department: Department; onClose: () => void; onDeleted: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  async function remove() {
    setBusy(true);
    setFailure("");
    try {
      await people.deleteDepartment(department.id);
      onDeleted(`${department.name} was deleted.`);
      onClose();
    } catch (error) {
      setFailure(error instanceof FormError ? error.message : "Unable to delete. Try again.");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Delete ${department.name}?`} onClose={onClose}>
      <div className="people-form">
        <p>{department.reports
          ? `Its ${department.reports} assigned ${department.reports === 1 ? "report goes" : "reports go"} with it. `
          : ""}The reports stay in the library and in other departments. This can't be undone.</p>
        {failure && <p className="error-banner" role="alert">{failure}</p>}
        <footer className="people-dialog-foot">
          <button type="button" className="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="button danger" onClick={() => void remove()} disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />} Delete department
          </button>
        </footer>
      </div>
    </Modal>
  );
}
