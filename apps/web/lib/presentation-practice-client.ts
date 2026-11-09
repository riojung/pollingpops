import {
  CreatePresentationPracticeAssignmentSchema,
  StartPresentationPracticeAttemptSchema,
  PresentationPracticeProgressSchema,
  PresentationPracticeAssignmentCreatedSchema,
  PresentationPracticeAssignmentListSchema,
  PresentationPracticeAssignmentAccessSchema,
  PresentationPracticePreviewSchema,
  PresentationPracticeAttemptSnapshotSchema,
  PresentationPracticeMutationResultSchema,
  type CreatePresentationPracticeAssignment,
  type PresentationPracticeAttempt,
  type PresentationPracticeProgress,
  type StartPresentationPracticeAttempt,
  type PresentationReview,
  PresentationPracticeInsightsSchema,
} from "@openround/contracts";
import { apiFetch } from "./api";
import { clientUuid } from "./uuid";
import { fetchPresentationPrivateImage } from "./presentation-sharing-client";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function identifier(value: string) {
  if (!uuid.test(value)) throw new Error("Practice assignment unavailable");
  return value.toLowerCase();
}
function assignmentPath(id: string) {
  return `/v1/presentation-practice/${identifier(id)}`;
}
function authorPath(id: string) {
  return `/v1/presentations/${identifier(id)}/practice-assignments`;
}
function options(token: string, signal?: AbortSignal): RequestInit {
  if (!tokenPattern.test(token)) throw new Error("Practice credential unavailable");
  return {
    headers: { authorization: `Bearer ${token}` },
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  };
}
function credential() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export interface PracticeCredentials {
  token: string;
  reader: StartPresentationPracticeAttempt | null;
}
export function parsePracticeLink(
  href: string,
  assignmentId: string,
  origin?: string,
): PracticeCredentials | null {
  try {
    const url = new URL(href);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (origin && url.origin !== origin) ||
      !url.pathname.startsWith("/presentation-practice/") ||
      !sameId(url.pathname.slice("/presentation-practice/".length), identifier(assignmentId)) ||
      url.search
    )
      return null;
    const values = new URLSearchParams(url.hash.slice(1));
    if (
      [...values.keys()].some((key) => !["token", "attempt", "resume"].includes(key)) ||
      values.getAll("token").length !== 1 ||
      !tokenPattern.test(values.get("token") ?? "")
    )
      return null;
    const attempt = values.getAll("attempt"),
      resume = values.getAll("resume");
    if (!attempt.length && !resume.length) return { token: values.get("token")!, reader: null };
    if (attempt.length !== 1 || resume.length !== 1) return null;
    const parsed = StartPresentationPracticeAttemptSchema.safeParse({
      attemptId: attempt[0],
      token: resume[0],
    });
    return parsed.success
      ? {
          token: values.get("token")!,
          reader: { ...parsed.data, attemptId: identifier(parsed.data.attemptId) },
        }
      : null;
  } catch {
    return null;
  }
}
/** Fragment credentials stay in memory. Never discover a reader from browser storage. */
export function capturePracticeCredentials({
  assignmentId,
  location,
  history,
}: {
  assignmentId: string;
  location: Pick<Location, "href">;
  history: Pick<History, "state" | "replaceState">;
}) {
  const url = new URL(location.href);
  const provided =
    !!url.hash || ["token", "attempt", "resume"].some((key) => url.searchParams.has(key));
  if (!provided) return { provided: false, credentials: null };
  const credentials = parsePracticeLink(url.href, assignmentId);
  url.hash = "";
  for (const key of ["token", "attempt", "resume"]) url.searchParams.delete(key);
  history.replaceState(history.state, "", `${url.pathname}${url.search}`);
  return { provided: true, credentials };
}
export function newPracticeAttempt(): StartPresentationPracticeAttempt {
  return { attemptId: clientUuid(), token: credential() };
}
export function practiceResumeUrl(
  origin: string,
  assignmentId: string,
  credentials: PracticeCredentials,
) {
  const url = new URL(`/presentation-practice/${identifier(assignmentId)}`, origin);
  url.hash = new URLSearchParams({
    token: credentials.token,
    ...(credentials.reader
      ? {
          attempt: credentials.reader.attemptId,
          resume: credentials.reader.token,
        }
      : {}),
  }).toString();
  return url.href;
}
function verifyPreview<
  T extends { assignment: { id: string; versionId: string }; review: { versionId: string } },
>(value: T, id: string): T {
  if (
    !sameId(value.assignment.id, id) ||
    !sameId(value.assignment.versionId, value.review.versionId)
  )
    throw new Error("The practice assignment response could not be verified.");
  return value;
}
function verifyAttempt(
  attempt: PresentationPracticeAttempt,
  assignmentId: string,
  attemptId: string,
) {
  if (!sameId(attempt.id, attemptId) || !sameId(attempt.assignmentId, assignmentId))
    throw new Error("The reader response could not be verified. Retry the same request.");
}
export async function fetchPracticePreview(id: string, token: string, signal?: AbortSignal) {
  return verifyPreview(
    PresentationPracticePreviewSchema.parse(
      await apiFetch<unknown>(assignmentPath(id), options(token, signal)),
    ),
    id,
  );
}
export async function fetchPracticeAccess(id: string, token: string, signal?: AbortSignal) {
  return PresentationPracticeAssignmentAccessSchema.parse(
    await apiFetch<unknown>(`${assignmentPath(id)}/access`, options(token, signal)),
  );
}
export async function fetchPracticeAttempt(
  id: string,
  reader: StartPresentationPracticeAttempt,
  signal?: AbortSignal,
) {
  const value = verifyPreview(
    PresentationPracticeAttemptSnapshotSchema.parse(
      await apiFetch<unknown>(
        `${assignmentPath(id)}/attempts/${identifier(reader.attemptId)}`,
        options(reader.token, signal),
      ),
    ),
    id,
  );
  verifyAttempt(value.attempt, id, reader.attemptId);
  const ids = new Set(value.review.blocks.map((block) => block.id.toLowerCase()));
  if (value.attempt.readBlockIds.some((blockId) => !ids.has(blockId.toLowerCase())))
    throw new Error("The reader pages could not be verified.");
  verifyPracticeAnswers(value.attempt, value.review);
  return value;
}
export async function startPracticeAttempt(
  id: string,
  token: string,
  request: StartPresentationPracticeAttempt,
  signal?: AbortSignal,
) {
  const input = StartPresentationPracticeAttemptSchema.parse({
    ...request,
    attemptId: identifier(request.attemptId),
  });
  const value = PresentationPracticeMutationResultSchema.parse(
    await apiFetch<unknown>(`${assignmentPath(id)}/attempts`, {
      ...options(token, signal),
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  verifyAttempt(value.attempt, id, input.attemptId);
  return value;
}
export async function recordPracticeProgress(
  id: string,
  reader: StartPresentationPracticeAttempt,
  request: PresentationPracticeProgress,
  signal?: AbortSignal,
) {
  const parsed = PresentationPracticeProgressSchema.parse(request);
  const input = {
    ...parsed,
    requestId: identifier(parsed.requestId),
    ...(parsed.kind !== "complete" ? { blockId: identifier(parsed.blockId) } : {}),
    ...(parsed.kind === "answer" ? { choiceId: identifier(parsed.choiceId) } : {}),
  };
  const value = PresentationPracticeMutationResultSchema.parse(
    await apiFetch<unknown>(
      `${assignmentPath(id)}/attempts/${identifier(reader.attemptId)}/progress`,
      {
        ...options(reader.token, signal),
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  );
  verifyAttempt(value.attempt, id, reader.attemptId);
  return value;
}
export function fetchPracticeImage(
  id: string,
  token: string,
  mediaId: string,
  signal: AbortSignal,
) {
  options(token, signal);
  return fetchPresentationPrivateImage(assignmentPath(id), token, mediaId, signal);
}
export function practiceAssignmentIntent(
  versionId: string,
  days: number,
  now = Date.now(),
): CreatePresentationPracticeAssignment {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Choose 1–30 days");
  return CreatePresentationPracticeAssignmentSchema.parse({
    requestId: clientUuid(),
    versionId: identifier(versionId),
    token: credential(),
    expiresAt: new Date(now + days * 86_400_000).toISOString(),
  });
}
const intentKey = (id: string, actorKey: string) =>
  `openround:presentation-practice-intent:${encodeURIComponent(actorKey)}:${identifier(id)}`;
export function loadPracticeAssignmentIntent(
  id: string,
  actorKey: string,
): CreatePresentationPracticeAssignment | null {
  try {
    const raw = sessionStorage.getItem(intentKey(id, actorKey));
    return raw ? CreatePresentationPracticeAssignmentSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function savePracticeAssignmentIntent(
  id: string,
  actorKey: string,
  intent: CreatePresentationPracticeAssignment,
) {
  try {
    sessionStorage.setItem(intentKey(id, actorKey), JSON.stringify(intent));
  } catch {
    /* The dialog also retains its exact intent in memory. */
  }
}
export function clearPracticeAssignmentIntent(
  id: string,
  actorKey: string,
  expected: CreatePresentationPracticeAssignment,
) {
  const saved = loadPracticeAssignmentIntent(id, actorKey);
  if (
    saved?.requestId === expected.requestId &&
    saved.versionId === expected.versionId &&
    saved.token === expected.token &&
    saved.expiresAt === expected.expiresAt
  ) {
    try {
      sessionStorage.removeItem(intentKey(id, actorKey));
    } catch {
      /* In-memory intent is cleared separately. */
    }
  }
}
export async function createPracticeAssignment(
  id: string,
  request: CreatePresentationPracticeAssignment,
) {
  const input = CreatePresentationPracticeAssignmentSchema.parse({
    ...request,
    requestId: identifier(request.requestId),
    versionId: identifier(request.versionId),
  });
  const value = PresentationPracticeAssignmentCreatedSchema.parse(
    await apiFetch<unknown>(authorPath(id), {
      method: "POST",
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    }),
  );
  const link = parsePracticeLink(value.url, value.assignment.id);
  if (
    !sameId(value.assignment.versionId, input.versionId) ||
    value.assignment.expiresAt !== input.expiresAt ||
    link?.token !== input.token ||
    link.reader !== null
  )
    throw new Error("The assignment link could not be verified. Retry the same request.");
  return value;
}
export async function listPracticeAssignments(id: string, signal?: AbortSignal) {
  return PresentationPracticeAssignmentListSchema.parse(
    await apiFetch<unknown>(authorPath(id), { cache: "no-store", signal }),
  ).assignments;
}
export async function revokePracticeAssignment(id: string, assignmentId: string) {
  await apiFetch(`${authorPath(id)}/${identifier(assignmentId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(20_000),
  });
}

/** Bind accepted personal outcomes to the same frozen question and choices. */
export function verifyPracticeAnswers(
  attempt: PresentationPracticeAttempt,
  review: PresentationReview,
) {
  const ids = new Set(review.blocks.map((block) => identifier(block.id)));
  const readIds = new Set(attempt.readBlockIds.map(identifier));
  if (ids.size !== review.blocks.length || [...readIds].some((id) => !ids.has(id)))
    throw new Error("The practice pages could not be verified.");
  const answered = new Set(attempt.answers.map((answer) => identifier(answer.blockId)));
  const questions = review.blocks.filter((block) => block.kind === "question");
  if (
    questions.some(
      (block) => readIds.has(identifier(block.id)) && !answered.has(identifier(block.id)),
    ) ||
    (attempt.completedAt &&
      (readIds.size !== ids.size || questions.some((block) => !answered.has(identifier(block.id)))))
  )
    throw new Error("The practice completion could not be verified.");
  for (const answer of attempt.answers) {
    const block = review.blocks.find((block) => sameId(block.id, answer.blockId));
    if (
      block?.kind !== "question" ||
      !block.question.choices?.some((choice) => sameId(choice.id, answer.choiceId)) ||
      !block.question.choices.some((choice) => sameId(choice.id, answer.feedback.correctChoiceId))
    )
      throw new Error("The accepted practice feedback could not be verified.");
  }
  return attempt;
}
export async function fetchPracticeInsights(
  presentationId: string,
  assignmentId: string,
  versionId: string,
  signal: AbortSignal,
) {
  const report = PresentationPracticeInsightsSchema.parse(
    await apiFetch<unknown>(`${authorPath(presentationId)}/${identifier(assignmentId)}/insights`, {
      signal,
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }),
  );
  if (
    !sameId(report.assignment.id, identifier(assignmentId)) ||
    !sameId(report.assignment.versionId, identifier(versionId))
  )
    throw new Error(
      "These practice insights could not be verified for this assignment and published version.",
    );
  return report;
}
