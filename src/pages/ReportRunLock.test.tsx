// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrystalReports } from "./CrystalReports";
import { App } from "../App";
import { blockingOperation, resetOperations, startOperation } from "../services/operations";

// The PDF viewer (pdf.js) isn't needed here: show which file is on screen instead.
vi.mock("../components/PdfViewer", () => ({
  PdfViewer: ({ url }: { url: string }) => <div data-testid="pdf">{url}</div>,
}));

type Pending = { resolve: (response: Response) => void; reject: (error: unknown) => void; signal?: AbortSignal; body: string };
let renders: Pending[];
let files = 0;

const pdf = () => new Response(new Blob(["%PDF-1.4"]), { headers: { "Content-Type": "application/pdf" } });

beforeEach(() => {
  renders = [];
  files = 0;
  sessionStorage.clear();
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => `blob:report-${++files}`);
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith("/csrf")) return Promise.resolve(Response.json({ token: "token" }));
    if (url.endsWith("/view")) return Promise.resolve(new Response(null, { status: 204 }));
    if (url.endsWith("/render")) return new Promise<Response>((resolve, reject) => {
      const pending: Pending = { resolve, reject, signal: options?.signal ?? undefined, body: String(options?.body) };
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      renders.push(pending);
    });
    return Promise.resolve(Response.json({
      id: "label", name: "Inventory label", version: "v1",
      prompts: [{ name: "barcode", label: "Barcode", kind: "String", optional: false, multiple: false, range: false, choices: [] }],
    }));
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetOperations();
  window.location.hash = "";
});

async function open(onClose = () => {}) {
  const view = render(<CrystalReports reportId="label" returnLabel="Back to reports" onClose={onClose} onActivity={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Barcode"), { target: { value: "1100" } });
  return view;
}
const viewButton = () => screen.getAllByRole("button", { name: "View" }).at(-1)!;
const settle = (index: number, response: Response | Error) => act(async () => {
  if (response instanceof Response) renders[index].resolve(response); else renders[index].reject(response);
  await Promise.resolve();
});

it("sends one request however fast View is pressed, and locks the screen's exits until it ends", async () => {
  await open();
  const button = viewButton();
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(renders).toHaveLength(1));
  expect(blockingOperation()?.label).toBe("Generating Inventory label");
  expect(screen.getByRole("button", { name: "Back to reports" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Preparing your report");

  // Ctrl+Enter in the parameters while it runs doesn't start another one either.
  fireEvent.keyDown(screen.getByLabelText("Barcode"), { key: "Enter", ctrlKey: true });
  expect(renders).toHaveLength(1);

  await settle(0, pdf());
  expect(await screen.findByTestId("pdf")).toHaveTextContent("blob:report-1");
  expect(blockingOperation()).toBeUndefined();
  expect(screen.getByRole("button", { name: "Back to reports" })).toBeEnabled();
});

it("keeps the earlier result on screen while a new one generates, and when the new one fails", async () => {
  await open();
  fireEvent.click(viewButton());
  await waitFor(() => expect(renders).toHaveLength(1));
  await settle(0, pdf());
  await screen.findByTestId("pdf");

  // Run again with another value: the first result stays, dimmed under a progress strip.
  const panel = screen.getByRole("complementary", { name: "Parameters" });
  fireEvent.change(within(panel).getByLabelText("Barcode"), { target: { value: "2200" } });
  fireEvent.click(within(panel).getByRole("button", { name: "View" }));
  await waitFor(() => expect(renders).toHaveLength(2));
  const results = screen.getByRole("region", { name: "Report results" });
  expect(results).toHaveAttribute("aria-busy", "true");
  expect(within(results).getByText(/Updating the report/)).toBeVisible();
  expect(screen.getByTestId("pdf")).toHaveTextContent("blob:report-1");
  expect(within(panel).getByLabelText("Barcode")).toBeDisabled();

  // The new run fails: the earlier result is kept, and the page says so.
  await settle(1, new Response(null, { status: 429 }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/engine is busy.*Showing the earlier result/);
  expect(screen.getByTestId("pdf")).toHaveTextContent("blob:report-1");
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(blockingOperation()).toBeUndefined();
  expect(within(panel).getByLabelText("Barcode")).toBeEnabled();
});

it("replaces the result only with the newest run, and releases the old file", async () => {
  await open();
  fireEvent.click(viewButton());
  await waitFor(() => expect(renders).toHaveLength(1));
  await settle(0, pdf());
  await screen.findByTestId("pdf");

  fireEvent.click(within(screen.getByRole("complementary", { name: "Parameters" })).getByRole("button", { name: "View" }));
  await waitFor(() => expect(renders).toHaveLength(2));
  await settle(1, pdf());
  await waitFor(() => expect(screen.getByTestId("pdf")).toHaveTextContent("blob:report-2"));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report-1");
});

it("cancels cleanly: back to the earlier result, and a late answer from the cancelled run is ignored", async () => {
  await open();
  fireEvent.click(viewButton());
  await waitFor(() => expect(renders).toHaveLength(1));
  await settle(0, pdf());
  await screen.findByTestId("pdf");

  fireEvent.click(within(screen.getByRole("complementary", { name: "Parameters" })).getByRole("button", { name: "View" }));
  await waitFor(() => expect(renders).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(renders[1].signal?.aborted).toBe(true);
  await waitFor(() => expect(blockingOperation()).toBeUndefined());
  expect(screen.getByRole("region", { name: "Report results" })).toHaveAttribute("aria-busy", "false");
  expect(screen.getByTestId("pdf")).toHaveTextContent("blob:report-1");

  // The server answers the cancelled request after all: nothing changes.
  await settle(1, pdf());
  expect(screen.getByTestId("pdf")).toHaveTextContent("blob:report-1");
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

it("reports a network interruption and lets the person try again", async () => {
  await open();
  fireEvent.click(viewButton());
  await waitFor(() => expect(renders).toHaveLength(1));
  await settle(0, new TypeError("Failed to fetch"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection and try again.");
  expect(blockingOperation()).toBeUndefined();

  // Pressed twice in a row: the first press starts the retry, the second finds nothing to start.
  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(renders).toHaveLength(2));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(renders).toHaveLength(2);
  await settle(1, pdf());
  expect(await screen.findByTestId("pdf")).toBeInTheDocument();
});

it("stops the request and releases the lock when the report closes mid-run", async () => {
  const view = await open();
  fireEvent.click(viewButton());
  await waitFor(() => expect(renders).toHaveLength(1));
  expect(blockingOperation()).toBeDefined();
  view.unmount();
  expect(renders[0].signal?.aborted).toBe(true);
  expect(blockingOperation()).toBeUndefined();
});

it("pauses the header search and the links that would close a generating report", async () => {
  window.location.hash = "#/activity";
  render(<App />);
  const search = await screen.findByRole("combobox", { name: "Search reports" });
  expect(search).toBeEnabled();

  let end = () => {};
  act(() => { end = startOperation("Generating Inventory label", true); });
  expect(search).toBeDisabled();
  expect(search).toHaveAttribute("placeholder", "Search paused while generating");
  const reports = screen.getByRole("link", { name: "Reports" });
  expect(reports).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(reports);
  expect(window.location.hash).toBe("#/activity");

  act(() => end());
  expect(search).toBeEnabled();
  expect(reports).not.toHaveAttribute("aria-disabled");
});

it("asks before Back or a typed address leaves a generating report, and stays if told to", async () => {
  window.location.hash = "#/reports?report=label";
  render(<App />);
  await act(async () => { await Promise.resolve(); });
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  let end = () => {};
  act(() => { end = startOperation("Generating Inventory label", true); });

  await act(async () => {
    window.location.hash = "#/activity";
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(confirm).toHaveBeenCalledWith("Generating Inventory label is still in progress. Leave this page and cancel it?");
  expect(window.location.hash).toBe("#/reports?report=label");

  // Moves that stay on the same report don't ask.
  confirm.mockClear();
  await act(async () => {
    window.location.hash = "#/reports?report=label&search=";
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(confirm).not.toHaveBeenCalled();

  // Agreeing to leave lets the move happen.
  confirm.mockReturnValue(true);
  await act(async () => {
    window.location.hash = "#/activity";
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(window.location.hash).toBe("#/activity");
  act(() => end());
});

it("asks before the tab closes while anything is still running", () => {
  const end = startOperation("Uploading the report", false);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  end();
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
