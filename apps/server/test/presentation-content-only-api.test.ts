import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  PresentationHostSnapshotSchema,
  PresentationReportEnvelopeSchema,
  PresentationRestV1CreateSessionResponseSchema,
  PresentationRestV1JoinSessionResponseSchema,
  PresentationRestV1ParticipantSnapshotResponseSchema,
  type PresentationDraft,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";

const workspaceId = "10000000-0000-4000-8000-00000000c001";
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup() {
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
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
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
      LOG_LEVEL: "silent",
    }),
    {
      repository,
      cache: new MemorySessionCache(),
    },
  );
  app = built.app;
  const email = "content-only-presenter@example.com";
  const verification = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(verification.json<{ debugUrl: string }>().debugUrl).searchParams.get(
    "token",
  )!;
  const signedIn = await verifyEmailAndSignIn(app, `/v1/auth/verify?token=${token}`, email);
  const cookies = signedIn.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  return { ...built, cookie, repository };
}

function contentDeck(): PresentationDraft {
  return {
    title: "Project handoff",
    description: "An ordinary presentation without assessments",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: ["Agree on the outcome", "Name the next step"].map((title, index) => {
      const id = randomUUID();
      return {
        id,
        kind: "content" as const,
        layout: "title_body" as const,
        textElements: [
          {
            id: `${id}:title`,
            role: "title" as const,
            text: title,
            region: "top_center" as const,
            order: 0,
          },
          {
            id: `${id}:body`,
            role: "body" as const,
            text: `Public content for slide ${index + 1}.`,
            region: "middle_center" as const,
            order: 0,
          },
        ],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: `Private preparation for slide ${index + 1}.`,
      };
    }),
  };
}

async function createDraft(target: FastifyInstance, cookie: string, draft = contentDeck()) {
  const created = await target.inject({
    method: "POST",
    url: "/v1/presentations",
    headers: { cookie },
    payload: { title: draft.title, description: draft.description },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json<{ presentation: { id: string } }>().presentation.id;
  const mutation = { draft, expectedRevision: 0, mutationId: randomUUID(), schemaVersion: 2 };
  const saved = await target.inject({
    method: "PUT",
    url: `/v1/presentations/${id}/draft`,
    headers: { cookie },
    payload: mutation,
  });
  expect(saved.statusCode).toBe(200);
  return { id, draft, mutation };
}

describe("content-only Presentation API", () => {
  it.each([0, 1])(
    "saves, publishes, presents and reports slides with %i attendees and no artificial assessment results",
    async (attendeeCount) => {
      const built = await setup();
      const { cookie } = built;
      const target = built.app;
      const fixture = await createDraft(target, cookie);
      const savedRetry = await target.inject({
        method: "PUT",
        url: `/v1/presentations/${fixture.id}/draft`,
        headers: { cookie },
        payload: fixture.mutation,
      });
      expect(savedRetry.statusCode).toBe(200);
      expect(savedRetry.json()).toMatchObject({
        presentation: { draftRevision: 1, draft: fixture.draft },
      });
      const reloaded = await target.inject({
        method: "GET",
        url: `/v1/presentations/${fixture.id}`,
        headers: { cookie },
      });
      expect(reloaded.json()).toMatchObject({ presentation: { draft: fixture.draft } });
      const publication = await target.inject({
        method: "POST",
        url: `/v1/presentations/${fixture.id}/publish`,
        headers: { cookie },
        payload: { expectedDraftRevision: 1 },
      });
      expect(publication.statusCode, publication.body).toBe(200);
      const version = publication.json<{ version: { id: string; contentHash: string } }>().version;
      const publicationRetry = await target.inject({
        method: "POST",
        url: `/v1/presentations/${fixture.id}/publish`,
        headers: { cookie },
        payload: { expectedDraftRevision: 1 },
      });
      expect(publicationRetry.json()).toMatchObject({
        version: { id: version.id, contentHash: version.contentHash },
      });

      const laterDraft = structuredClone(fixture.draft);
      const laterSlide = laterDraft.blocks[0]!;
      if (laterSlide.kind !== "content") throw new Error("Expected content slide");
      laterSlide.textElements[0]!.text = "Unpublished edits stay backstage";
      const laterSaved = await target.inject({
        method: "PUT",
        url: `/v1/presentations/${fixture.id}/draft`,
        headers: { cookie },
        payload: {
          draft: laterDraft,
          expectedRevision: 1,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(laterSaved.statusCode).toBe(200);
      const stalePublication = await target.inject({
        method: "POST",
        url: `/v1/presentations/${fixture.id}/publish`,
        headers: { cookie },
        payload: { expectedDraftRevision: 1 },
      });
      expect(stalePublication.statusCode).toBe(409);

      const hosted = await target.inject({
        method: "POST",
        url: "/v1/presentation-sessions",
        headers: { cookie },
        payload: { presentationId: fixture.id },
      });
      expect(hosted.statusCode, hosted.body).toBe(201);
      const { snapshot: lobby, controlToken } = PresentationRestV1CreateSessionResponseSchema.parse(
        hosted.json(),
      );
      expect(lobby).not.toHaveProperty("competitionStandings");
      const sessionId = lobby.sessionId;
      let participantToken: string | undefined;
      if (attendeeCount) {
        const joined = await target.inject({
          method: "POST",
          url: "/v1/presentation-sessions/join",
          payload: { code: lobby.code, nickname: "River" },
        });
        expect(joined.statusCode).toBe(201);
        const result = PresentationRestV1JoinSessionResponseSchema.parse(joined.json());
        participantToken = result.participantToken;
        expect(result.snapshot.standing).toBeNull();
      }
      const command = (expectedRevision: number) => ({
        sessionId,
        controlToken,
        action: "advance" as const,
        commandId: randomUUID(),
        expectedRevision,
      });
      const start = command(0);
      const first = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: start,
      });
      expect(first.statusCode, first.body).toBe(200);
      const firstSnapshot = PresentationHostSnapshotSchema.parse(first.json().snapshot);
      expect(firstSnapshot).toMatchObject({
        phase: "content",
        revision: 1,
        currentBlockIndex: 0,
        questionOpenedAt: null,
        questionClosesAt: null,
        responseCount: 0,
      });
      expect(firstSnapshot.currentBlock).toMatchObject({
        textElements: expect.arrayContaining([
          expect.objectContaining({ text: "Agree on the outcome" }),
        ]),
      });
      const startRetry = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: start,
      });
      expect(startRetry.statusCode).toBe(200);
      expect(startRetry.json()).toMatchObject({ snapshot: { revision: 1, currentBlockIndex: 0 } });

      if (participantToken) {
        const viewing = await target.inject({
          method: "GET",
          url: `/v1/presentation-sessions/${sessionId}/participant`,
          headers: { authorization: `Bearer ${participantToken}` },
        });
        const participant = PresentationRestV1ParticipantSnapshotResponseSchema.parse(
          viewing.json(),
        ).snapshot;
        expect(participant).toMatchObject({
          phase: "content",
          standing: null,
          questionOpenedAt: null,
          questionClosesAt: null,
          acceptingResponses: false,
        });
        expect(JSON.stringify(participant)).not.toContain("Private preparation");
        expect(JSON.stringify(participant)).not.toContain("Unpublished edits");
        const invalidResponse = await target.inject({
          method: "POST",
          url: `/v1/presentation-sessions/${sessionId}/responses`,
          payload: {
            participantToken,
            blockId: fixture.draft.blocks[0]!.id,
            expectedRevision: 1,
            idempotencyKey: randomUUID(),
            response: { choiceIds: [randomUUID()] },
          },
        });
        expect(invalidResponse.statusCode).toBe(409);
      }

      const second = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: command(1),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({
        snapshot: { phase: "content", revision: 2, currentBlockIndex: 1 },
      });
      const finish = command(2);
      const finished = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: finish,
      });
      expect(finished.statusCode).toBe(200);
      expect(finished.json()).toMatchObject({
        snapshot: { phase: "finished", status: "finished", revision: 3, responseCount: 0 },
      });
      expect(finished.json().snapshot).not.toHaveProperty("competitionStandings");
      const finishRetry = await target.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${sessionId}/command`,
        payload: finish,
      });
      expect(finishRetry.statusCode).toBe(200);
      expect(finishRetry.json()).toMatchObject({ snapshot: { revision: 3, phase: "finished" } });
      if (participantToken) {
        const reconnect = await target.inject({
          method: "GET",
          url: `/v1/presentation-sessions/${sessionId}/participant`,
          headers: { authorization: `Bearer ${participantToken}` },
        });
        expect(
          PresentationRestV1ParticipantSnapshotResponseSchema.parse(reconnect.json()),
        ).toMatchObject({ snapshot: { phase: "finished", standing: null } });
      }
      await expect(built.presentationReportWorker.runUntilIdle()).resolves.toEqual([
        "completed",
        "idle",
      ]);
      const reportReply = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/report`,
        headers: { cookie },
      });
      expect(reportReply.statusCode).toBe(200);
      const envelope = PresentationReportEnvelopeSchema.parse(reportReply.json());
      expect(envelope).toMatchObject({
        reportStatus: "ready",
        report: {
          presentationVersionId: version.id,
          participantCount: attendeeCount,
          responseCount: 0,
          leaderboard: [],
          recovery: [],
          evidence: [
            { kind: "content", assessmentStatus: "not_assessed" },
            { kind: "content", assessmentStatus: "not_assessed" },
          ],
          timeline: [
            { type: "content.presented" },
            { type: "content.presented" },
            { type: "presentation.finished" },
          ],
        },
      });
      expect(JSON.stringify(envelope)).not.toContain("Private preparation");
      expect(JSON.stringify(envelope)).not.toContain("Unpublished edits");
      const frozen = await built.presentations.getPresentationVersion(workspaceId, version.id);
      expect(frozen?.content.blocks).toEqual(fixture.draft.blocks);
      expect(frozen?.contentHash).toBe(version.contentHash);
      const unauthorized = await target.inject({
        method: "GET",
        url: `/v1/presentation-sessions/${sessionId}/report`,
      });
      expect(unauthorized.statusCode).toBe(401);
    },
  );

  it("keeps empty decks and unscanned content-slide media behind publish validation", async () => {
    const built = await setup();
    for (const kind of ["empty", "unscanned-image"] as const) {
      const draft = contentDeck();
      if (kind === "empty") draft.blocks = [];
      else {
        const slide = draft.blocks[0]!;
        if (slide.kind !== "content") throw new Error("Expected content slide");
        slide.mediaId = randomUUID();
        slide.mediaAlt = "A private image waiting for its scan";
        await built.repository.createMediaAsset({
          id: slide.mediaId,
          workspaceId,
          objectKey: `quarantine/${slide.mediaId}`,
          mimeType: "image/png",
          sizeBytes: 128,
          scanStatus: "pending",
          altText: slide.mediaAlt,
          createdAt: new Date(),
        });
      }
      const fixture = await createDraft(built.app, built.cookie, draft);
      const published = await built.app.inject({
        method: "POST",
        url: `/v1/presentations/${fixture.id}/publish`,
        headers: { cookie: built.cookie },
        payload: { expectedDraftRevision: 1 },
      });
      expect(published.statusCode).toBe(422);
      expect(published.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      expect(
        (await built.presentations.getPresentation(workspaceId, fixture.id))?.currentVersionId,
      ).toBeNull();
    }
  });
});
