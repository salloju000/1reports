import type {
  CatalogMetadata,
  CatalogQuery,
  PageResult,
  Report,
} from "../types";

export const defaultQuery: CatalogQuery = {
  search: "",
  category: "",
  department: "",
  type: "",
  usage: "",
  sort: "name",
  page: 1,
};
export function normalizeQuery(
  params: URLSearchParams,
  metadata?: CatalogMetadata,
): CatalogQuery {
  const numeric = Number(params.get("page"));
  const sort = params.get("sort");
  const usage = params.get("usage");
  const query: CatalogQuery = {
    search: params.get("search") ?? "",
    category: params.get("category") ?? "",
    department: params.get("department") ?? "",
    type: params.get("type") ?? "",
    sort:
      sort === "usage" || sort === "time" || sort === "added" ? sort : "name",
    usage: usage === "frequent" || usage === "new" ? usage : "",
    page: Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 1,
  };
  if (metadata) {
    if (!metadata.categories.some((c) => c.id === query.category))
      query.category = "";
    if (!metadata.departments.includes(query.department)) query.department = "";
    if (!metadata.reportTypes.includes(query.type)) query.type = "";
  }
  return query;
}
export function queryParams(query: CatalogQuery): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(
        ([key, value]) => value !== defaultQuery[key as keyof CatalogQuery],
      )
      .map(([key, value]) => [key, String(value)]),
  );
}
export function paginationWindow(
  page: number,
  pages: number,
): (number | "ellipsis")[] {
  const numbers = [
    ...new Set(
      [1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages),
    ),
  ].sort((a, b) => a - b);
  return numbers.flatMap((n, i) =>
    i && n - numbers[i - 1] > 1 ? (["ellipsis", n] as const) : [n],
  );
}
export function filterCatalog(
  source: Report[],
  query: CatalogQuery,
  categoryNames: Record<string, string>,
  referenceDate: string,
): PageResult<Report> {
  const q = normalizeQuery(
    new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])),
  );
  const search = q.search.trim().toLowerCase();
  const items = source.filter(
    (r) =>
      (!search ||
        [
          r.name,
          r.description,
          r.code,
          categoryNames[r.categoryId],
          ...r.keywords,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search)) &&
      (!q.category || r.categoryId === q.category) &&
      (!q.department || r.department === q.department) &&
      (!q.type || r.reportType === q.type) &&
      (!q.usage ||
        (q.usage === "frequent"
          ? r.usageCount >= 20
          : Date.parse(r.createdAt) >=
              Date.parse(referenceDate) - 30 * 86400000 &&
            Date.parse(r.createdAt) <= Date.parse(referenceDate))),
  );
  items.sort((a, b) =>
    q.sort === "usage"
      ? b.usageCount - a.usageCount || a.name.localeCompare(b.name)
      : q.sort === "time"
        ? a.typicalExecutionTimeSeconds - b.typicalExecutionTimeSeconds ||
          a.name.localeCompare(b.name)
        : q.sort === "added"
          ? b.createdAt.localeCompare(a.createdAt) ||
            a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
  );
  const pages = Math.max(1, Math.ceil(items.length / 20));
  const page = Math.min(q.page, pages);
  return {
    items: items.slice((page - 1) * 20, page * 20),
    total: items.length,
    pages,
    page,
  };
}
