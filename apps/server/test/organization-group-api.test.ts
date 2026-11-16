import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { QuizContentSchema } from "@openround/contracts";
import {
  MemoryRepository,
  createPlatformRepository,
  createLibrarySharingRepository,
  type CreatorContext,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { hashToken } from "../src/security.js";
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function principal(repository: MemoryRepository, email = `${randomUUID()}@example.test`) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}
async function fixture() {
  const repository = new MemoryRepository(),
    owner = await principal(repository),
    member = await principal(repository),
    outsider = await principal(repository);
  const platform = createPlatformRepository(repository),
    organization = await platform.createOrganization({
      actorId: owner.userId,
      name: "Company",
      accountType: "organization",
      licenseUnit: "workspace",
    });
  await platform.setOrganizationMember({
    organizationId: organization.id,
    actorId: owner.userId,
    userId: member.userId,
    role: "member",
  });
  const source = await platform.createOrganizationWorkspace({
    organizationId: organization.id,
    actorId: owner.userId,
    name: "Source",
    segment: "workplace",
  });
  await platform.saveFeaturePolicy({
    expectedRevision: 0,
    features: {
      uxBeta: { enabled: true, plans: ["free", "pro", "team"] },
      groups: { enabled: true, plans: ["free", "pro", "team"] },
    },
  });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    LOG_LEVEL: "silent",
  });
  app = (await buildApp(config, { repository, cache: new MemorySessionCache() })).app;
  async function cookie(creator: CreatorContext) {
    const token = randomUUID();
    await repository.createCreatorSession({
      id: randomUUID(),
      userId: creator.userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 600000),
      activeWorkspaceId: creator.workspaceId,
    });
    return `${config.COOKIE_NAME}=${token}`;
  }
  const ownerCookie = await cookie(owner),
    memberCookie = await cookie(member),
    outsideCookie = await cookie(outsider);
  const request = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    cookieValue = ownerCookie,
  ) =>
    app!.inject({
      method,
      url,
      headers: { cookie: cookieValue },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const group = (
    await request("POST", "/v1/groups", {
      name: "Organization project",
      scope: "organization",
      organizationId: organization.id,
      purpose: "project",
    })
  ).json().group;
  async function publication(audience: "organization" | "people" = "organization") {
    const content = QuizContentSchema.parse({
      title: "Company publication",
      description: "Published once",
      questions: [
        {
          id: randomUUID(),
          type: "numeric",
          prompt: "How many?",
          correctValue: "17",
          tolerance: "0",
          unit: null,
          timeLimitSeconds: 30,
          basePoints: 1000,
          explanation: "PRIVATE",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    });
    const now = new Date(),
      round = await repository.createQuiz({
        id: randomUUID(),
        workspaceId: source.id,
        title: content.title,
        description: content.description,
        draft: content,
        status: "draft",
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: source.id,
      quizId: round.id,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    return (
      await createLibrarySharingRepository(repository).create({
        actorId: owner.userId,
        workspaceId: source.id,
        now,
        input: {
          requestId: randomUUID(),
          artifactType: "round",
          artifactId: round.id,
          versionId: version.id,
          audience,
          recipientIds: audience === "people" ? [owner.userId] : [],
          permission: "use",
          message: "Review together",
          dueAt: new Date(Date.now() + 86400000).toISOString(),
        },
      })
    ).share;
  }
  return {
    repository,
    owner,
    member,
    outsider,
    platform,
    organization,
    source,
    request,
    group,
    publication,
    ownerCookie,
    memberCookie,
    outsideCookie,
  };
}
describe("organization group HTTP capabilities", () => {
  it("lists joined scopes, keeps member collections private and curates existing immutable publication actions", async () => {
    const f = await fixture();
    expect(f.group).toMatchObject({
      scope: "organization",
      scopeName: "Company",
      organizationId: f.organization.id,
      purpose: "project",
      status: "active",
      capabilities: {
        manageMembers: true,
        shareContent: true,
        postMessage: true,
        schedule: false,
        manageGroup: true,
      },
    });
    expect((await f.request("GET", "/v1/groups")).json()).toMatchObject({
      context: { canCreateWorkspaceGroup: true },
      groups: [{ id: f.group.id }],
    });
    expect((await f.request("GET", "/v1/groups", undefined, f.memberCookie)).json().groups).toEqual(
      [],
    );
    expect(
      (await f.request("GET", `/v1/groups/${f.group.id}`, undefined, f.outsideCookie)).statusCode,
    ).toBe(404);
    expect(
      (await f.request("POST", `/v1/groups/${f.group.id}/members`, { userId: f.outsider.userId }))
        .statusCode,
    ).toBe(404);
    expect(
      (await f.request("POST", `/v1/groups/${f.group.id}/members`, { userId: f.member.userId }))
        .statusCode,
    ).toBe(201);
    const publication = await f.publication(),
      privateShare = await f.publication("people");
    expect(
      (
        await f.request("POST", `/v1/groups/${f.group.id}/library-shares`, {
          shareId: privateShare.id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.request("POST", `/v1/groups/${f.group.id}/library-shares`, {
          shareId: publication.id,
        })
      ).statusCode,
    ).toBe(201);
    const detail = (
      await f.request("GET", `/v1/groups/${f.group.id}`, undefined, f.memberCookie)
    ).json().group;
    const protectedResponse = await f.request("GET", `/v1/groups/${f.group.id}`);
    expect(protectedResponse.headers["cache-control"]).toBe("private, no-store");
    expect(protectedResponse.headers.vary).toContain("Cookie");
    expect(detail).toMatchObject({
      scope: "organization",
      artifacts: [],
      canvasBoards: [],
      schedule: [],
      capabilities: {
        manageMembers: false,
        shareContent: false,
        postMessage: true,
        schedule: false,
        manageGroup: false,
      },
      sharedLibrary: [
        {
          id: publication.id,
          permission: "use",
          capabilities: { view: true, copy: false, manage: false },
        },
      ],
    });
    expect(detail.sharedLibrary[0]).not.toHaveProperty("snapshot");
    expect(JSON.stringify(detail)).not.toContain("PRIVATE");
    expect(JSON.stringify(detail)).not.toContain("editHref");
    expect(
      (
        await f.request(
          "POST",
          `/v1/groups/${f.group.id}/messages`,
          { body: "Review together" },
          f.memberCookie,
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await f.request(
          "POST",
          `/v1/groups/${f.group.id}/library-shares`,
          { shareId: publication.id },
          f.memberCookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await f.request("DELETE", `/v1/groups/${f.group.id}/members/${f.member.userId}`)).statusCode,
    ).toBe(204);
    expect(
      (await f.request("GET", `/v1/groups/${f.group.id}`, undefined, f.memberCookie)).statusCode,
    ).toBe(404);
    expect(
      (await f.request("GET", `/v1/library/shares/${publication.id}`, undefined, f.memberCookie))
        .statusCode,
    ).toBe(200);
    await createLibrarySharingRepository(f.repository).revoke({
      actorId: f.owner.userId,
      id: publication.id,
      now: new Date(),
    });
    expect((await f.request("GET", `/v1/groups/${f.group.id}`)).json().group.sharedLibrary).toEqual(
      [],
    );
    expect((await f.request("GET", "/v1/groups")).json().groups[0].artifactCount).toBe(0);
  });
  it("enforces active management, last-owner protection, standalone restore and workspace legacy compatibility", async () => {
    const f = await fixture();
    expect(
      (
        await f.request("PATCH", `/v1/groups/${f.group.id}/members/${f.owner.userId}`, {
          role: "member",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await f.request("POST", `/v1/groups/${f.group.id}/members`, { userId: f.owner.userId })
      ).json().member.role,
    ).toBe("owner");
    expect(
      (await f.request("PATCH", `/v1/groups/${f.group.id}`, { status: "archived" })).statusCode,
    ).toBe(200);
    expect((await f.request("GET", `/v1/groups/${f.group.id}`)).json().group.capabilities).toEqual({
      manageMembers: false,
      shareContent: false,
      postMessage: false,
      schedule: false,
      manageGroup: true,
    });
    for (const [method, path, payload] of [
      ["POST", "/messages", { body: "No" }],
      ["POST", "/members", { userId: f.member.userId }],
      ["PATCH", "", { name: "No" }],
      ["PATCH", "", { status: "active", name: "No" }],
    ] as const)
      expect((await f.request(method, `/v1/groups/${f.group.id}${path}`, payload)).statusCode).toBe(
        409,
      );
    expect(
      (await f.request("PATCH", `/v1/groups/${f.group.id}`, { status: "active" })).statusCode,
    ).toBe(200);
    const workspace = (await f.request("POST", "/v1/groups", { name: "Legacy workspace" })).json()
      .group;
    expect(workspace).toMatchObject({ scope: "workspace", purpose: "team", status: "active" });
    expect(
      (
        await f.request("POST", `/v1/groups/${workspace.id}/members`, { userId: f.owner.userId })
      ).json().member.role,
    ).toBe("owner");
    await f.request("PATCH", `/v1/groups/${workspace.id}`, { status: "archived" });
    expect(
      (await f.request("POST", `/v1/groups/${workspace.id}/messages`, { body: "No" })).statusCode,
    ).toBe(409);
    expect(
      (await f.request("PATCH", `/v1/groups/${workspace.id}`, { purpose: "cohort" })).statusCode,
    ).toBe(409);
    expect(
      (await f.request("PATCH", `/v1/groups/${workspace.id}`, { status: "active" })).statusCode,
    ).toBe(200);
  });
  it("allows seat-independent organization management and searches eligible contacts beyond the first hundred", async () => {
    const f = await fixture();
    f.repository.workspaceMembers.get(`${f.owner.workspaceId}:${f.owner.userId}`)!.role = "viewer";
    f.repository.users.get(f.owner.userId)!.role = "viewer";
    const publication = await f.publication();
    expect(
      (
        await f.request("POST", `/v1/groups/${f.group.id}/library-shares`, {
          shareId: publication.id,
        })
      ).statusCode,
    ).toBe(201);
    expect((await f.request("GET", "/v1/groups")).json().context.canCreateWorkspaceGroup).toBe(
      false,
    );
    for (let index = 0; index < 103; index++) {
      const person = await principal(
        f.repository,
        `person-${String(index).padStart(3, "0")}@example.test`,
      );
      await f.platform.setOrganizationMember({
        organizationId: f.organization.id,
        actorId: f.owner.userId,
        userId: person.userId,
        role: "member",
      });
    }
    const initial = await f.request("GET", `/v1/groups/${f.group.id}/available-members`);
    expect(initial.statusCode).toBe(200);
    expect(initial.json().members).toHaveLength(100);
    expect(initial.json().hasMore).toBe(true);
    const filtered = await f.request(
      "GET",
      `/v1/groups/${f.group.id}/available-members?search=person-102`,
    );
    expect(filtered.json()).toMatchObject({
      members: [{ email: "person-102@example.test" }],
      hasMore: false,
    });
    expect(
      (
        await f.request(
          "GET",
          `/v1/groups/${f.group.id}/available-members`,
          undefined,
          f.outsideCookie,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.request("POST", "/v1/groups", {
          name: "Org without seat",
          scope: "organization",
          organizationId: f.organization.id,
        })
      ).statusCode,
    ).toBe(201);
  });
});
