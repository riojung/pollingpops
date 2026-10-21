import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoveryPackDraft } from "@openround/contracts";
import {
  MemoryRepository,
  type RecoveryPackRecord,
  type RecoveryPackVersionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { AuthService } from "../src/auth.js";
import { hashToken } from "../src/security.js";
import { FollowupService } from "../src/followup-service.js";
import { recoveryPackHash } from "../src/recovery-pack-copies.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

function draft(): RecoveryPackDraft {
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["ratio"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Private probe rationale.",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Evidence", isCorrect: true },
      { id: randomUUID(), label: "Assumption", isCorrect: false },
    ],
  });
  const recheck = { ...question("Different immediate scenario?"), delivery: "recheck" as const };
  return {
    schemaVersion: 1,
    title: "Probe Pack",
    description: "",
    diagnostic: { ...question("Hidden diagnostic?"), linkedRecheckQuestionId: recheck.id },
    interventions: [
      { id: randomUUID(), title: "Private card", body: "Hidden intervention body.", citations: [] },
    ],
    recheck,
    delayedProbe: question("What evidence remains tomorrow?"),
    conceptKeys: ["ratio"],
    misconceptionKeys: [],
    citations: [],
  };
}

async function signIn(app: FastifyInstance, email = "pack-practice@example.com") {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(app, `/v1/auth/verify?token=${token}`, email);
  const cookies = verified.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function application(
  repository: MemoryRepository,
  workspaceId: string,
  flags = true,
  allowlisted = true,
) {
  const { app } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      LOG_LEVEL: "silent",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: String(flags),
      FEATURE_RECOVERY_PACKS: String(flags),
      FEATURE_PRACTICE_ASSIGNMENTS: String(flags),
      UX_BETA_WORKSPACE_ALLOWLIST: allowlisted ? workspaceId : "",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: allowlisted ? workspaceId : "",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  apps.push(app);
  return app;
}

async function fixture(content = draft(), mediaIds: string[] = []) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "pro" });
  for (const id of mediaIds) {
    await repository.createMediaAsset({
      id,
      workspaceId,
      objectKey: `media/${workspaceId}/${id}.png`,
      mimeType: "image/png",
      sizeBytes: 256,
      scanStatus: "clean",
      altText: "Current checkpoint illustration",
      createdAt: new Date(),
    });
  }
  const app = await application(repository, workspaceId);
  const cookie = await signIn(app);
  const created = await app.inject({
    method: "POST",
    url: "/v1/recovery-packs",
    headers: { cookie },
    payload: { draft: content },
  });
  expect(created.statusCode).toBe(201);
  const pack = created.json<{ pack: RecoveryPackRecord }>().pack;
  const published = await app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${pack.id}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode).toBe(200);
  const version = published.json<{ version: RecoveryPackVersionRecord }>().version;
  const input = {
    sourcePackVersionId: version.id,
    mutationId: randomUUID(),
    accessSeed: randomBytes(32).toString("base64url"),
    title: "Check tomorrow",
    timeMode: "flex",
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    personalLabels: ["Second label", "First label"],
  };
  const url = `/v1/recovery-packs/${pack.id}/practice-assignments`;
  return { app, repository, workspaceId, cookie, pack, version, input, url };
}

describe("Recovery Pack delayed-probe practice", () => {
  it("copies only the published probe, keeps provenance, and uses the private accountless runner", async () => {
    const { app, repository, workspaceId, cookie, version, input, url } = await fixture();
    const response = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const receipt = response.json();
    expect(Object.keys(receipt).sort()).toEqual(["followup", "genericUrl", "personalAccess"]);
    expect(receipt.followup).toMatchObject({
      purpose: "assignment",
      trustMode: "learning",
      sourceQuizVersionId: null,
      checkpointCount: 1,
      recoveryPackSource: {
        packVersionId: version.id,
        role: "delayed_probe",
        sourceItemId: version.content.delayedProbe!.id,
        contentHash: version.contentHash,
      },
    });
    expect(receipt.genericUrl).toContain("#token=");
    expect(receipt.personalAccess).toHaveLength(2);
    const record = repository.followups.get(receipt.followup.id)!;
    expect(record.content.questions).toHaveLength(1);
    expect(record.content.questions[0]!.prompt).toBe(version.content.delayedProbe!.prompt);
    expect(record.content.questions[0]!.id).not.toBe(version.content.delayedProbe!.id);
    expect(record.content.questions[0]!.recoveryPackSource).toMatchObject({
      role: "delayed_probe",
      sourceItemId: version.content.delayedProbe!.id,
    });
    expect(JSON.stringify(record)).not.toContain(input.accessSeed);
    expect(JSON.stringify(record)).not.toContain(new URL(receipt.genericUrl).hash.slice(7));
    expect(await repository.listQuizzes(workspaceId)).toHaveLength(0);

    const token = new URLSearchParams(new URL(receipt.personalAccess[0].url).hash.slice(1)).get(
      "token",
    )!;
    const start = await app.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/start`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(start.statusCode).toBe(201);
    const initial = start.json();
    expect(initial.snapshot.phase).toBe("question_open");
    expect(initial.snapshot.deadline).toBeNull();
    for (const hidden of [
      "isCorrect",
      "Private probe rationale",
      "Hidden diagnostic",
      "Hidden intervention body",
      "recoveryPackSource",
      "packVersionId",
    ]) {
      expect(start.body).not.toContain(hidden);
    }
    const question = record.content.questions[0]!;
    if (question.type !== "single_select") throw new Error("Expected choice probe");
    const payload = {
      idempotencyKey: randomUUID(),
      response: {
        kind: "choice",
        choiceIds: [question.choices.find((choice) => choice.isCorrect)!.id],
      },
    };
    const answer = () =>
      app.inject({
        method: "POST",
        url: `/v1/followups/${record.id}/answers`,
        headers: { authorization: `Bearer ${initial.attemptToken}` },
        payload,
      });
    const accepted = await answer();
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().snapshot).toMatchObject({
      phase: "answer_reveal",
      correct: true,
      explanation: "Private probe rationale.",
    });
    expect((await answer()).json()).toEqual(accepted.json());
    expect(repository.followupAnswers.size).toBe(1);
    const resume = await app.inject({
      method: "GET",
      url: `/v1/followups/${record.id}/snapshot`,
      headers: { authorization: `Bearer ${initial.attemptToken}` },
    });
    expect(resume.json()).toEqual(accepted.json());
    const completed = await app.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/advance`,
      headers: { authorization: `Bearer ${initial.attemptToken}` },
    });
    expect(completed.json().snapshot).toMatchObject({ phase: "completed", status: "completed" });
    const detail = await app.inject({
      method: "GET",
      url: `/v1/followups/${record.id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().context).toMatchObject({
      sourceType: "recovery_pack",
      packTitle: "Probe Pack",
      version: 1,
    });
    expect(detail.json()).toMatchObject({ attemptCount: 1, completedAttemptCount: 1 });
    expect(JSON.stringify(repository.audits)).not.toContain(input.accessSeed);
  });

  it("replays concurrent creation without duplicate assignments or mismatched recipient credentials", async () => {
    const { app, repository, cookie, input, url } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({ method: "POST", url, headers: { cookie }, payload: input }),
      ),
    );
    expect(results.map((item) => item.statusCode)).toEqual([201, 201, 201]);
    for (const response of results) expect(response.json()).toEqual(results[0]!.json());
    expect(repository.followups.size).toBe(1);
    expect(repository.followupAccess.size).toBe(2);
    expect(
      repository.audits.filter(
        (event) => event.action === "recovery_pack.practice_assignment.create",
      ),
    ).toHaveLength(1);
    await expect
      .poll(
        () =>
          repository.productEvents.filter((event) => event.name === "practice_assignment_created")
            .length,
      )
      .toBe(1);
    const receipt = results[0]!.json();
    for (const item of receipt.personalAccess) {
      const token = new URLSearchParams(new URL(item.url).hash.slice(1)).get("token")!;
      const stored = await repository.getFollowupAccessByToken(
        receipt.followup.id,
        hashToken(token),
        new Date(),
      );
      expect(stored).toMatchObject({ id: item.id, label: item.label });
    }
    const conflict = await app.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: { ...input, title: "Different request" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(repository.followups.size).toBe(1);
  });

  it.each(["republished", "deleted"] as const)(
    "recovers an overlapping commit when the source is %s after the initial receipt miss",
    async (change) => {
      const { app, repository, cookie, input, url, pack } = await fixture();
      const getReceipt = repository.getRecoveryPackPracticeAssignment.bind(repository);
      let lookupMissed!: () => void;
      let releaseLookup!: () => void;
      const missed = new Promise<void>((resolve) => {
        lookupMissed = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseLookup = resolve;
      });
      vi.spyOn(repository, "getRecoveryPackPracticeAssignment").mockImplementationOnce(
        async (...args) => {
          const empty = await getReceipt(...args);
          expect(empty).toBeNull();
          lookupMissed();
          await released;
          return empty;
        },
      );
      const pending = app.inject({ method: "POST", url, headers: { cookie }, payload: input });
      // Start the lazy injection before waiting for its paused lookup.
      const retry = pending.then((response) => response);
      await missed;
      const committed = await app.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: input,
      });
      try {
        expect(committed.statusCode).toBe(201);
        if (change === "deleted") {
          expect(
            (
              await app.inject({
                method: "DELETE",
                url: `/v1/recovery-packs/${pack.id}`,
                headers: { cookie },
              })
            ).statusCode,
          ).toBe(204);
        } else {
          expect(
            (
              await app.inject({
                method: "PUT",
                url: `/v1/recovery-packs/${pack.id}/draft`,
                headers: { cookie },
                payload: {
                  draft: { ...pack.draft, title: "Republished probe Pack" },
                  expectedRevision: 0,
                  mutationId: randomUUID(),
                },
              })
            ).statusCode,
          ).toBe(200);
          expect(
            (
              await app.inject({
                method: "POST",
                url: `/v1/recovery-packs/${pack.id}/publish`,
                headers: { cookie },
                payload: { expectedDraftRevision: 1 },
              })
            ).statusCode,
          ).toBe(200);
        }
      } finally {
        releaseLookup();
      }
      const recovered = await retry;
      expect(recovered.statusCode).toBe(201);
      expect(recovered.json()).toEqual(committed.json());
      expect(repository.followups.size).toBe(1);
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(1);
      await expect
        .poll(
          () =>
            repository.productEvents.filter((event) => event.name === "practice_assignment_created")
              .length,
        )
        .toBe(1);
    },
  );

  it.each(["recordAudit", "recordProductEvents"] as const)(
    "rolls back assignment and evidence on %s failure, then retries exactly once",
    async (method) => {
      const { app, repository, workspaceId, cookie, input, url } = await fixture();
      vi.spyOn(repository, method).mockRejectedValueOnce(
        new Error("creation evidence unavailable"),
      );
      const failed = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
      expect(failed.statusCode).toBe(500);
      expect(repository.followups.size).toBe(0);
      expect(repository.followupAccess.size).toBe(0);
      expect(
        [...repository.mediaReferences.values()].filter(
          (reference) => reference.ownerType === "followup",
        ),
      ).toHaveLength(0);
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(0);
      expect(
        repository.productEvents.filter((event) => event.name === "practice_assignment_created"),
      ).toHaveLength(0);

      const accepted = await app.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: input,
      });
      expect(accepted.statusCode).toBe(201);
      expect(repository.followups.size).toBe(1);
      expect(repository.followupAccess.size).toBe(2);
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(1);
      expect(
        repository.productEvents.filter((event) => event.name === "practice_assignment_created"),
      ).toHaveLength(1);
      const restarted = await application(repository, workspaceId, false, false);
      const replay = await restarted.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: input,
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toEqual(accepted.json());
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(1);
      expect(
        repository.productEvents.filter((event) => event.name === "practice_assignment_created"),
      ).toHaveLength(1);
    },
  );

  it("recovers a receipt after source deletion, feature pause and plan downgrade, retaining history/context", async () => {
    const { app, repository, workspaceId, cookie, input, url, pack } = await fixture();
    const first = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    expect(first.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${pack.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    await repository.setPlan(workspaceId, "free");
    const paused = await application(repository, workspaceId, false, false);
    const replay = await paused.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: input,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const rejected = await paused.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: { ...input, mutationId: randomUUID() },
    });
    expect(rejected.statusCode).toBe(404);
    const id = first.json().followup.id;
    const detail = await paused.inject({
      method: "GET",
      url: `/v1/followups/${id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().context).toMatchObject({
      sourceType: "recovery_pack",
      packId: pack.id,
      packTitle: "Probe Pack",
    });
    const history = await paused.inject({
      method: "GET",
      url: "/v1/followups?purpose=assignment",
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toContainEqual(
      expect.objectContaining({
        id,
        quizId: null,
        sourceQuizVersionId: null,
        recoveryPackSource: expect.objectContaining({ packId: pack.id }),
      }),
    );
    const token = new URLSearchParams(new URL(replay.json().genericUrl).hash.slice(1)).get(
      "token",
    )!;
    expect(
      (
        await paused.inject({
          method: "POST",
          url: `/v1/followups/${id}/start`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(201);
  });

  it("does not revive revoked personal passes or expose later passes during receipt recovery", async () => {
    const { app, repository, workspaceId, cookie, input, url } = await fixture();
    const response = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    const original = response.json();
    const revoked = original.personalAccess[0];
    const revokedToken = new URLSearchParams(new URL(revoked.url).hash.slice(1)).get("token")!;
    await repository.revokeFollowupAccess(
      workspaceId,
      original.followup.id,
      revoked.id,
      new Date(),
    );
    const later = await app.inject({
      method: "POST",
      url: `/v1/followups/${original.followup.id}/personal-passes`,
      headers: { cookie },
      payload: { label: "Added later" },
    });
    expect(later.statusCode).toBe(201);
    const replay = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().personalAccess).toEqual(
      original.personalAccess.filter((item: { id: string }) => item.id !== revoked.id),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/followups/${original.followup.id}/start`,
          headers: { authorization: `Bearer ${revokedToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("rejects missing probes, stale Pack versions and invalid personal-link/window requests without a write", async () => {
    const content = draft();
    content.delayedProbe = null;
    const { app, repository, cookie, input, url, pack } = await fixture(content);
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(409);
    expect(repository.followups.size).toBe(0);
    const updated = { ...content, delayedProbe: draft().delayedProbe };
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/recovery-packs/${pack.id}/draft`,
          headers: { cookie },
          payload: { draft: updated, expectedRevision: 0, mutationId: randomUUID() },
        })
      ).statusCode,
    ).toBe(200);
    const published = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(published.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(409);
    const current = { ...input, sourcePackVersionId: published.json().version.id };
    for (const payload of [
      { ...current, closesAt: new Date(Date.now() - 1_000).toISOString() },
      { ...current, closesAt: new Date(Date.now() + 366 * 86_400_000).toISOString() },
      { ...current, accessSeed: "predictable" },
      { ...current, personalLabels: ["Same", "same"] },
    ]) {
      expect(
        (await app.inject({ method: "POST", url, headers: { cookie }, payload })).statusCode,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(repository.followups.size).toBe(0);
  });

  it("enforces editor role, tenant boundaries, both allowlists and entitlement for new assignments", async () => {
    const { app, repository, workspaceId, cookie, input, url } = await fixture();
    const auth = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    const viewer = vi
      .spyOn(AuthService.prototype, "requireCreator")
      .mockResolvedValue({ ...auth.json().creator, role: "viewer" });
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(403);
    viewer.mockRestore();
    const otherCookie = await signIn(app, "another-pack-workspace@example.com");
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie: otherCookie }, payload: input }))
        .statusCode,
    ).toBe(404);
    const unlisted = await application(repository, workspaceId, true, false);
    expect(
      (await unlisted.inject({ method: "POST", url, headers: { cookie }, payload: input }))
        .statusCode,
    ).toBe(404);
    await repository.setPlan(workspaceId, "free");
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(402);
    expect(repository.followups.size).toBe(0);
  });
});

describe("Recovery Pack full-sequence practice", () => {
  async function sequenceFixture(timeMode: "flex" | "timed" = "flex", media = false) {
    const content = draft();
    content.diagnostic.confidence = "optional";
    const diagnosticMedia = randomUUID();
    const recheckMedia = randomUUID();
    if (media) {
      content.diagnostic.mediaId = diagnosticMedia;
      content.diagnostic.mediaAlt = "Diagnostic illustration";
      content.recheck.mediaId = recheckMedia;
      content.recheck.mediaAlt = "Recheck illustration";
    }
    content.interventions = [
      {
        id: randomUUID(),
        title: "First card",
        body: "First frozen explanation.",
        citations: [
          {
            sourceName: "Card evidence",
            sourceDigest: "a".repeat(64),
            locator: "p1",
            excerpt: "First citation",
          },
        ],
      },
      { id: randomUUID(), title: "Second card", body: "Second frozen explanation.", citations: [] },
    ];
    content.citations = [
      {
        sourceName: "Global private evidence",
        sourceDigest: "b".repeat(64),
        locator: "p2",
        excerpt: "Global citation",
      },
    ];
    const setup = await fixture(content, media ? [diagnosticMedia, recheckMedia] : []);
    const input = { ...setup.input, mode: "full_sequence" as const, timeMode };
    const response = await setup.app.inject({
      method: "POST",
      url: setup.url,
      headers: { cookie: setup.cookie },
      payload: input,
    });
    expect(response.statusCode).toBe(201);
    const receipt = response.json();
    const token = new URLSearchParams(new URL(receipt.personalAccess[0].url).hash.slice(1)).get(
      "token",
    )!;
    const record = setup.repository.followups.get(receipt.followup.id)!;
    const service = new FollowupService(setup.repository);
    const now = new Date();
    const started = await service.start(record.id, token, undefined, now);
    const diagnostic = record.content.questions[0]!;
    const recheck = record.content.questions[1]!;
    if (diagnostic.type !== "single_select" || recheck.type !== "single_select") {
      throw new Error("Expected choice checkpoints");
    }
    const answer = {
      idempotencyKey: randomUUID(),
      questionId: diagnostic.id,
      expectedVersion: started.snapshot.version,
      response: {
        kind: "choice" as const,
        choiceIds: [diagnostic.choices.find((choice) => choice.isCorrect)!.id],
      },
      confidence: 2 as const,
    };
    return {
      ...setup,
      input,
      receipt,
      token,
      record,
      service,
      now,
      started,
      diagnostic,
      recheck,
      answer,
      diagnosticMedia,
      recheckMedia,
    };
  }

  it("freezes the pair and cards, delivers one stage at a time, and survives source deletion and feature pause", async () => {
    const {
      app,
      repository,
      workspaceId,
      cookie,
      pack,
      version,
      input,
      url,
      receipt,
      token,
      record,
      service,
      now,
      started,
      diagnostic,
      recheck,
      answer,
      diagnosticMedia,
      recheckMedia,
    } = await sequenceFixture("flex", true);
    expect(receipt.followup).toMatchObject({
      checkpointCount: 2,
      recoveryPackSource: { role: "full_sequence", sourceItemId: version.content.diagnostic.id },
    });
    expect(record.content.questions.map((question) => question.delivery)).toEqual([
      "main",
      "recheck",
    ]);
    expect(diagnostic.linkedRecheckQuestionId).toBe(recheck.id);
    for (const [copied, role] of [
      [diagnostic, "diagnostic"],
      [recheck, "recheck"],
    ] as const) {
      const source = version.content[role];
      expect(copied.id).not.toBe(source.id);
      expect(copied.recoveryPackSource).toMatchObject({
        role,
        sourceItemId: source.id,
        contentHash: recoveryPackHash(source),
      });
      if (source.type !== "single_select") throw new Error("Expected source choices");
      expect(
        copied.choices
          .map((choice) => choice.id)
          .some((id) => source.choices.some((choice) => choice.id === id)),
      ).toBe(false);
    }
    expect(record.recoveryPackSequence).toEqual({
      schemaVersion: 1,
      interventions: version.content.interventions,
      citations: version.content.citations,
    });
    expect(JSON.stringify(record.content)).not.toContain(version.content.delayedProbe!.prompt);
    expect(started.snapshot).toMatchObject({
      practiceMode: "full_sequence",
      phase: "question_open",
      questionCount: 2,
      questionIndex: 0,
      intervention: null,
    });
    for (const hidden of [
      recheck.prompt,
      "First frozen explanation",
      "Second frozen explanation",
      "Global citation",
      "isCorrect",
      "recoveryPackSource",
      "packVersionId",
      "Private probe rationale",
    ]) {
      expect(JSON.stringify(started.snapshot)).not.toContain(hidden);
    }
    await expect(service.authorizeMedia(record.id, token, diagnosticMedia, now)).resolves.toBe(
      workspaceId,
    );
    await expect(service.authorizeMedia(record.id, token, recheckMedia, now)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    const revealed = await service.answer(record.id, token, answer, now);
    expect(revealed).toMatchObject({ phase: "answer_reveal", correct: true, intervention: null });
    const card0Input = { expectedVersion: revealed.version, idempotencyKey: randomUUID() };
    const card0 = await service.advance(record.id, token, now, card0Input);
    expect(card0).toMatchObject({
      phase: "intervention",
      intervention: { index: 0, count: 2, card: version.content.interventions[0] },
    });
    for (const field of [
      "question",
      "response",
      "confidence",
      "correct",
      "correctResponse",
      "explanation",
      "feedback",
      "deadline",
      "questionIndex",
    ] as const)
      expect(card0[field]).toBeNull();
    for (const hidden of [
      diagnostic.prompt,
      recheck.prompt,
      "Second frozen explanation",
      "Global citation",
      "recoveryPackSource",
      "packVersionId",
      version.content.delayedProbe!.prompt,
    ])
      expect(JSON.stringify(card0)).not.toContain(hidden);
    await expect(
      service.authorizeMedia(record.id, token, diagnosticMedia, now),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.authorizeMedia(record.id, token, recheckMedia, now)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${pack.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    const paused = await application(repository, workspaceId, false, false);
    const replay = await paused.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: input,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(receipt);
    const headers = { authorization: `Bearer ${token}` };
    const current = await paused.inject({
      method: "GET",
      url: `/v1/followups/${record.id}/snapshot`,
      headers,
    });
    expect(current.json().snapshot).toEqual(card0);
    const second = await paused.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/advance`,
      headers,
      payload: { expectedVersion: card0.version, idempotencyKey: randomUUID() },
    });
    expect(second.statusCode).toBe(200);
    const card1 = second.json().snapshot;
    expect(card1.intervention).toMatchObject({
      index: 1,
      card: { body: "Second frozen explanation." },
    });
    expect(second.body).not.toContain("First frozen explanation");
    const opening = await paused.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/advance`,
      headers,
      payload: { expectedVersion: card1.version, idempotencyKey: randomUUID() },
    });
    expect(opening.statusCode).toBe(200);
    const opened = opening.json().snapshot;
    expect(opened).toMatchObject({
      phase: "question_open",
      questionIndex: 1,
      question: { id: recheck.id },
      intervention: null,
      correctResponse: null,
    });
    await expect(
      service.authorizeMedia(record.id, token, diagnosticMedia, now),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.authorizeMedia(record.id, token, recheckMedia, now)).resolves.toBe(
      workspaceId,
    );
    const recheckAnswer = await paused.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/answers`,
      headers,
      payload: {
        idempotencyKey: randomUUID(),
        questionId: recheck.id,
        expectedVersion: opened.version,
        response: {
          kind: "choice",
          choiceIds: [recheck.choices.find((choice) => choice.isCorrect)!.id],
        },
      },
    });
    expect(recheckAnswer.statusCode).toBe(200);
    expect(recheckAnswer.json().snapshot).toMatchObject({ phase: "answer_reveal", correct: true });
    const completed = await paused.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/advance`,
      headers,
      payload: {
        expectedVersion: recheckAnswer.json().snapshot.version,
        idempotencyKey: randomUUID(),
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().snapshot).toMatchObject({
      phase: "completed",
      question: null,
      intervention: null,
      questionCount: 2,
    });
    const detail = await paused.inject({
      method: "GET",
      url: `/v1/followups/${record.id}`,
      headers: { cookie },
    });
    expect(detail.json()).toMatchObject({
      followup: { checkpointCount: 2 },
      attemptCount: 1,
      completedAttemptCount: 1,
    });
    expect(repository.followupAnswers.size).toBe(2);
  });

  it("fences sequence commands and recovers exact receipts across retries, concurrency and restarts", async () => {
    const { app, repository, record, token, service, now, started, answer, diagnostic, recheck } =
      await sequenceFixture();
    await expect(
      service.answer(
        record.id,
        token,
        { idempotencyKey: randomUUID(), response: answer.response },
        now,
      ),
    ).rejects.toMatchObject({ code: "ANSWER_INVALID" });
    await expect(
      service.answer(record.id, token, { ...answer, questionId: recheck.id }, now),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const accepted = await Promise.all([
      service.answer(record.id, token, answer, now),
      service.answer(record.id, token, answer, now),
    ]);
    expect(accepted[0]).toEqual(accepted[1]);
    expect(accepted[0]!.version).toBe(started.snapshot.version + 1);
    expect(repository.followupAnswers.size).toBe(1);
    await expect(service.advance(record.id, token, now)).rejects.toMatchObject({
      code: "ANSWER_INVALID",
    });
    const advance = { expectedVersion: accepted[0]!.version, idempotencyKey: randomUUID() };
    const advanced = await Promise.all([
      service.advance(record.id, token, now, advance),
      service.advance(record.id, token, now, advance),
    ]);
    expect(advanced[0]).toEqual(advanced[1]);
    expect(advanced[0]!.intervention?.index).toBe(0);
    const restarted = new FollowupService(repository);
    const next = await restarted.advance(record.id, token, now, {
      expectedVersion: advanced[0]!.version,
      idempotencyKey: randomUUID(),
    });
    expect(next.intervention?.index).toBe(1);
    await expect(restarted.advance(record.id, token, now, advance)).resolves.toEqual(next);
    await expect(restarted.answer(record.id, token, answer, now)).resolves.toEqual(next);
    await expect(
      restarted.advance(record.id, token, now, { ...advance, expectedVersion: next.version }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      restarted.advance(record.id, token, now, {
        expectedVersion: advance.expectedVersion,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    for (const changed of [
      { ...answer, expectedVersion: next.version },
      { ...answer, questionId: recheck.id },
      { ...answer, confidence: 3 as const },
      {
        ...answer,
        response: {
          kind: "choice" as const,
          choiceIds: [diagnostic.choices.find((choice) => !choice.isCorrect)!.id],
        },
      },
    ])
      await expect(restarted.answer(record.id, token, changed, now)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    const differentCommands = await Promise.allSettled([
      restarted.advance(record.id, token, now, {
        expectedVersion: next.version,
        idempotencyKey: randomUUID(),
      }),
      restarted.advance(record.id, token, now, {
        expectedVersion: next.version,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(differentCommands.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(differentCommands.filter((item) => item.status === "rejected")).toHaveLength(1);
    const opened = await restarted.resume(record.id, token, now);
    await expect(
      restarted.answer(record.id, token, { ...answer, idempotencyKey: randomUUID() }, now),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect((await restarted.resume(record.id, token, now)).version).toBe(opened.version);
    await expect(restarted.answer(record.id, token, answer, now)).resolves.toEqual(opened);
    const invalidAdvance = await app.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/advance`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion: opened.version },
    });
    expect(invalidAdvance.statusCode).toBe(400);
  });

  it("keeps cards untimed and starts the accommodated recheck clock only when it opens", async () => {
    const { repository, record, token, service, now, started, answer, recheck } =
      await sequenceFixture("timed");
    expect(new Date(started.snapshot.deadline!).getTime() - now.getTime()).toBe(30_000);
    const stored = [...repository.followupAttempts.values()][0]!;
    stored.timeMultiplier = 2;
    const revealed = await service.answer(record.id, token, answer, now);
    const card0 = await service.advance(record.id, token, now, {
      expectedVersion: revealed.version,
      idempotencyKey: randomUUID(),
    });
    const later = new Date(now.getTime() + 3_600_000);
    const card1 = await service.advance(record.id, token, later, {
      expectedVersion: card0.version,
      idempotencyKey: randomUUID(),
    });
    expect(card1.deadline).toBeNull();
    const command = { expectedVersion: card1.version, idempotencyKey: randomUUID() };
    const opened = await service.advance(record.id, token, later, command);
    expect(new Date(opened.deadline!).getTime() - later.getTime()).toBe(60_000);
    const elapsed = new Date(later.getTime() + 60_001);
    // Receipt recovery must not restart the timer or apply an incidental timeout transition.
    await expect(service.advance(record.id, token, elapsed, command)).resolves.toEqual(opened);
    await expect(service.answer(record.id, token, answer, elapsed)).resolves.toEqual(opened);
    const timedOut = await service.answer(
      record.id,
      token,
      {
        idempotencyKey: randomUUID(),
        questionId: recheck.id,
        expectedVersion: opened.version,
        response: { kind: "choice", choiceIds: [recheck.choices[0]!.id] },
      },
      elapsed,
    );
    expect(timedOut).toMatchObject({
      phase: "answer_reveal",
      response: null,
      correct: null,
      version: opened.version + 1,
    });
    expect(repository.followupAnswers.size).toBe(1);
    const done = await service.advance(record.id, token, elapsed, {
      expectedVersion: timedOut.version,
      idempotencyKey: randomUUID(),
    });
    expect(done.phase).toBe("completed");
  });

  it("re-reads the authoritative stage when another command advances during answer receipt lookup", async () => {
    const { repository, record, token, service, now, answer } = await sequenceFixture();
    const revealed = await service.answer(record.id, token, answer, now);
    const lookup = repository.getFollowupAnswerByIdempotencyKey.bind(repository);
    vi.spyOn(repository, "getFollowupAnswerByIdempotencyKey").mockImplementationOnce(
      async (attemptId, key) => {
        await service.advance(record.id, token, now, {
          expectedVersion: revealed.version,
          idempotencyKey: randomUUID(),
        });
        return lookup(attemptId, key);
      },
    );
    const retry = await service.answer(record.id, token, answer, now);
    expect(retry).toMatchObject({
      phase: "intervention",
      version: revealed.version + 1,
      intervention: { index: 0 },
      question: null,
    });
  });

  it("permits a full sequence without a delayed probe and preserves default delayed-probe receipts", async () => {
    const content = draft();
    content.delayedProbe = null;
    const { app, repository, cookie, input, url } = await fixture(content);
    const full = await app.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: { ...input, mode: "full_sequence" },
    });
    expect(full.statusCode).toBe(201);
    expect(full.json().followup.checkpointCount).toBe(2);
    const changedMode = await app.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: { ...input, mode: "delayed_probe" },
    });
    expect(changedMode.statusCode).toBe(409);
    expect(repository.followups.size).toBe(1);
    const delayed = await fixture();
    const original = await delayed.app.inject({
      method: "POST",
      url: delayed.url,
      headers: { cookie: delayed.cookie },
      payload: delayed.input,
    });
    const replay = await delayed.app.inject({
      method: "POST",
      url: delayed.url,
      headers: { cookie: delayed.cookie },
      payload: { ...delayed.input, mode: "delayed_probe" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(original.json());
    const record = delayed.repository.followups.get(original.json().followup.id)!;
    expect(record.recoveryPackSequence).toBeNull();
    expect(record.creationMutation!.requestHash).toBe(
      recoveryPackHash({
        actorId: record.createdBy,
        packId: delayed.pack.id,
        input: delayed.input,
      }),
    );
  });

  it("keeps receipt retries behind revocation, close and retention checks", async () => {
    const { repository, record, token, service, now, answer, workspaceId } =
      await sequenceFixture();
    const revealed = await service.answer(record.id, token, answer, now);
    const command = { expectedVersion: revealed.version, idempotencyKey: randomUUID() };
    await service.advance(record.id, token, now, command);
    await service.close(workspaceId, record.id, now);
    await expect(service.answer(record.id, token, answer, now)).rejects.toMatchObject({
      code: "FOLLOWUP_CLOSED",
    });
    await expect(service.advance(record.id, token, now, command)).rejects.toMatchObject({
      code: "FOLLOWUP_CLOSED",
    });
    const access = [...repository.followupAccess.values()].find(
      (item) => item.followupId === record.id,
    )!;
    await service.revokeAccess(workspaceId, record.id, access.id, now);
    await expect(service.resume(record.id, token, now)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      service.advance(record.id, token, new Date(record.expiresAt.getTime() + 1), command),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
