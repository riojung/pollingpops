import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  QuestionDraftSchema,
  QuizContentSchema,
  type QuestionDraft,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type PresentationSessionRecord,
  type PresentationSessionParticipantRecord,
} from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { presentationPublishedQuestionInsertionTransition } from "../src/presentation-live-published-questions.js";
import { presentationOpinionSummary } from "../src/presentation-opinion-results.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import { presentationReportRestProjection } from "../src/presentation-reporting.js";
import { PresentationSessionService } from "../src/presentation-session-service.js";
import {
  buildPresentationParticipantSnapshot,
  buildPresentationProjectionData,
  buildTargetedPresentationParticipantSnapshot,
} from "../src/presentation-session-projections.js";
import {
  presentationResponseCorrect,
  presentationResponseRequestHash,
  presentationResponseScore,
  presentationResponseValidationMessage,
} from "../src/presentation-session-response-policy.js";
import { StorageService } from "../src/storage.js";
import { projectPresentationSummary } from "../src/session-summary-projection.js";

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  FEATURE_PRESENTATIONS: "true",
  LOG_LEVEL: "silent",
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function opinionQuestion(type: "poll" | "ranking", count = 6): QuestionDraft {
  return QuestionDraftSchema.parse({
    id: randomUUID(),
    type,
    prompt: "Which priorities matter?",
    purpose: "opinion",
    confidence: "off",
    delivery: "main",
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    choices: Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      label: `Priority ${index + 1}`,
      isCorrect: false,
      feedback: "Private authored feedback",
    })),
    ...(type === "poll" ? { maxSelections: 2 } : { rankCount: 2 }),
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "Private authored explanation",
    mediaId: null,
    mediaAlt: null,
    sourceCitations: [
      {
        sourceName: "Private source",
        sourceDigest: "a".repeat(64),
        locator: "Private locator",
        excerpt: "Private excerpt",
      },
    ],
  });
}

async function fixture(type: "poll" | "ranking", timeMode: "timed" | "flex", uppercase = false) {
  const workspaceId = randomUUID(),
    userId = randomUUID(),
    presentationId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const presentations = createPresentationRepository(repository);
  const sessions = createPresentationSessionRepository(repository);
  const service = new PresentationSessionService({
    repository,
    presentations,
    sessions,
    config,
    storage: new StorageService(config, null),
  });
  const question = opinionQuestion(type);
  if (uppercase && "choices" in question) {
    question.id = question.id.toUpperCase();
    question.choices = question.choices.map((choice) => ({
      ...choice,
      id: choice.id.toUpperCase(),
    }));
  }
  const content = PresentationContentSchema.parse({
    title: "Opinion formats",
    schemaVersion: 9,
    blocks: [
      { id: uppercase ? randomUUID().toUpperCase() : randomUUID(), kind: "question", question },
    ],
  });
  const draft = PresentationDraftSchema.parse(content),
    now = new Date();
  await presentations.createPresentation({
    id: presentationId,
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: 9,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId,
      version: 1,
      content,
      contentSchemaVersion: 9,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const hosted = await service.createSession({
    workspaceId,
    userId,
    presentationId,
    timeMode,
    requestId: randomUUID(),
  });
  const sessionId = hosted.snapshot.sessionId;
  const companion = await service.createCompanionPass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  const stage = await service.createStagePass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  const first = await service.join(hosted.snapshot.code, "River"),
    second = await service.join(hosted.snapshot.code, "Sky");
  const block = content.blocks[0]!;
  if (block.kind !== "question" || !("choices" in block.question))
    throw new Error("Choice opinion required");
  const choices = block.question.choices.map((choice) => choice.id);
  return {
    workspaceId,
    userId,
    sessions,
    service,
    hosted,
    sessionId,
    companion,
    stage,
    first,
    second,
    block,
    choices,
  };
}

function expectOpinionResponseUnassessed(
  session: PresentationSessionRecord,
  participants: PresentationSessionParticipantRecord[],
  responses: PresentationSessionResponseRecord[],
) {
  const response = responses[0]!;
  for (const phase of ["question_reveal", "intervention", "finished"] as const) {
    const state = {
      ...session,
      phase,
      status: phase === "finished" ? ("finished" as const) : ("active" as const),
      finishedAt: phase === "finished" ? session.updatedAt : null,
    };
    const data = buildPresentationProjectionData(state, participants, responses);
    const full = buildPresentationParticipantSnapshot(state, response.participantId, data);
    const targeted = buildTargetedPresentationParticipantSnapshot(
      state,
      response.participantId,
      {
        participantCount: participants.length,
        currentResponse: response,
        standing: null,
      },
      response,
    );
    for (const snapshot of [full, targeted]) {
      expect(snapshot).toMatchObject({
        phase,
        responseSubmitted: true,
        responseResult: null,
        standing: null,
      });
    }
    expect(full).toMatchObject({
      responseReceipt: { blockId: session.content.blocks[0]!.id },
      opinionSummary: { blockId: session.content.blocks[0]!.id, responseCount: responses.length },
    });
  }
}

describe("Presentation E04 opinion formats", () => {
  it.each(["poll", "ranking"] as const)(
    "projects uppercase authored %s IDs from PostgreSQL-style lowercase records",
    async (type) => {
      const f = await fixture(type, "flex", true);
      const frozenJson = JSON.stringify((await f.sessions.getSessionById(f.sessionId))!.content);
      const lowerRecord = (
        record: PresentationSessionResponseRecord,
      ): PresentationSessionResponseRecord => ({
        ...record,
        blockId: record.blockId.toLowerCase(),
        questionId: record.questionId.toLowerCase(),
        response: {
          ...record.response,
          ...(record.response.choiceIds
            ? { choiceIds: record.response.choiceIds.map((id) => id.toLowerCase()) }
            : {}),
          ...(record.response.orderedChoiceIds
            ? { orderedChoiceIds: record.response.orderedChoiceIds.map((id) => id.toLowerCase()) }
            : {}),
        },
      });
      const originalAccept = f.sessions.acceptResponse.bind(f.sessions);
      vi.spyOn(f.sessions, "acceptResponse").mockImplementation(async (record, revision) => {
        const result = await originalAccept(record, revision);
        if (result.status !== "accepted" && result.status !== "duplicate") return result;
        return {
          ...result,
          response: lowerRecord(result.response),
          acknowledgement: {
            ...result.acknowledgement,
            projection: {
              ...result.acknowledgement.projection,
              currentResponse: result.acknowledgement.projection.currentResponse
                ? lowerRecord(result.acknowledgement.projection.currentResponse)
                : null,
            },
          },
        };
      });
      const originalContext = f.sessions.getResponseContext.bind(f.sessions);
      vi.spyOn(f.sessions, "getResponseContext").mockImplementation(async (...args) => {
        const context = await originalContext(...args);
        return context
          ? {
              ...context,
              priorResponse: context.priorResponse ? lowerRecord(context.priorResponse) : null,
            }
          : null;
      });
      const originalResponses = f.sessions.listResponses.bind(f.sessions);
      vi.spyOn(f.sessions, "listResponses").mockImplementation(async (id) =>
        (await originalResponses(id)).map(lowerRecord),
      );
      const opened = await f.service.command({
        sessionId: f.sessionId,
        controlToken: f.hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "advance",
      });
      const selected = f.choices.slice(0, 2).map((id) => id.toLowerCase());
      const input = {
        sessionId: f.sessionId,
        participantToken: f.first.participantToken,
        blockId: f.block.id.toLowerCase(),
        expectedRevision: opened.revision,
        idempotencyKey: randomUUID(),
        response: type === "poll" ? { choiceIds: selected } : { orderedChoiceIds: selected },
      };
      expect(presentationResponseValidationMessage(f.block.question, input.response)).toBeNull();
      expect(
        presentationResponseValidationMessage(
          f.block.question,
          type === "poll"
            ? { choiceIds: [f.choices[0]!, f.choices[0]!.toLowerCase()] }
            : { orderedChoiceIds: [f.choices[0]!, f.choices[0]!.toLowerCase()] },
        ),
      ).not.toBeNull();
      const ack = await f.service.submitResponse(input);
      expect(ack).toMatchObject({
        accepted: true,
        duplicate: false,
        blockId: f.block.id,
        snapshot: {
          responseSubmitted: true,
          responseReceipt: { blockId: f.block.id },
          currentBlock: { id: f.block.id },
        },
      });
      const replay = await f.service.submitResponse(input);
      expect(replay).toMatchObject({
        accepted: true,
        duplicate: true,
        blockId: f.block.id,
        responseId: ack.responseId,
        acceptedAt: ack.acceptedAt,
        snapshot: { responseReceipt: ack.snapshot.responseReceipt },
      });
      await f.service.submitResponse({
        ...input,
        participantToken: f.second.participantToken,
        idempotencyKey: randomUUID(),
        response:
          type === "poll"
            ? { choiceIds: [...selected].reverse() }
            : { orderedChoiceIds: [...selected].reverse() },
      });
      const reconnected = (
        await f.service.getParticipantSnapshot(f.sessionId, f.first.participantToken)
      ).snapshot;
      expect(reconnected).toMatchObject({
        responseSubmitted: true,
        responseReceipt: { blockId: f.block.id },
      });
      const revealed = await f.service.command({
        sessionId: f.sessionId,
        controlToken: f.hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: opened.revision,
        action: "advance",
      });
      expect(revealed).toMatchObject({
        responseCount: 2,
        opinionSummary: { blockId: f.block.id, responseCount: 2 },
      });
      expect(revealed.opinionSummary?.choices.slice(0, 2).map((choice) => choice.choiceId)).toEqual(
        f.choices.slice(0, 2),
      );
      if (revealed.opinionSummary?.kind === "poll")
        expect(revealed.opinionSummary.choices[0]).toMatchObject({
          count: 2,
          percentOfRespondents: 100,
        });
      else
        expect(revealed.opinionSummary?.choices[0]).toMatchObject({
          weightedScore: 11,
          rankedRespondents: 2,
          averageRank: 1.5,
        });
      const closedReplay = await f.service.submitResponse(input);
      expect(closedReplay).toMatchObject({
        accepted: true,
        duplicate: true,
        blockId: f.block.id,
        snapshot: {
          responseSubmitted: true,
          responseResult: null,
          opinionSummary: revealed.opinionSummary,
        },
      });
      expectOpinionResponseUnassessed(
        (await f.sessions.getSessionById(f.sessionId))!,
        await f.sessions.listParticipants(f.sessionId),
        await f.sessions.listResponses(f.sessionId),
      );
      await f.service.command({
        sessionId: f.sessionId,
        controlToken: f.hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: revealed.revision,
        action: "advance",
      });
      const report = await f.service.getReport(f.workspaceId, f.sessionId, true, true, true);
      expect(report.report).toMatchObject({
        schemaVersion: 4,
        evidence: [
          {
            blockId: f.block.id,
            questionId: f.block.question.id,
            respondents: 2,
            correct: null,
            totalScore: 0,
            opinionSummary: revealed.opinionSummary,
          },
        ],
      });
      const [stored] = await originalResponses(f.sessionId);
      expect(stored?.requestHash).toBe(presentationResponseRequestHash(input));
      expect(stored?.response).toEqual(input.response);
      expect(JSON.stringify((await f.sessions.getSessionById(f.sessionId))!.content)).toBe(
        frozenJson,
      );
    },
  );

  it.each(["poll", "ranking"] as const)(
    "validates bounded %s answers without confidence or scoring",
    (type) => {
      const question = opinionQuestion(type);
      if (!("choices" in question)) throw new Error("Choice opinion required");
      const ids = question.choices.map((choice) => choice.id);
      const response =
        type === "poll" ? { choiceIds: ids.slice(0, 2) } : { orderedChoiceIds: ids.slice(0, 2) };
      expect(presentationResponseValidationMessage(question, response)).toBeNull();
      expect(
        presentationResponseValidationMessage(question, { ...response, confidence: 2 }),
      ).toContain("Confidence is not collected");
      for (const invalid of [[ids[0]!, ids[0]!], [ids[0]!, randomUUID()], ids.slice(0, 3)]) {
        expect(
          presentationResponseValidationMessage(
            question,
            type === "poll" ? { choiceIds: invalid } : { orderedChoiceIds: invalid },
          ),
        ).not.toBeNull();
      }
      if (type === "ranking") {
        expect(
          presentationResponseValidationMessage(question, { choiceIds: ids.slice(0, 2) }),
        ).not.toBeNull();
        expect(
          presentationResponseValidationMessage(question, { orderedChoiceIds: ids.slice(0, 1) }),
        ).not.toBeNull();
        const full = { ...question, rankCount: undefined };
        expect(presentationResponseValidationMessage(full, { orderedChoiceIds: ids })).toBeNull();
        expect(presentationResponseValidationMessage(full, response)).not.toBeNull();
      }
      expect(presentationResponseCorrect(question, response)).toBeNull();
      expect(presentationResponseScore(question, true, 1)).toBe(0);
    },
  );

  it.each(["poll", "ranking"] as const)(
    "copies a published %s into a legacy live deck with the v9 floor",
    async (type) => {
      const f = await fixture(type, "timed");
      const original = (await f.sessions.getSessionById(f.sessionId))!;
      const legacy = {
        ...original,
        content: PresentationContentSchema.parse({
          ...original.content,
          schemaVersion: 2,
          blocks: [
            { ...f.block, question: { ...opinionQuestion("poll", 2), maxSelections: undefined } },
          ],
        }),
      };
      const question = opinionQuestion(type);
      const sourceContent = QuizContentSchema.parse({
        title: "Published priorities",
        questions: [question],
      });
      const version = {
        id: randomUUID(),
        workspaceId: f.workspaceId,
        quizId: randomUUID(),
        version: 1,
        content: sourceContent,
        contentHash: "c".repeat(64),
        publishedAt: new Date(),
      };
      const input = {
        sessionId: f.sessionId,
        companionToken: f.companion.companionToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "insert_published_question" as const,
        publishedQuestion: {
          sourceQuizVersionId: version.id,
          sourceQuestionId: question.id,
          contentHash: version.contentHash,
        },
      };
      const inserted = presentationPublishedQuestionInsertionTransition(legacy, version, input);
      expect(inserted.content.schemaVersion).toBe(9);
      expect(inserted.content.blocks).toHaveLength(2);
      const copy = inserted.content.blocks[inserted.currentBlockIndex]!;
      expect(copy).toMatchObject({
        kind: "question",
        question: { type, purpose: "opinion", confidence: "off", basePoints: 0 },
      });
      expect(copy.id).not.toBe(f.block.id);
      if (copy.kind !== "question" || !("choices" in copy.question) || !("choices" in question))
        throw new Error("Choice opinion required");
      expect(copy.question.id).not.toBe(question.id);
      expect(copy.question.choices.map(({ id }) => id)).not.toEqual(
        question.choices.map(({ id }) => id),
      );
      expect(presentationPublishedQuestionInsertionTransition(legacy, version, input)).toEqual(
        inserted,
      );
    },
  );

  it("preserves golden legacy hashes and the order-sensitive ranking fence", () => {
    const base = { blockId: "block-1", expectedRevision: 4 };
    expect(
      presentationResponseRequestHash({
        ...base,
        response: { choiceIds: ["b", "a"], confidence: 2 },
      }),
    ).toBe("00c7c43535ec043557b8fc949d7c9a34981ac984c6126a8cdab17dbcac9aa415");
    expect(presentationResponseRequestHash({ ...base, response: { numericValue: "10.0" } })).toBe(
      "c720269b43e5deb2af5ad8b706a1407e5b6feb797133bff15eef0d22842a1041",
    );
    expect(presentationResponseRequestHash({ ...base, response: { ratingValue: 4 } })).toBe(
      "f5f7b6d224ce2da1b2d94cf44188112f196ba426ed4079acfe4a2bded3121a82",
    );
    const ordered = presentationResponseRequestHash({
      ...base,
      response: { orderedChoiceIds: ["a", "b"] },
    });
    expect(
      presentationResponseRequestHash({ ...base, response: { orderedChoiceIds: ["b", "a"] } }),
    ).not.toBe(ordered);
  });

  it.each(["poll", "ranking"] as const)(
    "retains the ingress deadline and flex acceptance fence for %s",
    async (type) => {
      for (const timeMode of ["timed", "flex"] as const) {
        const f = await fixture(type, timeMode);
        const opened = await f.service.command({
          sessionId: f.sessionId,
          controlToken: f.hosted.controlToken,
          commandId: randomUUID(),
          expectedRevision: 0,
          action: "advance",
        });
        const input = {
          sessionId: f.sessionId,
          participantToken: f.first.participantToken,
          blockId: f.block.id,
          expectedRevision: opened.revision,
          idempotencyKey: randomUUID(),
          response:
            type === "poll"
              ? { choiceIds: f.choices.slice(0, 2) }
              : { orderedChoiceIds: f.choices.slice(0, 2) },
          receivedAt: new Date(new Date(opened.questionOpenedAt!).getTime() + 30_001),
        };
        if (timeMode === "timed") {
          await expect(f.service.submitResponse(input)).rejects.toMatchObject({
            code: "PHASE_CLOSED",
          });
          await expect(f.sessions.listResponses(f.sessionId)).resolves.toEqual([]);
          await expect(
            f.service.submitResponse({ ...input, receivedAt: new Date(opened.questionClosesAt!) }),
          ).resolves.toMatchObject({ accepted: true });
        } else {
          expect(opened.questionClosesAt).toBeNull();
          await expect(f.service.submitResponse(input)).resolves.toMatchObject({ accepted: true });
        }
        const [saved] = await f.sessions.listResponses(f.sessionId);
        expect(saved).toMatchObject({
          correct: null,
          score: 0,
          responseMs: timeMode === "timed" ? 30_000 : 30_001,
        });
      }
    },
  );

  for (const type of ["poll", "ranking"] as const) {
    it.each(["timed", "flex"] as const)(
      `publishes, acknowledges, reconnects and reports ${type} in %s mode`,
      async (timeMode) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date());
        const f = await fixture(type, timeMode);
        const command = {
          sessionId: f.sessionId,
          controlToken: f.hosted.controlToken,
          commandId: randomUUID(),
          expectedRevision: 0,
          action: "advance" as const,
        };
        const opened = await f.service.command(command);
        const input = {
          sessionId: f.sessionId,
          participantToken: f.first.participantToken,
          blockId: f.block.id,
          expectedRevision: opened.revision,
          idempotencyKey: randomUUID(),
          response:
            type === "poll"
              ? { choiceIds: f.choices.slice(0, 2) }
              : { orderedChoiceIds: f.choices.slice(0, 2) },
        };
        const accepted = await f.service.submitResponse(input);
        expect(accepted).toMatchObject({
          accepted: true,
          duplicate: false,
          snapshot: { responseSubmitted: true, standing: null, responseResult: null },
        });
        expect(accepted.snapshot).not.toHaveProperty("opinionSummary");
        const reversed = {
          ...input,
          response:
            type === "poll"
              ? { choiceIds: f.choices.slice(0, 2).reverse() }
              : { orderedChoiceIds: f.choices.slice(0, 2).reverse() },
        };
        if (type === "poll")
          await expect(f.service.submitResponse(reversed)).resolves.toEqual({
            ...accepted,
            duplicate: true,
          });
        else
          await expect(f.service.submitResponse(reversed)).rejects.toMatchObject({
            code: "IDEMPOTENCY_CONFLICT",
          });
        await f.service.submitResponse({
          ...reversed,
          participantToken: f.second.participantToken,
          idempotencyKey: randomUUID(),
        });
        const openViews = [
          (await f.service.getParticipantSnapshot(f.sessionId, f.first.participantToken)).snapshot,
          await f.service.getCompanionSnapshot(f.sessionId, f.companion.companionToken),
          await f.service.getStageSnapshot(f.sessionId, f.stage.stageToken),
          (
            await f.service.sync({
              sessionId: f.sessionId,
              projection: "host",
              controlToken: f.hosted.controlToken,
            })
          ).snapshot,
        ];
        for (const view of openViews) expect(view).not.toHaveProperty("opinionSummary");
        expect(JSON.stringify(openViews.slice(0, 3))).not.toContain("Private");
        const revealed = await f.service.command({
          ...command,
          expectedRevision: opened.revision,
          commandId: randomUUID(),
        });
        expect(revealed).toMatchObject({
          phase: "question_reveal",
          opinionSummary: { kind: type, responseCount: 2 },
          competitionStandings: { status: "unscored", entries: [] },
        });
        const views = [
          (
            await f.service.sync({
              sessionId: f.sessionId,
              projection: "participant",
              participantToken: f.first.participantToken,
            })
          ).snapshot,
          await f.service.getCompanionSnapshot(f.sessionId, f.companion.companionToken),
          await f.service.getStageSnapshot(f.sessionId, f.stage.stageToken),
          revealed,
        ];
        for (const view of views) {
          expect(view.opinionSummary).toEqual(revealed.opinionSummary);
          expect(JSON.stringify(view.opinionSummary)).not.toContain(
            f.second.snapshot.participantId,
          );
        }
        expect(views[0]).toMatchObject({
          responseSubmitted: true,
          responseResult: null,
          standing: null,
        });
        expectOpinionResponseUnassessed(
          (await f.sessions.getSessionById(f.sessionId))!,
          await f.sessions.listParticipants(f.sessionId),
          await f.sessions.listResponses(f.sessionId),
        );
        if (revealed.opinionSummary?.kind === "ranking") {
          expect(revealed.opinionSummary).toMatchObject({ rankCount: 2, totalRankings: 4 });
          expect(revealed.opinionSummary.choices.slice(0, 3)).toMatchObject([
            {
              choiceId: f.choices[0],
              weightedScore: 11,
              rankedRespondents: 2,
              averageRank: 1.5,
              rankCounts: [1, 1],
            },
            { choiceId: f.choices[1], weightedScore: 11, rankedRespondents: 2, averageRank: 1.5 },
            { choiceId: f.choices[2], weightedScore: 0, rankedRespondents: 0, averageRank: null },
          ]);
        } else {
          expect(revealed.opinionSummary).toMatchObject({ totalSelections: 4 });
          expect(revealed.opinionSummary?.choices.slice(0, 2)).toMatchObject([
            { count: 2, percentOfRespondents: 100 },
            { count: 2, percentOfRespondents: 100 },
          ]);
        }
        const responseReads = vi.spyOn(f.sessions, "listResponses");
        const participantReads = vi.spyOn(f.sessions, "listParticipants");
        const timelineReads = vi.spyOn(f.sessions, "listTimeline");
        const closedReplay = await f.service.submitResponse(input);
        expect(closedReplay.snapshot.opinionSummary).toEqual(revealed.opinionSummary);
        expect(closedReplay.snapshot.responseResult).toBeNull();
        expect(responseReads).toHaveBeenCalledTimes(1);
        expect(participantReads).not.toHaveBeenCalled();
        expect(timelineReads).not.toHaveBeenCalled();
        responseReads.mockRejectedValueOnce(new Error("Aggregate temporarily unavailable"));
        const unavailableSummary = await f.service.submitResponse(input);
        expect(unavailableSummary).toMatchObject({
          accepted: true,
          duplicate: true,
          responseId: accepted.responseId,
        });
        expect(unavailableSummary.snapshot).not.toHaveProperty("opinionSummary");
        const current = (await f.sessions.getSessionById(f.sessionId))!;
        vi.spyOn(f.sessions, "getSessionById").mockResolvedValueOnce({
          ...current,
          eventSeq: current.eventSeq + 1,
        });
        const crossedFence = await f.service.submitResponse(input);
        expect(crossedFence).toMatchObject({
          accepted: true,
          duplicate: true,
          responseId: accepted.responseId,
        });
        expect(crossedFence.snapshot).not.toHaveProperty("opinionSummary");
        vi.restoreAllMocks();
        await f.service.command({
          ...command,
          expectedRevision: revealed.revision,
          commandId: randomUUID(),
        });
        const replay = await f.service.submitResponse(input);
        expect(replay).toMatchObject({
          accepted: true,
          duplicate: true,
          responseId: accepted.responseId,
          blockId: accepted.blockId,
          idempotencyKey: accepted.idempotencyKey,
          acceptedAt: accepted.acceptedAt,
          snapshot: {
            phase: "finished",
            responseReceipt: accepted.snapshot.responseReceipt,
            opinionSummary: revealed.opinionSummary,
            responseResult: null,
          },
        });
        const saved = await f.sessions.listResponses(f.sessionId);
        expect(saved).toHaveLength(2);
        for (const response of saved)
          expect(response).toMatchObject({ correct: null, score: 0, responseSchemaVersion: 2 });
        await expect(f.service.getReport(f.workspaceId, f.sessionId)).rejects.toMatchObject({
          status: 422,
          code: "VALIDATION_ERROR",
        });
        const pending = await f.service.getReport(f.workspaceId, f.sessionId, true, true, true);
        expect(pending.report).toMatchObject({
          schemaVersion: 4,
          leaderboard: [],
          recovery: [],
          evidence: [
            {
              correct: null,
              accuracyPercent: null,
              totalScore: 0,
              opinionSummary: revealed.opinionSummary,
            },
          ],
        });
        await expect(new PresentationReportWorker(f.sessions, 60_000).runOnce()).resolves.toBe(
          "completed",
        );
        const ready = await f.service.getReport(f.workspaceId, f.sessionId, true, true, true);
        expect(ready).toMatchObject({ reportStatus: "ready", report: pending.report });
        expect(() => presentationReportRestProjection(ready.report!, true)).toThrow(
          "includeOpinionResults=true",
        );
        expect(projectPresentationSummary(ready.report!).questions[0]).toMatchObject({
          suppression: "insufficient_sample",
          accuracy: null,
          results: [],
        });
        const fiveResponses = Array.from({ length: 5 }, (_, index) => ({
          ...saved[index % 2]!,
          id: randomUUID(),
          participantId: randomUUID(),
        }));
        const fiveSummary = presentationOpinionSummary(f.block, fiveResponses);
        const enough = {
          ...ready.report!,
          participantCount: 5,
          responseCount: 5,
          evidence: ready.report!.evidence.map((evidence) =>
            evidence.kind === "question"
              ? { ...evidence, respondents: 5, opinionSummary: fiveSummary }
              : evidence,
          ),
        };
        expect(projectPresentationSummary(enough).questions[0]?.results).toHaveLength(6);
      },
    );
  }
});
