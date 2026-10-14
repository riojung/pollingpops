import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  PresentationCompanionSnapshotSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  QuizContentSchema,
  QuizDraftSchema,
  type PresentationCompanionCommand,
  type PresentationCommand,
  type PresentationPublishedQuestionSelection,
  type QuizDraft,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { presentationLiveInsertionEnabled } from "../src/presentation-live-insertion.js";
import {
  presentationCanInsertPublishedQuestion,
  presentationPublishedQuestionInsertionTransition,
} from "../src/presentation-live-published-questions.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import { PresentationSessionService } from "../src/presentation-session-service.js";
import { StorageService } from "../src/storage.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
type InsertCommand = Extract<PresentationCompanionCommand, { action: "insert_published_question" }>;
const PriorQuickCheckReaderSchema = z
  .object(PresentationCompanionSnapshotSchema.shape)
  .omit({ canInsertPublishedQuestion: true })
  .strict();
const BaseReaderSchema = PriorQuickCheckReaderSchema.omit({ canInsertQuickCheck: true }).strict();
function sourceQuestion(prompt = "Which synthetic option is correct?") {
  return {
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["synthetic.check"],
    linkedRecheckQuestionId: null as string | null,
    choices: [
      { id: randomUUID(), label: "Option A", isCorrect: true, feedback: "Hidden source feedback" },
      {
        id: randomUUID(),
        label: "Option B",
        isCorrect: false,
        misconceptionKey: "hidden.source.misconception",
      },
    ],
    timeLimitSeconds: 19,
    basePoints: 100,
    explanation: "Hidden source scoring rationale",
    mediaId: null as string | null,
    mediaAlt: null as string | null,
  };
}
function preparedContent(linkedPurpose?: "diagnostic" | "practice") {
  const slide = {
    id: randomUUID(),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: "title",
        role: "title" as const,
        text: "Prepared slide",
        region: "top_center" as const,
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Facilitator-only note",
  };
  const standalone = {
    id: randomUUID(),
    kind: "question" as const,
    question: sourceQuestion("Prepared standalone checkpoint"),
  };
  const recheck = {
    id: randomUUID(),
    kind: "question" as const,
    question: { ...sourceQuestion("Prepared recheck"), delivery: "recheck" as const },
  };
  const source = {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      ...sourceQuestion("Prepared linked source"),
      purpose: linkedPurpose ?? "diagnostic",
      linkedRecheckQuestionId: recheck.question.id,
    },
  };
  return PresentationContentSchema.parse({
    title: "Prepared deck",
    description: "",
    schemaVersion: 2,
    blocks: linkedPurpose ? [source, slide, standalone, recheck] : [slide, standalone],
  });
}
async function fixture(
  options: { timeMode?: "timed" | "flex"; linkedPurpose?: "diagnostic" | "practice" } = {},
) {
  const workspaceId = randomUUID(),
    userId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "team" });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
    FEATURE_PRESENTATIONS: "true",
    FEATURE_PRESENTATION_REALTIME: "true",
    FEATURE_PRESENTATION_COMPANION: "true",
    FEATURE_RECOVERY_PACKS: "false",
    FEATURE_RECOVERY_PACK_LIVE_CARDS: "false",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    LOG_LEVEL: "silent",
  });
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(built.app);
  const presentations = createPresentationRepository(repository),
    service = built.presentationService,
    sessions = built.presentationSessions;
  const content = preparedContent(options.linkedPurpose),
    draft = PresentationDraftSchema.parse(content),
    now = new Date();
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: 2,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  const presentationVersion = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId: presentation.id,
      version: 1,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const hosted = await service.createSession({
    workspaceId,
    userId,
    presentationId: presentation.id,
    timeMode: options.timeMode,
    requestId: randomUUID(),
  });
  const sessionId = hosted.snapshot.sessionId,
    pass = await service.createCompanionPass({
      workspaceId,
      userId,
      sessionId,
      requestId: randomUUID(),
    });
  const joined = await service.join(hosted.snapshot.code, "Synthetic learner");
  async function publishRound(
    questions: QuizDraft["questions"] = [sourceQuestion()],
    title = "Published source Round",
    workspace = workspaceId,
  ) {
    const draft = QuizDraftSchema.parse({ title, questions });
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: workspace,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      currentVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const content = QuizContentSchema.parse(draft);
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: workspace,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: new Date(),
    });
    return { quiz, version };
  }
  const source = await publishRound();
  const selection: PresentationPublishedQuestionSelection = {
    sourceQuizVersionId: source.version.id,
    sourceQuestionId: source.version.content.questions[0]!.id,
    contentHash: source.version.contentHash,
  };
  const current = async () => (await sessions.getSessionById(sessionId))!;
  const snapshot = () => service.getCompanionSnapshot(sessionId, pass.companionToken);
  const command = (expectedRevision = 0, publishedQuestion = selection): InsertCommand => ({
    sessionId,
    companionToken: pass.companionToken,
    commandId: randomUUID(),
    expectedRevision,
    action: "insert_published_question",
    publishedQuestion,
  });
  async function advance() {
    return service.companionCommand({
      sessionId,
      companionToken: pass.companionToken,
      commandId: randomUUID(),
      expectedRevision: (await current()).revision,
      action: "advance",
    });
  }
  function restartService() {
    return new PresentationSessionService({
      repository,
      presentations,
      sessions: createPresentationSessionRepository(repository),
      config,
      storage: new StorageService(config, null),
      publishedQuestionLiveInsertionEnabled: (workspace) =>
        presentationLiveInsertionEnabled(config, workspace),
    });
  }
  return {
    ...built,
    repository,
    config,
    presentations,
    presentation,
    presentationVersion,
    content,
    service,
    sessions,
    workspaceId,
    userId,
    hosted,
    pass,
    joined,
    sessionId,
    source,
    selection,
    current,
    snapshot,
    command,
    advance,
    publishRound,
    restartService,
  };
}
async function expectNoMutation(
  f: Awaited<ReturnType<typeof fixture>>,
  command: InsertCommand,
  code: string,
) {
  const before = await f.current(),
    timeline = await f.sessions.listTimeline(f.sessionId);
  await expect(f.service.companionCommand(command)).rejects.toMatchObject({ code });
  expect(await f.current()).toEqual(before);
  expect(await f.sessions.listTimeline(f.sessionId)).toEqual(timeline);
  expect(
    await f.sessions.findCommandReceipt(f.workspaceId, f.sessionId, command.commandId),
  ).toBeNull();
}
function expectSafe(value: unknown) {
  const text = JSON.stringify(value);
  for (const privateText of [
    "Hidden source feedback",
    "hidden.source.misconception",
    "Hidden source scoring rationale",
    "Facilitator-only note",
  ])
    expect(text).not.toContain(privateText);
  for (const field of [
    "isCorrect",
    "correctChoiceIds",
    "correctValue",
    "feedback",
    "explanation",
    "recoveryPackSource",
    "livePublishedQuestions",
    "provenance",
  ])
    expect(text).not.toContain(`"${field}"`);
}
describe("Companion standalone published Round questions", () => {
  it("excludes multiple-selection opinion polls from the catalog and rejects insertion without mutation", async () => {
    const f = await fixture();
    const question = sourceQuestion("Multiple opinion priorities");
    const source = await f.publishRound([
      {
        ...question,
        type: "poll",
        purpose: "opinion",
        basePoints: 0,
        conceptKeys: [],
        explanation: "",
        maxSelections: 2,
        choices: question.choices.map(({ id, label }) => ({ id, label, isCorrect: false })),
      },
    ]);
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${f.sessionId}/companion-published-questions`,
      headers: { authorization: `Bearer ${f.pass.companionToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().questions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceQuizVersionId: source.version.id })]),
    );
    await expectNoMutation(
      f,
      f.command(0, {
        sourceQuizVersionId: source.version.id,
        sourceQuestionId: source.version.content.questions[0]!.id,
        contentHash: source.version.contentHash,
      }),
      "VALIDATION_ERROR",
    );
    const live = await f.current();
    expect(() =>
      presentationPublishedQuestionInsertionTransition(
        live,
        source.version,
        f.command(0, {
          sourceQuizVersionId: source.version.id,
          sourceQuestionId: source.version.content.questions[0]!.id,
          contentHash: source.version.contentHash,
        }),
      ),
    ).toThrow("live Rounds only");
  });

  it.each(["timed", "flex"] as const)(
    "freezes one standalone source with %s timing and ordinary scored report evidence",
    async (timeMode) => {
      const f = await fixture({ timeMode });
      expect((await f.current()).recoveryPackCardsEnabled).toBe(false);
      expect(await f.snapshot()).toMatchObject({
        canInsertPublishedQuestion: true,
        canInsertRecoveryPack: false,
      });
      const command = f.command(),
        audit = vi
          .spyOn(f.repository, "recordAudit")
          .mockRejectedValueOnce(new Error("Audit unavailable"));
      const opened = await f.service.companionCommand(command);
      expectSafe(opened);
      expect(opened).toMatchObject({
        projection: "companion",
        phase: "question_open",
        revision: 1,
        blockCount: 3,
        canInsertPublishedQuestion: false,
      });
      const record = await f.current(),
        block = record.content.blocks[0]!;
      if (block.kind !== "question" || block.question.type !== "single_select")
        throw new Error("Expected copied choice checkpoint");
      expect(block.provenance).toEqual({
        sourceQuizVersionId: f.source.version.id,
        sourceQuestionId: f.selection.sourceQuestionId,
      });
      expect(block.question.id).not.toBe(f.selection.sourceQuestionId);
      expect(block.question.choices.map((choice) => choice.id)).not.toEqual(
        f.source.version.content.questions[0]!.type === "single_select"
          ? f.source.version.content.questions[0]!.choices.map((choice) => choice.id)
          : [],
      );
      expect(block.question.choices.map(({ label, isCorrect }) => ({ label, isCorrect }))).toEqual([
        { label: "Option A", isCorrect: true },
        { label: "Option B", isCorrect: false },
      ]);
      expect(record.content.livePublishedQuestions).toEqual([
        {
          commandId: command.commandId,
          blockId: block.id,
          sourceQuizId: f.source.quiz.id,
          sourceQuizVersionId: f.source.version.id,
          sourceQuizVersion: 1,
          sourceQuestionId: f.selection.sourceQuestionId,
          contentHash: f.selection.contentHash,
        },
      ]);
      expect(record.content.blocks.slice(1)).toEqual(f.content.blocks);
      expect(record.questionClosesAt?.getTime() ?? null).toBe(
        timeMode === "timed" ? record.questionOpenedAt!.getTime() + 19_000 : null,
      );
      expect(JSON.stringify(audit.mock.calls)).not.toContain(block.question.prompt);
      expect(
        (await f.presentations.getPresentationVersion(f.workspaceId, f.presentationVersion.id))
          ?.content,
      ).toEqual(f.content);
      expect(
        (await f.repository.getQuizVersion(f.workspaceId, f.source.version.id))?.content,
      ).toEqual(f.source.version.content);
      const ack = await f.service.submitResponse({
        sessionId: f.sessionId,
        participantToken: f.joined.participantToken,
        blockId: block.id,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        response: { choiceIds: [block.question.choices[0]!.id] },
      });
      expect(ack.accepted).toBe(true);
      const storedResponse = (await f.sessions.listResponses(f.sessionId))[0]!;
      expect(storedResponse.correct).toBe(true);
      expect(storedResponse.score).toBeGreaterThan(0);
      expect(storedResponse.score).toBeLessThanOrEqual(100);
      await f.advance();
      expectSafe(await f.snapshot());
      expect((await f.snapshot()).resultSummary).toMatchObject({
        blockId: block.id,
        responseCount: 1,
      });
      expect(
        (await f.restartService().getCompanionSnapshot(f.sessionId, f.pass.companionToken))
          .currentBlock,
      ).toEqual((await f.snapshot()).currentBlock);
      while ((await f.current()).status === "active") await f.advance();
      expect(await new PresentationReportWorker(f.sessions, 60_000).runOnce()).toBe("completed");
      const report = (await f.restartService().getReport(f.workspaceId, f.sessionId)).report!;
      expect(report.schemaVersion).toBe(1);
      expect(report.evidence[0]).toMatchObject({
        questionId: block.question.id,
        respondents: 1,
        correct: 1,
        accuracyPercent: 100,
        totalScore: storedResponse.score,
      });
      expect(JSON.stringify(report)).not.toContain("livePublishedQuestions");
      expect(JSON.stringify(report)).not.toContain(f.source.version.id);
    },
  );

  it("catalogues bounded participant-safe current published metadata, search and tenant/source eligibility", async () => {
    const f = await fixture();
    await f.publishRound([sourceQuestion("Other tenant prompt")], "Other tenant", randomUUID());
    await f.repository.createQuiz({
      ...f.source.quiz,
      id: randomUUID(),
      title: "Unpublished",
      currentVersionId: null,
    });
    const mediaId = randomUUID();
    await f.repository.createMediaAsset({
      id: mediaId,
      workspaceId: f.workspaceId,
      objectKey: `media/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Synthetic diagram",
      createdAt: new Date(),
    });
    const media = { ...sourceQuestion("Media question"), mediaId, mediaAlt: "Synthetic diagram" };
    const recheck = { ...sourceQuestion("Linked recheck"), delivery: "recheck" as const };
    const linked = { ...sourceQuestion("Linked source"), linkedRecheckQuestionId: recheck.id };
    const pack = {
      ...sourceQuestion("Pack source"),
      recoveryPackSource: {
        artifactType: "recovery_pack" as const,
        packId: randomUUID(),
        packVersionId: randomUUID(),
        packVersion: 1,
        sourceItemId: randomUUID(),
        role: "diagnostic" as const,
        contentHash: "a".repeat(64),
      },
    };
    const excluded = await f.publishRound([media, linked, recheck, pack], "Excluded source");
    const base = `/v1/presentation-sessions/${f.sessionId}/companion-published-questions`,
      headers = { authorization: `Bearer ${f.pass.companionToken}` };
    const response = await f.app.inject({ method: "GET", url: base, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expectSafe(response.json());
    expect(response.json()).toEqual({
      questions: [
        {
          ...f.selection,
          sourceQuizId: f.source.quiz.id,
          sourceQuizVersion: 1,
          title: f.source.version.content.title,
          prompt: f.source.version.content.questions[0]!.prompt,
          type: "single_select",
        },
      ],
      hasMore: false,
    });
    expect(JSON.stringify(response.json())).not.toContain('"choices"');
    for (const question of excluded.version.content.questions)
      await expectNoMutation(
        f,
        f.command(0, {
          sourceQuizVersionId: excluded.version.id,
          sourceQuestionId: question.id,
          contentHash: excluded.version.contentHash,
        }),
        "VALIDATION_ERROR",
      );
    const referenced = {
      ...f.source.version,
      content: {
        ...f.source.version.content,
        questions: [
          f.source.version.content.questions[0]!,
          { ...sourceQuestion(), linkedRecheckQuestionId: f.selection.sourceQuestionId },
        ],
      },
    };
    const record = await f.current();
    expect(() =>
      presentationPublishedQuestionInsertionTransition(record, referenced, f.command()),
    ).toThrow();
    for (const token of [undefined, f.hosted.controlToken, f.joined.participantToken])
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: base,
            ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
          })
        ).statusCode,
      ).toBe(401);
    for (const query of ["search=" + "x".repeat(101), "search=a&extra=true"])
      expect(
        (await f.app.inject({ method: "GET", url: `${base}?${query}`, headers })).statusCode,
      ).toBe(400);
    await f.publishRound(
      Array.from({ length: 105 }, (_, index) => sourceQuestion(`Bounded prompt ${index}`)),
      "Bounded Round",
    );
    const bounded = (
      await f.app.inject({ method: "GET", url: `${base}?search=Bounded`, headers })
    ).json();
    expect(bounded.questions).toHaveLength(100);
    expect(bounded.hasMore).toBe(true);
    expect(
      (await f.app.inject({ method: "GET", url: `${base}?search=DoesNotExist`, headers })).json(),
    ).toEqual({ questions: [], hasMore: false });
  });

  it("allows explicit retained published versions, freezing through republish, archive/deletion and rollback retries", async () => {
    const f = await fixture(),
      original = f.source.version.content.questions[0]!;
    const edited = QuizDraftSchema.parse({
      ...f.source.quiz.draft,
      title: "Republished title",
      questions: [{ ...original, prompt: "Republished prompt" }],
    });
    await f.repository.updateQuiz(f.workspaceId, f.source.quiz.id, edited);
    const current = await f.repository.getQuiz(f.workspaceId, f.source.quiz.id);
    const published = QuizContentSchema.parse(edited);
    const version2 = await f.repository.publishQuiz({
      ...f.source.version,
      id: randomUUID(),
      version: 2,
      content: published,
      contentHash: createHash("sha256").update(JSON.stringify(published)).digest("hex"),
      sourceDraftRevision: current!.draftRevision,
      publishedAt: new Date(),
    });
    const catalog = await f.service.getCompanionPublishedQuestions(
      f.sessionId,
      f.pass.companionToken,
    );
    expect(catalog.questions[0]).toMatchObject({
      sourceQuizVersionId: version2.id,
      title: "Republished title",
      prompt: "Republished prompt",
    });
    const command = f.command();
    await f.service.companionCommand(command);
    const frozen = await f.current();
    expect(frozen.content.blocks[0]).toMatchObject({ question: { prompt: original.prompt } });
    await f.advance();
    await f.repository.archiveQuiz(f.workspaceId, f.source.quiz.id, true);
    await expectNoMutation(f, f.command(2), "NOT_FOUND");
    expect(await f.service.companionCommand(command)).toMatchObject({
      phase: "question_reveal",
      revision: 2,
    });
    await f.repository.deleteQuiz(f.workspaceId, f.source.quiz.id);
    f.config.FEATURE_PRESENTATION_COMPANION = false;
    f.config.FEATURE_PRESENTATION_REALTIME = false;
    f.config.FEATURE_PRESENTATIONS = false;
    f.config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST = [];
    expect(await f.restartService().companionCommand(command)).toMatchObject({
      phase: "question_reveal",
      revision: 2,
    });
    while ((await f.current()).status === "active") await f.advance();
    expect(await f.restartService().companionCommand(command)).toMatchObject({
      phase: "finished",
      revision: 6,
    });
    expect((await f.current()).content).toEqual(frozen.content);
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(6);
  });

  it.each(["archive", "delete"])(
    "rejects new insertion when source %s wins after service validation without writing a receipt",
    async (mutation) => {
      const f = await fixture();
      const transition = f.sessions.transitionSessionCommand.bind(f.sessions);
      vi.spyOn(f.sessions, "transitionSessionCommand").mockImplementationOnce(async (input) => {
        await f.repository.archiveQuiz(f.workspaceId, f.source.quiz.id, true);
        if (mutation === "delete")
          expect(await f.repository.deleteQuiz(f.workspaceId, f.source.quiz.id)).toBe("deleted");
        return transition(input);
      });
      await expectNoMutation(f, f.command(), "NOT_FOUND");
    },
  );

  it("recovers a concurrently accepted repository receipt before checking a deleted source", async () => {
    const f = await fixture();
    const transition = f.sessions.transitionSessionCommand.bind(f.sessions);
    vi.spyOn(f.sessions, "transitionSessionCommand").mockImplementationOnce(async (input) => {
      expect(await transition(input)).toMatchObject({ status: "accepted" });
      await f.repository.archiveQuiz(f.workspaceId, f.source.quiz.id, true);
      expect(await f.repository.deleteQuiz(f.workspaceId, f.source.quiz.id)).toBe("deleted");
      return transition(input);
    });
    expect(await f.service.companionCommand(f.command())).toMatchObject({
      phase: "question_open",
      revision: 1,
    });
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(1);
    expect((await f.current()).content.livePublishedQuestions).toHaveLength(1);
  });

  it("recovers an exact receipt committed after preflight but before source lookup", async () => {
    const f = await fixture();
    const command = f.command();
    const current = await f.current();
    const findReceipt = f.sessions.findCommandReceipt.bind(f.sessions);
    vi.spyOn(f.sessions, "findCommandReceipt").mockImplementationOnce(async (...args) => {
      expect(await findReceipt(...args)).toBeNull();
      await f.service.companionCommand(command);
      await f.repository.archiveQuiz(f.workspaceId, f.source.quiz.id, true);
      expect(await f.repository.deleteQuiz(f.workspaceId, f.source.quiz.id)).toBe("deleted");
      return null;
    });
    expect(await f.service.companionCommand(command)).toMatchObject({
      phase: "question_open",
      revision: current.revision + 1,
    });
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(1);
  });

  it("fences roles, selectors, stale/CAS races and changed or legacy intent before writes", async () => {
    const f = await fixture(),
      other = await fixture();
    for (const token of [
      f.hosted.controlToken,
      f.joined.participantToken,
      other.pass.companionToken,
    ])
      await expectNoMutation(f, { ...f.command(), companionToken: token }, "UNAUTHORIZED");
    await expectNoMutation(f, f.command(0, other.selection), "NOT_FOUND");
    await expectNoMutation(f, f.command(1), "STALE_SESSION");
    await expectNoMutation(
      f,
      f.command(0, { ...f.selection, contentHash: "c".repeat(64) }),
      "VALIDATION_ERROR",
    );
    await expectNoMutation(
      f,
      f.command(0, { ...f.selection, sourceQuestionId: randomUUID() }),
      "VALIDATION_ERROR",
    );
    await expect(
      f.service.command({
        sessionId: f.sessionId,
        controlToken: f.hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "insert_published_question",
        publishedQuestion: f.selection,
      } as unknown as PresentationCommand),
    ).rejects.toThrow();
    const commands = [f.command(), f.command()],
      race = await Promise.allSettled(
        commands.map((command) => f.service.companionCommand(command)),
      );
    expect(race.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(race.find((item) => item.status === "rejected")).toMatchObject({
      reason: { code: "STALE_SESSION" },
    });
    const accepted = commands[race[0]!.status === "fulfilled" ? 0 : 1]!;
    for (const selection of [
      { ...f.selection, contentHash: "d".repeat(64) },
      { ...f.selection, sourceQuestionId: randomUUID() },
      { ...f.selection, sourceQuizVersionId: randomUUID() },
    ])
      await expect(
        f.service.companionCommand({ ...accepted, publishedQuestion: selection }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await f.service.companionCommand(accepted)).toMatchObject({ revision: 1 });
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(1);
    await f.advance();
    expect((await f.snapshot()).canInsertPublishedQuestion).toBe(true);
    await f.service.companionCommand(f.command(2));
    const copies = (await f.current()).content.livePublishedQuestions!;
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((copy) => copy.blockId)).size).toBe(2);
    expect(await f.service.companionCommand(accepted)).toMatchObject({ revision: 3 });
    const legacy = await fixture(),
      key = legacy.command();
    await legacy.sessions.transitionSessionCommand({
      workspaceId: legacy.workspaceId,
      sessionId: legacy.sessionId,
      commandId: key.commandId,
      expectedRevision: 0,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId: legacy.content.blocks[0]!.id },
    });
    await expect(legacy.service.companionCommand(key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect((await legacy.current()).content.livePublishedQuestions).toBeUndefined();
  });

  it("negotiates new capability independently while default GET and ACK remain strict-reader compatible", async () => {
    const f = await fixture(),
      base = `/v1/presentation-sessions/${f.sessionId}`,
      headers = { authorization: `Bearer ${f.pass.companionToken}` };
    const read = async (query = "") =>
      (await f.app.inject({ method: "GET", url: `${base}/companion${query}`, headers })).json()
        .snapshot;
    const legacy = await read();
    expect(() => BaseReaderSchema.parse(legacy)).not.toThrow();
    expect(legacy).not.toHaveProperty("canInsertPublishedQuestion");
    expect(() => BaseReaderSchema.parse({ ...legacy, arbitraryInternalData: true })).toThrow();
    const quickOnly = await read("?includeQuickChecks=true");
    expect(() => PriorQuickCheckReaderSchema.parse(quickOnly)).not.toThrow();
    expect(quickOnly).not.toHaveProperty("canInsertPublishedQuestion");
    const publishedOnly = await read("?includePublishedQuestions=true");
    expect(publishedOnly).toHaveProperty("canInsertPublishedQuestion", true);
    expect(publishedOnly).not.toHaveProperty("canInsertQuickCheck");
    const both = await read("?includePublishedQuestions=true&includeQuickChecks=true");
    expect(both).toMatchObject({ canInsertPublishedQuestion: true, canInsertQuickCheck: true });
    const command = f.command(),
      inserted = await f.app.inject({
        method: "POST",
        url: `${base}/companion-command?includePublishedQuestions=true`,
        payload: command,
      });
    expect(inserted.statusCode).toBe(200);
    expect(inserted.json().snapshot).toMatchObject({
      canInsertPublishedQuestion: false,
      phase: "question_open",
    });
    expectSafe(inserted.json());
    const retry = await f.app.inject({
      method: "POST",
      url: `${base}/companion-command`,
      payload: command,
    });
    expect(() => BaseReaderSchema.parse(retry.json().snapshot)).not.toThrow();
    const advance = await f.app.inject({
      method: "POST",
      url: `${base}/companion-command`,
      payload: {
        sessionId: f.sessionId,
        companionToken: f.pass.companionToken,
        commandId: randomUUID(),
        expectedRevision: 1,
        action: "advance",
      },
    });
    expect(() => BaseReaderSchema.parse(advance.json().snapshot)).not.toThrow();
    for (const query of [
      "includePublishedQuestions=false",
      "includePublishedQuestions=true&extra=true",
    ])
      expect(
        (await f.app.inject({ method: "GET", url: `${base}/companion?${query}`, headers }))
          .statusCode,
      ).toBe(400);
    f.config.FEATURE_PRESENTATION_REALTIME = false;
    expect((await f.snapshot()).canInsertPublishedQuestion).toBe(false);
    await expectNoMutation(f, f.command(2), "NOT_FOUND");
  });

  it.each(["diagnostic", "practice"] as const)(
    "does not split pending linked %s flow at source/content/standalone boundaries",
    async (linkedPurpose) => {
      const f = await fixture({ linkedPurpose }),
        record = await f.current();
      for (const [phase, index, allowed] of [
        ["lobby", -1, true],
        ["question_open", 0, false],
        ["question_reveal", 0, false],
        ["content", 1, false],
        ["question_reveal", 2, false],
        ["question_reveal", 3, true],
        ["intervention", 3, false],
        ["finished", 3, false],
      ] as const)
        expect(
          presentationCanInsertPublishedQuestion({
            ...record,
            phase,
            currentBlockIndex: index,
            status: phase === "finished" ? "finished" : "active",
          }),
        ).toBe(allowed);
      await f.advance();
      await f.advance();
      await expectNoMutation(f, f.command(2), "PHASE_CLOSED");
      await f.advance();
      await f.advance();
      await expectNoMutation(f, f.command(4), "PHASE_CLOSED");
      await f.advance();
      await f.advance();
      await expectNoMutation(f, f.command(6), "PHASE_CLOSED");
      await f.advance();
      await f.advance();
      expect(await f.service.companionCommand(f.command(8))).toMatchObject({
        phase: "question_open",
        currentBlockIndex: 4,
      });
    },
  );

  it("bounds live blocks and encoded content before committing copied source data", async () => {
    const f = await fixture();
    const slide = f.content.blocks.find((block) => block.kind === "content")!;
    const question = f.content.blocks.find((block) => block.kind === "question")!;
    const almostFull = PresentationContentSchema.parse({
      ...f.content,
      blocks: [...Array.from({ length: 98 }, () => ({ ...slide, id: randomUUID() })), question],
    });
    await f.sessions.transitionSession({
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      expectedRevision: 0,
      content: almostFull,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId: almostFull.blocks[0]!.id },
    });
    await f.service.companionCommand(f.command(1));
    expect((await f.current()).content.blocks).toHaveLength(100);
    await f.advance();
    expect((await f.snapshot()).canInsertPublishedQuestion).toBe(false);
    await expectNoMutation(f, f.command(3), "PHASE_CLOSED");
    const large = await fixture();
    const regions = [
      "top_left",
      "top_right",
      "middle_left",
      "middle_center",
      "middle_right",
      "bottom_left",
      "bottom_center",
    ] as const;
    const content = PresentationContentSchema.parse({
      ...large.content,
      blocks: [
        ...Array.from({ length: 45 }, () => ({
          ...slide,
          id: randomUUID(),
          textElements: [
            slide.textElements[0],
            ...regions.map((region, index) => ({
              id: `body-${index}`,
              role: "body",
              text: "界".repeat(4_000),
              region,
              order: 0,
            })),
          ],
        })),
        question,
      ],
    });
    await large.sessions.transitionSession({
      workspaceId: large.workspaceId,
      sessionId: large.sessionId,
      expectedRevision: 0,
      content,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId: content.blocks[0]!.id },
    });
    await expectNoMutation(large, large.command(1), "VALIDATION_ERROR");
  });
});
