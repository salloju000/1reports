import type { ReportRepository } from "./contracts";

function unavailable(): never {
  throw new Error("The report backend is not connected.");
}

export const repository: ReportRepository = {
  async getReports() {
    return { items: [], total: 0, pages: 1, page: 1 };
  },
  async getReport() {
    return undefined;
  },
  async getMetadata() {
    return {
      total: 0,
      categories: [],
      departments: [],
      reportTypes: [],
      user: null,
      notifications: [],
    };
  },
  async getCategories() {
    return [];
  },
  async getDashboard() {
    return {
      total: 0,
      categoryCount: 0,
      favoriteCount: 0,
      frequent: [],
      recent: [],
      lastAccess: {},
    };
  },
  async getRecentReports() {
    return [];
  },
  async getActivity() {
    return [];
  },
  async getFavorites() {
    return [];
  },
  async toggleFavorite() {
    unavailable();
  },
  async recordActivity() {
    unavailable();
  },
};
