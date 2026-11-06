import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PresentationDraftSchema,
  PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  presentationAssistanceProposalHash,
  type PresentationAssistanceJob,
  type PresentationAssistanceProposal,
} from "@openround/contracts";
import {
  createPresentationAssistanceRepository,
  createPresentationRepository,
  type Repository,
  type AuthoringJobRecord,
  type PresentationAssistanceClaim,
} from "../../src/index.js";
import { summaryMember } from "./session-summary-conformance.js";
export const assistanceOutline =
  "Creators write a short outline before drafting slides.\nReview every generated slide and its source before insertion.\nKeep an existing deck unchanged until the author confirms.";
export async function assistanceIdentity(repository: Repository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `assistance-${randomUUID()}@example.test`,
    segment: "education",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}
export async function presentationAssistanceFixture(repository: Repository) {
  const actor = await assistanceIdentity(repository),
    presentations = createPresentationRepository(repository),
    jobs = createPresentationAssistanceRepository(repository),
    now = new Date(),
    since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    draft = PresentationDraftSchema.parse({ title: "Saved creator deck", blocks: [] });
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftSchemaVersion: draft.schemaVersion,
    draftRevision: 0,
    currentVersionId: null,
    publishedDraftRevision: null,
    lastEditedBy: actor.userId,
    folderId: null,
    createdAt: now,
    updatedAt: now,
  });
  const context = {
    workspaceId: actor.workspaceId,
    presentationId: presentation.id,
    actorId: actor.userId,
    now,
  };
  const request = () => ({
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    presentationId: presentation.id,
    sourceName: "PRIVATE_CREATOR_OUTLINE",
    outline: assistanceOutline,
    slideCount: 3,
  });
  const create = () => ({ ...context, request: request(), since, monthlyLimit: 20 });
  const legacy = (id = randomUUID()): AuthoringJobRecord => ({
    id,
    workspaceId: actor.workspaceId,
    createdBy: actor.userId,
    sourceType: "pasted_text",
    sourceName: "Legacy source",
    sourceMimeType: null,
    sourceText: "LEGACY_SOURCE_TEXT",
    sourceBlob: null,
    sourceDigest: "a".repeat(64),
    status: "pending",
    attempts: 0,
    availableAt: now,
    output: null,
    appliedQuizId: null,
    lastError: null,
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  });
  return {
    repository,
    actor,
    presentations,
    presentation,
    jobs,
    context,
    request,
    create,
    legacy,
    now,
    since,
  };
}
export function assistanceProposal(job: PresentationAssistanceJob): PresentationAssistanceProposal {
  return {
    schemaVersion: 1,
    sourceName: job.sourceName,
    sourceDigest: job.sourceDigest,
    slides: assistanceOutline.split("\n").map((line, index) => ({
      id: randomUUID(),
      title: `Slide ${index + 1}`,
      body: line,
      citations: [{ locator: `outline line ${index + 1}`, excerpt: line }],
    })),
    generatedAt: job.createdAt,
    provider: "test",
    model: "bounded-text",
    reviewWarning: PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  };
}
export const assistanceFence = (claim: PresentationAssistanceClaim, now: Date) => ({
  jobId: claim.id,
  attempt: claim.attempt,
  leaseToken: claim.leaseToken,
  now,
});
export async function expectPresentationAssistanceConformance(repository: Repository) {
  const f = await presentationAssistanceFixture(repository),
    input = f.create(),
    legacy = f.legacy();
  await repository.createAuthoringJob(legacy);
  const legacyBefore = JSON.stringify(
    await repository.getAuthoringJob(f.actor.workspaceId, legacy.id),
  );
  const duplicate = await Promise.all([f.jobs.create(input), f.jobs.create(input)]);
  expect(duplicate.map((item) => item.status).sort()).toEqual(["created", "duplicate"]);
  expect(duplicate[0]!.job.id).toBe(input.request.requestId);
  const capitalized = await f.jobs.create({
    ...input,
    workspaceId: input.workspaceId.toUpperCase(),
    presentationId: input.presentationId.toUpperCase(),
    actorId: input.actorId.toUpperCase(),
    request: {
      ...input.request,
      requestId: input.request.requestId.toUpperCase(),
      presentationId: input.request.presentationId.toUpperCase(),
    },
  });
  expect(capitalized).toEqual({ status: "duplicate", job: duplicate[0]!.job });
  expect(
    await f.jobs.get({
      ...f.context,
      workspaceId: f.context.workspaceId.toUpperCase(),
      presentationId: f.context.presentationId.toUpperCase(),
      actorId: f.context.actorId.toUpperCase(),
      jobId: input.request.requestId.toUpperCase(),
    }),
  ).toEqual(duplicate[0]!.job);
  expect(await f.jobs.usage({ ...f.context, since: f.since })).toEqual({ used: 2, active: 1 });
  for (const patch of [
    { sourceName: "Another source" },
    { outline: `${assistanceOutline}\nChanged intent.` },
    { slideCount: 4 },
  ])
    await expect(
      f.jobs.create({ ...input, request: { ...input.request, ...patch } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  // Claim before admitting the second job so equal timestamps never depend on UUID ordering.
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  const second = await f.jobs.create(f.create());
  await expect(f.jobs.create(f.create())).rejects.toMatchObject({ code: "ACTIVE_LIMIT_REACHED" });
  expect((await f.jobs.create({ ...input, monthlyLimit: 0 })).status).toBe("duplicate");
  expect(await repository.listAuthoringJobs(f.actor.workspaceId, 20)).toEqual([legacy]);
  expect(claim.id).toBe(input.request.requestId);
  expect(claim.outline).toBe(assistanceOutline);
  const proposal = assistanceProposal(claim),
    invalid = {
      ...proposal,
      slides: proposal.slides.map((slide, index) =>
        index
          ? slide
          : {
              ...slide,
              citations: [{ locator: "outline line 2", excerpt: slide.citations[0]!.excerpt }],
            },
      ),
    };
  await expect(
    f.jobs.complete({ ...assistanceFence(claim, f.now), proposal: invalid }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.jobs.complete({ ...assistanceFence(claim, f.now), proposal })).toBe(true);
  const ready = (await f.jobs.get({ ...f.context, jobId: claim.id }))!;
  expect(ready.proposal).toEqual(proposal);
  expect(ready.proposalHash).toBe(presentationAssistanceProposalHash(proposal));
  expect(await f.jobs.complete({ ...assistanceFence(claim, f.now), proposal })).toBe(false);
  let attempt = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  expect(attempt.id).toBe(second.job.id);
  const stale = attempt;
  for (let index = 1; index < 3; index++) {
    const later = new Date(f.now.getTime() + index * 1000);
    attempt = (await f.jobs.claim(later, new Date(later.getTime() + 1000)))!;
    expect(attempt.attempt).toBe(index + 1);
  }
  expect(
    await f.jobs.complete({
      ...assistanceFence(stale, new Date(f.now.getTime() + 2000)),
      proposal: assistanceProposal(stale),
    }),
  ).toBe(false);
  expect(
    await f.jobs.claim(new Date(f.now.getTime() + 3000), new Date(f.now.getTime() + 4000)),
  ).toBeNull();
  expect((await f.jobs.get({ ...f.context, jobId: attempt.id }))?.error?.code).toBe(
    "ATTEMPTS_EXHAUSTED",
  );
  const expiry = new Date(ready.expiresAt);
  expect(await f.jobs.purgeExpired(expiry)).toContain(ready.id);
  const expired = (await f.jobs.get({ ...f.context, jobId: ready.id, now: expiry }))!;
  expect(expired).toMatchObject({
    status: "expired",
    sourceName: "Erased outline",
    proposal: null,
    proposalHash: null,
  });
  expect((await f.jobs.create({ ...input, now: expiry })).job.status).toBe("expired");
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(3);
  expect(JSON.stringify(await repository.getAuthoringJob(f.actor.workspaceId, legacy.id))).toBe(
    legacyBefore,
  );
  return { ...f, ready, second: second.job };
}
export async function expectPresentationAssistanceQuota(repository: Repository) {
  const f = await presentationAssistanceFixture(repository);
  await repository.createAuthoringJob(f.legacy());
  const raced = await Promise.allSettled([
    f.jobs.create({ ...f.create(), monthlyLimit: 2 }),
    f.jobs.create({ ...f.create(), monthlyLimit: 2 }),
    repository.createAuthoringJobWithinLimit(f.legacy(), f.since, 2),
    repository.createAuthoringJobWithinLimit(f.legacy(), f.since, 2),
  ]);
  expect(raced.filter((item) => item.status === "fulfilled" && item.value !== null)).toHaveLength(
    1,
  );
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(2);
  await repository.deleteAccount(f.actor.userId);
  // A UUID collision across streams consumes two uses, rather than sharing one receipt.
  const collision = await presentationAssistanceFixture(repository),
    jobId = randomUUID();
  await repository.createAuthoringJob(collision.legacy(jobId));
  await collision.jobs.create({
    ...collision.create(),
    request: { ...collision.request(), requestId: jobId },
    monthlyLimit: 2,
  });
  expect(
    await repository.countAuthoringJobsSince(collision.actor.workspaceId, collision.since),
  ).toBe(2);
  expect(
    await repository.createAuthoringJobWithinLimit(collision.legacy(), collision.since, 2),
  ).toBeNull();
  await repository.deleteAccount(collision.actor.userId);
}
export async function expectPresentationAssistanceErasure(repository: Repository) {
  const f = await presentationAssistanceFixture(repository),
    member = await assistanceIdentity(repository);
  await summaryMember(repository, f.actor, member, "editor");
  const input = { ...f.create(), actorId: member.userId };
  const created = await f.jobs.create(input),
    claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!;
  expect(claim.id).toBe(created.job.id);
  const exported = await repository.exportAccount(member.userId);
  expect(JSON.stringify(exported)).toContain(created.job.id);
  await repository.deleteAccount(member.userId);
  expect(
    await f.jobs.complete({
      ...assistanceFence(claim, f.now),
      proposal: assistanceProposal(claim),
    }),
  ).toBe(false);
  const erased = (await f.jobs.get({ ...f.context, jobId: created.job.id }))!;
  expect(erased).toMatchObject({
    status: "failed",
    sourceName: "Erased outline",
    proposal: null,
    proposalHash: null,
    error: { code: "SOURCE_UNAVAILABLE" },
  });
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
  const next = await f.jobs.create(f.create());
  await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
  expect(await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id)).toBe(
    "deleted",
  );
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(2);
  // Recreating a saved deck with the same ID must not resurrect a removed request receipt.
  await f.presentations.createPresentation({ ...f.presentation, status: "draft" });
  await expect(f.jobs.create({ ...input, actorId: f.actor.userId })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(f.jobs.create({ ...f.create(), monthlyLimit: 2 })).rejects.toMatchObject({
    code: "LIMIT_REACHED",
  });
  await repository.deleteAccount(f.actor.userId);
  return { ...f, member, created: created.job, next: next.job };
}
