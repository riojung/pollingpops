import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdeaBoardViewSchema } from "@openround/contracts";
import {
  CanvasBoardError,
  IdeaBoardError,
  MemoryRepository,
  createBoardInvitationRepository,
} from "@openround/db";
import {
  registerBoardInvitationRoutes,
  type BoardInvitationRouteDependencies,
} from "../src/board-invitation-routes.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import type { BoardInvitationMail } from "../src/mailer.js";
import { workspaceFeatureEnabled } from "../src/feature-policy.js";

vi.mock("../src/feature-policy.js", () => ({ workspaceFeatureEnabled: vi.fn(async () => true) }));
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.mocked(workspaceFeatureEnabled).mockResolvedValue(true);
});

async function fixture(kind: "canvas" | "idea_board" = "idea_board") {
  const repository = new MemoryRepository();
  const now = new Date();
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: "sender@example.test",
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const actor = (await repository.consumeMagicToken(tokenHash, now))!;
  const id = randomUUID();
  const board = {
    id,
    workspaceId: actor.workspaceId,
    title: "Workshop <draft>",
    status: "active",
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    closesAt: new Date(now.getTime() + 3_600_000).toISOString(),
    capabilities: { share: true },
  };
  const creator = { ...actor };
  const workshop = {
    ...board,
    id: randomUUID(),
    boardType: "workshop",
    sourceBoardId: board.id,
    sourceBoard: IdeaBoardViewSchema.parse({
      schemaVersion: 1,
      id: board.id,
      title: board.title,
      description: "Synthetic source",
      identityMode: "anonymous",
      moderationEnabled: true,
      voteBudget: 3,
      ideasVisible: false,
      status: "collecting",
      closesAt: board.closesAt,
      expiresAt: board.expiresAt,
      revision: 0,
      participantLimit: 20,
      createdAt: now.toISOString(),
      groups: [],
      ideas: [],
      participantCount: null,
      totalIdeas: 0,
      countsVisible: false,
    }),
    capabilities: { share: true, facilitate: true },
  };
  const auth = {
    userFromRequest: vi.fn(async () => actor),
    creatorFromRequest: vi.fn(async () => creator),
  };
  const canvases = {
    get: vi.fn(async () => board),
    getWorkshop: vi.fn<() => Promise<typeof workshop>>(async () => {
      throw new CanvasBoardError("NOT_FOUND", "Workshop unavailable");
    }),
    invite: vi.fn(
      async (
        _actor: unknown,
        _id: string,
        input: { operationId: string; email: string; role: string },
      ) => ({
        id: input.operationId,
        email: input.email,
        role: input.role,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: board.expiresAt,
      }),
    ),
  };
  const boards = { getModerator: vi.fn(async () => board) };
  const send = vi.fn(async (_email: string, _mail: BoardInvitationMail) => {});
  const deliveries = createBoardInvitationRepository(repository);
  const cache = new MemorySessionCache();
  const deps = {
    repository,
    auth,
    canvases,
    boards,
    deliveries,
    cache,
    config: ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      WEB_ORIGIN: "https://boards.example.test",
      PUBLIC_API_URL: "https://api.example.test",
    }),
    deliveryAvailable: true,
    mailer: {
      sendAccountVerification: async () => {},
      sendSignInPin: async () => {},
      sendWorkspaceInvitation: async () => {},
      sendBoardInvitation: send,
    },
  } as unknown as BoardInvitationRouteDependencies;
  const app = Fastify({ logger: false });
  apps.push(app);
  await registerBoardInvitationRoutes(app, deps);
  await app.ready();
  const url =
    kind === "canvas"
      ? `/v1/canvas-boards/${id}/invitations/batch`
      : `/v1/idea-boards/${id}/invitations`;
  const payload = {
    operationId: randomUUID(),
    emails: ["recipient@example.test"],
    ...(kind === "canvas" ? { role: "editor" } : {}),
  };
  const post = (body = payload) => app.inject({ method: "POST", url, payload: body });
  return {
    app,
    repository,
    actor,
    creator,
    board,
    workshop,
    auth,
    canvases,
    boards,
    deliveries,
    cache,
    send,
    deps,
    payload,
    post,
  };
}

async function foreignFacilitator() {
  const f = await fixture();
  const now = new Date();
  const tokenHash = randomUUID();
  await f.repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `origin-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const origin = (await f.repository.consumeMagicToken(tokenHash, now))!;
  f.board.workspaceId = origin.workspaceId;
  f.workshop.workspaceId = origin.workspaceId;
  f.boards.getModerator.mockRejectedValue(new IdeaBoardError("NOT_FOUND", "Private source detail"));
  f.canvases.getWorkshop.mockResolvedValue(f.workshop);
  return f;
}

describe("bounded board invitation email delivery", () => {
  it("sends public guest links without allocating credentials, changing identity or requiring recipient accounts", async () => {
    const f = await fixture();
    const result = await f.post({
      ...f.payload,
      emails: [" External@Example.test ", "external@example.test"],
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      complete: true,
      results: [{ email: "external@example.test", status: "sent" }],
    });
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]![1]).toMatchObject({
      kind: "idea_board",
      url: `https://boards.example.test/board/${f.board.id}`,
    });
    expect(f.send.mock.calls[0]![1].url).not.toContain("?");
    expect(f.canvases.invite).not.toHaveBeenCalled();
    expect(f.auth.userFromRequest).not.toHaveBeenCalled();
  });
  it("preserves collaborator invitation authorization, role and deterministic acceptance links", async () => {
    const f = await fixture("canvas");
    const first = await f.post();
    expect(first.statusCode).toBe(200);
    const invitationId = first.json().results[0].invitationId as string;
    expect(f.canvases.invite).toHaveBeenCalledWith(
      f.actor,
      f.board.id,
      { email: "recipient@example.test", role: "editor", operationId: invitationId },
      expect.any(Function),
    );
    expect(f.send.mock.calls[0]![1].url).toBe(
      `https://boards.example.test/canvas/invitations/${invitationId}`,
    );
    const messageId = f.send.mock.calls[0]![1].messageId;
    expect(messageId).not.toContain("recipient");
    expect((await f.post()).json()).toEqual(first.json());
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.canvases.invite).toHaveBeenCalledOnce();
    expect((await f.post({ ...f.payload, role: "viewer" })).statusCode).toBe(409);
  });
  it("returns generic rejections for ineligible collaborator addresses without sending mail", async () => {
    const f = await fixture("canvas");
    f.canvases.invite.mockRejectedValueOnce(
      new CanvasBoardError("NOT_FOUND", "sensitive eligibility detail"),
    );
    const result = await f.post();
    expect(result.json()).toMatchObject({
      complete: true,
      results: [{ status: "rejected", errorCode: "RECIPIENT_UNAVAILABLE" }],
    });
    expect(result.body).not.toContain("sensitive");
    expect(f.send).not.toHaveBeenCalled();
    await f.post();
    expect(f.canvases.invite).toHaveBeenCalledOnce();
  });
  it("records ambiguous SMTP failures as terminal unknown and resends only through a new explicit operation", async () => {
    const f = await fixture();
    f.send.mockRejectedValueOnce(new Error("private provider response"));
    const first = await f.post();
    expect(first.json()).toMatchObject({
      complete: true,
      results: [{ status: "unknown", errorCode: "DELIVERY_UNKNOWN" }],
    });
    expect(first.body).not.toContain("private provider");
    await f.post();
    expect(f.send).toHaveBeenCalledOnce();
    expect(
      (await f.post({ ...f.payload, operationId: randomUUID() })).json().results[0].status,
    ).toBe("sent");
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it("does not duplicate concurrent requests while a mail acknowledgement is outstanding", async () => {
    const f = await fixture();
    let release!: () => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.send.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const first = f.post();
    await sending;
    try {
      const second = await f.post();
      expect(second.statusCode).toBe(202);
      expect(second.json()).toMatchObject({ complete: false, results: [{ status: "pending" }] });
      expect(f.send).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    expect((await first).json().results[0].status).toBe("sent");
  });
  it("never retries mail after acknowledgement succeeded but receipt persistence failed", async () => {
    const f = await fixture();
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.spyOn(f.deliveries, "finish").mockRejectedValueOnce(new Error("unavailable persistence"));
    expect((await f.post()).statusCode).toBe(503);
    vi.setSystemTime(now + 10_001);
    expect((await f.post()).json()).toMatchObject({
      complete: true,
      results: [{ status: "unknown" }],
    });
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("shares the original five-second budget across recipients and leaves the rest pending", async () => {
    const f = await fixture();
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    f.send.mockImplementation(async () => {
      elapsed += 2_000;
    });
    const response = await f.post({
      ...f.payload,
      emails: ["a@example.test", "b@example.test", "c@example.test", "d@example.test"],
    });
    expect(f.send.mock.calls.map(([, mail]) => mail.timeoutMs)).toEqual([5_000, 3_000, 1_000]);
    expect(response.json()).toMatchObject({
      complete: false,
      results: [{ status: "sent" }, { status: "sent" }, { status: "sent" }, { status: "pending" }],
    });
    elapsed = 0;
    expect(
      (
        await f.post({
          ...f.payload,
          emails: ["a@example.test", "b@example.test", "c@example.test", "d@example.test"],
        })
      ).json().complete,
    ).toBe(true);
    expect(f.send).toHaveBeenCalledTimes(4);
  });
  it("rechecks authorization before sending and refuses feature loss, closed boards and absent delivery", async () => {
    const f = await fixture("canvas");
    f.canvases.invite.mockImplementationOnce(async (_actor, _id, input) => {
      f.board.capabilities.share = false;
      return {
        id: input.operationId,
        email: input.email,
        role: input.role,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: f.board.expiresAt,
      };
    });
    expect((await f.post()).json()).toMatchObject({
      results: [{ status: "failed", errorCode: "ACCESS_CHANGED" }],
    });
    expect(f.send).not.toHaveBeenCalled();
    const g = await fixture();
    g.deps.deliveryAvailable = false;
    expect((await g.post()).statusCode).toBe(503);
    g.deps.deliveryAvailable = true;
    g.board.status = "closed";
    expect((await g.post()).statusCode).toBe(403);
    g.board.status = "active";
    vi.mocked(workspaceFeatureEnabled).mockResolvedValue(false);
    expect((await g.post()).statusCode).toBe(403);
    expect(g.send).not.toHaveBeenCalled();
  });
  it("charges recipient intents once, preserves pending entries when admission is denied, and enforces list limits", async () => {
    const f = await fixture();
    const admission = vi.spyOn(f.cache, "consumeIdempotentRateLimit");
    const response = await f.post();
    expect(response.json().complete).toBe(true);
    expect(admission).toHaveBeenCalledTimes(4);
    await f.post();
    expect(admission).toHaveBeenCalledTimes(4);
    expect(
      (await f.post({ ...f.payload, emails: Array(21).fill("a@example.test") })).statusCode,
    ).toBe(400);
    admission.mockResolvedValue(false);
    const pending = await f.post({ ...f.payload, operationId: randomUUID() });
    expect(pending.headers["retry-after"]).toBe("60");
    expect(pending.json()).toMatchObject({ complete: false, results: [{ status: "pending" }] });
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("allows an assigned licensed facilitator through its attached source without adding owning-workspace membership", async () => {
    const f = await foreignFacilitator();
    expect(f.actor.workspaceId).not.toBe(f.workshop.workspaceId);
    expect(f.workshop.sourceBoard).not.toHaveProperty("workspaceId");
    const response = await f.post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ complete: true, results: [{ status: "sent" }] });
    expect(f.canvases.getWorkshop).toHaveBeenCalledWith(f.actor, f.board.id, expect.any(Function));
    for (const feature of ["ideaBoards", "canvasBoards", "canvasBoardSharing"])
      expect(workspaceFeatureEnabled).toHaveBeenCalledWith(
        f.repository,
        f.deps.config,
        f.workshop.workspaceId,
        feature,
      );
    expect(
      (await f.repository.listWorkspaceMembers(f.workshop.workspaceId)).some(
        (member) => member.userId === f.actor.userId,
      ),
    ).toBe(false);
    expect(f.send.mock.calls[0]![1].url).toBe(`https://boards.example.test/board/${f.board.id}`);
  });
  it("denies an ordinary legacy viewer without a facilitator grant", async () => {
    const f = await fixture();
    f.creator.role = "viewer";
    expect((await f.post()).statusCode).toBe(403);
    expect(f.boards.getModerator).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("allows a home-workspace viewer only when its assigned workshop grants both capabilities", async () => {
    const f = await foreignFacilitator();
    f.creator.role = "viewer";
    expect((await f.post()).statusCode).toBe(200);
    expect(f.boards.getModerator).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("rechecks an assigned facilitator's revoked grant or downgraded seat immediately before email", async () => {
    const f = await foreignFacilitator();
    f.canvases.getWorkshop.mockRejectedValue(
      new CanvasBoardError("FORBIDDEN", "Private grant detail"),
    );
    const revoked = await f.post();
    expect(revoked.statusCode).toBe(403);
    expect(revoked.body).not.toContain("Private grant detail");
    expect(f.send).not.toHaveBeenCalled();
    const g = await foreignFacilitator();
    let reads = 0;
    g.canvases.getWorkshop.mockImplementation(async () => {
      if (++reads >= 3) g.workshop.capabilities.facilitate = false;
      return g.workshop;
    });
    expect((await g.post()).json()).toMatchObject({
      complete: true,
      results: [{ status: "failed", errorCode: "ACCESS_CHANGED" }],
    });
    expect(g.send).not.toHaveBeenCalled();
    const h = await foreignFacilitator();
    h.workshop.capabilities.share = false;
    expect((await h.post()).statusCode).toBe(403);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("uses owning-workspace features and rejects mismatched or expired workshop sources", async () => {
    const f = await foreignFacilitator();
    vi.mocked(workspaceFeatureEnabled).mockImplementation(
      async (_repository, _config, workspaceId) => workspaceId === f.actor.workspaceId,
    );
    expect((await f.post()).statusCode).toBe(403);
    expect(f.send).not.toHaveBeenCalled();
    vi.mocked(workspaceFeatureEnabled).mockResolvedValue(true);
    const g = await foreignFacilitator();
    g.workshop.sourceBoard = { ...g.workshop.sourceBoard, id: randomUUID() };
    expect((await g.post()).statusCode).toBe(403);
    expect(g.send).not.toHaveBeenCalled();
    const h = await foreignFacilitator();
    h.workshop.sourceBoard.expiresAt = new Date(Date.now() - 1).toISOString();
    expect((await h.post()).statusCode).toBe(403);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("does not convert database failures into an authorization fallback or leak their details", async () => {
    const f = await fixture();
    f.boards.getModerator.mockRejectedValue(new Error("Private database failure"));
    const result = await f.post();
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain("Private database failure");
    expect(f.canvases.getWorkshop).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    const g = await foreignFacilitator();
    g.canvases.getWorkshop.mockRejectedValue(new Error("Private workshop database failure"));
    const unavailable = await g.post();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("Private workshop database failure");
    expect(g.send).not.toHaveBeenCalled();
  });
});
