import { PresentationContentSchema, type PresentationContent } from "@openround/contracts";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  createPresentationSessionRepository,
  createAudienceScopeRepository,
  createScopedQnaRepository,
  type Repository,
  type PresentationInsightsOpinionSelector,
  type PresentationSessionTimelineRecord,
} from "../../src/index.js";
import { presentationSharingFixture } from "./presentation-sharing-conformance.js";
export async function presentationInsightsFixture(
  repository: Repository,
  label = "insights",
  transform?: (content: PresentationContent) => PresentationContent,
) {
  let f = await presentationSharingFixture(repository, label);
  if (transform) {
    const content = PresentationContentSchema.parse(transform(f.content)),
      hash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const saved = await f.presentations.updatePresentationDraft({
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      draft: content,
      draftHash: hash,
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: f.actor.userId,
    });
    const version = await f.presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: f.actor.workspaceId,
        presentationId: f.presentation.id,
        version: 2,
        content,
        contentSchemaVersion: content.schemaVersion,
        contentHash: hash,
        sourceDraftRevision: saved!.draftRevision,
        publishedAt: new Date(),
      },
      saved!.draftRevision,
    );
    f = { ...f, content, version };
  }
  const sessions = createPresentationSessionRepository(repository),
    scopes = createAudienceScopeRepository(repository),
    qna = createScopedQnaRepository(repository),
    now = new Date();
  const session = await sessions.createSession({
    id: randomUUID(),
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    presentationVersionId: f.version.id,
    title: f.content.title,
    content: f.content,
    code: String(randomInt(1000000, 10000000)),
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    createdBy: f.actor.userId,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3600000),
    retentionExpiresAt: new Date(now.getTime() + 86400000),
  });
  const hostHash = createHash("sha256").update(randomUUID()).digest("hex"),
    participantHash = createHash("sha256").update(randomUUID()).digest("hex");
  await sessions.createCredential({
    id: randomUUID(),
    workspaceId: f.actor.workspaceId,
    sessionId: session.id,
    role: "host",
    tokenHash: hostHash,
    createdAt: now,
    expiresAt: session.liveExpiresAt,
    revokedAt: null,
  });
  await sessions.addParticipant({
    id: randomUUID(),
    workspaceId: f.actor.workspaceId,
    sessionId: session.id,
    nickname: "PRIVATE_INSIGHTS_ALIAS",
    tokenHash: participantHash,
    joinedAt: now,
    lastSeenAt: now,
  });
  const finish = async () => {
    const current = (await sessions.getSessionById(session.id))!;
    return (await sessions.transitionSession({
      workspaceId: f.actor.workspaceId,
      sessionId: session.id,
      expectedRevision: current.revision,
      status: "finished",
      phase: "finished",
      currentBlockIndex: 1,
      event: { type: "presentation.finished", blockIndex: 1, blockId: f.content.blocks[1]!.id },
    }))!;
  };
  return { ...f, sessions, scopes, qna, session, now, hostHash, participantHash, finish };
}
export async function expectPresentationQnaCountsConformance(repository: Repository) {
  const f = await presentationInsightsFixture(repository, "insights-qna"),
    context = { workspaceId: f.actor.workspaceId, scopeId: f.session.id, now: f.now };
  expect(await f.qna.getInsightsCounts(context)).toMatchObject({
    status: "not_enabled",
    audienceSeq: null,
  });
  await f.scopes.activatePresentation({
    ...context,
    sessionId: f.session.id,
    idempotencyKey: randomUUID(),
  });
  expect(await f.qna.getInsightsCounts(context)).toMatchObject({
    status: "available",
    audienceSeq: 1,
    publicQuestionCount: 0,
    upvoteCount: 0,
  });
  const create = async () =>
    f.qna.mutate({
      ...context,
      tokenHash: f.participantHash,
      command: {
        type: "question.create",
        body: "PRIVATE_INSIGHTS_BODY",
        idempotencyKey: randomUUID(),
      },
    });
  const moderate = async (id: string, status: "published" | "answered" | "dismissed" | "removed") =>
    f.qna.mutate({
      ...context,
      tokenHash: f.hostHash,
      command: {
        type: "question.moderate",
        questionId: id,
        status,
        label: null,
        banAuthor: false,
        expectedAudienceSeq: (await f.qna.getInsightsSequence(context))!,
        idempotencyKey: randomUUID(),
      },
    });
  const first = await create();
  expect(await f.qna.getInsightsCounts(context)).toMatchObject({
    publicQuestionCount: 0,
    upvoteCount: 0,
  });
  await moderate(first.receipt.resourceId, "published");
  await f.qna.mutate({
    ...context,
    tokenHash: f.participantHash,
    command: {
      type: "vote.set",
      questionId: first.receipt.resourceId,
      voted: true,
      idempotencyKey: randomUUID(),
    },
  });
  const answered = await create();
  await moderate(answered.receipt.resourceId, "answered");
  await create();
  const dismissed = await create();
  await moderate(dismissed.receipt.resourceId, "dismissed");
  const removed = await create();
  await moderate(removed.receipt.resourceId, "removed");
  const counts = (await f.qna.getInsightsCounts(context))!;
  expect(counts).toMatchObject({
    status: "available",
    publicQuestionCount: 2,
    answeredQuestionCount: 1,
    unansweredQuestionCount: 1,
    upvoteCount: 1,
  });
  expect(await f.qna.getInsightsSequence(context)).toBe(counts.audienceSeq);
  expect(JSON.stringify(counts)).not.toMatch(/PRIVATE_|participantId|body|alias|questionId|token/);
  await moderate(first.receipt.resourceId, "removed");
  expect(await f.qna.getInsightsSequence(context)).toBeGreaterThan(counts.audienceSeq!);
  expect(await f.qna.getInsightsCounts(context)).toMatchObject({
    publicQuestionCount: 1,
    answeredQuestionCount: 1,
    unansweredQuestionCount: 0,
    upvoteCount: 0,
  });
  await f.finish();
  expect(await f.qna.getInsightsCounts({ ...context, workspaceId: randomUUID() })).toBeNull();
  expect(await f.qna.getInsightsCounts({ ...context, scopeId: randomUUID() })).toBeNull();
  expect(
    await f.qna.getInsightsCounts({ ...context, now: f.session.retentionExpiresAt }),
  ).toBeNull();
  await f.sessions.deleteSession(f.actor.workspaceId, f.session.id);
  expect(await f.qna.getInsightsCounts(context)).toBeNull();
  expect(await f.qna.getInsightsSequence(context)).toBeNull();
}
export async function expectPresentationRevealCountsConformance(
  repository: Repository,
  seed: (events: PresentationSessionTimelineRecord[]) => Promise<void>,
) {
  const f = await presentationInsightsFixture(repository, "insights-rosters"),
    block = f.content.blocks[1]!,
    ids = [randomUUID(), randomUUID()],
    events = [null, [], [ids[0]!, ids[0]!.toUpperCase(), ids[1]!]].map(
      (roster, i): PresentationSessionTimelineRecord => ({
        id: randomUUID(),
        workspaceId: f.actor.workspaceId,
        sessionId: f.session.id,
        // Retained imports can use bigint sequences beyond PostgreSQL's int4 range.
        sequence: i === 2 ? 2_147_483_648 : 10 + i,
        type: "question.revealed",
        blockIndex: 1,
        blockId: block.id,
        revealedParticipantIds: roster,
        occurredAt: f.now,
      }),
    );
  await f.finish();
  await seed(events);
  const selectors = events.map((event) => ({
    blockId: block.id.toUpperCase(),
    sequence: event.sequence,
  }));
  const result = await f.sessions.getRevealRosterCounts(
    f.actor.workspaceId,
    f.session.id,
    selectors,
  );
  expect(result).toEqual(
    selectors.map((row, i) => ({
      ...row,
      blockId: block.id.toLowerCase(),
      participantCount: [null, 0, 2][i],
    })),
  );
  expect(JSON.stringify(result)).not.toContain(ids[0]!);
  expect(
    await f.sessions.getRevealRosterCounts(f.actor.workspaceId, f.session.id, [
      { blockId: f.content.blocks[0]!.id, sequence: 10 },
    ]),
  ).toEqual([{ blockId: f.content.blocks[0]!.id, sequence: 10, participantCount: null }]);
  expect(
    await f.sessions.getRevealRosterCounts(f.actor.workspaceId, f.session.id, [
      { blockId: block.id, sequence: 999 },
    ]),
  ).toEqual([{ blockId: block.id, sequence: 999, participantCount: null }]);
  await expect(
    f.sessions.getRevealRosterCounts(randomUUID(), f.session.id, selectors),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    f.sessions.getRevealRosterCounts(f.actor.workspaceId, randomUUID(), selectors),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    f.sessions.getRevealRosterCounts(
      f.actor.workspaceId,
      f.session.id,
      selectors,
      f.session.retentionExpiresAt,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    f.sessions.getRevealRosterCounts(
      f.actor.workspaceId,
      f.session.id,
      Array(201).fill(selectors[0]),
    ),
  ).rejects.toThrow();
  await repository.claimWorkspaceMediaDeletion(f.actor.workspaceId);
  await expect(
    f.sessions.getRevealRosterCounts(f.actor.workspaceId, f.session.id, selectors),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await f.qna.getInsightsCounts({ workspaceId: f.actor.workspaceId, scopeId: f.session.id }),
  ).toBeNull();
}
export async function presentationInsightsOpinionFixture(
  repository: Repository,
  semantic = false,
  unknown = false,
) {
  const f = await presentationInsightsFixture(repository, "insights-histogram", (content) => {
    const common = {
      timeLimitSeconds: 30,
      basePoints: 0,
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      explanation: "PRIVATE_HISTOGRAM_EXPLANATION",
      mediaId: null,
      mediaAlt: null,
    };
    return PresentationContentSchema.parse({
      ...content,
      schemaVersion: semantic ? 12 : 2,
      ...(semantic ? { sections: [] } : {}),
      blocks: [
        {
          id: randomUUID(),
          kind: "question",
          question: {
            ...common,
            id: randomUUID(),
            type: "poll",
            prompt: "Public poll",
            choices: [
              { id: randomUUID(), label: "Choice A", isCorrect: false },
              { id: randomUUID(), label: "Choice B", isCorrect: false },
            ],
          },
        },
        {
          id: randomUUID(),
          kind: "question",
          question: {
            ...common,
            id: randomUUID(),
            type: "rating",
            prompt: "Public rating",
            min: 1,
            max: 3,
            minLabel: "Low",
            maxLabel: "High",
          },
        },
      ],
    });
  });
  const participants = [(await f.sessions.findParticipant(f.session.id, f.participantHash))!];
  for (let i = 1; i < 5; i++)
    participants.push(
      await f.sessions.addParticipant({
        id: randomUUID(),
        workspaceId: f.actor.workspaceId,
        sessionId: f.session.id,
        nickname: `PRIVATE_${i}`,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        joinedAt: f.now,
        lastSeenAt: f.now,
      }),
    );
  const selectors: PresentationInsightsOpinionSelector[] = [];
  for (let index = 0; index < 2; index++) {
    const block = f.content.blocks[index]!;
    if (block.kind !== "question") throw new Error("Expected question");
    const question = block.question;
    if (question.type !== "poll" && question.type !== "rating") throw new Error("Expected opinion");
    selectors.push({
      blockId: block.id,
      questionId: question.id,
      type: question.type,
      choiceIds: question.type === "poll" ? question.choices.map((row) => row.id) : [],
      min: question.type === "rating" ? question.min : null,
      max: question.type === "rating" ? question.max : null,
      semanticIds: semantic,
    });
    const current = (await f.sessions.getSessionById(f.session.id))!;
    const launched = (await f.sessions.transitionSession({
      workspaceId: f.actor.workspaceId,
      sessionId: f.session.id,
      expectedRevision: current.revision,
      status: "active",
      phase: "question_open",
      currentBlockIndex: index,
      event: { type: "question.launched", blockIndex: index, blockId: block.id },
    }))!;
    for (let i = 0; i < participants.length; i++)
      await f.sessions.saveResponse({
        id: randomUUID(),
        workspaceId: f.actor.workspaceId,
        sessionId: f.session.id,
        participantId: participants[i]!.id,
        blockId: block.id,
        questionId: question.id,
        response:
          question.type === "poll"
            ? {
                choiceIds: [
                  unknown && i === 4
                    ? randomUUID()
                    : semantic || unknown
                      ? (i < 3 ? question.choices[0]!.id : question.choices[1]!.id).toUpperCase()
                      : i < 3
                        ? question.choices[0]!.id
                        : question.choices[1]!.id,
                ],
              }
            : { ratingValue: unknown && i === 4 ? 99 : (i % 3) + 1 },
        responseSchemaVersion: 1,
        correct: null,
        score: 0,
        responseMs: 100,
        submittedAt: new Date(),
        idempotencyKey: randomUUID(),
      });
    const updated = (await f.sessions.getSessionById(f.session.id))!;
    await f.sessions.transitionSession({
      workspaceId: f.actor.workspaceId,
      sessionId: f.session.id,
      expectedRevision: updated.revision,
      status: "active",
      phase: "question_reveal",
      currentBlockIndex: index,
      event: { type: "question.revealed", blockIndex: index, blockId: block.id },
    });
    void launched;
  }
  await f.finish();
  return { ...f, selectors };
}
export async function expectPresentationOpinionCountsConformance(repository: Repository) {
  const modern = await presentationInsightsOpinionFixture(repository, true),
    legacy = await presentationInsightsOpinionFixture(repository, false, true),
    legacyValid = await presentationInsightsOpinionFixture(repository, false, false);
  const modernCounts = await modern.sessions.getInsightsOpinionCounts(
    modern.actor.workspaceId,
    modern.session.id,
    modern.selectors,
  );
  expect(modernCounts).toEqual([
    {
      blockId: modern.selectors[0]!.blockId,
      responseCount: 5,
      buckets: modern.selectors[0]!.choiceIds.map((key, index) => ({ key, count: index ? 2 : 3 })),
    },
    {
      blockId: modern.selectors[1]!.blockId,
      responseCount: 5,
      buckets: [
        { key: "1", count: 2 },
        { key: "2", count: 2 },
        { key: "3", count: 1 },
      ],
    },
  ]);
  const validCounts = await legacyValid.sessions.getInsightsOpinionCounts(
    legacyValid.actor.workspaceId,
    legacyValid.session.id,
    legacyValid.selectors,
  );
  expect(validCounts[0]).toEqual({
    blockId: legacyValid.selectors[0]!.blockId,
    responseCount: 5,
    buckets: legacyValid.selectors[0]!.choiceIds.map((key, index) => ({
      key,
      count: index ? 2 : 3,
    })),
  });
  const legacyCounts = await legacy.sessions.getInsightsOpinionCounts(
    legacy.actor.workspaceId,
    legacy.session.id,
    legacy.selectors,
  );
  expect(legacyCounts[0]).toMatchObject({
    responseCount: 5,
    buckets: legacy.selectors[0]!.choiceIds.map((key) => ({ key, count: 0 })),
  });
  expect(legacyCounts[1]).toMatchObject({
    responseCount: 5,
    buckets: [
      { key: "1", count: 2 },
      { key: "2", count: 1 },
      { key: "3", count: 1 },
    ],
  });
  expect(JSON.stringify(modernCounts)).not.toMatch(
    /PRIVATE_|participantId|nickname|responseMs|response:/,
  );
  expect(
    await modern.sessions.getInsightsOpinionCounts(
      randomUUID(),
      modern.session.id,
      modern.selectors,
    ),
  ).toEqual([]);
  expect(
    await modern.sessions.getInsightsOpinionCounts(
      modern.actor.workspaceId,
      randomUUID(),
      modern.selectors,
    ),
  ).toEqual([]);
  expect(
    await modern.sessions.getInsightsOpinionCounts(modern.actor.workspaceId, modern.session.id, [
      { ...modern.selectors[0]!, questionId: randomUUID() },
    ]),
  ).toEqual([]);
  expect(
    await modern.sessions.getInsightsOpinionCounts(modern.actor.workspaceId, modern.session.id, [
      { ...modern.selectors[0]!, semanticIds: false },
    ]),
  ).toEqual([]);
  expect(
    await modern.sessions.getInsightsOpinionCounts(modern.actor.workspaceId, modern.session.id, [
      { ...modern.selectors[1]!, min: 2 },
    ]),
  ).toEqual([]);
  expect(
    await modern.sessions.getInsightsOpinionCounts(modern.actor.workspaceId, modern.session.id, [
      { ...modern.selectors[0]!, choiceIds: [randomUUID()] },
    ]),
  ).toEqual([]);
  await expect(
    modern.sessions.getInsightsOpinionCounts(
      modern.actor.workspaceId,
      modern.session.id,
      Array(201).fill(modern.selectors[0]),
    ),
  ).rejects.toThrow();
  expect(
    await modern.sessions.getInsightsOpinionCounts(
      modern.actor.workspaceId,
      modern.session.id,
      modern.selectors,
      modern.session.retentionExpiresAt,
    ),
  ).toEqual([]);
  await repository.claimWorkspaceMediaDeletion(modern.actor.workspaceId);
  expect(
    await modern.sessions.getInsightsOpinionCounts(
      modern.actor.workspaceId,
      modern.session.id,
      modern.selectors,
    ),
  ).toEqual([]);
}
