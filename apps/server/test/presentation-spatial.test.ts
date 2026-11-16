import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  preparePresentationPublication,
  type ContentSlideDraft,
  type PresentationCommand,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

const apps: Array<Awaited<ReturnType<typeof buildApp>>["app"]> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type CommandInput<T> = T extends unknown
  ? Omit<T, "sessionId" | "controlToken" | "commandId" | "expectedRevision">
  : never;

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
    speakerNotes: "PRIVATE E10 presenter cue",
    citations: [{ locator: "PRIVATE E10 locator", excerpt: "PRIVATE E10 citation" }],
  };
}
function question(prompt: string, delivery: "main" | "recheck" = "main") {
  return {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      id: randomUUID(),
      type: "single_select" as const,
      prompt,
      purpose: "diagnostic" as const,
      confidence: "off" as const,
      delivery,
      conceptKeys: ["spatial-navigation"],
      linkedRecheckQuestionId: null as string | null,
      timeLimitSeconds: 120,
      basePoints: 100,
      explanation: "UNREVEALED E10 rationale",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: randomUUID(), label: "First", isCorrect: true },
        { id: randomUUID(), label: "Second", isCorrect: false },
      ],
    },
  };
}

async function fixture(version: 13 | 14 = 14, enabled = true) {
  const workspaceId = randomUUID(),
    userId = randomUUID();
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
    {
      repository: new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "team" }),
      cache: new MemorySessionCache(),
    },
  );
  apps.push(built.app);
  const opening = slide("Public opening"),
    main = question("FUTURE E10 diagnostic"),
    recheck = question("FUTURE E10 recheck", "recheck"),
    closing = slide("FUTURE E10 closing"),
    hidden = { ...slide("HIDDEN E10 planning"), hidden: true as const };
  main.question.linkedRecheckQuestionId = recheck.question.id;
  const blocks = [opening, main, recheck, closing, hidden];
  const draft = PresentationDraftSchema.parse({
    title: "Spatial delivery",
    schemaVersion: version,
    sections: [
      { id: randomUUID(), title: "SECTION E10 source", blockIds: blocks.map((block) => block.id) },
    ],
    blocks,
    ...(version === 14 && enabled
      ? {
          spatial: {
            schemaVersion: 1,
            frames: blocks.map((block, index) => ({
              blockId: block.id.toUpperCase(),
              x: index === 4 ? 18_000 : 400 + index * 3200,
              y: index === 4 ? 18_000 : 400 + index * 960,
              width: index === 1 ? 640 : 1280,
              height: index === 1 ? 360 : 720,
            })),
          },
        }
      : {}),
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
    draftSchemaVersion: version,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  const published = await built.presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId: presentation.id,
      version: 1,
      content,
      contentSchemaVersion: version,
      contentHash: hash(JSON.stringify(content)),
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
  const stage = await built.presentationService.createStagePass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  const companion = await built.presentationService.createCompanionPass({
    workspaceId,
    userId,
    sessionId,
    requestId: randomUUID(),
  });
  const guest = await built.presentationService.join(
    hosted.snapshot.code,
    "Synthetic spatial viewer",
  );
  const current = async () => (await built.presentationSessions.getSessionById(sessionId))!;
  const command = async (input: CommandInput<PresentationCommand>) =>
    built.presentationService.command({
      ...input,
      sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: (await current()).revision,
    } as PresentationCommand);
  async function publicSnapshots() {
    const result = [];
    for (const [path, token] of [
      ["stage", stage.stageToken],
      ["participant", guest.participantToken],
    ] as const) {
      const response = await built.app.inject({
        url: `/v1/presentation-sessions/${sessionId}/${path}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode, response.body).toBe(200);
      result.push(response.json().snapshot);
    }
    return result;
  }
  return {
    ...built,
    workspaceId,
    userId,
    presentation,
    published,
    draft,
    content,
    sessionId,
    hosted,
    stage,
    companion,
    guest,
    current,
    command,
    publicSnapshots,
    opening,
    main,
    recheck,
    closing,
    hidden,
  };
}

describe("bounded spatial delivery", () => {
  it("sends only published geometry and ordinals through HTTP and realtime role projections", async () => {
    const f = await fixture();
    expect(f.content.blocks).toHaveLength(4);
    expect(f.content.spatial?.frames).toHaveLength(4);
    expect(JSON.stringify(f.content.spatial)).not.toContain(f.hidden.id.toUpperCase());
    const expectedFrames = f.content.spatial!.frames.map(({ x, y, width, height }, blockIndex) => ({
      blockIndex,
      x,
      y,
      width,
      height,
    }));
    const checkMap = (snapshot: { spatial?: unknown }) => {
      expect(snapshot.spatial).toEqual({ schemaVersion: 1, frames: expectedFrames });
      expect(JSON.stringify(snapshot.spatial)).not.toMatch(
        /blockId|SECTION|FUTURE|PRIVATE|HIDDEN|prompt|question|title|kind|notes|media|branch|isCorrect/,
      );
    };
    checkMap(f.hosted.snapshot);
    for (const snapshot of await f.publicSnapshots()) {
      checkMap(snapshot);
      expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|HIDDEN|FUTURE|UNREVEALED/);
    }
    await f.command({ action: "advance" });
    const before = await f.current();
    const synchronized = await f.presentationService.syncManyByCredentialHash([
      { sessionId: f.sessionId, projection: "host", controlTokenHash: hash(f.hosted.controlToken) },
      {
        sessionId: f.sessionId,
        projection: "participant",
        participantTokenHash: hash(f.guest.participantToken),
      },
      {
        sessionId: f.sessionId,
        projection: "companion",
        companionTokenHash: hash(f.companion.companionToken),
      },
    ]);
    expect(synchronized).toHaveLength(3);
    for (const result of synchronized) {
      expect(result).not.toBeNull();
      checkMap(result!.snapshot);
      expect(result!.snapshot.currentBlockIndex).toBe(0);
      if (result!.snapshot.projection === "participant")
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE|HIDDEN|FUTURE|UNREVEALED/);
    }
    for (const snapshot of await f.publicSnapshots()) {
      checkMap(snapshot);
      expect(snapshot.currentBlock.id).toBe(f.opening.id);
      expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|HIDDEN|FUTURE|UNREVEALED/);
    }
    expect(await f.current()).toEqual(before);
    expect(await f.presentationSessions.listResponses(f.sessionId)).toEqual([]);
  });

  it("keeps original attempts and recheck guards while targeted response snapshots retain the map", async () => {
    const f = await fixture();
    await f.command({ action: "advance" });
    await f.command({ action: "advance" });
    const open = await f.current();
    await expect(
      f.command({ action: "jump_to_block", targetBlockId: f.closing.id }),
    ).rejects.toMatchObject({
      code: "PHASE_CLOSED",
    });
    const ack = await f.presentationService.submitResponse({
      sessionId: f.sessionId,
      participantToken: f.guest.participantToken,
      expectedRevision: open.revision,
      blockId: f.main.id,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [f.main.question.choices[1]!.id], confidence: null },
    });
    expect(ack.snapshot.spatial).toEqual(f.hosted.snapshot.spatial);
    expect(ack.snapshot).toMatchObject({ responseSubmitted: true, currentBlockIndex: 1 });
    expect((await f.current()).questionOpenedAt).toEqual(open.questionOpenedAt);
    expect((await f.current()).questionClosesAt).toEqual(open.questionClosesAt);
    await f.command({ action: "advance" });
    await expect(
      f.command({ action: "jump_to_block", targetBlockId: f.closing.id }),
    ).rejects.toMatchObject({
      code: "PHASE_CLOSED",
    });
    await f.command({ action: "advance" });
    await f.command({ action: "advance" });
    expect((await f.current()).currentBlockIndex).toBe(2);
    await f.command({ action: "advance" });
    await f.command({ action: "jump_to_block", targetBlockId: f.closing.id });
    const returned = await f.command({ action: "return_to_path" });
    expect(returned).toMatchObject({
      currentBlockIndex: 2,
      phase: "question_reveal",
      acceptingResponses: false,
    });
    expect(returned.spatial).toEqual(f.hosted.snapshot.spatial);
    expect(await f.presentationSessions.listResponses(f.sessionId)).toHaveLength(1);
    const timeline = await f.presentationSessions.listTimeline(f.sessionId);
    expect(timeline.filter((event) => event.type === "question.launched")).toHaveLength(2);
    expect(timeline.filter((event) => event.type === "question.revealed")).toHaveLength(2);
  });

  it.each([
    [13, true],
    [14, false],
  ] as const)("omits the map for document %i with spatial enabled=%s", async (version, enabled) => {
    const f = await fixture(version, enabled);
    expect(f.hosted.snapshot).not.toHaveProperty("spatial");
    for (const snapshot of await f.publicSnapshots())
      expect(snapshot).not.toHaveProperty("spatial");
  });
});
