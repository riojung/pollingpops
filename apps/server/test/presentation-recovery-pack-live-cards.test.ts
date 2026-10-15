import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationHostSnapshotSchema,
  PresentationReportV1Schema,
  PresentationReportV2Schema,
  PresentationRestV1CreateSessionResponseSchema,
  RecoveryPackContentSchema,
  RecoveryPackInsertionSchema,
  recoveryPackContentHash,
  type PresentationCommand,
  type Plan,
  type Question,
  type RecoveryPackContent,
  type RecoveryPackInsertion,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
  createRecoveryPackRepository,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { presentationCommandRequestHash } from "../src/presentation-recovery-pack-cards.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import {
  PresentationSessionService,
  presentationParticipantTokenHash,
} from "../src/presentation-session-service.js";
import { StorageService } from "../src/storage.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const PRIVATE_PROBE = "PRIVATE delayed probe must stay hidden";
const UNSELECTED_BODY = "UNSELECTED card body must stay private until selected";
const ACCEPTED_BODY = "ACCEPTED selected card describes physical isolation";

const configInput = {
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  FEATURE_PRESENTATIONS: "true",
  LOG_LEVEL: "silent",
};
const config = ConfigSchema.parse(configInput);

function packContent() {
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "numeric" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["isolation"],
    linkedRecheckQuestionId: null as string | null,
    correctValue: "2",
    tolerance: "0",
    unit: null,
    timeLimitSeconds: 300,
    basePoints: 100,
    explanation: "PRIVATE answer rationale",
    mediaId: null,
    mediaAlt: null,
  });
  const recheck = {
    ...question("Apply the isolation rule to a new scenario"),
    delivery: "recheck",
  };
  return RecoveryPackContentSchema.parse({
    title: "Physical isolation recovery",
    description: "",
    diagnostic: {
      ...question("How many energy sources must be isolated?"),
      linkedRecheckQuestionId: recheck.id,
    },
    recheck,
    delayedProbe: question(PRIVATE_PROBE),
    interventions: [
      {
        id: randomUUID(),
        title: "Original explanation",
        body: "ORIGINAL selected card describes isolation",
        citations: [
          {
            sourceName: "Maintenance handbook",
            sourceDigest: "b".repeat(64),
            locator: "Section 2",
            excerpt: "Physically isolate hazardous energy before maintenance.",
          },
        ],
      },
      { id: randomUUID(), title: "Alternative example", body: UNSELECTED_BODY, citations: [] },
    ],
    conceptKeys: ["isolation"],
    misconceptionKeys: ["warning-is-isolation"],
    citations: [],
  });
}

function insertion(originalContent: RecoveryPackContent, accepted: boolean) {
  const acceptedContent = structuredClone(originalContent);
  acceptedContent.interventions[0] = {
    ...acceptedContent.interventions[0]!,
    id: randomUUID(),
    title: "Accepted explanation",
    body: ACCEPTED_BODY,
  };
  return RecoveryPackInsertionSchema.parse({
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: recoveryPackContentHash(originalContent),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent,
    ...(accepted
      ? {
          updateBaseline: {
            packVersionId: randomUUID(),
            packVersion: 2,
            contentHash: recoveryPackContentHash(acceptedContent),
            content: acceptedContent,
          },
        }
      : {}),
  });
}

function copiedQuestion(item: RecoveryPackInsertion, role: "diagnostic" | "recheck"): Question {
  const source = item.originalContent[role];
  return {
    ...structuredClone(source),
    id: role === "diagnostic" ? item.diagnosticQuestionId : item.recheckQuestionId,
    linkedRecheckQuestionId: role === "diagnostic" ? item.recheckQuestionId : null,
    recoveryPackSource: {
      artifactType: "recovery_pack",
      packId: item.packId,
      packVersionId: item.packVersionId,
      packVersion: item.packVersion,
      contentHash: item.contentHash,
      sourceItemId: source.id,
      role,
    },
  };
}

async function material(accepted = true) {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const presentations = createPresentationRepository(repository);
  const sessions = createPresentationSessionRepository(repository);
  const packs = createRecoveryPackRepository(repository);
  const originalContent = packContent();
  const first = insertion(originalContent, accepted);
  const future = insertion(packContent(), false);
  const now = new Date();
  await packs.createRecoveryPack({
    id: first.packId,
    workspaceId,
    title: originalContent.title,
    description: originalContent.description,
    draft: originalContent,
    draftRevision: 0,
    draftSchemaVersion: 1,
    currentVersionId: null,
    publishedDraftRevision: null,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await packs.publishRecoveryPack(
    {
      id: first.packVersionId,
      workspaceId,
      packId: first.packId,
      version: 1,
      content: originalContent,
      contentHash: first.contentHash,
      contentSchemaVersion: 1,
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const draft = PresentationDraftSchema.parse({
    title: "Copied Recovery Pack Presentation",
    schemaVersion: 3,
    recoveryPackInsertions: [first, future],
    blocks: [first, future].flatMap((item) =>
      (["diagnostic", "recheck"] as const).map((role) => ({
        id: randomUUID(),
        kind: "question" as const,
        question: copiedQuestion(item, role),
      })),
    ),
  });
  const content = PresentationContentSchema.parse(draft);
  const presentationId = randomUUID();
  await presentations.createPresentation({
    id: presentationId,
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: 3,
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
      contentSchemaVersion: 3,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const baseline = first.updateBaseline ?? {
    packVersionId: first.packVersionId,
    packVersion: first.packVersion,
    contentHash: first.contentHash,
    content: first.originalContent,
  };
  const card = baseline.content.interventions[0]!;
  const reference = {
    insertionId: first.id,
    packId: first.packId,
    packVersionId: baseline.packVersionId,
    packVersion: baseline.packVersion,
    contentHash: baseline.contentHash,
    cardId: card.id,
  };
  return {
    repository,
    presentations,
    sessions,
    packs,
    workspaceId,
    userId,
    presentationId,
    first,
    future,
    baseline,
    reference,
    card: { reference, title: card.title, body: card.body, citations: card.citations },
    selection: { insertionId: first.id, cardId: card.id },
  };
}

async function fixture(accepted = true, enabled = true) {
  const m = await material(accepted);
  const eligibility = vi.fn((_workspaceId: string, _plan?: Plan) => enabled);
  function newService(callback = eligibility) {
    return new PresentationSessionService({
      repository: m.repository,
      presentations: m.presentations,
      sessions: m.sessions,
      config,
      storage: new StorageService(config, null),
      recoveryPackCardsEnabled: callback,
    });
  }
  const service = newService();
  const hosted = await service.createSession({
    workspaceId: m.workspaceId,
    userId: m.userId,
    presentationId: m.presentationId,
    requestId: randomUUID(),
  });
  const sessionId = hosted.snapshot.sessionId;
  const joined = await service.join(hosted.snapshot.code, "River");
  const companionToken = randomUUID();
  await m.sessions.createCredential({
    id: randomUUID(),
    workspaceId: m.workspaceId,
    sessionId,
    role: "companion",
    tokenHash: presentationParticipantTokenHash(companionToken),
    createdAt: new Date(),
    expiresAt: (await m.sessions.getSessionById(sessionId))!.liveExpiresAt,
    revokedAt: null,
  });
  async function current(target = service) {
    return (await target.sync({ sessionId, projection: "host", controlToken: hosted.controlToken }))
      .snapshot;
  }
  async function advance(target = service) {
    return target.command({
      sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: (await current(target)).revision,
      action: "advance",
    });
  }
  async function select(type: "explain" | "example" = "explain", target = service) {
    const input = {
      sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: (await current(target)).revision,
      action: "start_recovery_card" as const,
      recoveryPackCard: m.selection,
      interventionType: type,
    };
    return { input, snapshot: await target.command(input) };
  }
  async function reveal(target = service) {
    await advance(target);
    return advance(target);
  }
  async function finish(target = service) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if ((await current(target)).phase === "finished") return;
      await advance(target);
    }
    throw new Error("Presentation did not finish within its block transitions");
  }
  async function projections(target = service) {
    return Promise.all([
      target.sync({ sessionId, projection: "host", controlToken: hosted.controlToken }),
      target.sync({
        sessionId,
        projection: "participant",
        participantToken: joined.participantToken,
      }),
      target.sync({ sessionId, projection: "companion", companionToken }),
    ]);
  }
  return {
    ...m,
    service,
    newService,
    eligibility,
    hosted,
    joined,
    sessionId,
    companionToken,
    current,
    advance,
    select,
    reveal,
    finish,
    projections,
  };
}

function expectNoCards(snapshot: unknown) {
  expect(snapshot).not.toHaveProperty("recoveryPackCards");
  expect(snapshot).not.toHaveProperty("recoveryPackIntervention");
  expect(JSON.stringify(snapshot)).not.toContain(UNSELECTED_BODY);
  expect(JSON.stringify(snapshot)).not.toContain(ACCEPTED_BODY);
  expect(JSON.stringify(snapshot)).not.toContain(PRIVATE_PROBE);
}

async function signIn(app: FastifyInstance) {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "presentation-live-cards@example.com",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  expect(magic.statusCode, magic.body).toBe(202);
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const cookies = verified.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function apiSetup(
  options: { packs?: boolean; liveCards?: boolean; allowlisted?: boolean } = {},
) {
  const m = await material();
  const appConfig = ConfigSchema.parse({
    ...configInput,
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: m.workspaceId,
    FEATURE_PRESENTATION_REALTIME: "true",
    FEATURE_RECOVERY_PACKS: String(options.packs ?? true),
    FEATURE_RECOVERY_PACK_LIVE_CARDS: String(options.liveCards ?? true),
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: options.allowlisted === false ? "" : m.workspaceId,
  });
  const { app } = await buildApp(appConfig, {
    repository: m.repository,
    cache: new MemorySessionCache(),
  });
  apps.push(app);
  const cookie = await signIn(app);
  return { ...m, app, cookie };
}

async function apiFixture(options: { packs?: boolean; liveCards?: boolean } = {}) {
  const m = await apiSetup(options);
  const { app, cookie } = m;
  const created = await app.inject({
    method: "POST",
    url: "/v1/presentation-sessions",
    headers: { cookie },
    payload: { presentationId: m.presentationId },
  });
  expect(created.statusCode, created.body).toBe(201);
  const hosted = PresentationRestV1CreateSessionResponseSchema.parse(created.json());
  const sessionId = hosted.snapshot.sessionId;
  async function command(input: PresentationCommand) {
    return app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${sessionId}/command`,
      payload: input,
    });
  }
  async function advance(expectedRevision: number) {
    const result = await command({
      sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision,
      action: "advance",
    });
    expect(result.statusCode, result.body).toBe(200);
    return PresentationHostSnapshotSchema.parse(result.json().snapshot);
  }
  return { ...m, app, cookie, hosted, sessionId, command, advance };
}

describe("Presentation Recovery Pack live playback", () => {
  it.each([false, true])(
    "projects only the selected original/accepted card (%s)",
    async (accepted) => {
      const f = await fixture(accepted);
      for (const { snapshot } of await f.projections()) expectNoCards(snapshot);
      const opened = await f.advance();
      expect(opened.phase).toBe("question_open");
      for (const { snapshot } of await f.projections()) expectNoCards(snapshot);
      const revealed = await f.advance();
      expect(revealed.phase).toBe("question_reveal");
      expect(revealed.recoveryPackCards).toHaveLength(2);
      expect(revealed.recoveryPackCards?.[0]).toEqual(f.card);
      expect(revealed).not.toHaveProperty("recoveryPackIntervention");
      const [, participant, companion] = await f.projections();
      expectNoCards(participant!.snapshot);
      expect(companion!.snapshot).toHaveProperty("recoveryPackCards", [
        { reference: f.card.reference, title: f.card.title },
        expect.objectContaining({ title: "Alternative example" }),
      ]);
      expect(companion!.snapshot).not.toHaveProperty("recoveryPackIntervention");
      expect(JSON.stringify(companion!.snapshot)).not.toContain(UNSELECTED_BODY);
      expect(JSON.stringify(companion!.snapshot)).not.toContain(f.card.body);

      const selected = await f.select(accepted ? "example" : "explain");
      expect(selected.snapshot).toMatchObject({ phase: "intervention", currentBlockIndex: 0 });
      for (const { snapshot } of await f.projections()) {
        expect(snapshot).toHaveProperty("recoveryPackIntervention", {
          type: selected.input.interventionType,
          card: f.card,
        });
        expect(snapshot).not.toHaveProperty("recoveryPackCards");
        expect(JSON.stringify(snapshot)).not.toContain(UNSELECTED_BODY);
        expect(JSON.stringify(snapshot)).not.toContain(PRIVATE_PROBE);
        expect(JSON.stringify(snapshot)).not.toContain("delayedProbe");
      }
      const broadcasts = await f.service.syncManyByCredentialHash([
        {
          sessionId: f.sessionId,
          projection: "participant",
          participantTokenHash: presentationParticipantTokenHash(f.joined.participantToken),
        },
        {
          sessionId: f.sessionId,
          projection: "companion",
          companionTokenHash: presentationParticipantTokenHash(f.companionToken),
        },
      ]);
      for (const broadcast of broadcasts) {
        expect(broadcast?.snapshot).toHaveProperty("recoveryPackIntervention.card", f.card);
        expect(JSON.stringify(broadcast)).not.toContain(UNSELECTED_BODY);
        expect(JSON.stringify(broadcast)).not.toContain(PRIVATE_PROBE);
      }
      const recheck = await f.advance();
      expect(recheck).toMatchObject({
        phase: "question_open",
        currentBlockIndex: 1,
        currentBlock: { question: { id: f.first.recheckQuestionId } },
      });
      for (const { snapshot } of await f.projections()) expectNoCards(snapshot);
      expect(await f.sessions.getSessionById(f.sessionId)).toMatchObject({
        recoveryPackIntervention: null,
      });
    },
  );

  it("plays and reports the publication snapshot after source deletion without source reads", async () => {
    const f = await fixture();
    expect(await f.packs.deleteRecoveryPack(f.workspaceId, f.first.packId)).toBe(true);
    expect(await f.packs.getRecoveryPackVersion(f.workspaceId, f.first.packVersionId)).toBeNull();
    const sourceReads = [
      vi.spyOn(f.packs, "getRecoveryPack").mockRejectedValue(new Error("Source read forbidden")),
      vi
        .spyOn(f.packs, "getRecoveryPackVersion")
        .mockRejectedValue(new Error("Source read forbidden")),
    ];
    expect((await f.reveal()).recoveryPackCards?.[0]).toEqual(f.card);
    expect((await f.select()).snapshot.recoveryPackIntervention?.card).toEqual(f.card);
    await f.finish();
    const worker = new PresentationReportWorker(f.sessions, 60_000);
    expect(await worker.runOnce()).toBe("completed");
    expect((await f.service.getReport(f.workspaceId, f.sessionId)).report).toMatchObject({
      schemaVersion: 2,
    });
    for (const read of sourceReads) expect(read).not.toHaveBeenCalled();
  });

  it("recovers exact command retries after recheck and finish but rejects changed intent", async () => {
    const f = await fixture();
    await f.reveal();
    const selected = await f.select();
    const recheck = await f.advance();
    expect(await f.service.command(selected.input)).toMatchObject({
      revision: recheck.revision,
      phase: "question_open",
    });
    const alternateHostToken = randomUUID();
    await f.sessions.createCredential({
      id: randomUUID(),
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      role: "host",
      tokenHash: presentationParticipantTokenHash(alternateHostToken),
      createdAt: new Date(),
      expiresAt: (await f.sessions.getSessionById(f.sessionId))!.liveExpiresAt,
      revokedAt: null,
    });
    expect(
      presentationCommandRequestHash({ ...selected.input, controlToken: alternateHostToken }),
    ).toBe(presentationCommandRequestHash(selected.input));
    expect(
      await f.service.command({ ...selected.input, controlToken: alternateHostToken }),
    ).toMatchObject({ revision: recheck.revision });
    for (const changed of [
      {
        ...selected.input,
        recoveryPackCard: { ...f.selection, cardId: f.baseline.content.interventions[1]!.id },
      },
      { ...selected.input, recoveryPackCard: { ...f.selection, insertionId: f.future.id } },
      { ...selected.input, interventionType: "example" as const },
      { ...selected.input, expectedRevision: selected.input.expectedRevision + 1 },
      {
        sessionId: f.sessionId,
        controlToken: f.hosted.controlToken,
        commandId: selected.input.commandId,
        expectedRevision: selected.input.expectedRevision,
        action: "advance" as const,
      },
    ]) {
      await expect(f.service.command(changed)).rejects.toMatchObject({
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
      });
    }
    await f.finish();
    const finished = await f.current();
    expect(await f.service.command(selected.input)).toMatchObject({
      phase: "finished",
      revision: finished.revision,
    });
    expect(
      (await f.sessions.listTimeline(f.sessionId)).filter(
        (event) => event.recoveryPackIntervention,
      ),
    ).toHaveLength(1);
  });

  it("rejects phase, revision, removed-card, and noncurrent insertion selections", async () => {
    const f = await fixture();
    const input = {
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "start_recovery_card" as const,
      recoveryPackCard: f.selection,
      interventionType: "explain" as const,
    };
    await expect(f.service.command(input)).rejects.toMatchObject({ code: "PHASE_CLOSED" });
    await f.advance();
    await expect(f.service.command({ ...input, expectedRevision: 1 })).rejects.toMatchObject({
      code: "PHASE_CLOSED",
    });
    await f.advance();
    for (const expectedRevision of [1, 3]) {
      await expect(f.service.command({ ...input, expectedRevision })).rejects.toMatchObject({
        code: "STALE_SESSION",
      });
    }
    for (const recoveryPackCard of [
      { insertionId: f.future.id, cardId: f.future.originalContent.interventions[0]!.id },
      { insertionId: f.first.id, cardId: f.first.originalContent.interventions[0]!.id },
      { insertionId: f.first.id, cardId: randomUUID() },
    ]) {
      await expect(
        f.service.command({ ...input, expectedRevision: 2, recoveryPackCard }),
      ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    }
    expect((await f.current()).revision).toBe(2);
    await f.select();
    await f.advance();
    await f.advance();
    await expect(
      f.service.command({ ...input, expectedRevision: (await f.current()).revision }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("deduplicates simultaneous same-key selections into one durable transition", async () => {
    const f = await fixture();
    await f.reveal();
    const alternative = f.baseline.content.interventions[1]!;
    const card = {
      reference: { ...f.reference, cardId: alternative.id },
      title: alternative.title,
      body: alternative.body,
      citations: alternative.citations,
    };
    const input = {
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "start_recovery_card" as const,
      recoveryPackCard: { ...f.selection, cardId: alternative.id },
      interventionType: "example" as const,
    };
    const snapshots = await Promise.all([f.service.command(input), f.service.command(input)]);
    for (const snapshot of snapshots)
      expect(snapshot).toMatchObject({
        revision: 3,
        phase: "intervention",
        recoveryPackIntervention: { type: "example", card },
      });
    for (const { snapshot } of await f.projections()) {
      expect(snapshot).toHaveProperty("recoveryPackIntervention.card", card);
      expect(snapshot).not.toHaveProperty("recoveryPackCards");
      expect(JSON.stringify(snapshot)).not.toContain(f.card.body);
      expect(JSON.stringify(snapshot)).not.toContain(PRIVATE_PROBE);
    }
    expect(
      (await f.sessions.listTimeline(f.sessionId)).filter(
        (event) => event.type === "intervention.presented",
      ),
    ).toHaveLength(1);
    expect(
      await f.sessions.findCommandReceipt(f.workspaceId, f.sessionId, input.commandId),
    ).toMatchObject({
      expectedRevision: 2,
      resultingRevision: 3,
      requestHash: presentationCommandRequestHash(input),
    });
  });

  it("requires a host credential even for an exact receipt retry", async () => {
    const f = await fixture();
    await f.reveal();
    const selected = await f.select();
    for (const controlToken of [f.joined.participantToken, f.companionToken, "x".repeat(32)]) {
      await expect(f.service.command({ ...selected.input, controlToken })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(
        f.service.command({
          ...selected.input,
          controlToken,
          commandId: randomUUID(),
          expectedRevision: 3,
          action: "advance",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect((await f.current()).revision).toBe(3);
  });

  it("rejects a card selection when a legacy same-key advance wins after receipt preflight", async () => {
    const f = await fixture();
    await f.reveal();
    const input = {
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "start_recovery_card" as const,
      recoveryPackCard: f.selection,
      interventionType: "explain" as const,
    };
    const transition = f.sessions.transitionSessionCommand.bind(f.sessions);
    vi.spyOn(f.sessions, "findCommandReceipt").mockResolvedValueOnce(null);
    vi.spyOn(f.sessions, "transitionSessionCommand").mockImplementationOnce(async (request) => {
      // A legacy writer commits its generic advance after the service's empty receipt read,
      // before the new writer reaches the repository's final receipt check.
      await expect(
        transition({
          ...request,
          requestHash: undefined,
          recoveryPackIntervention: null,
          event: { ...request.event, recoveryPackIntervention: undefined },
        }),
      ).resolves.toMatchObject({ status: "accepted", session: { revision: 3 } });
      return transition(request);
    });
    await expect(f.service.command(input)).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(await f.sessions.getSessionById(f.sessionId)).toMatchObject({
      phase: "intervention",
      revision: 3,
      recoveryPackIntervention: null,
    });
    for (const { snapshot } of await f.projections()) expectNoCards(snapshot);
    const timeline = (await f.sessions.listTimeline(f.sessionId)).filter(
      (event) => event.type === "intervention.presented",
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.recoveryPackIntervention).toBeNull();
    expect(
      await f.sessions.findCommandReceipt(f.workspaceId, f.sessionId, input.commandId),
    ).toMatchObject({ expectedRevision: 2, resultingRevision: 3, requestHash: null });
    const legacyRetry = await f.service.command({
      sessionId: input.sessionId,
      controlToken: input.controlToken,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      action: "advance",
    });
    expect(legacyRetry).toMatchObject({ phase: "intervention", revision: 3 });
    expectNoCards(legacyRetry);
  });

  it("freezes eligibility at creation across callback changes and service restart", async () => {
    const f = await fixture();
    expect(f.eligibility).toHaveBeenCalledExactlyOnceWith(f.workspaceId, "free");
    f.eligibility.mockReturnValue(false);
    const restarted = f.newService();
    expect((await f.reveal(restarted)).recoveryPackCards).toHaveLength(2);
    expect((await f.select("example", restarted)).snapshot.recoveryPackIntervention?.card).toEqual(
      f.card,
    );
    expect(f.eligibility).toHaveBeenCalledTimes(1);
    const disabled = await restarted.createSession({
      workspaceId: f.workspaceId,
      userId: f.userId,
      presentationId: f.presentationId,
      requestId: randomUUID(),
    });
    const disabledId = disabled.snapshot.sessionId;
    expect(await f.sessions.getSessionById(disabledId)).toMatchObject({
      recoveryPackCardsEnabled: false,
    });
    for (let expectedRevision = 0; expectedRevision < 2; expectedRevision += 1) {
      const snapshot = await restarted.command({
        sessionId: disabledId,
        controlToken: disabled.controlToken,
        commandId: randomUUID(),
        expectedRevision,
        action: "advance",
      });
      expectNoCards(snapshot);
    }
    await expect(
      restarted.command({
        sessionId: disabledId,
        controlToken: disabled.controlToken,
        commandId: randomUUID(),
        expectedRevision: 2,
        action: "start_recovery_card",
        recoveryPackCard: f.selection,
        interventionType: "explain",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const generic = await restarted.command({
      sessionId: disabledId,
      controlToken: disabled.controlToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "advance",
    });
    expect(generic.phase).toBe("intervention");
    expectNoCards(generic);
  });

  it("persists aggregate V2 attribution and reads it before and after worker reconciliation", async () => {
    const f = await fixture();
    await f.reveal();
    await f.select("example");
    await f.finish();
    const pending = await f.service.getReport(f.workspaceId, f.sessionId);
    expect(pending.reportStatus).toBe("pending");
    const report = PresentationReportV2Schema.parse(pending.report);
    expect(report.timeline.filter((event) => event.recoveryPackIntervention)).toEqual([
      expect.objectContaining({
        type: "intervention.presented",
        recoveryPackIntervention: { type: "example", reference: f.reference },
      }),
    ]);
    for (const secret of [
      f.card.body,
      UNSELECTED_BODY,
      PRIVATE_PROBE,
      "delayedProbe",
      "citations",
      "correctValue",
    ])
      expect(JSON.stringify(report)).not.toContain(secret);
    const worker = new PresentationReportWorker(f.sessions, 60_000);
    expect(await worker.runOnce()).toBe("completed");
    expect(await worker.runOnce()).toBe("idle");
    expect(await f.sessions.getReport(f.workspaceId, f.sessionId)).toMatchObject({
      status: "ready",
      schemaVersion: 2,
      payload: report,
    });
    expect(await f.service.getReport(f.workspaceId, f.sessionId)).toEqual({
      reportStatus: "ready",
      report,
    });
    expect(await f.service.getReport(f.workspaceId, f.sessionId, true)).toMatchObject({
      reportStatus: "ready",
      report,
      sessionContext: { timeMode: "timed" },
    });
  });

  it("keeps enabled but generic interventions on unchanged V1 reports", async () => {
    const f = await fixture();
    await f.finish();
    const worker = new PresentationReportWorker(f.sessions, 60_000);
    expect(await worker.runOnce()).toBe("completed");
    const stored = (await f.service.getReport(f.workspaceId, f.sessionId)).report;
    const legacy = PresentationReportV1Schema.parse(stored);
    expect(legacy.schemaVersion).toBe(1);
    expect(legacy.timeline.filter((event) => event.type === "intervention.presented")).toHaveLength(
      2,
    );
    expect(JSON.stringify(legacy)).not.toContain("recoveryPackIntervention");
    expect(JSON.stringify(legacy)).not.toContain(f.card.body);
  });
});

describe("Presentation Recovery Pack REST command fallback", () => {
  it("returns a canonical snapshot, checks the route, and authorizes the host token", async () => {
    const f = await apiFixture();
    expect(await f.sessions.getSessionById(f.sessionId)).toMatchObject({
      recoveryPackCardsEnabled: true,
    });
    await f.advance(0);
    const revealed = await f.advance(1);
    expect(revealed.recoveryPackCards?.[0]).toEqual(f.card);
    const joined = await f.app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: f.hosted.snapshot.code, nickname: "Learner" },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    const input: PresentationCommand = {
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "start_recovery_card",
      recoveryPackCard: f.selection,
      interventionType: "explain",
    };
    const mismatched = await f.command({ ...input, sessionId: randomUUID() });
    expect(mismatched.statusCode, mismatched.body).toBe(422);
    expect(mismatched.json().error.code).toBe("VALIDATION_ERROR");
    const unauthorized = await f.command({
      ...input,
      controlToken: joined.json().participantToken,
    });
    expect(unauthorized.statusCode, unauthorized.body).toBe(401);
    const selected = await f.command(input);
    expect(selected.statusCode, selected.body).toBe(200);
    expect(Object.keys(selected.json())).toEqual(["snapshot"]);
    expect(selected.headers["cache-control"]).toContain("no-store");
    const snapshot = PresentationHostSnapshotSchema.parse(selected.json().snapshot);
    expect(snapshot).toMatchObject({
      phase: "intervention",
      revision: 3,
      recoveryPackIntervention: { type: "explain", card: f.card },
    });
    expect(snapshot).not.toHaveProperty("id");
    const recheck = await f.advance(3);
    expectNoCards(recheck);
    const retried = await f.command(input);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json().snapshot).toMatchObject({ phase: "question_open", revision: 4 });
    const conflict = await f.command({ ...input, interventionType: "example" });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it.each([
    { packs: false, liveCards: true, allowlisted: true },
    { packs: true, liveCards: false, allowlisted: true },
  ])("freezes disabled creation when a deployment gate is absent (%j)", async (options) => {
    const f = await apiFixture(options);
    expect(await f.sessions.getSessionById(f.sessionId)).toMatchObject({
      recoveryPackCardsEnabled: false,
    });
    await f.advance(0);
    expectNoCards(await f.advance(1));
    const selected = await f.command({
      sessionId: f.sessionId,
      controlToken: f.hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "start_recovery_card",
      recoveryPackCard: f.selection,
      interventionType: "example",
    });
    expect(selected.statusCode, selected.body).toBe(422);
    expectNoCards(await f.advance(2));
  });

  it("does not create a Presentation room outside the evidence workspace allowlist", async () => {
    const f = await apiSetup({ allowlisted: false });
    const created = await f.app.inject({
      method: "POST",
      url: "/v1/presentation-sessions",
      headers: { cookie: f.cookie },
      payload: { presentationId: f.presentationId },
    });
    expect(created.statusCode, created.body).toBe(404);
    expect(created.json().error.code).toBe("NOT_FOUND");
    expect(await f.sessions.listSessions(f.workspaceId, new Date(), true)).toEqual([]);
  });
});
