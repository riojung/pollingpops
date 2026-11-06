import { randomBytes, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRepository,
  createPresentationReviewFeedbackRepository,
  type UserPrincipal,
} from "@openround/db";
import {
  PresentationReviewFeedbackAccessSchema,
  PresentationReviewFeedbackMutationResponseSchema,
  PresentationReviewFeedbackSchema,
  type PresentationReviewFeedback,
  type PresentationReviewFeedbackCommand,
} from "@openround/contracts";
import { presentationSharingFixture } from "../../../packages/db/test/support/presentation-sharing-conformance.js";
import { AuthService } from "../src/auth.js";
import { ConfigSchema } from "../src/config.js";
import { hashToken } from "../src/security.js";
import { registerPresentationReviewFeedbackRoutes } from "../src/presentation-review-feedback-routes.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});

async function fixture() {
  const repository = new MemoryRepository();
  const source = await presentationSharingFixture(repository, "review-feedback");
  const feedback = createPresentationReviewFeedbackRepository(repository);
  const token = randomBytes(32).toString("base64url");
  const { share } = await source.shares.createShare({
    ...source.request(),
    tokenHash: hashToken(token),
  });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    LOG_LEVEL: "silent",
  });
  const auth = new AuthService(
    repository,
    {
      sendAccountVerification: async () => undefined,
      sendSignInPin: async () => undefined,
      sendWorkspaceInvitation: async () => undefined,
    },
    config,
  );
  async function session(user: UserPrincipal, activeWorkspaceId?: string) {
    const raw = randomBytes(32).toString("base64url");
    await repository.createCreatorSession({
      id: randomUUID(),
      userId: user.userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
    });
    return { cookie: `${config.COOKIE_NAME}=${raw}`, raw };
  }
  async function reviewer(label: string) {
    const tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `${label}@example.test`,
      segment: "education",
      tokenHash,
      policyVersion: "test",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const identity = (await repository.consumeMagicLinkIdentity(tokenHash, new Date()))!;
    repository.workspaceMembers.delete(`${identity.creator!.workspaceId}:${identity.user.userId}`);
    return { user: identity.user, ...(await session(identity.user)) };
  }
  const owner = await session(source.actor, source.actor.workspaceId);
  const first = await reviewer("reviewer-one"),
    second = await reviewer("reviewer-two");
  const policy: { enabled: boolean; during?: () => Promise<void> } = { enabled: true };
  const admission = vi.fn(async (_key: string, _max: number, _window: number) => true);
  const logs: string[] = [];
  const app = Fastify({
    logger: {
      level: "error",
      stream: new Writable({
        write(chunk, _encoding, callback) {
          logs.push(chunk.toString());
          callback();
        },
      }),
    },
  });
  apps.push(app);
  await app.register(cookie);
  await registerPresentationReviewFeedbackRoutes(app, {
    auth,
    repository,
    feedback,
    config,
    consumeAdmission: admission,
    featureEnabled: async () => {
      const during = policy.during;
      policy.during = undefined;
      await during?.();
      return policy.enabled;
    },
  });
  const authorPath = `/v1/presentations/${source.presentation.id}/shares/${share.id}/feedback`;
  const recipientPath = `/v1/shared-presentations/${share.id}/feedback`;
  const author = (
    method: "GET" | "POST" = "GET",
    payload?: object,
    commands = false,
    credential = owner.cookie,
  ) =>
    app.inject({
      method,
      url: `${authorPath}${commands ? "/commands" : ""}`,
      headers: { cookie: credential, origin: config.WEB_ORIGIN },
      ...(payload ? { payload } : {}),
    });
  const recipient = (
    method: "GET" | "POST" = "GET",
    payload?: object,
    commands = false,
    credential: string | undefined = first.cookie,
    bearer = token,
  ) =>
    app.inject({
      method,
      url: `${recipientPath}${commands ? "/commands" : ""}`,
      headers: {
        ...(credential ? { cookie: credential } : {}),
        authorization: `Bearer ${bearer}`,
        origin: config.WEB_ORIGIN,
      },
      ...(payload ? { payload } : {}),
    });
  const access = (bearer = token) =>
    app.inject({ url: `${recipientPath}/access`, headers: { authorization: `Bearer ${bearer}` } });
  const enable = (request = { operationId: randomUUID(), versionId: source.version.id }) =>
    author("POST", request);
  async function authorView() {
    const response = await author();
    expect(response.statusCode, response.body).toBe(200);
    return PresentationReviewFeedbackSchema.parse(response.json());
  }
  async function reviewerView(credential = first.cookie) {
    const response = await recipient("GET", undefined, false, credential);
    expect(response.statusCode, response.body).toBe(200);
    return PresentationReviewFeedbackSchema.parse(response.json());
  }
  function mutation(view: PresentationReviewFeedback, command: PresentationReviewFeedbackCommand) {
    return {
      schemaVersion: 1 as const,
      operationId: randomUUID(),
      versionId: view.versionId,
      viewerKey: view.viewerKey,
      command,
    };
  }
  async function createThread(text = "Please clarify this public slide.") {
    const view = await reviewerView();
    const input = mutation(view, {
      type: "thread.create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      blockId: source.content.blocks[0]!.id,
      text,
    });
    const response = await recipient("POST", input, true);
    expect(response.statusCode, response.body).toBe(200);
    return {
      input,
      result: PresentationReviewFeedbackMutationResponseSchema.parse(response.json()),
    };
  }
  return {
    ...source,
    repository,
    feedback,
    share,
    token,
    owner,
    first,
    second,
    policy,
    admission,
    app,
    logs,
    author,
    recipient,
    access,
    enable,
    authorView,
    reviewerView,
    mutation,
    createThread,
  };
}

describe("private Presentation review feedback APIs", () => {
  it("keeps capability discovery body-free and old view links unable to comment until explicitly enabled", async () => {
    const f = await fixture();
    const access = await f.access();
    expect(access.statusCode).toBe(200);
    expect(PresentationReviewFeedbackAccessSchema.parse(access.json())).toMatchObject({
      shareId: f.share.id,
      versionId: f.version.id,
      enabled: false,
    });
    expect(access.headers["cache-control"]).toContain("no-store");
    expect(access.headers["referrer-policy"]).toBe("no-referrer");
    expect(access.body).not.toMatch(/threads|messages|viewerKey|userId|email|workspaceId/);
    const creatorCookieOnly = await f.app.inject({
      url: `/v1/shared-presentations/${f.share.id}/feedback/access`,
      headers: { cookie: f.owner.cookie },
    });
    expect(creatorCookieOnly.statusCode).toBe(404);
    const anonymous = await f.app.inject({
      url: `/v1/shared-presentations/${f.share.id}/feedback`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(anonymous.statusCode).toBe(401);
    const reviewer = await f.reviewerView();
    expect(reviewer).toMatchObject({
      status: "not_enabled",
      threads: [],
      capabilities: { enable: false, comment: false, resolve: false, approve: false },
    });
    const author = await f.authorView();
    expect(author.status).toBe("not_enabled");
    expect(author.capabilities.enable).toBe(true);
    const attempt = f.mutation(reviewer, {
      type: "thread.create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      blockId: f.content.blocks[0]!.id,
      text: "No comment grant",
    });
    expect((await f.recipient("POST", attempt, true)).statusCode).toBe(404);
  });

  it("enables an immutable version idempotently and lets membership-free reviewers comment without exposing account identity", async () => {
    const f = await fixture();
    const request = { operationId: randomUUID(), versionId: f.version.id };
    const enabled = await f.enable(request);
    expect(enabled.statusCode, enabled.body).toBe(201);
    expect((await f.enable(request)).json().replayed).toBe(true);
    expect((await f.access()).json()).toMatchObject({ enabled: true, signInRequired: true });
    const beforeMembers = f.repository.workspaceMembers.size;
    const { result } = await f.createThread();
    expect(result.feedback.threads[0]?.messages[0]).toMatchObject({
      authorRole: "reviewer",
      authorLabel: "Reviewer 1",
      isOwn: true,
    });
    const second = await f.reviewerView(f.second.cookie);
    expect(second.threads[0]?.messages[0]?.isOwn).toBe(false);
    expect(second.viewerKey).not.toBe(result.feedback.viewerKey);
    for (const view of [result.feedback, second, await f.authorView()]) {
      const json = JSON.stringify(view);
      for (const privateValue of [
        f.actor.email,
        f.actor.userId,
        f.actor.workspaceId,
        f.first.user.email,
        f.first.user.userId,
        f.second.user.email,
        f.second.user.userId,
        "PRIVATE_SPEAKER_NOTES",
        "PRIVATE_EXPLANATION",
      ])
        expect(json).not.toContain(privateValue);
      expect(json).not.toMatch(/correctValue|speakerNotes|sourceCitations/);
    }
    expect(f.repository.workspaceMembers.size).toBe(beforeMembers);
    expect(f.repository.workspaceMembers.has(`${f.actor.workspaceId}:${f.first.user.userId}`)).toBe(
      false,
    );
    expect((await f.author("GET", undefined, false, f.first.cookie)).statusCode).toBe(401);
  });

  it("preserves exact operation retries and rejects changed payloads, changed cookies and stale thread versions", async () => {
    const f = await fixture();
    await f.enable();
    const { input, result } = await f.createThread();
    const replay = await f.recipient("POST", input, true);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().receipt).toEqual(result.receipt);
    expect((await f.reviewerView()).threads).toHaveLength(1);
    const changed = await f.recipient(
      "POST",
      { ...input, command: { ...input.command, text: "A different intent" } },
      true,
    );
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe("PRESENTATION_REVIEW_IDEMPOTENCY_CONFLICT");
    expect((await f.recipient("POST", input, true, f.second.cookie)).statusCode).toBe(404);
    const thread = result.feedback.threads[0]!;
    const reply = f.mutation(result.feedback, {
      type: "message.reply",
      threadId: thread.id,
      expectedThreadVersion: thread.version,
      messageId: randomUUID(),
      text: "An additional detail",
    });
    expect((await f.recipient("POST", reply, true)).statusCode).toBe(200);
    const stale = await f.recipient(
      "POST",
      {
        ...reply,
        operationId: randomUUID(),
        command: { ...reply.command, messageId: randomUUID() },
      },
      true,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("PRESENTATION_REVIEW_CONFLICT");
  });

  it("keeps resolution and approval author-only and makes approval stale when a discussion reopens", async () => {
    const f = await fixture();
    await f.enable();
    const { result } = await f.createThread();
    const thread = result.feedback.threads[0]!;
    const resolve: PresentationReviewFeedbackCommand = {
      type: "thread.resolve",
      threadId: thread.id,
      expectedThreadVersion: thread.version,
      resolved: true,
    };
    expect((await f.recipient("POST", f.mutation(result.feedback, resolve), true)).statusCode).toBe(
      404,
    );
    const owner = await f.authorView();
    const resolved = await f.author("POST", f.mutation(owner, resolve), true);
    expect(resolved.statusCode, resolved.body).toBe(200);
    const reviewed = PresentationReviewFeedbackMutationResponseSchema.parse(
      resolved.json(),
    ).feedback;
    const approve = await f.author(
      "POST",
      f.mutation(reviewed, {
        type: "approval.set",
        expectedReviewSeq: reviewed.reviewSeq,
        approved: true,
      }),
      true,
    );
    expect(approve.statusCode, approve.body).toBe(200);
    expect(approve.json().feedback.approval.state).toBe("approved");
    const approved = PresentationReviewFeedbackMutationResponseSchema.parse(
      approve.json(),
    ).feedback;
    const reopened = await f.author(
      "POST",
      f.mutation(approved, {
        type: "thread.resolve",
        threadId: thread.id,
        expectedThreadVersion: approved.threads[0]!.version,
        resolved: false,
      }),
      true,
    );
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().feedback.approval.state).toBe("stale");
    const reviewer = await f.reviewerView();
    const fakeApproval = await f.recipient(
      "POST",
      f.mutation(reviewer, {
        type: "approval.set",
        expectedReviewSeq: reviewer.reviewSeq,
        approved: true,
      }),
      true,
    );
    expect(fakeApproval.statusCode).toBe(404);
  });

  it("requires the exact frozen version and strict commands without accepting identity or label fields", async () => {
    const f = await fixture();
    expect(
      (await f.enable({ operationId: randomUUID(), versionId: randomUUID() })).statusCode,
    ).toBe(404);
    await f.enable();
    const view = await f.reviewerView();
    const input = f.mutation(view, {
      type: "thread.create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      blockId: f.content.blocks[0]!.id,
      text: "A safe comment",
    });
    const extra = await f.recipient(
      "POST",
      { ...input, actorId: f.actor.userId, authorLabel: "Author" },
      true,
    );
    expect(extra.statusCode).toBe(422);
    expect(
      (await f.recipient("POST", { ...input, versionId: randomUUID() }, true)).statusCode,
    ).toBe(404);
    const foreignBlock = await f.recipient(
      "POST",
      { ...input, command: { ...input.command, blockId: randomUUID() } },
      true,
    );
    expect(foreignBlock.statusCode).toBe(404);
    expect((await f.reviewerView()).threads).toHaveLength(0);
    expect((await f.access(randomBytes(32).toString("base64url"))).statusCode).toBe(404);
  });

  it("denies revoked access and old operation receipts instead of returning retained comment bodies", async () => {
    const f = await fixture();
    await f.enable();
    const { input } = await f.createThread("Retained private review text");
    await f.shares.revokeShare(
      f.actor.workspaceId,
      f.presentation.id,
      f.share.id,
      f.actor.userId,
      new Date(),
    );
    for (const response of [
      await f.access(),
      await f.recipient(),
      await f.recipient("POST", input, true),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("Retained private review text");
    }
  });

  it("checks source policy before writes and does not return a read captured before revocation during policy lookup", async () => {
    const f = await fixture();
    await f.enable();
    const { result } = await f.createThread("Do not return after revocation");
    const mutate = vi.spyOn(f.feedback, "mutateReviewerReview");
    f.policy.enabled = false;
    const input = f.mutation(result.feedback, {
      type: "message.reply",
      threadId: result.feedback.threads[0]!.id,
      expectedThreadVersion: 1,
      messageId: randomUUID(),
      text: "Policy blocked",
    });
    expect((await f.recipient("POST", input, true)).statusCode).toBe(404);
    expect(mutate).not.toHaveBeenCalled();
    f.policy.enabled = true;
    f.policy.during = async () => {
      await f.shares.revokeShare(
        f.actor.workspaceId,
        f.presentation.id,
        f.share.id,
        f.actor.userId,
        new Date(),
      );
    };
    const response = await f.recipient();
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Do not return after revocation");
  });

  it("revalidates the cookie after asynchronous policy lookup before a final reviewer or author mutation", async () => {
    const f = await fixture();
    await f.enable();
    const view = await f.reviewerView();
    const reviewerMutation = vi.spyOn(f.feedback, "mutateReviewerReview");
    f.policy.during = () => f.repository.revokeCreatorSession(hashToken(f.first.raw));
    const input = f.mutation(view, {
      type: "thread.create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      blockId: f.content.blocks[0]!.id,
      text: "A revoked cookie cannot write",
    });
    expect((await f.recipient("POST", input, true)).statusCode).toBe(404);
    expect(reviewerMutation).not.toHaveBeenCalled();
    const owner = await f.authorView();
    const authorMutation = vi.spyOn(f.feedback, "mutateAuthorReview");
    f.policy.during = () => f.repository.revokeCreatorSession(hashToken(f.owner.raw));
    const authorInput = f.mutation(owner, {
      type: "thread.create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      blockId: f.content.blocks[0]!.id,
      text: "A revoked author cannot write",
    });
    expect((await f.author("POST", authorInput, true)).statusCode).toBe(404);
    expect(authorMutation).not.toHaveBeenCalled();
  });

  it("uses a fresh expiry time after asynchronous policy lookup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await fixture();
    await f.enable();
    await f.createThread("Expired reviews must not return retained comments");
    f.policy.during = async () => {
      vi.setSystemTime(f.share.expiresAt.getTime() + 1);
    };
    const response = await f.recipient();
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Expired reviews must not return retained comments");
  });

  it("uses separate IP and share/user admission budgets with retryable no-store failures", async () => {
    const f = await fixture();
    f.admission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await f.access();
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(f.admission.mock.calls[0]?.[0]).toContain(":ip:");
    expect(f.admission.mock.calls[1]?.[0]).toContain(`:share:${f.share.id}:ip:`);
    f.admission.mockClear();
    await f.enable();
    f.admission.mockClear();
    await f.recipient();
    expect(f.admission.mock.calls[1]?.[0]).toContain(
      `:share:${f.share.id}:user:${f.first.user.userId}`,
    );
  });

  it.each(["23514", "PRIVATE_DATABASE_CODE"])(
    "sanitizes unknown database failures without logging private comment details (code=%s)",
    async (code) => {
      const f = await fixture();
      await f.enable();
      const view = await f.reviewerView();
      const secret = "PRIVATE_COMMENT_ERROR_SENTINEL";
      const failure = Object.assign(new Error(`${secret} in a private database error message`), {
        code,
        detail: `Failing row contains (${secret})`,
        body: secret,
        cause: new Error(`${secret} in a nested cause`),
      });
      vi.spyOn(f.feedback, "mutateReviewerReview").mockRejectedValueOnce(failure);
      const input = f.mutation(view, {
        type: "thread.create",
        threadId: randomUUID(),
        messageId: randomUUID(),
        blockId: f.content.blocks[0]!.id,
        text: "Retry this original operation",
      });
      const response = await f.recipient("POST", input, true);
      expect(response.statusCode).toBe(503);
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.json().error.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(response.body).not.toContain(secret);
      expect(f.logs).toHaveLength(1);
      const logged = JSON.parse(f.logs[0]!);
      expect(logged).toMatchObject({
        requestId: expect.any(String),
        msg: "Presentation review operation deferred",
      });
      if (code === "23514") expect(logged.databaseCode).toBe(code);
      else expect(logged).not.toHaveProperty("databaseCode");
      expect(f.logs.join("\n")).not.toContain(secret);
      expect(f.logs.join("\n")).not.toContain("PRIVATE_DATABASE_CODE");
      for (const field of ["err", "error", "message", "detail", "cause", "stack", "body"])
        expect(logged).not.toHaveProperty(field);
      expect((await f.reviewerView()).threads).toHaveLength(0);
    },
  );

  it.each([
    { payload: '{"private":"PRIVATE_PARSE_SENTINEL",', status: 400 },
    {
      payload: JSON.stringify({ text: `PRIVATE_PARSE_SENTINEL${"x".repeat(16 * 1024)}` }),
      status: 413,
    },
  ])(
    "preserves safe parser status $status without exposing or logging request text",
    async ({ payload, status }) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/shared-presentations/${f.share.id}/feedback/commands`,
        headers: {
          cookie: f.first.cookie,
          authorization: `Bearer ${f.token}`,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe("PRESENTATION_REVIEW_INVALID");
      expect(response.headers["retry-after"]).toBeUndefined();
      expect(response.body).not.toContain("PRIVATE_PARSE_SENTINEL");
      expect(f.logs).toHaveLength(0);
    },
  );
});
