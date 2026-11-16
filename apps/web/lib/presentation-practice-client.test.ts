import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capturePracticeCredentials,
  clearPracticeAssignmentIntent,
  createPracticeAssignment,
  fetchPracticeAccess,
  fetchPracticeAttempt,
  fetchPracticeImage,
  fetchPracticeInsights,
  fetchPracticePreview,
  loadPracticeAssignmentIntent,
  parsePracticeLink,
  practiceAssignmentIntent,
  practiceResumeUrl,
  recordPracticeProgress,
  savePracticeAssignmentIntent,
  startPracticeAttempt,
  verifyPracticeAnswers,
} from "./presentation-practice-client";
import {
  practiceAnswer,
  practiceAttempt,
  practiceIds as ids,
  practicePreview,
  practiceReader,
  practiceToken,
} from "../test-utils/presentation-practice";
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("private self-paced practice transport", () => {
  it("captures canonical personal fragments once and strips malformed credentials without storage", () => {
    const url = practiceResumeUrl("https://example.test", ids.assignment, {
      token: practiceToken,
      reader: practiceReader,
    });
    const history = { state: null, replaceState: vi.fn() };
    expect(
      capturePracticeCredentials({
        assignmentId: ids.assignment,
        location: { href: url.replace(ids.attempt, ids.attempt.toUpperCase()) },
        history,
      }),
    ).toEqual({ provided: true, credentials: { token: practiceToken, reader: practiceReader } });
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      `/presentation-practice/${ids.assignment}`,
    );
    for (const suffix of [
      `?token=${practiceToken}`,
      `#token=${practiceToken}&token=${practiceToken}`,
      `#token=${practiceToken}&attempt=${ids.attempt}`,
      `#token=${practiceToken}&resume=${practiceReader.token}`,
      `#token=${practiceToken}&other=secret`,
    ]) {
      expect(
        capturePracticeCredentials({
          assignmentId: ids.assignment,
          location: {
            href: `https://example.test/presentation-practice/${ids.assignment}${suffix}`,
          },
          history,
        }).credentials,
      ).toBeNull();
    }
    expect(parsePracticeLink(url, ids.version)).toBeNull();
    expect(parsePracticeLink(url, ids.assignment, "https://another.test")).toBeNull();
    expect(
      parsePracticeLink(
        url.replace("/presentation-practice/", "/presentation-assignment/"),
        ids.assignment,
      ),
    ).toBeNull();
  });
  it("keeps creator recovery actor-bound and preserves a newer request when clearing an old one", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    });
    const old = practiceAssignmentIntent(ids.version.toUpperCase(), 1),
      newer = practiceAssignmentIntent(ids.version, 7);
    expect(old.versionId).toBe(ids.version);
    savePracticeAssignmentIntent(ids.presentation, "actor-a:workspace", old);
    expect(loadPracticeAssignmentIntent(ids.presentation, "actor-b:workspace")).toBeNull();
    savePracticeAssignmentIntent(ids.presentation, "actor-a:workspace", newer);
    clearPracticeAssignmentIntent(ids.presentation, "actor-a:workspace", old);
    expect(loadPracticeAssignmentIntent(ids.presentation, "actor-a:workspace")).toEqual(newer);
    clearPracticeAssignmentIntent(ids.presentation, "actor-a:workspace", newer);
    expect(map.size).toBe(0);
  });
  it("uses assignment credentials for preview/access/media, and private attempt credentials for accepted answers", async () => {
    const preview = practicePreview(),
      empty = practiceAttempt(),
      accepted = practiceAttempt(1, [ids.first], ids.attempt, [practiceAnswer()]);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(
        response({ versionId: ids.version, expiresAt: preview.assignment.expiresAt }),
      )
      .mockResolvedValueOnce(response({ attempt: empty, replayed: false }))
      .mockResolvedValueOnce(response({ ...preview, attempt: accepted }))
      .mockResolvedValueOnce(response({ attempt: accepted, replayed: true }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
      );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await fetchPracticePreview(ids.assignment.toUpperCase(), practiceToken, signal);
    await fetchPracticeAccess(ids.assignment, practiceToken, signal);
    await startPracticeAttempt(
      ids.assignment,
      practiceToken,
      { ...practiceReader, attemptId: ids.attempt.toUpperCase() },
      signal,
    );
    await fetchPracticeAttempt(ids.assignment, practiceReader, signal);
    await recordPracticeProgress(
      ids.assignment,
      practiceReader,
      {
        requestId: ids.presentation.toUpperCase(),
        kind: "answer",
        expectedRevision: 0,
        blockId: ids.first.toUpperCase(),
        choiceId: ids.choice.toUpperCase(),
      },
      signal,
    );
    await fetchPracticeImage(ids.assignment, practiceToken, ids.first, signal);
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      `/v1/presentation-practice/${ids.assignment}`,
      `/v1/presentation-practice/${ids.assignment}/access`,
      `/v1/presentation-practice/${ids.assignment}/attempts`,
      `/v1/presentation-practice/${ids.assignment}/attempts/${ids.attempt}`,
      `/v1/presentation-practice/${ids.assignment}/attempts/${ids.attempt}/progress`,
      `/v1/presentation-practice/${ids.assignment}/media/${ids.first}`,
    ]);
    for (const [i, [, init]] of fetch.mock.calls.entries())
      expect(init).toMatchObject({
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: {
          authorization: `Bearer ${i === 3 || i === 4 ? practiceReader.token : practiceToken}`,
        },
        signal,
      });
    expect(JSON.parse(fetch.mock.calls[4]![1].body)).toEqual({
      requestId: ids.presentation,
      expectedRevision: 0,
      kind: "answer",
      blockId: ids.first,
      choiceId: ids.choice,
    });
  });
  it("rejects leaked preview fields and cross-source or unsupported personal feedback", async () => {
    const preview = practicePreview();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ ...preview, answers: [practiceAnswer()] }))
        .mockResolvedValueOnce(
          response({ ...preview, assignment: { ...preview.assignment, id: ids.version } }),
        ),
    );
    await expect(fetchPracticePreview(ids.assignment, practiceToken)).rejects.toThrow();
    await expect(fetchPracticePreview(ids.assignment, practiceToken)).rejects.toThrow(
      "could not be verified",
    );
    const accepted = practiceAttempt(1, [ids.first], ids.attempt, [practiceAnswer()]);
    expect(() =>
      verifyPracticeAnswers(
        {
          ...accepted,
          answers: [
            {
              ...practiceAnswer(),
              feedback: { ...practiceAnswer().feedback, correctChoiceId: ids.presentation },
            },
          ],
        },
        preview.review,
      ),
    ).toThrow("feedback could not be verified");
    expect(() =>
      verifyPracticeAnswers({ ...accepted, readBlockIds: [ids.presentation] }, preview.review),
    ).toThrow("pages could not be verified");
    expect(() =>
      verifyPracticeAnswers({ ...accepted, completedAt: new Date().toISOString() }, preview.review),
    ).toThrow("completion could not be verified");
    expect(() => verifyPracticeAnswers({ ...accepted, answers: [] }, preview.review)).toThrow(
      "completion could not be verified",
    );
  });
  it("verifies acknowledged creation credentials and binds insights to assignment and publication", async () => {
    const request = practiceAssignmentIntent(ids.version, 7),
      preview = practicePreview();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            assignment: { ...preview.assignment, expiresAt: request.expiresAt },
            url: practiceResumeUrl("https://example.test", ids.assignment, {
              token: practiceToken,
              reader: null,
            }),
            replayed: false,
          }),
        )
        .mockResolvedValueOnce(
          response({
            schemaVersion: 1,
            assignment: { ...preview.assignment, versionId: ids.presentation },
            generatedAt: new Date().toISOString(),
            minimumAttempts: 5,
            startedAttempts: null,
            completedAttempts: null,
            inProgressAttempts: null,
          }),
        ),
    );
    await expect(createPracticeAssignment(ids.presentation, request)).rejects.toThrow(
      "link could not be verified",
    );
    await expect(
      fetchPracticeInsights(
        ids.presentation,
        ids.assignment,
        ids.version,
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not be verified");
  });
});
