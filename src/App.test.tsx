// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App";
import { repository } from "./services/repository";
afterEach(() => {
  cleanup();
  window.location.hash = "";
});
describe("workspace navigation", () => {
  it("starts with an empty catalog and no demo profile", async () => {
    window.location.hash = "/reports";
    render(<App />);
    await screen.findByRole("heading", { name: "Reports 0" });
    // One search box in the whole workspace.
    expect(screen.getAllByRole("search")).toHaveLength(1);
    expect(screen.queryByText("General Ledger")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open profile menu" }),
    ).not.toBeInTheDocument();
  });
  it("combines catalog filters, resets page and clears an empty state", async () => {
    window.location.hash = "/reports?page=3";
    render(<App repository={repository} />);
    await screen.findByText("Showing 41–60 of 96 reports");
    fireEvent.change(screen.getByLabelText("Filter by category"), {
      target: { value: "finance" },
    });
    await screen.findByRole("heading", { name: "Reports 12" });
    // A single page of results needs no pagination.
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by report type"), {
      target: { value: "Summary" },
    });
    await screen.findByRole("heading", { name: "Reports 4" });
    fireEvent.change(screen.getByLabelText("Filter by department"), {
      target: { value: "Sales" },
    });
    await screen.findByText("No reports found");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByText("Showing 1–20 of 96 reports");
  });
  it("routes global search into the catalog and supports category navigation", async () => {
    render(<App repository={repository} />);
    const search = await screen.findByRole("combobox", { name: "Search reports" });
    fireEvent.change(search, { target: { value: "FIN-001" } });
    fireEvent.submit(search.closest("form")!);
    await screen.findByRole("button", { name: "General Ledger" });
    await screen.findByRole("heading", { name: "Reports 1" });
    // The same box keeps the term once the list is showing.
    expect(screen.getByRole("combobox", { name: "Search reports" })).toHaveValue("FIN-001");
    window.location.hash = "/overview";
    await screen.findByRole("heading", { name: "Browse by category" });
    fireEvent.click(screen.getByRole("button", { name: /^Inventory/ }));
    await screen.findByRole("heading", { name: "Reports 12" });
    expect(window.location.hash).toContain("category=inventory");
  });
  it("shows favorites directly, without the catalog's discovery filters", async () => {
    localStorage.clear();
    window.location.hash = "/favorites";
    render(<App repository={repository} />);
    await screen.findByRole("heading", { name: /^Favorites/ });
    expect(screen.getByRole("combobox", { name: "Search favorites" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by category")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Sort reports")).toBeInTheDocument();
    expect(screen.getAllByRole("search")).toHaveLength(1);
  });
  it("saves settings and switches display style", async () => {
    localStorage.clear();
    window.location.hash = "/settings?section=reports";
    render(<App repository={repository} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Grid" }));
    // Nothing is applied until it's saved; Cancel would discard it.
    expect(screen.getByRole("status")).toHaveTextContent("You have unsaved changes.");
    window.location.hash = "/settings?section=appearance";
    fireEvent.click(await screen.findByRole("radio", { name: "Compact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Preferences saved in this browser.")).toBeVisible();
    const stored = JSON.parse(localStorage.getItem("efi-hub-v1")!);
    expect(stored.preferences).toEqual({ view: "grid", density: "compact" });
    window.location.hash = "/reports";
    await screen.findByRole("heading", { name: "Reports 96" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    const main = screen.getByRole("main");
    // The total is stated once, on the heading.
    expect(within(main).getAllByText("96")).toHaveLength(1);
  });
});
