export interface HistoryQueryFilters {
  status: string;
  quizId?: string;
  presentationId?: string;
  surveyId?: string;
  fromDate: string;
  toDate: string;
  search?: string;
  expectedWorkspaceId?: string;
}

function applyHistoryFilters(params: URLSearchParams, filters: HistoryQueryFilters) {
  if (filters.expectedWorkspaceId) params.set("expectedWorkspaceId", filters.expectedWorkspaceId);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.quizId && filters.quizId !== "all") params.set("quizId", filters.quizId);
  if (filters.presentationId && filters.presentationId !== "all") {
    params.set("presentationId", filters.presentationId);
  }
  if (filters.surveyId && filters.surveyId !== "all") params.set("surveyId", filters.surveyId);
  if (filters.fromDate) {
    params.set("from", new Date(`${filters.fromDate}T00:00:00`).toISOString());
  }
  if (filters.toDate) {
    params.set("to", new Date(`${filters.toDate}T23:59:59.999`).toISOString());
  }
  return params;
}

export function buildHistoryFilterQuery(filters: HistoryQueryFilters) {
  return applyHistoryFilters(new URLSearchParams(), filters).toString();
}

export function buildHistoryQuery(filters: HistoryQueryFilters, cursor?: string) {
  const params = applyHistoryFilters(new URLSearchParams({ limit: "25" }), filters);
  if (cursor) params.set("cursor", cursor);
  return params;
}
