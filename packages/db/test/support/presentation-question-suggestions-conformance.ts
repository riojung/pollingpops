import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PresentationDraftSchema,
  PresentationQuestionSuggestionsProposalSchema,
  PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionsSourceDigest,
  presentationQuestionSuggestionsProposalHash,
} from "@openround/contracts";
import {
  buildPresentationQuestionSuggestionsDraft,
  createPresentationQuestionSuggestionsRepository,
  type PresentationQuestionSuggestionsClaim,
  type PresentationDraftUpdate,
  type Repository,
} from "../../src/index.js";
import { assistanceIdentity } from "./presentation-assistance-conformance.js";
import { summaryMember } from "./session-summary-conformance.js";
import { presentationTextAssistanceFixture } from "./presentation-text-assistance-conformance.js";

export async function questionSuggestionsFixture(repository: Repository) {
  const f = await presentationTextAssistanceFixture(repository);
  const result = presentationQuestionSuggestionSource(f.presentation.draft.blocks[0]!);
  if (!result.supported) throw new Error("Invalid fixture source");
  const source = result.source,
    jobs = createPresentationQuestionSuggestionsRepository(repository);
  const request = () => ({
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    presentationId: f.presentation.id,
    blockId: f.blockId,
    expectedRevision: f.presentation.draftRevision,
    sourceDigest: presentationQuestionSuggestionsSourceDigest(source),
    outputLanguage: "en" as const,
  });
  const create = () => ({
    ...f.context,
    request: request(),
    source,
    since: f.since,
    monthlyLimit: 20,
  });
  return { ...f, textJobs: f.jobs, textCreate: f.create, jobs, request, create, source };
}
export function questionProposal(claim: PresentationQuestionSuggestionsClaim) {
  return PresentationQuestionSuggestionsProposalSchema.parse({
    schemaVersion: 1,
    blockId: claim.blockId,
    source: claim.source,
    sourceDigest: claim.sourceDigest,
    outputLanguage: "en",
    suggestions: [
      {
        id: randomUUID(),
        kind: "discussion",
        type: "open_text",
        prompt: "How could the wording about café and 🌱 affect a shared discussion?",
        citations: [
          {
            locator: "body 1 paragraph 1",
            excerpt: "Original private wording preserves exact spaces, café and 🌱.",
          },
        ],
      },
      {
        id: randomUUID(),
        kind: "reflection",
        type: "open_text",
        prompt: "How would you review this wording before using it?",
        citations: [
          {
            locator: "body 1 paragraph 2",
            excerpt: "Review this text before using it in a presentation.",
          },
        ],
      },
    ],
    provider: "test",
    model: "bounded-questions",
    generatedAt: claim.updatedAt,
    reviewWarning: PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  });
}
export const questionFence = (claim: PresentationQuestionSuggestionsClaim, now: Date) => ({
  jobId: claim.id,
  attempt: claim.attempt,
  leaseToken: claim.leaseToken,
  now,
});
export async function readyQuestionSuggestions(
  f: Awaited<ReturnType<typeof questionSuggestionsFixture>>,
) {
  const created = await f.jobs.create(f.create());
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!;
  expect(claim.id).toBe(created.job.id);
  const proposal = questionProposal(claim);
  expect(await f.jobs.complete({ ...questionFence(claim, f.now), proposal })).toBe(true);
  return { jobId: created.job.id, proposal, claim };
}
export function questionInsertion(
  f: Awaited<ReturnType<typeof questionSuggestionsFixture>>,
  ready: Awaited<ReturnType<typeof readyQuestionSuggestions>>,
): PresentationDraftUpdate {
  const mutationId = randomUUID(),
    suggestionId = ready.proposal.suggestions[0]!.id;
  const draft = buildPresentationQuestionSuggestionsDraft({
    draft: f.presentation.draft,
    proposal: ready.proposal,
    jobId: ready.jobId,
    suggestionId,
    mutationId,
  });
  return {
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    editorId: f.actor.userId,
    expectedRevision: f.presentation.draftRevision,
    mutationId,
    draft,
    draftHash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
    questionSuggestionsJobId: ready.jobId,
    questionSuggestionsProposalHash: presentationQuestionSuggestionsProposalHash(ready.proposal),
    questionSuggestionsSourceDigest: ready.proposal.sourceDigest,
    questionSuggestionsBlockId: ready.proposal.blockId,
    questionSuggestionsSuggestionId: suggestionId,
  };
}
export async function expectQuestionSuggestionsConformance(repository: Repository) {
  const f = await questionSuggestionsFixture(repository),
    input = f.create();
  const created = await f.jobs.create(input);
  expect(created.job.requestId).toBe(created.job.id);
  expect((await f.jobs.create({ ...input, source: null })).status).toBe("duplicate");
  await expect(
    f.jobs.create({ ...input, request: { ...input.request, sourceDigest: "f".repeat(64) } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!,
    proposal = questionProposal(claim);
  expect(await f.jobs.complete({ ...questionFence(claim, f.now), proposal })).toBe(true);
  expect(await f.jobs.complete({ ...questionFence(claim, f.now), proposal })).toBe(false);
  const application = questionInsertion(f, { jobId: created.job.id, claim, proposal });
  const changed = await f.presentations.updatePresentationDraft(application);
  expect(changed?.draft.blocks).toHaveLength(2);
  expect(changed?.draft.blocks[0]).toEqual(f.presentation.draft.blocks[0]);
  expect(changed?.draft.blocks[1]).toMatchObject({
    kind: "question",
    question: { type: "open_text", purpose: "opinion", confidence: "off", basePoints: 0 },
  });
  expect(changed?.draft.blocks[1]).not.toHaveProperty("provenance");
  await f.jobs.purgeExpired(new Date(f.now.getTime() + 25 * 60 * 60_000));
  expect(
    (
      await f.jobs.get({
        ...f.context,
        jobId: claim.id,
        now: new Date(f.now.getTime() + 25 * 60 * 60_000),
      })
    )?.status,
  ).toBe("expired");
  expect(await f.presentations.updatePresentationDraft(application)).toEqual(changed);
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
  return f;
}
export async function expectQuestionSuggestionsCapacity(repository: Repository) {
  const f = await questionSuggestionsFixture(repository);
  const one = await f.jobs.create(f.create());
  await f.outlineJobs.create(f.outlineCreate());
  await expect(f.textJobs.create(f.textCreate())).rejects.toMatchObject({
    code: "ACTIVE_LIMIT_REACHED",
  });
  await expect(f.jobs.create(f.create())).rejects.toMatchObject({ code: "ACTIVE_LIMIT_REACHED" });
  expect((await f.jobs.usage({ ...f.context, since: f.since })).active).toBe(2);
  expect((await f.textJobs.usage({ ...f.context, since: f.since })).active).toBe(2);
  expect((await f.outlineJobs.usage({ ...f.context, since: f.since })).active).toBe(2);
  await expect(
    f.textJobs.create({
      ...f.textCreate(),
      request: { ...f.textCreate().request, requestId: one.job.id },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await repository.deleteAccount(f.actor.userId);
  const race = await questionSuggestionsFixture(repository);
  await repository.createAuthoringJob(race.legacy());
  const outcomes = await Promise.allSettled([
    race.jobs.create({ ...race.create(), monthlyLimit: 2 }),
    race.textJobs.create({ ...race.textCreate(), monthlyLimit: 2 }),
    race.outlineJobs.create({ ...race.outlineCreate(), monthlyLimit: 2 }),
    repository.createAuthoringJobWithinLimit(race.legacy(), race.since, 2),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value !== null),
  ).toHaveLength(1);
  expect(await repository.countAuthoringJobsSince(race.actor.workspaceId, race.since)).toBe(2);
  await repository.deleteAccount(race.actor.userId);
}
export async function expectQuestionSuggestionsSourceFence(repository: Repository) {
  for (const change of ["text", "language", "paragraph", "order"]) {
    const f = await questionSuggestionsFixture(repository),
      ready = await readyQuestionSuggestions(f),
      application = questionInsertion(f, ready);
    const draft = structuredClone(f.presentation.draft),
      block = draft.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("fixture");
    if (change === "text")
      block.scene.nodes = block.scene.nodes.map((node) =>
        node.type === "text" && node.role === "body"
          ? { ...node, text: node.text + " changed" }
          : node,
      );
    if (change === "language") {
      draft.schemaVersion = 16;
      block.scene = {
        ...block.scene,
        schemaVersion: 7,
        nodes: block.scene.nodes.map((node) =>
          node.type === "text" ? { ...node, lang: "fr" } : node,
        ),
      };
    }
    if (change === "paragraph") {
      draft.schemaVersion = 13;
      block.scene = {
        ...block.scene,
        schemaVersion: 6,
        nodes: block.scene.nodes.map((node) =>
          node.type === "text" && node.role === "body"
            ? {
                ...node,
                richText: {
                  paragraphs: node.text
                    .split("\n")
                    .map((text) => ({ kind: "bullet" as const, runs: [{ text }] })),
                },
              }
            : node,
        ),
      };
    }
    if (change === "order") block.scene.readingOrder = [...block.scene.readingOrder].reverse();
    await f.presentations.updatePresentationDraft({
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      editorId: f.actor.userId,
      expectedRevision: 1,
      mutationId: randomUUID(),
      draftHash: randomUUID(),
      draft: PresentationDraftSchema.parse(draft),
    });
    expect(
      (
        await f.jobs.create({
          ...f.create(),
          request: { ...f.create().request, requestId: ready.jobId },
        })
      ).status,
    ).toBe("duplicate");
    await expect(
      f.presentations.updatePresentationDraft({ ...application, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await repository.deleteAccount(f.actor.userId);
  }
}
export async function expectQuestionSuggestionsInsertionFence(repository: Repository) {
  const f = await questionSuggestionsFixture(repository),
    ready = await readyQuestionSuggestions(f),
    application = questionInsertion(f, ready);
  const tampered = structuredClone(application);
  const block = tampered.draft.blocks[1]!;
  if (block.kind !== "question") throw new Error("fixture");
  block.question.prompt = "Changed after review";
  await expect(f.presentations.updatePresentationDraft(tampered)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    f.presentations.updatePresentationDraft({
      ...application,
      questionSuggestionsSuggestionId: ready.proposal.suggestions[1]!.id,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.jobs.purgeExpired(new Date(f.now.getTime() + 25 * 60 * 60_000));
  await expect(f.presentations.updatePresentationDraft(application)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await repository.deleteAccount(f.actor.userId);
}
export async function expectQuestionSuggestionsLifecycle(repository: Repository) {
  const f = await questionSuggestionsFixture(repository),
    created = await f.jobs.create(f.create());
  const first = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
  first.source.title.text = "Caller mutated claim snapshot";
  const nextTime = new Date(f.now.getTime() + 1001),
    second = (await f.jobs.claim(nextTime, new Date(nextTime.getTime() + 1000)))!;
  expect(second.source).toEqual(f.source);
  expect(
    await f.jobs.complete({
      ...questionFence(first, nextTime),
      proposal: questionProposal(second),
    }),
  ).toBe(false);
  expect(
    await f.jobs.fail({
      ...questionFence(second, nextTime),
      terminal: false,
      errorCode: "PROVIDER_UNAVAILABLE",
      availableAt: nextTime,
    }),
  ).toBe(true);
  const third = (await f.jobs.claim(nextTime, new Date(nextTime.getTime() + 1000)))!;
  expect(third.attempt).toBe(3);
  expect(
    await f.jobs.fail({
      ...questionFence(third, nextTime),
      terminal: false,
      errorCode: "PROVIDER_UNAVAILABLE",
    }),
  ).toBe(true);
  expect(await f.jobs.get({ ...f.context, jobId: created.job.id })).toMatchObject({
    status: "failed",
    proposal: null,
    error: { code: "ATTEMPTS_EXHAUSTED" },
  });
  expect(await f.jobs.claim(nextTime, new Date(nextTime.getTime() + 1000))).toBeNull();
  const exported = await repository.exportAccount(f.actor.userId);
  expect(JSON.stringify(exported)).not.toContain('"source_snapshot":{');
  await repository.deleteAccount(f.actor.userId);
}
export async function expectQuestionSuggestionsRevocation(repository: Repository) {
  const scenarios = [];
  for (const change of ["remove", "downgrade", "delete"]) {
    const f = await questionSuggestionsFixture(repository),
      author = await assistanceIdentity(repository);
    await summaryMember(repository, f.actor, author, "editor");
    const created = await f.jobs.create({ ...f.create(), actorId: author.userId }),
      claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!,
      proposal = questionProposal(claim);
    await f.jobs.complete({ ...questionFence(claim, f.now), proposal });
    const application = questionInsertion(f, { jobId: created.job.id, claim, proposal });
    const accepted = await f.presentations.updatePresentationDraft(application);
    if (change === "remove")
      await repository.removeWorkspaceMember(f.actor.workspaceId, author.userId);
    else if (change === "downgrade")
      await repository.updateWorkspaceMemberRole(f.actor.workspaceId, author.userId, "viewer");
    else await repository.deleteAccount(author.userId);
    expect(await f.jobs.get({ ...f.context, jobId: created.job.id })).toMatchObject({
      status: "failed",
      proposal: null,
      error: { code: "SOURCE_UNAVAILABLE" },
    });
    expect(await f.presentations.updatePresentationDraft(application)).toEqual(accepted);
    expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
    scenarios.push({ workspaceId: f.actor.workspaceId, jobId: created.job.id });
  }
  return scenarios;
}
