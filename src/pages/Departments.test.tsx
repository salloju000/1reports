// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App, type SessionControls } from "../App";

type Row = { id: string; name: string; description: string | null; users: number; reports: number };
let departments: Row[];
let requests: { path: string; method: string; body?: unknown }[];

const session = (overrides: Partial<SessionControls> = {}): SessionControls => ({
  email: "admin@plant.example", administrator: true, busy: false, error: "",
  signOut: () => undefined, onUnauthorized: () => undefined, ...overrides,
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

beforeEach(() => {
  departments = [
    { id: "estimation", name: "Estimation", description: "Job costing", users: 0, reports: 3 },
    { id: "printing", name: "Printing", description: null, users: 4, reports: 1 },
  ];
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.replace(/^.*\/api\//, "");
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (path === "auth/csrf") return Response.json({ token: "token" });
    if (path === "workspace") return Response.json({ reports: [], favorites: [], activity: [] });
    if (path === "admin/departments" && method === "GET") return Response.json(departments);
    requests.push({ path, method, body });
    if (path === "admin/departments" && method === "POST") {
      if (body.name.toLowerCase() === "printing")
        return Response.json({ errors: { name: ["A department with this name already exists."] } }, { status: 400 });
      departments.push({ id: "new", name: body.name, description: body.description ?? null, users: 0, reports: 0 });
      return Response.json(departments.at(-1), { status: 201 });
    }
    const one = path.match(/^admin\/departments\/([^/]+)$/);
    if (one && method === "PUT") {
      Object.assign(departments.find(row => row.id === one[1])!, body);
      return Response.json({});
    }
    if (one && method === "DELETE") {
      departments = departments.filter(row => row.id !== one[1]);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("creates, renames and deletes departments, showing each one's users and reports", async () => {
  window.location.hash = "#/departments";
  render(<App session={session()} />);
  expect(await screen.findByRole("heading", { name: "Departments 2" })).toBeVisible();
  expect(screen.getByRole("link", { name: "4 users in Printing" })).toHaveAttribute("href", "#/users?department=printing");
  expect(screen.getByRole("link", { name: "3 reports assigned to Estimation" })).toBeVisible();
  // A department with users can't be deleted.
  expect(screen.getByRole("button", { name: "Delete Printing" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Add department" }));
  let dialog = await screen.findByRole("dialog", { name: "Add department" });
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "printing" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add department" }));
  expect(await within(dialog).findByText("A department with this name already exists.")).toBeVisible();
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Ink Kitchen" } });
  fireEvent.change(within(dialog).getByLabelText(/^Description/), { target: { value: "Ink mixing" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add department" }));
  expect(await screen.findByRole("heading", { name: "Departments 3" })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ method: "POST", body: { name: "Ink Kitchen", description: "Ink mixing" } });

  fireEvent.click(screen.getByRole("button", { name: "Edit Estimation" }));
  dialog = await screen.findByRole("dialog", { name: "Edit Estimation" });
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Estimation & Costing" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("button", { name: "Estimation & Costing" })).toBeVisible();

  // Deleting asks first and says the reports stay in the library.
  fireEvent.click(screen.getByRole("button", { name: "Delete Estimation & Costing" }));
  dialog = await screen.findByRole("dialog", { name: "Delete Estimation & Costing?" });
  expect(dialog).toHaveTextContent("Its 3 assigned reports go with it. The reports stay in the library");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete department" }));
  await waitFor(() => expect(requests.at(-1)).toMatchObject({ path: "admin/departments/estimation", method: "DELETE" }));
  expect(await screen.findByRole("heading", { name: "Departments 2" })).toBeVisible();
});

it("groups administration in the sidebar and drops the Recent and Help screens", async () => {
  window.location.hash = "#/recent";
  render(<App session={session()} />);
  const administration = await screen.findByRole("navigation", { name: "Administration" });
  expect(within(administration).getAllByRole("link").map(link => link.getAttribute("aria-label")))
    .toEqual(["Departments", "Users", "Report access"]);
  await waitFor(() => expect(window.location.hash).toBe("#/overview"));
  for (const name of ["Recent", "Help & Support"]) expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  window.location.hash = "#/help";
  await waitFor(() => expect(window.location.hash).toBe("#/overview"));
});

it("tells a user which department they are in and why they see no reports", async () => {
  window.location.hash = "#/reports";
  const { unmount } = render(<App session={session({ administrator: false, fullName: "Asha Patil", department: null })} />);
  expect(await screen.findByText("You're not in a department yet")).toBeVisible();
  expect(screen.getByText("No department")).toBeVisible();
  unmount();

  render(<App session={session({ administrator: false, fullName: "Asha Patil", department: { id: "printing", name: "Printing" } })} />);
  expect(await screen.findByText("No reports for Printing yet")).toBeVisible();
  expect(screen.getByRole("link", { name: /Asha Patil/ })).toHaveTextContent("Printing");
});
