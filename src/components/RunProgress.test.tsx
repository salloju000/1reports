// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RunProgress, rememberRun, runMessage, usualSeconds } from "./RunProgress";

afterEach(() => { cleanup(); localStorage.clear(); });

it("moves through the server's steps in their real order, paced by the report's usual time", () => {
  const at = (seconds: number) => runMessage("working", seconds, 10, "PlantmanagerTest").text;
  expect(at(0)).toBe("Preparing your report");
  expect(at(2)).toBe("Connecting to PlantmanagerTest");
  expect(at(4)).toBe("Reading the data");
  expect(at(8)).toBe("Laying out the pages");
  // Past the usual time the last step stays: nothing claims the work is done before it is.
  expect(at(60)).toBe("Laying out the pages");
});

it("says the pages are arriving only once the server has answered", () => {
  expect(runMessage("receiving", 1, 10, null).text).toBe("Almost there — opening the pages");
  expect(runMessage("working", 2, null, null).text).toBe("Connecting to the database");
});

it("notes a slow run honestly, relative to how long this report usually takes", () => {
  expect(runMessage("working", 15, 10, null).slow).toBe(false);
  expect(runMessage("working", 21, 10, null).slow).toBe(true);
  expect(runMessage("working", 30, 20, null).slow).toBe(false);
  expect(runMessage("working", 40, 20, null).slow).toBe(true);
});

it("remembers the last five run times and uses their median", () => {
  expect(usualSeconds("waste")).toBeNull();
  for (const seconds of [4, 40, 5, 6, 3, 7]) rememberRun("waste", seconds);
  expect(usualSeconds("waste")).toBe(6);
});

it("shows what is running and the time against the usual time", () => {
  rememberRun("inv", 9);
  render(<RunProgress reportId="inv" startedAt={Date.now()} phase="working" database={null}
    context="Barcode 1100 · Plant P01" onCancel={() => undefined} />);
  expect(screen.getByRole("status")).toHaveTextContent("Preparing your report");
  expect(screen.getByText("Barcode 1100 · Plant P01")).toBeVisible();
  expect(screen.getByText(/usually about 9s/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
});
