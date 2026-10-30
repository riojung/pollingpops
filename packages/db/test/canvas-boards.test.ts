import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CanvasBoardCreateSchema,
  CanvasObjectCreateSchema,
  IdeaBoardCreateSchema,
  type CanvasBoardCommand,
} from "@openround/contracts";
import {
  MemoryRepository,
  PostgresRepository,
  createCanvasBoardRepository,
  createIdeaBoardRepository,
  createPlatformRepository,
  type Repository,
  type CreatorContext,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

async function creator(repository: Repository) {
  const tokenHash = randomUUID(),
    now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `canvas-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, now))!;
}
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
for (const backend of ["memory", "postgres"] as const)
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `Canvas boards ${backend}`,
    () => {
      let repository: Repository,
        owner: CreatorContext,
        editor: CreatorContext,
        outsider: CreatorContext,
        workspaceId: string,
        org: string;
      let canvases: ReturnType<typeof createCanvasBoardRepository>,
        platform: ReturnType<typeof createPlatformRepository>;
      const databaseName = `canvas_conformance_${randomUUID().replaceAll("-", "")}`;
      let runtimeDatabaseUrl = runtimeUrl;
      beforeAll(async () => {
        if (backend === "postgres") {
          await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
          const cluster = new PostgresRepository(adminUrl!);
          await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
          await cluster.close();
          const admin = new URL(adminUrl!),
            runtime = new URL(runtimeUrl!);
          admin.pathname = `/${databaseName}`;
          runtime.pathname = `/${databaseName}`;
          runtimeDatabaseUrl = runtime.toString();
          const migration = new PostgresRepository(admin.toString());
          await migration.migrate();
          await migration.close();
        }
      });
      afterAll(async () => {
        if (backend === "postgres") {
          const cluster = new PostgresRepository(adminUrl!);
          await cluster.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH(FORCE)`);
          await cluster.close();
        }
      });
      beforeEach(async () => {
        repository =
          backend === "memory"
            ? new MemoryRepository()
            : new PostgresRepository(runtimeDatabaseUrl!);
        await repository.initialize();
        owner = await creator(repository);
        editor = await creator(repository);
        outsider = await creator(repository);
        platform = createPlatformRepository(repository);
        const organization = await platform.createOrganization({
          name: "Canvas team",
          actorId: owner.userId,
          accountType: "organization",
          licenseUnit: "user",
        });
        org = organization.id;
        await platform.applySubscriptionSnapshot({
          organizationId: org,
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
        await platform.setOrganizationMember({
          organizationId: org,
          actorId: owner.userId,
          userId: editor.userId,
          role: "member",
        });
        workspaceId = (
          await platform.getOrganizationUserLicenses(org, owner.userId)
        ).assignments.find((entry) => entry.userId === owner.userId)!.workspaceId;
        canvases = createCanvasBoardRepository(repository);
      });
      afterEach(async () => {
        await repository?.close();
      });
      const create = () =>
        canvases.create(
          owner,
          CanvasBoardCreateSchema.parse({
            workspaceId,
            title: "Original shared board",
            boardType: "team",
            operationId: randomUUID(),
          }),
        );
      const change = (
        actor: CreatorContext,
        id: string,
        command: CanvasBoardCommand,
        operationId: string = randomUUID(),
      ) => canvases.command(actor, id, { schemaVersion: 1, operationId, command });
      async function share(id: string, role: "facilitator" | "editor" | "viewer" = "editor") {
        const invitation = await canvases.invite(owner, id, {
          email: editor.email,
          role,
          operationId: randomUUID(),
        });
        return canvases.acceptInvitation(editor, invitation.id);
      }
      const note = (text = "A concrete idea") =>
        CanvasObjectCreateSchema.parse({
          id: randomUUID(),
          type: "sticky",
          x: 10,
          y: 20,
          width: 240,
          height: 160,
          text,
        });

      it("preserves owner workspace and grants only an accepted same-organization board", async () => {
        const board = await create();
        await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        const invitation = await canvases.invite(owner, board.id, {
          email: editor.email,
          role: "editor",
          operationId: randomUUID(),
        });
        expect(await canvases.invitationWorkspace(editor, invitation.id)).toBe(workspaceId);
        await expect(canvases.acceptInvitation(outsider, invitation.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        const shared = await canvases.acceptInvitation(editor, invitation.id);
        expect(shared).toMatchObject({
          workspaceId,
          organizationId: org,
          role: "editor",
          capabilities: { edit: true, share: false },
        });
        expect(
          await repository.getCreatorByUserId(editor.userId, editor.workspaceId),
        ).toMatchObject({ workspaceId: editor.workspaceId });
        const unrelated = await create();
        await expect(canvases.get(editor, unrelated.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(
          canvases.invite(owner, board.id, {
            email: outsider.email,
            role: "editor",
            operationId: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await canvases.revokeGrant(owner, board.id, editor.userId);
        await expect(canvases.authorize(editor, board.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      });
      it("retries grant deletion without changing the durable canvas or emitting another event", async () => {
        const board = await create();
        const accepted = await share(board.id);
        const before = await canvases.listOutbox(0, 500);
        await canvases.revokeGrant(owner, board.id, editor.userId);
        const removed = await canvases.get(owner, board.id);
        expect(removed.canvasSeq).toBe(accepted.canvasSeq + 1);
        expect(removed.grants).toEqual([]);
        const committed = await canvases.listOutbox(before.cursor, 500);
        expect(committed.events).toHaveLength(1);
        expect(committed.events[0]).toMatchObject({
          boardId: board.id,
          type: "canvas.changed",
          canvasSeq: removed.canvasSeq,
        });
        // A lost response is retried without a client operation ID, including after reopening.
        const reopened = createCanvasBoardRepository(repository);
        await reopened.revokeGrant(owner, board.id, editor.userId);
        await reopened.revokeGrant(owner, board.id, editor.userId);
        await reopened.revokeGrant(owner, board.id, outsider.userId);
        expect(await reopened.get(owner, board.id)).toEqual(removed);
        expect(await reopened.listOutbox(committed.cursor, 500)).toEqual({
          cursor: committed.cursor,
          events: [],
        });
        await expect(reopened.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
      it("checks current board ownership, license and retention before an absent-grant no-op", async () => {
        const board = await create();
        await share(board.id);
        await expect(canvases.revokeGrant(editor, board.id, outsider.userId)).rejects.toMatchObject(
          { code: "FORBIDDEN" },
        );
        await expect(canvases.revokeGrant(outsider, board.id, editor.userId)).rejects.toMatchObject(
          { code: "NOT_FOUND" },
        );
        await expect(
          canvases.revokeGrant(owner, randomUUID(), editor.userId),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(canvases.revokeGrant(owner, board.id, owner.userId)).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        await canvases.revokeGrant(owner, board.id, editor.userId);
        const removed = await canvases.get(owner, board.id);
        await platform.assignOrganizationUserLicense(org, owner.userId, owner.userId, false);
        await expect(canvases.revokeGrant(owner, board.id, editor.userId)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await platform.assignOrganizationUserLicense(org, owner.userId, owner.userId, true);
        await expect(
          canvases.revokeGrant(owner, board.id, editor.userId, new Date(board.expiresAt)),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await canvases.get(owner, board.id)).toEqual(removed);
        await canvases.delete(owner, board.id);
        const deleted = await canvases.listOutbox(0, 500);
        await expect(canvases.revokeGrant(owner, board.id, editor.userId)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect((await canvases.listOutbox(0, 500)).cursor).toBe(deleted.cursor);
        expect(await canvases.list(owner, { scope: "owned" })).toEqual([]);
      });
      it("resolves only current authorized canonical creation receipts without recreating deleted boards", async () => {
        const input = CanvasBoardCreateSchema.parse({
          workspaceId,
          title: "Café planning",
          boardType: "team",
          operationId: randomUUID(),
        });
        expect(await canvases.getCreation(owner, input)).toBeNull();
        const board = await canvases.create(owner, input);
        const before = await canvases.listOutbox(0, 500);
        expect(
          await canvases.getCreation(owner, { ...input, title: " Cafe\u0301 planning " }),
        ).toEqual({ id: board.id, workspaceId });
        expect(
          await canvases.getCreation(owner, { ...input, workspaceId: owner.workspaceId }),
        ).toBeNull();
        expect(await canvases.getCreation(editor, input)).toBeNull();
        await expect(
          canvases.getCreation(owner, { ...input, title: "Different request" }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await share(board.id);
        expect(await canvases.getCreation(editor, input)).toEqual({ id: board.id, workspaceId });
        await platform.assignOrganizationUserLicense(org, owner.userId, editor.userId, false);
        expect(await canvases.getCreation(editor, input)).toBeNull();
        await platform.assignOrganizationUserLicense(org, owner.userId, editor.userId, true);
        expect(await canvases.getCreation(editor, input)).toEqual({ id: board.id, workspaceId });
        await canvases.revokeGrant(owner, board.id, editor.userId);
        expect(await canvases.getCreation(editor, input)).toBeNull();
        expect(await canvases.getCreation(owner, input, new Date(board.expiresAt))).toBeNull();
        expect(
          (await canvases.listOutbox(before.cursor, 500)).events.every(
            (event) => event.type === "canvas.changed",
          ),
        ).toBe(true);
        await canvases.delete(owner, board.id);
        const afterDelete = await canvases.listOutbox(0, 500);
        expect(await canvases.getCreation(owner, input)).toBeNull();
        expect(await canvases.list(owner, { scope: "owned" })).toEqual([]);
        expect((await canvases.listOutbox(0, 500)).cursor).toBe(afterDelete.cursor);
      });
      it("commits independent object edits, fences conflicts and safely replays accepted batches", async () => {
        const board = await create();
        await share(board.id);
        const a = note("First"),
          b = note("Second");
        const operationId = randomUUID();
        const command: CanvasBoardCommand = {
          type: "batch",
          operations: [
            { type: "create", object: a },
            { type: "create", object: b },
          ],
        };
        const first = await change(owner, board.id, command, operationId);
        expect((await change(owner, board.id, command, operationId)).receipt).toEqual(
          first.receipt,
        );
        await expect(
          change(
            owner,
            board.id,
            { type: "batch", operations: [{ type: "create", object: note() }] },
            operationId,
          ),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        const results = await Promise.all([
          change(owner, board.id, {
            type: "batch",
            operations: [{ type: "update", id: a.id, expectedVersion: 1, patch: { x: 50 } }],
          }),
          change(editor, board.id, {
            type: "batch",
            operations: [{ type: "update", id: b.id, expectedVersion: 1, patch: { x: 70 } }],
          }),
        ]);
        expect(results).toHaveLength(2);
        await expect(
          change(editor, board.id, {
            type: "batch",
            operations: [
              { type: "update", id: a.id, expectedVersion: 1, patch: { text: "Stale overwrite" } },
            ],
          }),
        ).rejects.toMatchObject({ code: "STALE_DRAFT" });
        expect(
          (await canvases.get(owner, board.id)).objects.map((object) => object.x).sort(),
        ).toEqual([50, 70]);
      });
      it("implements actor-owned undo and redo without rewinding another actor or reusing deleted versions", async () => {
        const board = await create();
        await share(board.id);
        const object = note();
        const created = await change(owner, board.id, {
          type: "batch",
          operations: [{ type: "create", object }],
        });
        await expect(
          change(editor, board.id, {
            type: "undo",
            targetOperationId: created.receipt.operationId,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        const undone = await change(owner, board.id, {
          type: "undo",
          targetOperationId: created.receipt.operationId,
        });
        expect(undone.board.objects).toHaveLength(0);
        const redone = await change(owner, board.id, {
          type: "redo",
          targetOperationId: created.receipt.operationId,
        });
        expect(redone.board.objects[0]!.version).toBeGreaterThan(1);
        const current = redone.board.objects[0]!;
        const moved = await change(owner, board.id, {
          type: "batch",
          operations: [
            { type: "update", id: object.id, expectedVersion: current.version, patch: { x: 80 } },
          ],
        });
        await change(editor, board.id, {
          type: "batch",
          operations: [
            {
              type: "update",
              id: object.id,
              expectedVersion: moved.board.objects[0]!.version,
              patch: { text: "My collaborator's latest text" },
            },
          ],
        });
        await expect(
          change(owner, board.id, { type: "undo", targetOperationId: moved.receipt.operationId }),
        ).rejects.toMatchObject({ code: "STALE_DRAFT" });
        const latest = (await canvases.get(owner, board.id)).objects[0]!;
        const deleted = await change(owner, board.id, {
          type: "batch",
          operations: [{ type: "delete", id: object.id, expectedVersion: latest.version }],
        });
        const restored = await change(owner, board.id, {
          type: "undo",
          targetOperationId: deleted.receipt.operationId,
        });
        expect(restored.board.objects[0]!.version).toBeGreaterThan(latest.version);
        await expect(
          change(owner, board.id, {
            type: "batch",
            operations: [
              {
                type: "update",
                id: object.id,
                expectedVersion: 1,
                patch: { text: "Ancient stale version" },
              },
            ],
          }),
        ).rejects.toMatchObject({ code: "STALE_DRAFT" });
      });
      it("undoes and redoes successive own changes in action order with monotonic versions", async () => {
        const board = await create(),
          object = note("Initial note");
        const creation: CanvasBoardCommand = {
          type: "batch",
          operations: [{ type: "create", object }],
        };
        const created = await change(owner, board.id, creation);
        const firstEdit = await change(owner, board.id, {
          type: "batch",
          operations: [
            { type: "update", id: object.id, expectedVersion: 1, patch: { text: "First edit" } },
          ],
        });
        let latest = await change(owner, board.id, {
          type: "batch",
          operations: [
            {
              type: "update",
              id: object.id,
              expectedVersion: firstEdit.board.objects[0]!.version,
              patch: { text: "Second edit" },
            },
          ],
        });
        const secondEdit = latest;
        let version = latest.board.objects[0]!.version;
        for (const [operationId, text] of [
          [secondEdit.receipt.operationId, "First edit"],
          [firstEdit.receipt.operationId, "Initial note"],
          [created.receipt.operationId, null],
        ] as const) {
          expect(latest.board.undoOperationId).toBe(operationId);
          latest = await change(owner, board.id, { type: "undo", targetOperationId: operationId });
          if (text === null) expect(latest.board.objects).toHaveLength(0);
          else {
            expect(latest.board.objects[0]!.text).toBe(text);
            expect(latest.board.objects[0]!.version).toBeGreaterThan(version);
            version = latest.board.objects[0]!.version;
          }
        }
        expect(latest.board.undoOperationId).toBeNull();
        for (const [operationId, text] of [
          [created.receipt.operationId, "Initial note"],
          [firstEdit.receipt.operationId, "First edit"],
          [secondEdit.receipt.operationId, "Second edit"],
        ] as const) {
          expect(latest.board.redoOperationId).toBe(operationId);
          latest = await change(owner, board.id, { type: "redo", targetOperationId: operationId });
          expect(latest.board.objects[0]!.text).toBe(text);
          expect(latest.board.objects[0]!.version).toBeGreaterThan(version);
          version = latest.board.objects[0]!.version;
        }
        expect(latest.board.redoOperationId).toBeNull();
        expect(
          (await change(owner, board.id, creation, created.receipt.operationId)).receipt,
        ).toEqual(created.receipt);
        expect((await canvases.get(owner, board.id)).objects[0]!.text).toBe("Second edit");
      });
      it("preserves overlapping batch and connector-cascade history without undoing a collaborator", async () => {
        const board = await create();
        await share(board.id);
        const a = note("First node"),
          b = note("Second node"),
          connector = CanvasObjectCreateSchema.parse({
            id: randomUUID(),
            type: "connector",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            from: { objectId: a.id, x: 0, y: 0 },
            to: { objectId: b.id, x: 0, y: 0 },
          });
        const created = await change(owner, board.id, {
          type: "batch",
          operations: [a, b, connector].map((object) => ({ type: "create", object })),
        });
        const edited = await change(owner, board.id, {
          type: "batch",
          operations: [
            { type: "update", id: a.id, expectedVersion: 1, patch: { text: "Edited node" } },
            { type: "update", id: b.id, expectedVersion: 1, patch: { x: 80 } },
          ],
        });
        let latest = await change(owner, board.id, {
          type: "batch",
          operations: [{ type: "delete", id: b.id, expectedVersion: 2 }],
        });
        const deleted = latest;
        expect(latest.board.objects.map((object) => object.id)).toEqual([a.id]);
        for (const operationId of [
          deleted.receipt.operationId,
          edited.receipt.operationId,
          created.receipt.operationId,
        ]) {
          expect(latest.board.undoOperationId).toBe(operationId);
          latest = await change(owner, board.id, { type: "undo", targetOperationId: operationId });
        }
        expect(latest.board.objects).toHaveLength(0);
        for (const operationId of [
          created.receipt.operationId,
          edited.receipt.operationId,
          deleted.receipt.operationId,
        ]) {
          expect(latest.board.redoOperationId).toBe(operationId);
          latest = await change(owner, board.id, { type: "redo", targetOperationId: operationId });
        }
        expect(latest.board.objects).toHaveLength(1);
        expect(latest.board.objects[0]!.text).toBe("Edited node");
        latest = await change(owner, board.id, {
          type: "undo",
          targetOperationId: deleted.receipt.operationId,
        });
        const editedA = latest.board.objects.find((object) => object.id === a.id)!;
        await change(editor, board.id, {
          type: "batch",
          operations: [
            {
              type: "update",
              id: a.id,
              expectedVersion: editedA.version,
              patch: { text: "Collaborator's current text" },
            },
          ],
        });
        const before = await canvases.get(owner, board.id);
        await expect(
          change(owner, board.id, { type: "undo", targetOperationId: edited.receipt.operationId }),
        ).rejects.toMatchObject({ code: "STALE_DRAFT" });
        expect((await canvases.get(owner, board.id)).objects).toEqual(before.objects);
      });
      it.each(["no-op", "ABA"] as const)(
        "does not bridge a collaborator's %s version through a later own undo",
        async (mode) => {
          const board = await create();
          await share(board.id);
          const object = note();
          const created = await change(owner, board.id, {
            type: "batch",
            operations: [{ type: "create", object }],
          });
          let edited = await change(editor, board.id, {
            type: "batch",
            operations: [
              {
                type: "update",
                id: object.id,
                expectedVersion: 1,
                patch: { x: mode === "ABA" ? 90 : object.x },
              },
            ],
          });
          if (mode === "ABA")
            edited = await change(editor, board.id, {
              type: "batch",
              operations: [
                {
                  type: "update",
                  id: object.id,
                  expectedVersion: edited.board.objects[0]!.version,
                  patch: { x: object.x },
                },
              ],
            });
          const ownEdit = await change(owner, board.id, {
            type: "batch",
            operations: [
              {
                type: "update",
                id: object.id,
                expectedVersion: edited.board.objects[0]!.version,
                patch: { text: "Own temporary edit" },
              },
            ],
          });
          const undone = await change(owner, board.id, {
            type: "undo",
            targetOperationId: ownEdit.receipt.operationId,
          });
          expect(undone.board.objects[0]!.text).toBe(object.text);
          expect(undone.board.objects[0]!.x).toBe(object.x);
          await expect(
            change(owner, board.id, {
              type: "undo",
              targetOperationId: created.receipt.operationId,
            }),
          ).rejects.toMatchObject({ code: "STALE_DRAFT" });
        },
      );
      it("never reuses a deleted object identifier across actors or rewinds its deletion", async () => {
        const board = await create(),
          object = note();
        await share(board.id);
        const created = await change(owner, board.id, {
          type: "batch",
          operations: [{ type: "create", object }],
        });
        const deleted = await change(editor, board.id, {
          type: "batch",
          operations: [{ type: "delete", id: object.id, expectedVersion: 1 }],
        });
        await expect(
          change(editor, board.id, {
            type: "batch",
            operations: [{ type: "create", object }],
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        await expect(
          change(owner, board.id, {
            type: "undo",
            targetOperationId: created.receipt.operationId,
          }),
        ).rejects.toMatchObject({ code: "STALE_DRAFT" });
        const restored = await change(editor, board.id, {
          type: "undo",
          targetOperationId: deleted.receipt.operationId,
        });
        expect(restored.board.objects[0]!.version).toBeGreaterThan(1);
        await expect(
          change(owner, board.id, {
            type: "undo",
            targetOperationId: created.receipt.operationId,
          }),
        ).rejects.toMatchObject({ code: "STALE_DRAFT" });
      });
      it("rejects invalid graph operations atomically and preserves the object budget", async () => {
        const board = await create(),
          object = note();
        await change(owner, board.id, { type: "batch", operations: [{ type: "create", object }] });
        await expect(
          change(owner, board.id, {
            type: "batch",
            operations: [
              {
                type: "update",
                id: object.id,
                expectedVersion: 1,
                patch: { text: "Should roll back" },
              },
              {
                type: "create",
                object: CanvasObjectCreateSchema.parse({
                  id: randomUUID(),
                  type: "connector",
                  x: 0,
                  y: 0,
                  width: 10,
                  height: 10,
                  from: { objectId: randomUUID(), x: 0, y: 0 },
                  to: { objectId: object.id, x: 0, y: 0 },
                }),
              },
            ],
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect((await canvases.get(owner, board.id)).objects[0]!.text).toBe("A concrete idea");
      });
      it("keeps pending guest content private, protects references and freezes against legacy phase transitions", async () => {
        const ideas = createIdeaBoardRepository(repository),
          now = new Date(),
          sourceId = randomUUID();
        const source = await ideas.create(
          workspaceId,
          sourceId,
          IdeaBoardCreateSchema.parse({ title: "Workshop", ideasVisible: false }),
          randomUUID(),
          {
            participantLimit: 10,
            closesAt: new Date(now.getTime() + 86400000).toISOString(),
            expiresAt: new Date(now.getTime() + 2 * 86400000).toISOString(),
          },
          now,
        );
        await ideas.hostCommand(workspaceId, source.id, { type: "collect" }, 0, randomUUID(), now);
        const token = createHash("sha256").update(randomUUID()).digest("hex");
        await ideas.join(source.id, token, null, now);
        const submitted = await ideas.submitIdea(
          source.id,
          token,
          "Private pending submission",
          randomUUID(),
          now,
        );
        const ideaId = submitted.ownIdeas[0]!.id;
        const board = await canvases.create(
          owner,
          CanvasBoardCreateSchema.parse({
            workspaceId,
            title: "Workshop canvas",
            boardType: "workshop",
            sourceBoardId: source.id,
            operationId: randomUUID(),
          }),
        );
        await share(board.id);
        expect(JSON.stringify(await canvases.get(editor, board.id))).not.toContain(
          "Private pending submission",
        );
        expect((await canvases.getGuest(source.id, token))!.objects).toHaveLength(0);
        const approved = await change(owner, board.id, {
          type: "workshop",
          expectedRevision: submitted.board.revision,
          command: { type: "moderate", ideaId, status: "approved" },
        });
        const ref = approved.board.objects[0]!;
        expect(ref.type).toBe("idea_ref");
        expect(ref.idea?.body).toBe("Private pending submission");
        expect((await canvases.getGuest(source.id, token))!.objects).toHaveLength(0);
        expect((await canvases.get(editor, board.id)).objects).toHaveLength(0);
        await expect(
          change(editor, board.id, {
            type: "batch",
            operations: [
              { type: "update", id: ref.id, expectedVersion: ref.version, patch: { x: 30 } },
            ],
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          change(owner, board.id, {
            type: "batch",
            operations: [
              {
                type: "update",
                id: ref.id,
                expectedVersion: ref.version,
                patch: { text: "Rewrite a guest" },
              },
            ],
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        await change(owner, board.id, {
          type: "grant",
          userId: editor.userId,
          role: "facilitator",
        });
        const published = await change(editor, board.id, {
          type: "batch",
          operations: [
            {
              type: "create",
              object: { ...note("A published instruction"), visibility: "published" },
            },
          ],
        });
        await change(owner, board.id, { type: "grant", userId: editor.userId, role: "editor" });
        await expect(
          change(editor, board.id, {
            type: "undo",
            targetOperationId: published.receipt.operationId,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const beforeVote = await ideas.getModerator(workspaceId, source.id);
        const raced = await Promise.allSettled([
          ideas.hostCommand(
            workspaceId,
            source.id,
            { type: "start_voting" },
            beforeVote.revision,
            randomUUID(),
            now,
          ),
          change(owner, board.id, {
            type: "batch",
            operations: [{ type: "create", object: note("A racing team note") }],
          }),
        ]);
        expect(raced[0]!.status).toBe("fulfilled");
        expect((await canvases.get(owner, board.id)).status).toBe("frozen");
        await expect(
          change(owner, board.id, {
            type: "batch",
            operations: [{ type: "create", object: note() }],
          }),
        ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
        expect((await canvases.authorizeGuest(source.id, token)).sourceRevision).toBeGreaterThan(
          beforeVote.revision,
        );
        const closed = await ideas.getModerator(workspaceId, source.id);
        await ideas.hostCommand(
          workspaceId,
          source.id,
          { type: "close" },
          closed.revision,
          randomUUID(),
          now,
        );
        expect((await canvases.get(owner, board.id)).status).toBe("closed");
      });
      it.each(["autoapproved", "legacy-approved"] as const)(
        "atomically persists %s references before closing directly from collection",
        async (approval) => {
          const ideas = createIdeaBoardRepository(repository),
            now = new Date();
          const source = await ideas.create(
            workspaceId,
            randomUUID(),
            IdeaBoardCreateSchema.parse({
              title: "Direct closure workshop",
              moderationEnabled: approval !== "autoapproved",
              ideasVisible: true,
            }),
            randomUUID(),
            {
              participantLimit: 10,
              closesAt: new Date(now.getTime() + 86400000).toISOString(),
              expiresAt: new Date(now.getTime() + 2 * 86400000).toISOString(),
            },
            now,
          );
          await ideas.hostCommand(
            workspaceId,
            source.id,
            { type: "collect" },
            0,
            randomUUID(),
            now,
          );
          const board = await canvases.create(
            owner,
            CanvasBoardCreateSchema.parse({
              workspaceId,
              title: "Direct closure canvas",
              boardType: "workshop",
              sourceBoardId: source.id,
              operationId: randomUUID(),
            }),
          );
          const token = createHash("sha256").update(randomUUID()).digest("hex");
          await ideas.join(source.id, token, null, now);
          const submitted = await ideas.submitIdea(
            source.id,
            token,
            "Keep the approved workshop idea",
            randomUUID(),
            now,
          );
          const ideaId = submitted.ownIdeas[0]!.id;
          if (approval === "legacy-approved")
            await ideas.hostCommand(
              workspaceId,
              source.id,
              { type: "moderate", ideaId, status: "approved" },
              submitted.board.revision,
              randomUUID(),
              now,
            );
          const current = await ideas.getModerator(workspaceId, source.id);
          expect((await canvases.get(owner, board.id)).objects[0]).toMatchObject({
            id: ideaId,
            type: "idea_ref",
          });
          async function storedReferences() {
            if (!(repository instanceof PostgresRepository)) return null;
            const client = await repository.pool.connect();
            try {
              await client.query("BEGIN");
              await client.query(
                "SELECT set_config('app.workspace_id',$1,true),set_config('app.canvas_board_id',$2,true),set_config('app.canvas_user_id',$3,true)",
                [workspaceId, board.id, owner.userId],
              );
              return (
                await client.query<{ id: string }>(
                  "SELECT id FROM canvas_board_objects WHERE board_id=$1 ORDER BY id",
                  [board.id],
                )
              ).rows.map((row) => row.id);
            } finally {
              await client.query("ROLLBACK");
              client.release();
            }
          }
          if (backend === "postgres") expect(await storedReferences()).toEqual([]);
          await expect(
            change(owner, board.id, {
              type: "workshop",
              expectedRevision: current.revision - 1,
              command: { type: "close" },
            }),
          ).rejects.toMatchObject({ code: "STALE_DRAFT" });
          await expect(
            canvases.command(
              owner,
              board.id,
              {
                schemaVersion: 1,
                operationId: randomUUID(),
                command: {
                  type: "workshop",
                  expectedRevision: current.revision,
                  command: { type: "close" },
                },
              },
              new Date(source.closesAt),
            ),
          ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
          expect(await ideas.getModerator(workspaceId, source.id)).toMatchObject({
            status: "collecting",
            revision: current.revision,
          });
          expect((await canvases.get(owner, board.id)).canvasSeq).toBe(0);
          if (backend === "postgres") expect(await storedReferences()).toEqual([]);
          const command: CanvasBoardCommand = {
            type: "workshop",
            expectedRevision: current.revision,
            command: { type: "close" },
          };
          const closed = await change(owner, board.id, command);
          expect(closed.board).toMatchObject({
            status: "closed",
            canvasSeq: 1,
            capabilities: { edit: false },
            sourceBoard: { status: "closed", countsVisible: true },
          });
          expect(closed.board.objects).toHaveLength(1);
          expect(closed.board.objects[0]).toMatchObject({
            id: ideaId,
            idea: { body: "Keep the approved workshop idea", status: "approved" },
          });
          expect(
            (await change(owner, board.id, command, closed.receipt.operationId)).receipt,
          ).toEqual(closed.receipt);
          const reopened = createCanvasBoardRepository(repository);
          expect(await reopened.get(owner, board.id)).toEqual(closed.board);
          expect((await reopened.getGuest(source.id, token))!.objects).toHaveLength(1);
          if (backend === "postgres") expect(await storedReferences()).toEqual([ideaId]);
        },
      );
      it("enforces membership/seat revocation and fresh retained-content deadlines", async () => {
        const board = await create();
        await share(board.id);
        await platform.assignOrganizationUserLicense(org, owner.userId, editor.userId, false);
        await expect(canvases.get(editor, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(canvases.authorize(editor, board.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(
          canvases.get(owner, board.id, new Date(board.expiresAt)),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const events = await canvases.listOutbox(0, 100);
        expect(events.events.length).toBeGreaterThan(0);
        for (const event of events.events) {
          expect(event).not.toHaveProperty("objects");
          expect(event).not.toHaveProperty("userId");
        }
        const claim = await canvases.claimOutbox();
        expect(claim).not.toBeNull();
        expect(await canvases.completeOutbox(claim!.eventId, randomUUID())).toBe(false);
        expect(await canvases.completeOutbox(claim!.eventId, claim!.leaseToken!)).toBe(true);
      });
      it("exports only safe retained content, removes collaborator identity grants and purges canvas data", async () => {
        const board = await create();
        await share(board.id);
        const object = note("Retained organization content");
        await change(owner, board.id, { type: "batch", operations: [{ type: "create", object }] });
        const exported = (await repository.exportAccount(owner.userId)).canvasBoards;
        expect(JSON.stringify(exported)).toContain("Retained organization content");
        for (const field of ["creationKey", "creationHash", "receipts", "invitations", "tokenHash"])
          expect(JSON.stringify(exported)).not.toContain(field);
        await platform.setOrganizationMember({
          organizationId: org,
          actorId: owner.userId,
          userId: outsider.userId,
          role: "billing",
        });
        const readerInvite = await canvases.invite(owner, board.id, {
          email: outsider.email,
          role: "viewer",
          operationId: randomUUID(),
        });
        await canvases.acceptInvitation(outsider, readerInvite.id);
        await repository.deleteUserIdentity(outsider.userId);
        const retained = await canvases.get(owner, board.id);
        expect(retained.objects[0]!.text).toBe("Retained organization content");
        expect(retained.grants.some((grant) => grant.userId === outsider.userId)).toBe(false);
        await expect(canvases.authorize(outsider, board.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await repository.purgeExpired(new Date(board.expiresAt));
        await expect(canvases.get(owner, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
      it("removes moderated content from derived references and cascades source deletion even after voting freezes", async () => {
        const ideas = createIdeaBoardRepository(repository),
          now = new Date(),
          sourceId = randomUUID();
        const source = await ideas.create(
          workspaceId,
          sourceId,
          IdeaBoardCreateSchema.parse({ title: "Redaction workshop", ideasVisible: true }),
          randomUUID(),
          {
            participantLimit: 10,
            closesAt: new Date(now.getTime() + 86400000).toISOString(),
            expiresAt: new Date(now.getTime() + 2 * 86400000).toISOString(),
          },
          now,
        );
        await ideas.hostCommand(workspaceId, source.id, { type: "collect" }, 0, randomUUID(), now);
        const token = createHash("sha256").update(randomUUID()).digest("hex");
        await ideas.join(source.id, token, null, now);
        const submission = await ideas.submitIdea(
          source.id,
          token,
          "REMOVE THIS PRIVATE TEXT",
          randomUUID(),
          now,
        );
        const ideaId = submission.ownIdeas[0]!.id;
        const board = await canvases.create(
          owner,
          CanvasBoardCreateSchema.parse({
            workspaceId,
            title: "Redaction canvas",
            boardType: "workshop",
            sourceBoardId: source.id,
            operationId: randomUUID(),
          }),
        );
        const approval = await change(owner, board.id, {
          type: "workshop",
          expectedRevision: submission.board.revision,
          command: { type: "moderate", ideaId, status: "approved" },
        });
        const ref = approval.board.objects[0]!;
        const moved = await change(owner, board.id, {
          type: "batch",
          operations: [
            { type: "update", id: ref.id, expectedVersion: ref.version, patch: { x: 120 } },
          ],
        });
        await change(owner, board.id, {
          type: "workshop",
          expectedRevision: moved.board.sourceBoard!.revision,
          command: { type: "moderate", ideaId, status: "removed" },
        });
        expect(JSON.stringify(await canvases.get(owner, board.id))).not.toContain(
          "REMOVE THIS PRIVATE TEXT",
        );
        expect(JSON.stringify(await canvases.getGuest(source.id, token))).not.toContain(
          "REMOVE THIS PRIVATE TEXT",
        );
        await expect(
          change(owner, board.id, { type: "undo", targetOperationId: moved.receipt.operationId }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        const second = await ideas.submitIdea(
          source.id,
          token,
          "Another approved idea",
          randomUUID(),
          now,
        );
        const secondId = second.ownIdeas.at(-1)!.id;
        const nextApproval = await change(owner, board.id, {
          type: "workshop",
          expectedRevision: second.board.revision,
          command: { type: "moderate", ideaId: secondId, status: "approved" },
        });
        const frozen = await change(owner, board.id, {
          type: "workshop",
          expectedRevision: nextApproval.board.sourceBoard!.revision,
          command: { type: "start_voting" },
        });
        expect(frozen.board.status).toBe("frozen");
        const invitation = await canvases.invite(owner, board.id, {
          email: editor.email,
          role: "viewer",
          operationId: randomUUID(),
        });
        await canvases.acceptInvitation(editor, invitation.id);
        await canvases.revokeGrant(owner, board.id, editor.userId);
        const closed = await change(owner, board.id, {
          type: "workshop",
          expectedRevision: frozen.board.sourceBoard!.revision,
          command: { type: "close" },
        });
        expect(closed.board.status).toBe("closed");
        await ideas.delete(workspaceId, source.id);
        await expect(canvases.get(owner, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
      it("hard-bounds retained documents and typed objects in serialized transactions", async () => {
        const board = await create();
        for (let index = 0; index < 10; index++)
          await change(owner, board.id, {
            type: "batch",
            operations: Array.from({ length: 50 }, () => ({ type: "create", object: note() })),
          });
        await expect(
          change(owner, board.id, {
            type: "batch",
            operations: [{ type: "create", object: note() }],
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect((await canvases.get(owner, board.id)).objects).toHaveLength(500);
        for (let index = 0; index < 99; index++) await create();
        const outcomes = await Promise.allSettled([create(), create()]);
        expect(
          outcomes.every(
            (result) => result.status === "rejected" && result.reason.code === "ENTITLEMENT_LIMIT",
          ),
        ).toBe(true);
      }, 20000);
    },
  );
