import {
  CreatePresentationAssignmentSchema,
  StartPresentationReadingAttemptSchema,
  PresentationReadingProgressSchema,
  PresentationAssignmentCreatedSchema,
  PresentationAssignmentListSchema,
  PresentationAssignmentAccessSchema,
  PresentationAssignmentPreviewSchema,
  PresentationReadingAttemptSnapshotSchema,
  PresentationReadingMutationResultSchema,
  type CreatePresentationAssignment,
  type PresentationReadingAttempt,
  type PresentationReadingProgress,
  type StartPresentationReadingAttempt,
} from "@openround/contracts";
import { apiFetch } from "./api";
import { clientUuid } from "./uuid";
import { fetchPresentationPrivateImage } from "./presentation-sharing-client";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function identifier(value: string) {
  if (!uuid.test(value)) throw new Error("Reading assignment unavailable");
  return value.toLowerCase();
}
function assignmentPath(id: string) {
  return `/v1/presentation-assignments/${identifier(id)}`;
}
function authorPath(id: string) {
  return `/v1/presentations/${identifier(id)}/assignments`;
}
function options(token: string, signal?: AbortSignal): RequestInit {
  if (!tokenPattern.test(token)) throw new Error("Reading credential unavailable");
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
export interface ReadingCredentials {
  token: string;
  reader: StartPresentationReadingAttempt | null;
}
export function parseReadingLink(
  href: string,
  assignmentId: string,
  origin?: string,
): ReadingCredentials | null {
  try {
    const url = new URL(href);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (origin && url.origin !== origin) ||
      !url.pathname.startsWith("/presentation-assignment/") ||
      !sameId(url.pathname.slice("/presentation-assignment/".length), identifier(assignmentId)) ||
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
    const parsed = StartPresentationReadingAttemptSchema.safeParse({
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
export function captureReadingCredentials({
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
  const credentials = parseReadingLink(url.href, assignmentId);
  url.hash = "";
  for (const key of ["token", "attempt", "resume"]) url.searchParams.delete(key);
  history.replaceState(history.state, "", `${url.pathname}${url.search}`);
  return { provided: true, credentials };
}
export function newReadingAttempt(): StartPresentationReadingAttempt {
  return { attemptId: clientUuid(), token: credential() };
}
export function readingResumeUrl(
  origin: string,
  assignmentId: string,
  credentials: ReadingCredentials,
) {
  const url = new URL(`/presentation-assignment/${identifier(assignmentId)}`, origin);
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
    throw new Error("The reading assignment response could not be verified.");
  return value;
}
function verifyAttempt(
  attempt: PresentationReadingAttempt,
  assignmentId: string,
  attemptId: string,
) {
  if (!sameId(attempt.id, attemptId) || !sameId(attempt.assignmentId, assignmentId))
    throw new Error("The reader response could not be verified. Retry the same request.");
}
export async function fetchReadingPreview(id: string, token: string, signal?: AbortSignal) {
  return verifyPreview(
    PresentationAssignmentPreviewSchema.parse(
      await apiFetch<unknown>(assignmentPath(id), options(token, signal)),
    ),
    id,
  );
}
export async function fetchReadingAccess(id: string, token: string, signal?: AbortSignal) {
  return PresentationAssignmentAccessSchema.parse(
    await apiFetch<unknown>(`${assignmentPath(id)}/access`, options(token, signal)),
  );
}
export async function fetchReadingAttempt(
  id: string,
  reader: StartPresentationReadingAttempt,
  signal?: AbortSignal,
) {
  const value = verifyPreview(
    PresentationReadingAttemptSnapshotSchema.parse(
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
  return value;
}
export async function startReadingAttempt(
  id: string,
  token: string,
  request: StartPresentationReadingAttempt,
  signal?: AbortSignal,
) {
  const input = StartPresentationReadingAttemptSchema.parse(request);
  const value = PresentationReadingMutationResultSchema.parse(
    await apiFetch<unknown>(`${assignmentPath(id)}/attempts`, {
      ...options(token, signal),
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  verifyAttempt(value.attempt, id, input.attemptId);
  return value;
}
export async function recordReadingProgress(
  id: string,
  reader: StartPresentationReadingAttempt,
  request: PresentationReadingProgress,
  signal?: AbortSignal,
) {
  const input = PresentationReadingProgressSchema.parse(request);
  const value = PresentationReadingMutationResultSchema.parse(
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
export function fetchReadingImage(id: string, token: string, mediaId: string, signal: AbortSignal) {
  options(token, signal);
  return fetchPresentationPrivateImage(assignmentPath(id), token, mediaId, signal);
}
export function readingAssignmentIntent(
  versionId: string,
  days: number,
  now = Date.now(),
): CreatePresentationAssignment {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Choose 1–30 days");
  return CreatePresentationAssignmentSchema.parse({
    requestId: clientUuid(),
    versionId,
    token: credential(),
    expiresAt: new Date(now + days * 86_400_000).toISOString(),
  });
}
const intentKey = (id: string, actorKey: string) =>
  `openround:presentation-assignment-intent:${encodeURIComponent(actorKey)}:${identifier(id)}`;
export function loadReadingAssignmentIntent(
  id: string,
  actorKey: string,
): CreatePresentationAssignment | null {
  try {
    const raw = sessionStorage.getItem(intentKey(id, actorKey));
    return raw ? CreatePresentationAssignmentSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function saveReadingAssignmentIntent(
  id: string,
  actorKey: string,
  intent: CreatePresentationAssignment,
) {
  try {
    sessionStorage.setItem(intentKey(id, actorKey), JSON.stringify(intent));
  } catch {
    /* The dialog also retains its exact intent in memory. */
  }
}
export function clearReadingAssignmentIntent(
  id: string,
  actorKey: string,
  expected: CreatePresentationAssignment,
) {
  const saved = loadReadingAssignmentIntent(id, actorKey);
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
export async function createReadingAssignment(id: string, request: CreatePresentationAssignment) {
  const input = CreatePresentationAssignmentSchema.parse(request);
  const value = PresentationAssignmentCreatedSchema.parse(
    await apiFetch<unknown>(authorPath(id), {
      method: "POST",
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    }),
  );
  const link = parseReadingLink(value.url, value.assignment.id);
  if (
    !sameId(value.assignment.versionId, input.versionId) ||
    value.assignment.expiresAt !== input.expiresAt ||
    link?.token !== input.token ||
    link.reader !== null
  )
    throw new Error("The assignment link could not be verified. Retry the same request.");
  return value;
}
export async function listReadingAssignments(id: string, signal?: AbortSignal) {
  return PresentationAssignmentListSchema.parse(
    await apiFetch<unknown>(authorPath(id), { cache: "no-store", signal }),
  ).assignments;
}
export async function revokeReadingAssignment(id: string, assignmentId: string) {
  await apiFetch(`${authorPath(id)}/${identifier(assignmentId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(20_000),
  });
}
