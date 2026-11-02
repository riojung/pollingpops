import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  CanvasBoardShareGroupsSchema,
  CanvasObjectCreateSchema,
  IdeaBoardCreateSchema,
} from "@openround/contracts";
import {
  MemoryRepository,
  PostgresRepository,
  createCanvasBoardRepository,
  createCollaborationGroupRepository,
  createIdeaBoardRepository,
  createPlatformRepository,
  type CreatorContext,
  type Repository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import { MemoryCollaborationGroupRepository } from "../src/groups.js";

async function principal(repository: Repository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `canvas-group-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
for (const backend of ["memory", "postgres"] as const)
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `dynamic Canvas group sharing ${backend}`,
    () => {
      let repository: Repository;
      let owner: CreatorContext, editor: CreatorContext, other: CreatorContext;
      let workspaceId: string, organizationId: string;
      let canvases: ReturnType<typeof createCanvasBoardRepository>;
      let groups: ReturnType<typeof createCollaborationGroupRepository>;
      let platform: ReturnType<typeof createPlatformRepository>;
      const database = `canvas_group_${randomUUID().replaceAll("-", "")}`;
      let runtimeDatabaseUrl = runtimeUrl;
      beforeAll(async () => {
        if (backend !== "postgres") return;
        await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
        const cluster = new PostgresRepository(adminUrl!);
        await cluster.pool.query(`CREATE DATABASE "${database}"`);
        await cluster.close();
        const admin = new URL(adminUrl!),
          runtime = new URL(runtimeUrl!);
        admin.pathname = runtime.pathname = `/${database}`;
        runtimeDatabaseUrl = runtime.toString();
        const migration = new PostgresRepository(admin.toString());
        await migration.migrate();
        await migration.close();
      });
      afterAll(async () => {
        if (backend !== "postgres") return;
        const cluster = new PostgresRepository(adminUrl!);
        await cluster.pool.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);
        await cluster.close();
      });
      beforeEach(async () => {
        repository =
          backend === "memory"
            ? new MemoryRepository()
            : new PostgresRepository(runtimeDatabaseUrl!);
        await repository.initialize();
        owner = await principal(repository);
        editor = await principal(repository);
        other = await principal(repository);
        platform = createPlatformRepository(repository);
        const organization = await platform.createOrganization({
          name: "Group sharing organization",
          actorId: owner.userId,
          accountType: "organization",
          licenseUnit: "user",
        });
        organizationId = organization.id;
        await platform.applySubscriptionSnapshot({
          organizationId,
          customerId: null,
          subscriptionId: null,
          status: "active",
          licenseQuantity: 3,
          licenseUnit: "user",
          offerId: null,
          paidThrough: null,
          graceUntil: null,
          legacyPlan: "team",
        });
        for (const user of [editor, other]) {
          await platform.setOrganizationMember({
            organizationId,
            actorId: owner.userId,
            userId: user.userId,
            role: "member",
          });
          await platform.assignOrganizationUserLicense(
            organizationId,
            owner.userId,
            user.userId,
            true,
          );
        }
        workspaceId = (
          await platform.getOrganizationUserLicenses(organizationId, owner.userId)
        ).assignments.find((entry) => entry.userId === owner.userId)!.workspaceId;
        canvases = createCanvasBoardRepository(repository);
        groups = createCollaborationGroupRepository(repository);
      });
      afterEach(async () => {
        await repository?.close();
      });

      async function workspaceMember(user: CreatorContext) {
        // Existing groups can retain legacy shared-workspace members. Seed that explicit
        // membership separately from the user's creator seat and group membership.
        if (repository instanceof MemoryRepository)
          repository.workspaceMembers.set(`${workspaceId}:${user.userId}`, {
            workspaceId,
            userId: user.userId,
            role: "editor",
            joinedAt: new Date(),
          });
        else {
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
            await client.query(
              "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor') ON CONFLICT(workspace_id,user_id) DO NOTHING",
              [workspaceId, user.userId],
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        }
      }
      async function group(name = "Facilitator group", groupWorkspace = workspaceId) {
        const id = randomUUID(),
          now = new Date();
        return groups.createGroup(
          {
            id,
            workspaceId: groupWorkspace,
            name,
            description: "",
            createdBy: owner.userId,
            createdAt: now,
            updatedAt: now,
          },
          {
            workspaceId: groupWorkspace,
            groupId: id,
            userId: owner.userId,
            role: "owner",
            joinedAt: now,
          },
        );
      }
      async function join(groupId: string, user = editor) {
        await workspaceMember(user);
        await groups.addMember({
          workspaceId,
          groupId,
          userId: user.userId,
          role: "member",
          joinedAt: new Date(),
        });
      }
      const create = () =>
        canvases.create(
          owner,
          CanvasBoardCreateSchema.parse({
            workspaceId,
            title: "A shared canvas",
            boardType: "team",
            operationId: randomUUID(),
          }),
        );
      const share = (
        id: string,
        groupIds: string[],
        role: "editor" | "viewer" | "facilitator" = "editor",
        operationId = randomUUID(),
        actor = owner,
      ) => canvases.shareGroups(actor, id, { operationId, groupIds, role });
      async function direct(id: string, role: "viewer" | "editor" | "facilitator") {
        const invitation = await canvases.invite(owner, id, {
          email: editor.email,
          role,
          operationId: randomUUID(),
        });
        return canvases.acceptInvitation(editor, invitation.id);
      }
      async function ideaSource(sourceWorkspace = workspaceId, now = new Date()) {
        return createIdeaBoardRepository(repository).create(
          sourceWorkspace,
          randomUUID(),
          IdeaBoardCreateSchema.parse({ title: "Curated guided workshop" }),
          randomUUID(),
          {
            participantLimit: 10,
            closesAt: new Date(now.getTime() + 3_600_000).toISOString(),
            expiresAt: new Date(now.getTime() + 7_200_000).toISOString(),
          },
          now,
        );
      }

      it("cleans legacy Idea Board group artifacts on deletion and retention purge and rejects stale re-adds", async () => {
        const ideas = createIdeaBoardRepository(repository);
        for (const removal of ["delete", "purge"] as const) {
          const selected = await group(`Workshop ${removal}`);
          const board = await ideaSource();
          const artifact = {
            id: randomUUID(),
            workspaceId,
            groupId: selected.id,
            artifactType: "idea_board" as const,
            artifactId: board.id,
            addedBy: owner.userId,
            createdAt: new Date(),
          };
          await groups.addArtifact(artifact);
          expect(await groups.listArtifacts(selected.id)).toEqual([
            expect.objectContaining({
              id: artifact.id,
              artifactType: "idea_board",
              artifactId: board.id,
            }),
          ]);
          if (removal === "delete") await ideas.delete(workspaceId, board.id);
          else expect(await ideas.purge(new Date(board.expiresAt))).toContain(board.id);
          expect(await groups.listArtifacts(selected.id)).toEqual([]);
          await expect(groups.addArtifact({ ...artifact, id: randomUUID() })).rejects.toThrow();
          expect(await groups.listArtifacts(selected.id)).toEqual([]);
        }
      });

      it.skipIf(backend !== "postgres")(
        "rejects foreign-workspace and expired Idea Board references in restricted direct SQL without retaining orphan artifacts",
        async () => {
          const selected = await group("Protected source references");
          const foreign = await ideaSource(editor.workspaceId);
          const expired = await ideaSource(workspaceId, new Date(Date.now() - 3 * 3_600_000));
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            for (const source of [foreign, expired]) {
              await client.query("BEGIN");
              await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
              await expect(
                client.query(
                  "INSERT INTO collaboration_group_artifacts(id,workspace_id,group_id,artifact_type,artifact_id,added_by,created_at) VALUES($1,$2,$3,'idea_board',$4,$5,now())",
                  [randomUUID(), workspaceId, selected.id, source.id, owner.userId],
                ),
              ).rejects.toMatchObject({ code: "23503" });
              await client.query("ROLLBACK");
            }
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
            expect(
              (
                await client.query(
                  "SELECT id FROM collaboration_group_artifacts WHERE workspace_id=$1 AND group_id=$2",
                  [workspaceId, selected.id],
                )
              ).rows,
            ).toEqual([]);
            await client.query("ROLLBACK");
          } finally {
            await client.query("ROLLBACK");
            client.release();
          }
        },
      );

      it("admits current and later group members dynamically without creating direct grants", async () => {
        const board = await create(),
          selected = await group();
        await share(board.id, [selected.id]);
        await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await join(selected.id);
        const view = await canvases.get(editor, board.id);
        expect(view).toMatchObject({
          workspaceId,
          role: "editor",
          capabilities: { edit: true, share: false, delete: false, archive: false },
        });
        expect((await canvases.authorize(editor, board.id)).role).toBe("editor");
        expect((await canvases.list(editor)).map((row) => row.id)).toContain(board.id);
        const curated = await canvases.groupBoards(editor, workspaceId, selected.id);
        expect(curated).toHaveLength(1);
        expect(curated[0]).toMatchObject({
          id: board.id,
          objects: [],
          grants: [],
          invitations: [],
        });
        expect(curated[0]).not.toHaveProperty("sourceBoard");
        expect((await canvases.get(owner, board.id)).grants).toEqual([]);
        expect((await canvases.sharing(owner, board.id)).groups).toEqual([
          expect.objectContaining({
            groupId: selected.id,
            name: selected.name,
            memberCount: 2,
            role: "editor",
          }),
        ]);
        await canvases.command(editor, board.id, {
          schemaVersion: CANVAS_SCHEMA_VERSION,
          operationId: randomUUID(),
          command: {
            type: "batch",
            operations: [
              {
                type: "create",
                object: CanvasObjectCreateSchema.parse({
                  id: randomUUID(),
                  type: "sticky",
                  x: 0,
                  y: 0,
                  width: 220,
                  height: 160,
                  text: "Group-authorized edit",
                }),
              },
            ],
          },
        });
        expect((await canvases.get(owner, board.id)).objects[0]!.text).toBe(
          "Group-authorized edit",
        );
      });

      it("denies stale group membership after workspace removal on snapshot, metadata and discovery paths", async () => {
        const board = await create(),
          selected = await group();
        await join(selected.id);
        await share(board.id, [selected.id]);
        expect(await repository.removeWorkspaceMember(workspaceId, editor.userId)).toBe(true);
        expect(
          (await groups.listMembers(selected.id)).some((member) => member.userId === editor.userId),
        ).toBe(true);
        await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(canvases.authorize(editor, board.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect((await canvases.list(editor)).map((row) => row.id)).not.toContain(board.id);
        await expect(canvases.groupBoards(editor, workspaceId, selected.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      });

      it("revokes dynamic access when group membership is removed while workspace membership remains", async () => {
        const board = await create(),
          selected = await group();
        await join(selected.id);
        await share(board.id, [selected.id]);
        if (groups instanceof MemoryCollaborationGroupRepository)
          groups.deleteAccount({ userId: editor.userId, ownedWorkspaceIds: new Set() });
        else {
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
            await client.query(
              "DELETE FROM collaboration_group_members WHERE workspace_id=$1 AND group_id=$2 AND user_id=$3",
              [workspaceId, selected.id, editor.userId],
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        }
        expect(
          (await repository.listWorkspaceMembers(workspaceId)).some(
            (member) => member.userId === editor.userId,
          ),
        ).toBe(true);
        await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(canvases.authorize(editor, board.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect((await canvases.list(editor)).map((row) => row.id)).not.toContain(board.id);
      });

      it("uses the strongest overlapping role and safely acknowledges losing sharing authority", async () => {
        const board = await create(),
          editing = await group("Editors"),
          facilitating = await group("Facilitators");
        await join(editing.id);
        await join(facilitating.id);
        await direct(board.id, "viewer");
        await share(board.id, [editing.id], "editor");
        await share(board.id, [facilitating.id], "facilitator");
        expect(await canvases.get(editor, board.id)).toMatchObject({
          role: "facilitator",
          capabilities: { share: true, facilitate: true, delete: false, archive: false },
        });
        const response = await canvases.revokeGroup(
          editor,
          board.id,
          facilitating.id,
          randomUUID(),
        );
        expect(response).toEqual({ groups: [], availableGroups: [], effectiveGroupIds: [] });
        expect((await canvases.get(editor, board.id)).role).toBe("editor");
        await canvases.revokeGroup(owner, board.id, editing.id, randomUUID());
        expect((await canvases.get(editor, board.id)).role).toBe("viewer");
        await expect(canvases.sharing(editor, board.id)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(canvases.delete(editor, board.id)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });

      it("retains exact batch receipts without resurrecting revoked shares and rejects operation reuse", async () => {
        const board = await create(),
          first = await group("First"),
          second = await group("Second"),
          operationId = randomUUID();
        await share(board.id, [first.id, second.id], "editor", operationId);
        const sequence = (await canvases.get(owner, board.id)).canvasSeq;
        await share(board.id, [second.id, first.id], "editor", operationId);
        expect((await canvases.get(owner, board.id)).canvasSeq).toBe(sequence);
        await expect(share(board.id, [first.id], "viewer", operationId)).rejects.toMatchObject({
          code: "IDEMPOTENCY_CONFLICT",
        });
        const revokeId = randomUUID();
        await canvases.revokeGroup(owner, board.id, first.id, revokeId);
        await share(board.id, [first.id, second.id], "editor", operationId);
        expect(
          (await canvases.sharing(owner, board.id)).groups.map((grant) => grant.groupId),
        ).toEqual([second.id]);
        const after = (await canvases.get(owner, board.id)).canvasSeq;
        await canvases.revokeGroup(owner, board.id, first.id, revokeId);
        expect((await canvases.get(owner, board.id)).canvasSeq).toBe(after);
      });

      it("validates the complete batch and keeps twenty retained groups separate from direct grants", async () => {
        const board = await create(),
          selected = await group(),
          foreign = await group("Different workspace", editor.workspaceId);
        await expect(share(board.id, [selected.id, foreign.id])).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect((await canvases.sharing(owner, board.id)).groups).toEqual([]);
        const all = await Promise.all(
          Array.from({ length: 20 }, (_, index) => group(`Group ${index}`)),
        );
        await share(
          board.id,
          all.map(({ id }) => id),
        );
        await expect(share(board.id, [selected.id])).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        expect((await canvases.sharing(owner, board.id)).groups).toHaveLength(20);
        expect((await canvases.get(owner, board.id)).grants).toEqual([]);
        expect(() =>
          CanvasBoardShareGroupsSchema.parse({
            operationId: randomUUID(),
            groupIds: [selected.id, selected.id],
            role: "editor",
          }),
        ).toThrow();
      });

      it("keeps group editing under current creator-license and billing restrictions", async () => {
        const board = await create(),
          selected = await group();
        await join(selected.id);
        await share(board.id, [selected.id]);
        await platform.assignOrganizationUserLicense(
          organizationId,
          owner.userId,
          editor.userId,
          false,
        );
        await workspaceMember(editor);
        await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await canvases.groupBoards(editor, workspaceId, selected.id)).toEqual([]);
        await share(board.id, [selected.id], "viewer");
        expect(await canvases.get(editor, board.id)).toMatchObject({
          role: "viewer",
          capabilities: { edit: false, share: false },
        });
        await platform.setOrganizationMember({
          organizationId,
          actorId: owner.userId,
          userId: editor.userId,
          role: "billing",
        });
        await workspaceMember(editor);
        expect((await canvases.get(editor, board.id)).role).toBe("viewer");
        await share(board.id, [selected.id], "facilitator");
        await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });

      it("omits archived, expired and revoked boards from group curation", async () => {
        const board = await create(),
          selected = await group();
        await join(selected.id);
        await share(board.id, [selected.id]);
        await canvases.command(owner, board.id, {
          schemaVersion: CANVAS_SCHEMA_VERSION,
          operationId: randomUUID(),
          command: { type: "archive" },
        });
        expect(await canvases.groupBoards(editor, workspaceId, selected.id)).toEqual([]);
        await canvases.command(owner, board.id, {
          schemaVersion: CANVAS_SCHEMA_VERSION,
          operationId: randomUUID(),
          command: { type: "restore" },
        });
        expect(
          await canvases.groupBoards(editor, workspaceId, selected.id, new Date(board.expiresAt)),
        ).toEqual([]);
        await canvases.revokeGroup(owner, board.id, selected.id, randomUUID());
        expect(await canvases.groupBoards(editor, workspaceId, selected.id)).toEqual([]);
      });

      it("cascades deleted-group shares and frees the retained-group budget", async () => {
        const board = await create(),
          selected = await group();
        await join(selected.id);
        await share(board.id, [selected.id]);
        if (groups instanceof MemoryCollaborationGroupRepository) {
          // Execute the actual group lifecycle hook independently, proving its bridge to
          // canvas state as well as the normal whole-workspace deletion cascade.
          groups.deleteAccount({ userId: owner.userId, ownedWorkspaceIds: new Set([workspaceId]) });
        } else {
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
            await client.query("DELETE FROM collaboration_groups WHERE workspace_id=$1 AND id=$2", [
              workspaceId,
              selected.id,
            ]);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        }
        expect((await canvases.sharing(owner, board.id)).groups).toEqual([]);
        await expect(canvases.authorize(editor, board.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        const replacements = await Promise.all(
          Array.from({ length: 20 }, (_, index) => group(`Replacement ${index}`)),
        );
        await share(
          board.id,
          replacements.map(({ id }) => id),
        );
        expect((await canvases.sharing(owner, board.id)).groups).toHaveLength(20);
      });

      it.skipIf(backend !== "postgres")(
        "discovers only the principal's group-shared board before workspace context is selected",
        async () => {
          const board = await create(),
            selected = await group(),
            privateBoard = await create();
          await canvases.command(owner, board.id, {
            schemaVersion: CANVAS_SCHEMA_VERSION,
            operationId: randomUUID(),
            command: {
              type: "batch",
              operations: [
                {
                  type: "create",
                  object: CanvasObjectCreateSchema.parse({
                    id: randomUUID(),
                    type: "sticky",
                    x: 0,
                    y: 0,
                    width: 220,
                    height: 160,
                    text: "Private scene protected by board scope",
                  }),
                },
              ],
            },
          });
          await join(selected.id);
          await share(board.id, [selected.id]);
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.canvas_user_id',$1,true)", [editor.userId]);
            const rows = await client.query(
              "SELECT id FROM canvas_boards WHERE id=ANY($1::uuid[])",
              [[board.id, privateBoard.id]],
            );
            expect(rows.rows.map((row) => row.id)).toEqual([board.id]);
            expect(
              (
                await client.query("SELECT board_id FROM canvas_board_objects WHERE board_id=$1", [
                  board.id,
                ])
              ).rows,
            ).toEqual([]);
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
          await canvases.revokeGroup(owner, board.id, selected.id, randomUUID());
          await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        },
      );
    },
  );

it("defines same-workspace cascades, current membership discovery and a separate bounded group relation", async () => {
  const sql = await readFile(
    new URL("../migrations/084_canvas_group_grants.sql", import.meta.url),
    "utf8",
  );
  expect(sql).toContain("REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE");
  expect(sql).toContain("REFERENCES collaboration_groups(workspace_id,id) ON DELETE CASCADE");
  expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  expect(sql).toContain("JOIN workspace_members workspace_member");
  expect(sql).toContain("app.canvas_user_id");
  expect(sql).not.toContain("DISABLE ROW LEVEL SECURITY");
});
