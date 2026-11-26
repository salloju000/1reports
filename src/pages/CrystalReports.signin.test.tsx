// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://hub.example.test/"}
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { CrystalReports } from "./CrystalReports";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Connection = { id: string; label: string; status: string };
type Sent = { url: string; method: string; body: Record<string, unknown> };

const plant = { name: "plant", label: "Plant", kind: "String", optional: false, multiple: false, range: false, choices: [] };

/**
 * Opens a report as the Hub serves it: the prompts are withheld while a database still needs a
 * login, and connection details are sent to administrators only.
 */
function open({ administrator = false, needsLogin = false, render: renderResponse, save }: {
  administrator?: boolean; needsLogin?: boolean; render?: () => Response; save?: () => Response;
} = {}) {
  const sent: Sent[] = [];
  let ready = !needsLogin;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    if (url.endsWith("/csrf")) return Response.json({ token: "token" });
    if (url.endsWith("/view")) return new Response(null, { status: 204 });
    if (method !== "GET") sent.push({ url, method, body: JSON.parse(String(options?.body)) });
    if (url.includes("/admin/report-databases/")) {
      const response = (save ?? (() => Response.json({ id: "warehouse", status: "saved", login: "report_user" })))();
      if (response.ok) ready = true;
      return response;
    }
    if (url.endsWith("/render")) return (renderResponse ?? (() => new Response(null, { status: 429 })))();
    const connections: Connection[] = [{ id: "warehouse", label: "Warehouse", status: ready ? "ready" : "needs-login" }];
    return Response.json({
      id: "label", name: "Inventory label", version: "v1",
      prompts: ready ? [plant] : [], setupRequired: !ready, canConfigure: administrator,
      connections: administrator ? connections : [],
    });
  }));
  render(<CrystalReports reportId="label" returnLabel="Back" onClose={() => {}} onActivity={() => {}} />);
  return sent;
}

function problem(status: number, code: string) {
  return Response.json({ code, connections: ["warehouse"], detail: "server detail that is not shown" }, { status });
}

it("runs a ready report without ever asking for a database login", async () => {
  const sent = open();
  fireEvent.change(await screen.findByLabelText("Plant"), { target: { value: "1" } });
  expect(screen.queryByLabelText(/login/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].body).not.toHaveProperty("credentials");
  expect(sent[0].body.values).toEqual({ plant: "1" });
});

it("tells a regular user the report is not ready instead of showing any credential screen", async () => {
  const sent = open({ needsLogin: true });
  expect(await screen.findByRole("heading", { name: "This report isn't ready yet" })).toBeVisible();
  expect(screen.getByText(/administrator still needs to connect it/i)).toBeVisible();
  // The breadcrumb and the notice both lead back to the list.
  expect(screen.getAllByRole("button", { name: /Back/ })).toHaveLength(2);
  expect(screen.queryByLabelText(/login/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Plant")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Warehouse/)).not.toBeInTheDocument();
  expect(sent).toHaveLength(0);
});

it.each([
  ["datasource-needs-setup", 503, /isn't ready yet/i],
  ["datasource-signin-failed", 502, /saved database login is no longer accepted/i],
])("shows a friendly message when a run reports %s", async (code, status, message) => {
  open({ render: () => problem(status, code) });
  fireEvent.change(await screen.findByLabelText("Plant"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.queryByText(/server detail/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
});

it("lets an administrator save the missing login, then shows the report's parameters", async () => {
  const sent = open({ administrator: true, needsLogin: true });
  expect(await screen.findByRole("heading", { name: "Finish setting up this report" })).toBeVisible();
  expect(screen.queryByLabelText("Plant")).not.toBeInTheDocument();
  const password = screen.getByLabelText("Password");
  expect(password).toHaveAttribute("type", "password");
  expect(password).toHaveAttribute("autocomplete", "new-password");
  fireEvent.change(screen.getByLabelText("Login"), { target: { value: " report_user " } });
  fireEvent.change(password, { target: { value: "typed-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Test and save login" }));

  expect(await screen.findByLabelText("Plant")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].method).toBe("PUT");
  expect(sent[0].url).toContain("admin/report-databases/warehouse");
  expect(sent[0].url).not.toContain("typed-secret");
  expect(sent[0].body).toEqual({ login: "report_user", password: "typed-secret" });
  expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain("typed-secret");
});

it("keeps an administrator on the setup form when the database rejects the login", async () => {
  open({ administrator: true, needsLogin: true, save: () => problem(422, "credentials-rejected") });
  fireEvent.change(await screen.findByLabelText("Login"), { target: { value: "report_user" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "typed-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Test and save login" }));
  expect(await screen.findByText(/did not accept this login/i)).toBeVisible();
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.queryByLabelText("Plant")).not.toBeInTheDocument();
  expect(screen.queryByText(/server detail/)).not.toBeInTheDocument();
});

it("blocks the SQL administrator login before making a request", async () => {
  const sent = open({ administrator: true, needsLogin: true });
  fireEvent.change(await screen.findByLabelText("Login"), { target: { value: "SA" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "typed-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Test and save login" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("(sa) cannot be used");
  expect(sent).toHaveLength(0);
});
