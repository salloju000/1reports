// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Details, ReportCollection } from "./Reports";
import { reports } from "../data/mock/reports";
afterEach(cleanup);
describe("report interactions", () => {
  it("opens details and toggles favorite through accessible buttons", () => {
    const open = vi.fn(),
      toggle = vi.fn();
    render(
      <ReportCollection
        items={[reports[0]]}
        view="list"
        favorites={[]}
        onToggle={toggle}
        onOpen={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "General Ledger" }));
    expect(open).toHaveBeenCalledWith("finance-1");
    fireEvent.click(
      screen.getByRole("button", { name: "Add General Ledger to favorites" }),
    );
    expect(toggle).toHaveBeenCalledWith("finance-1");
  });
  it("validates parameters and runs the explicit demo sequence", async () => {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    const changed = vi.fn();
    render(
      <Details
        report={reports[0]}
        favorites={[]}
        onToggle={vi.fn()}
        onClose={vi.fn()}
        onChange={changed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run demonstration" }));
    expect(screen.getByText("Company is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Company *"), {
      target: { value: "Northstar Packaging Ltd." },
    });
    fireEvent.change(screen.getByLabelText("As of date *"), {
      target: { value: "2026-10-29" },
    });
    fireEvent.change(screen.getByLabelText("Report detail *"), {
      target: { value: "Summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run demonstration" }));
    await screen.findByText("Demo processing state");
    expect(
      screen.queryByText("Demonstration complete"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show demo result/ }));
    await screen.findByText("Demonstration complete");
    fireEvent.click(screen.getByRole("button", { name: "PDF · demo only" }));
    expect(screen.getByText(/PDF export is unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run demonstration" }),
      ).toBeInTheDocument(),
    );
  });
});
