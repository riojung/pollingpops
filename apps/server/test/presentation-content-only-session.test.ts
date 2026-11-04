import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  type PresentationTimeMode,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import { PresentationSessionService } from "../src/presentation-session-service.js";
import { StorageService } from "../src/storage.js";

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  FEATURE_PRESENTATIONS: "true",
  LOG_LEVEL: "silent",
});

async function fixture(timeMode: PresentationTimeMode = "timed") {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const presentationId = randomUUID();
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
  const draft = PresentationDraftSchema.parse({
    title: "Ordinary project update",
    schemaVersion: 2,
    blocks: ["Context", "Next steps"].map((title) => {
      const id = randomUUID();
      return {
        id,
        kind: "content",
        layout: "title_body",
        textElements: [
          { id: `${id}:title`, role: "title", text: title, region: "top_center", order: 0 },
          {
            id: `${id}:body`,
            role: "body",
            text: "Discuss the project without requiring an assessment.",
            region: "middle_center",
            order: 0,
          },
        ],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Private presenter cue",
        citations: [{ locator: "internal", excerpt: "Private source excerpt" }],
      };
    }),
  });
  const content = PresentationContentSchema.parse(draft);
  const now = new Date();
  await presentations.createPresentation({
    id: presentationId,
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
      presentationId,
      version: 1,
      content,
      contentSchemaVersion: 2,
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
  return {
    workspaceId,
    userId,
    presentationId,
    repository,
    sessions,
    service,
    hosted,
    content,
    version,
  };
}

function expectNoQuestionState(snapshot: unknown) {
  expect(snapshot).toMatchObject({
    questionOpenedAt: null,
    questionClosesAt: null,
    acceptingResponses: false,
  });
  expect(snapshot).not.toHaveProperty("competitionStandings");
  const fields = { ...(snapshot as Record<string, unknown>) };
  if (fields.projection === "host") delete fields.presenter;
  const serialized = JSON.stringify(fields);
  expect(serialized).not.toContain("Private presenter cue");
  expect(serialized).not.toContain("Private source excerpt");
}

describe("content-only Presentation sessions", () => {
  it.each(["timed", "flex"] as const)(
    "runs every slide, reconnects, replays durable controls and reconciles an unassessed %s report",
    async (timeMode) => {
      const { workspaceId, userId, sessions, service, hosted, content, version } =
        await fixture(timeMode);
      const sessionId = hosted.snapshot.sessionId;
      const joined = await service.join(hosted.snapshot.code, "River");
      await service.join(hosted.snapshot.code, "Sky");
      expect(joined.snapshot.standing).toBeNull();
      const companion = await service.createCompanionPass({
        workspaceId,
        userId,
        sessionId,
        requestId: randomUUID(),
      });
      const start = {
        sessionId,
        controlToken: hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "advance" as const,
      };
      const first = await service.command(start);
      expect(first).toMatchObject({
        phase: "content",
        revision: 1,
        currentBlockIndex: 0,
        currentBlock: { id: content.blocks[0]!.id, kind: "content" },
        participantCount: 2,
        responseCount: 0,
      });
      expectNoQuestionState(first);
      await expect(service.command(start)).resolves.toMatchObject({
        revision: 1,
        phase: "content",
      });
      await expect(service.command({ ...start, commandId: randomUUID() })).rejects.toMatchObject({
        code: "STALE_SESSION",
      });
      const reconnected = await service.sync({
        sessionId,
        projection: "participant",
        participantToken: joined.participantToken,
        afterSeq: joined.snapshot.seq,
      });
      expect(reconnected.resetRequired).toBe(true);
      expect(reconnected.snapshot).toMatchObject({
        currentBlock: { id: content.blocks[0]!.id },
        standing: null,
        responseSubmitted: false,
        responseReceipt: null,
        responseResult: null,
      });
      expectNoQuestionState(reconnected.snapshot);
      await expect(
        service.submitResponse({
          sessionId,
          participantToken: joined.participantToken,
          blockId: content.blocks[0]!.id,
          expectedRevision: first.revision,
          idempotencyKey: randomUUID(),
          response: { choiceIds: [randomUUID()] },
        }),
      ).rejects.toMatchObject({ code: "STALE_SESSION" });
      await expect(sessions.listResponses(sessionId)).resolves.toEqual([]);

      const second = await service.companionCommand({
        sessionId,
        companionToken: companion.companionToken,
        commandId: randomUUID(),
        expectedRevision: 1,
        action: "advance",
      });
      expect(second).toMatchObject({
        phase: "content",
        revision: 2,
        currentBlockIndex: 1,
        currentBlock: { id: content.blocks[1]!.id, kind: "content" },
        resultSummary: null,
        primaryAction: "advance",
      });
      expectNoQuestionState(second);
      expect(
        (await service.getParticipantSnapshot(sessionId, joined.participantToken)).snapshot,
      ).toMatchObject({ phase: "content", currentBlockIndex: 1, standing: null });
      const cohost = await service.createControlPass({
        workspaceId,
        userId,
        sessionId,
        requestId: randomUUID(),
      });
      const finish = {
        ...start,
        controlToken: cohost.controlToken,
        commandId: randomUUID(),
        expectedRevision: 2,
      };
      const finished = await service.command(finish);
      expect(finished).toMatchObject({
        status: "finished",
        phase: "finished",
        revision: 3,
        currentBlockIndex: 1,
      });
      expect(finished.finishedAt).not.toBeNull();
      expectNoQuestionState(finished);
      for (const command of [
        { ...start, controlToken: cohost.controlToken },
        finish,
        { ...finish, commandId: randomUUID(), expectedRevision: 3 },
      ]) {
        await expect(service.command(command)).resolves.toMatchObject({
          phase: "finished",
          revision: 3,
          seq: finished.seq,
        });
      }
      const completedCompanion = await service.getCompanionSnapshot(
        sessionId,
        companion.companionToken,
      );
      expect(completedCompanion).toMatchObject({ primaryAction: "none", resultSummary: null });
      expectNoQuestionState(completedCompanion);
      expect(
        (await service.getParticipantSnapshot(sessionId, joined.participantToken)).snapshot,
      ).toMatchObject({ phase: "finished", standing: null, responseResult: null });
      const listed = (await service.listHostSnapshots(workspaceId))[0]!;
      expect(listed).toMatchObject({
        participantCount: 2,
        participants: [{ nickname: "River" }, { nickname: "Sky" }],
      });
      expect(listed.leaderboard).toEqual(listed.participants);
      const timeline = await sessions.listTimeline(sessionId);
      expect(timeline.map((event) => [event.type, event.blockId])).toEqual([
        ["content.presented", content.blocks[0]!.id],
        ["content.presented", content.blocks[1]!.id],
        ["presentation.finished", null],
      ]);
      const pending = await service.getReport(workspaceId, sessionId, true);
      expect(pending).toMatchObject({
        reportStatus: "pending",
        sessionContext: { timeMode },
        report: {
          schemaVersion: 1,
          presentationVersionId: version.id,
          participantCount: 2,
          responseCount: 0,
          leaderboard: [],
          recovery: [],
          evidenceNote:
            "This report records participant join counts and the sequence of slides presented.",
          evidence: content.blocks.map((block, blockIndex) => ({
            blockId: block.id,
            blockIndex,
            kind: "content",
            assessmentStatus: "not_assessed",
          })),
        },
      });
      for (const entry of pending.report!.evidence) {
        expect(entry).not.toHaveProperty("accuracyPercent");
        expect(entry).not.toHaveProperty("totalScore");
      }
      expect(JSON.stringify(pending)).not.toContain("Private presenter cue");
      const worker = new PresentationReportWorker(sessions, 60_000);
      await expect(worker.runOnce()).resolves.toBe("completed");
      await expect(worker.runOnce()).resolves.toBe("idle");
      const ready = await service.getReport(workspaceId, sessionId, true);
      expect(ready.reportStatus).toBe("ready");
      expect(ready.report).toEqual(pending.report);
      await expect(sessions.getSessionById(sessionId)).resolves.toMatchObject({
        content,
        status: "finished",
        revision: 3,
      });
    },
  );

  it("finishes a content-only legacy REST flow with no participants or fabricated outcomes", async () => {
    const { workspaceId, userId, sessions, service, hosted } = await fixture();
    const input = {
      workspaceId,
      userId,
      sessionId: hosted.snapshot.sessionId,
      requestId: randomUUID(),
    };
    await expect(service.advance({ ...input, expectedRevision: 0 })).resolves.toMatchObject({
      phase: "content",
      currentBlockIndex: 0,
      revision: 1,
    });
    await expect(service.advance({ ...input, expectedRevision: 1 })).resolves.toMatchObject({
      phase: "content",
      currentBlockIndex: 1,
      revision: 2,
    });
    await expect(service.advance({ ...input, expectedRevision: 2 })).resolves.toMatchObject({
      phase: "finished",
      revision: 3,
    });
    await expect(service.advance({ ...input, expectedRevision: 3 })).resolves.toMatchObject({
      phase: "finished",
      revision: 3,
    });
    expect((await sessions.listTimeline(input.sessionId)).map((event) => event.type)).toEqual([
      "content.presented",
      "content.presented",
      "presentation.finished",
    ]);
    const { report } = await service.getReport(workspaceId, input.sessionId);
    expect(report).toMatchObject({
      participantCount: 0,
      responseCount: 0,
      leaderboard: [],
      recovery: [],
    });
    expect(
      report!.evidence.every(
        (entry) => entry.kind === "content" && entry.assessmentStatus === "not_assessed",
      ),
    ).toBe(true);
  });
});
