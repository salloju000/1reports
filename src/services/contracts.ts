import type {
  ActivityKind,
  ActivityRecord,
  CatalogMetadata,
  CatalogQuery,
  CategorySummary,
  DashboardSummary,
  PageResult,
  RecentReport,
  Report,
} from "../types";
import type { DemoExecutionService } from "./execution";

export type DemoReportRepository = ReportRepository & DemoExecutionService;

export interface ReportRepository {
  getReports(query: CatalogQuery, ids?: string[]): Promise<PageResult<Report>>;
  getReport(id: string): Promise<Report | undefined>;
  getMetadata(): Promise<CatalogMetadata>;
  getCategories(): Promise<CategorySummary[]>;
  getDashboard(): Promise<DashboardSummary>;
  getRecentReports(): Promise<RecentReport[]>;
  getActivity(): Promise<ActivityRecord[]>;
  getFavorites(): Promise<string[]>;
  toggleFavorite(id: string): Promise<boolean>;
  recordActivity(
    id: string,
    kind: ActivityKind,
    interactionId?: string,
  ): Promise<void>;
}
