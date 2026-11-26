import type { Activity, Category, RecentReport, Report } from "../types";

export function recentReports(
  events: Activity[],
  catalog: Report[],
  categories: Category[],
): RecentReport[] {
  const byId = new Map(catalog.map((r) => [r.id, r]));
  const latest = new Map<string, RecentReport>();
  for (const event of [...events].sort((a, b) => b.at.localeCompare(a.at))) {
    if (
      !["viewed", "demo-started", "demo-completed", "run-completed", "run-failed"].includes(event.kind) ||
      latest.has(event.reportId)
    )
      continue;
    const report = byId.get(event.reportId);
    if (report)
      latest.set(report.id, {
        report,
        accessedAt: event.at,
        source: event.source,
        status: event.kind as RecentReport["status"],
        categoryName:
          categories.find((c) => c.id === report.categoryId)?.name ??
          "Uncategorized",
      });
  }
  return [...latest.values()];
}
