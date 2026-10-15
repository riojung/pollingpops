import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationContentSchema, type SummarySourceKind } from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationSessionRepository,
  createSessionSummaryRepository,
  createSurveyRepository,
} from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { generateReport } from "../src/reporting.js";
import { generatePresentationReport } from "../src/presentation-reporting.js";
import { hashToken } from "../src/security.js";
import type { createSessionSummaryExportService } from "../src/session-summary-export.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(
  options: {
    enabled?: boolean;
    plan?: "free" | "pro";
    allowlisted?: boolean;
    summaryExports?: ReturnType<typeof createSessionSummaryExportService>;
  } = {},
) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({
    initialWorkspaceId: workspaceId,
    initialPlan: options.plan ?? "pro",
  });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_SESSION_SUMMARIES: String(options.enabled ?? true),
    FEATURE_AUDIENCE_SCOPES: "true",
    FEATURE_FEEDBACK_ROOMS: "true",
    FEATURE_SURVEYS: "true",
    CORE_PARITY_WORKSPACE_ALLOWLIST: options.allowlisted === false ? "" : workspaceId,
  });
  const built = await buildApp(config, {
    repository,
    cache: new MemorySessionCache(),
    summaryExports: options.summaryExports,
  });
  const app = built.app;
  apps.push(app);
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "summary-fixture@example.test", segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token");
  const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
  const creator = (await repository.getCreatorBySession(
    hashToken(cookie.slice(cookie.indexOf("=") + 1)),
    new Date(),
  ))!;
  return { ...built, repository, config, workspaceId, creator, headers: { cookie } };
}

async function source(f: Awaited<ReturnType<typeof fixture>>, kind: SummarySourceKind) {
  const now = new Date();
  const expiry = new Date(Date.now() + 30 * 86400_000);
  const id = randomUUID();
  if (kind === "round") {
    const state = createGameState({
      sessionId: id,
      code: "7123456",
      quiz: { title: "Synthetic frozen Round", description: "", questions: [] },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    state.phase = "finished";
    await f.repository.createSession({
      id,
      workspaceId: f.workspaceId,
      quizVersionId: randomUUID(),
      hostId: f.creator.userId,
      hostTokenHash: hashToken("synthetic-private-host"),
      state,
      expiresAt: now,
      retentionExpiresAt: expiry,
      createdAt: now,
      updatedAt: now,
    });
    const report = generateReport(state, expiry);
    report.participants.push({
      participantId: randomUUID(),
      nickname: "EXCLUDED_SYNTHETIC_IDENTITY",
      score: 0,
      correctCount: 0,
      answerCount: 0,
    });
    await f.repository.saveReport(f.workspaceId, report);
    return { kind, id };
  }
  if (kind === "presentation") {
    const sessions = createPresentationSessionRepository(f.repository);
    const content = PresentationContentSchema.parse({
      schemaVersion: 2,
      title: "Synthetic Presentation",
      description: "",
      blocks: [
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "poll",
            prompt: "Synthetic Presentation poll",
            purpose: "opinion",
            confidence: "off",
            delivery: "main",
            conceptKeys: [],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 20,
            basePoints: 0,
            explanation: "",
            mediaId: null,
            mediaAlt: null,
            choices: [
              { id: randomUUID(), label: "Synthetic choice A", isCorrect: false },
              { id: randomUUID(), label: "Synthetic choice B", isCorrect: false },
            ],
          },
        },
      ],
    });
    await sessions.createSession({
      id,
      workspaceId: f.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: content.title,
      content,
      code: "8123456",
      status: "active",
      phase: "lobby",
      currentBlockIndex: 0,
      revision: 0,
      createdBy: f.creator.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: expiry,
      retentionExpiresAt: expiry,
    });
    const finished = (await sessions.transitionSession({
      workspaceId: f.workspaceId,
      sessionId: id,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: 0,
      status: "finished",
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    }))!;
    const job = (await sessions.claimReportJob(new Date(), new Date(Date.now() + 60_000)))!;
    const report = generatePresentationReport({
      session: finished,
      participants: [],
      responses: [],
      timeline: [],
    });
    report.leaderboard.push({
      id: randomUUID(),
      nickname: "EXCLUDED_SYNTHETIC_IDENTITY",
      score: 0,
      rank: 1,
    });
    await sessions.completeReportJob(job, {
      reportId: job.reportId,
      sessionId: id,
      schemaVersion: report.schemaVersion,
      payload: report,
      generatedAt: now,
    });
    return { kind, id };
  }
  const created = await f.app.inject({
    method: "POST",
    url: "/v1/surveys",
    headers: f.headers,
    payload: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
  });
  expect(created.statusCode, created.body).toBe(201);
  const surveyId = created.json().survey.id;
  const published = await f.app.inject({
    method: "POST",
    url: `/v1/surveys/${surveyId}/publish`,
    headers: f.headers,
    payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
  });
  expect(published.statusCode, published.body).toBe(200);
  const shared = await f.app.inject({
    method: "POST",
    url: `/v1/surveys/${surveyId}/rooms`,
    headers: f.headers,
    payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
  });
  expect(shared.statusCode, shared.body).toBe(201);
  const roomId = shared.json().room.id;
  const closed = await f.app.inject({
    method: "POST",
    url: `/v1/survey-rooms/${roomId}/close`,
    headers: f.headers,
    payload: { idempotencyKey: randomUUID() },
  });
  expect(closed.statusCode, closed.body).toBe(204);
  return { kind, id: roomId };
}

const path = (s: { kind: string; id: string }) => `/v1/session-summaries/${s.kind}/${s.id}`;
const featuresPath = (s: { kind: string; id: string }) =>
  `/v1/session-summaries/features?${new URLSearchParams(s)}`;
async function publish(
  f: Awaited<ReturnType<typeof fixture>>,
  s: { kind: string; id: string },
  extra = {},
) {
  const payload = {
    idempotencyKey: randomUUID(),
    expiresInDays: 7,
    allowDownloads: true,
    nextSteps: "Synthetic creator next steps",
    ...extra,
  };
  const response = await f.app.inject({
    method: "POST",
    url: `${path(s)}/shares`,
    headers: f.headers,
    payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json();
  const url = new URL(body.url);
  return {
    body,
    payload,
    publicPath: `/v1/shared-session-summaries/${body.share.id}`,
    headers: { authorization: `Bearer ${new URLSearchParams(url.hash.slice(1)).get("token")}` },
  };
}

describe("session summary APIs", () => {
  it.each(["revocation", "source deletion", "publisher demotion"] as const)(
    "withholds rendered bytes when %s occurs during export",
    async (mode) => {
      let duringRender = async () => {};
      const f = await fixture({
        summaryExports: {
          render: async () => {
            await duringRender();
            return {
              bytes: Buffer.from("%PDF-SYNTHETIC_SHOULD_NOT_ESCAPE"),
              contentType: "application/pdf",
              extension: "pdf",
            };
          },
          close: async () => {},
        },
      });
      const s = await source(f, "round");
      const link = await publish(f, s);
      duringRender = async () => {
        if (mode === "revocation")
          await f.app.inject({
            method: "DELETE",
            url: `${path(s)}/shares/${link.body.share.id}`,
            headers: f.headers,
          });
        if (mode === "source deletion") await f.repository.deleteSession(f.workspaceId, s.id);
        if (mode === "publisher demotion")
          f.repository.users.get(f.creator.userId)!.role = "viewer";
      };
      const response = await f.app.inject({
        method: "POST",
        url: `${link.publicPath}/export`,
        headers: link.headers,
        payload: { format: "pdf" },
      });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.body).not.toContain("SHOULD_NOT_ESCAPE");
    },
  );

  it.each(["round", "presentation", "survey"] as const)(
    "publishes and downloads one aggregate %s snapshot, then revokes every format",
    async (kind) => {
      const f = await fixture();
      const s = await source(f, kind);
      const preview = await f.app.inject({ url: path(s), headers: f.headers });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().capabilities).toMatchObject({
        canCreateShare: true,
        canRevokeShare: true,
        downloadFormats: ["pdf", "png", "xlsx"],
      });
      const link = await publish(f, s);
      expect(new URL(link.body.url).search).toBe("");
      expect(link.body).not.toHaveProperty("tokenHash");
      const publicRead = await f.app.inject({ url: link.publicPath, headers: link.headers });
      expect(publicRead.statusCode, publicRead.body).toBe(200);
      expect(publicRead.headers["cache-control"]).toContain("no-store");
      expect(publicRead.headers["x-robots-tag"]).toContain("noindex");
      expect(publicRead.json().summary).toEqual({
        ...preview.json().summary,
        nextSteps: link.payload.nextSteps,
      });
      expect(publicRead.body).not.toMatch(
        /EXCLUDED|tokenHash|actorId|workspaceId|participantId|sessionId|leaderboard/,
      );
      for (const [format, mime, signature] of [
        ["pdf", "application/pdf", "%PDF"],
        ["png", "image/png", "PNG"],
        ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK"],
      ] as const) {
        const download = await f.app.inject({
          method: "POST",
          url: `${link.publicPath}/export`,
          headers: link.headers,
          payload: { format, locale: "ja-JP" },
        });
        expect(download.statusCode, download.body.slice(0, 200)).toBe(200);
        expect(download.headers["content-type"]).toContain(mime);
        expect(download.rawPayload.subarray(0, 8).toString("latin1")).toContain(signature);
      }
      const replay = await f.app.inject({
        method: "POST",
        url: `${path(s)}/shares`,
        headers: f.headers,
        payload: link.payload,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toMatchObject({
        url: null,
        replayed: true,
        share: { id: link.body.share.id },
      });
      const revoke = await f.app.inject({
        method: "DELETE",
        url: `${path(s)}/shares/${link.body.share.id}`,
        headers: f.headers,
      });
      expect(revoke.statusCode, revoke.body).toBe(204);
      expect((await f.app.inject({ url: link.publicPath, headers: link.headers })).statusCode).toBe(
        404,
      );
      for (const format of ["pdf", "png", "xlsx"])
        expect(
          (
            await f.app.inject({
              method: "POST",
              url: `${link.publicPath}/export`,
              headers: link.headers,
              payload: { format },
            })
          ).statusCode,
        ).toBe(404);
    },
  );

  it("preserves accepted reads, exact retries and revocation while new writers are paused", async () => {
    const f = await fixture();
    const s = await source(f, "round");
    const link = await publish(f, s);
    f.config.FEATURE_SESSION_SUMMARIES = false;
    expect((await f.app.inject({ url: featuresPath(s), headers: f.headers })).json()).toEqual({
      enabled: true,
    });
    expect(
      (await f.app.inject({ url: path(s), headers: f.headers })).json().capabilities.canCreateShare,
    ).toBe(false);
    const replay = await f.app.inject({
      method: "POST",
      url: `${path(s)}/shares`,
      headers: f.headers,
      payload: link.payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `${path(s)}/shares`,
          headers: f.headers,
          payload: { ...link.payload, idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    expect((await f.app.inject({ url: link.publicPath, headers: link.headers })).statusCode).toBe(
      200,
    );
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `${path(s)}/shares/${link.body.share.id}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(204);
  });

  it.each(["round", "presentation", "survey"] as const)(
    "keeps paused feature probes scoped to the retained %s source",
    async (kind) => {
      const f = await fixture();
      const retained = await source(f, kind);
      const unrelated = await source(f, kind);
      await publish(f, retained);
      for (const gate of ["flag", "allowlist"] as const) {
        f.config.FEATURE_SESSION_SUMMARIES = gate !== "flag";
        f.config.CORE_PARITY_WORKSPACE_ALLOWLIST = gate === "allowlist" ? [] : [f.workspaceId];
        for (const [s, enabled] of [
          [retained, true],
          [unrelated, false],
          [{ kind, id: randomUUID() }, false],
        ] as const) {
          const response = await f.app.inject({ url: featuresPath(s), headers: f.headers });
          expect(response.statusCode, response.body).toBe(200);
          expect(response.json()).toEqual({ enabled });
        }
      }
      f.config.FEATURE_SESSION_SUMMARIES = false;
      const magic = await f.app.inject({
        method: "POST",
        url: "/v1/auth/magic-link",
        payload: {
          email: "summary-outsider@example.test",
          segment: "workplace",
          acceptPolicies: true,
        },
      });
      const token = new URL(magic.json().debugUrl).searchParams.get("token");
      const verified = await f.app.inject({ url: `/v1/auth/verify?token=${token}` });
      const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
      expect(
        (await f.app.inject({ url: featuresPath(retained), headers: { cookie } })).json(),
      ).toEqual({ enabled: false });
      if (kind === "round") await f.repository.deleteSession(f.workspaceId, retained.id);
      else if (kind === "presentation")
        await f.presentationSessions.deleteSession(f.workspaceId, retained.id);
      else await createSurveyRepository(f.repository).deleteRoom(f.workspaceId, retained.id);
      expect(
        (await f.app.inject({ url: featuresPath(retained), headers: f.headers })).json(),
      ).toEqual({ enabled: false });
    },
  );

  it.each(["round", "presentation", "survey"] as const)(
    "does not enable paused features for an expired %s snapshot",
    async (kind) => {
      const f = await fixture();
      const s = await source(f, kind);
      const preview = await f.app.inject({ url: path(s), headers: f.headers });
      expect(preview.statusCode, preview.body).toBe(200);
      const now = new Date();
      await createSessionSummaryRepository(f.repository).getOrCreateSnapshot({
        workspaceId: f.workspaceId,
        source: s,
        actorId: f.creator.userId,
        summary: preview.json().summary,
        expiresAt: new Date(now.getTime() + 60_000),
        now,
      });
      f.config.FEATURE_SESSION_SUMMARIES = false;
      expect((await f.app.inject({ url: featuresPath(s), headers: f.headers })).json()).toEqual({
        enabled: true,
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now.getTime() + 60_000);
      try {
        const response = await f.app.inject({ url: featuresPath(s), headers: f.headers });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json()).toEqual({ enabled: false });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("validates strict source query parameters before enabling feature controls", async () => {
    const f = await fixture();
    const id = randomUUID();
    for (const query of [
      "",
      "?kind=round",
      `?id=${id}`,
      `?kind=unknown&id=${id}`,
      "?kind=round&id=invalid",
      `?kind=round&id=${id}&extra=true`,
      `?kind=round&kind=survey&id=${id}`,
    ]) {
      const response = await f.app.inject({
        url: `/v1/session-summaries/features${query}`,
        headers: f.headers,
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
    expect(
      (await f.app.inject({ url: featuresPath({ kind: "round", id }), headers: f.headers })).json(),
    ).toEqual({ enabled: true });
  });

  it("rejects viewers, mismatched retries, missing/wrong capabilities and public note changes", async () => {
    const f = await fixture();
    const s = await source(f, "round");
    const link = await publish(f, s);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `${path(s)}/shares`,
          headers: f.headers,
          payload: { ...link.payload, nextSteps: "Changed intent" },
        })
      ).statusCode,
    ).toBe(409);
    expect((await f.app.inject({ url: link.publicPath })).statusCode).toBe(404);
    expect(
      (
        await f.app.inject({
          url: link.publicPath,
          headers: { authorization: `Bearer ${"a".repeat(43)}` },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `${link.publicPath}/export`,
          headers: link.headers,
          payload: { format: "pdf", nextSteps: "Changed public intent" },
        })
      ).statusCode,
    ).toBe(422);
    f.repository.users.get(f.creator.userId)!.role = "viewer";
    expect((await f.app.inject({ url: path(s), headers: f.headers })).statusCode).toBe(200);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `${path(s)}/shares`,
          headers: f.headers,
          payload: { idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.app.inject({
          method: "DELETE",
          url: `${path(s)}/shares/${link.body.share.id}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(403);
    expect((await f.app.inject({ url: link.publicPath, headers: link.headers })).statusCode).toBe(
      404,
    );
  });

  it("fences source deletion and links with downloads disabled", async () => {
    const f = await fixture();
    const s = await source(f, "round");
    const link = await publish(f, s, { allowDownloads: false });
    expect(
      (await f.app.inject({ url: link.publicPath, headers: link.headers })).json().downloadFormats,
    ).toEqual([]);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `${link.publicPath}/export`,
          headers: link.headers,
          payload: { format: "pdf" },
        })
      ).statusCode,
    ).toBe(404);
    await f.repository.deleteSession(f.workspaceId, s.id);
    expect((await f.app.inject({ url: link.publicPath, headers: link.headers })).statusCode).toBe(
      404,
    );
    expect(
      (await f.app.inject({ url: `${path(s)}/shares`, headers: f.headers })).json().shares,
    ).toEqual([]);
  });

  it.each([{ enabled: false }, { allowlisted: false }, { plan: "free" as const }])(
    "does not grant new sharing under %o",
    async (options) => {
      const f = await fixture(options);
      const s = await source(f, "round");
      const response = await f.app.inject({
        method: "POST",
        url: `${path(s)}/shares`,
        headers: f.headers,
        payload: { idempotencyKey: randomUUID() },
      });
      expect(response.statusCode).toBe(options.plan === "free" ? 402 : 404);
      expect(
        (await f.app.inject({ url: `${path(s)}/shares`, headers: f.headers })).json().shares,
      ).toEqual([]);
    },
  );
});
