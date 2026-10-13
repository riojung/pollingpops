export type SessionType = "rounds" | "presentations" | "surveys";
export type SessionStatus = "active" | "finished" | "expired";
export type SessionView = "grid" | "list";

export interface SessionFilters {
  type: SessionType;
  query: string;
  status: "all" | SessionStatus;
  sourceId: string;
  from: string;
  to: string;
}

export interface PresentationSessionSummary {
  id: string;
  presentationId: string;
  title: string;
  code: string;
  status: "active" | "finished";
  phase: string;
  currentBlockIndex: number;
  blockCount: number;
  participantCount: number;
  responseCount: number;
  createdAt: string;
  liveExpiresAt?: string;
}

export interface SurveySessionSummary {
  id: string;
  surveyId: string;
  title: string;
  code: string;
  closed: boolean;
  closesAt: string;
  expiresAt: string;
}

function dateFromQuery(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.getFullYear() === Number(value.slice(0, 4)) &&
    parsed.getMonth() + 1 === Number(value.slice(5, 7)) &&
    parsed.getDate() === Number(value.slice(8, 10))
    ? value
    : "";
}

export function sessionFiltersFromQuery(
  params: Pick<URLSearchParams, "get">,
  presentationsEnabled: boolean,
): SessionFilters {
  const requestedType = params.get("type");
  const status = params.get("status");
  const type =
    requestedType === "surveys"
      ? "surveys"
      : requestedType === "presentations" && presentationsEnabled
        ? "presentations"
        : "rounds";
  const fallback = requestedType === "presentations" && !presentationsEnabled;
  return {
    type,
    query: (params.get("q") ?? "").slice(0, 160),
    status: status === "active" || status === "finished" || status === "expired" ? status : "all",
    sourceId: fallback ? "all" : (params.get("source") ?? params.get("quizId") ?? "all"),
    from: fallback ? "" : dateFromQuery(params.get("from")),
    to: fallback ? "" : dateFromQuery(params.get("to")),
  };
}

export function sessionsHref(filters: SessionFilters): string {
  const params = new URLSearchParams({ type: filters.type });
  if (filters.query) params.set("q", filters.query);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.sourceId !== "all") params.set("source", filters.sourceId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return `/sessions?${params}`;
}

export function sessionFiltersForType(filters: SessionFilters, type: SessionType): SessionFilters {
  return { ...filters, type, sourceId: "all", from: "", to: "" };
}

export function roundSessionsPath(filters: SessionFilters, cursor?: string): string {
  const params = new URLSearchParams({ limit: "25" });
  if (filters.query.trim()) params.set("search", filters.query.trim());
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.sourceId !== "all") params.set("quizId", filters.sourceId);
  if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
  if (cursor) params.set("cursor", cursor);
  return `/v1/sessions?${params}`;
}

export function presentationSessionStatus(
  session: PresentationSessionSummary,
  now = Date.now(),
): SessionStatus {
  return session.liveExpiresAt && new Date(session.liveExpiresAt).getTime() <= now
    ? "expired"
    : session.status;
}

export function surveySessionStatus(
  session: SurveySessionSummary,
  now = Date.now(),
): SessionStatus {
  if (new Date(session.expiresAt).getTime() <= now) return "expired";
  return session.closed || new Date(session.closesAt).getTime() <= now ? "finished" : "active";
}

export function filterSessionRows<T extends { title: string; code: string }>(
  rows: T[],
  filters: SessionFilters,
  metadata: (row: T) => { sourceId: string; status: SessionStatus; date: string },
): T[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : -Infinity;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Infinity;
  return rows.filter((row) => {
    const data = metadata(row);
    const date = new Date(data.date).getTime();
    return (
      (!query || row.title.toLocaleLowerCase().includes(query) || row.code.includes(query)) &&
      (filters.status === "all" || filters.status === data.status) &&
      (filters.sourceId === "all" || filters.sourceId === data.sourceId) &&
      date >= from &&
      date <= to
    );
  });
}

export function sessionActions(
  type: SessionType,
  status: SessionStatus,
  role: "owner" | "editor" | "viewer",
) {
  return {
    canResume: type !== "surveys" && status === "active" && role !== "viewer",
    canManageSharing: type === "surveys" && status === "active" && role !== "viewer",
    canViewSurveyResults: type === "surveys" && status !== "expired",
    canDelete: status !== "active" && role === "owner",
  };
}

export function sessionsViewStorageKey(workspaceId: string) {
  return `openround:sessions-view:v1:${workspaceId}`;
}

export function readSessionsView(
  storage: Pick<Storage, "getItem">,
  workspaceId: string,
): SessionView {
  try {
    const value = storage.getItem(sessionsViewStorageKey(workspaceId));
    return value === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function writeSessionsView(
  storage: Pick<Storage, "setItem">,
  workspaceId: string,
  view: SessionView,
) {
  try {
    storage.setItem(sessionsViewStorageKey(workspaceId), view);
  } catch {
    // Browser storage availability must not prevent a layout change.
  }
}
