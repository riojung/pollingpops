import { describe, it, expect } from "vitest";
import { MemoryRepository, createPresentationAssistanceRepository } from "../src/index.js";
import {
  expectPresentationAssistanceConformance,
  expectPresentationAssistanceQuota,
  expectPresentationAssistanceErasure,
  presentationAssistanceFixture,
  assistanceProposal,
  assistanceFence,
  assistanceIdentity,
} from "./support/presentation-assistance-conformance.js";
import { summaryMember } from "./support/session-summary-conformance.js";
describe("Presentation outline assistance persistence", () => {
  it("deduplicates exact intent before limits and fences bounded worker attempts, exact citations and expiry", async () => {
    await expectPresentationAssistanceConformance(new MemoryRepository());
  });
  it("serializes final shared allowance across the legacy and new queues, counting colliding UUIDs separately", async () => {
    await expectPresentationAssistanceQuota(new MemoryRepository());
  });
  it("erases account and deck private data without resetting monthly use or request identity", async () => {
    await expectPresentationAssistanceErasure(new MemoryRepository());
  });
  it("rechecks current editor role at admission and completion, and makes terminal failures erase raw input", async () => {
    const repository = new MemoryRepository(),
      f = await presentationAssistanceFixture(repository),
      member = await assistanceIdentity(repository);
    await summaryMember(repository, f.actor, member, "editor");
    const input = { ...f.create(), actorId: member.userId },
      job = await f.jobs.create(input),
      claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
    await repository.updateWorkspaceMemberRole(f.actor.workspaceId, member.userId, "viewer");
    expect(
      await f.jobs.complete({
        ...assistanceFence(claim, f.now),
        proposal: assistanceProposal(claim),
      }),
    ).toBe(false);
    await expect(f.jobs.create({ ...input, request: { ...f.request() } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await f.jobs.get({ ...f.context, jobId: job.job.id }))?.error?.code).toBe(
      "SOURCE_UNAVAILABLE",
    );
    const failed = await f.jobs.create(f.create()),
      next = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 1000)))!;
    expect(next.id).toBe(failed.job.id);
    expect(
      await f.jobs.fail({
        ...assistanceFence(next, f.now),
        errorCode: "PROVIDER_UNAVAILABLE",
        terminal: true,
      }),
    ).toBe(true);
    expect(
      await f.jobs.claim(new Date(f.now.getTime() + 1000), new Date(f.now.getTime() + 2000)),
    ).toBeNull();
  });
  it("blocks admissions while another lifecycle extension delays account erasure", async () => {
    const repository = new MemoryRepository(),
      f = await presentationAssistanceFixture(repository);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.getOrCreateLifecycleExtension("assistance-erasure-delay", () => ({
      exportAccount: () => ({}),
      deleteAccount: () => held,
    }));
    const deleting = repository.deleteAccount(f.actor.userId);
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      createPresentationAssistanceRepository(repository).create(f.create()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    release();
    await deleting;
  });
});
