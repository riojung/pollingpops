import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationVisualImportRepository,
  assertMemoryPresentationVisualImportReady,
} from "../src/index.js";
import { PresentationDraftSchema } from "@openround/contracts";
import { expectPresentationVisualImportConformance } from "./support/presentation-visual-import-conformance.js";
describe("Presentation visual import persistence", () => {
  it("fences worker attempts, owns pending assets, requires clean pages and erases private sources on cancellation", async () => {
    const repository = new MemoryRepository(),
      tokenHash = randomUUID(),
      now = new Date();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `visual-${randomUUID()}@example.com`,
      segment: "education",
      tokenHash,
      policyVersion: "test",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const owner = (await repository.consumeMagicToken(tokenHash, now))!;
    await expectPresentationVisualImportConformance(repository, owner.workspaceId, owner.userId);
  });
  it("enforces workspace admission limits without consuming exact retry requests", async () => {
    const repository = new MemoryRepository(),
      workspaceId = randomUUID(),
      userId = randomUUID(),
      now = new Date();
    const presentations = createPresentationRepository(repository),
      jobs = createPresentationVisualImportRepository(repository),
      draft = PresentationDraftSchema.parse({ title: "Capacity", blocks: [] });
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftSchemaVersion: 2,
      draftRevision: 0,
      currentVersionId: null,
      publishedDraftRevision: null,
      lastEditedBy: userId,
      folderId: null,
      createdAt: now,
      updatedAt: now,
    });
    const make = () => ({
      id: randomUUID(),
      workspaceId,
      presentationId: presentation.id,
      createdBy: userId,
      requestId: randomUUID(),
      requestHash: "a".repeat(64),
      sourceDigest: createHash("sha256").update("input").digest("hex"),
      files: [{ name: "Source.png", mimeType: "image/png" as const, bytes: Buffer.from("input") }],
      now,
    });
    const inputs = Array.from({ length: 3 }, make);
    await Promise.all(inputs.map((input) => jobs.create(input)));
    await expect(jobs.create(make())).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    expect((await jobs.create(inputs[0]!)).status).toBe("duplicate");
    for (const input of inputs) await jobs.cancel(workspaceId, presentation.id, input.id, now);
    for (let index = 3; index < 10; index++) {
      const input = make();
      await jobs.create(input);
      await jobs.cancel(workspaceId, presentation.id, input.id, now);
    }
    await expect(jobs.create(make())).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    expect(() =>
      assertMemoryPresentationVisualImportReady(
        repository,
        workspaceId,
        presentation.id,
        inputs[0]!.id,
      ),
    ).toThrow();
    await presentations.archivePresentation(workspaceId, presentation.id, true);
    expect(await presentations.deletePresentation(workspaceId, presentation.id)).toBe("deleted");
    expect(await jobs.list(workspaceId, presentation.id)).toEqual([]);
    const replacement = await presentations.createPresentation({
      ...presentation,
      id: randomUUID(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await expect(jobs.create({ ...make(), presentationId: replacement.id })).rejects.toMatchObject({
      code: "LIMIT_REACHED",
    });
  });
});
