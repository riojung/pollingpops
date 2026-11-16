import {
  EnablePresentationReviewSchema,
  PresentationReviewFeedbackAccessSchema,
  PresentationReviewFeedbackMutationResponseSchema,
  PresentationReviewFeedbackMutationSchema,
  PresentationReviewFeedbackSchema,
  type EnablePresentationReview,
  type PresentationReviewFeedbackMutation,
} from "@openround/contracts";
import { apiFetch } from "./api";

const uuid = EnablePresentationReviewSchema.shape.versionId;
function identifier(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new Error("The presentation review link could not be verified.");
  return parsed.data.toLowerCase();
}
function tokenHeaders(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("The presentation review credential could not be verified.");
  return { accept: "application/json", authorization: `Bearer ${token}` };
}
function authorPath(presentationId: string, shareId: string) {
  return `/v1/presentations/${identifier(presentationId)}/shares/${identifier(shareId)}/feedback`;
}
function reviewerPath(shareId: string) {
  return `/v1/shared-presentations/${identifier(shareId)}/feedback`;
}
async function request(path: string, init: RequestInit, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const value = await apiFetch<unknown>(path, {
    ...init,
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });
  signal?.throwIfAborted();
  return value;
}
const invalidResponse = () =>
  new Error("The review response could not be verified. Refresh before trying again.");
const sameId = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();
const sameNullableId = (first: string | null, second: string | null) =>
  first === null ? second === null : second !== null && sameId(first, second);
function feedback(value: unknown, shareId: string) {
  const parsed = PresentationReviewFeedbackSchema.safeParse(value);
  if (!parsed.success || !sameId(parsed.data.shareId, shareId)) throw invalidResponse();
  return parsed.data;
}
function mutationResponse(
  value: unknown,
  shareId: string,
  input: EnablePresentationReview | PresentationReviewFeedbackMutation,
) {
  const parsed = PresentationReviewFeedbackMutationResponseSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  const result = parsed.data;
  const command = "command" in input ? input.command : null;
  if (
    !sameId(result.feedback.shareId, shareId) ||
    !sameId(result.feedback.versionId, input.versionId) ||
    !sameId(result.receipt.operationId, input.operationId) ||
    result.receipt.type !== (command?.type ?? "review.enable") ||
    !sameNullableId(
      result.receipt.threadId,
      command && "threadId" in command ? command.threadId : null,
    ) ||
    !sameNullableId(
      result.receipt.messageId,
      command && "messageId" in command ? command.messageId : null,
    ) ||
    ("viewerKey" in input && result.feedback.viewerKey !== input.viewerKey)
  )
    throw invalidResponse();
  return result;
}

export async function fetchPresentationAuthorFeedback(
  presentationId: string,
  shareId: string,
  signal?: AbortSignal,
) {
  const path = authorPath(presentationId, shareId);
  return feedback(
    await request(
      path,
      { method: "GET", credentials: "include", headers: { accept: "application/json" } },
      signal,
    ),
    shareId,
  );
}
export async function enablePresentationReview(
  presentationId: string,
  shareId: string,
  requestValue: EnablePresentationReview,
  signal?: AbortSignal,
) {
  const path = authorPath(presentationId, shareId);
  const input = EnablePresentationReviewSchema.parse(requestValue);
  return mutationResponse(
    await request(
      path,
      {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
        body: JSON.stringify(input),
      },
      signal,
    ),
    shareId,
    input,
  );
}
export async function mutatePresentationAuthorFeedback(
  presentationId: string,
  shareId: string,
  mutation: PresentationReviewFeedbackMutation,
  signal?: AbortSignal,
) {
  const path = `${authorPath(presentationId, shareId)}/commands`;
  const input = PresentationReviewFeedbackMutationSchema.parse(mutation);
  return mutationResponse(
    await request(
      path,
      {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
        body: JSON.stringify(input),
      },
      signal,
    ),
    shareId,
    input,
  );
}
export async function fetchPresentationReviewerAccess(
  shareId: string,
  token: string,
  signal?: AbortSignal,
) {
  const path = `${reviewerPath(shareId)}/access`;
  const headers = tokenHeaders(token);
  const parsed = PresentationReviewFeedbackAccessSchema.safeParse(
    await request(path, { method: "GET", credentials: "omit", headers }, signal),
  );
  if (!parsed.success || !sameId(parsed.data.shareId, shareId)) throw invalidResponse();
  return parsed.data;
}
export async function fetchPresentationReviewerFeedback(
  shareId: string,
  token: string,
  signal?: AbortSignal,
) {
  const path = reviewerPath(shareId);
  const headers = tokenHeaders(token);
  return feedback(
    await request(path, { method: "GET", credentials: "include", headers }, signal),
    shareId,
  );
}
export async function mutatePresentationReviewerFeedback(
  shareId: string,
  token: string,
  mutation: PresentationReviewFeedbackMutation,
  signal?: AbortSignal,
) {
  const path = `${reviewerPath(shareId)}/commands`;
  const headers = tokenHeaders(token);
  const input = PresentationReviewFeedbackMutationSchema.parse(mutation);
  return mutationResponse(
    await request(
      path,
      { method: "POST", credentials: "include", headers, body: JSON.stringify(input) },
      signal,
    ),
    shareId,
    input,
  );
}
