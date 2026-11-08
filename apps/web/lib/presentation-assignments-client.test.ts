import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureReadingCredentials,
  clearReadingAssignmentIntent,
  createReadingAssignment,
  fetchReadingAccess,
  fetchReadingAttempt,
  fetchReadingImage,
  fetchReadingPreview,
  loadReadingAssignmentIntent,
  parseReadingLink,
  readingAssignmentIntent,
  readingResumeUrl,
  recordReadingProgress,
  saveReadingAssignmentIntent,
  startReadingAttempt,
} from "./presentation-assignments-client";

const id = "aaaaaaaa-0000-4000-8000-000000000001",
  versionId = "aaaaaaaa-0000-4000-8000-000000000002",
  attemptId = "aaaaaaaa-0000-4000-8000-000000000003",
  blockId = "aaaaaaaa-0000-4000-8000-000000000004",
  token = "A".repeat(43),
  reader = { attemptId, token: "B".repeat(43) },
  now = new Date().toISOString(),
  expiresAt = new Date(Date.now() + 86_400_000).toISOString();
const assignment = { id, mode: "reading", versionId, createdAt: now, expiresAt, revokedAt: null };
const review = {
  schemaVersion: 1,
  versionId,
  version: 1,
  title: "Reading",
  expiresAt,
  sections: [],
  blocks: [
    {
      id: blockId,
      kind: "question",
      question: { type: "poll", prompt: "Read it", mediaId: null, mediaAlt: null },
    },
  ],
};
const attempt = {
  id: attemptId,
  assignmentId: id,
  revision: 0,
  readBlockIds: [],
  currentBlockId: null,
  startedAt: now,
  updatedAt: now,
  completedAt: null,
};
function response(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("private reading assignment client", () => {
  it("captures a complete personal fragment once, strips it, and normalizes reader ids without storage", () => {
    const url = readingResumeUrl("https://example.test", id, { token, reader });
    const privateUrl = url
      .replace(attemptId, attemptId.toUpperCase())
      .replace(id, id.toUpperCase());
    const history = { state: null, replaceState: vi.fn() };
    expect(
      captureReadingCredentials({ assignmentId: id, location: { href: privateUrl }, history }),
    ).toEqual({ provided: true, credentials: { token, reader } });
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      `/presentation-assignment/${id.toUpperCase()}`,
    );
    expect(
      captureReadingCredentials({
        assignmentId: id,
        location: { href: `https://example.test/presentation-assignment/${id}` },
        history,
      }),
    ).toEqual({ provided: false, credentials: null });
  });
  it.each([
    `#token=${token}&token=${token}`,
    `#token=${token}&attempt=${attemptId}`,
    `#token=${token}&resume=${reader.token}`,
    `#token=${token}&attempt=${attemptId}&resume=${reader.token}&resume=${reader.token}`,
    `?token=${token}`,
    `#token=${token}&other=credential`,
  ])("rejects and strips malformed or query credentials: %s", (suffix) => {
    const history = { state: null, replaceState: vi.fn() };
    expect(
      captureReadingCredentials({
        assignmentId: id,
        location: { href: `https://example.test/presentation-assignment/${id}${suffix}` },
        history,
      }).credentials,
    ).toBeNull();
    expect(history.replaceState).toHaveBeenCalledWith(null, "", `/presentation-assignment/${id}`);
  });
  it("rejects pasted credentials from another origin or assignment", () => {
    const link = readingResumeUrl("https://elsewhere.test", id, { token, reader });
    expect(parseReadingLink(link, id, "https://example.test")).toBeNull();
    expect(parseReadingLink(link, versionId)).toBeNull();
  });
  it("scopes creator recovery to the actor and only clears the exact accepted intent", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    });
    const old = readingAssignmentIntent(versionId, 1),
      newer = readingAssignmentIntent(versionId, 7);
    saveReadingAssignmentIntent(id, "creator-a:workspace", old);
    expect(loadReadingAssignmentIntent(id, "creator-b:workspace")).toBeNull();
    saveReadingAssignmentIntent(id, "creator-a:workspace", newer);
    clearReadingAssignmentIntent(id, "creator-a:workspace", old);
    expect(loadReadingAssignmentIntent(id, "creator-a:workspace")).toEqual(newer);
    clearReadingAssignmentIntent(id, "creator-a:workspace", newer);
    expect(loadReadingAssignmentIntent(id, "creator-a:workspace")).toBeNull();
  });
  it("uses assignment credentials for public preview/access/media and reader credentials only for progress", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response({ assignment, review }))
      .mockResolvedValueOnce(response({ versionId, expiresAt }))
      .mockResolvedValueOnce(response({ attempt, replayed: false }))
      .mockResolvedValueOnce(response({ assignment, review, attempt }))
      .mockResolvedValueOnce(
        response({
          attempt: { ...attempt, revision: 1, readBlockIds: [blockId], currentBlockId: blockId },
          replayed: false,
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
      );
    vi.stubGlobal("fetch", mock);
    const signal = new AbortController().signal;
    await fetchReadingPreview(id, token, signal);
    await fetchReadingAccess(id, token, signal);
    await startReadingAttempt(id, token, reader, signal);
    await fetchReadingAttempt(id, reader, signal);
    const request = { requestId: versionId, expectedRevision: 0, kind: "read" as const, blockId };
    await recordReadingProgress(id, reader, request, signal);
    await fetchReadingImage(id, token, blockId, signal);
    expect(mock.mock.calls.map(([path]) => path)).toEqual([
      `/v1/presentation-assignments/${id}`,
      `/v1/presentation-assignments/${id}/access`,
      `/v1/presentation-assignments/${id}/attempts`,
      `/v1/presentation-assignments/${id}/attempts/${attemptId}`,
      `/v1/presentation-assignments/${id}/attempts/${attemptId}/progress`,
      `/v1/presentation-assignments/${id}/media/${blockId}`,
    ]);
    for (const [index, [, init]] of mock.mock.calls.entries())
      expect(init).toMatchObject({
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { authorization: `Bearer ${index === 3 || index === 4 ? reader.token : token}` },
        signal,
      });
    expect(JSON.parse(mock.mock.calls[4]![1].body)).toEqual(request);
  });
  it("rejects cross-assignment snapshots and mismatched link acknowledgements", async () => {
    const request = readingAssignmentIntent(versionId, 1);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ assignment: { ...assignment, id: versionId }, review }))
        .mockResolvedValueOnce(
          response({
            assignment: { ...assignment, expiresAt: request.expiresAt },
            url: readingResumeUrl("https://example.test", id, { token, reader }),
            replayed: false,
          }),
        ),
    );
    await expect(fetchReadingPreview(id, token)).rejects.toThrow("could not be verified");
    await expect(createReadingAssignment(id, request)).rejects.toThrow("could not be verified");
  });
});
