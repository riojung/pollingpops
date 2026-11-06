import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationReviewFeedback,
  PresentationReviewFeedbackMutation,
  PresentationReviewFeedbackMutationResponse,
} from "@openround/contracts";
import { API_URL, ApiClientError } from "./api";
import {
  enablePresentationReview,
  fetchPresentationAuthorFeedback,
  fetchPresentationReviewerAccess,
  fetchPresentationReviewerFeedback,
  mutatePresentationAuthorFeedback,
  mutatePresentationReviewerFeedback,
} from "./presentation-review-feedback-client";

const presentationId = "a2f6c043-71ca-4e58-8b9b-607f86098a91";
const shareId = "b2f6c043-71ca-4e58-8b9b-607f86098a92";
const versionId = "c2f6c043-71ca-4e58-8b9b-607f86098a93";
const operationId = "d2f6c043-71ca-4e58-8b9b-607f86098a94";
const threadId = "e2f6c043-71ca-4e58-8b9b-607f86098a95";
const messageId = "f2f6c043-71ca-4e58-8b9b-607f86098a96";
const blockId = "a3f6c043-71ca-4e58-8b9b-607f86098a97";
const token = "x".repeat(43),
  viewerKey = "a".repeat(64);
function feedback(): PresentationReviewFeedback {
  return {
    schemaVersion: 1,
    shareId,
    versionId,
    version: 2,
    reviewSeq: 1,
    status: "open",
    viewerKey,
    expiresAt: "2026-12-01T12:00:00Z",
    serverTime: "2026-11-05T12:00:00Z",
    capabilities: { enable: false, comment: true, resolve: true, approve: true },
    approval: { state: "not_approved", approvedAt: null, approvedReviewSeq: null },
    threads: [],
  };
}
const access = {
  schemaVersion: 1,
  shareId,
  versionId,
  enabled: true,
  signInRequired: true,
  expiresAt: "2026-12-01T12:00:00Z",
};
function mutation(): PresentationReviewFeedbackMutation {
  return {
    schemaVersion: 1,
    operationId,
    versionId,
    viewerKey,
    command: {
      type: "thread.create",
      threadId,
      messageId,
      blockId,
      text: "A private review comment",
    },
  };
}
function result(enable = false): PresentationReviewFeedbackMutationResponse {
  return {
    feedback: feedback(),
    receipt: {
      operationId,
      reviewSeq: 1,
      type: enable ? "review.enable" : "thread.create",
      threadId: enable ? null : threadId,
      messageId: enable ? null : messageId,
    },
    replayed: false,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("private review feedback client", () => {
  it("reads author feedback with creator cookies and canonical validated route IDs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(feedback()));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(
      await fetchPresentationAuthorFeedback(
        presentationId.toUpperCase(),
        shareId.toUpperCase(),
        signal,
      ),
    ).toEqual(feedback());
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${API_URL}/v1/presentations/${presentationId}/shares/${shareId}/feedback`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json" },
        signal,
      },
    );
  });

  it("discovers policy anonymously while signed-in feedback also binds the bearer in headers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(access))
      .mockResolvedValueOnce(Response.json(feedback()));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchPresentationReviewerAccess(shareId, token)).toEqual(access);
    expect(await fetchPresentationReviewerFeedback(shareId, token)).toEqual(feedback());
    expect(fetch.mock.calls[0]![0]).toBe(
      `${API_URL}/v1/shared-presentations/${shareId}/feedback/access`,
    );
    expect(fetch.mock.calls[1]![0]).toBe(`${API_URL}/v1/shared-presentations/${shareId}/feedback`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: "omit" });
    expect(fetch.mock.calls[1]![1]).toMatchObject({ credentials: "include" });
    for (const [url, options] of fetch.mock.calls) {
      expect(url).not.toContain(token);
      expect(options).toMatchObject({
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
      });
    }
  });

  it("enables review with the exact pinned version and operation intent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result(true)));
    vi.stubGlobal("fetch", fetch);
    const input = { operationId, versionId };
    expect(await enablePresentationReview(presentationId, shareId, input)).toEqual(result(true));
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `${API_URL}/v1/presentations/${presentationId}/shares/${shareId}/feedback`,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json", accept: "application/json" },
    });
    expect(input).toEqual({ operationId, versionId });
  });

  it.each(["author", "reviewer"] as const)(
    "posts %s commands once without generating or changing retry identifiers",
    async (role) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result()));
      vi.stubGlobal("fetch", fetch);
      const signal = new AbortController().signal;
      const input = mutation();
      const execute = () =>
        role === "author"
          ? mutatePresentationAuthorFeedback(presentationId, shareId, input, signal)
          : mutatePresentationReviewerFeedback(shareId, token, input, signal);
      expect(await execute()).toEqual(result());
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(await execute()).toEqual(result());
      expect(fetch).toHaveBeenCalledTimes(2);
      const [url, options] = fetch.mock.calls[0]!;
      expect(url).toBe(
        `${API_URL}${role === "author" ? `/v1/presentations/${presentationId}/shares/${shareId}` : `/v1/shared-presentations/${shareId}`}/feedback/commands`,
      );
      expect(options).toMatchObject({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
      });
      expect(JSON.parse(options!.body as string)).toEqual(input);
      expect(fetch.mock.calls[1]![1]?.body).toBe(options?.body);
      expect(url).not.toContain(token);
      expect(JSON.stringify(options?.body)).not.toContain(token);
      expect(options?.headers).toEqual({
        "content-type": "application/json",
        accept: "application/json",
        ...(role === "reviewer" ? { authorization: `Bearer ${token}` } : {}),
      });
    },
  );

  it("accepts canonical receipt UUIDs for an uppercase original mutation without rewriting the original intent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result()));
    vi.stubGlobal("fetch", fetch);
    const input = mutation();
    input.operationId = operationId.toUpperCase();
    if (input.command.type !== "thread.create") throw new Error("Expected fixture command");
    input.command.threadId = threadId.toUpperCase();
    input.command.messageId = messageId.toUpperCase();
    await mutatePresentationReviewerFeedback(shareId, token, input);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).operationId).toBe(input.operationId);
  });

  it.each([
    () => fetchPresentationAuthorFeedback("draft-index-0", shareId),
    () => fetchPresentationAuthorFeedback(presentationId, "../other"),
    () =>
      enablePresentationReview(presentationId, shareId, {
        operationId: "not-an-operation",
        versionId,
      }),
    () => fetchPresentationReviewerAccess(shareId, "short"),
    () => fetchPresentationReviewerFeedback("../other", token),
    () => mutatePresentationReviewerFeedback(shareId, `${token}#extra`, mutation()),
    () =>
      mutatePresentationAuthorFeedback(presentationId, shareId, {
        ...mutation(),
        viewerKey: "missing-identity-binding",
      }),
    () =>
      mutatePresentationReviewerFeedback(shareId, token, {
        ...mutation(),
        authorLabel: "Author",
      } as PresentationReviewFeedbackMutation),
  ])("rejects invalid route, bearer or strict input before networking: %s", async (execute) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(execute()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...feedback(), email: "PRIVATE_EMAIL@example.test" },
    { ...feedback(), shareId: presentationId },
    { ...feedback(), schemaVersion: 2 },
  ])("rejects private, unsupported or mismatched feedback projections", async (value) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(value)),
    );
    await expect(fetchPresentationReviewerFeedback(shareId, token)).rejects.toThrow(
      "could not be verified",
    );
  });

  it("rejects mismatched policy and operation responses rather than settling another link, version or identity", async () => {
    for (const value of [
      { ...result(), feedback: { ...feedback(), versionId: presentationId } },
      { ...result(), feedback: { ...feedback(), viewerKey: "b".repeat(64) } },
      { ...result(), receipt: { ...result().receipt, operationId: presentationId } },
      { ...result(), receipt: { ...result().receipt, threadId: presentationId } },
      { ...result(), receipt: { ...result().receipt, type: "message.edit" } },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(value)),
      );
      await expect(mutatePresentationReviewerFeedback(shareId, token, mutation())).rejects.toThrow(
        "could not be verified",
      );
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...access, shareId: presentationId })),
    );
    await expect(fetchPresentationReviewerAccess(shareId, token)).rejects.toThrow(
      "could not be verified",
    );
  });

  it.each([401, 404, 409, 429, 503])(
    "preserves authoritative HTTP status %s and retry guidance without retrying writes",
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json(
          { error: { code: "REVIEW_TEST_ERROR", message: "Safe review error" } },
          { status, headers: { "retry-after": "3" } },
        ),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(mutatePresentationReviewerFeedback(shareId, token, mutation())).rejects.toEqual(
        new ApiClientError("Safe review error", "REVIEW_TEST_ERROR", status, 3),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not send an already-cancelled read and ignores a response after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(feedback()));
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationReviewerFeedback(shareId, token, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    const active = new AbortController();
    let release!: (value: Response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = fetchPresentationReviewerFeedback(shareId, token, active.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    active.abort();
    release(Response.json(feedback()));
    await assertion;
    expect(fetch.mock.calls[0]![1]).toMatchObject({ signal: active.signal });
  });
});
