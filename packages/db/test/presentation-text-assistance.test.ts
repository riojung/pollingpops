import { describe, expect, it } from "vitest";
import {
  MemoryRepository,
  upcastPresentationDraft,
  upcastPresentationContent,
} from "../src/index.js";
import {
  expectPresentationTextAssistanceTargetFence,
  expectPresentationTextAssistanceLifecycle,
  expectPresentationTextAssistanceActorErasure,
  expectPresentationTextAssistanceConformance,
  expectPresentationTextAssistanceCapacity,
  expectPresentationTextAssistanceRevocation,
  presentationTextAssistanceFixture,
} from "./support/presentation-text-assistance-conformance.js";
describe("Presentation single-node text assistance persistence", () => {
  it("binds exact text and complete intent, preserves original evidence and recovers accepted receipts after expiry and later edits", async () => {
    await expectPresentationTextAssistanceConformance(new MemoryRepository());
  });
  it("shares the active cap, monthly allowance and consumed request identities with outline assistance", async () => {
    await expectPresentationTextAssistanceCapacity(new MemoryRepository());
  });
  it("erases ready private proposals on first get or list after creator removal or downgrade", async () => {
    await expectPresentationTextAssistanceRevocation(new MemoryRepository());
  });
  it("checks the actual current node and role inside apply, including when an unrelated revision advances", async () => {
    await expectPresentationTextAssistanceTargetFence(new MemoryRepository());
  });
  it("fences stale leases and attempts, erases failures, and keeps compact admissions after deck deletion", async () => {
    await expectPresentationTextAssistanceLifecycle(new MemoryRepository());
  });
  it("erases deleted-actor source/proposals and keeps accepted receipts and consumed allowance in surviving workspaces", async () => {
    await expectPresentationTextAssistanceActorErasure(new MemoryRepository());
  });
  it("uses explicit version15 codecs and refuses mismatching older stored-version claims", async () => {
    const f = await presentationTextAssistanceFixture(new MemoryRepository());
    const draft = { ...f.presentation.draft, schemaVersion: 15 };
    expect(upcastPresentationDraft(draft, 15)).toEqual(draft);
    expect(upcastPresentationContent(draft, 15)).toEqual(draft);
    expect(() => upcastPresentationDraft(draft, 14)).toThrow();
    expect(() => upcastPresentationContent(draft, 14)).toThrow();
  });
});
