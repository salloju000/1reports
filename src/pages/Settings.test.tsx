// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App, type SessionControls } from "../App";
import type { Organization } from "../services/organization";

let requests: { path: string; method: string; body?: unknown }[];
let failPreferences = false;

const session = (overrides: Partial<SessionControls> = {}): SessionControls => ({
  email: "asha@plant.example", userName: "asha.patil", fullName: "Asha Patil", administrator: false,
  department: { id: "printing", name: "Printing" }, preferences: { view: "list", density: "comfortable" },
  busy: false, error: "", signOut: () => undefined, onUnauthorized: () => undefined, ...overrides,
});

beforeEach(() => {
  requests = [];
  failPreferences = false;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.replace(/^.*\/api\//, "");
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (path === "auth/csrf") return Response.json({ token: "token" });
    if (path === "workspace") return Response.json({ reports: [], favorites: [], activity: [] });
    if (path === "admin/organization") {
      requests.push({ path, method, body });
      return Response.json({ name: body.name.trim() || null, logo: null });
    }
    if (path.startsWith("admin/")) return Response.json([]);
    requests.push({ path, method, body });
    if (path === "account/preferences")
      return failPreferences ? new Response(null, { status: 500 }) : new Response(null, { status: 204 });
    if (path === "account/password") return body.currentPassword === "Current-Pass-2026!"
      ? new Response(null, { status: 204 })
      : Response.json({ errors: { currentPassword: ["Your current password is incorrect."] } }, { status: 400 });
    return new Response(null, { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("shows the account from the directory, read-only", async () => {
  window.location.hash = "#/settings";
  render(<App session={session()} />);
  const profile = await screen.findByRole("region", { name: "Profile" });
  for (const value of ["Asha Patil", "asha.patil", "asha@plant.example", "Printing", "User"])
    expect(within(profile).getByText(value)).toBeVisible();
  expect(screen.getByText("Your name, department and role are managed by an administrator.")).toBeVisible();
  expect(within(profile).queryByRole("textbox")).not.toBeInTheDocument();
});

it("starts from the account's saved preferences and saves changes to the account", async () => {
  window.location.hash = "#/settings?section=appearance";
  const { container } = render(<App session={session({ preferences: { view: "grid", density: "compact" } })} />);
  expect(await screen.findByRole("radio", { name: "Compact" })).toBeChecked();
  expect(container.querySelector(".app")).toHaveClass("compact");

  // Cancel discards.
  fireEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  expect(requests).toHaveLength(0);

  fireEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Preferences saved to your account.")).toBeVisible();
  expect(requests).toEqual([{ path: "account/preferences", method: "PUT", body: { view: "grid", density: "comfortable" } }]);
  expect(container.querySelector(".app")).toHaveClass("comfortable");

  // A failed save says so; the change still applies in this browser.
  failPreferences = true;
  fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("your account couldn't be updated");
});

it("changes the password only when the new ones match and the current one is right", async () => {
  window.location.hash = "#/settings?section=security";
  render(<App session={session()} />);
  const current = await screen.findByLabelText("Current password");
  fireEvent.change(current, { target: { value: "wrong" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Laminated-Pouch-2027!" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Laminated-Pouch-2028!" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(screen.getByText("The new passwords don't match.")).toBeVisible();
  expect(requests).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Laminated-Pouch-2027!" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(await screen.findByText("Your current password is incorrect.")).toBeVisible();
  expect(current).toHaveAttribute("aria-invalid", "true");

  fireEvent.change(current, { target: { value: "Current-Pass-2026!" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(await screen.findByText("Password changed.")).toBeVisible();
  expect(current).toHaveValue("");
  expect(requests.at(-1)).toEqual({ path: "account/password", method: "POST",
    body: { currentPassword: "Current-Pass-2026!", newPassword: "Laminated-Pouch-2027!" } });
});

it("shows Report setup to administrators only", async () => {
  window.location.hash = "#/settings?section=report-setup";
  const { unmount } = render(<App session={session()} />);
  const nav = await screen.findByRole("navigation", { name: "Settings" });
  expect(within(nav).queryByRole("link", { name: "Report setup" })).not.toBeInTheDocument();
  // A user following a direct link lands on their account instead.
  expect(screen.getByRole("heading", { name: "Account", level: 2 })).toBeVisible();
  unmount();

  render(<App session={session({ administrator: true })} />);
  const adminNav = await screen.findByRole("navigation", { name: "Settings" });
  expect(within(adminNav).getByRole("link", { name: "Report setup" })).toHaveAttribute("aria-current", "page");
  await waitFor(() => expect(screen.getByRole("heading", { name: "SQL Server connection" })).toBeVisible());
});

it("lets administrators set the organization name shown in the header", async () => {
  function Branded() {
    const [organization, setOrganization] = useState<Organization>({ name: null, logo: null });
    return <App session={session({ administrator: true, organization, onOrganizationChange: setOrganization })} />;
  }
  window.location.hash = "#/settings?section=organization";
  const { container } = render(<Branded />);
  const name = await screen.findByLabelText("Organization name");
  expect(container.querySelector(".organization-brand")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Upload logo" })).toBeVisible();

  fireEvent.change(name, { target: { value: "  Shree Rama Packaging " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Organization name saved.")).toBeVisible();
  expect(requests.at(-1)).toEqual({ path: "admin/organization", method: "PUT", body: { name: "  Shree Rama Packaging " } });
  expect(container.querySelector(".organization-brand")).toHaveTextContent("Shree Rama Packaging");
});

it("keeps the Organization section from people who aren't administrators", async () => {
  window.location.hash = "#/settings?section=organization";
  render(<App session={session()} />);
  expect(await screen.findByRole("region", { name: "Profile" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Organization" })).not.toBeInTheDocument();
});
