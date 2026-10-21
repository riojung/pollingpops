import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  PresentationContentSchema,
  PresentationCompanionSnapshotSchema,
  PresentationDraftSchema,
  PresentationReportV1Schema,
  PresentationReportV2Schema,
  PresentationReportV3Schema,
  type PresentationCompanionCommand,
  type PresentationCommand,
  type PresentationContent,
  type PresentationQuickCheckInput,
} from "@openround/contracts";
import { MemoryRepository, createPresentationRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { presentationCanInsertQuickCheck } from "../src/presentation-live-quick-checks.js";
import {
  generatePresentationReport,
  presentationReportRestProjection,
} from "../src/presentation-reporting.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import { presentationCommandRequestHash } from "../src/presentation-recovery-pack-cards.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const quickCheck: PresentationQuickCheckInput = {
  prompt: "Which pace works best?",
  choices: ["More time", "Ready to continue"],
  timeLimitSeconds: 23,
};
type QuickCommand = Extract<PresentationCompanionCommand, { action: "insert_quick_check" }>;
// Reconstruct the previous strict field set without carrying new cross-field refinements.
const LegacyCompanionSnapshotSchema = z
  .object(PresentationCompanionSnapshotSchema.shape)
  .omit({ canInsertQuickCheck: true })
  .strict();

function publishedContent(linkedPurpose?: "diagnostic" | "practice"): PresentationContent {
  const question = (prompt: string, delivery: "main" | "recheck" = "main") => ({
    id: randomUUID(),
    type: "numeric" as const,
    prompt,
    correctValue: "7",
    tolerance: "0",
    unit: null,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery,
    conceptKeys: [],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "A synthetic scoring rationale",
    mediaId: null,
    mediaAlt: null,
  });
  const slide = {
    id: randomUUID(),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: "title",
        role: "title" as const,
        text: "Continue the prepared deck",
        region: "top_center" as const,
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "A facilitator-only note",
  };
  const standalone = {
    id: randomUUID(),
    kind: "question" as const,
    question: question("Prepared standalone checkpoint"),
  };
  const recheck = {
    id: randomUUID(),
    kind: "question" as const,
    question: question("Prepared linked recheck", "recheck"),
  };
  const source = {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      ...question("Prepared linked source"),
      purpose: linkedPurpose ?? "diagnostic",
      linkedRecheckQuestionId: recheck.question.id,
    },
  };
  return PresentationContentSchema.parse({
    title: "Prepared presentation",
    description: "",
    schemaVersion: 2,
    blocks: linkedPurpose ? [source, slide, standalone, recheck] : [slide, standalone],
  });
}

async function fixture(
  options: { timeMode?: "timed" | "flex"; linkedPurpose?: "diagnostic" | "practice" } = {},
) {
  const workspaceId = randomUUID();
  const userId = randomUUID();
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
    FEATURE_LIVE_FLEX_MODE: "true",
    FEATURE_PRESENTATION_COMPANION: "true",
    FEATURE_RECOVERY_PACKS: "false",
    FEATURE_RECOVERY_PACK_LIVE_CARDS: "false",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    LOG_LEVEL: "silent",
  });
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(built.app);
  const presentations = createPresentationRepository(repository);
  const content = publishedContent(options.linkedPurpose);
  const draft = PresentationDraftSchema.parse(content);
  const now = new Date();
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
  const version = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId: presentation.id,
      version: 1,
      content,
      contentSchemaVersion: 2,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const service = built.presentationService;
  const sessions = built.presentationSessions;
  const hosted = await service.createSession({
    workspaceId,
    userId,
    presentationId: presentation.id,
    timeMode: options.timeMode,
    requestId: randomUUID(),
  });
  const sessionId = hosted.snapshot.sessionId;
  const pass = await service.createCompanionPass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  const joined = await service.join(hosted.snapshot.code, "Synthetic learner");
  const current = async () => (await sessions.getSessionById(sessionId))!;
  const snapshot = () => service.getCompanionSnapshot(sessionId, pass.companionToken);
  const command = (expectedRevision = 0, input = quickCheck): QuickCommand => ({
    sessionId,
    companionToken: pass.companionToken,
    commandId: randomUUID(),
    expectedRevision,
    action: "insert_quick_check",
    quickCheck: input,
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
  async function answer(response: { choiceIds?: string[]; numericValue?: string }) {
    const record = await current();
    return service.submitResponse({
      sessionId,
      participantToken: joined.participantToken,
      blockId: record.content.blocks[record.currentBlockIndex]!.id,
      expectedRevision: record.revision,
      idempotencyKey: randomUUID(),
      response,
    });
  }
  return {
    ...built,
    repository,
    config,
    presentations,
    presentation,
    version,
    content,
    service,
    sessions,
    workspaceId,
    userId,
    hosted,
    pass,
    joined,
    sessionId,
    current,
    snapshot,
    command,
    advance,
    answer,
  };
}

async function expectNoMutation(
  f: Awaited<ReturnType<typeof fixture>>,
  command: QuickCommand,
  code: string,
) {
  const before = await f.current();
  const timeline = await f.sessions.listTimeline(f.sessionId);
  await expect(f.service.companionCommand(command)).rejects.toMatchObject({ code });
  expect(await f.current()).toEqual(before);
  expect(await f.sessions.listTimeline(f.sessionId)).toEqual(timeline);
  expect(
    await f.sessions.findCommandReceipt(f.workspaceId, f.sessionId, command.commandId),
  ).toBeNull();
}

describe("Companion session-only Quick Checks", () => {
  it.each(["timed", "flex"] as const)(
    "inserts a plain unscored poll with %s timing without Pack eligibility",
    async (timeMode) => {
      const f = await fixture({ timeMode });
      expect((await f.current()).recoveryPackCardsEnabled).toBe(false);
      expect(await f.snapshot()).toMatchObject({
        canInsertQuickCheck: true,
        canInsertRecoveryPack: false,
      });
      const input = {
        prompt: `  ${quickCheck.prompt}  `,
        choices: quickCheck.choices.map((label) => ` ${label} `),
        timeLimitSeconds: 23,
      };
      const command = f.command(0, input);
      const audit = vi
        .spyOn(f.repository, "recordAudit")
        .mockRejectedValueOnce(new Error("Audit unavailable"));
      const opened = await f.service.companionCommand(command);
      expect(opened).toMatchObject({
        projection: "companion",
        phase: "question_open",
        revision: 1,
        blockCount: 3,
        currentBlockIndex: 0,
        canInsertQuickCheck: false,
        resultSummary: null,
      });
      const record = await f.current();
      const block = record.content.blocks[0]!;
      expect(block).toMatchObject({
        kind: "question",
        question: {
          type: "poll",
          prompt: quickCheck.prompt,
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 23,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
          choices: quickCheck.choices.map((label) => ({ label, isCorrect: false })),
        },
      });
      expect(record.content.liveQuickCheck).toEqual({
        commandId: command.commandId,
        blockId: block.id,
      });
      expect(record.content.blocks.slice(1)).toEqual(f.content.blocks);
      expect(record.questionOpenedAt).not.toBeNull();
      expect(record.questionClosesAt?.getTime() ?? null).toBe(
        timeMode === "timed" ? record.questionOpenedAt!.getTime() + 23_000 : null,
      );
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "presentation.session.quick_check.insert",
          metadata: { blockId: block.id, choiceCount: 2 },
        }),
      );
      expect(JSON.stringify(audit.mock.calls)).not.toContain(quickCheck.prompt);
      expect(
        (await f.presentations.getPresentationVersion(f.workspaceId, f.version.id))?.content,
      ).toEqual(f.content);
      expect(
        (await f.presentations.getPresentation(f.workspaceId, f.presentation.id))?.draft,
      ).toEqual(f.presentation.draft);
      expect(opened).not.toHaveProperty("liveQuickCheck");
      expect(JSON.stringify(opened)).not.toContain('"isCorrect"');
      expect(JSON.stringify(opened)).not.toContain('"correctChoiceIds"');
      if (block.kind !== "question" || block.question.type !== "poll")
        throw new Error("Expected poll");
      const receipt = await f.answer({ choiceIds: [block.question.choices[0]!.id] });
      expect(receipt.accepted).toBe(true);
      expect((await f.sessions.listResponses(f.sessionId))[0]).toMatchObject({
        correct: null,
        score: 0,
      });
      expect((await f.snapshot()).resultSummary).toBeNull();
      await f.advance();
      const revealed = await f.snapshot();
      expect(revealed.resultSummary).toEqual({
        blockId: block.id,
        responseCount: 1,
        choiceCounts: block.question.choices.map((choice, index) => ({
          choiceId: choice.id,
          count: index === 0 ? 1 : 0,
        })),
      });
      expect(JSON.stringify(revealed)).not.toContain("Synthetic learner");
      expect(JSON.stringify(revealed)).not.toContain(f.joined.participantToken);
      expect(
        (await f.service.getParticipantSnapshot(f.sessionId, f.joined.participantToken)).snapshot
          .responseResult,
      ).toEqual({ correct: null, score: 0 });
    },
  );

  it("recovers canonical exact intent before gates, one-check limit, phase or stale revision through finish", async () => {
    const f = await fixture();
    const command = f.command();
    expect(presentationCommandRequestHash(command)).toBe(
      presentationCommandRequestHash({
        ...command,
        quickCheck: {
          ...quickCheck,
          prompt: ` ${quickCheck.prompt} `,
          choices: quickCheck.choices.map((label) => ` ${label} `),
        },
      }),
    );
    await f.service.companionCommand(command);
    await f.advance();
    await expectNoMutation(f, f.command(2), "PHASE_CLOSED");
    for (const changed of [
      { ...quickCheck, prompt: "Another intent" },
      { ...quickCheck, choices: [...quickCheck.choices].reverse() },
      { ...quickCheck, timeLimitSeconds: 24 },
    ])
      await expect(
        f.service.companionCommand({ ...command, quickCheck: changed }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    f.config.FEATURE_PRESENTATIONS = false;
    f.config.FEATURE_PRESENTATION_REALTIME = false;
    f.config.FEATURE_PRESENTATION_COMPANION = false;
    f.config.UX_BETA_WORKSPACE_ALLOWLIST = [];
    f.config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST = [];
    expect(await f.service.companionCommand(command)).toMatchObject({
      phase: "question_reveal",
      revision: 2,
    });
    expect((await f.snapshot()).canInsertQuickCheck).toBe(false);
    while ((await f.current()).status === "active") await f.advance();
    expect(await f.service.companionCommand(command)).toMatchObject({
      phase: "finished",
      revision: 6,
    });
    expect((await f.current()).content.blocks).toHaveLength(3);
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(6);
  });

  it("fences competing checks, stale callers, same-command races and legacy unhashed receipts", async () => {
    const f = await fixture();
    await expectNoMutation(f, f.command(1), "STALE_SESSION");
    const commands = [f.command(), f.command()];
    const race = await Promise.allSettled(
      commands.map((command) => f.service.companionCommand(command)),
    );
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "STALE_SESSION" },
    });
    expect((await f.current()).content.blocks).toHaveLength(3);
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(1);
    const same = await fixture();
    const command = same.command();
    const exact = await Promise.all([
      same.service.companionCommand(command),
      same.service.companionCommand(command),
    ]);
    expect(exact.map((snapshot) => snapshot.revision)).toEqual([1, 1]);
    expect(await same.sessions.listTimeline(same.sessionId)).toHaveLength(1);
    const legacy = await fixture();
    const legacyCommand = legacy.command();
    await legacy.sessions.transitionSessionCommand({
      workspaceId: legacy.workspaceId,
      sessionId: legacy.sessionId,
      commandId: legacyCommand.commandId,
      expectedRevision: 0,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId: legacy.content.blocks[0]!.id },
    });
    await expect(legacy.service.companionCommand(legacyCommand)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect((await legacy.current()).content.liveQuickCheck).toBeUndefined();
  });

  it("validates strict REST input and denies host, participant and other-session credentials", async () => {
    const f = await fixture();
    for (const token of [f.hosted.controlToken, f.joined.participantToken])
      await expectNoMutation(f, { ...f.command(), companionToken: token }, "UNAUTHORIZED");
    const foreign = await fixture();
    await expectNoMutation(
      f,
      { ...f.command(), companionToken: foreign.pass.companionToken },
      "UNAUTHORIZED",
    );
    const url = `/v1/presentation-sessions/${f.sessionId}/companion-command?includeQuickChecks=true`;
    await expect(
      f.service.command({
        sessionId: f.sessionId,
        controlToken: f.hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "insert_quick_check",
        quickCheck,
      } as unknown as PresentationCommand),
    ).rejects.toThrow();
    for (const invalid of [
      { ...quickCheck, prompt: " " },
      { ...quickCheck, prompt: "x".repeat(501) },
      { ...quickCheck, choices: ["One"] },
      { ...quickCheck, choices: ["One", " oNe "] },
      { ...quickCheck, choices: ["Ａ", "a"] },
      { ...quickCheck, choices: ["More  time", "more time"] },
      { ...quickCheck, choices: ["x".repeat(181), "Other"] },
      { ...quickCheck, choices: Array.from({ length: 7 }, (_, index) => String(index)) },
      { ...quickCheck, timeLimitSeconds: 9 },
      { ...quickCheck, timeLimitSeconds: 301 },
      { ...quickCheck, isCorrect: true },
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url,
        payload: { ...f.command(), quickCheck: invalid },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      expect(response.headers["cache-control"]).toContain("no-store");
    }
    expect((await f.current()).revision).toBe(0);
    expect(await f.sessions.listTimeline(f.sessionId)).toEqual([]);
    const accepted = await f.app.inject({ method: "POST", url, payload: f.command() });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["cache-control"]).toContain("no-store");
    expect(accepted.json()).toMatchObject({
      snapshot: { projection: "companion", phase: "question_open", canInsertQuickCheck: false },
    });
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/presentation-sessions/${foreign.sessionId}/companion-command`,
          payload: f.command(),
        })
      ).statusCode,
    ).toBe(422);
  });

  it("negotiates Quick Check REST fields while keeping default snapshots and advance ACKs strict-legacy compatible", async () => {
    const f = await fixture();
    const base = `/v1/presentation-sessions/${f.sessionId}`;
    const headers = { authorization: `Bearer ${f.pass.companionToken}` };
    const legacyRead = await f.app.inject({ method: "GET", url: `${base}/companion`, headers });
    expect(legacyRead.statusCode).toBe(200);
    expect(() => LegacyCompanionSnapshotSchema.parse(legacyRead.json().snapshot)).not.toThrow();
    expect(legacyRead.json().snapshot).not.toHaveProperty("canInsertQuickCheck");
    const optedRead = await f.app.inject({
      method: "GET",
      url: `${base}/companion?includeQuickChecks=true`,
      headers,
    });
    expect(
      PresentationCompanionSnapshotSchema.parse(optedRead.json().snapshot).canInsertQuickCheck,
    ).toBe(true);
    expect(() => LegacyCompanionSnapshotSchema.parse(optedRead.json().snapshot)).toThrow();
    const advance = await f.app.inject({
      method: "POST",
      url: `${base}/companion-command`,
      payload: {
        sessionId: f.sessionId,
        companionToken: f.pass.companionToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "advance",
      },
    });
    expect(advance.statusCode).toBe(200);
    expect(() => LegacyCompanionSnapshotSchema.parse(advance.json().snapshot)).not.toThrow();
    expect(advance.json().snapshot).not.toHaveProperty("canInsertQuickCheck");
    const command = f.command(1);
    const inserted = await f.app.inject({
      method: "POST",
      url: `${base}/companion-command?includeQuickChecks=true`,
      payload: command,
    });
    expect(inserted.statusCode).toBe(200);
    expect(PresentationCompanionSnapshotSchema.parse(inserted.json().snapshot)).toMatchObject({
      canInsertQuickCheck: false,
      phase: "question_open",
    });
    const retry = await f.app.inject({
      method: "POST",
      url: `${base}/companion-command`,
      payload: command,
    });
    expect(() => LegacyCompanionSnapshotSchema.parse(retry.json().snapshot)).not.toThrow();
    expect(retry.json().snapshot).not.toHaveProperty("canInsertQuickCheck");
    expect((await f.snapshot()).canInsertQuickCheck).toBe(false); // Internal/socket projection stays full.
    for (const query of [
      "includeQuickChecks=false",
      "includeQuickChecks=1",
      "includeQuickChecks=true&extra=true",
      "includeQuickChecks=true&includeQuickChecks=true",
    ])
      for (const method of ["GET", "POST"] as const) {
        const response = await f.app.inject({
          method,
          url: `${base}/${method === "GET" ? "companion" : "companion-command"}?${query}`,
          headers,
          ...(method === "POST" ? { payload: command } : {}),
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      }
  });

  it.each(["diagnostic", "practice"] as const)(
    "preserves pending linked %s recovery across source, content and standalone reveal",
    async (linkedPurpose) => {
      const f = await fixture({ linkedPurpose });
      const record = await f.current();
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
          presentationCanInsertQuickCheck({
            ...record,
            phase,
            currentBlockIndex: index,
            status: phase === "finished" ? "finished" : "active",
          }),
        ).toBe(allowed);
      await f.advance();
      await f.advance();
      expect((await f.snapshot()).canInsertQuickCheck).toBe(false);
      await expectNoMutation(f, f.command(2), "PHASE_CLOSED");
      await f.advance();
      await f.advance();
      expect((await f.snapshot()).canInsertQuickCheck).toBe(false);
      await expectNoMutation(f, f.command(4), "PHASE_CLOSED");
      await f.advance();
      await f.advance();
      expect((await f.snapshot()).canInsertQuickCheck).toBe(false);
      await expectNoMutation(f, f.command(6), "PHASE_CLOSED");
      await f.advance();
      await f.advance();
      expect((await f.snapshot()).canInsertQuickCheck).toBe(true);
      expect(await f.service.companionCommand(f.command(8))).toMatchObject({
        currentBlockIndex: 4,
        phase: "question_open",
      });
    },
  );

  it("reports participation as session-only unscored evidence separately from linked recovery", async () => {
    const f = await fixture({ linkedPurpose: "diagnostic" });
    await f.service.companionCommand(f.command());
    const quickBlock = (await f.current()).content.blocks[0]!;
    if (quickBlock.kind !== "question" || quickBlock.question.type !== "poll")
      throw new Error("Expected poll");
    await f.answer({ choiceIds: [quickBlock.question.choices[0]!.id] });
    await f.advance();
    await f.advance();
    await f.answer({ numericValue: "0" });
    await f.advance();
    await f.advance();
    await f.advance();
    await f.advance();
    await f.advance();
    await f.advance();
    await f.answer({ numericValue: "7" });
    await f.advance();
    await f.advance();
    const report = generatePresentationReport({
      session: await f.current(),
      participants: await f.sessions.listParticipants(f.sessionId),
      responses: await f.sessions.listResponses(f.sessionId),
      timeline: await f.sessions.listTimeline(f.sessionId),
    });
    expect(report.responseCount).toBe(3);
    expect(report.schemaVersion).toBe(3);
    expect(() => PresentationReportV3Schema.parse(report)).not.toThrow();
    expect(report.evidence[0]).toMatchObject({
      blockId: quickBlock.id,
      kind: "question",
      questionType: "poll",
      sessionOnly: "quick_check",
      respondents: 1,
      correct: null,
      accuracyPercent: null,
      totalScore: 0,
    });
    expect(report.evidence.slice(1).every((entry) => !("sessionOnly" in entry))).toBe(true);
    expect(report.recovery).toEqual([
      expect.objectContaining({ eligible: 1, recovered: 1, recoveryPercent: 100 }),
    ]);
    expect(report.recovery[0]!.sourceQuestionId).not.toBe(quickBlock.question.id);
  });

  it("negotiates pending and ready V3 reports without changing stored JSON or strict old reader shapes", async () => {
    const f = await fixture();
    await f.service.companionCommand(f.command());
    while ((await f.current()).status === "active") await f.advance();
    const magic = await f.app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: {
        email: "quick-check-report@example.com",
        segment: "workplace",
        acceptPolicies: true,
      },
    });
    const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
    const verified = await verifyEmailAndSignIn(
      f.app,
      `/v1/auth/verify?token=${token}`,
      "quick-check-report@example.com",
    );
    const cookies = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
    const url = `/v1/presentation-sessions/${f.sessionId}/report`;
    for (const reportStatus of ["pending", "ready"] as const) {
      if (reportStatus === "ready")
        expect(await new PresentationReportWorker(f.sessions, 60_000).runOnce()).toBe("completed");
      const stored = structuredClone(await f.sessions.getReport(f.workspaceId, f.sessionId));
      const legacy = await f.service.getReport(f.workspaceId, f.sessionId);
      const opted = await f.service.getReport(f.workspaceId, f.sessionId, false, true);
      expect(legacy.reportStatus).toBe(reportStatus);
      expect(opted.reportStatus).toBe(reportStatus);
      expect(PresentationReportV1Schema.parse(legacy.report).schemaVersion).toBe(1);
      expect(JSON.stringify(legacy.report)).not.toContain("sessionOnly");
      expect(PresentationReportV3Schema.parse(opted.report).evidence[0]).toMatchObject({
        sessionOnly: "quick_check",
        correct: null,
        totalScore: 0,
      });
      const legacyRest = await f.app.inject({ method: "GET", url, headers: { cookie } });
      expect(legacyRest.statusCode).toBe(200);
      expect(() => PresentationReportV1Schema.parse(legacyRest.json().report)).not.toThrow();
      const optedRest = await f.app.inject({
        method: "GET",
        url: `${url}?includeQuickChecks=true&includeSessionContext=true`,
        headers: { cookie },
      });
      expect(optedRest.statusCode).toBe(200);
      expect(() => PresentationReportV3Schema.parse(optedRest.json().report)).not.toThrow();
      expect(optedRest.json().sessionContext).toEqual({ timeMode: "timed" });
      expect(await f.sessions.getReport(f.workspaceId, f.sessionId)).toEqual(stored);
      if (reportStatus === "ready")
        expect(stored).toMatchObject({ schemaVersion: 3, payload: opted.report });
    }
    for (const query of ["includeQuickChecks=false", "includeQuickChecks=true&extra=true"])
      expect(
        (await f.app.inject({ method: "GET", url: `${url}?${query}`, headers: { cookie } }))
          .statusCode,
      ).toBe(400);
    const full = (await f.service.getReport(f.workspaceId, f.sessionId, false, true)).report!;
    const withPack = PresentationReportV3Schema.parse({
      ...full,
      timeline: [
        ...full.timeline,
        {
          sequence: full.timeline.length + 1,
          type: "intervention.presented",
          blockIndex: 0,
          blockId: full.evidence[0]!.blockId,
          occurredAt: full.finishedAt,
          recoveryPackIntervention: {
            type: "explain",
            reference: {
              insertionId: randomUUID(),
              packId: randomUUID(),
              packVersionId: randomUUID(),
              packVersion: 1,
              contentHash: "a".repeat(64),
              cardId: randomUUID(),
            },
          },
        },
      ],
    });
    const oldPack = presentationReportRestProjection(withPack, false);
    expect(PresentationReportV2Schema.parse(oldPack).schemaVersion).toBe(2);
    expect(JSON.stringify(oldPack)).not.toContain("sessionOnly");
    expect(presentationReportRestProjection(withPack, true)).toBe(withPack);
    expect(presentationReportRestProjection(oldPack, false)).toBe(oldPack);
    expect(presentationReportRestProjection(oldPack, true)).toBe(oldPack);
    const old = PresentationReportV1Schema.parse(
      (await f.service.getReport(f.workspaceId, f.sessionId)).report,
    );
    expect(presentationReportRestProjection(old, false)).toBe(old);
    expect(presentationReportRestProjection(old, true)).toBe(old);
  });

  it("checks rollout, block and encoded content bounds before writes", async () => {
    const f = await fixture();
    f.config.FEATURE_PRESENTATION_COMPANION = false;
    expect((await f.snapshot()).canInsertQuickCheck).toBe(false);
    await expectNoMutation(f, f.command(), "NOT_FOUND");
    f.config.FEATURE_PRESENTATION_COMPANION = true;
    const slide = f.content.blocks.find((block) => block.kind === "content")!;
    const question = f.content.blocks.find((block) => block.kind === "question")!;
    const capped = PresentationContentSchema.parse({
      ...f.content,
      blocks: [...Array.from({ length: 99 }, () => ({ ...slide, id: randomUUID() })), question],
    });
    await f.sessions.transitionSession({
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      expectedRevision: 0,
      content: capped,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId: capped.blocks[0]!.id },
    });
    expect((await f.snapshot()).canInsertQuickCheck).toBe(false);
    await expectNoMutation(f, f.command(1), "PHASE_CLOSED");
    const regions = [
      "top_left",
      "top_right",
      "middle_left",
      "middle_center",
      "middle_right",
      "bottom_left",
      "bottom_center",
    ] as const;
    const oversized = PresentationContentSchema.parse({
      ...f.content,
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
    await f.sessions.transitionSession({
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      expectedRevision: 1,
      content: oversized,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId: oversized.blocks[0]!.id },
    });
    await expectNoMutation(f, f.command(2), "VALIDATION_ERROR");
  });
});
