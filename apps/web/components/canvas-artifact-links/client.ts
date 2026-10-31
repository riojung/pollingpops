import {
  CanvasArtifactLinkCreateSchema,
  CanvasArtifactLinkDeleteSchema,
  CanvasArtifactLinkEligibleSchema,
  CanvasArtifactLinkListSchema,
  CanvasArtifactLinkMutationResponseSchema,
  CanvasVersionViewSchema,
  type CanvasArtifactLink,
  type CanvasArtifactLinkCreate,
  type CanvasArtifactLinkDelete,
} from "@openround/contracts";
import { apiFetch } from "../../lib/api";
import { canvasPath } from "../canvas-boards/canvas-client";
export interface CanvasArtifactTarget {
  kind: "round" | "presentation";
  targetId: string;
}
export type CanvasArtifactPending =
  | { type: "create"; input: CanvasArtifactLinkCreate }
  | { type: "delete"; linkId: string; input: CanvasArtifactLinkDelete };
export function canvasArtifactPath(target: CanvasArtifactTarget, linkId?: string) {
  if (!["round", "presentation"].includes(target.kind)) throw new Error("Invalid activity kind");
  canvasPath(target.targetId);
  if (linkId !== undefined) canvasPath(linkId);
  return `/v1/${target.kind === "round" ? "quizzes" : "presentations"}/${target.targetId}/canvas-snapshot-links${linkId ? `/${linkId}` : ""}`;
}
async function request(
  target: CanvasArtifactTarget,
  suffix: string,
  signal: AbortSignal | undefined,
  init: RequestInit = {},
) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Canvas link request timed out", "TimeoutError")),
    8000,
  );
  try {
    return await apiFetch<unknown>(`${canvasArtifactPath(target)}${suffix}`, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export async function listCanvasArtifactLinks(target: CanvasArtifactTarget, signal?: AbortSignal) {
  return CanvasArtifactLinkListSchema.parse(await request(target, "", signal));
}
export async function eligibleCanvasArtifactLinks(
  target: CanvasArtifactTarget,
  signal?: AbortSignal,
) {
  return CanvasArtifactLinkEligibleSchema.parse(await request(target, "/eligible", signal));
}
export function createCanvasArtifactIntent(
  boardId: string,
  versionId: string,
  operationId: string,
  linkId: string,
): CanvasArtifactPending {
  return {
    type: "create",
    input: CanvasArtifactLinkCreateSchema.parse({
      schemaVersion: 1,
      operationId,
      linkId,
      boardId,
      versionId,
    }),
  };
}
export function deleteCanvasArtifactIntent(
  link: Pick<CanvasArtifactLink, "id" | "revision">,
  operationId: string,
): CanvasArtifactPending {
  canvasPath(link.id);
  return {
    type: "delete",
    linkId: link.id,
    input: CanvasArtifactLinkDeleteSchema.parse({
      schemaVersion: 1,
      operationId,
      expectedRevision: link.revision,
    }),
  };
}
export async function writeCanvasArtifactLink(
  target: CanvasArtifactTarget,
  pending: CanvasArtifactPending,
  signal?: AbortSignal,
) {
  const input =
    pending.type === "create"
      ? CanvasArtifactLinkCreateSchema.parse(pending.input)
      : CanvasArtifactLinkDeleteSchema.parse(pending.input);
  const linkId =
    pending.type === "create" ? (input as CanvasArtifactLinkCreate).linkId : pending.linkId;
  canvasPath(linkId);
  const result = CanvasArtifactLinkMutationResponseSchema.parse(
    await request(target, pending.type === "create" ? "" : `/${linkId}`, signal, {
      method: pending.type === "create" ? "POST" : "DELETE",
      body: JSON.stringify(input),
    }),
  );
  if (
    result.receipt.operationId !== input.operationId ||
    result.receipt.deleted !== (pending.type === "delete") ||
    (pending.type === "delete" && result.receipt.linkId !== linkId)
  )
    throw new Error("Mismatched canvas link acknowledgement");
  // A create may deduplicate an already linked board/version and return that canonical link id.
  return result;
}
export async function readCanvasArtifactPreview(
  target: CanvasArtifactTarget,
  link: Pick<CanvasArtifactLink, "id" | "boardId" | "versionId">,
  signal?: AbortSignal,
) {
  canvasPath(link.id);
  const view = CanvasVersionViewSchema.parse(await request(target, `/${link.id}/preview`, signal));
  if (view.boardId !== link.boardId || view.version.id !== link.versionId)
    throw new Error("Mismatched canvas snapshot");
  return view;
}
