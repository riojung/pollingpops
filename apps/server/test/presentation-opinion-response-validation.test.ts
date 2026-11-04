import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { io as createClient, type Socket } from "socket.io-client";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationSessionResponseSchema,
  type PresentationResponseAck,
  type PresentationSessionResponse,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { presentationParticipantTokenHash } from "../src/presentation-session-service.js";
import { attachRealtime } from "../src/realtime.js";

async function fixture() {
  const workspaceId = randomUUID(),
    sessionId = randomUUID(),
    participantId = randomUUID();
  const participantToken = `participant-${randomUUID()}`;
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
    FEATURE_PRESENTATIONS: "true",
    FEATURE_PRESENTATION_REALTIME: "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const built = await buildApp(config, {
    repository: new MemoryRepository({ initialWorkspaceId: workspaceId }),
    cache: new MemorySessionCache(),
  });
  const blockId = randomUUID(),
    choiceIds = [randomUUID(), randomUUID(), randomUUID()];
  const content = PresentationContentSchema.parse({
    title: "Multi-poll response validation",
    schemaVersion: 9,
    blocks: [
      {
        id: blockId,
        kind: "question",
        question: {
          id: randomUUID(),
          type: "poll",
          prompt: "Choose up to two priorities",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          maxSelections: 2,
          choices: choiceIds.map((id, index) => ({
            id,
            label: `Priority ${index + 1}`,
            isCorrect: false,
          })),
          timeLimitSeconds: 60,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
  const now = new Date();
  await built.presentationSessions.createSession({
    id: sessionId,
    workspaceId,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: "7123456",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    revision: 1,
    settings: { timeMode: "flex" },
    trustMode: "learning",
    eventSeq: 7,
    questionOpenedAt: now,
    questionClosesAt: null,
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3_600_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  await built.presentationSessions.addParticipant({
    id: participantId,
    workspaceId,
    sessionId,
    nickname: "Opinion participant",
    tokenHash: presentationParticipantTokenHash(participantToken),
    joinedAt: now,
    lastSeenAt: now,
  });
  return {
    ...built,
    config,
    workspaceId,
    sessionId,
    participantId,
    participantToken,
    blockId,
    choiceIds,
  };
}

type ResponseOutcome = {
  statusCode?: number;
  data?: PresentationResponseAck;
  error?: { code: string };
};

describe("Presentation multi-poll mixed response validation", () => {
  it.each(["REST", "socket"] as const)(
    "rejects mixed payloads through %s before durable acceptance and permits a valid retry",
    async (transport) => {
      const f = await fixture();
      const httpServer = createServer();
      let realtime: Awaited<ReturnType<typeof attachRealtime>> | undefined;
      let socket: Socket | undefined;
      try {
        if (transport === "socket") {
          await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
          const address = httpServer.address();
          if (!address || typeof address === "string") throw new Error("Test server did not bind");
          realtime = await attachRealtime(httpServer, f.sessions, f.config, f.metrics, undefined, {
            service: f.presentationService,
          });
          socket = createClient(`http://127.0.0.1:${address.port}`, {
            transports: ["websocket"],
            reconnection: false,
            extraHeaders: { origin: f.config.WEB_ORIGIN },
          });
          await new Promise<void>((resolve, reject) => {
            socket!.once("connect", resolve);
            socket!.once("connect_error", reject);
          });
        }
        const idempotencyKey = randomUUID();
        const submit = async (response: PresentationSessionResponse): Promise<ResponseOutcome> => {
          const payload = {
            participantToken: f.participantToken,
            blockId: f.blockId,
            expectedRevision: 1,
            idempotencyKey,
            response,
          };
          if (transport === "REST") {
            const result = await f.app.inject({
              method: "POST",
              url: `/v1/presentation-sessions/${f.sessionId}/responses`,
              payload,
            });
            const body = result.json<PresentationResponseAck & { error?: { code: string } }>();
            return {
              statusCode: result.statusCode,
              ...(body.error ? { error: body.error } : { data: body }),
            };
          }
          return new Promise<ResponseOutcome>((resolve) =>
            socket!.emit(
              "presentation.response.submit",
              { sessionId: f.sessionId, ...payload },
              resolve,
            ),
          );
        };
        const acceptance = vi.spyOn(f.presentationSessions, "acceptResponse");
        const before = (await f.presentationSessions.getSessionById(f.sessionId))!;
        const timeline = await f.presentationSessions.listTimeline(f.sessionId);
        const choices = { choiceIds: f.choiceIds.slice(0, 2) };
        for (const extra of [
          { numericValue: "12" },
          { ratingValue: 3 },
          { numericValue: "12", ratingValue: 3 },
        ]) {
          const response = { ...choices, ...extra };
          // These are bounded wire payloads; their rejection must occur before the repository.
          expect(PresentationSessionResponseSchema.safeParse(response).success).toBe(true);
          const rejected = await submit(response);
          if (transport === "REST") expect(rejected.statusCode).toBe(422);
          expect(rejected.error?.code).toBe("VALIDATION_ERROR");
          expect(rejected.data).toBeUndefined();
          expect(acceptance).not.toHaveBeenCalled();
          expect(await f.presentationSessions.getSessionById(f.sessionId)).toEqual(before);
          expect(await f.presentationSessions.listResponses(f.sessionId)).toEqual([]);
          expect(await f.presentationSessions.listTimeline(f.sessionId)).toEqual(timeline);
          expect(
            await f.presentationSessions.findResponseByIdempotencyKey(
              f.sessionId,
              f.participantId,
              idempotencyKey,
            ),
          ).toBeNull();
          expect(
            await f.presentationService.getHostSnapshot(f.workspaceId, f.sessionId),
          ).toMatchObject({ responseCount: 0, seq: before.eventSeq });
        }
        const valid = await submit(choices);
        if (transport === "REST") expect(valid.statusCode).toBe(202);
        expect(valid.error).toBeUndefined();
        expect(valid.data).toMatchObject({
          accepted: true,
          duplicate: false,
          idempotencyKey,
          snapshot: { responseSubmitted: true, responseResult: null },
        });
        expect(acceptance).toHaveBeenCalledTimes(1);
        const saved = await f.presentationSessions.listResponses(f.sessionId);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ response: choices, correct: null, score: 0 });
        expect(
          await f.presentationSessions.findResponseByIdempotencyKey(
            f.sessionId,
            f.participantId,
            idempotencyKey,
          ),
        ).toMatchObject({ id: valid.data!.responseId });
        expect((await f.presentationSessions.getSessionById(f.sessionId))!.eventSeq).toBe(
          before.eventSeq + 1,
        );
        expect(await f.presentationSessions.listTimeline(f.sessionId)).toEqual(timeline);
      } finally {
        vi.restoreAllMocks();
        socket?.disconnect();
        await realtime?.close();
        if (httpServer.listening)
          await new Promise<void>((resolve, reject) =>
            httpServer.close((error) => (error ? reject(error) : resolve())),
          );
        await f.app.close();
      }
    },
  );
});
