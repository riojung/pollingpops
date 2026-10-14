export interface HistoryQueryFilters {
  status: string;
  quizId: string;
  fromDate: string;
  toDate: string;
  search?: string;
}

export function buildHistoryQuery(filters: HistoryQueryFilters, cursor?: string) {
  const params = new URLSearchParams({ limit: "25" });
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.quizId !== "all") params.set("quizId", filters.quizId);
  if (filters.fromDate) {
    params.set("from", new Date(`${filters.fromDate}T00:00:00`).toISOString());
  }
  if (filters.toDate) {
    params.set("to", new Date(`${filters.toDate}T23:59:59.999`).toISOString());
  }
  if (cursor) params.set("cursor", cursor);
  return params;
}
