// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://hub.example.test/1Reports/"}
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HubSession } from "./HubSession";
import { apiUrl } from "./services/api";

const admin = { id: "admin", email: "admin@example.test", roles: ["Administrator"] };
const empty = (status: number) => new Response(null, { status });
const workspace = () => Response.json({ reports: [], favorites: [], activity: [] });

beforeEach(() => {
  // The SQL Server connection check lives in Settings › Report setup, for administrators only.
  window.history.replaceState(null, "", "#/settings?section=report-setup");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("builds same-origin API paths at the root and under the IIS application", () => {
  expect(apiUrl("auth/me", "/")).toBe("/api/auth/me");
  expect(apiUrl("auth/me", "/1Reports/")).toBe("/1Reports/api/auth/me");
});

it("signs in and out with a fresh token after the identity changes", async () => {
  let signedIn = false;
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/auth/me")) return signedIn ? Response.json(admin) : empty(401);
    if (url.endsWith("/workspace")) return workspace();
    if (url.endsWith("/auth/csrf")) return Response.json({ token: signedIn ? "signed-in-token" : "anonymous-token" });
    if (url.endsWith("/auth/login") || url.endsWith("/auth/logout")) {
      signedIn = url.endsWith("/auth/login");
      expect(new Headers(options?.headers).get("X-CSRF-TOKEN")).toBe(signedIn ? "anonymous-token" : "signed-in-token");
      return empty(204);
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", request);
  render(<HubSession />);
  const signIn = await screen.findByRole("button", { name: "Sign in" });
  fireEvent.change(screen.getByLabelText("Email or username"), { target: { value: admin.email } });
  const password = screen.getByLabelText("Password");
  fireEvent.change(password, { target: { value: "example-password" } });
  fireEvent.click(signIn);
  expect(password).toHaveValue("");
  expect(await screen.findByRole("heading", { name: "SQL Server connection" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeVisible();
  expect(screen.queryByText(admin.email)).not.toBeInTheDocument();
  expect(request.mock.calls.map(([url]) => url).filter(url => url.includes("/auth/"))).toEqual([
    "/api/auth/me", "/api/auth/csrf", "/api/auth/login",
    "/api/auth/me", "/api/auth/csrf", "/api/auth/logout",
  ]);
});

it("restores an employee session without administrator controls", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url.endsWith("/auth/me") ? Response.json({ ...admin, roles: [] }) : workspace()));
  render(<HubSession />);
  expect(await screen.findByRole("heading", { name: "Settings" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "SQL Server connection" })).not.toBeInTheDocument();
});

it("revalidates the session on focus and clears an expired account", async () => {
  // Answer by URL, not call order: how many workspace reads happen depends on render timing.
  let expired = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url.endsWith("/auth/me") ? (expired ? empty(401) : Response.json(admin)) : workspace()));
  render(<HubSession />);
  await screen.findByRole("button", { name: "Sign out" });
  expired = true;
  // Re-send focus on each attempt: the listener is attached in an effect that may not have run yet.
  await waitFor(() => {
    fireEvent.focus(window);
    expect(screen.getByRole("alert")).toHaveTextContent("Your session expired");
  });
  expect(screen.queryByText(admin.email)).not.toBeInTheDocument();
});

it("removes administrator controls when session revalidation reports a role change", async () => {
  let account = admin;
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url.endsWith("/auth/me") ? Response.json(account) : workspace()));
  render(<HubSession />);
  await screen.findByRole("heading", { name: "SQL Server connection" });
  account = { ...admin, roles: [] };
  await waitFor(() => {
    fireEvent.focus(window);
    expect(screen.queryByRole("heading", { name: "SQL Server connection" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
});

it("clears the signed-in workspace when the SQL check returns 401", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/auth/me")) return Response.json(admin);
    if (url.endsWith("/workspace")) return workspace();
    if (url.endsWith("/auth/csrf")) return Response.json({ token: "expired-token" });
    if (url.endsWith("/sql/check")) return empty(401);
    throw new Error(`Unexpected request to ${url}`);
  }));
  render(<HubSession />);
  await screen.findByRole("heading", { name: "SQL Server connection" });
  fireEvent.change(screen.getByLabelText("Database name"), { target: { value: "test" } });
  fireEvent.change(screen.getByLabelText("SQL login"), { target: { value: "reader" } });
  fireEvent.change(screen.getByLabelText("SQL password"), { target: { value: "example-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  await screen.findByRole("button", { name: "Sign in" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Your session expired");
  expect(screen.queryByText(admin.email)).not.toBeInTheDocument();
});

it("uses the same live reports for URL search and personal favorites", async () => {
  const reports = [
    { id: "label", name: "Inventory label", category: "Inventory", updatedAt: "2026-11-14T00:00:00Z" },
    { id: "sales", name: "Sales summary", category: "Commercial", updatedAt: "2026-11-14T00:00:00Z" },
  ];
  let favorite = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/auth/me")) return Response.json(admin);
    if (url.endsWith("/auth/csrf")) return Response.json({ token: "token" });
    if (url.endsWith("/reports/label")) {
      return Response.json({ id: "label", name: "Inventory label", version: "v1", prompts: [] });
    }
    if (url.endsWith("/reports/label/view")) return empty(204);
    if (url.endsWith("/favorites/label")) {
      expect(options?.method).toBe("PUT");
      favorite = JSON.parse(String(options?.body)).favorite;
      return Response.json({ favorite });
    }
    return Response.json({ reports, favorites: favorite ? ["label"] : [], activity: [] });
  }));
  window.history.replaceState(null, "", "#/reports?search=inventory");
  render(<HubSession />);
  const add = await screen.findByRole("button", { name: "Add Inventory label to favorites" });
  expect(screen.queryByRole("button", { name: "Sales summary" })).not.toBeInTheDocument();
  fireEvent.click(add);
  await screen.findByRole("button", { name: "Remove Inventory label from favorites" });
  window.location.hash = "#/favorites";
  expect(await screen.findByRole("heading", { name: /^Favorites/ })).toBeVisible();
  expect(await screen.findByRole("button", { name: "Inventory label" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Inventory label" }));
  expect(await screen.findByRole("heading", { name: "Inventory label" })).toBeVisible();
  expect(window.location.hash).toBe("#/favorites?report=label");
  fireEvent.click(screen.getByRole("button", { name: "Back to favorites" }));
  expect(await screen.findByRole("button", { name: "Inventory label" })).toBeVisible();

  window.location.hash = "#/overview";
  fireEvent.click(await screen.findByRole("button", { name: /^Commercial/ }));
  expect(await screen.findByRole("button", { name: "Sales summary" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Inventory label" })).not.toBeInTheDocument();

  const search = screen.getByRole("combobox", { name: "Search reports" });
  fireEvent.change(search, { target: { value: "inventory" } });
  fireEvent.submit(search.closest("form")!);
  // Search narrows the view you are in: the Commercial filter stays until you clear it.
  await screen.findByText("No reports found");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  // The list can re-render while results settle, so re-query instead of holding one element.
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Inventory label" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sales summary" })).not.toBeInTheDocument();
  });
});

it("lets an invited person choose a password, then sign in", async () => {
  const accepted: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/auth/me")) return empty(401);
    if (url.endsWith("/auth/csrf")) return Response.json({ token: "anonymous-token" });
    if (url.endsWith("/auth/invitation")) {
      const body = JSON.parse(String(options?.body));
      if (body.password === "short") return Response.json(
        { errors: { password: ["Passwords must be at least 12 characters."] } }, { status: 400 });
      accepted.push(body);
      return empty(204);
    }
    throw new Error(`Unexpected request to ${url}`);
  }));
  window.history.replaceState(null, "", "#/invite?user=u-1&token=t%2B1");
  render(<HubSession />);
  const password = await screen.findByLabelText("New password");
  fireEvent.change(password, { target: { value: "different-1" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-2" } });
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The passwords don't match.");

  fireEvent.change(password, { target: { value: "short" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "short" } });
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords must be at least 12 characters.");

  fireEvent.change(password, { target: { value: "Corrugated-Roll-2026!" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Corrugated-Roll-2026!" } });
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
  expect(await screen.findByText("Your password is set. Sign in with your username or email.")).toBeVisible();
  expect(screen.getByLabelText("Email or username")).toBeVisible();
  expect(accepted).toEqual([{ userId: "u-1", token: "t+1", password: "Corrugated-Roll-2026!" }]);
  expect(window.location.hash).toBe("#/overview");
});

it("shows and hides the password on the login screen", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/auth/me")) return empty(401);
    if (url.endsWith("/auth/csrf")) return Response.json({ token: "anonymous-token" });
    throw new Error(`Unexpected request to ${url}`);
  }));
  render(<HubSession />);
  await screen.findByRole("button", { name: "Sign in" });
  const password = screen.getByLabelText("Password");
  expect(password).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(password).toHaveAttribute("type", "text");
  expect(password).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(password).toHaveAttribute("type", "password");
});
