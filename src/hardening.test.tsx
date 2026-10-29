// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
  renderHook,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App";
import {
  alternativeReport,
  alternativeRepository,
} from "./test/alternativeRepository";
import { useDemoExecution } from "./features/reports/useDemoExecution";
import type { DemoPreview } from "./types";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("independent repository and reliable navigation", () => {
  it("renders independent totals, categories, report fields and filter options", async () => {
    const adapter = alternativeRepository();
    window.location.hash = "/reports";
    render(<App {...adapter} />);
    await screen.findByRole("button", { name: alternativeReport.name });
    expect(
      screen.getByRole("heading", { name: "All Reports 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Planning" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Favorite" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Actions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Northstar Packaging Ltd."),
    ).not.toBeInTheDocument();
    window.location.hash = "/categories";
    await screen.findByRole("button", {
      name: /Capacity Planning Alternative category/,
    });
  });
  it("preserves filters and sorting changed while search is pending", async () => {
    const adapter = alternativeRepository();
    window.location.hash = "/reports";
    render(<App {...adapter} />);
    await screen.findByRole("button", { name: alternativeReport.name });
    fireEvent.change(screen.getByLabelText("Search report catalog"), {
      target: { value: "capacity" },
    });
    fireEvent.change(screen.getByLabelText("Filter by category"), {
      target: { value: "capacity" },
    });
    await waitFor(() =>
      expect(window.location.hash).toContain("category=capacity"),
    );
    fireEvent.change(screen.getByLabelText("Sort reports"), {
      target: { value: "time" },
    });
    await waitFor(() => expect(window.location.hash).toContain("sort=time"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(window.location.hash).toContain("category=capacity");
    expect(window.location.hash).toContain("search=capacity");
    expect(window.location.hash).toContain("sort=time");
  });
  it("normalizes malformed URLs and out-of-range pages", async () => {
    const adapter = alternativeRepository();
    window.location.hash =
      "/reports?category=missing&sort=wrong&usage=unknown&page=Infinity";
    render(<App {...adapter} />);
    await screen.findByText("Showing 1–1 of 1 reports");
    await waitFor(() => expect(window.location.hash).toBe("#/reports"));
    window.location.hash = "/reports?page=999";
    await waitFor(() => expect(window.location.hash).toBe("#/reports"));
  });
  it("recovers from catalog and metadata repository errors", async () => {
    const adapter = alternativeRepository();
    vi.spyOn(adapter.repository, "getMetadata").mockRejectedValueOnce(
      new Error("metadata offline"),
    );
    window.location.hash = "/reports";
    render(<App {...adapter} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: alternativeReport.name });
    vi.spyOn(adapter.repository, "getReports").mockRejectedValueOnce(
      new Error("catalog offline"),
    );
    fireEvent.change(screen.getByLabelText("Sort reports"), {
      target: { value: "time" },
    });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: alternativeReport.name });
  });
});

describe("accessible controls and activity", () => {
  it("focuses parameters for run, restores the opener and uses injected previews", async () => {
    const adapter = alternativeRepository();
    window.location.hash = "/reports";
    render(<App {...adapter} />);
    const opener = await screen.findByRole("button", {
      name: `Run report demo: ${alternativeReport.name}`,
    });
    opener.focus();
    fireEvent.click(opener);
    const company = await screen.findByLabelText("Company *");
    await waitFor(() => expect(company).toHaveFocus());
    fireEvent.change(company, { target: { value: "Alternative Company" } });
    fireEvent.change(screen.getByLabelText("As of date *"), {
      target: { value: "2026-10-29" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run demonstration" }));
    await screen.findByText("Demo processing state");
    fireEvent.click(screen.getByRole("button", { name: "Show demo result" }));
    await screen.findByText("Capacity hours");
    fireEvent.click(screen.getByRole("button", { name: "PDF · demo only" }));
    expect(screen.getByText(/PDF export is unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    await screen.findByRole("button", { name: "Run demonstration" });
    expect(
      screen.queryByText(/PDF export is unavailable/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Close report details" }),
    );
    await waitFor(() => expect(opener).toHaveFocus());
  });
  it("keeps navigation names while collapsed and dismisses popovers and drawer with Escape", async () => {
    const adapter = alternativeRepository();
    render(<App {...adapter} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Collapse sidebar" }),
    );
    expect(
      screen.getByRole("link", { name: "All Reports" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open settings for Taylor Example" }),
    ).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open profile menu" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Profile menu" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Profile menu" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(
      screen.getByRole("button", { name: "Close navigation" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("button", { name: "Close navigation" }),
    ).not.toBeInTheDocument();
  });
  it("records a deep-linked report only once under StrictMode effect replay", async () => {
    const adapter = alternativeRepository();
    const record = vi.spyOn(adapter.repository, "recordActivity");
    window.location.hash = "/reports?report=other-1";
    render(
      <StrictMode>
        <App {...adapter} />
      </StrictMode>,
    );
    await screen.findByRole("dialog", { name: alternativeReport.name });
    expect(record).toHaveBeenCalledTimes(1);
  });
  it("displays recent execution state without treating favorites as access", async () => {
    const adapter = alternativeRepository();
    await adapter.repository.recordActivity("other-1", "demo-completed");
    window.location.hash = "/recent";
    render(<App {...adapter} />);
    const main = await screen.findByRole("main");
    await within(main).findByText("Prototype · Simulated execution");
    expect(
      within(main).getByText(/Demo execution completed/),
    ).toBeInTheDocument();
  });
});

describe("execution serialization", () => {
  it("prevents duplicate completion and supports cancellation", async () => {
    const adapter = alternativeRepository();
    let resolvePreview!: (value: DemoPreview) => void;
    vi.spyOn(adapter.repository, "getPreview").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const execute = vi.spyOn(adapter.repository, "executeDemo");
    const { result } = renderHook(() =>
      useDemoExecution(alternativeReport, adapter.repository, () => {}),
    );
    act(() => {
      result.current.changeValue("company", "Alternative Company");
      result.current.changeValue("asOf", "2026-10-29");
    });
    await act(async () => {
      await result.current.advance("run");
    });
    act(() => {
      void result.current.advance("complete");
      void result.current.advance("complete");
    });
    expect(adapter.repository.getPreview).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePreview({ company: "Alternative Company", columns: [], rows: [] });
    });
    expect(
      execute.mock.calls.filter((call) => call[1] === "complete"),
    ).toHaveLength(1);
    await act(async () => {
      await result.current.advance("reset");
      await result.current.advance("run");
      await result.current.advance("reset");
    });
    expect(result.current.state).toBe("idle");
  });
});
