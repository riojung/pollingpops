import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CreatePresentationSchema, CreateOutlinePresentationSchema } from "../src/index.js";

describe("stable presentation creation contracts", () => {
  it("preserves ordinary creation and normalizes explicit recovery context", () => {
    expect(CreatePresentationSchema.parse({ title: " A deck " })).toEqual({
      title: "A deck",
      description: "",
    });
    const creationRequestId = randomUUID(),
      actorId = randomUUID(),
      workspaceId = randomUUID();
    expect(
      CreatePresentationSchema.parse({
        title: "Deck",
        creationRequestId: creationRequestId.toUpperCase(),
        creationContext: { actorId: actorId.toUpperCase(), workspaceId: workspaceId.toUpperCase() },
      }),
    ).toMatchObject({ creationRequestId, creationContext: { actorId, workspaceId } });
  });
  it("requires request identity and exact account/workspace context together", () => {
    const creationContext = { actorId: randomUUID(), workspaceId: randomUUID() };
    for (const value of [
      { title: "Deck", creationRequestId: randomUUID() },
      { title: "Deck", creationContext },
      { title: "Deck", creationRequestId: "invalid", creationContext },
      {
        title: "Deck",
        creationRequestId: randomUUID(),
        creationContext: { ...creationContext, workspaceId: "invalid" },
      },
      {
        title: "Deck",
        creationRequestId: randomUUID(),
        creationContext: { ...creationContext, extra: "unbound" },
      },
    ])
      expect(CreatePresentationSchema.safeParse(value).success).toBe(false);
  });
  it("requires bounded stable native creation on the dedicated outline route", () => {
    const request = {
      title: "Deck",
      initialSlide: "native",
      creationRequestId: randomUUID(),
      creationContext: { actorId: randomUUID(), workspaceId: randomUUID() },
    };
    expect(CreateOutlinePresentationSchema.safeParse(request).success).toBe(true);
    for (const value of [
      { title: "Deck" },
      { ...request, initialSlide: "classic" },
      { ...request, outline: "not stored at creation" },
    ])
      expect(CreateOutlinePresentationSchema.safeParse(value).success).toBe(false);
  });
});
