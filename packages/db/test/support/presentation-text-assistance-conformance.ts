import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PresentationDraftSchema,
  PresentationTextAssistanceProvenanceSchema,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceProposalHash,
  presentationTextAssistanceSourceDigest,
  type PresentationTextAssistanceProposal,
} from "@openround/contracts";
import {
  createPresentationTextAssistanceRepository,
  type PresentationTextAssistanceClaim,
  type PresentationDraftUpdate,
  type Repository,
} from "../../src/index.js";
import {
  assistanceIdentity,
  presentationAssistanceFixture,
} from "./presentation-assistance-conformance.js";
import { summaryMember } from "./session-summary-conformance.js";

export const privateText =
  "  Original private wording preserves exact spaces, café and 🌱.\nReview this text before using it in a presentation.  ";
export async function presentationTextAssistanceFixture(repository: Repository) {
  const f = await presentationAssistanceFixture(repository);
  const blockId = randomUUID(),
    nodeId = "Native:Body";
  const draft = PresentationDraftSchema.parse({
    ...f.presentation.draft,
    schemaVersion: 4,
    blocks: [
      {
        id: blockId,
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "PRIVATE_SPEAKER_NOTE",
        citations: [{ locator: "Source page 1", excerpt: "Original source wording" }],
        sourceDisclosure: {
          sourceName: "Imported source",
          sourceDigest: "a".repeat(64),
          provider: "Polling Pops",
          model: "visual-import-v1",
          conversionNotes: ["Preserve original conversion note"],
        },
        scene: {
          schemaVersion: 1,
          aspectRatio: "16:9",
          nodes: [
            {
              id: "Native:Title",
              type: "text",
              role: "title",
              text: "Original title",
              frame: { x: 7, y: 8, width: 86, height: 18 },
            },
            {
              id: nodeId,
              type: "text",
              role: "body",
              text: privateText,
              frame: { x: 7, y: 31, width: 86, height: 59 },
            },
          ],
          readingOrder: ["Native:Title", nodeId],
        },
      },
    ],
  });
  const presentation = (await f.presentations.updatePresentationDraft({
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    draft,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId: f.actor.userId,
    draftHash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
  }))!;
  const jobs = createPresentationTextAssistanceRepository(repository);
  const request = () => ({
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    presentationId: presentation.id,
    blockId,
    nodeId,
    operation: "rewrite" as const,
    expectedRevision: presentation.draftRevision,
    sourceDigest: presentationTextAssistanceSourceDigest(privateText),
  });
  const create = () => ({
    ...f.context,
    request: request(),
    originalText: privateText,
    role: "body" as const,
    since: f.since,
    monthlyLimit: 20,
  });
  return {
    ...f,
    presentation,
    outlineJobs: f.jobs,
    outlineCreate: f.create,
    jobs,
    request,
    create,
    blockId,
    nodeId,
  };
}
export function textProposal(
  claim: PresentationTextAssistanceClaim,
  text = "Reviewed concise wording.",
): PresentationTextAssistanceProposal {
  return {
    schemaVersion: 1,
    nodeId: claim.nodeId,
    role: claim.role,
    operation: claim.operation,
    sourceDigest: claim.sourceDigest,
    outputDigest: presentationTextAssistanceSourceDigest(text),
    provider: "test",
    model: "bounded-text",
    generatedAt: claim.updatedAt,
    reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
    blockId: claim.blockId,
    originalText: claim.originalText,
    text,
    ...(claim.operation === "translate"
      ? { targetLanguage: claim.targetLanguage, sourceLanguage: claim.sourceLanguage }
      : {}),
  };
}
export const textFence = (claim: PresentationTextAssistanceClaim, now: Date) => ({
  jobId: claim.id,
  attempt: claim.attempt,
  leaseToken: claim.leaseToken,
  now,
});
export function textApplication(
  f: Awaited<ReturnType<typeof presentationTextAssistanceFixture>>,
  jobId: string,
  proposal: PresentationTextAssistanceProposal,
): PresentationDraftUpdate {
  const metadata = PresentationTextAssistanceProvenanceSchema.parse({
    schemaVersion: proposal.schemaVersion,
    nodeId: proposal.nodeId,
    role: proposal.role,
    operation: proposal.operation,
    sourceDigest: proposal.sourceDigest,
    outputDigest: proposal.outputDigest,
    provider: proposal.provider,
    model: proposal.model,
    generatedAt: proposal.generatedAt,
    reviewWarning: proposal.reviewWarning,
    ...(proposal.operation === "translate"
      ? { targetLanguage: proposal.targetLanguage, sourceLanguage: proposal.sourceLanguage }
      : {}),
  });
  const draft = PresentationDraftSchema.parse({
    ...f.presentation.draft,
    schemaVersion: Math.max(
      proposal.operation === "translate" ? 16 : 15,
      f.presentation.draft.schemaVersion,
    ),
    blocks: f.presentation.draft.blocks.map((block) =>
      block.kind !== "content" || block.id !== proposal.blockId
        ? block
        : {
            ...block,
            textAssistance: metadata,
            scene: {
              ...block.scene!,
              ...(proposal.operation === "translate" ? { schemaVersion: 7 as const } : {}),
              nodes: block.scene!.nodes.map((node) =>
                node.id === proposal.nodeId
                  ? {
                      ...node,
                      text: proposal.text,
                      ...(proposal.operation === "translate"
                        ? { lang: proposal.targetLanguage }
                        : {}),
                    }
                  : node,
              ),
            },
          },
    ),
  });
  return {
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    draft,
    expectedRevision: f.presentation.draftRevision,
    mutationId: randomUUID(),
    editorId: f.actor.userId,
    draftHash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
    textAssistanceJobId: jobId,
    textAssistanceProposalHash: presentationTextAssistanceProposalHash(proposal),
    textAssistanceSourceDigest: proposal.sourceDigest,
    textAssistanceBlockId: proposal.blockId,
    textAssistanceNodeId: proposal.nodeId,
    ...(proposal.operation === "translate"
      ? {
          textAssistanceTargetLanguage: proposal.targetLanguage,
          textAssistanceSourceLanguage: proposal.sourceLanguage,
        }
      : {}),
  };
}

export async function expectPresentationTranslationConformance(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository);
  const input = {
    ...f.create(),
    request: {
      ...f.request(),
      operation: "translate" as const,
      targetLanguage: "fr" as const,
      sourceLanguage: null,
    },
  };
  const created = await f.jobs.create(input);
  expect(created.job).toMatchObject({
    operation: "translate",
    targetLanguage: "fr",
    sourceLanguage: null,
  });
  expect((await f.jobs.create(input)).status).toBe("duplicate");
  await expect(
    f.jobs.create({ ...input, request: { ...input.request, targetLanguage: "de" } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    f.jobs.create({
      ...input,
      request: { ...input.request, requestId: randomUUID(), sourceLanguage: "en" },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  const proposal = textProposal(claim, "Texte privé à examiner avant utilisation.");
  await expect(
    f.jobs.complete({
      ...textFence(claim, f.now),
      proposal: { ...proposal, targetLanguage: "de" },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.jobs.complete({ ...textFence(claim, f.now), proposal })).toBe(true);
  const application = textApplication(f, claim.id, proposal);
  await expect(
    f.presentations.updatePresentationDraft({ ...application, textAssistanceTargetLanguage: "de" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    f.presentations.updatePresentationDraft({
      ...application,
      textAssistanceSourceLanguage: undefined,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const accepted = (await f.presentations.updatePresentationDraft(application))!;
  expect(accepted.draft.schemaVersion).toBe(16);
  const block = accepted.draft.blocks[0]!;
  if (block.kind !== "content" || !block.scene) throw new Error("Expected translated scene");
  expect(block.scene.schemaVersion).toBe(7);
  expect(block.scene.nodes.find((node) => node.id === f.nodeId)).toMatchObject({
    text: proposal.text,
    lang: "fr",
  });
  expect(block.scene.nodes[0]).toEqual(
    f.presentation.draft.blocks[0]!.kind === "content"
      ? f.presentation.draft.blocks[0]!.scene!.nodes[0]
      : null,
  );
  expect(block.citations).toEqual(f.presentation.draft.blocks[0]!.citations);
  expect(block.sourceDisclosure).toEqual(f.presentation.draft.blocks[0]!.sourceDisclosure);
  let currentAccepted = accepted;
  // Latest-edit metadata can move to another object; each translated object keeps its language.
  for (const selected of [
    {
      nodeId: "Native:Title",
      role: "title" as const,
      originalText: "Original title",
      sourceLanguage: null,
      targetLanguage: "ko" as const,
      text: "원래 제목",
    },
    {
      nodeId: f.nodeId,
      role: "body" as const,
      originalText: proposal.text,
      sourceLanguage: "fr" as const,
      targetLanguage: "de" as const,
      text: "Privaten Text vor der Verwendung prüfen.",
    },
  ]) {
    await f.jobs.create({
      ...f.create(),
      role: selected.role,
      originalText: selected.originalText,
      request: {
        ...f.request(),
        nodeId: selected.nodeId,
        expectedRevision: currentAccepted.draftRevision,
        sourceDigest: presentationTextAssistanceSourceDigest(selected.originalText),
        operation: "translate",
        targetLanguage: selected.targetLanguage,
        sourceLanguage: selected.sourceLanguage,
      },
    });
    const nextClaim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
    const nextProposal = textProposal(nextClaim, selected.text);
    expect(await f.jobs.complete({ ...textFence(nextClaim, f.now), proposal: nextProposal })).toBe(
      true,
    );
    currentAccepted = (await f.presentations.updatePresentationDraft(
      textApplication({ ...f, presentation: currentAccepted }, nextClaim.id, nextProposal),
    ))!;
    expect(currentAccepted.draft.blocks[0]).toMatchObject({
      scene: {
        nodes: [
          { id: "Native:Title", lang: "ko" },
          { id: f.nodeId, lang: selected.role === "title" ? "fr" : "de" },
        ],
      },
    });
  }
  const later = structuredClone(currentAccepted.draft);
  const laterBlock = later.blocks[0]!;
  if (laterBlock.kind !== "content" || !laterBlock.scene) throw new Error("Missing scene");
  const node = laterBlock.scene.nodes.find((node) => node.id === f.nodeId)!;
  if (node.type !== "text") throw new Error("Missing text");
  node.lang = "es";
  await f.presentations.updatePresentationDraft({
    ...application,
    draft: later,
    expectedRevision: currentAccepted.draftRevision,
    mutationId: randomUUID(),
    draftHash: createHash("sha256").update(JSON.stringify(later)).digest("hex"),
    textAssistanceJobId: undefined,
  });
  expect((await f.jobs.create({ ...input, originalText: "", monthlyLimit: 0 })).status).toBe(
    "duplicate",
  );
  await f.jobs.purgeExpired(new Date(claim.expiresAt));
  expect(await f.presentations.updatePresentationDraft(application)).toEqual(accepted);
  return { ...f, application, accepted, proposal, claim };
}

export async function expectPresentationTranslationLanguageFence(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository);
  const input = {
    ...f.create(),
    request: {
      ...f.request(),
      operation: "translate" as const,
      targetLanguage: "fr" as const,
      sourceLanguage: null,
    },
  };
  await f.jobs.create(input);
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  const proposal = textProposal(claim);
  await f.jobs.complete({ ...textFence(claim, f.now), proposal });
  const current = structuredClone(f.presentation.draft);
  current.schemaVersion = 16;
  const block = current.blocks[0]!;
  if (block.kind !== "content" || !block.scene) throw new Error("Missing scene");
  block.scene.schemaVersion = 7;
  const node = block.scene.nodes.find((node) => node.id === f.nodeId)!;
  if (node.type !== "text") throw new Error("Missing text");
  node.lang = "en";
  const changed = (await f.presentations.updatePresentationDraft({
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    draft: current,
    expectedRevision: f.presentation.draftRevision,
    mutationId: randomUUID(),
    draftHash: "manual-language-correction",
    editorId: f.actor.userId,
  }))!;
  await expect(
    f.presentations.updatePresentationDraft({
      ...textApplication(f, claim.id, proposal),
      expectedRevision: changed.draftRevision,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id)).toEqual(
    changed,
  );
}

export async function expectPresentationTranslationUnchangedWording(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository);
  const input = {
    ...f.create(),
    request: {
      ...f.request(),
      operation: "translate" as const,
      targetLanguage: "ja" as const,
      sourceLanguage: null,
    },
  };
  await f.jobs.create(input);
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  const proposal = textProposal(claim, claim.originalText);
  expect(await f.jobs.complete({ ...textFence(claim, f.now), proposal })).toBe(true);
  const accepted = (await f.presentations.updatePresentationDraft(
    textApplication(f, claim.id, proposal),
  ))!;
  expect(accepted.draft.blocks[0]).toMatchObject({
    scene: { nodes: [{}, { text: privateText, lang: "ja" }] },
  });
}
export async function expectPresentationTextAssistanceConformance(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository),
    input = f.create();
  const created = await Promise.all([f.jobs.create(input), f.jobs.create(input)]);
  expect(created.map(({ status }) => status).sort()).toEqual(["created", "duplicate"]);
  const uppercase = {
    ...input,
    workspaceId: input.workspaceId.toUpperCase(),
    actorId: input.actorId.toUpperCase(),
    presentationId: input.presentationId.toUpperCase(),
    request: {
      ...input.request,
      requestId: input.request.requestId.toUpperCase(),
      presentationId: input.request.presentationId.toUpperCase(),
      blockId: input.request.blockId.toUpperCase(),
    },
  };
  expect((await f.jobs.create(uppercase)).status).toBe("duplicate");
  await expect(
    f.jobs.create({ ...input, request: { ...input.request, operation: "shorten" } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  for (const patch of [
    { nodeId: "native:body" },
    { expectedRevision: 0 },
    { sourceDigest: "b".repeat(64) },
  ])
    await expect(
      f.jobs.create({ ...f.create(), request: { ...f.request(), ...patch } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    f.jobs.create({ ...f.create(), originalText: privateText.trim() }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  expect(claim.originalText).toBe(privateText);
  const proposal = textProposal(claim);
  await expect(
    f.jobs.complete({
      ...textFence(claim, f.now),
      proposal: { ...proposal, nodeId: "another-node" },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.jobs.complete({ ...textFence(claim, f.now), proposal })).toBe(true);
  const ready = (await f.jobs.get({ ...f.context, jobId: claim.id }))!;
  expect(ready.proposal).toEqual(proposal);
  expect(ready.proposalHash).toBe(presentationTextAssistanceProposalHash(proposal));
  expect(await f.jobs.complete({ ...textFence(claim, f.now), proposal })).toBe(false);
  const application = textApplication(f, ready.id, proposal);
  const accepted = (await f.presentations.updatePresentationDraft(application))!;
  expect(accepted.draft.schemaVersion).toBe(15);
  expect(accepted.draft.blocks[0]).toMatchObject({
    sourceDisclosure: f.presentation.draft.blocks[0]!.sourceDisclosure,
    citations: f.presentation.draft.blocks[0]!.citations,
  });
  expect(
    accepted.draft.blocks[0]!.kind === "content" && accepted.draft.blocks[0]!.scene?.schemaVersion,
  ).toBe(1);
  // The current source is now changed, but an exact create replay must precede source/allowance checks.
  expect((await f.jobs.create({ ...input, originalText: "", monthlyLimit: 0 })).status).toBe(
    "duplicate",
  );
  const later = { ...accepted.draft, title: "Later ordinary edit" };
  await f.presentations.updatePresentationDraft({
    ...application,
    draft: later,
    expectedRevision: accepted.draftRevision,
    mutationId: randomUUID(),
    draftHash: createHash("sha256").update(JSON.stringify(later)).digest("hex"),
    textAssistanceJobId: undefined,
  });
  const expiry = new Date(ready.expiresAt);
  await f.jobs.purgeExpired(expiry);
  expect(await f.jobs.get({ ...f.context, jobId: ready.id, now: expiry })).toMatchObject({
    status: "expired",
    proposal: null,
    proposalHash: null,
  });
  expect(await f.presentations.updatePresentationDraft(application)).toEqual(accepted);
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
  return { ...f, ready, accepted, application, input };
}
export async function expectPresentationTextAssistanceCapacity(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository);
  const first = await f.outlineJobs.create(f.outlineCreate());
  await f.jobs.create(f.create());
  await expect(f.jobs.create(f.create())).rejects.toMatchObject({ code: "ACTIVE_LIMIT_REACHED" });
  await expect(f.outlineJobs.create(f.outlineCreate())).rejects.toMatchObject({
    code: "ACTIVE_LIMIT_REACHED",
  });
  expect(await f.jobs.usage({ ...f.context, since: f.since })).toEqual({ used: 2, active: 2 });
  expect(await f.outlineJobs.usage({ ...f.context, since: f.since })).toEqual({
    used: 2,
    active: 2,
  });
  await expect(
    f.jobs.create({ ...f.create(), request: { ...f.request(), requestId: first.job.id } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await repository.deleteAccount(f.actor.userId);
  const race = await presentationTextAssistanceFixture(repository);
  await repository.createAuthoringJob(race.legacy());
  const results = await Promise.allSettled([
    race.jobs.create({ ...race.create(), monthlyLimit: 2 }),
    race.outlineJobs.create({ ...race.outlineCreate(), monthlyLimit: 2 }),
    repository.createAuthoringJobWithinLimit(race.legacy(), race.since, 2),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled" && result.value !== null),
  ).toHaveLength(1);
  expect(await repository.countAuthoringJobsSince(race.actor.workspaceId, race.since)).toBe(2);
  await repository.deleteAccount(race.actor.userId);
}
export async function expectPresentationTextAssistanceRevocation(repository: Repository) {
  const scenarios: Array<{ workspaceId: string; jobId: string }> = [];
  for (const change of ["remove", "downgrade"] as const)
    for (const firstRead of ["get", "list"] as const) {
      const f = await presentationTextAssistanceFixture(repository),
        author = await assistanceIdentity(repository);
      await summaryMember(repository, f.actor, author, "editor");
      const input = { ...f.create(), actorId: author.userId };
      const created = await f.jobs.create(input),
        claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60000)))!;
      expect(
        await f.jobs.complete({ ...textFence(claim, f.now), proposal: textProposal(claim) }),
      ).toBe(true);
      const application = textApplication(f, created.job.id, textProposal(claim)),
        accepted = await f.presentations.updatePresentationDraft(application);
      if (change === "remove")
        await repository.removeWorkspaceMember(f.actor.workspaceId, author.userId);
      else await repository.updateWorkspaceMemberRole(f.actor.workspaceId, author.userId, "viewer");
      const result =
        firstRead === "get"
          ? await f.jobs.get({ ...f.context, jobId: created.job.id })
          : (await f.jobs.list(f.context))[0];
      expect(result, `${change} then ${firstRead}`).toMatchObject({
        status: "failed",
        proposal: null,
        proposalHash: null,
        error: { code: "SOURCE_UNAVAILABLE" },
      });
      expect(await f.presentations.updatePresentationDraft(application)).toEqual(accepted);
      expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
      scenarios.push({ workspaceId: f.actor.workspaceId, jobId: created.job.id });
    }
  return scenarios;
}

export async function expectPresentationTextAssistanceTargetFence(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository);
  await f.jobs.create(f.create());
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60000)))!,
    proposal = textProposal(claim);
  await f.jobs.complete({ ...textFence(claim, f.now), proposal });
  const application = textApplication(f, claim.id, proposal);
  const unrelated = { ...f.presentation.draft, title: "New saved deck title" };
  const next = (await f.presentations.updatePresentationDraft({
    ...application,
    draft: unrelated,
    mutationId: randomUUID(),
    draftHash: "b".repeat(64),
    textAssistanceJobId: undefined,
  }))!;
  await expect(f.presentations.updatePresentationDraft(application)).rejects.toMatchObject({
    name: "PresentationDraftConflictError",
  });
  expect(
    await f.presentations.updatePresentationDraft({
      ...application,
      draft: { ...application.draft, title: unrelated.title },
      expectedRevision: next.draftRevision,
    }),
  ).toMatchObject({ draftRevision: next.draftRevision + 1 });
  const changed = await presentationTextAssistanceFixture(repository);
  await changed.jobs.create(changed.create());
  const other = (await changed.jobs.claim(changed.now, new Date(changed.now.getTime() + 60000)))!,
    otherProposal = textProposal(other);
  await changed.jobs.complete({ ...textFence(other, changed.now), proposal: otherProposal });
  const changedApplication = textApplication(changed, other.id, otherProposal);
  const block = changed.presentation.draft.blocks[0]!;
  if (block.kind !== "content") throw new Error("Expected native slide");
  const edited = {
    ...changed.presentation.draft,
    blocks: [
      {
        ...block,
        scene: {
          ...block.scene!,
          nodes: block.scene!.nodes.map((node) =>
            node.id === changed.nodeId
              ? { ...node, role: "title" as const }
              : { ...node, role: "body" as const },
          ),
        },
      },
    ],
  };
  const saved = (await changed.presentations.updatePresentationDraft({
    ...changedApplication,
    draft: edited,
    textAssistanceJobId: undefined,
    mutationId: randomUUID(),
    draftHash: "c".repeat(64),
  }))!;
  await expect(
    changed.presentations.updatePresentationDraft({
      ...changedApplication,
      expectedRevision: saved.draftRevision,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
}

export async function expectPresentationTextAssistanceLifecycle(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository),
    input = f.create();
  const created = await f.jobs.create(input),
    first = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  let claim = first;
  for (let step = 1; step < 3; step++) {
    const now = new Date(f.now.getTime() + step * 1000);
    claim = (await f.jobs.claim(now, new Date(now.getTime() + 1000)))!;
    expect(claim.attempt).toBe(step + 1);
  }
  expect(
    await f.jobs.complete({
      ...textFence(first, new Date(f.now.getTime() + 2000)),
      proposal: textProposal(first),
    }),
  ).toBe(false);
  expect(
    await f.jobs.claim(new Date(f.now.getTime() + 3000), new Date(f.now.getTime() + 4000)),
  ).toBeNull();
  expect(await f.jobs.get({ ...f.context, jobId: claim.id })).toMatchObject({
    status: "failed",
    error: { code: "ATTEMPTS_EXHAUSTED" },
  });
  await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
  await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id);
  await f.presentations.createPresentation({ ...f.presentation, status: "draft" });
  await expect(f.jobs.create(input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
  expect(JSON.stringify(await repository.exportAccount(f.actor.userId))).not.toContain(
    created.job.id,
  );
}

export async function expectPresentationTextAssistanceActorErasure(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository),
    author = await assistanceIdentity(repository);
  await summaryMember(repository, f.actor, author, "editor");
  const created = await f.jobs.create({ ...f.create(), actorId: author.userId });
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60000)))!,
    proposal = textProposal(claim);
  expect(await f.jobs.complete({ ...textFence(claim, f.now), proposal })).toBe(true);
  const application = textApplication(f, created.job.id, proposal),
    accepted = (await f.presentations.updatePresentationDraft(application))!;
  expect(JSON.stringify(await repository.exportAccount(author.userId))).toContain(created.job.id);
  await repository.deleteAccount(author.userId);
  expect(await f.jobs.get({ ...f.context, jobId: created.job.id })).toMatchObject({
    status: "failed",
    proposal: null,
    proposalHash: null,
    error: { code: "SOURCE_UNAVAILABLE" },
  });
  expect(await f.presentations.updatePresentationDraft(application)).toEqual(accepted);
  await expect(
    f.jobs.create({
      ...f.create(),
      originalText: proposal.text,
      monthlyLimit: 1,
      request: {
        ...f.request(),
        sourceDigest: proposal.outputDigest,
        expectedRevision: accepted.draftRevision,
      },
    }),
  ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  return { ...f, created: created.job };
}
