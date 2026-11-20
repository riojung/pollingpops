import { ApiClientError } from "../../lib/api";

export function workspaceSettingsPath(path: string, workspaceId: string) {
  return `${path}?expectedWorkspaceId=${encodeURIComponent(workspaceId)}`;
}

export function isWorkspaceSettingsConflict(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && error.status === 409 && error.code === "CONFLICT";
}
