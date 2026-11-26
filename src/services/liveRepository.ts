import type { Activity, ActivityKind, CategorySummary, Report } from "../types";
import { apiRequest, ApiError, csrfToken } from "./api";
import { recentReports } from "./activity";
import { filterCatalog } from "./catalog";
import type { ReportRepository } from "./contracts";
import { repository as emptyRepository } from "./emptyRepository";

type Entry = { id: string; name: string; category: string; updatedAt: string };
type Workspace = {
  reports: Entry[];
  favorites: string[];
  activity: { reportId: string; interactionId: string; kind: ActivityKind; at: string }[];
};

export async function workspaceRequest<T>(route: string, options: RequestInit = {}): Promise<T> {
  const timer = AbortSignal.timeout(15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timer]) : timer;
  const response = await apiRequest(route, { ...options, signal });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

export function createLiveRepository(): ReportRepository {
  let pending: Promise<Workspace> | undefined;
  function read() {
    if (!pending) {
      pending = workspaceRequest<Workspace>("workspace").finally(() => { pending = undefined; });
    }
    return pending;
  }
  async function snapshot() {
    const data = await read();
    const categories = new Map<string, CategorySummary>();
    const usage = new Map<string, number>();
    for (const event of data.activity) {
      if (event.kind === "run-completed") usage.set(event.reportId, (usage.get(event.reportId) ?? 0) + 1);
    }
    const reports = data.reports.map((entry): Report => {
      const category = categories.get(entry.category) ?? {
        id: entry.category, name: entry.category, description: "", department: "", color: "slate", reportCount: 0,
      };
      category.reportCount++;
      categories.set(entry.category, category);
      return {
        id: entry.id, name: entry.name, categoryId: entry.category, code: "", description: "",
        department: "", reportType: "Crystal", outputFormats: ["PDF"], owner: "",
        typicalExecutionTimeSeconds: 0, updatedAt: entry.updatedAt, createdAt: entry.updatedAt,
        keywords: [], parameters: [], lastUsedAt: "", usageCount: usage.get(entry.id) ?? 0,
      };
    });
    const activity = data.activity.map((event): Activity => ({
      ...event, id: `${event.reportId}/${event.interactionId}/${event.kind}`, source: "server",
    }));
    return { ...data, reports, activity, categories: [...categories.values()] };
  }
  return {
    ...emptyRepository,
    async getReports(query, ids) {
      const data = await snapshot();
      return filterCatalog(
        ids ? data.reports.filter(report => ids.includes(report.id)) : data.reports,
        query, Object.fromEntries(data.categories.map(category => [category.id, category.name])),
        new Date().toISOString(),
      );
    },
    async getReport(id) {
      return (await snapshot()).reports.find(report => report.id === id);
    },
    async getMetadata() {
      const data = await snapshot();
      return {
        total: data.reports.length, categories: data.categories, departments: [],
        reportTypes: data.reports.length ? ["Crystal"] : [], user: null, notifications: [],
      };
    },
    async getCategories() {
      return (await snapshot()).categories;
    },
    async getDashboard() {
      const data = await snapshot();
      const recent = recentReports(data.activity, data.reports, data.categories);
      return {
        total: data.reports.length, categoryCount: data.categories.length,
        favoriteCount: data.favorites.length, recent,
        frequent: data.reports.filter(report => report.usageCount > 0)
          .sort((left, right) => right.usageCount - left.usageCount).slice(0, 5),
        lastAccess: Object.fromEntries(recent.map(item => [item.report.id, item.accessedAt])),
      };
    },
    async getRecentReports() {
      const data = await snapshot();
      return recentReports(data.activity, data.reports, data.categories);
    },
    async getActivity() {
      const data = await snapshot();
      const reports = new Map(data.reports.map(report => [report.id, report]));
      return data.activity.map(event => ({
        ...event, report: reports.get(event.reportId), categoryName: reports.get(event.reportId)?.categoryId,
      }));
    },
    async getFavorites() {
      return (await read()).favorites;
    },
    async toggleFavorite(id) {
      const favorite = !(await read()).favorites.includes(id);
      const signal = AbortSignal.timeout(15000);
      const token = await csrfToken(signal);
      const result = await workspaceRequest<{ favorite: boolean }>(`workspace/favorites/${id}`, {
        method: "PUT", signal,
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({ favorite }),
      });
      return result.favorite;
    },
  };
}
