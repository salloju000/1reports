import type {
  ActivityRecord,
  CatalogMetadata,
  Preferences,
  Report,
} from "../types";
import type { DemoReportRepository } from "../services/contracts";
import type { PreferencesPersistence } from "../services/preferences";
import { filterCatalog } from "../services/catalog";
import { executionTransition } from "../services/execution";
import { recentReports } from "../services/activity";

export const alternativeReport: Report = {
  id: "other-1",
  code: "ALT-001",
  name: "Alternative Capacity Report",
  description: "Independent repository data for adapter verification.",
  categoryId: "capacity",
  department: "Planning",
  reportType: "Capacity",
  outputFormats: ["PDF", "Excel"],
  owner: "Test Owner",
  typicalExecutionTimeSeconds: 9,
  updatedAt: "2026-10-29",
  createdAt: "2026-10-20",
  keywords: ["scheduling"],
  lastUsedAt: "2026-10-28",
  usageCount: 50,
  parameters: [
    {
      id: "company",
      label: "Company",
      kind: "select",
      required: true,
      options: ["Alternative Company"],
    },
    { id: "asOf", label: "As of date", kind: "date", required: true },
  ],
};
export function alternativeRepository() {
  let favorites: string[] = [];
  const activity: ActivityRecord[] = [];
  const metadata: CatalogMetadata = {
    total: 1,
    categories: [
      {
        id: "capacity",
        name: "Capacity Planning",
        department: "Planning",
        description: "Alternative category configuration.",
        color: "blue",
        reportCount: 1,
      },
    ],
    departments: ["Planning"],
    reportTypes: ["Capacity"],
    user: {
      name: "Taylor Example",
      initials: "TE",
      role: "Planner",
      company: "Alternative Company",
      email: "taylor@example.com",
    },
    notifications: [],
  };
  const repository: DemoReportRepository = {
    async getMetadata() {
      return metadata;
    },
    async getCategories() {
      return metadata.categories;
    },
    async getReports(query, ids) {
      return filterCatalog(
        ids && !ids.includes(alternativeReport.id) ? [] : [alternativeReport],
        query,
        { capacity: "Capacity Planning" },
        "2026-10-29",
      );
    },
    async getReport(id) {
      return id === alternativeReport.id ? alternativeReport : undefined;
    },
    async getFavorites() {
      return [...favorites];
    },
    async toggleFavorite(id) {
      const exists = favorites.includes(id);
      favorites = exists
        ? favorites.filter((x) => x !== id)
        : [...favorites, id];
      return !exists;
    },
    async getActivity() {
      return [...activity];
    },
    async recordActivity(id, kind) {
      activity.unshift({
        id: crypto.randomUUID(),
        reportId: id,
        kind,
        at: new Date().toISOString(),
        source: "local",
        report: alternativeReport,
        categoryName: "Capacity Planning",
      });
    },
    async getRecentReports() {
      return recentReports(activity, [alternativeReport], metadata.categories);
    },
    async getDashboard() {
      const recent = await this.getRecentReports();
      return {
        total: 1,
        categoryCount: 1,
        favoriteCount: favorites.length,
        frequent: [alternativeReport],
        recent,
        lastAccess: {
          "other-1": recent[0]?.accessedAt ?? alternativeReport.lastUsedAt,
        },
      };
    },
    async getPreview() {
      return {
        company: "Alternative Company",
        columns: ["Sample work centre", "Capacity hours"],
        rows: [["DEMO · Press 1", "120"]],
      };
    },
    async executeDemo(_id, action, state) {
      return executionTransition(state, action);
    },
  };
  let preference: Preferences = { view: "list", density: "comfortable" };
  const persistence: PreferencesPersistence = {
    get: () => preference,
    set: (value) => {
      preference = value;
    },
    getWarning: () => "",
  };
  return { repository, persistence, metadata, activity };
}
