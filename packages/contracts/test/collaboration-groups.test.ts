import { describe, expect, it } from "vitest";
import { CollaborationGroupCreateSchema, CollaborationGroupUpdateSchema } from "../src/index.js";
describe("collaboration group mutations", () => {
  it("preserves legacy workspace create defaults and explicitly validates organization scope", () => {
    expect(CollaborationGroupCreateSchema.parse({ name: "  Team  " })).toEqual({
      name: "Team",
      description: "",
      scope: "workspace",
      purpose: "team",
    });
    expect(
      CollaborationGroupCreateSchema.safeParse({ name: "Team", scope: "public" }).success,
    ).toBe(false);
    expect(
      CollaborationGroupCreateSchema.safeParse({ name: "Team", purpose: "unbounded" }).success,
    ).toBe(false);
    expect(
      CollaborationGroupCreateSchema.safeParse({ name: "Team", members: ["forged"] }).success,
    ).toBe(false);
  });
  it("accepts bounded metadata/lifecycle changes and rejects empty or authority fields", () => {
    expect(CollaborationGroupUpdateSchema.parse({ status: "archived", purpose: "cohort" })).toEqual(
      { status: "archived", purpose: "cohort" },
    );
    expect(CollaborationGroupUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      CollaborationGroupUpdateSchema.safeParse({
        organizationId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });
});
