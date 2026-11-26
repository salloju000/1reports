// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App, type SessionControls } from "../App";

const library = [
  { id: "estimate", name: "Job Cost Estimate", category: "Estimation" },
  { id: "pouch-qc", name: "Pouch Seal Strength", category: "Quality" },
  { id: "slit-plan", name: "Slitting Plan", category: "Production" },
];
let collections: Record<string, string[]>;
let requests: { path: string; method: string; body?: unknown }[];
let failNext = false;
/** Departments a test adds beyond the standard three. */
let extraDepartments: [string, string][] = [];

const session: SessionControls = {
  email: "admin@plant.example", administrator: true, busy: false, error: "",
  signOut: () => undefined, onUnauthorized: () => undefined,
};

beforeEach(() => {
  collections = { estimation: ["estimate"], pouching: [], slitting: ["slit-plan"] };
  requests = [];
  failNext = false;
  extraDepartments = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.replace(/^.*\/api\//, "");
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (path === "auth/csrf") return Response.json({ token: "token" });
    if (path === "workspace") return Response.json({ reports: [], favorites: [], activity: [] });
    if (path === "admin/report-assignments") return Response.json({
      reports: library,
      departments: [["estimation", "Estimation"], ["pouching", "Pouching"], ["slitting", "Slitting"], ...extraDepartments]
        .map(([id, name]) => ({ id, name, users: 2, reportIds: [...collections[id]] })),
    });
    requests.push({ path, method, body });
    if (failNext) {
      failNext = false;
      return new Response(null, { status: 500 });
    }
    const assignment = path.match(/^admin\/departments\/([^/]+)\/reports\/([^/]+)$/);
    if (assignment) {
      const [, department, report] = assignment;
      collections[department] = method === "PUT"
        ? [...new Set([...collections[department], report])]
        : collections[department].filter(id => id !== report);
      return new Response(null, { status: 204 });
    }
    if (path === "admin/report-assignments/move") {
      collections[body.from] = collections[body.from].filter(id => id !== body.reportId);
      collections[body.to] = [...new Set([...collections[body.to], body.reportId])];
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }));
  window.location.hash = "#/access";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

/** jsdom has no DataTransfer: a minimal one is enough for the page's handlers. */
function dataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "", dropEffect: "",
  };
}
function drag(source: HTMLElement, target: HTMLElement, init: { ctrlKey?: boolean } = {}) {
  const transfer = dataTransfer();
  act(() => { fireEvent.dragStart(source, { dataTransfer: transfer }); });
  for (const type of ["dragOver", "drop"] as const) {
    const event = createEvent[type](target, { dataTransfer: transfer, ...init });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    Object.assign(event, init);
    act(() => { fireEvent(target, event); });
  }
  act(() => { fireEvent.dragEnd(source, { dataTransfer: transfer }); });
}
const department = (name: string) => screen.getByRole("region", { name });
const tile = (name: string) => screen.getByText(name, { selector: ".access-report strong" }).closest("li")!;
const held = (name: string) => within(department(name)).queryAllByRole("listitem").map(item => item.textContent);

it("assigns, copies, moves and removes reports by dragging, without touching the library", async () => {
  render(<App session={session} />);
  await screen.findByRole("heading", { name: "Available reports 3" });

  // Library → Pouching assigns.
  drag(tile("Pouch Seal Strength"), department("Pouching"));
  await waitFor(() => expect(requests.at(-1)).toMatchObject({ path: "admin/departments/pouching/reports/pouch-qc", method: "PUT" }));
  expect(held("Pouching")).toEqual(["Pouch Seal Strength"]);
  expect(within(tile("Pouch Seal Strength")).getByRole("list", { name: "Departments with access" })).toHaveTextContent("Pouching");

  // Pouching → Estimation with Ctrl copies: Pouching keeps it.
  drag(within(department("Pouching")).getByRole("listitem"), department("Estimation"), { ctrlKey: true });
  await waitFor(() => expect(requests.at(-1)).toMatchObject({ path: "admin/departments/estimation/reports/pouch-qc", method: "PUT" }));
  expect(held("Pouching")).toEqual(["Pouch Seal Strength"]);

  // Pouching → Slitting without a modifier moves: Estimation keeps its copy.
  drag(within(department("Pouching")).getByRole("listitem"), department("Slitting"));
  await waitFor(() => expect(requests.at(-1)).toMatchObject({
    path: "admin/report-assignments/move", body: { reportId: "pouch-qc", from: "pouching", to: "slitting" } }));
  expect(held("Pouching")).toEqual([]);
  expect(held("Slitting")).toEqual(["Pouch Seal Strength", "Slitting Plan"]);
  expect(held("Estimation")).toEqual(["Job Cost Estimate", "Pouch Seal Strength"]);

  // Slitting → back to the library removes it from Slitting only.
  const chip = within(department("Slitting")).getAllByRole("listitem")[0];
  drag(chip, screen.getByRole("region", { name: /Available reports/ }));
  await waitFor(() => expect(requests.at(-1)).toMatchObject({ path: "admin/departments/slitting/reports/pouch-qc", method: "DELETE" }));
  expect(held("Slitting")).toEqual(["Slitting Plan"]);
  // The library never loses a report.
  expect(screen.getByRole("heading", { name: "Available reports 3" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Pouch Seal Strength removed from Slitting.");
});

it("offers the same changes without a mouse, filters the library and reloads when a save fails", async () => {
  render(<App session={session} />);
  await screen.findByRole("heading", { name: "Available reports 3" });

  fireEvent.click(screen.getByRole("button", { name: "Departments for Job Cost Estimate" }));
  const picker = screen.getByRole("group", { name: "Departments that can open Job Cost Estimate" });
  expect(within(picker).getByRole("checkbox", { name: "Estimation" })).toBeChecked();
  fireEvent.click(within(picker).getByRole("checkbox", { name: "Pouching" }));
  await waitFor(() => expect(held("Pouching")).toEqual(["Job Cost Estimate"]));
  fireEvent.click(screen.getByRole("button", { name: "Remove Job Cost Estimate from Estimation" }));
  await waitFor(() => expect(held("Estimation")).toEqual([]));

  // Search comes from the shell; the access filter narrows to reports in no department.
  window.location.hash = "#/access?search=seal";
  expect(await screen.findByRole("heading", { name: "Available reports 1" })).toBeVisible();
  window.location.hash = "#/access?show=unassigned";
  expect(await screen.findByRole("heading", { name: "Available reports 1" })).toBeVisible();
  expect(tile("Pouch Seal Strength")).toBeVisible();

  // A failed save is reported and the board reloads from the server.
  failNext = true;
  drag(tile("Pouch Seal Strength"), department("Slitting"));
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be saved");
  await waitFor(() => expect(held("Slitting")).toEqual(["Slitting Plan"]));
});

it("lists every report of a large department in a scrolling list", async () => {
  for (let index = 1; index <= 9; index++) library.push({ id: `extra-${index}`, name: `Extra report ${index}`, category: "Quality" });
  collections.pouching = library.map(report => report.id);
  try {
    render(<App session={session} />);
    await screen.findByRole("heading", { name: "Available reports 12" });

    expect(held("Pouching")).toHaveLength(12);
    expect(within(department("Pouching")).getByRole("list", { name: "Reports in Pouching" })).toHaveClass("scrolls");
    // Three or fewer reports need no scrolling.
    expect(within(department("Estimation")).getByRole("list", { name: "Reports in Estimation" })).not.toHaveClass("scrolls");
  } finally {
    library.splice(3);
  }
});

it("lists departments as a checklist with a filter once there are many", async () => {
  const extra = ["Accounts & Finance", "Dispatch", "Extrusion", "IT & Systems", "Lamination", "Quality", "Stores"];
  for (const name of extra) {
    const id = name.toLowerCase().replace(/\W+/g, "-");
    collections[id] = [];
    extraDepartments.push([id, name]);
  }
  render(<App session={session} />);
  await screen.findByRole("heading", { name: "Available reports 3" });

  fireEvent.click(screen.getByRole("button", { name: "Departments for Job Cost Estimate" }));
  const picker = screen.getByRole("group", { name: "Departments that can open Job Cost Estimate" });
  expect(picker).toHaveTextContent("1 of 10 selected");
  fireEvent.change(within(picker).getByRole("searchbox", { name: "Find a department" }), { target: { value: "extr" } });
  expect(within(picker).getAllByRole("checkbox").map(box => box.closest("label")!.textContent)).toEqual(["Extrusion"]);
  fireEvent.change(within(picker).getByRole("searchbox", { name: "Find a department" }), { target: { value: "zzz" } });
  expect(picker).toHaveTextContent("No department matches");
});
