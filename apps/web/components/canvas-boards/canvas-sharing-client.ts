import {
  CanvasBoardInvitationBatchSchema,
  IdeaBoardInvitationBatchSchema,
  BoardInvitationBatchResponseSchema,
  CanvasBoardSharingSchema,
  CanvasBoardShareGroupsSchema,
  type CanvasBoardInvitationBatch,
  type IdeaBoardInvitationBatch,
  type BoardInvitationBatchResponse,
  type CanvasBoardShareGroups,
} from "@openround/contracts";
import { apiFetch } from "../../lib/api";
import { canvasPath } from "./canvas-client";
import { ideaBoardPath } from "../../lib/idea-board-client";

export type BoardInvitationIntent = CanvasBoardInvitationBatch | IdeaBoardInvitationBatch;
export type BoardInvitationTarget = { kind: "collaborators" | "guests"; id: string };

export function parseBoardInvitationEmails(raw: string): {
  emails: string[];
  error: "empty" | "invalid" | "limit" | null;
} {
  const emails = [
    ...new Set(
      raw
        .split(/[,;\n\r]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!emails.length) return { emails, error: "empty" };
  if (emails.length > 20) return { emails, error: "limit" };
  const checked = IdeaBoardInvitationBatchSchema.safeParse({
    operationId: "00000000-0000-4000-8000-000000000001",
    emails,
  });
  return { emails, error: checked.success ? null : "invalid" };
}

export async function readCanvasSharing(id: string, signal?: AbortSignal) {
  return CanvasBoardSharingSchema.parse(
    await apiFetch(`${canvasPath(id)}/sharing`, { signal, cache: "no-store" }),
  );
}
export async function shareCanvasGroups(
  id: string,
  intent: CanvasBoardShareGroups,
  signal?: AbortSignal,
) {
  return CanvasBoardSharingSchema.parse(
    await apiFetch(`${canvasPath(id)}/group-grants`, {
      method: "POST",
      signal,
      body: JSON.stringify(CanvasBoardShareGroupsSchema.parse(intent)),
    }),
  );
}
export async function revokeCanvasGroup(
  id: string,
  groupId: string,
  operationId: string,
  signal?: AbortSignal,
) {
  canvasPath(groupId);
  canvasPath(operationId);
  return CanvasBoardSharingSchema.parse(
    await apiFetch(`${canvasPath(id)}/group-grants/${groupId}`, {
      method: "DELETE",
      signal,
      body: JSON.stringify({ operationId }),
    }),
  );
}

/** A replay carries the identical intent. The server sends only still-pending recipients. */
export async function sendBoardInvitations(
  target: BoardInvitationTarget,
  intent: BoardInvitationIntent,
  signal?: AbortSignal,
) {
  const input =
    target.kind === "guests"
      ? IdeaBoardInvitationBatchSchema.parse(intent)
      : CanvasBoardInvitationBatchSchema.parse(intent);
  const path =
    target.kind === "guests"
      ? `${ideaBoardPath(target.id)}/invitations`
      : `${canvasPath(target.id)}/invitations/batch`;
  const result = BoardInvitationBatchResponseSchema.parse(
    await apiFetch(path, {
      method: "POST",
      signal,
      body: JSON.stringify(input),
    }),
  );
  return validateBoardInvitationResult(input.emails, result);
}

export function validateBoardInvitationResult(
  emails: readonly string[],
  result: BoardInvitationBatchResponse,
) {
  const received = new Set(result.results.map((row) => row.email));
  if (
    received.size !== emails.length ||
    result.results.length !== emails.length ||
    emails.some((email) => !received.has(email)) ||
    result.complete !== !result.results.some((row) => row.status === "pending")
  )
    throw new Error("Invalid invitation acknowledgement");
  return result;
}
