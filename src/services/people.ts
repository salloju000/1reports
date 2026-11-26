import { readJson as read, sendJson as send } from "./api";
export { FormError } from "./api";

export type Department = { id: string; name: string; description: string | null; users: number; reports?: number };
export type Person = {
  id: string;
  fullName: string;
  userName: string;
  email: string;
  departmentId: string | null;
  active: boolean;
  administrator: boolean;
  invitationPending: boolean;
};
export type PersonInput = {
  fullName: string;
  userName: string;
  email: string;
  departmentId: string;
  access?: "invite" | "password";
  password?: string;
  active?: boolean;
  role?: "user" | "administrator";
};
export type Invitation = { userId: string; token: string };


export const people = {
  departments: () => read<Department[]>("admin/departments"),
  createDepartment: (input: { name: string; description?: string }) =>
    send<Department>("admin/departments", "POST", input),
  updateDepartment: (id: string, input: { name: string; description?: string | null }) =>
    send<Department>(`admin/departments/${encodeURIComponent(id)}`, "PUT", input),
  deleteDepartment: (id: string) => send<void>(`admin/departments/${encodeURIComponent(id)}`, "DELETE"),
  list: () => read<Person[]>("admin/users"),
  create: (input: PersonInput) =>
    send<{ user: Person; invitation: Invitation | null }>("admin/users", "POST", input),
  update: (id: string, input: PersonInput) => send<Person>(`admin/users/${encodeURIComponent(id)}`, "PUT", input),
  setActive: (id: string, active: boolean) =>
    send<Person>(`admin/users/${encodeURIComponent(id)}/status`, "PUT", { active }),
  reissueInvitation: (id: string) => send<Invitation>(`admin/users/${encodeURIComponent(id)}/invitation`, "POST"),
  acceptInvitation: (input: Invitation & { password: string }) => send<void>("auth/invitation", "POST", input),
};

export type LibraryReport = { id: string; name: string; category: string };
export type DepartmentCollection = { id: string; name: string; users: number; reportIds: string[] };
export type Assignments = { reports: LibraryReport[]; departments: DepartmentCollection[] };

const collection = (department: string, report: string) =>
  `admin/departments/${encodeURIComponent(department)}/reports/${encodeURIComponent(report)}`;

/** Department report collections. Every call is idempotent; none affects the library or other departments. */
export const reportAccess = {
  list: () => read<Assignments>("admin/report-assignments"),
  assign: (department: string, report: string) => send<void>(collection(department, report), "PUT"),
  unassign: (department: string, report: string) => send<void>(collection(department, report), "DELETE"),
  move: (report: string, from: string, to: string) =>
    send<void>("admin/report-assignments/move", "POST", { reportId: report, from, to }),
};

/** The link an invited person opens. The token stays in the fragment, so it never reaches server logs. */
export function invitationLink({ userId, token }: Invitation) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return `${base.href}#/invite?${new URLSearchParams({ user: userId, token })}`;
}

/** "Asha Patil" → "asha.patil": a sensible default username while the administrator types the name. */
export function suggestUserName(fullName: string) {
  return fullName.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 64);
}

export const initials = (person: Pick<Person, "fullName" | "email">) =>
  (person.fullName || person.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map(part => part[0]!.toUpperCase()).join("");
