import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IdeaBoardCreateSchema,
  IdeaBoardBodySchema,
  IdeaBoardHostCommandSchema,
  IdeaBoardVoteSchema,
  IdeaBoardViewSchema,
  IdeaBoardStoredSchema,
  IdeaBoardSubmitSchema,
  IdeaBoardGuestViewSchema,
  IdeaBoardRoundStoredSchema,
  ideaBoardProjection,
  IdeaBoardLinkSchema,
  IdeaBoardSketchSchema,
  ideaBoardRichContent,
} from "../src/idea-boards.js";

describe("standalone idea board contracts", () => {
  it("defaults to anonymous moderated hidden collection and rejects future versions and invalid bounds", () => {
    expect(IdeaBoardCreateSchema.parse({ title: "  Next steps  " })).toEqual({
      schemaVersion: 1,
      title: "Next steps",
      description: "",
      identityMode: "anonymous",
      moderationEnabled: true,
      ideasVisible: false,
      voteBudget: 3,
      windowDays: 7,
    });
    for (const input of [
      { schemaVersion: 2 },
      { title: "a".repeat(161) },
      { description: "a".repeat(2001) },
      { voteBudget: 0 },
      { voteBudget: 11 },
      { windowDays: 31 },
      { identityMode: "email" },
      { participantLimit: 1000 },
    ])
      expect(IdeaBoardCreateSchema.safeParse({ title: "Plan", ...input }).success).toBe(false);
    expect(IdeaBoardBodySchema.parse("  Cafe\u0301 <b>literal</b>  ")).toBe("Café <b>literal</b>");
    for (const body of [" ", "a".repeat(1001), "private\u0000body"])
      expect(IdeaBoardBodySchema.safeParse(body).success).toBe(false);
  });
  it("requires explicit distinct permitted shape for ballots and fenced command types", () => {
    const ideaId = randomUUID();
    const ballot = { ideaIds: [ideaId], expectedRevision: 0, idempotencyKey: randomUUID() };
    expect(IdeaBoardVoteSchema.parse(ballot).schemaVersion).toBe(1);
    expect(IdeaBoardVoteSchema.safeParse({ ...ballot, ideaIds: [ideaId, ideaId] }).success).toBe(
      false,
    );
    expect(IdeaBoardVoteSchema.safeParse({ ...ballot, expectedRevision: -1 }).success).toBe(false);
    expect(IdeaBoardHostCommandSchema.parse({ type: "reopen" })).toEqual({ type: "reopen" });
    for (const extra of [
      { windowDays: 0 },
      { windowDays: 31 },
      { roundNumber: 0 },
      { roundNumber: 21 },
      { resetIdeas: true },
    ])
      expect(IdeaBoardHostCommandSchema.safeParse({ type: "reopen", ...extra }).success).toBe(
        false,
      );
    expect(IdeaBoardHostCommandSchema.parse({ type: "close" })).toEqual({ type: "close" });
    expect(
      IdeaBoardHostCommandSchema.safeParse({ type: "moderate", ideaId, status: "pending" }).success,
    ).toBe(false);
    expect(
      IdeaBoardHostCommandSchema.safeParse({
        type: "group.create",
        id: randomUUID(),
        name: "a".repeat(81),
      }).success,
    ).toBe(false);
  });
  it("keeps public schemas strict and rejects unknown stored schema versions", () => {
    expect(IdeaBoardViewSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
    expect(IdeaBoardStoredSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });
  it("upcasts legacy rounds and ballots and exposes only redacted aggregate history", () => {
    const ideaId = randomUUID(),
      guestId = randomUUID(),
      now = new Date().toISOString();
    const stored = IdeaBoardStoredSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      workspaceId: randomUUID(),
      title: "Legacy",
      description: "",
      identityMode: "anonymous",
      moderationEnabled: true,
      voteBudget: 3,
      ideasVisible: false,
      status: "closed",
      closesAt: now,
      expiresAt: now,
      revision: 2,
      participantLimit: 10,
      createdAt: now,
      creationKey: randomUUID(),
      creationHash: "a".repeat(64),
      groups: [],
      ideas: [
        {
          id: ideaId,
          body: null,
          alias: null,
          groupId: null,
          status: "removed",
          createdAt: now,
          guestId,
        },
      ],
      guests: [],
      receipts: [],
    });
    expect(stored.roundNumber).toBe(1);
    expect(stored.roundHistory).toEqual([]);
    const legacy = IdeaBoardGuestViewSchema.parse({
      board: ideaBoardProjection(stored, new Date()),
      ownIdeas: [],
      votedIdeaIds: [ideaId],
      revision: 1,
    });
    expect(legacy.hasVoted).toBe(true);
    const next = IdeaBoardGuestViewSchema.parse({
      ...legacy,
      hasVoted: undefined,
      board: { ...legacy.board, roundNumber: 2 },
      revision: 2,
    });
    expect(next.hasVoted).toBe(false);
    stored.roundNumber = 2;
    stored.roundHistory = [
      { roundNumber: 1, closedAt: now, ballotCount: 1, results: [{ ideaId, voteCount: 1 }] },
    ];
    expect(ideaBoardProjection(stored, new Date()).roundHistory[0]?.results).toEqual([
      { ideaId, voteCount: 1 },
    ]);
    expect(ideaBoardProjection(stored, new Date()).roundHistoryIdeas).toEqual([
      { ideaId, body: null },
    ]);
    stored.roundNumber = 20;
    stored.roundHistory = Array.from({ length: 19 }, (_, index) => ({
      roundNumber: index + 1,
      closedAt: now,
      ballotCount: 1,
      results: [{ ideaId, voteCount: 1 }],
    }));
    expect(ideaBoardProjection(stored, new Date()).roundHistoryIdeas).toHaveLength(1);
    expect(
      IdeaBoardRoundStoredSchema.safeParse({ ...stored.roundHistory[0], tokenHash: "private" })
        .success,
    ).toBe(false);
    expect(
      IdeaBoardRoundStoredSchema.safeParse({
        ...stored.roundHistory[0],
        results: [{ ideaId, voteCount: 1, body: "Must not freeze removed content" }],
      }).success,
    ).toBe(false);
  });
  it("keeps legacy text payloads unchanged and permits bounded structured rich content", () => {
    const key = randomUUID();
    expect(IdeaBoardSubmitSchema.parse({ body: "An idea", idempotencyKey: key })).toEqual({
      schemaVersion: 1,
      body: "An idea",
      idempotencyKey: key,
    });
    expect(ideaBoardRichContent({ attachments: [], links: [], sketch: null })).toEqual({});
    const sketch = {
      schemaVersion: 1,
      width: 1000,
      height: 600,
      elements: [
        {
          id: randomUUID(),
          type: "text",
          x: 10,
          y: 20,
          text: "  Cafe\u0301 <script>literal</script>  ",
          color: "blue",
          strokeWidth: 2,
          fontSize: 24,
        },
      ],
    };
    const rich = IdeaBoardSubmitSchema.parse({
      body: "An idea",
      idempotencyKey: key,
      attachments: [{ mediaId: randomUUID(), alt: "  Diagram  " }],
      links: [{ url: "https://EXAMPLE.com/a", label: " Reference " }],
      sketch,
    });
    expect(rich.attachments?.[0]?.alt).toBe("Diagram");
    expect(rich.links?.[0]).toEqual({ url: "https://example.com/a", label: "Reference" });
    expect(rich.sketch?.elements[0]).toMatchObject({ text: "Café <script>literal</script>" });
    for (const extra of [
      { attachments: Array.from({ length: 4 }, () => ({ mediaId: randomUUID(), alt: "Image" })) },
      {
        attachments: [
          { mediaId: key, alt: "One" },
          { mediaId: key, alt: "Two" },
        ],
      },
      { attachments: [{ mediaId: key, alt: "" }] },
      { attachments: [{ mediaId: key, alt: "Image", data: "data:image/png;base64,..." }] },
      { links: Array.from({ length: 4 }, () => ({ url: "https://example.com" })) },
      { links: [{ url: "https://example.com", imageMediaId: randomUUID() }] },
      { sketch: { ...sketch, svg: "<svg/>" } },
    ])
      expect(
        IdeaBoardSubmitSchema.safeParse({ body: "Idea", idempotencyKey: key, ...extra }).success,
      ).toBe(false);
    expect(
      IdeaBoardSubmitSchema.safeParse({
        body: "Linked image",
        idempotencyKey: key,
        attachments: [{ mediaId: key, alt: "Image" }],
        links: [{ url: "https://example.com", imageMediaId: key }],
      }).success,
    ).toBe(true);
  });
  it("rejects unsafe link schemes, credentials, hidden controls and invalid links", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "file:///etc/passwd",
      "https://user:password@example.com",
      "https://example.com/\nsecret",
      "not-a-url",
      "https://example.com/" + "a".repeat(2048),
    ])
      expect(IdeaBoardLinkSchema.safeParse({ url }).success).toBe(false);
    expect(IdeaBoardLinkSchema.parse({ url: "http://example.com/post" }).url).toBe(
      "http://example.com/post",
    );
  });
  it("rejects out-of-bounds, oversized and unstructured drawing content", () => {
    const element = {
      id: randomUUID(),
      type: "rect",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      color: "ink",
      strokeWidth: 2,
    };
    const sketch = { schemaVersion: 1, width: 1000, height: 600, elements: [element] };
    expect(IdeaBoardSketchSchema.safeParse(sketch).success).toBe(true);
    for (const elements of [
      [{ ...element, x: -1 }],
      [{ ...element, x: 950 }],
      [{ ...element, width: 1.5 }],
      [{ ...element, color: "url(https://example.com)" }],
      [{ ...element, onClick: "alert(1)" }],
      [element, element],
      Array.from({ length: 33 }, () => ({ ...element, id: randomUUID() })),
      [{ ...element, type: "svg", svg: "<svg/>" }],
      [{ ...element, type: "freehand", points: Array.from({ length: 129 }, () => [10, 20]) }],
      Array.from({ length: 9 }, () => ({
        id: randomUUID(),
        type: "freehand",
        color: "ink",
        strokeWidth: 2,
        points: Array.from({ length: 128 }, () => [1000, 600]),
      })),
      Array.from({ length: 32 }, () => ({
        id: randomUUID(),
        type: "text",
        color: "ink",
        strokeWidth: 2,
        x: 0,
        y: 0,
        text: "🌲".repeat(150),
        fontSize: 24,
      })),
    ])
      expect(IdeaBoardSketchSchema.safeParse({ ...sketch, elements }).success).toBe(false);
  });
});
