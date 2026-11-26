// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App, type SessionControls } from "../App";

const departments = [
  { id: "printing", name: "Printing", description: null },
  { id: "qa", name: "Quality Assurance", description: null },
  { id: "dispatch", name: "Dispatch & Logistics", description: null },
];
type Row = {
  id: string; fullName: string; userName: string; email: string; departmentId: string | null;
  active: boolean; administrator: boolean; invitationPending: boolean;
};
let staff: Row[];
let requests: { path: string; method: string; body: unknown }[];

const session = (administrator = true): SessionControls => ({
  email: "admin@plant.example", administrator, busy: false, error: "",
  signOut: () => undefined, onUnauthorized: () => undefined,
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

beforeEach(() => {
  staff = [
    { id: "admin", fullName: "Admin User", userName: "admin@plant.example", email: "admin@plant.example",
      departmentId: "qa", active: true, administrator: true, invitationPending: false },
    { id: "asha", fullName: "Asha Patil", userName: "asha.patil", email: "asha@plant.example",
      departmentId: "printing", active: true, administrator: false, invitationPending: false },
    { id: "meena", fullName: "Meena Iyer", userName: "meena.iyer", email: "meena@plant.example",
      departmentId: "printing", active: false, administrator: false, invitationPending: false },
    { id: "old", fullName: "", userName: "legacy@plant.example", email: "legacy@plant.example",
      departmentId: null, active: true, administrator: false, invitationPending: false },
  ];
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.replace(/^.*\/api\//, "");
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (method !== "GET") requests.push({ path, method, body });
    if (path === "auth/csrf") return Response.json({ token: "token" });
    if (path === "workspace") return Response.json({ reports: [], favorites: [], activity: [] });
    if (path === "admin/departments") return Response.json(departments.map(row => ({
      ...row, users: staff.filter(user => user.departmentId === row.id).length })));
    if (path === "admin/users" && method === "GET") return Response.json(staff);
    if (path === "admin/users" && method === "POST") {
      if (body.userName === "asha.patil")
        return Response.json({ errors: { userName: ["This username is already in use."] } }, { status: 400 });
      const user = { id: "new", ...body, active: true, administrator: false, invitationPending: body.access === "invite" };
      staff.push(user);
      return Response.json({ user, invitation: { userId: "new", token: "abc" } }, { status: 201 });
    }
    const status = path.match(/^admin\/users\/([^/]+)\/status$/);
    if (status) {
      const user = staff.find(row => row.id === status[1])!;
      user.active = body.active;
      return Response.json(user);
    }
    const update = path.match(/^admin\/users\/([^/]+)$/);
    if (update && method === "PUT") {
      const user = staff.find(row => row.id === update[1])!;
      Object.assign(user, body);
      return Response.json(user);
    }
    return new Response(null, { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("lists people department by department and filters by department, status and the shell search", async () => {
  // The old People address still works.
  window.location.hash = "#/people";
  render(<App session={session()} />);
  const table = await screen.findByRole("table");
  await waitFor(() => expect(window.location.hash).toBe("#/users"));
  expect(within(table).getAllByText("Administrator")).toHaveLength(1);
  const groups = within(table).getAllByRole("rowheader").map(cell => cell.textContent);
  expect(groups).toEqual(["Printing2", "Quality Assurance1", "No department1"]);
  // Someone with no recorded name is listed by their email address.
  expect(within(table).getByRole("button", { name: "legacy@plant.example" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /^Printing/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/users?department=printing"));
  expect(await screen.findByRole("heading", { name: "Users 2" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Admin User" })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Filter by account status"), { target: { value: "inactive" } });
  expect(await screen.findByRole("heading", { name: "Users 1" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Meena Iyer" })).toBeVisible();

  window.location.hash = "#/users?search=asha";
  expect(await screen.findByRole("heading", { name: "Users 1" })).toBeVisible();
  expect(screen.getByRole("searchbox", { name: "Search users" })).toHaveValue("asha");
  expect(screen.getByRole("button", { name: "Asha Patil" })).toBeVisible();
});

it("adds a person with an invitation link, suggesting a username and showing field errors", async () => {
  window.location.hash = "#/users?department=qa";
  render(<App session={session()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add user" }));
  const dialog = await screen.findByRole("dialog", { name: "Add user" });
  fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Asha Patil" } });
  expect(within(dialog).getByLabelText(/^Username/)).toHaveValue("asha.patil");
  fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "asha2@plant.example" } });
  // The department being viewed is preselected.
  expect(within(dialog).getByLabelText(/^Department/)).toHaveValue("qa");
  fireEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
  expect(await within(dialog).findByText("This username is already in use.")).toBeVisible();
  expect(within(dialog).getByLabelText(/^Username/)).toHaveAttribute("aria-invalid", "true");

  fireEvent.change(within(dialog).getByLabelText(/^Username/), { target: { value: "asha.p2" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
  const link = await screen.findByRole("textbox", { name: "Invitation link" });
  expect(link).toHaveValue(`${window.location.origin}/#/invite?user=new&token=abc`);
  expect(requests.at(-1)).toMatchObject({
    path: "admin/users", method: "POST",
    body: { fullName: "Asha Patil", userName: "asha.p2", email: "asha2@plant.example", departmentId: "qa", access: "invite", role: "user" },
  });
  expect((requests.at(-1)!.body as { password?: string }).password).toBeUndefined();
});

it("edits a person's department and deactivates accounts, but never the administrator's own", async () => {
  window.location.hash = "#/users";
  render(<App session={session()} />);
  expect(await screen.findByRole("button", { name: "Deactivate Admin User" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Deactivate Asha Patil" }));
  await screen.findByText("Asha Patil is now inactive.");
  expect(requests.at(-1)).toMatchObject({ path: "admin/users/asha/status", body: { active: false } });
  expect(await screen.findByRole("button", { name: "Activate Asha Patil" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Edit Meena Iyer" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Meena Iyer" });
  fireEvent.change(within(dialog).getByLabelText(/^Department/), { target: { value: "dispatch" } });
  fireEvent.change(within(dialog).getByLabelText(/^Role/), { target: { value: "administrator" } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Active account/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
  await screen.findByText("Meena Iyer's details were saved.");
  expect(requests.slice(-2)).toMatchObject([
    { path: "admin/users/meena", method: "PUT", body: { departmentId: "dispatch", role: "administrator" } },
    { path: "admin/users/meena/status", body: { active: true } },
  ]);
  const table = screen.getByRole("table");
  await waitFor(() => expect(within(table).getAllByRole("rowheader").map(cell => cell.textContent))
    .toContain("Dispatch & Logistics1"));
});

it("doesn't let administrators change their own role", async () => {
  window.location.hash = "#/users";
  render(<App session={session()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Admin User" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Admin User" });
  expect(within(dialog).getByLabelText(/^Role/)).toBeDisabled();
  expect(within(dialog).getByText("You can't remove your own administrator role.")).toBeVisible();
});

it("keeps administration away from people who are not administrators", async () => {
  for (const page of ["users", "departments", "access"]) {
    window.location.hash = `#/${page}`;
    const view = render(<App session={session(false)} />);
    expect(await screen.findByText("Page not found")).toBeVisible();
    view.unmount();
  }
  render(<App session={session(false)} />);
  expect(screen.queryByRole("navigation", { name: "Administration" })).not.toBeInTheDocument();
  for (const name of ["Users", "Departments", "Report access"])
    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  expect(requests.filter(request => request.path.startsWith("admin/"))).toHaveLength(0);
});
