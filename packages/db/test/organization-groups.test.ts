import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QuizContentSchema } from "@openround/contracts";
import {
  MemoryRepository,
  PostgresRepository,
  createPlatformRepository,
  createOrganizationGroupRepository,
  createLibrarySharingRepository,
  assertRestrictedRuntimeDatabasePrincipal,
  type Repository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

async function principal(repository: Repository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}
async function fixture(repository: Repository) {
  const owner = await principal(repository),
    member = await principal(repository),
    admin = await principal(repository),
    outsider = await principal(repository);
  const platform = createPlatformRepository(repository);
  const organization = await platform.createOrganization({
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
  await platform.setOrganizationMember({
    organizationId: organization.id,
    actorId: owner.userId,
    userId: admin.userId,
    role: "admin",
  });
  const source = await platform.createOrganizationWorkspace({
    organizationId: organization.id,
    actorId: owner.userId,
    name: "Source",
    segment: "workplace",
  });
  const groups = createOrganizationGroupRepository(repository),
    shares = createLibrarySharingRepository(repository);
  const content = QuizContentSchema.parse({
    title: "Pinned company Round",
    description: "Published",
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
  const now = new Date();
  const round = await repository.createQuiz({
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
  const publication = async (
    audience: "organization" | "people" = "organization",
    permission: "view" | "use" = "view",
  ) =>
    (
      await shares.create({
        actorId: owner.userId,
        workspaceId: source.id,
        now: new Date(),
        input: {
          requestId: randomUUID(),
          artifactType: "round",
          artifactId: round.id,
          versionId: version.id,
          audience,
          recipientIds: audience === "people" ? [owner.userId] : [],
          permission,
          message: "Review together",
          dueAt: null,
        },
      })
    ).share;
  const created = await groups.create(owner.userId, organization.id, {
    name: "Project group",
    description: "Cross-workspace",
    purpose: "project",
  });
  return {
    owner,
    member,
    admin,
    outsider,
    organization,
    source,
    platform,
    groups,
    shares,
    publication,
    group: created.group,
    round,
    version,
  };
}
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
for (const backend of ["memory", "postgres"] as const)
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `organization groups ${backend}`,
    () => {
      const database = `organization_groups_${randomUUID().replaceAll("-", "")}`;
      let repository: Repository, administrator: PostgresRepository | undefined;
      beforeAll(async () => {
        if (backend === "memory") {
          repository = new MemoryRepository();
          return;
        }
        await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`CREATE DATABASE "${database}"`);
        } finally {
          await cluster.close();
        }
        const admin = new URL(adminUrl!),
          runtime = new URL(runtimeUrl!);
        admin.pathname = runtime.pathname = `/${database}`;
        administrator = new PostgresRepository(admin.toString());
        await administrator.migrate();
        await administrator.migrate();
        repository = new PostgresRepository(runtime.toString());
        await repository.initialize();
        expect(
          assertRestrictedRuntimeDatabasePrincipal(
            await (repository as PostgresRepository).inspectRuntimeDatabasePrincipal(),
          ),
        ).toMatchObject({ superuser: false, bypassRls: false, createDatabase: false });
        const tables = await administrator.pool.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",
          [
            [
              "organization_collaboration_groups",
              "organization_collaboration_group_members",
              "organization_collaboration_group_messages",
              "organization_collaboration_group_library",
            ],
          ],
        );
        expect(tables.rows).toHaveLength(4);
        expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(
          true,
        );
      }, 60000);
      afterAll(async () => {
        await repository?.close();
        await administrator?.close();
        if (backend === "postgres") {
          const cluster = new PostgresRepository(adminUrl!);
          try {
            await cluster.pool.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);
          } finally {
            await cluster.close();
          }
        }
      });
      it("keeps invite-only collections across workspaces, owner authority and current organization boundaries", async () => {
        const f = await fixture(repository);
        await expect(
          f.groups.create(f.member.userId, f.organization.id, {
            name: "No",
            description: "",
            purpose: "team",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await f.groups.list(f.member.userId)).toEqual([]);
        expect(await f.groups.list(f.admin.userId)).toEqual([]);
        await expect(f.groups.detail(f.admin.userId, f.group.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
        expect((await f.groups.list(f.member.userId))[0]?.group.id).toBe(f.group.id);
        expect(await repository.getCreatorByUserId(f.member.userId, f.source.id)).toBeNull();
        await expect(
          f.groups.addMember(f.member.userId, f.group.id, f.admin.userId),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          f.groups.addMember(f.owner.userId, f.group.id, f.outsider.userId),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(f.groups.detail(f.outsider.userId, f.group.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await f.groups.addMember(f.owner.userId, f.group.id, f.owner.userId);
        expect(
          (await f.groups.detail(f.owner.userId, f.group.id)).group.members.find(
            (m) => m.userId === f.owner.userId,
          )?.role,
        ).toBe("owner");
        await f.groups.message(f.member.userId, f.group.id, "Coordinate the review");
        await expect(
          f.groups.changeMember(f.owner.userId, f.group.id, f.owner.userId, null),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await f.groups.changeMember(f.owner.userId, f.group.id, f.member.userId, "owner");
        await f.groups.changeMember(f.member.userId, f.group.id, f.owner.userId, null);
        await expect(f.groups.detail(f.owner.userId, f.group.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      });
      it("curates only organization publications without granting original or private-share access", async () => {
        const f = await fixture(repository),
          publication = await f.publication(),
          privateShare = await f.publication("people");
        await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
        await f.groups.link(f.owner.userId, f.group.id, publication.id, true);
        await expect(
          f.groups.link(f.owner.userId, f.group.id, privateShare.id, true),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          f.groups.link(f.member.userId, f.group.id, publication.id, true),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect((await f.groups.detail(f.member.userId, f.group.id)).group.shareIds).toEqual([
          publication.id,
        ]);
        expect(await f.shares.read({ actorId: f.member.userId, id: privateShare.id })).toBeNull();
        expect(await repository.getQuiz(f.member.workspaceId, f.round.id)).toBeNull();
        await f.groups.changeMember(f.owner.userId, f.group.id, f.member.userId, null);
        await expect(f.groups.detail(f.member.userId, f.group.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect(
          (await f.shares.read({ actorId: f.member.userId, id: publication.id }))?.versionId,
        ).toBe(f.version.id);
        await f.shares.revoke({ actorId: f.owner.userId, id: publication.id, now: new Date() });
        expect(await f.shares.read({ actorId: f.owner.userId, id: publication.id })).toBeNull();
        await expect(
          f.groups.link(f.owner.userId, f.group.id, publication.id, true),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await repository.archiveQuiz(f.source.id, f.round.id, true);
        expect(await repository.deleteQuiz(f.source.id, f.round.id)).toBe("deleted");
        expect((await f.groups.detail(f.owner.userId, f.group.id)).group.shareIds).toEqual([]);
      });
      it("reclaims revoked publication capacity atomically while retaining reversible source associations", async () => {
        const f = await fixture(repository);
        await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
        const publications: Array<{ id: string }> = [];
        for (let index = 0; index < 100; index++) {
          const share = await f.publication();
          publications.push(share);
          await f.groups.link(f.owner.userId, f.group.id, share.id, true);
        }
        const otherWorkspace = await f.platform.createOrganizationWorkspace({
          organizationId: f.organization.id,
          actorId: f.owner.userId,
          name: "Another source",
          segment: "workplace",
        });
        const version = (await repository.getQuizVersion(f.source.id, f.version.id))!;
        const original = (await repository.getQuiz(f.source.id, f.round.id))!;
        const otherRound = await repository.createQuiz({
          ...original,
          id: randomUUID(),
          workspaceId: otherWorkspace.id,
          status: "draft",
          currentVersionId: null,
        });
        const otherVersion = await repository.publishQuiz({
          id: randomUUID(),
          workspaceId: otherWorkspace.id,
          quizId: otherRound.id,
          version: 1,
          content: version.content,
          contentHash: randomUUID(),
          publishedAt: new Date(),
        });
        const overflow = (
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: otherWorkspace.id,
            now: new Date(),
            input: {
              requestId: randomUUID(),
              artifactType: "round",
              artifactId: otherRound.id,
              versionId: otherVersion.id,
              audience: "organization",
              recipientIds: [],
              permission: "use",
              message: "",
              dueAt: null,
            },
          })
        ).share;
        // Reversible source changes reserve their slots; restoration cannot exceed100.
        await f.platform.updateWorkspaceStatus(f.source.id, "suspended");
        await expect(
          f.groups.link(f.owner.userId, f.group.id, overflow.id, true),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect((await f.groups.detail(f.owner.userId, f.group.id)).group.shareIds).toHaveLength(
          100,
        );
        await f.platform.updateWorkspaceStatus(f.source.id, "active");
        await repository.archiveQuiz(f.source.id, f.round.id, true);
        await expect(
          f.groups.link(f.owner.userId, f.group.id, overflow.id, true),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await repository.archiveQuiz(f.source.id, f.round.id, false);
        const revokedId = publications[0]!.id;
        await f.shares.revoke({ actorId: f.owner.userId, id: revokedId, now: new Date() });
        const replacement = await f.publication("organization", "use");
        const result = await f.groups.link(f.owner.userId, f.group.id, replacement.id, true);
        expect(result.shareIds).toHaveLength(100);
        expect(result.shareIds).toContain(replacement.id);
        expect(result.shareIds).not.toContain(revokedId);
        expect(
          (await f.groups.link(f.owner.userId, f.group.id, replacement.id, true)).shareIds,
        ).toHaveLength(100);
        await expect(
          f.groups.link(f.owner.userId, f.group.id, overflow.id, true),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await f.shares.read({ actorId: f.owner.userId, id: revokedId })).toBeNull();
        expect(await f.shares.read({ actorId: f.member.userId, id: revokedId })).toBeNull();
        await expect(
          f.groups.link(f.owner.userId, f.group.id, revokedId, true),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          f.groups.link(f.member.userId, f.group.id, overflow.id, true),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(
          (await f.shares.read({ actorId: f.member.userId, id: publications[1]!.id }))
            ?.capabilities,
        ).toMatchObject({ view: true, copy: false });
        expect(
          (await f.shares.read({ actorId: f.member.userId, id: replacement.id }))?.capabilities,
        ).toMatchObject({ view: true, copy: true });
        expect(await f.shares.read({ actorId: f.outsider.userId, id: replacement.id })).toBeNull();
        expect(await repository.getQuiz(f.member.workspaceId, f.round.id)).toBeNull();
        const copy = (actorId: string, destinationWorkspaceId: string, id: string) =>
          f.shares.copy(
            { actorId, destinationWorkspaceId, id, requestId: randomUUID(), now: new Date() },
            async (share) => ({ snapshot: share.snapshot, mediaAssets: [] }),
          );
        await expect(copy(f.owner.userId, f.source.id, publications[1]!.id)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          copy(f.member.userId, f.member.workspaceId, replacement.id),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const copied = await copy(f.owner.userId, f.source.id, replacement.id);
        expect(copied.artifactId).not.toBe(f.round.id);
        expect(await repository.getQuiz(f.source.id, copied.artifactId)).toMatchObject({
          status: "draft",
          currentVersionId: null,
        });
        await f.groups.changeMember(f.owner.userId, f.group.id, f.member.userId, null);
        await expect(f.groups.detail(f.member.userId, f.group.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect(
          await f.shares.read({ actorId: f.member.userId, id: replacement.id }),
        ).not.toBeNull();
      }, 30000);
      it("archives every collaboration write until a separate restore", async () => {
        const f = await fixture(repository),
          publication = await f.publication();
        await f.groups.update(f.owner.userId, f.group.id, { status: "archived" });
        const detail = await f.groups.detail(f.owner.userId, f.group.id);
        expect(detail.group.status).toBe("archived");
        for (const mutation of [
          () => f.groups.message(f.owner.userId, f.group.id, "No"),
          () => f.groups.addMember(f.owner.userId, f.group.id, f.member.userId),
          () => f.groups.link(f.owner.userId, f.group.id, publication.id, true),
          () => f.groups.update(f.owner.userId, f.group.id, { name: "No" }),
          () => f.groups.update(f.owner.userId, f.group.id, { status: "active", name: "No" }),
        ])
          await expect(mutation()).rejects.toMatchObject({ code: "CONFLICT" });
        await f.groups.update(f.owner.userId, f.group.id, { status: "active" });
        await f.groups.update(f.owner.userId, f.group.id, {
          name: "Restored",
          purpose: "department",
        });
        expect((await f.groups.detail(f.owner.userId, f.group.id)).group).toMatchObject({
          name: "Restored",
          purpose: "department",
          status: "active",
        });
      });
      it("removes memberships durably on organization removal and billing reassignment", async () => {
        const f = await fixture(repository);
        await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
        await f.platform.removeOrganizationMember(
          f.organization.id,
          f.owner.userId,
          f.member.userId,
        );
        await expect(f.groups.detail(f.member.userId, f.group.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await f.platform.setOrganizationMember({
          organizationId: f.organization.id,
          actorId: f.owner.userId,
          userId: f.member.userId,
          role: "member",
        });
        expect(await f.groups.list(f.member.userId)).toEqual([]);
        await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
        await f.platform.setOrganizationMember({
          organizationId: f.organization.id,
          actorId: f.owner.userId,
          userId: f.member.userId,
          role: "billing",
        });
        await f.platform.setOrganizationMember({
          organizationId: f.organization.id,
          actorId: f.owner.userId,
          userId: f.member.userId,
          role: "member",
        });
        expect(await f.groups.list(f.member.userId)).toEqual([]);
        await f.platform.updateOrganizationStatus(f.organization.id, "suspended");
        expect(await f.groups.list(f.owner.userId)).toEqual([]);
        await expect(f.groups.message(f.owner.userId, f.group.id, "No")).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      });
      it("promotes an eligible successor when a group's sole owner becomes billing-only", async () => {
        const f = await fixture(repository);
        await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
        await f.groups.addMember(f.owner.userId, f.group.id, f.admin.userId);
        await f.groups.changeMember(f.owner.userId, f.group.id, f.member.userId, "owner");
        await f.groups.changeMember(f.member.userId, f.group.id, f.owner.userId, null);
        await f.platform.setOrganizationMember({
          organizationId: f.organization.id,
          actorId: f.owner.userId,
          userId: f.member.userId,
          role: "billing",
        });
        expect((await f.groups.detail(f.admin.userId, f.group.id)).group.members).toEqual([
          expect.objectContaining({ userId: f.admin.userId, role: "owner" }),
        ]);
        await f.groups.message(f.admin.userId, f.group.id, "Successor can coordinate");
        await f.platform.setOrganizationMember({
          organizationId: f.organization.id,
          actorId: f.owner.userId,
          userId: f.member.userId,
          role: "member",
        });
        expect(await f.groups.list(f.member.userId)).toEqual([]);
      });
      it("exports personal group participation and erases attribution with deterministic ownership succession", async () => {
        const f = await fixture(repository);
        await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
        await f.groups.changeMember(f.owner.userId, f.group.id, f.member.userId, "owner");
        await f.groups.message(f.member.userId, f.group.id, "Personal discussion entry");
        const exported = await repository.exportAccount(f.member.userId);
        expect(exported.organizationGroupMemberships).toHaveLength(1);
        expect(exported.organizationGroupMessages).toHaveLength(1);
        await repository.deleteAccount(f.member.userId);
        const detail = await f.groups.detail(f.owner.userId, f.group.id);
        expect(detail.group.members).toEqual([
          expect.objectContaining({ userId: f.owner.userId, role: "owner" }),
        ]);
        expect(detail.group.messages).toEqual([
          expect.objectContaining({ authorId: null, body: "Message removed" }),
        ]);
      });

      it.skipIf(backend !== "postgres")(
        "curates concurrently through a one-connection pool without nested acquisition",
        async () => {
          const f = await fixture(repository),
            share = await f.publication();
          const runtime = new URL(runtimeUrl!);
          runtime.pathname = `/${database}`;
          const constrained = new PostgresRepository(runtime.toString());
          constrained.pool.options.max = 1;
          constrained.pool.options.connectionTimeoutMillis = 2000;
          try {
            const groups = createOrganizationGroupRepository(constrained);
            await Promise.all(
              Array.from({ length: 12 }, () =>
                groups.link(f.owner.userId, f.group.id, share.id, true),
              ),
            );
            expect((await groups.detail(f.owner.userId, f.group.id)).group.shareIds).toEqual([
              share.id,
            ]);
          } finally {
            await constrained.close();
          }
        },
      );
      it.skipIf(backend !== "postgres")(
        "enforces principal-scoped forced RLS without source-workspace substitution",
        async () => {
          const f = await fixture(repository);
          await f.groups.addMember(f.owner.userId, f.group.id, f.member.userId);
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            expect(
              (
                await client.query("SELECT id FROM organization_collaboration_groups WHERE id=$1", [
                  f.group.id,
                ])
              ).rows,
            ).toEqual([]);
            await client.query("SELECT set_config('app.group_user_id',$1,true)", [
              f.outsider.userId,
            ]);
            expect(
              (
                await client.query(
                  "SELECT group_id FROM organization_collaboration_group_members WHERE group_id=$1",
                  [f.group.id],
                )
              ).rows,
            ).toEqual([]);
            await client.query("SELECT set_config('app.group_user_id',$1,true)", [f.member.userId]);
            expect(
              (
                await client.query("SELECT id FROM organization_collaboration_groups WHERE id=$1", [
                  f.group.id,
                ])
              ).rows,
            ).toHaveLength(1);
            await expect(
              client.query(
                "UPDATE organization_collaboration_groups SET name='Forged' WHERE id=$1 RETURNING id",
                [f.group.id],
              ),
            ).resolves.toMatchObject({ rowCount: 0 });
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
          await f.platform.removeOrganizationMember(
            f.organization.id,
            f.owner.userId,
            f.member.userId,
          );
          const check = await (repository as PostgresRepository).pool.connect();
          try {
            await check.query("BEGIN");
            await check.query("SELECT set_config('app.group_user_id',$1,true)", [f.member.userId]);
            expect(
              (
                await check.query("SELECT id FROM organization_collaboration_groups WHERE id=$1", [
                  f.group.id,
                ])
              ).rows,
            ).toEqual([]);
            await check.query("ROLLBACK");
          } finally {
            check.release();
          }
        },
      );
    },
  );
