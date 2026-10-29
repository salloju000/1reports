export type ParameterValue = string | string[];
export type ReportParameter = {
  id: string;
  label: string;
  kind: "date" | "text" | "select" | "multi-select";
  required?: boolean;
  options?: string[];
};
export type Report = {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  department: string;
  reportType: string;
  outputFormats: string[];
  owner: string;
  typicalExecutionTimeSeconds: number;
  updatedAt: string;
  createdAt: string;
  keywords: string[];
  parameters: ReportParameter[];
  lastUsedAt: string;
  usageCount: number;
};
export type Category = {
  id: string;
  name: string;
  description: string;
  department: string;
  color: string;
};
export type CategorySummary = Category & { reportCount: number };
export type ActivityKind =
  | "viewed"
  | "favorite-added"
  | "favorite-removed"
  | "demo-started"
  | "demo-completed";
export type Activity = {
  id: string;
  reportId: string;
  kind: ActivityKind;
  at: string;
  source: "seed" | "local";
};
export type ActivityRecord = Activity & {
  report?: Report;
  categoryName?: string;
};
export type RecentReport = {
  report: Report;
  accessedAt: string;
  source: Activity["source"];
  status: "viewed" | "demo-started" | "demo-completed";
  categoryName: string;
};
export type ReportSort = "name" | "usage" | "time" | "added";
export type QuickFilter = "" | "frequent" | "new";
export type CatalogQuery = {
  search: string;
  category: string;
  department: string;
  type: string;
  usage: QuickFilter;
  sort: ReportSort;
  page: number;
};
export type PageResult<T> = {
  items: T[];
  total: number;
  pages: number;
  page: number;
};
export type Preferences = {
  view: "list" | "grid";
  density: "comfortable" | "compact";
};
export type ExecutionState = "idle" | "processing" | "success";
export type DemoPreview = {
  company: string;
  columns: string[];
  rows: string[][];
};
export type MockUser = {
  name: string;
  role: string;
  initials: string;
  company: string;
  email: string;
};
export type Notification = { id: string; title: string; description: string };
export type CatalogMetadata = {
  total: number;
  categories: CategorySummary[];
  departments: string[];
  reportTypes: string[];
  user: MockUser;
  notifications: Notification[];
};
export type DashboardSummary = {
  total: number;
  categoryCount: number;
  favoriteCount: number;
  frequent: Report[];
  recent: RecentReport[];
  lastAccess: Record<string, string>;
};
