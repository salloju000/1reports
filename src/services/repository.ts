import type { CatalogQuery, Report } from "../types";
import type { ReportRepository } from "./contracts";
import { reports, MOCK_REFERENCE_DATE } from "../data/mock/reports";
import { categories } from "../data/mock/categories";
import { seededActivity } from "../data/mock/activity";
import { user } from "../data/mock/users";
import { notifications } from "../data/mock/notifications";
import { previewFor } from "../data/mock/previews";
import { filterCatalog, defaultQuery } from "./catalog";
import { executionTransition } from "./execution";
import { localStore } from "./storage";
import { recentReports } from "./activity";
export { defaultQuery } from "./catalog";
export { executionTransition, validateParameters } from "./execution";
export { LocalStore, localStore } from "./storage";
export type { ReportRepository } from "./contracts";
const categoryNames = Object.fromEntries(categories.map((c) => [c.id, c.name]));
export function queryReports(source: Report[], query: CatalogQuery) {
  return filterCatalog(source, query, categoryNames, MOCK_REFERENCE_DATE);
}
const events = () =>
  [...localStore.data.activity, ...seededActivity].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
const categorySummaries = () =>
  categories.map((c) => ({
    ...c,
    reportCount: reports.filter((r) => r.categoryId === c.id).length,
  }));
const interactions = new Set<string>();
export const repository: ReportRepository = {
  async getReports(query, ids) {
    return queryReports(
      ids ? reports.filter((r) => ids.includes(r.id)) : reports,
      query,
    );
  },
  async getReport(id) {
    return reports.find((r) => r.id === id);
  },
  async getMetadata() {
    return {
      total: reports.length,
      categories: categorySummaries(),
      departments: [...new Set(reports.map((r) => r.department))],
      reportTypes: [...new Set(reports.map((r) => r.reportType))],
      user,
      notifications,
    };
  },
  async getCategories() {
    return categorySummaries();
  },
  async getRecentReports() {
    return recentReports(events(), reports, categories);
  },
  async getDashboard() {
    const recent = await this.getRecentReports();
    return {
      total: reports.length,
      categoryCount: categories.length,
      favoriteCount: localStore.data.favorites.length,
      frequent: queryReports(reports, {
        ...defaultQuery,
        sort: "usage",
        usage: "frequent",
      }).items.slice(0, 5),
      recent,
      lastAccess: Object.fromEntries(
        reports.map((r) => [
          r.id,
          recent.find((a) => a.report.id === r.id)?.accessedAt ?? r.lastUsedAt,
        ]),
      ),
    };
  },
  async getActivity() {
    return events().map((a) => ({
      ...a,
      report: reports.find((r) => r.id === a.reportId),
      categoryName:
        categoryNames[
          reports.find((r) => r.id === a.reportId)?.categoryId ?? ""
        ],
    }));
  },
  async getFavorites() {
    return [...localStore.data.favorites];
  },
  async toggleFavorite(id) {
    return localStore.toggle(id);
  },
  async recordActivity(id, kind, interactionId) {
    if (interactionId) {
      if (interactions.has(interactionId)) return;
      interactions.add(interactionId);
      if (interactions.size > 1000)
        interactions.delete(interactions.values().next().value!);
    }
    localStore.record(id, kind);
  },
  async executeDemo(id, action, state) {
    const next = executionTransition(state, action);
    if (next !== state && action !== "reset")
      localStore.record(
        id,
        action === "run" ? "demo-started" : "demo-completed",
      );
    return next;
  },
  async getPreview(id) {
    const report = reports.find((r) => r.id === id);
    if (!report) throw new Error("Report not found");
    return previewFor(report.categoryId);
  },
};
