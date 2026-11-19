import { describe, expect, it } from "vitest";
import { StarterCopyRequestSchema, StarterUseRequestSchema } from "../src/index.js";

const request = () => ({
  locale: "ko-KR",
  idempotencyKey: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  creationContext: {
    actorId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    workspaceId: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
  },
  contentVersion: "launch-collection-v2",
  expiresAt: "2026-11-20T12:00:00Z",
});

describe("durable Round starter copy requests", () => {
  it("preserves intentional legacy copies and canonicalizes durable context", () => {
    expect(StarterUseRequestSchema.parse({})).toEqual({ locale: "en-CA" });
    expect(StarterUseRequestSchema.parse({ locale: "fr-FR" })).toEqual({ locale: "fr-FR" });
    const input = StarterCopyRequestSchema.parse(request());
    expect(input).toEqual({
      ...request(),
      idempotencyKey: request().idempotencyKey.toLowerCase(),
      creationContext: {
        actorId: request().creationContext.actorId.toLowerCase(),
        workspaceId: request().creationContext.workspaceId.toLowerCase(),
      },
      expiresAt: "2026-11-20T12:00:00.000Z",
    });
    expect(StarterUseRequestSchema.parse(request())).toEqual(input);
  });

  it("requires every durable field without falling back to a fresh legacy copy", () => {
    for (const field of Object.keys(request())) {
      const missing: Record<string, unknown> = { ...request() };
      delete missing[field];
      expect(StarterUseRequestSchema.safeParse(missing).success, field).toBe(false);
    }
    for (const update of [
      { expiresAt: "tomorrow" },
      { contentVersion: 2 },
      { contentVersion: "" },
      { locale: "unknown" },
      { idempotencyKey: "invalid" },
      { creationContext: { ...request().creationContext, extra: true } },
      { draft: {} },
    ])
      expect(StarterUseRequestSchema.safeParse({ ...request(), ...update }).success).toBe(false);
    expect(StarterUseRequestSchema.safeParse({ locale: "en-CA", extra: true }).success).toBe(false);
  });
});
