// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App";
import { HubSession } from "./HubSession";
import { alternativeReport, alternativeRepository } from "./test/alternativeRepository";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

/** A promise the test settles by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it("shows a report-shaped skeleton first, then keeps results on screen while a filter loads", async () => {
  const adapter = alternativeRepository();
  const real = adapter.repository.getReports.bind(adapter.repository);
  const first = deferred<void>();
  let calls = 0;
  vi.spyOn(adapter.repository, "getReports").mockImplementation(async (...args) => {
    calls += 1;
    if (calls === 1) await first.promise;
    return real(...args);
  });
  window.location.hash = "/reports";
  render(<App {...adapter} />);

  // First load: a skeleton that says what is loading, inside the reports surface.
  const surface = await screen.findByRole("region", { name: "Reports" });
  expect(within(surface).getByRole("status")).toHaveTextContent("Loading reports…");
  expect(surface).toHaveAttribute("aria-busy", "true");
  await act(async () => first.resolve());
  expect(await screen.findByRole("button", { name: alternativeReport.name })).toBeVisible();
  await waitFor(() => expect(surface).toHaveAttribute("aria-busy", "false"));

  // A refresh keeps the current rows visible (no skeleton) until the new results arrive.
  const pending = deferred<void>();
  vi.spyOn(adapter.repository, "getReports").mockImplementation(async (...args) => {
    await pending.promise;
    return real(...args);
  });
  fireEvent.change(screen.getByLabelText("Sort reports"), { target: { value: "usage" } });
  await waitFor(() => expect(surface).toHaveAttribute("aria-busy", "true"));
  expect(screen.getByRole("button", { name: alternativeReport.name })).toBeVisible();
  expect(within(surface).queryByRole("status")).not.toBeInTheDocument();
  await act(async () => pending.resolve());
  await waitFor(() => expect(surface).toHaveAttribute("aria-busy", "false"));
});

it("shows the workspace taking shape while a session is restored, then the sign-in form if signed out", async () => {
  const me = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url.endsWith("/auth/me") ? me.promise : new Response(null, { status: 404 })));
  window.history.replaceState(null, "", "#/overview");
  // jsdom serves http:, and the hub only restores sessions over https.
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, protocol: "https:" } as Location);
  render(<HubSession />);
  expect(screen.getByRole("status")).toHaveTextContent("Restoring your session…");
  await act(async () => me.resolve(new Response(null, { status: 401 })));
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeVisible();
  expect(screen.queryByText("Restoring your session…")).not.toBeInTheDocument();
});

it("shows a user-table skeleton while administration data loads", async () => {
  const users = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/workspace")) return Response.json({ reports: [], favorites: [], activity: [] });
    if (url.endsWith("/admin/users")) return users.promise;
    if (url.endsWith("/admin/departments")) return Response.json([]);
    return new Response(null, { status: 404 });
  }));
  window.location.hash = "#/users";
  render(<App session={{ email: "admin@plant.example", administrator: true, busy: false, error: "",
    signOut: () => undefined, onUnauthorized: () => undefined }} />);
  expect(await screen.findByRole("status")).toHaveTextContent("Loading users…");
  expect(screen.getByRole("heading", { name: "Users" })).toBeVisible();
  await act(async () => users.resolve(Response.json([])));
  await waitFor(() => expect(screen.queryByText("Loading users…")).not.toBeInTheDocument());
});
