// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { ReportGlyph, paperFormat } from "./ReportGlyph";

it.each([
  ["SRPL-InvRefNEW-4x6", "4 × 6 in label"],
  ["SRPL-OuternEW-4X6", "4 × 6 in label"],
  ["Pallet tag 4 x 6", "4 × 6 in label"],
  ["Shelf label 2.25x1.25", "2.25 × 1.25 in label"],
  ["SRPL-WasteOutputBreakdown", "Document"],
  ["WIP Stock Details For Slittingr-1-11-2026", "Document"],
  ["Report 2026x2027", "Document"],
])("reads the output format of %s", (name, text) => {
  expect(paperFormat(name).text).toBe(text);
});

it("draws labels to their own proportions and documents as a page", () => {
  const { container: label } = render(<ReportGlyph name="Label 4x6" />);
  const stock = label.querySelector("rect.stock")!;
  expect(Number(stock.getAttribute("width")) / Number(stock.getAttribute("height"))).toBeCloseTo(4 / 6);
  expect(label.querySelectorAll("rect.bar").length).toBeGreaterThan(0);
  const { container: page } = render(<ReportGlyph name="Daily summary" />);
  expect(page.querySelector("svg.document")).not.toBeNull();
  expect(page.querySelector("svg")).toHaveProperty("ariaHidden");
});
