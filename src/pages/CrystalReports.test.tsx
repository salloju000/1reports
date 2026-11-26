// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { CrystalReports } from "./CrystalReports";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("requires both range endpoints and reloads a stale report before running again", async () => {
  let version = "v1";
  const submittedVersions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/csrf")) return Response.json({ token: "token" });
    if (url.endsWith("/view")) return new Response(null, { status: 204 });
    if (url.endsWith("/render")) {
      const request = JSON.parse(String(options?.body));
      submittedVersions.push(request.version);
      return new Response(null, { status: request.version === "v1" ? 409 : 429 });
    }
    return Response.json({
      id: "label", name: "Inventory label", version,
      prompts: [{ name: "period", label: "Period", kind: "Date", optional: true, multiple: false, range: true, choices: [] }],
    });
  }));
  render(<CrystalReports reportId="label" returnLabel="Back" onClose={() => {}} onActivity={() => {}} />);
  // The parameters open in a dialog as soon as the report loads.
  const dialog = await screen.findByRole("dialog", { name: "Report parameters" });
  fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-11-01" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "View" }));
  expect(screen.getByText("Enter both range endpoints.")).toBeVisible();
  expect(screen.getByLabelText("From")).toHaveFocus();
  expect(screen.getByLabelText("From")).toHaveAccessibleDescription(/Enter both range endpoints\./);
  expect(submittedVersions).toEqual([]);

  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-14" } });
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const reload = await screen.findByRole("button", { name: "Reload report" });
  expect(screen.queryByRole("button", { name: "Change parameters" })).not.toBeInTheDocument();
  version = "v2";
  fireEvent.click(reload);

  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "View" }));
  expect(await screen.findByText(/engine is busy/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(submittedVersions).toEqual(["v1", "v2"]);
});

it("shows safe feedback and keeps the entered parameters after an unexpected response", async () => {
  const request = vi.fn(async (url: string) => {
    if (url.endsWith("/csrf")) return Response.json({ token: "token" });
    if (url.endsWith("/view")) return new Response(null, { status: 204 });
    if (url.endsWith("/render")) throw new Error("internal connection details");
    return Response.json({
      id: "label", name: "Inventory label", version: "v1",
      prompts: [{ name: "barcode", label: "Barcode", kind: "String", optional: false, multiple: false, range: false, choices: [] }],
    });
  });
  vi.stubGlobal("fetch", request);
  render(<CrystalReports reportId="label" returnLabel="Back" onClose={() => {}} onActivity={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Barcode"), { target: { value: "110000007972" } });
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection and try again.");
  expect(screen.queryByText(/internal connection details/)).not.toBeInTheDocument();

  // After the first view the parameters stay beside the results, as entered.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const panel = screen.getByRole("complementary", { name: "Parameters" });
  expect(within(panel).getByLabelText("Barcode")).toHaveValue("110000007972");
  expect(within(panel).getByRole("button", { name: "View" })).toBeEnabled();
});

it("asks for nothing and runs straight away when a report has no parameters", async () => {
  const runs: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/csrf")) return Response.json({ token: "token" });
    if (url.endsWith("/view")) return new Response(null, { status: 204 });
    if (url.endsWith("/render")) { runs.push(JSON.parse(String(options?.body)).values); return new Response(null, { status: 429 }); }
    return Response.json({ id: "stock", name: "Stock summary", version: "v1", prompts: [] });
  }));
  render(<CrystalReports reportId="stock" returnLabel="Back" onClose={() => {}} onActivity={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(runs).toEqual([{}]));
});

it("brings the last run back after a page refresh, without asking for the parameters again", async () => {
  const runs: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/csrf")) return Response.json({ token: "token" });
    if (url.endsWith("/view")) return new Response(null, { status: 204 });
    if (url.endsWith("/render")) { runs.push(JSON.parse(String(options?.body)).values); return new Response(null, { status: 429 }); }
    return Response.json({
      id: "label", name: "Inventory label", version: "v1",
      prompts: [{ name: "barcode", label: "Barcode", kind: "String", optional: false, multiple: false, range: false, choices: [] }],
    });
  }));
  const first = render(<CrystalReports reportId="label" returnLabel="Back" onClose={() => {}} onActivity={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Barcode"), { target: { value: "110000007972" } });
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  await waitFor(() => expect(runs).toHaveLength(1));
  first.unmount();

  // The refreshed page: no popup, the report runs again with the same values, which stay editable.
  render(<CrystalReports reportId="label" returnLabel="Back" onClose={() => {}} onActivity={() => {}} />);
  await waitFor(() => expect(runs).toEqual([{ barcode: "110000007972" }, { barcode: "110000007972" }]));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(screen.getByRole("complementary", { name: "Parameters" })).getByLabelText("Barcode")).toHaveValue("110000007972");
});
