import {
  normalizeTextResponse,
  wordCloudGroupKey,
  isPresentationTextResultQuestion,
  type TextResponseDistribution,
  type PresentationTextModerationPage,
  type PresentationTextResponseResults,
} from "@openround/contracts";
import {
  PresentationTextReadError,
  type PresentationPrivateTextResponse,
  type PresentationTextModerationPageInput,
  type PresentationTextResultsInput,
  type PresentationTextReportEvidence,
} from "./presentation-text-types.js";
import type {
  PresentationSessionRecord,
  PresentationSessionTimelineRecord,
} from "./presentation-session-types.js";
export const samePresentationUuid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function assertTextReadSession(
  session: PresentationSessionRecord | undefined | null,
  workspaceId: string,
  now = new Date(),
  report = false,
): asserts session is PresentationSessionRecord {
  if (
    !session ||
    session.workspaceId !== workspaceId ||
    session.retentionExpiresAt <= now ||
    (!report && session.liveExpiresAt <= now)
  )
    throw new PresentationTextReadError("NOT_FOUND", "Presentation session not found");
}
function questionFor(session: PresentationSessionRecord, blockId: string) {
  const block = session.content.blocks.find((block) => samePresentationUuid(block.id, blockId));
  return block?.kind === "question" && isPresentationTextResultQuestion(block.question)
    ? block
    : undefined;
}
function canonical(
  row: PresentationPrivateTextResponse,
  session: PresentationSessionRecord,
): string | undefined {
  const block = questionFor(session, row.record.blockId);
  if (
    !block ||
    row.textValue === null ||
    !samePresentationUuid(block.question.id, row.record.questionId)
  )
    return;
  try {
    return normalizeTextResponse(row.textValue, block.question.type as "open_text" | "word_cloud");
  } catch {
    return;
  }
}
export function presentationTextPageOffset(
  session: PresentationSessionRecord,
  scope: unknown[],
  cursor: string | undefined,
  limit: number,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new PresentationTextReadError("CONFLICT", "Choose a page size between 1 and 50");
  const fence = [session.id, session.revision, session.eventSeq, ...scope, limit];
  let start = 0;
  if (cursor) {
    try {
      if (cursor.length > 2000) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (
        !Array.isArray(value) ||
        JSON.stringify(value.slice(0, -1)) !== JSON.stringify(fence) ||
        !Number.isSafeInteger(value.at(-1)) ||
        value.at(-1) < 0 ||
        value.at(-1) > 2500
      )
        throw new Error();
      start = value.at(-1);
    } catch {
      throw new PresentationTextReadError("CONFLICT", "Responses changed. Refresh the list");
    }
  }
  return {
    start,
    next: (more: boolean) =>
      more ? Buffer.from(JSON.stringify([...fence, start + limit])).toString("base64url") : null,
  };
}
export function textModerationPage(
  session: PresentationSessionRecord,
  rows: PresentationPrivateTextResponse[],
  names: Map<string, string>,
  input: PresentationTextModerationPageInput,
  windowed = false,
): PresentationTextModerationPage {
  const page = presentationTextPageOffset(
    session,
    ["moderation", input.blockId?.toLowerCase() ?? null, input.status],
    input.cursor,
    input.limit,
  );
  const values = rows
    .filter(
      ({ record }) =>
        record.moderationStatus === input.status &&
        (!input.blockId || samePresentationUuid(record.blockId, input.blockId)),
    )
    .sort(
      (a, b) =>
        a.record.submittedAt.getTime() - b.record.submittedAt.getTime() ||
        a.record.id.localeCompare(b.record.id),
    );
  return {
    sessionId: session.id,
    revision: session.revision,
    seq: session.eventSeq,
    phase: session.phase,
    items: values
      .slice(windowed ? 0 : page.start, (windowed ? 0 : page.start) + input.limit)
      .flatMap((row) => {
        const block = questionFor(session, row.record.blockId);
        const value = canonical(row, session);
        if (!block || (row.record.moderationStatus !== "removed" && value === undefined)) return [];
        return [
          {
            responseId: row.record.id,
            blockId: block.id,
            questionId: block.question.id,
            questionPrompt: block.question.prompt,
            textValue: row.record.moderationStatus === "removed" ? null : value!,
            status: row.record.moderationStatus!,
            moderationVersion: row.record.moderationVersion!,
            submittedAt: row.record.submittedAt.toISOString(),
            authorAlias: names.get(row.record.participantId) ?? null,
          },
        ];
      }),
    nextCursor: page.next(values.length > (windowed ? 0 : page.start) + input.limit),
  };
}
function approved(
  session: PresentationSessionRecord,
  blockId: string,
  rows: PresentationPrivateTextResponse[],
) {
  const seen = new Set<string>();
  return rows
    .filter(
      ({ record }) =>
        record.moderationStatus === "approved" && samePresentationUuid(record.blockId, blockId),
    )
    .sort(
      (a, b) =>
        a.record.submittedAt.getTime() - b.record.submittedAt.getTime() ||
        a.record.id.localeCompare(b.record.id),
    )
    .flatMap((row) => {
      const value = canonical(row, session);
      const key = row.record.participantId.toLowerCase();
      if (value === undefined || seen.has(key)) return [];
      seen.add(key);
      return [value];
    });
}
export function textDistribution(
  type: "open_text" | "word_cloud",
  values: string[],
): TextResponseDistribution | undefined {
  if (values.length < 5 || values.length > 250) return;
  if (type === "open_text")
    return {
      kind: "open_text",
      respondents: values.length,
      entries: values.map((value) => ({ value })),
    };
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = wordCloudGroupKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    kind: "word_cloud",
    respondents: values.length,
    buckets: [...counts]
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
      .map(([value, count]) => ({
        value,
        label: value,
        count,
        percent: Math.round((count / values.length) * 10000) / 100,
      })),
  };
}
export function textResponseResults(
  session: PresentationSessionRecord,
  rows: PresentationPrivateTextResponse[],
  timeline: PresentationSessionTimelineRecord[],
  input: PresentationTextResultsInput,
): PresentationTextResponseResults {
  const block = questionFor(session, input.blockId);
  const current = session.content.blocks[session.currentBlockIndex];
  if (!block || !current || !samePresentationUuid(block.id, current.id))
    throw new PresentationTextReadError("NOT_FOUND", "Current text checkpoint not found");
  const page = presentationTextPageOffset(
    session,
    ["results", block.id, block.question.type],
    input.cursor,
    input.limit,
  );
  const values = approved(session, block.id, rows);
  const revealed = timeline.some(
    (event) =>
      event.type === "question.revealed" &&
      event.blockId &&
      samePresentationUuid(event.blockId, block.id),
  );
  const distribution = revealed
    ? textDistribution(block.question.type as "open_text" | "word_cloud", values)
    : undefined;
  const base: PresentationTextResponseResults = {
    sessionId: session.id,
    blockId: block.id,
    revision: session.revision,
    seq: session.eventSeq,
    type: block.question.type as "open_text" | "word_cloud",
    visible: !!distribution,
    approvedRespondents: revealed ? Math.min(values.length, 250) : 0,
    items: [],
    terms: [],
    nextCursor: null,
  };
  if (!distribution) return base;
  if (distribution.kind === "open_text")
    return {
      ...base,
      items: distribution.entries
        .slice(page.start, page.start + input.limit)
        .map(({ value }) => ({ textValue: value })),
      nextCursor: page.next(values.length > page.start + input.limit),
    };
  return {
    ...base,
    terms: distribution.buckets.slice(page.start, page.start + input.limit),
    nextCursor: page.next(distribution.buckets.length > page.start + input.limit),
  };
}
export function textReportEvidence(
  session: PresentationSessionRecord,
  rows: PresentationPrivateTextResponse[],
  timeline: PresentationSessionTimelineRecord[],
): PresentationTextReportEvidence[] {
  if (session.status !== "finished") return [];
  return session.content.blocks.flatMap((block) => {
    if (
      block.kind !== "question" ||
      !isPresentationTextResultQuestion(block.question) ||
      !timeline.some(
        (event) =>
          event.type === "question.revealed" &&
          event.blockId &&
          samePresentationUuid(event.blockId, block.id),
      )
    )
      return [];
    const distribution = textDistribution(block.question.type, approved(session, block.id, rows));
    return distribution ? [{ blockId: block.id, textResults: distribution }] : [];
  });
}
