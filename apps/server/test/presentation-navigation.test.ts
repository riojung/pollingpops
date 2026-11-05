import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  preparePresentationPublication,
  type ContentSlideDraft,
  type PresentationCommand,
  type PresentationCompanionCommand,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { presentationResponsesForContent } from "../src/presentation-response-identifiers.js";
import { nativeSceneBlock } from "./support/presentation-native-scene.js";

const apps: Array<Awaited<ReturnType<typeof buildApp>>["app"]> = [];
type FixtureCommand<T> = T extends unknown
  ? Omit<T, "sessionId" | "controlToken" | "companionToken" | "commandId" | "expectedRevision">
  : never;
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function slide(title: string): ContentSlideDraft {
  return {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [
      { id: randomUUID(), role: "title", text: title, region: "top_center", order: 0 },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE E07 speaker cue",
  };
}
function question(prompt: string, delivery: "main" | "recheck" = "main") {
  return {
    id: randomUUID() as string,
    kind: "question" as const,
    question: {
      id: randomUUID() as string,
      type: "single_select" as const,
      prompt,
      purpose: "diagnostic" as const,
      confidence: "off" as const,
      delivery,
      conceptKeys: ["synthetic.navigation"],
      linkedRecheckQuestionId: null as string | null,
      timeLimitSeconds: 120,
      basePoints: 1000,
      explanation: "UNREVEALED E07 explanation",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: randomUUID() as string, label: "First", isCorrect: true },
        { id: randomUUID() as string, label: "Second", isCorrect: false },
      ],
    },
  };
}

async function fixture(linked = false, uppercase = false, contentOnly = false, advanced = false) {
  const workspaceId = randomUUID(),
    userId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "team" });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      FEATURE_PRESENTATIONS: "true",
      FEATURE_PRESENTATION_REALTIME: "true",
      FEATURE_PRESENTATION_COMPANION: "true",
      FEATURE_LIVE_FLEX_MODE: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  apps.push(built.app);
  const opening = slide("Opening"),
    middle = slide("Evidence"),
    closing = slide("Closing");
  const main = question("Navigation checkpoint"),
    skipped = question("Unvisited checkpoint");
  const recheck = question("Linked recheck", "recheck");
  if (uppercase) {
    main.id = main.id.toUpperCase();
    main.question.id = main.question.id.toUpperCase();
    main.question.choices = main.question.choices.map((choice) => ({
      ...choice,
      id: choice.id.toUpperCase(),
    }));
  }
  if (linked) main.question.linkedRecheckQuestionId = recheck.question.id;
  const branchId = randomUUID();
  if (advanced) {
    const native = nativeSceneBlock([], "Opening");
    opening.textElements = [];
    opening.scene = {
      ...native.scene,
      schemaVersion: 6,
      nodes: [
        ...native.scene.nodes,
        {
          id: "broadcast",
          type: "reveal",
          scope: "broadcast",
          label: "Shared evidence",
          body: "WITHHELD broadcast audience evidence",
          frame: { x: 5, y: 30, width: 40, height: 20 },
        },
        {
          id: "internal",
          type: "navigation",
          label: "Go to closing",
          targetBlockId: closing.id,
          frame: { x: 50, y: 30, width: 40, height: 20 },
        },
        {
          id: "detail",
          type: "dialog",
          scope: "local",
          label: "Read detail",
          detailTitle: "Public detail",
          body: "Public audience dialogue",
          frame: { x: 5, y: 55, width: 40, height: 20 },
        },
      ],
      readingOrder: [...native.scene.readingOrder, "broadcast", "internal", "detail"],
    };
    Object.assign(main, {
      branches: [
        {
          id: branchId,
          label: "Use the deeper example",
          condition: {
            kind: "choice_share",
            choiceId: main.question.choices[0]!.id,
            minPercent: 50,
            minResponses: 1,
          },
          targetBlockId: closing.id,
        },
      ],
    });
  }
  const hidden = { ...slide("HIDDEN planning"), hidden: true as const };
  const blocks = contentOnly
    ? [opening, middle, closing, hidden]
    : linked
      ? [main, middle, recheck, closing, hidden]
      : [opening, main, middle, skipped, closing, hidden];
  const sectionId = randomUUID();
  const draft = PresentationDraftSchema.parse({
    title: "Safe navigation",
    schemaVersion: advanced ? 13 : 12,
    blocks,
    sections: [{ id: sectionId, title: "Discussion", blockIds: blocks.map((block) => block.id) }],
  });
  const content = PresentationContentSchema.parse(preparePresentationPublication(draft));
  const now = new Date();
  const presentation = await built.presentations.createPresentation({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: advanced ? 13 : 12,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  const version = await built.presentations.publishPresentation(
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
  const hosted = await built.presentationService.createSession({
    workspaceId,
    userId,
    presentationId: presentation.id,
    requestId: randomUUID(),
  });
  const sessionId = hosted.snapshot.sessionId;
  const pass = await built.presentationService.createCompanionPass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  const stage = await built.presentationService.createStagePass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  const guest = await built.presentationService.join(hosted.snapshot.code, "Synthetic audience");
  const current = () =>
    built.presentationSessions.getSessionById(sessionId).then((value) => value!);
  async function command(input: FixtureCommand<PresentationCommand>, commandId = randomUUID()) {
    const record = await current();
    return built.presentationService.command({
      ...input,
      sessionId,
      controlToken: hosted.controlToken,
      commandId,
      expectedRevision: record.revision,
    } as PresentationCommand);
  }
  async function companion(input: FixtureCommand<PresentationCompanionCommand>) {
    const record = await current();
    return built.presentationService.companionCommand({
      ...input,
      sessionId,
      companionToken: pass.companionToken,
      commandId: randomUUID(),
      expectedRevision: record.revision,
    } as PresentationCompanionCommand);
  }
  return {
    ...built,
    repository,
    workspaceId,
    userId,
    content,
    presentation,
    version,
    sessionId,
    hosted,
    pass,
    stage,
    guest,
    current,
    command,
    companion,
    opening,
    main,
    middle,
    closing,
    skipped,
    recheck,
    hidden,
    sectionId,
    branchId,
  };
}

describe("durable Presentation navigation", () => {
  it("shares explicit reveal state with closed bodies withheld and recovers exact late receipts", async () => {
    const f = await fixture(false, false, false, true);
    await f.command({ action: "advance" });
    const audience = async () => {
      const stage = await f.presentationService.getStageSnapshot(f.sessionId, f.stage.stageToken);
      const participant = await f.presentationService.sync({
        sessionId: f.sessionId,
        projection: "participant",
        participantToken: f.guest.participantToken,
      });
      return [stage, participant.snapshot];
    };
    for (const snapshot of await audience()) {
      expect(JSON.stringify(snapshot)).not.toContain("WITHHELD");
      expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
      expect(snapshot.currentBlock).toMatchObject({
        scene: {
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: "broadcast", body: "" }),
            expect.objectContaining({ id: "internal", targetBlockId: null }),
          ]),
        },
      });
    }
    const record = await f.current();
    const reveal: PresentationCommand = {
      action: "set_reveal",
      blockId: f.opening.id,
      nodeId: "broadcast",
      revealed: true,
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      expectedRevision: record.revision,
      commandId: randomUUID(),
    };
    await f.presentationService.command(reveal);
    for (const snapshot of await audience())
      expect(JSON.stringify(snapshot)).toContain("WITHHELD broadcast audience evidence");
    await expect(
      f.command({
        action: "set_reveal",
        blockId: f.opening.id,
        nodeId: "broadcast",
        revealed: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      f.command({ action: "set_reveal", blockId: f.opening.id, nodeId: "detail", revealed: true }),
    ).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    await f.companion({
      action: "set_reveal",
      blockId: f.opening.id,
      nodeId: "broadcast",
      revealed: false,
    });
    for (const snapshot of await audience())
      expect(JSON.stringify(snapshot)).not.toContain("WITHHELD");
    await f.command({ action: "navigate_scene", blockId: f.opening.id, nodeId: "internal" });
    const replay = await f.presentationService.command(reveal);
    expect(replay.currentBlock?.id).toBe(f.closing.id);
    expect((await f.current()).interactionState?.reveals).toMatchObject([{ revealed: false }]);
    await expect(
      f.presentationService.command({ ...reveal, revealed: false }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await f.command({ action: "return_to_path" });
    for (const snapshot of await audience())
      expect(JSON.stringify(snapshot)).not.toContain("WITHHELD");
    const timeline = await f.presentationSessions.listTimeline(f.sessionId);
    expect(timeline.filter((event) => event.type === "scene.reveal_changed")).toHaveLength(2);
    expect(JSON.stringify(timeline)).not.toContain("WITHHELD");
    expect(await f.presentationSessions.listResponses(f.sessionId)).toEqual([]);
  });

  it("offers only eligible answer branches after reveal without fabricating a participant attempt", async () => {
    const f = await fixture(false, false, false, true);
    await f.command({ action: "advance" });
    const opened = await f.command({ action: "advance" });
    expect(opened.branches).toMatchObject([{ id: f.branchId, available: false }]);
    await expect(
      f.command({ action: "follow_branch", blockId: f.main.id, branchId: f.branchId }),
    ).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    await f.presentationService.submitResponse({
      sessionId: f.sessionId,
      participantToken: f.guest.participantToken,
      blockId: f.main.id,
      expectedRevision: opened.revision,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [f.main.question.choices[0]!.id] },
    });
    const revealed = await f.command({ action: "advance" });
    expect(revealed.branches).toMatchObject([{ id: f.branchId, available: true }]);
    const stage = await f.presentationService.getStageSnapshot(f.sessionId, f.stage.stageToken);
    expect(stage).not.toHaveProperty("branches");
    expect(JSON.stringify(stage)).not.toContain("choice_share");
    const branch: PresentationCommand = {
      action: "follow_branch",
      blockId: f.main.id,
      branchId: f.branchId,
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      expectedRevision: revealed.revision,
      commandId: randomUUID(),
    };
    const followed = await f.presentationService.command(branch);
    expect(followed.currentBlock?.id).toBe(f.closing.id);
    expect(followed.navigation?.returnTarget?.blockId).toBe(f.main.id);
    await f.command({ action: "return_to_path" });
    expect((await f.current()).phase).toBe("question_reveal");
    const replay = await f.presentationService.command(branch);
    expect(replay.currentBlock?.id).toBe(f.main.id);
    expect(await f.presentationSessions.listResponses(f.sessionId)).toHaveLength(1);
    await f.command({ action: "jump_to_block", targetBlockId: f.closing.id });
    await f.command({ action: "advance" });
    await f.presentationReportWorker.runUntilIdle();
    await expect(
      f.presentationService.getReport(f.workspaceId, f.sessionId, false, true, true, true, true),
    ).rejects.toMatchObject({ status: 422 });
    const result = await f.presentationService.getReport(
      f.workspaceId,
      f.sessionId,
      false,
      true,
      true,
      true,
      true,
      true,
    );
    expect(result.report).toMatchObject({
      schemaVersion: 7,
      interactionSummary: { branchCount: 1, revealChangeCount: 0 },
    });
    expect(result.report?.responseCount).toBe(1);
    expect(
      result.report?.timeline.find((event) => event.type === "navigation.branched"),
    ).toMatchObject({ branch: { branchId: f.branchId, denominator: 1, matchedResponses: 1 } });
  });

  it("finishes a content-only detour without inventing assessment standings", async () => {
    const f = await fixture(false, false, true);
    await f.command({ action: "advance" });
    const jumped = await f.command({ action: "jump_to_block", targetBlockId: f.closing.id });
    expect(jumped.navigation?.returnTarget?.blockId).toBe(f.opening.id);
    await f.command({ action: "advance" });
    await f.presentationReportWorker.runUntilIdle();
    const result = await f.presentationService.getReport(
      f.workspaceId,
      f.sessionId,
      false,
      false,
      false,
      false,
      true,
    );
    expect(result.report?.schemaVersion).toBe(6);
    if (result.report?.schemaVersion !== 6) throw new Error("Expected navigation report");
    expect(result.report.leaderboard).toEqual([]);
    expect(result.report.responseCount).toBe(0);
    expect(result.report.navigation.blocks).toMatchObject([
      { blockId: f.opening.id, status: "presented" },
      { blockId: f.middle.id, status: "skipped" },
      { blockId: f.closing.id, status: "presented" },
    ]);
    expect(result.report.evidence.every((entry) => entry.kind === "content")).toBe(true);
  });

  it("scores and recovers v12 UUID responses across authored and PostgreSQL spelling", async () => {
    const f = await fixture(false, true);
    const opened = await f.command({
      action: "jump_to_block",
      targetBlockId: f.main.id.toLowerCase(),
    });
    const answer = {
      sessionId: f.sessionId,
      participantToken: f.guest.participantToken,
      blockId: f.main.id.toLowerCase(),
      expectedRevision: opened.revision,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [f.main.question.choices[0]!.id.toLowerCase()] },
    };
    const accepted = await f.presentationService.submitResponse(answer);
    expect(accepted).toMatchObject({ accepted: true, blockId: f.main.id });
    const [stored] = await f.presentationSessions.listResponses(f.sessionId);
    expect(stored).toMatchObject({
      correct: true,
      response: { choiceIds: [f.main.question.choices[0]!.id] },
    });
    const projected = presentationResponsesForContent(f.content, [
      {
        ...stored!,
        blockId: stored!.blockId.toLowerCase(),
        questionId: stored!.questionId.toLowerCase(),
        response: answer.response,
      },
    ]);
    expect(projected[0]).toEqual(stored);
    await f.command({ action: "advance" });
    await f.command({ action: "jump_to_block", targetBlockId: f.closing.id });
    expect(
      await f.presentationService.submitResponse({
        ...answer,
        blockId: f.main.id,
        response: { choiceIds: [f.main.question.choices[0]!.id] },
      }),
    ).toMatchObject({ duplicate: true, blockId: f.main.id });
    expect(await f.presentationSessions.listResponses(f.sessionId)).toHaveLength(1);
  });

  it("skips, returns and revisits without reopening responses or inventing report evidence", async () => {
    const f = await fixture();
    const firstJump: PresentationCommand = {
      action: "jump_to_block",
      targetBlockId: f.closing.id,
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
    };
    const jumped = await f.presentationService.command(firstJump);
    expect(jumped).toMatchObject({
      phase: "content",
      currentBlock: { id: f.closing.id },
      navigation: { returnTarget: { blockId: f.opening.id } },
    });
    expect(jumped.navigation!.entries.find((entry) => entry.blockId === f.skipped.id)?.status).toBe(
      "not_visited",
    );
    expect(JSON.stringify(jumped.navigation)).not.toContain("PRIVATE");
    expect(JSON.stringify(jumped.navigation)).not.toContain("UNREVEALED");
    expect(JSON.stringify(jumped.navigation)).not.toContain("HIDDEN");
    const participant = (
      await f.presentationService.sync({
        sessionId: f.sessionId,
        projection: "participant",
        participantToken: f.guest.participantToken,
      })
    ).snapshot;
    const stage = await f.presentationService.getStageSnapshot(f.sessionId, f.stage.stageToken);
    for (const snapshot of [participant, stage]) {
      expect(snapshot).not.toHaveProperty("navigation");
      expect(snapshot).not.toHaveProperty("sections");
      expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
      expect(JSON.stringify(snapshot)).not.toContain("UNREVEALED");
    }
    await f.companion({ action: "return_to_path" });
    const opened = await f.command({ action: "jump_to_block", targetBlockId: f.main.id });
    const attempted = await f.current();
    await expect(
      f.command({ action: "jump_to_block", targetBlockId: f.closing.id }),
    ).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    expect(await f.current()).toEqual(attempted);
    const answer = {
      sessionId: f.sessionId,
      participantToken: f.guest.participantToken,
      blockId: f.main.id,
      expectedRevision: opened.revision,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [f.main.question.choices[0]!.id] },
    };
    await f.presentationService.submitResponse(answer);
    await f.command({ action: "advance" });
    const originalProgress = (await f.current()).navigationState!.blocks.find(
      (entry) => entry.blockId === f.main.id,
    )!;
    const originalResponses = await f.presentationSessions.listResponses(f.sessionId);
    expect(originalResponses).toHaveLength(1);
    expect(originalResponses[0]!.score).toBeGreaterThan(0);
    await f.command({ action: "jump_to_block", targetBlockId: f.closing.id });
    const replay = await f.presentationService.submitResponse(answer);
    expect(replay).toMatchObject({
      duplicate: true,
      snapshot: { currentBlock: { id: f.closing.id } },
    });
    const reviewed = await f.companion({ action: "jump_to_block", targetBlockId: f.main.id });
    expect(reviewed.phase).toBe("question_reveal");
    expect(reviewed.acceptingResponses).toBe(false);
    expect(
      (await f.current()).navigationState!.blocks.find((entry) => entry.blockId === f.main.id),
    ).toEqual(originalProgress);
    expect(await f.presentationSessions.listResponses(f.sessionId)).toEqual(originalResponses);
    expect(
      (await f.presentationSessions.listTimeline(f.sessionId)).filter(
        (event) => event.type === "question.revealed",
      ),
    ).toHaveLength(1);
    await f.companion({ action: "return_to_path" });
    const next = await f.command({ action: "advance" });
    expect(next).toMatchObject({
      phase: "question_reveal",
      currentBlock: { id: f.main.id },
      acceptingResponses: false,
    });
    expect((await f.presentationSessions.listTimeline(f.sessionId)).at(-1)!.type).toBe(
      "navigation.revisited",
    );
    await f.command({ action: "advance" });
    await f.command({ action: "jump_to_block", targetBlockId: f.closing.id });
    await f.command({ action: "advance" });
    expect((await f.current()).phase).toBe("finished");
    const replayed = await f.presentationService.command(firstJump);
    expect(replayed.phase).toBe("finished");
    await expect(
      f.presentationService.command({ ...firstJump, targetBlockId: f.opening.id }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await f.presentationReportWorker.runUntilIdle();
    await expect(f.presentationService.getReport(f.workspaceId, f.sessionId)).rejects.toMatchObject(
      { status: 422 },
    );
    const result = await f.presentationService.getReport(
      f.workspaceId,
      f.sessionId,
      false,
      true,
      true,
      true,
      true,
    );
    expect(result.reportStatus).toBe("ready");
    expect(result.report?.schemaVersion).toBe(6);
    if (result.report?.schemaVersion !== 6) throw new Error("Expected navigation report");
    expect(
      result.report.navigation.blocks.find((entry) => entry.blockId === f.skipped.id),
    ).toMatchObject({ status: "skipped", phase: null, sectionId: f.sectionId });
    expect(result.report.evidence.find((entry) => entry.blockId === f.skipped.id)).toMatchObject({
      respondents: 0,
      correct: null,
      accuracyPercent: null,
      totalScore: 0,
    });
    expect(result.report.responseCount).toBe(1);
    expect(result.report.leaderboard[0]!.score).toBe(originalResponses[0]!.score);
    expect(JSON.stringify(result.report)).not.toContain("PRIVATE");
    expect(JSON.stringify(result.report)).not.toContain("HIDDEN");
    expect(
      (await f.presentations.getPresentationVersion(f.workspaceId, f.version.id))?.contentHash,
    ).toBe(f.version.contentHash);
  });

  it("keeps recovery pairs indivisible and restores the exact intervention/recheck phases", async () => {
    const f = await fixture(true);
    await expect(
      f.command({ action: "jump_to_block", targetBlockId: f.middle.id }),
    ).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    await expect(
      f.command({ action: "jump_to_block", targetBlockId: f.recheck.id }),
    ).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    await f.command({ action: "advance" });
    await f.command({ action: "advance" });
    await expect(
      f.command({ action: "jump_to_block", targetBlockId: f.closing.id }),
    ).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    await f.command({ action: "advance" });
    expect((await f.current()).phase).toBe("intervention");
    await f.command({ action: "advance" });
    await expect(
      f.companion({ action: "jump_to_block", targetBlockId: f.closing.id }),
    ).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    await f.command({ action: "advance" });
    expect((await f.current()).content.blocks[(await f.current()).currentBlockIndex]!.id).toBe(
      f.recheck.id,
    );
    await f.command({ action: "advance" });
    await f.command({ action: "jump_to_block", targetBlockId: f.closing.id });
    const returned = await f.companion({ action: "return_to_path" });
    expect(returned).toMatchObject({
      phase: "question_reveal",
      currentBlock: { id: f.recheck.id },
    });
    const intervention = await f.command({ action: "jump_to_block", targetBlockId: f.main.id });
    expect(intervention).toMatchObject({ phase: "intervention", currentBlock: { id: f.main.id } });
    await f.command({ action: "advance" });
    const recheck = await f.command({ action: "advance" });
    expect(recheck).toMatchObject({
      phase: "question_reveal",
      currentBlock: { id: f.recheck.id },
      acceptingResponses: false,
    });
    expect(
      (await f.presentationSessions.listTimeline(f.sessionId)).filter(
        (event) => event.type === "question.revealed",
      ),
    ).toHaveLength(2);
    expect(await f.presentationSessions.listResponses(f.sessionId)).toEqual([]);
  });

  it("fences targets, intent reuse and rotated credentials before applying navigation", async () => {
    const f = await fixture();
    const command: PresentationCommand = {
      action: "jump_to_block",
      targetBlockId: f.closing.id,
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
    };
    for (const targetBlockId of [randomUUID(), f.hidden.id])
      await expect(
        f.presentationService.command({ ...command, targetBlockId }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const denied = await f.app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${f.sessionId}/command`,
      payload: { ...command, controlToken: f.guest.participantToken },
    });
    expect(denied.statusCode).toBe(401);
    const indexGuess = await f.app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${f.sessionId}/command`,
      payload: { ...command, targetBlockIndex: 4 },
    });
    expect(indexGuess.statusCode).toBe(400);
    await f.presentationService.command(command);
    const renewed = await f.presentationService.createControlPass({
      workspaceId: f.workspaceId,
      userId: f.userId,
      sessionId: f.sessionId,
      requestId: randomUUID(),
    });
    const replay = await f.presentationService.command({
      ...command,
      controlToken: renewed.controlToken,
    });
    expect(replay.revision).toBe(1);
    expect(replay.currentBlock?.id).toBe(f.closing.id);
    await expect(
      f.presentationService.command({
        ...command,
        controlToken: renewed.controlToken,
        targetBlockId: f.opening.id,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      (await f.presentationSessions.listTimeline(f.sessionId)).filter(
        (event) => event.type === "navigation.jumped",
      ),
    ).toHaveLength(1);
    expect((await f.current()).navigationState?.returnBlockId).toBe(f.opening.id);
  });
});
