import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type CreatorContext, type ScopedQnaInsightsCounts } from "@openround/db";
import { PresentationSessionInsightsEnvelopeSchema } from "@openround/contracts";
import {
  presentationInsightsFixture,
  presentationInsightsOpinionFixture,
} from "../../../packages/db/test/support/presentation-insights-conformance.js";
import { registerPresentationInsightsRoutes } from "../src/presentation-insights-routes.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import { MetricsService } from "../src/metrics.js";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture(ready = true, opinions = false) {
  const repository = new MemoryRepository(),
    f = opinions
      ? await presentationInsightsOpinionFixture(repository, true)
      : await presentationInsightsFixture(repository, "insights-api");
  if (!opinions) await f.finish();
  if (ready) await new PresentationReportWorker(f.sessions, 30000).runUntilIdle();
  const current = { actor: f.actor as CreatorContext | null, admitted: true },
    app = Fastify({ logger: false }),
    metrics = new MetricsService();
  apps.push(app);
  const consumeAdmission = vi.fn(async () => current.admitted);
  await registerPresentationInsightsRoutes(app, {
    repository,
    presentations: f.presentations,
    sessions: f.sessions,
    qna: f.qna,
    metrics,
    consumeAdmission,
    auth: {
      requireCreator: async (_request, reply) => {
        if (!current.actor) reply.code(401).send({ error: { code: "UNAUTHORIZED" } });
        return current.actor;
      },
      creatorFromRequest: async () => current.actor,
    },
  });
  const request = (id = f.session.id, suffix = "") =>
    app.inject({ url: `/v1/presentation-sessions/${id}/insights${suffix}` });
  const raw = [
    vi.spyOn(f.sessions, "listResponses"),
    vi.spyOn(f.sessions, "listParticipants"),
    vi.spyOn(f.sessions, "listTimeline"),
  ];
  for (const spy of raw) spy.mockRejectedValue(new Error("Raw evidence must not be scanned"));
  return { ...f, repository, current, app, metrics, consumeAdmission, request, raw };
}
function qna(
  f: Awaited<ReturnType<typeof fixture>>,
  count: number,
  sequence = 10,
): ScopedQnaInsightsCounts {
  return {
    status: "available",
    audienceSeq: sequence,
    asOf: f.now,
    publicQuestionCount: count,
    answeredQuestionCount: count ? 1 : 0,
    unansweredQuestionCount: count ? count - 1 : 0,
    upvoteCount: count,
  };
}
describe("Presentation session insights API", () => {
  it("derives pinned read-only creator insights without raw scans or private content", async () => {
    const f = await fixture(),
      before = await f.sessions.getReport(f.actor.workspaceId, f.session.id),
      source = await f.sessions.getSessionById(f.session.id);
    const response = await f.request(f.session.id.toUpperCase());
    expect(response.statusCode, response.body).toBe(200);
    const value = PresentationSessionInsightsEnvelopeSchema.parse(response.json());
    expect(value.status).toBe("ready");
    expect(value.insights).toMatchObject({
      sessionId: f.session.id,
      presentationVersionId: f.version.id,
      publishedVersion: 1,
      contentScope: "frozen_session",
      qna: { status: "not_enabled" },
    });
    expect(response.body).not.toMatch(
      /PRIVATE_|speakerNotes|correctValue|explanation|tokenHash|nickname|participantId|leaderboard/,
    );
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(await f.sessions.getReport(f.actor.workspaceId, f.session.id)).toEqual(before);
    expect(await f.sessions.getSessionById(f.session.id)).toEqual(source);
    for (const spy of f.raw) expect(spy).not.toHaveBeenCalled();
    expect(await f.metrics.render()).toContain(
      'openround_presentation_insights_reads_total{outcome="ready"} 1',
    );
  });
  it("returns cheap pending and failed states without counts or source publication reads", async () => {
    const f = await fixture(false),
      counts = vi.spyOn(f.qna, "getInsightsCounts"),
      rosters = vi.spyOn(f.sessions, "getRevealRosterCounts"),
      versions = vi.spyOn(f.presentations, "getPresentationVersion");
    const pending = await f.request();
    expect(pending.statusCode).toBe(202);
    expect(pending.json()).toEqual({ status: "pending", insights: null });
    const stored = (await f.sessions.getReport(f.actor.workspaceId, f.session.id))!;
    vi.spyOn(f.sessions, "getReport").mockResolvedValue({ ...stored, status: "failed" });
    const failed = await f.request();
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({ status: "failed", insights: null });
    expect(counts).not.toHaveBeenCalled();
    expect(rosters).not.toHaveBeenCalled();
    expect(versions).not.toHaveBeenCalled();
    for (const spy of f.raw) expect(spy).not.toHaveBeenCalled();
  });
  it("allows current viewer members and rejects missing cookie, cross-workspace and unknown sessions", async () => {
    const f = await fixture();
    f.repository.users.get(f.actor.userId)!.role = "viewer";
    expect((await f.request()).statusCode).toBe(200);
    expect((await f.request(randomUUID())).statusCode).toBe(404);
    const other = await presentationInsightsFixture(f.repository, "other-insights");
    await other.finish();
    expect((await f.request(other.session.id)).statusCode).toBe(404);
    f.current.actor = null;
    expect(
      (
        await f.app.inject({
          url: `/v1/presentation-sessions/${f.session.id}/insights`,
          headers: { authorization: "Bearer ROOM_OR_REVIEW_TOKEN" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it.each([
    "cookie",
    "membership",
    "account",
    "workspace",
    "session",
    "retention",
    "report",
  ] as const)("withholds evidence if %s authority changes during aggregation", async (kind) => {
    const f = await fixture(),
      original = f.sessions.getRevealRosterCounts.bind(f.sessions);
    vi.spyOn(f.sessions, "getRevealRosterCounts").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      if (kind === "cookie") f.current.actor = null;
      if (kind === "membership")
        f.repository.workspaceMembers.delete(`${f.actor.workspaceId}:${f.actor.userId}`);
      if (kind === "account") await f.repository.deleteAccount(f.actor.userId);
      if (kind === "workspace") await f.repository.claimWorkspaceMediaDeletion(f.actor.workspaceId);
      if (kind === "session") await f.sessions.deleteSession(f.actor.workspaceId, f.session.id);
      if (kind === "retention") {
        const source = (await f.sessions.getSessionById(f.session.id))!;
        vi.spyOn(f.sessions, "getSessionForWorkspace").mockResolvedValue({
          ...source,
          retentionExpiresAt: new Date(0),
        });
      }
      if (kind === "report") {
        const report = (await f.sessions.getReport(f.actor.workspaceId, f.session.id))!;
        vi.spyOn(f.sessions, "getReport").mockResolvedValue({
          ...report,
          generatedAt: new Date(0),
        });
      }
      return result;
    });
    const response = await f.request();
    expect(response.statusCode, response.body).toBe(404);
    expect(response.body).not.toContain('"insights"');
  });
  it("suppresses small current Q&A samples while preserving known zero", async () => {
    const f = await fixture(),
      counts = vi.spyOn(f.qna, "getInsightsCounts"),
      sequence = vi.spyOn(f.qna, "getInsightsSequence").mockResolvedValue(10);
    for (const count of [0, 1, 4, 5]) {
      counts.mockResolvedValue(qna(f, count));
      const response = await f.request();
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json().insights.qna;
      expect(result.status).toBe(count > 0 && count < 5 ? "suppressed" : "available");
      expect(result.publicQuestionCount).toBe(count > 0 && count < 5 ? null : count);
      if (result.status === "suppressed")
        expect([
          result.answeredQuestionCount,
          result.unansweredQuestionCount,
          result.upvoteCount,
        ]).toEqual([null, null, null]);
    }
    expect(sequence).toHaveBeenCalledTimes(4);
  });
  it("retries a changed Q&A sequence once and never returns the removed evidence", async () => {
    const f = await fixture(),
      counts = vi
        .spyOn(f.qna, "getInsightsCounts")
        .mockResolvedValueOnce(qna(f, 5, 10))
        .mockResolvedValueOnce(qna(f, 4, 11));
    vi.spyOn(f.qna, "getInsightsSequence").mockResolvedValue(11);
    const response = await f.request();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().insights.qna).toMatchObject({
      status: "suppressed",
      publicQuestionCount: null,
      audienceSeq: 11,
    });
    expect(counts).toHaveBeenCalledTimes(2);
  });
  it("degrades only Q&A after repeated snapshot changes or read failure", async () => {
    const f = await fixture(),
      counts = vi.spyOn(f.qna, "getInsightsCounts").mockResolvedValue(qna(f, 5, 10));
    vi.spyOn(f.qna, "getInsightsSequence").mockResolvedValue(11);
    const response = await f.request();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().insights.qna.status).toBe("unavailable");
    expect(counts).toHaveBeenCalledTimes(2);
    counts.mockRejectedValue(new Error("PRIVATE_DATABASE_DETAIL"));
    const failed = await f.request();
    expect(failed.statusCode).toBe(200);
    expect(failed.json().insights.qna.status).toBe("unavailable");
    expect(failed.body).not.toContain("PRIVATE_DATABASE_DETAIL");
  });
  it("keeps a missing legacy publication explicit and rejects mismatched version metadata", async () => {
    const f = await fixture(),
      versions = vi.spyOn(f.presentations, "getPresentationVersion").mockResolvedValue(null);
    const missing = await f.request();
    expect(missing.statusCode, missing.body).toBe(200);
    expect(missing.json().insights.publishedVersion).toBeNull();
    versions.mockResolvedValue({ ...f.version, presentationId: randomUUID() });
    expect((await f.request()).statusCode).toBe(404);
  });
  it("uses the shorter retained report expiry and fences changed report source identity", async () => {
    const f = await fixture(),
      stored = (await f.sessions.getReport(f.actor.workspaceId, f.session.id))!,
      expiresAt = new Date(Date.now() + 3600000);
    const report = vi.spyOn(f.sessions, "getReport").mockResolvedValue({ ...stored, expiresAt });
    const response = await f.request();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().insights.freshness.retentionExpiresAt).toBe(expiresAt.toISOString());
    report.mockResolvedValue({ ...stored, expiresAt: new Date(0) });
    expect((await f.request()).statusCode).toBe(404);
    report.mockResolvedValue({ ...stored });
    const original = f.sessions.getRevealRosterCounts.bind(f.sessions);
    vi.spyOn(f.sessions, "getRevealRosterCounts").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      report.mockResolvedValue({
        ...stored,
        payload: { ...(stored.payload as object), presentationVersionId: randomUUID() },
      });
      return result;
    });
    expect((await f.request()).statusCode).toBe(404);
  });
  it("rejects an oversized cached report before schema parsing or aggregate reads", async () => {
    const f = await fixture(),
      stored = (await f.sessions.getReport(f.actor.workspaceId, f.session.id))!;
    // Deliberately invalid timeline also proves parsing cannot precede the byte budget.
    vi.spyOn(f.sessions, "getReport").mockResolvedValue({
      ...stored,
      payload: { ...(stored.payload as object), timeline: "PRIVATE_" + "x".repeat(1024 * 1024) },
    });
    const rosters = vi.spyOn(f.sessions, "getRevealRosterCounts"),
      counts = vi.spyOn(f.qna, "getInsightsCounts"),
      sequence = vi.spyOn(f.qna, "getInsightsSequence"),
      versions = vi.spyOn(f.presentations, "getPresentationVersion");
    const response = await f.request();
    expect(response.statusCode, response.body).toBe(413);
    expect(response.json().error.code).toBe("INSIGHTS_LIMIT");
    expect(response.body).not.toContain("PRIVATE_");
    expect(rosters).not.toHaveBeenCalled();
    expect(counts).not.toHaveBeenCalled();
    expect(sequence).not.toHaveBeenCalled();
    expect(versions).not.toHaveBeenCalled();
    for (const raw of f.raw) expect(raw).not.toHaveBeenCalled();
  });
  it("fills ordinary poll and rating distributions from bounded counts while preserving cached reports", async () => {
    const f = await fixture(true, true),
      stored = await f.sessions.getReport(f.actor.workspaceId, f.session.id),
      counts = vi.spyOn(f.sessions, "getInsightsOpinionCounts");
    const response = await f.request();
    expect(response.statusCode, response.body).toBe(200);
    const questions = response.json().insights.participation.questions;
    expect(questions[0]).toMatchObject({
      distributionStatus: "available",
      acceptedRespondents: 5,
      joinedByRevealCount: 5,
      results: [
        { label: "Choice A", value: 3 },
        { label: "Choice B", value: 2 },
      ],
    });
    expect(questions[1]).toMatchObject({ distributionStatus: "available", acceptedRespondents: 5 });
    expect(questions[1].results.map((row: { value: number }) => row.value)).toEqual([2, 2, 1]);
    expect(counts).toHaveBeenCalledTimes(1);
    expect(await f.sessions.getReport(f.actor.workspaceId, f.session.id)).toEqual(stored);
    for (const raw of f.raw) expect(raw).not.toHaveBeenCalled();
    counts.mockRejectedValue(new Error("PRIVATE_QUERY_FAILURE"));
    const failed = await f.request();
    expect(failed.statusCode, failed.body).toBe(200);
    expect(failed.json().insights.participation.questions[0]).toMatchObject({
      distributionStatus: "unavailable",
      acceptedRespondents: 5,
      joinedByRevealCount: 5,
      results: [],
    });
    expect(failed.body).not.toContain("PRIVATE_QUERY_FAILURE");
    const poll = f.content.blocks[0]!;
    if (poll.kind !== "question" || poll.question.type !== "poll") throw new Error("Expected poll");
    counts.mockResolvedValue([
      {
        blockId: poll.id,
        responseCount: 5,
        buckets: [{ key: poll.question.choices[0]!.id, count: 4 }],
      },
    ]);
    const mismatch = await f.request();
    expect(mismatch.statusCode).toBe(200);
    expect(mismatch.json().insights.participation.questions[0]).toMatchObject({
      distributionStatus: "unavailable",
      acceptedRespondents: 5,
      joinedByRevealCount: 5,
      results: [],
    });
  });
  it("validates strict selectors and applies bounded admission before aggregation", async () => {
    const f = await fixture(),
      counts = vi.spyOn(f.qna, "getInsightsCounts");
    expect((await f.request("invalid")).statusCode).toBe(422);
    expect((await f.request(f.session.id, "?raw=true")).statusCode).toBe(422);
    f.current.admitted = false;
    const limited = await f.request();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(counts).not.toHaveBeenCalled();
    expect(f.consumeAdmission).toHaveBeenCalledWith(expect.any(String), 60, 60000);
  });
});
