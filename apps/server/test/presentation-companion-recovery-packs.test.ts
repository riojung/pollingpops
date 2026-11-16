import {
  compositionSceneBlock,
  designSceneBlock,
  nativeSceneBlock,
  richTextSceneBlock,
} from "./support/presentation-native-scene.js";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type PresentationCompanionCommand,
  type PresentationCompanionSnapshot,
  type PresentationContent,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createRecoveryPackRepository,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import {
  presentationCanInsertRecoveryPack,
  presentationRecoveryPackInsertionTransition,
} from "../src/presentation-live-recovery-packs.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const CARD_BODY = "SELECTED private repair strategy";
const OTHER_CARD_BODY = "UNSELECTED private alternative";
const PROBE_PROMPT = "DELAYED private practice probe";
const SECRET_EXPLANATION = "PRIVATE scoring rationale";

function question(prompt: string, delivery: "main" | "recheck" = "main") {
  return {
    id: randomUUID(),
    type: "numeric" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery,
    conceptKeys: ["private.concept"],
    linkedRecheckQuestionId: null as string | null,
    correctValue: "7",
    tolerance: "0",
    unit: null,
    timeLimitSeconds: 17,
    basePoints: 100,
    explanation: SECRET_EXPLANATION,
    mediaId: null,
    mediaAlt: null,
  };
}

function packContent(title = "Published textual repair") {
  const recheck = question("Try the rule again", "recheck");
  return RecoveryPackContentSchema.parse({
    title,
    description: "",
    diagnostic: { ...question("How many units?"), linkedRecheckQuestionId: recheck.id },
    recheck,
    delayedProbe: question(PROBE_PROMPT),
    interventions: [
      { id: randomUUID(), title: "Repair explanation", body: CARD_BODY, citations: [] },
      { id: randomUUID(), title: "Alternative example", body: OTHER_CARD_BODY, citations: [] },
    ],
    conceptKeys: ["private.concept"],
    misconceptionKeys: ["private.misconception"],
    citations: [],
  });
}

function originalContent(
  intervening = false,
  linkedPurpose: "diagnostic" | "practice" = "diagnostic",
): PresentationContent {
  const standalone = {
    id: randomUUID(),
    kind: "question" as const,
    question: { ...question("Original checkpoint"), timeLimitSeconds: 30 },
  };
  const content = {
    id: randomUUID(),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: "title",
        role: "title" as const,
        text: "Original slide",
        region: "top_center" as const,
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Private speaker note",
  };
  const recheck = {
    id: randomUUID(),
    kind: "question" as const,
    question: question("Original linked recheck", "recheck"),
  };
  const diagnostic = {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      ...question("Original linked source"),
      purpose: linkedPurpose,
      linkedRecheckQuestionId: recheck.question.id,
    },
  };
  return PresentationContentSchema.parse({
    title: "Original published presentation",
    description: "",
    schemaVersion: 2,
    blocks: intervening ? [diagnostic, content, standalone, recheck] : [content, standalone],
  });
}

async function fixture(
  options: {
    intervening?: boolean;
    native?: boolean;
    richText?: boolean;
    visibility?: boolean;
    design?: boolean;
    composition?: boolean;
    cardsEnabled?: boolean;
    linkedPurpose?: "diagnostic" | "practice";
  } = {},
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
    FEATURE_PRESENTATION_COMPANION: "true",
    FEATURE_RECOVERY_PACKS: "true",
    FEATURE_RECOVERY_PACK_LIVE_CARDS: options.cardsEnabled === false ? "false" : "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    LOG_LEVEL: "silent",
  });
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(built.app);
  const presentations = createPresentationRepository(repository);
  const packs = createRecoveryPackRepository(repository);
  const service = built.presentationService;
  const sessions = built.presentationSessions;
  const now = new Date();
  const legacyContent = originalContent(options.intervening, options.linkedPurpose);
  const publishedContent = options.native
    ? PresentationContentSchema.parse({
        ...legacyContent,
        schemaVersion: options.composition
          ? 8
          : options.design
            ? 7
            : options.visibility
              ? 6
              : options.richText
                ? 5
                : 4,
        blocks: [
          options.composition
            ? compositionSceneBlock()
            : options.design
              ? designSceneBlock()
              : options.richText
                ? richTextSceneBlock()
                : nativeSceneBlock(),
          ...legacyContent.blocks.slice(1),
        ],
      })
    : legacyContent;
  const draft = PresentationDraftSchema.parse(publishedContent);
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: draft.schemaVersion,
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
      content: publishedContent,
      contentSchemaVersion: publishedContent.schemaVersion,
      contentHash: createHash("sha256").update(JSON.stringify(publishedContent)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const hosted = await service.createSession({
    workspaceId,
    userId,
    presentationId: presentation.id,
    requestId: randomUUID(),
  });
  const sessionId = hosted.snapshot.sessionId;
  const pass = await service.createCompanionPass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  async function publishPack(content = packContent(), workspace = workspaceId) {
    const pack = await packs.createRecoveryPack({
      id: randomUUID(),
      workspaceId: workspace,
      title: content.title,
      description: content.description,
      draft: content,
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      publishedDraftRevision: null,
      lastEditedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const version = await packs.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId: workspace,
        packId: pack.id,
        version: 1,
        content,
        contentHash: recoveryPackContentHash(content),
        sourceDraftRevision: 0,
        publishedAt: new Date(),
      },
      0,
    );
    return { pack, version };
  }
  const publishedPack = await publishPack();
  const snapshot = () => service.getCompanionSnapshot(sessionId, pass.companionToken);
  const current = async () => (await sessions.getSessionById(sessionId))!;
  function insertion(
    expectedRevision = 0,
    packVersionId = publishedPack.version.id,
  ): Extract<PresentationCompanionCommand, { action: "insert_recovery_pack" }> {
    return {
      sessionId,
      companionToken: pass.companionToken,
      commandId: randomUUID(),
      expectedRevision,
      action: "insert_recovery_pack",
      packVersionId,
    };
  }
  async function advance() {
    return service.companionCommand({
      sessionId,
      companionToken: pass.companionToken,
      commandId: randomUUID(),
      expectedRevision: (await current()).revision,
      action: "advance",
    });
  }
  return {
    ...built,
    config,
    repository,
    presentations,
    packs,
    service,
    sessions,
    workspaceId,
    userId,
    presentation,
    version,
    publishedContent,
    hosted,
    pass,
    sessionId,
    publishedPack,
    publishPack,
    snapshot,
    current,
    insertion,
    advance,
  };
}

function expectPrivate(snapshot: unknown) {
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    CARD_BODY,
    OTHER_CARD_BODY,
    PROBE_PROMPT,
    SECRET_EXPLANATION,
    "Private speaker note",
  ])
    expect(serialized).not.toContain(secret);
  for (const field of [
    "correctValue",
    "tolerance",
    "isCorrect",
    "explanation",
    "conceptKeys",
    "misconceptionKeys",
    "originalContent",
    "recoveryPackInsertions",
    "sourceCitations",
  ])
    expect(serialized).not.toContain(`"${field}"`);
}

async function expectCommandNoMutation(
  f: Awaited<ReturnType<typeof fixture>>,
  command: PresentationCompanionCommand,
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

describe("Companion live Recovery Packs", () => {
  it.each([4, 5, 6, 7, 8] as const)(
    "preserves native v%s scenes and publication when a frozen Pack is inserted live",
    async (schemaVersion) => {
      const f = await fixture({
        native: true,
        richText: schemaVersion >= 5,
        visibility: schemaVersion >= 6,
        design: schemaVersion >= 7,
        composition: schemaVersion === 8,
      });
      const command = f.insertion();
      const opened = await f.service.companionCommand(command);
      expect(opened).toMatchObject({ phase: "question_open", blockCount: 4, revision: 1 });
      const live = await f.current();
      expect(live.content.schemaVersion).toBe(schemaVersion);
      expect(live.content.blocks.slice(2)).toEqual(f.publishedContent.blocks);
      expect(live.content.recoveryPackInsertions).toMatchObject([
        { originalContent: f.publishedPack.version.content },
      ]);
      expect(
        (await f.presentations.getPresentationVersion(f.workspaceId, f.version.id))?.content,
      ).toEqual(f.publishedContent);
      await f.service.companionCommand(command);
      expect((await f.current()).content).toEqual(live.content);
      expectPrivate(opened);
    },
  );

  it.each(["diagnostic", "practice"] as const)(
    "fences a %s source, intervening content and standalone reveal until its linked recheck completes",
    async (linkedPurpose) => {
      const f = await fixture({ intervening: true, linkedPurpose });
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
      ] as const) {
        expect(
          presentationCanInsertRecoveryPack({
            ...record,
            phase,
            currentBlockIndex: index,
            status: phase === "finished" ? "finished" : "active",
          }),
          `${phase} at ${index}`,
        ).toBe(allowed);
      }
      await f.advance(); // diagnostic open
      await f.advance(); // diagnostic reveal
      expect((await f.snapshot()).canInsertRecoveryPack).toBe(false);
      await expectCommandNoMutation(f, f.insertion((await f.current()).revision), "PHASE_CLOSED");
      await f.advance(); // diagnostic intervention
      await f.advance(); // intervening content
      const base = `/v1/presentation-sessions/${f.sessionId}`;
      const bearer = { authorization: `Bearer ${f.pass.companionToken}` };
      for (const expectedIndex of [1, 2]) {
        expect((await f.current()).currentBlockIndex).toBe(expectedIndex);
        const read = await f.app.inject({
          method: "GET",
          url: `${base}/companion`,
          headers: bearer,
        });
        expect(read.statusCode).toBe(200);
        expect(
          read.json<{ snapshot: PresentationCompanionSnapshot }>().snapshot.canInsertRecoveryPack,
        ).toBe(false);
        const command = f.insertion((await f.current()).revision);
        const before = await f.current();
        const timeline = await f.sessions.listTimeline(f.sessionId);
        const rejected = await f.app.inject({
          method: "POST",
          url: `${base}/companion-command`,
          payload: command,
        });
        expect(rejected.statusCode).toBe(409);
        expect(rejected.json()).toMatchObject({ error: { code: "PHASE_CLOSED" } });
        expect(await f.current()).toEqual(before);
        expect(await f.sessions.listTimeline(f.sessionId)).toEqual(timeline);
        expect(
          await f.sessions.findCommandReceipt(f.workspaceId, f.sessionId, command.commandId),
        ).toBeNull();
        await expectCommandNoMutation(f, f.insertion(before.revision), "PHASE_CLOSED");
        if (expectedIndex === 1) {
          await f.advance();
          await f.advance();
        }
      }
      await f.advance(); // recheck open
      await f.advance(); // recheck reveal
      expect((await f.snapshot()).canInsertRecoveryPack).toBe(true);
      expect(
        await f.service.companionCommand(f.insertion((await f.current()).revision)),
      ).toMatchObject({ phase: "question_open", currentBlockIndex: 4 });
    },
  );

  it("returns bounded workspace published metadata only through a bearer-scoped no-store catalogue", async () => {
    const f = await fixture();
    await f.packs.updateRecoveryPackDraft({
      workspaceId: f.workspaceId,
      packId: f.publishedPack.pack.id,
      editorId: f.userId,
      expectedRevision: 0,
      mutationId: randomUUID(),
      draftHash: "private draft edit",
      draft: { ...f.publishedPack.pack.draft, title: "PRIVATE unpublished title" },
    });
    const unpublished = { ...f.publishedPack.pack, id: randomUUID(), currentVersionId: null };
    await f.packs.createRecoveryPack(unpublished);
    await f.publishPack(packContent("Other tenant"), randomUUID());
    const mediaId = randomUUID();
    await f.repository.createMediaAsset({
      id: mediaId,
      workspaceId: f.workspaceId,
      objectKey: `media/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Diagram",
      createdAt: new Date(),
    });
    const mediaVersions = [];
    for (const role of ["diagnostic", "recheck", "delayedProbe"] as const) {
      const content = packContent(`Media ${role}`);
      const item = await f.publishPack(
        RecoveryPackContentSchema.parse({
          ...content,
          [role]: { ...content[role], mediaId, mediaAlt: "Diagram" },
        }),
      );
      mediaVersions.push(item.version.id);
    }
    const url = `/v1/presentation-sessions/${f.sessionId}/companion-recovery-packs`;
    const response = await f.app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${f.pass.companionToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.json()).toEqual({
      packs: [
        {
          packId: f.publishedPack.pack.id,
          packVersionId: f.publishedPack.version.id,
          packVersion: 1,
          title: f.publishedPack.version.content.title,
        },
      ],
    });
    expectPrivate(response.json());
    for (const token of [undefined, f.hosted.controlToken]) {
      const denied = await f.app.inject({
        method: "GET",
        url,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      });
      expect(denied.statusCode).toBe(401);
      expect(denied.headers["cache-control"]).toContain("no-store");
    }
    expect(
      (await f.app.inject({ method: "GET", url: `${url}?companionToken=${f.pass.companionToken}` }))
        .statusCode,
    ).toBe(401);
    for (const packVersionId of mediaVersions)
      await expectCommandNoMutation(f, f.insertion(0, packVersionId), "VALIDATION_ERROR");
    f.config.FEATURE_RECOVERY_PACKS = false;
    expect(
      (
        await f.app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${f.pass.companionToken}` },
        })
      ).statusCode,
    ).toBe(404);
    await expectCommandNoMutation(f, f.insertion(), "NOT_FOUND");
  });

  it("atomically inserts a frozen pair with its own timer and safely retries after source deletion and rollback", async () => {
    const f = await fixture();
    expect((await f.snapshot()).canInsertRecoveryPack).toBe(true);
    const command = f.insertion();
    const opened = await f.service.companionCommand(command);
    expect(opened).toMatchObject({
      phase: "question_open",
      currentBlockIndex: 0,
      blockCount: 4,
      revision: 1,
      canInsertRecoveryPack: false,
    });
    expect(opened.recoveryPackCards).toBeUndefined();
    expectPrivate(opened);
    const frozen = await f.current();
    expect(frozen.content.recoveryPackInsertions).toEqual([
      expect.objectContaining({
        id: command.commandId,
        packVersionId: f.publishedPack.version.id,
        originalContent: f.publishedPack.version.content,
      }),
    ]);
    expect(frozen.content.blocks.slice(2)).toEqual(f.publishedContent.blocks);
    expect(frozen.questionClosesAt!.getTime() - frozen.questionOpenedAt!.getTime()).toBe(17_000);
    expect(frozen.presentationVersionId).toBe(f.version.id);
    expect(
      (await f.presentations.getPresentationVersion(f.workspaceId, f.version.id))?.content,
    ).toEqual(f.publishedContent);
    expect(
      (await f.presentations.getPresentation(f.workspaceId, f.presentation.id))?.draft,
    ).toEqual(f.presentation.draft);
    expect(await f.sessions.listTimeline(f.sessionId)).toEqual([
      expect.objectContaining({ type: "question.launched", blockId: frozen.content.blocks[0]!.id }),
    ]);
    await f.advance();
    const revealed = await f.snapshot();
    expect(revealed.recoveryPackCards).toEqual(
      f.publishedPack.version.content.interventions.map((card) => ({
        title: card.title,
        reference: expect.objectContaining({ insertionId: command.commandId, cardId: card.id }),
      })),
    );
    expect(revealed.canInsertRecoveryPack).toBe(false);
    expectPrivate(revealed);
    await f.packs.deleteRecoveryPack(f.workspaceId, f.publishedPack.pack.id);
    f.config.FEATURE_PRESENTATION_REALTIME = false;
    f.config.FEATURE_PRESENTATION_COMPANION = false;
    f.config.FEATURE_RECOVERY_PACKS = false;
    f.config.FEATURE_RECOVERY_PACK_LIVE_CARDS = false;
    f.config.FEATURE_PRESENTATIONS = false;
    const recovered = await f.service.companionCommand(command);
    expect(recovered).toMatchObject({ phase: "question_reveal", revision: 2 });
    expect((await f.current()).content).toEqual(frozen.content);
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(2);
    const selection = revealed.recoveryPackCards![0]!.reference;
    const start: Extract<PresentationCompanionCommand, { action: "start_recovery_card" }> = {
      sessionId: f.sessionId,
      companionToken: f.pass.companionToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "start_recovery_card",
      recoveryPackCard: { insertionId: selection.insertionId, cardId: selection.cardId },
      interventionType: "explain",
    };
    const playback = await f.service.companionCommand(start);
    expect(playback).toMatchObject({
      phase: "intervention",
      recoveryPackIntervention: { type: "explain", card: { body: CARD_BODY } },
    });
    expect(JSON.stringify(playback)).not.toContain(OTHER_CARD_BODY);
    expect(JSON.stringify(playback)).not.toContain(PROBE_PROMPT);
    expect(playback.recoveryPackCards).toBeUndefined();
    await f.advance(); // inserted recheck
    expect((await f.snapshot()).currentBlockIndex).toBe(1);
    expectPrivate(await f.snapshot());
    await expectCommandNoMutation(
      f,
      { ...command, commandId: randomUUID(), expectedRevision: 4 },
      "NOT_FOUND",
    );
    expect(await f.service.companionCommand(start)).toMatchObject({
      phase: "question_open",
      revision: 4,
    });
    await f.advance(); // recheck reveal
    await f.advance(); // original content resumes
    expect((await f.snapshot()).currentBlock?.id).toBe(f.publishedContent.blocks[0]!.id);
    await f.advance();
    await f.advance();
    await f.advance();
    expect(await f.service.companionCommand(command)).toMatchObject({
      phase: "finished",
      revision: 9,
    });
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(9);
  });

  it("fences role, tenant, stale revision, changed intent and legacy receipt without mutations", async () => {
    const f = await fixture();
    await expectCommandNoMutation(
      f,
      { ...f.insertion(), companionToken: f.hosted.controlToken },
      "UNAUTHORIZED",
    );
    const other = await fixture();
    await expectCommandNoMutation(
      f,
      { ...f.insertion(), companionToken: other.pass.companionToken },
      "UNAUTHORIZED",
    );
    await expectCommandNoMutation(f, f.insertion(1), "STALE_SESSION");
    await expectCommandNoMutation(f, f.insertion(0, other.publishedPack.version.id), "NOT_FOUND");
    const command = f.insertion();
    await f.service.companionCommand(command);
    await expect(
      f.service.companionCommand({ ...command, packVersionId: randomUUID() }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      f.service.companionCommand({
        ...command,
        action: "advance",
        packVersionId: undefined,
      } as unknown as PresentationCompanionCommand),
    ).rejects.toThrow();
    await expect(
      f.service.companionCommand({
        sessionId: f.sessionId,
        companionToken: f.pass.companionToken,
        commandId: command.commandId,
        expectedRevision: 0,
        action: "advance",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const legacyId = randomUUID();
    await f.sessions.transitionSessionCommand({
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      commandId: legacyId,
      expectedRevision: 1,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      event: {
        type: "question.revealed",
        blockIndex: 0,
        blockId: (await f.current()).content.blocks[0]!.id,
      },
    });
    await expect(
      f.service.companionCommand({ ...command, commandId: legacyId, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await f.sessions.listTimeline(f.sessionId)).toHaveLength(2);
    expect((await f.current()).content.recoveryPackInsertions).toHaveLength(1);
  });

  it("keeps creation-time eligibility latched and rejects insertion while a question is open", async () => {
    const old = await fixture({ cardsEnabled: false });
    old.config.FEATURE_RECOVERY_PACK_LIVE_CARDS = true;
    expect((await old.snapshot()).canInsertRecoveryPack).toBe(false);
    await expectCommandNoMutation(old, old.insertion(), "PHASE_CLOSED");
    const f = await fixture();
    await f.advance(); // content
    expect((await f.snapshot()).canInsertRecoveryPack).toBe(true);
    await f.advance(); // original standalone open
    expect((await f.snapshot()).canInsertRecoveryPack).toBe(false);
    await expectCommandNoMutation(f, f.insertion(2), "PHASE_CLOSED");
    await f.advance();
    expect((await f.snapshot()).canInsertRecoveryPack).toBe(true);
    await f.service.companionCommand(f.insertion(3));
    expect((await f.current()).currentBlockIndex).toBe(2);
  });

  it("bounds live blocks and encoded snapshot bytes before committing an insertion", async () => {
    const f = await fixture();
    const contentBlock = f.publishedContent.blocks.find((block) => block.kind === "content")!;
    const questionBlock = f.publishedContent.blocks.find((block) => block.kind === "question")!;
    const cappedContent = PresentationContentSchema.parse({
      ...f.publishedContent,
      blocks: [
        ...Array.from({ length: 99 }, () => ({ ...contentBlock, id: randomUUID() })),
        questionBlock,
      ],
    });
    await f.sessions.transitionSession({
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      expectedRevision: 0,
      content: cappedContent,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId: cappedContent.blocks[0]!.id },
    });
    expect((await f.snapshot()).canInsertRecoveryPack).toBe(false);
    await expectCommandNoMutation(f, f.insertion(1), "PHASE_CLOSED");
    const record = await f.current();
    const regions = [
      "top_left",
      "top_right",
      "middle_left",
      "middle_center",
      "middle_right",
      "bottom_left",
      "bottom_center",
    ] as const;
    const largeContent = PresentationContentSchema.parse({
      ...f.publishedContent,
      blocks: [
        ...Array.from({ length: 45 }, () => ({
          ...contentBlock,
          id: randomUUID(),
          textElements: [
            contentBlock.textElements[0],
            ...regions.map((region, index) => ({
              id: `body-${index}`,
              role: "body",
              text: "界".repeat(4_000),
              region,
              order: 0,
            })),
          ],
        })),
        questionBlock,
      ],
    });
    const large = { ...record, content: largeContent };
    expect(presentationCanInsertRecoveryPack(large)).toBe(true);
    expect(() =>
      presentationRecoveryPackInsertionTransition(large, f.publishedPack.version, f.insertion(1)),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(await f.current()).toEqual(record);
    expect(
      await f.sessions.findCommandReceipt(f.workspaceId, f.sessionId, f.insertion(1).commandId),
    ).toBeNull();
  });
});
