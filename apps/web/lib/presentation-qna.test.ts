import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPresentationQnaClient } from "./presentation-qna";

const fixtures = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: fixtures.fetch }));
const page = {
  schemaVersion: 1,
  audienceSeq: 1,
  lifecycle: "open",
  questions: [],
  nextCursor: null,
  settings: {
    enabled: true,
    displayMode: "anonymous_public",
    moderationMode: "pre",
    participantReplies: false,
  },
};
beforeEach(() => fixtures.fetch.mockReset());

describe("Presentation Q&A native-pass client", () => {
  it("omits creator cookies and credentials from URLs and encodes pagination", async () => {
    const client = createPresentationQnaClient(randomUUID(), "native-room-pass");
    fixtures.fetch.mockResolvedValueOnce({
      schemaVersion: 1,
      available: true,
      activated: false,
      canActivate: false,
    });
    await client.availability();
    fixtures.fetch.mockResolvedValueOnce(page);
    await client.page("opaque+=cursor");
    for (const [url, init] of fixtures.fetch.mock.calls) {
      expect(init.credentials).toBe("omit");
      expect(init.headers.authorization).toBe("Bearer native-room-pass");
      expect(url).not.toContain("native-room-pass");
    }
    expect(fixtures.fetch.mock.calls[1]![0]).toContain("cursor=opaque%2B%3Dcursor");
  });

  it("reuses the exact command after uncertain delivery", async () => {
    const client = createPresentationQnaClient(randomUUID(), "native-room-pass");
    const command = {
      type: "question.create" as const,
      body: "How does this work?",
      idempotencyKey: randomUUID(),
    };
    fixtures.fetch.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(client.command(command)).rejects.toThrow("Network request failed");
    fixtures.fetch.mockResolvedValueOnce({
      receipt: {
        schemaVersion: 1,
        idempotencyKey: command.idempotencyKey,
        resourceId: randomUUID(),
        audienceSeq: 2,
      },
      duplicate: true,
    });
    expect((await client.command(command)).duplicate).toBe(true);
    expect(fixtures.fetch.mock.calls[0]).toEqual(fixtures.fetch.mock.calls[1]);
  });

  it("rejects unsupported readers and invalid commands", async () => {
    const client = createPresentationQnaClient(randomUUID(), "native-room-pass");
    fixtures.fetch.mockResolvedValueOnce({ schemaVersion: 2 });
    await expect(client.availability()).rejects.toThrow();
    fixtures.fetch.mockResolvedValueOnce({ ...page, schemaVersion: 2 });
    await expect(client.page()).rejects.toThrow();
    fixtures.fetch.mockClear();
    await expect(
      client.command({ type: "question.create", body: "", idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
    expect(fixtures.fetch).not.toHaveBeenCalled();
    fixtures.fetch.mockResolvedValueOnce({ receipt: { schemaVersion: 2 }, duplicate: false });
    await expect(
      client.command({ type: "question.create", body: "Valid", idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
  });
});
