import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecoveryPackSourceProposalSchema,
  recoveryPackContentHash,
  type RecoveryPackSourceProposal,
} from "@openround/contracts";
import { MemoryRepository, type RecoveryPackRecord } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { sourceRecoveryPackProposal } from "../src/recovery-pack-source-authoring.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});
const sourceText =
  "Isolation separates people from a hazardous energy source before maintenance begins. A reminder alone does not provide physical separation. Apply isolation before working near hazardous energy; compare an actual barrier with communication about the hazard.";
const rawQuestion = {
  type: "single_select",
  purpose: "practice",
  confidence: "optional",
  explanation: "Isolation creates physical separation.",
  timeLimitSeconds: 30,
  citationIndexes: [0],
  choices: [
    {
      label: "Isolation",
      isCorrect: true,
      rationale: "It creates physical separation.",
      misconceptionLabel: null,
    },
    {
      label: "A reminder",
      isCorrect: false,
      rationale: "Communication does not isolate energy.",
      misconceptionLabel: "communication-is-control",
    },
  ],
};
const rawOutput = {
  title: "Source-assisted isolation",
  description: "Human review is required.",
  conceptKey: "isolation",
  citations: [
    {
      locator: "paragraph 1",
      excerpt: "Isolation separates people from a hazardous energy source",
    },
  ],
  main: { ...rawQuestion, prompt: "What creates physical separation from hazardous energy?" },
  recheck: { ...rawQuestion, prompt: "Which action controls exposure before maintenance begins?" },
};

async function signIn(app: FastifyInstance, email = "source-pack-author@example.com") {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "education", acceptPolicies: true },
  });
  const token = new URL(requested.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(app, `/v1/auth/verify?token=${token}`, email);
  const cookies = verified.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}
async function setup() {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    AUTH_DEBUG_MAGIC_LINKS: "true",
    LOG_LEVEL: "silent",
    FEATURE_RECOVERY_PACKS: "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const generate = vi.fn().mockResolvedValue(rawOutput);
  const built = await buildApp(config, {
    repository,
    cache: new MemorySessionCache(),
    authoringAssistant: {
      providerName: "synthetic-provider",
      modelName: "synthetic-model",
      generate,
    },
  });
  apps.push(built.app);
  const cookie = await signIn(built.app);
  const queued = await built.app.inject({
    method: "POST",
    url: "/v1/authoring/jobs",
    headers: { cookie },
    payload: { sourceType: "pasted_text", sourceName: "Synthetic safety notes", text: sourceText },
  });
  expect(queued.statusCode).toBe(202);
  const jobId = queued.json<{ job: { id: string } }>().job.id;
  expect(await built.authoringWorker.runOnce()).toBe("completed");
  const response = await built.app.inject({
    method: "GET",
    url: `/v1/authoring/jobs/${jobId}/recovery-pack-proposal`,
    headers: { cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  const proposal = RecoveryPackSourceProposalSchema.parse(
    response.json<{ proposal: unknown }>().proposal,
  );
  return { ...built, config, repository, cookie, jobId, proposal, workspaceId, generate };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function creation(proposal: RecoveryPackSourceProposal) {
  return {
    draft: proposal.draft,
    sourceOutputHash: proposal.sourceOutputHash,
    expectedContentHash: proposal.contentHash,
    mutationId: randomUUID(),
  };
}
function approval(pack: RecoveryPackRecord) {
  return {
    expectedDraftRevision: pack.draftRevision,
    expectedContentHash: pack.sourceReview!.contentHash,
    sourceDigest: pack.sourceReview!.sourceDigest,
    sourceOutputHash: pack.sourceReview!.sourceOutputHash,
    mutationId: randomUUID(),
    approveContent: true,
    approveCitations: true,
  };
}
async function create(fixture: Fixture) {
  const input = creation(fixture.proposal);
  const response = await fixture.app.inject({
    method: "POST",
    url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
    headers: { cookie: fixture.cookie },
    payload: input,
  });
  expect(response.statusCode, response.body).toBe(201);
  return { pack: response.json<{ pack: RecoveryPackRecord }>().pack, input };
}
async function approve(fixture: Fixture, pack: RecoveryPackRecord) {
  const input = approval(pack);
  const response = await fixture.app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${pack.id}/source-review`,
    headers: { cookie: fixture.cookie },
    payload: input,
  });
  expect(response.statusCode, response.body).toBe(200);
  return { pack: response.json<{ pack: RecoveryPackRecord }>().pack, input };
}
async function save(fixture: Fixture, pack: RecoveryPackRecord, title: string) {
  const response = await fixture.app.inject({
    method: "PUT",
    url: `/v1/recovery-packs/${pack.id}/draft`,
    headers: { cookie: fixture.cookie },
    payload: {
      draft: { ...pack.draft, title },
      expectedRevision: pack.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ pack: RecoveryPackRecord }>().pack;
}
async function publish(fixture: Fixture, pack: RecoveryPackRecord) {
  return fixture.app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${pack.id}/publish`,
    headers: { cookie: fixture.cookie },
    payload: { expectedDraftRevision: pack.draftRevision },
  });
}

describe("source-assisted Recovery Packs", () => {
  it("reuses a real grounded source job without another provider call or automatic publication", async () => {
    const fixture = await setup();
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    const job = fixture.repository.authoringJobs.get(fixture.jobId)!;
    expect(job).toMatchObject({ sourceText: null, sourceBlob: null });
    const repeated = await fixture.app.inject({
      method: "GET",
      url: `/v1/authoring/jobs/${fixture.jobId}/recovery-pack-proposal`,
      headers: { cookie: fixture.cookie },
    });
    expect(repeated.headers["cache-control"]).toBe("private, no-store");
    expect(repeated.json().proposal).toEqual(fixture.proposal);
    expect(fixture.proposal.draft.diagnostic.purpose).toBe("diagnostic");
    expect(fixture.proposal.draft.interventions).toHaveLength(1);
    expect(fixture.proposal.draft.interventions[0]!.body).toContain("Isolation separates people");
    expect(fixture.proposal.draft.diagnostic.linkedRecheckQuestionId).toBe(
      fixture.proposal.draft.recheck.id,
    );
    const { pack } = await create(fixture);
    expect(pack.currentVersionId).toBeNull();
    expect(pack.sourceReview).toMatchObject({
      approved: false,
      approvedContentHash: null,
      sourceDigest: job.sourceDigest,
    });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    expect((await publish(fixture, pack)).statusCode).toBe(409);
  });

  it("supports deterministic legacy ready outputs without content-slide proposals", async () => {
    const fixture = await setup();
    const job = structuredClone(fixture.repository.authoringJobs.get(fixture.jobId)!);
    delete job.output!.contentSlideProposals;
    const first = sourceRecoveryPackProposal(job).proposal;
    const second = sourceRecoveryPackProposal(
      JSON.parse(JSON.stringify(job)) as typeof job,
    ).proposal;
    expect(first).toEqual(second);
    expect(first.draft.interventions[0]!.body).toBe(first.draft.diagnostic.explanation);
    expect(first.draft.interventions[0]!.citations.length).toBeGreaterThan(0);
  });

  it("bounds legacy long slide proposals and explicitly reports conversion loss", async () => {
    const fixture = await setup();
    const job = structuredClone(fixture.repository.authoringJobs.get(fixture.jobId)!);
    job.output!.contentSlideProposals![0]!.body = "Source material ".repeat(220);
    job.output!.conversionNotes = Array.from({ length: 10 }, (_, index) => `Review note ${index}`);
    const proposal = sourceRecoveryPackProposal(job).proposal;
    expect(proposal.draft.interventions[0]!.body.length).toBeLessThanOrEqual(2_000);
    expect(proposal.conversionNotes).toHaveLength(10);
    expect(proposal.conversionNotes.at(-1)).toContain("shortened");
    expect(proposal.contentHash).toBe(recoveryPackContentHash(proposal.draft));
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });

  it("blocks new proposals and creations from pending or expired sources", async () => {
    const fixture = await setup();
    const job = fixture.repository.authoringJobs.get(fixture.jobId)!;
    const request = () =>
      fixture.app.inject({
        method: "POST",
        url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
        headers: { cookie: fixture.cookie },
        payload: creation(fixture.proposal),
      });
    job.status = "pending";
    expect((await request()).statusCode).toBe(409);
    job.status = "ready";
    job.expiresAt = new Date(0);
    expect((await request()).statusCode).toBe(404);
    expect(
      (
        await fixture.app.inject({
          method: "GET",
          url: `/v1/authoring/jobs/${fixture.jobId}/recovery-pack-proposal`,
          headers: { cookie: fixture.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("recovers concurrent accepted creation after source expiry and rollout pause, without duplicates", async () => {
    const fixture = await setup();
    const input = creation(fixture.proposal);
    const request = () =>
      fixture.app.inject({
        method: "POST",
        url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
        headers: { cookie: fixture.cookie },
        payload: input,
      });
    const [first, duplicate] = await Promise.all([request(), request()]);
    expect(first.statusCode, first.body).toBe(201);
    expect(duplicate.statusCode, duplicate.body).toBe(201);
    expect(duplicate.json().pack.id).toBe(first.json().pack.id);
    fixture.repository.authoringJobs.delete(fixture.jobId);
    fixture.config.FEATURE_RECOVERY_PACKS = false;
    expect((await request()).json().pack.id).toBe(first.json().pack.id);
    const list = await fixture.app.inject({
      method: "GET",
      url: "/v1/recovery-packs",
      headers: { cookie: fixture.cookie },
    });
    expect(list.json().packs).toHaveLength(1);
    const changed = { ...input, draft: { ...input.draft, title: "Changed intent" } };
    changed.expectedContentHash = recoveryPackContentHash(changed.draft);
    expect(
      (
        await fixture.app.inject({
          method: "POST",
          url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
          headers: { cookie: fixture.cookie },
          payload: changed,
        })
      ).statusCode,
    ).toBe(409);
  });

  it.each(["content", "output", "extra"])(
    "rejects stale creation %s before storing a Pack",
    async (kind) => {
      const fixture = await setup();
      const input = creation(fixture.proposal);
      const payload =
        kind === "content"
          ? { ...input, expectedContentHash: "a".repeat(64) }
          : kind === "output"
            ? { ...input, sourceOutputHash: "a".repeat(64) }
            : { ...input, approved: true };
      const response = await fixture.app.inject({
        method: "POST",
        url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
        headers: { cookie: fixture.cookie },
        payload,
      });
      expect(response.statusCode).toBe(kind === "extra" ? 400 : 409);
      expect(
        (
          await fixture.app.inject({
            method: "GET",
            url: "/v1/recovery-packs",
            headers: { cookie: fixture.cookie },
          })
        ).json().packs,
      ).toEqual([]);
    },
  );

  it.each(["title", "diagnostic", "card"])(
    "rejects self-hashed %s changes that were not in the server proposal",
    async (kind) => {
      const fixture = await setup();
      const input = creation(fixture.proposal);
      const draft = structuredClone(input.draft);
      if (kind === "title") draft.title = "Unrelated source attribution";
      else if (kind === "diagnostic")
        draft.diagnostic.prompt = "A different question with the original source citations";
      else draft.interventions[0]!.body = "Unrelated intervention with valid catalog citations";
      const response = await fixture.app.inject({
        method: "POST",
        url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
        headers: { cookie: fixture.cookie },
        payload: { ...input, draft, expectedContentHash: recoveryPackContentHash(draft) },
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("CONFLICT");
      expect(
        (
          await fixture.app.inject({
            method: "GET",
            url: "/v1/recovery-packs",
            headers: { cookie: fixture.cookie },
          })
        ).json().packs,
      ).toEqual([]);
      // Rejection must not reserve the creation receipt or block the reviewed proposal.
      const valid = await fixture.app.inject({
        method: "POST",
        url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
        headers: { cookie: fixture.cookie },
        payload: input,
      });
      expect(valid.statusCode, valid.body).toBe(201);
      expect(valid.json().pack.draft).toEqual(input.draft);
      expect(fixture.generate).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["diagnostic", "card", "catalog"])(
    "rejects invented %s citations at creation and saved-draft approval without echoing content",
    async (kind) => {
      const fixture = await setup();
      const input = creation(fixture.proposal);
      const content = structuredClone(input.draft);
      const citations =
        kind === "diagnostic"
          ? content.diagnostic.sourceCitations!
          : kind === "card"
            ? content.interventions[0]!.citations
            : content.citations;
      citations[0]!.excerpt = "An invented private source span that must not be echoed.";
      const response = await fixture.app.inject({
        method: "POST",
        url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
        headers: { cookie: fixture.cookie },
        payload: {
          ...input,
          draft: content,
          expectedContentHash: recoveryPackContentHash(content),
        },
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.body).not.toContain(citations[0]!.excerpt);
      const { pack } = await create(fixture);
      const saved = await fixture.app.inject({
        method: "PUT",
        url: `/v1/recovery-packs/${pack.id}/draft`,
        headers: { cookie: fixture.cookie },
        payload: {
          draft: content,
          expectedRevision: pack.draftRevision,
          mutationId: randomUUID(),
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const edited = saved.json<{ pack: RecoveryPackRecord }>().pack;
      const reviewed = await fixture.app.inject({
        method: "POST",
        url: `/v1/recovery-packs/${pack.id}/source-review`,
        headers: { cookie: fixture.cookie },
        payload: approval(edited),
      });
      expect(reviewed.statusCode, reviewed.body).toBe(422);
      expect(reviewed.body).not.toContain(citations[0]!.excerpt);
      expect((await publish(fixture, edited)).statusCode).toBe(409);
    },
  );

  it("requires explicit hash-bound approval, invalidates it on edits, and keeps old versions frozen", async () => {
    const fixture = await setup();
    const { pack } = await create(fixture);
    const approved = await approve(fixture, pack);
    expect(approved.pack.sourceReview!.approved).toBe(true);
    const published = await publish(fixture, approved.pack);
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().version.contentHash).toBe(fixture.proposal.contentHash);
    expect(published.json().version.content).not.toHaveProperty("sourceReview");
    const versionId = published.json().version.id;
    const edited = await save(fixture, approved.pack, "Reviewed content edited");
    expect(edited.sourceReview!.approved).toBe(false);
    expect((await publish(fixture, edited)).statusCode).toBe(409);
    const replay = await fixture.app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/source-review`,
      headers: { cookie: fixture.cookie },
      payload: approved.input,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().pack.sourceReview.approved).toBe(false);
    const fresh = await approve(fixture, edited);
    expect((await publish(fixture, fresh.pack)).statusCode).toBe(200);
    const exported = await fixture.app.inject({
      method: "GET",
      url: `/v1/recovery-packs/versions/${versionId}/export`,
      headers: { cookie: fixture.cookie },
    });
    expect(exported.json().content.title).toBe(fixture.proposal.draft.title);
    expect(exported.body).not.toContain("approvedContentHash");
    expect(
      fixture.repository.audits
        .filter((audit) => audit.action.startsWith("recovery_pack.source."))
        .every((audit) => Object.keys(audit.metadata ?? {}).length === 0),
    ).toBe(true);
  });

  it.each(["revision", "content", "digest", "output", "contentConsent", "citationConsent"])(
    "rejects stale or missing approval %s",
    async (kind) => {
      const fixture = await setup();
      const { pack } = await create(fixture);
      const payload: Record<string, unknown> = approval(pack);
      if (kind === "revision") payload.expectedDraftRevision = 1;
      if (kind === "content") payload.expectedContentHash = "b".repeat(64);
      if (kind === "digest") payload.sourceDigest = "b".repeat(64);
      if (kind === "output") payload.sourceOutputHash = "b".repeat(64);
      if (kind === "contentConsent") payload.approveContent = false;
      if (kind === "citationConsent") payload.approveCitations = false;
      const response = await fixture.app.inject({
        method: "POST",
        url: `/v1/recovery-packs/${pack.id}/source-review`,
        headers: { cookie: fixture.cookie },
        payload,
      });
      expect(response.statusCode, response.body).toBe(kind.endsWith("Consent") ? 400 : 409);
      expect((await publish(fixture, pack)).statusCode).toBe(409);
    },
  );

  it("denies unauthenticated, cross-tenant, viewer, and paused new writes but preserves reads", async () => {
    const fixture = await setup();
    const { pack } = await create(fixture);
    const proposalUrl = `/v1/authoring/jobs/${fixture.jobId}/recovery-pack-proposal`;
    expect((await fixture.app.inject({ method: "GET", url: proposalUrl })).statusCode).toBe(401);
    const otherCookie = await signIn(fixture.app, "foreign-source-pack@example.com");
    expect(
      (
        await fixture.app.inject({
          method: "GET",
          url: proposalUrl,
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.app.inject({
          method: "POST",
          url: `/v1/recovery-packs/${pack.id}/source-review`,
          headers: { cookie: otherCookie },
          payload: approval(pack),
        })
      ).statusCode,
    ).toBe(404);
    const owner = [...fixture.repository.workspaceMembers.values()].find(
      (member) => member.workspaceId === fixture.workspaceId,
    )!;
    owner.role = "viewer";
    fixture.repository.users.get(owner.userId)!.role = "viewer";
    expect(
      (
        await fixture.app.inject({
          method: "GET",
          url: proposalUrl,
          headers: { cookie: fixture.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.app.inject({
          method: "POST",
          url: `/v1/recovery-packs/${pack.id}/source-review`,
          headers: { cookie: fixture.cookie },
          payload: approval(pack),
        })
      ).statusCode,
    ).toBe(403);
    owner.role = "owner";
    fixture.repository.users.get(owner.userId)!.role = "owner";
    fixture.config.FEATURE_RECOVERY_PACKS = false;
    expect(
      (
        await fixture.app.inject({
          method: "GET",
          url: proposalUrl,
          headers: { cookie: fixture.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.app.inject({
          method: "POST",
          url: `/v1/authoring/jobs/${fixture.jobId}/apply-recovery-pack`,
          headers: { cookie: fixture.cookie },
          payload: creation(fixture.proposal),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.app.inject({
          method: "GET",
          url: `/v1/recovery-packs/${pack.id}`,
          headers: { cookie: fixture.cookie },
        })
      ).json().pack.sourceReview,
    ).toBeDefined();
  });

  it("keeps source approval available after the source job is purged", async () => {
    const fixture = await setup();
    const { pack } = await create(fixture);
    fixture.repository.authoringJobs.delete(fixture.jobId);
    const reviewed = await approve(fixture, pack);
    expect((await publish(fixture, reviewed.pack)).statusCode).toBe(200);
    expect(
      (
        await fixture.app.inject({
          method: "GET",
          url: `/v1/authoring/jobs/${fixture.jobId}/recovery-pack-proposal`,
          headers: { cookie: fixture.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
});
