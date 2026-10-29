// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  normalizeQuery,
  paginationWindow,
  filterCatalog,
  defaultQuery,
} from "./catalog";
import { validateParameters } from "./execution";
import { recentReports } from "./activity";
import {
  alternativeReport,
  alternativeRepository,
} from "../test/alternativeRepository";
import { repository, localStore } from "./repository";
import type { Activity, Report } from "../types";

describe("query normalization and scale", () => {
  it.each(["-1", "1.4", "NaN", "Infinity", "9007199254740992"])(
    "normalizes invalid page %s",
    (page) => {
      expect(
        normalizeQuery(
          new URLSearchParams({ page, sort: "wrong", usage: "wrong" }),
        ),
      ).toMatchObject({ page: 1, sort: "name", usage: "" });
    },
  );
  it("clears unavailable categories and filter values using repository metadata", () => {
    expect(
      normalizeQuery(
        new URLSearchParams("category=finance&department=Finance&type=Summary"),
        alternativeRepository().metadata,
      ),
    ).toMatchObject({ category: "", department: "", type: "" });
  });
  it("returns an effective page and bounds pagination for thousands of pages", () => {
    const source: Report[] = Array.from({ length: 576 }, (_, i) => ({
      ...alternativeReport,
      id: String(i),
    }));
    expect(
      filterCatalog(
        source,
        { ...defaultQuery, page: 1000 },
        { capacity: "Capacity" },
        "2026-10-29",
      ),
    ).toMatchObject({ page: 29, pages: 29 });
    expect(paginationWindow(15, 29)).toEqual([
      1,
      "ellipsis",
      14,
      15,
      16,
      "ellipsis",
      29,
    ]);
    expect(paginationWindow(5000, 10000)).toHaveLength(7);
  });
});
describe("parameter boundaries", () => {
  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "0000-01-01",
    "not-a-date",
  ])("rejects invalid calendar date %s", (asOf) => {
    expect(
      validateParameters(alternativeReport, {
        company: "Alternative Company",
        asOf,
      }).asOf,
    ).toBe("Enter a valid date.");
  });
  it("rejects wrong scalar types and unknown configured selections", () => {
    expect(
      validateParameters(alternativeReport, {
        company: ["Alternative Company"],
        asOf: "2026-10-29",
      }).company,
    ).toBeTruthy();
    expect(
      validateParameters(alternativeReport, {
        company: "Unknown",
        asOf: "2026-10-29",
      }).company,
    ).toBeTruthy();
    const report = {
      ...alternativeReport,
      parameters: [
        {
          id: "branches",
          label: "Branches",
          kind: "multi-select" as const,
          options: ["Mumbai"],
        },
      ],
    };
    expect(
      validateParameters(report, { branches: "Mumbai" }).branches,
    ).toBeTruthy();
    expect(
      validateParameters(report, { branches: ["Unknown"] }).branches,
    ).toBeTruthy();
    expect(validateParameters(report, { branches: ["Mumbai"] })).toEqual({});
  });
});
describe("access activity", () => {
  it("ignores favorite changes when computing access times and preserves execution status", () => {
    const events: Activity[] = [
      {
        id: "1",
        reportId: "other-1",
        kind: "viewed",
        at: "2026-10-28T10:00:00Z",
        source: "local",
      },
      {
        id: "2",
        reportId: "other-1",
        kind: "favorite-added",
        at: "2026-10-29T10:00:00Z",
        source: "local",
      },
    ];
    expect(recentReports(events, [alternativeReport], [])[0]).toMatchObject({
      accessedAt: "2026-10-28T10:00:00Z",
      status: "viewed",
    });
    events.push({
      id: "3",
      reportId: "other-1",
      kind: "demo-completed",
      at: "2026-10-29T11:00:00Z",
      source: "local",
    });
    expect(recentReports(events, [alternativeReport], [])[0].status).toBe(
      "demo-completed",
    );
  });
  it("records the same interaction token once but allows a later deliberate view", async () => {
    const count = localStore.data.activity.length;
    const token = crypto.randomUUID();
    await repository.recordActivity("finance-1", "viewed", token);
    await repository.recordActivity("finance-1", "viewed", token);
    expect(localStore.data.activity.length).toBe(count + 1);
    await repository.recordActivity("finance-1", "viewed", crypto.randomUUID());
    expect(localStore.data.activity.length).toBe(count + 2);
  });
  it("provides category-specific preview columns", async () => {
    expect((await repository.getPreview("inventory-1")).columns).toContain(
      "Material",
    );
    expect((await repository.getPreview("receivable-1")).columns).toContain(
      "Overdue (INR)",
    );
  });
});
