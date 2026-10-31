import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanvasArtifactLinkCreateSchema,
  CanvasArtifactLinkDeleteSchema,
  CanvasArtifactLinkListSchema,
  CanvasArtifactLinkMutationResponseSchema,
} from "../src/index.js";
describe("independent authoring-only canvas link protocol", () => {
  it("accepts only bounded identifiers, not scene payloads or credentials", () => {
    const input = {
      schemaVersion: 1,
      operationId: randomUUID(),
      linkId: randomUUID(),
      boardId: randomUUID(),
      versionId: randomUUID(),
    };
    expect(CanvasArtifactLinkCreateSchema.parse(input)).toEqual(input);
    for (const extra of [
      { objects: [] },
      { token: "a".repeat(64) },
      { workspaceId: randomUUID() },
      { name: "private source" },
    ])
      expect(CanvasArtifactLinkCreateSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    expect(
      CanvasArtifactLinkCreateSchema.safeParse({ ...input, boardId: "../other-workspace" }).success,
    ).toBe(false);
    expect(
      CanvasArtifactLinkDeleteSchema.safeParse({
        schemaVersion: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });
  it("keeps replay acknowledgements independent of currently available link content", () => {
    const result = {
      schemaVersion: 1,
      receipt: { operationId: randomUUID(), linkId: randomUUID(), deleted: true },
    };
    expect(CanvasArtifactLinkMutationResponseSchema.parse(result)).toEqual(result);
    expect(
      CanvasArtifactLinkMutationResponseSchema.safeParse({ ...result, objects: [] }).success,
    ).toBe(false);
    expect(
      CanvasArtifactLinkListSchema.safeParse({
        schemaVersion: 1,
        canCreate: false,
        links: [],
        sourceBoard: {},
      }).success,
    ).toBe(false);
  });
});
