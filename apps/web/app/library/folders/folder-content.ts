import { apiFetch } from "../../../lib/api";
import type { LibraryType } from "../../../lib/folders";

export interface ContentRecord {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  folderId: string | null;
  workspaceId?: string;
  tags?: string[];
  revision?: number;
}

interface SurveyRecord extends Omit<ContentRecord, "title"> {
  draft: { title: string };
  revision: number;
}

export class FolderPaginationError extends Error {}

export async function loadFolderContent(
  type: LibraryType,
  signal: AbortSignal,
): Promise<ContentRecord[]> {
  if (type === "rounds") {
    const response = await apiFetch<{ quizzes: ContentRecord[] }>("/v1/quizzes?archived=true", {
      signal,
    });
    return response.quizzes;
  }
  if (type === "presentations") {
    const response = await apiFetch<{ presentations: ContentRecord[] }>(
      "/v1/presentations?archived=true",
      { signal },
    );
    return response.presentations;
  }
  const rows: ContentRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: { surveys: SurveyRecord[]; nextCursor: string | null } = await apiFetch(
      `/v1/surveys?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal },
    );
    rows.push(...page.surveys.map((survey) => ({ ...survey, title: survey.draft.title })));
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new FolderPaginationError();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return rows;
}
