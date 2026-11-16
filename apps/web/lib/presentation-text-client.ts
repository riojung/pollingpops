import {
  PresentationTextModerationAckSchema,
  PresentationTextModerationPageSchema,
  PresentationTextResponseResultsSchema,
  type PresentationTextModerationAck,
  type PresentationTextModerationRequest,
  type PresentationTextResultsQuery,
} from "@openround/contracts";
import { apiFetch } from "./api";

export interface PresentationTextReadFence {
  sessionId: string;
  revision: number;
  seq: number;
}

function assertReadFence(value: PresentationTextReadFence, expected: PresentationTextReadFence) {
  if (
    value.sessionId !== expected.sessionId ||
    value.revision < expected.revision ||
    value.seq < expected.seq
  )
    throw new Error("Responses changed. Refresh the list before continuing.");
}

export async function readPresentationTextModeration(
  input: PresentationTextReadFence & {
    credential: string;
    blockId?: string | null;
    status: "pending" | "approved" | "removed";
    cursor?: string | null;
    signal?: AbortSignal;
  },
) {
  if (!input.credential) throw new Error("Reconnect to refresh responses.");
  const query = new URLSearchParams({ status: input.status, limit: "10" });
  if (input.blockId) query.set("blockId", input.blockId);
  if (input.cursor) query.set("cursor", input.cursor);
  const page = PresentationTextModerationPageSchema.parse(
    await apiFetch(`/v1/presentation-sessions/${input.sessionId}/response-moderation?${query}`, {
      headers: { authorization: `Bearer ${input.credential}` },
      credentials: "omit",
      cache: "no-store",
      signal: input.signal,
    }),
  );
  assertReadFence(page, input);
  if (
    page.items.some(
      (item) => item.status !== input.status || (input.blockId && item.blockId !== input.blockId),
    )
  )
    throw new Error("The response list does not match the requested question and filter.");
  return page;
}

export async function readPresentationTextResults(
  input: PresentationTextReadFence & {
    blockId: string;
    type: "open_text" | "word_cloud";
    projection: PresentationTextResultsQuery["role"];
    credential?: string;
    cursor?: string | null;
    signal?: AbortSignal;
  },
) {
  const query = new URLSearchParams({
    blockId: input.blockId,
    role: input.projection,
    limit: "50",
  });
  if (input.cursor) query.set("cursor", input.cursor);
  const creator = input.projection === "creator";
  if (!creator && !input.credential) throw new Error("Reconnect to refresh responses.");
  const result = PresentationTextResponseResultsSchema.parse(
    await apiFetch(`/v1/presentation-sessions/${input.sessionId}/response-results?${query}`, {
      ...(!creator ? { headers: { authorization: `Bearer ${input.credential ?? ""}` } } : {}),
      credentials: creator ? "include" : "omit",
      cache: "no-store",
      signal: input.signal,
    }),
  );
  assertReadFence(result, input);
  if (result.blockId !== input.blockId || result.type !== input.type)
    throw new Error("The results do not match the current question.");
  return result;
}

export interface PresentationTextModerationIntent {
  sessionId: string;
  credential: string;
  responseId: string;
  blockId: string;
  request: PresentationTextModerationRequest;
}

/** A retry keeps the original intent, including both versions and its command identifier. */
export function retainPresentationTextModerationIntent(
  input: PresentationTextModerationIntent,
): PresentationTextModerationIntent {
  return Object.freeze({ ...input, request: Object.freeze({ ...input.request }) });
}

export function validatePresentationTextModerationAck(
  input: PresentationTextModerationIntent,
  value: unknown,
): PresentationTextModerationAck {
  const ack = PresentationTextModerationAckSchema.parse(value);
  const receipt = ack.receipt;
  if (
    !ack.accepted ||
    ack.sessionId !== input.sessionId ||
    receipt.commandId !== input.request.commandId ||
    receipt.responseId !== input.responseId ||
    receipt.blockId !== input.blockId ||
    receipt.status !== input.request.status ||
    receipt.expectedRevision !== input.request.expectedRevision ||
    receipt.expectedModerationVersion !== input.request.expectedModerationVersion ||
    ack.response.responseId !== input.responseId ||
    ack.response.blockId !== receipt.blockId ||
    ack.response.moderationVersion < receipt.resultingModerationVersion ||
    ack.revision < receipt.expectedRevision
  )
    throw new Error("The server did not confirm this response review. Retry its acknowledgement.");
  return ack;
}

export async function sendPresentationTextModeration(input: PresentationTextModerationIntent) {
  if (!input.credential) throw new Error("Reconnect before reviewing a response.");
  return validatePresentationTextModerationAck(
    input,
    await apiFetch(
      `/v1/presentation-sessions/${input.sessionId}/response-moderation/${input.responseId}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${input.credential}` },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify(input.request),
      },
    ),
  );
}
