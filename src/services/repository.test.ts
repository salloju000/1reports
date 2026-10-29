// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { reports } from "../data/mock/reports";
import { categories } from "../data/mock/categories";
import {
  defaultQuery,
  queryReports,
  validateParameters,
  LocalStore,
  executionTransition,
  repository,
} from "./repository";
describe("catalog integrity and queries", () => {
  it("contains 96 consistent reports across eight categories", () => {
    expect(reports).toHaveLength(96);
    expect(new Set(reports.map((r) => r.id)).size).toBe(96);
    expect(new Set(reports.map((r) => r.code)).size).toBe(96);
    for (const r of reports) {
      expect(categories.some((c) => c.id === r.categoryId)).toBe(true);
      expect(r.parameters.length).toBeGreaterThan(2);
      expect(new Set(r.parameters.map((p) => p.id)).size).toBe(
        r.parameters.length,
      );
    }
    for (const c of categories)
      expect(reports.filter((r) => r.categoryId === c.id)).toHaveLength(12);
  });
  it("searches report names, codes, descriptions, categories and keywords", () => {
    for (const search of [
      " FIN-001 ",
      "general ledger",
      "reconciliation",
      "financial",
      "Finance",
    ])
      expect(
        queryReports(reports, { ...defaultQuery, search }).total,
      ).toBeGreaterThan(0);
    expect(
      queryReports(reports, { ...defaultQuery, search: "nonexistent report" })
        .total,
    ).toBe(0);
  });
  it("combines filters instead of replacing them", () => {
    const q = {
      ...defaultQuery,
      category: "finance",
      department: "Finance",
      type: "Summary",
      usage: "new" as const,
    };
    const r = queryReports(reports, q);
    expect(r.total).toBe(1);
    expect(r.items[0].code).toBe("FIN-001");
    expect(queryReports(reports, { ...q, department: "Sales" }).total).toBe(0);
  });
  it("sorts by name, usage, time and recent additions", () => {
    for (const sort of ["name", "usage", "time", "added"] as const) {
      const r = queryReports(reports, { ...defaultQuery, sort });
      for (let i = 1; i < r.items.length; i++) {
        const a = r.items[i - 1],
          b = r.items[i];
        if (sort === "name")
          expect(a.name.localeCompare(b.name)).toBeLessThanOrEqual(0);
        if (sort === "usage")
          expect(a.usageCount).toBeGreaterThanOrEqual(b.usageCount);
        if (sort === "time")
          expect(a.typicalExecutionTimeSeconds).toBeLessThanOrEqual(
            b.typicalExecutionTimeSeconds,
          );
        if (sort === "added")
          expect(a.createdAt.localeCompare(b.createdAt)).toBeGreaterThanOrEqual(
            0,
          );
      }
    }
  });
  it("paginates 500-plus reports without overlapping results and clamps invalid pages", () => {
    const large = Array.from({ length: 6 }, (_, n) =>
      reports.map((r) => ({ ...r, id: `${n}-${r.id}` })),
    ).flat();
    const first = queryReports(large, defaultQuery),
      second = queryReports(large, { ...defaultQuery, page: 2 });
    expect(first.total).toBe(576);
    expect(first.pages).toBe(29);
    expect(first.items).toHaveLength(20);
    expect(
      second.items.every((r) => !first.items.some((x) => x.id === r.id)),
    ).toBe(true);
    expect(
      queryReports(large, { ...defaultQuery, page: 999 }).items,
    ).toHaveLength(16);
  });
});
describe("local persistence and activity", () => {
  it("persists favorite removal and addition with matching activity", () => {
    localStorage.clear();
    const s = new LocalStore(localStorage);
    expect(s.toggle("finance-1")).toBe(true);
    expect(s.data.activity[0].kind).toBe("favorite-added");
    expect(new LocalStore(localStorage).data.favorites).toContain("finance-1");
    expect(s.toggle("finance-1")).toBe(false);
    expect(new LocalStore(localStorage).data.favorites).not.toContain(
      "finance-1",
    );
    expect(s.data.activity[0].kind).toBe("favorite-removed");
  });
  it("falls back on corrupt or unavailable storage", () => {
    localStorage.setItem("efi-hub-v1", '{"version":1,"favorites":[3]}');
    expect(new LocalStore(localStorage).warning).toBeTruthy();
    const s = new LocalStore();
    s.toggle("finance-1");
    expect(s.data.favorites).toContain("finance-1");
    expect(s.warning).toContain("session");
  });
  it("returns undefined for missing reports", async () => {
    expect(await repository.getReport("missing")).toBeUndefined();
  });
});
describe("parameter validation and execution", () => {
  it("requires mandatory inputs and validates period order", () => {
    const r = reports.find((r) => r.id === "sales-2")!;
    expect(Object.keys(validateParameters(r, {}))).toContain("company");
    expect(
      validateParameters(r, {
        company: "Northstar Packaging Ltd.",
        startDate: "2026-10-20",
        endDate: "2026-10-01",
        reportType: "Summary",
      }).endDate,
    ).toContain("on or after");
    expect(
      validateParameters(r, {
        company: "Northstar Packaging Ltd.",
        startDate: "2026-10-01",
        endDate: "2026-10-20",
        reportType: "Summary",
      }),
    ).toEqual({});
  });
  it("only advances demo results after explicit actions", () => {
    expect(executionTransition("idle", "complete")).toBe("idle");
    expect(executionTransition("idle", "run")).toBe("processing");
    expect(executionTransition("processing", "complete")).toBe("success");
    expect(executionTransition("success", "reset")).toBe("idle");
  });
});
