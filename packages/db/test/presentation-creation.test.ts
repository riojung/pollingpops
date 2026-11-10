import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/index.js";
import {
  expectPresentationCreationRecovery,
  expectPresentationCreationAuthority,
  expectPresentationCreationDeletion,
  presentationCreationFixture,
} from "./support/presentation-creation-conformance.js";
describe("Presentation creation persistence", () => {
  it("projects the first visible slide without notes and keeps previews workspace scoped", async () => {
    const fixture = await presentationCreationFixture(new MemoryRepository());
    const record = fixture.record();
    const hidden = record.draft.blocks[0]!;
    hidden.hidden = true;
    const visible = structuredClone(hidden);
    visible.id = "00000000-0000-4000-8000-000000000011";
    delete visible.hidden;
    if (visible.kind === "content") visible.speakerNotes = "Private facilitator notes";
    record.draft.blocks.push(visible);
    await fixture.presentations.createPresentation(record);
    const [summary] = await fixture.presentations.listPresentations(fixture.actor.workspaceId);
    expect(summary?.previewBlock?.id).toBe(visible.id);
    expect(JSON.stringify(summary)).not.toContain("Private facilitator notes");
    expect(summary).not.toHaveProperty("draft");
    expect(
      await fixture.presentations.listPresentations("00000000-0000-4000-8000-000000000099"),
    ).toEqual([]);
  });
  it("deduplicates concurrent intent and returns the current edited publication without charging allowance", async () => {
    await expectPresentationCreationRecovery(new MemoryRepository());
  });
  it("binds account/workspace and current editor authority before creation or recovery", async () => {
    await expectPresentationCreationAuthority(new MemoryRepository());
  });
  it("retains compact creation identity after target deletion", async () => {
    await expectPresentationCreationDeletion(new MemoryRepository());
  });
});
