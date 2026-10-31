import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  IdeaBoardCreateSchema,
} from "@openround/contracts";
import {
  MemoryRepository,
  PostgresRepository,
  createCanvasBoardRepository,
  CanvasBoardRepository,
  createCanvasArtifactLinkRepository,
  createIdeaBoardRepository,
  createPlatformRepository,
  createPresentationRepository,
  type CreatorContext,
  type Repository,
  type CanvasArtifactTarget,
  type CanvasRun,
  type CanvasTransaction,
} from "../src/index.js";
import type { MemoryCanvasBoards } from "../src/canvas-board-store.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
async function creator(repository: Repository) {
  const tokenHash = randomUUID(),
    now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `canvas-link-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, now))!;
}
for (const backend of ["memory", "postgres"] as const)
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `${backend} exact canvas artifact link conformance`,
    () => {
      let repository: Repository, owner: CreatorContext, workspaceId: string;
      let canvases: ReturnType<typeof createCanvasBoardRepository>,
        links: ReturnType<typeof createCanvasArtifactLinkRepository>;
      const databaseName = `canvas_links_${randomUUID().replaceAll("-", "")}`;
      let runtimeDatabaseUrl = runtimeUrl;
      beforeAll(async () => {
        if (backend !== "postgres") return;
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
      });
      afterAll(async () => {
        if (backend !== "postgres") return;
        const cluster = new PostgresRepository(adminUrl!);
        await cluster.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH(FORCE)`);
        await cluster.close();
      });
      beforeEach(async () => {
        repository =
          backend === "memory"
            ? new MemoryRepository()
            : new PostgresRepository(runtimeDatabaseUrl!);
        await repository.initialize();
        owner = await creator(repository);
        const platform = createPlatformRepository(repository);
        const organization = await platform.createOrganization({
          name: "Link conformance",
          actorId: owner.userId,
          accountType: "organization",
          licenseUnit: "user",
        });
        await platform.applySubscriptionSnapshot({
          organizationId: organization.id,
          customerId: null,
          subscriptionId: null,
          status: "active",
          licenseQuantity: 2,
          licenseUnit: "user",
          offerId: null,
          paidThrough: null,
          graceUntil: null,
          legacyPlan: "team",
        });
        workspaceId = (
          await platform.getOrganizationUserLicenses(organization.id, owner.userId)
        ).assignments.find((row) => row.userId === owner.userId)!.workspaceId;
        canvases = createCanvasBoardRepository(repository);
        links = createCanvasArtifactLinkRepository(repository);
      });
      afterEach(async () => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        await repository?.close();
      });
      async function target(kind: CanvasArtifactTarget["kind"] = "round") {
        const now = new Date(),
          id = randomUUID();
        const common = {
          id,
          workspaceId,
          title: "Destination",
          description: "",
          status: "draft" as const,
          currentVersionId: null,
          createdAt: now,
          updatedAt: now,
          draftRevision: 0,
          lastEditedBy: owner.userId,
        };
        if (kind === "round")
          await repository.createQuiz({
            ...common,
            draft: { title: "Destination", description: "", questions: [] },
          });
        else
          await createPresentationRepository(repository).createPresentation({
            ...common,
            draftSchemaVersion: 2,
            publishedDraftRevision: null,
            folderId: null,
            draft: {
              schemaVersion: 2,
              title: "Destination",
              description: "",
              experiencePreset: { id: "pops", version: 1 },
              blocks: [],
            },
          });
        return { workspaceId, kind, id };
      }
      async function source(workshop = false) {
        const now = new Date();
        const origin = workshop
          ? await createIdeaBoardRepository(repository).create(
              workspaceId,
              randomUUID(),
              IdeaBoardCreateSchema.parse({ title: "Origin workshop" }),
              randomUUID(),
              {
                participantLimit: 10,
                closesAt: new Date(now.getTime() + 3600000).toISOString(),
                expiresAt: new Date(now.getTime() + 86400000).toISOString(),
              },
              now,
            )
          : null;
        const board = await canvases.create(
          owner,
          CanvasBoardCreateSchema.parse({
            schemaVersion: CANVAS_SCHEMA_VERSION,
            workspaceId,
            title: "Source",
            boardType: origin ? "workshop" : "team",
            ...(origin && { sourceBoardId: origin.id }),
            operationId: randomUUID(),
          }),
        );
        const versionId = randomUUID();
        await canvases.facilitate(owner, board.id, {
          schemaVersion: 1,
          operationId: randomUUID(),
          command: { type: "version_create", versionId, name: "Checkpoint" },
        });
        if (origin && repository instanceof MemoryRepository) {
          // Also prove the workshop deadline independently fences a still-live canvas.
          // PostgreSQL enforces identical immutable source/canvas retention at creation.
          board.expiresAt = new Date(now.getTime() + 2 * 86400000).toISOString();
          const store = repository.getOrCreateLifecycleExtension("canvasBoards", () => {
            throw new Error("Expected initialized canvas");
          }) as unknown as { rows: Map<string, { board: { expiresAt: string } }> };
          store.rows.get(board.id)!.board.expiresAt = board.expiresAt;
        }
        return {
          board,
          versionId,
          sourceId: origin?.id,
          expiresAt: origin?.expiresAt ?? board.expiresAt,
        };
      }
      const create = (boardId: string, versionId: string) => ({
        schemaVersion: 1 as const,
        operationId: randomUUID(),
        linkId: randomUUID(),
        boardId,
        versionId,
      });
      function expireAfterTransaction(expiresAt: string) {
        let completed = false;
        const expire = () => {
          completed = true;
          vi.setSystemTime(new Date(expiresAt));
        };
        if (repository instanceof MemoryRepository) {
          const store = repository.getOrCreateLifecycleExtension("canvasBoards", () => {
            throw new Error("Expected initialized canvas");
          }) as unknown as MemoryCanvasBoards;
          const actualRun = store.run;
          const delayedRun: CanvasRun = async (actor, scope, work) => {
            const result = await actualRun(actor, scope, work);
            expire();
            return result;
          };
          vi.spyOn(store, "run").mockImplementation(delayedRun);
        } else {
          const internals = links as unknown as {
            target(ctx: { tx: CanvasTransaction }, write?: boolean): Promise<unknown>;
          };
          const actualTarget = internals.target.bind(internals);
          let wrapped = false;
          vi.spyOn(internals, "target").mockImplementation(async (ctx, write) => {
            const client = ctx.tx.sqlClient;
            if (client && !wrapped) {
              wrapped = true;
              const actualQuery = client.query.bind(client) as (
                ...args: unknown[]
              ) => Promise<unknown>;
              const delayedQuery = (async (...args: unknown[]) => {
                const result = await actualQuery(...args);
                // The database has really committed; delay only delivery of its completion.
                if (args[0] === "COMMIT") expire();
                return result;
              }) as typeof client.query;
              vi.spyOn(client, "query").mockImplementation(delayedQuery);
            }
            return actualTarget(ctx, write);
          });
        }
        return () => completed;
      }
      it("deduplicates concurrent starts, preserves receipts and prevents deleted-ID ABA in either destination", async () => {
        const { board, versionId } = await source();
        for (const kind of ["round", "presentation"] as const) {
          const destination = await target(kind),
            first = create(board.id, versionId),
            second = create(board.id, versionId);
          const results = await Promise.all([
            links.create(owner, destination, first),
            links.create(owner, destination, second),
          ]);
          expect(results[0].receipt.linkId).toBe(results[1].receipt.linkId);
          expect((await links.list(owner, destination)).links).toHaveLength(1);
          const linkId = results[0].receipt.linkId;
          const deletion = {
            schemaVersion: 1 as const,
            operationId: randomUUID(),
            expectedRevision: 1,
          };
          const deleted = await links.delete(owner, destination, linkId, deletion);
          expect(await links.delete(owner, destination, linkId, deletion)).toEqual(deleted);
          await expect(
            links.create(owner, destination, { ...first, operationId: randomUUID(), linkId }),
          ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
          expect(await links.create(owner, destination, first)).toEqual(results[0]);
          expect((await links.list(owner, destination)).links).toEqual([]);
        }
      });
      it("rejects globally live identifiers and scopes retired retries/deletes to their original destination", async () => {
        const first = await target(),
          second = await target("presentation"),
          { board, versionId } = await source(),
          input = create(board.id, versionId);
        const created = await links.create(owner, first, input);
        await expect(
          links.create(owner, second, { ...input, operationId: randomUUID() }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        expect((await links.list(owner, first)).links[0]?.id).toBe(input.linkId);
        expect((await links.list(owner, second)).links).toEqual([]);
        const deletion = {
          schemaVersion: 1 as const,
          operationId: randomUUID(),
          expectedRevision: 1,
        };
        const deleted = await links.delete(owner, first, input.linkId, deletion);
        // PG permits a globally retired ID in another target; its old receipts confer no rights there.
        const reused = await links.create(owner, second, { ...input, operationId: randomUUID() });
        expect(reused.receipt.linkId).toBe(input.linkId);
        expect(await links.create(owner, first, input)).toEqual(created);
        expect(await links.delete(owner, first, input.linkId, deletion)).toEqual(deleted);
        await expect(
          links.delete(owner, first, input.linkId, { ...deletion, operationId: randomUUID() }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect((await links.list(owner, first)).links).toEqual([]);
        expect((await links.preview(owner, second, input.linkId)).version.id).toBe(versionId);
      });
      it("preserves another user's inaccessible destination when a known live ID is supplied", async () => {
        const protectedTarget = await target(),
          { board, versionId } = await source(),
          input = create(board.id, versionId);
        await links.create(owner, protectedTarget, input);
        const attacker = await creator(repository);
        const attackerTarget = {
          workspaceId: attacker.workspaceId,
          kind: "round" as const,
          id: randomUUID(),
        };
        const template = (await repository.getQuiz(workspaceId, protectedTarget.id))!;
        await repository.createQuiz({
          ...template,
          id: attackerTarget.id,
          workspaceId: attacker.workspaceId,
        });
        const attackerCanvas = await canvases.create(
          attacker,
          CanvasBoardCreateSchema.parse({
            workspaceId: attacker.workspaceId,
            title: "Own canvas",
            boardType: "team",
            operationId: randomUUID(),
          }),
        );
        const attackerVersion = randomUUID();
        await canvases.facilitate(attacker, attackerCanvas.id, {
          schemaVersion: 1,
          operationId: randomUUID(),
          command: { type: "version_create", versionId: attackerVersion, name: "Own checkpoint" },
        });
        await expect(links.list(attacker, protectedTarget)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(
          links.create(attacker, attackerTarget, {
            ...create(attackerCanvas.id, attackerVersion),
            linkId: input.linkId,
          }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        expect((await links.list(owner, protectedTarget)).links[0]).toMatchObject({
          id: input.linkId,
          boardId: board.id,
        });
        expect((await links.preview(owner, protectedTarget, input.linkId)).version.id).toBe(
          versionId,
        );
        expect((await links.list(attacker, attackerTarget)).links).toEqual([]);
      });
      for (const workshop of [false, true])
        for (const operation of [
          "list",
          "eligible",
          "preview",
          "media",
          "create",
          "delete",
        ] as const)
          it(`rejects ${operation} when ${workshop ? "workshop" : "canvas"} expiry crosses the final destination await`, async () => {
            const destination = await target(),
              { board, versionId, expiresAt } = await source(workshop),
              input = create(board.id, versionId);
            if (operation !== "create") await links.create(owner, destination, input);
            const internals = links as unknown as {
              refreshSource(...args: unknown[]): Promise<void>;
              target(...args: unknown[]): Promise<unknown>;
            };
            const refresh = internals.refreshSource.bind(internals),
              destinationAccess = internals.target.bind(internals);
            let sourceRefreshed = false,
              crossed = false;
            vi.spyOn(internals, "refreshSource").mockImplementation(async (...args) => {
              await refresh(...args);
              sourceRefreshed = true;
            });
            vi.spyOn(internals, "target").mockImplementation(async (...args) => {
              const result = await destinationAccess(...args);
              if (sourceRefreshed) {
                crossed = true;
                vi.setSystemTime(new Date(expiresAt));
              }
              return result;
            });
            vi.spyOn(CanvasBoardRepository.prototype, "authorizeVersionMedia").mockResolvedValue({
              workspaceId,
            });
            vi.useFakeTimers({ toFake: ["Date"] });
            const pending =
              operation === "list"
                ? links.list(owner, destination)
                : operation === "eligible"
                  ? links.eligible(owner, destination)
                  : operation === "preview"
                    ? links.preview(owner, destination, input.linkId)
                    : operation === "media"
                      ? links.authorizeMedia(owner, destination, input.linkId, randomUUID())
                      : operation === "create"
                        ? links.create(owner, destination, input)
                        : links.delete(owner, destination, input.linkId, {
                            schemaVersion: 1,
                            operationId: randomUUID(),
                            expectedRevision: 1,
                          });
            await expect(pending).rejects.toMatchObject({ code: "NOT_FOUND" });
            expect(crossed).toBe(true);
            vi.useRealTimers();
            vi.restoreAllMocks();
            expect((await links.list(owner, destination)).links).toHaveLength(
              operation === "create" ? 0 : 1,
            );
            // Failed writes must not publish a receipt or deletion, and the same intent can succeed.
            if (operation === "create")
              expect((await links.create(owner, destination, input)).receipt.deleted).toBe(false);
          });
      for (const workshop of [false, true])
        for (const operation of [
          "list",
          "eligible",
          "preview",
          "media",
          "create",
          "delete",
        ] as const)
          it(`${operation === "create" || operation === "delete" ? "acknowledges committed" : "withholds expired"} ${operation} when ${workshop ? "workshop" : "canvas"} expires after transaction completion`, async () => {
            const destination = await target(),
              { board, versionId, expiresAt } = await source(workshop),
              input = create(board.id, versionId),
              deletion = {
                schemaVersion: 1 as const,
                operationId: randomUUID(),
                expectedRevision: 1,
              };
            if (operation !== "create") await links.create(owner, destination, input);
            const completed = expireAfterTransaction(expiresAt);
            vi.spyOn(CanvasBoardRepository.prototype, "authorizeVersionMedia").mockResolvedValue({
              workspaceId,
            });
            vi.useFakeTimers({ toFake: ["Date"] });
            const pending =
              operation === "list"
                ? links.list(owner, destination)
                : operation === "eligible"
                  ? links.eligible(owner, destination)
                  : operation === "preview"
                    ? links.preview(owner, destination, input.linkId)
                    : operation === "media"
                      ? links.authorizeMedia(owner, destination, input.linkId, randomUUID())
                      : operation === "create"
                        ? links.create(owner, destination, input)
                        : links.delete(owner, destination, input.linkId, deletion);
            const acknowledgement =
              operation === "create" || operation === "delete" ? await pending : null;
            if (acknowledgement)
              expect(acknowledgement).toMatchObject({
                receipt: { linkId: input.linkId, deleted: operation === "delete" },
              });
            else await expect(pending).rejects.toMatchObject({ code: "NOT_FOUND" });
            expect(completed()).toBe(true);
            vi.useRealTimers();
            vi.restoreAllMocks();
            expect((await links.list(owner, destination)).links).toHaveLength(
              operation === "delete" ? 0 : 1,
            );
            if (operation === "create")
              expect(await links.create(owner, destination, input)).toEqual(acknowledgement);
            if (operation === "delete")
              expect(await links.delete(owner, destination, input.linkId, deletion)).toEqual(
                acknowledgement,
              );
          });
      for (const operation of ["list", "eligible"] as const)
        it(`checks every collected source in ${operation} after the final await`, async () => {
          const destination = await target(),
            earlier = await source(true),
            later = await source();
          await links.create(owner, destination, create(earlier.board.id, earlier.versionId));
          await links.create(owner, destination, create(later.board.id, later.versionId));
          const internals = links as unknown as {
            refreshSource(...args: unknown[]): Promise<void>;
            target(...args: unknown[]): Promise<unknown>;
          };
          const refresh = internals.refreshSource.bind(internals),
            destinationAccess = internals.target.bind(internals);
          const collected = new Set<string>();
          vi.spyOn(internals, "refreshSource").mockImplementation(async (...args) => {
            await refresh(...args);
            collected.add((args[1] as { boardId: string }).boardId);
          });
          vi.spyOn(internals, "target").mockImplementation(async (...args) => {
            const result = await destinationAccess(...args);
            if (collected.size === 2) vi.setSystemTime(new Date(earlier.expiresAt));
            return result;
          });
          vi.useFakeTimers({ toFake: ["Date"] });
          await expect(
            operation === "list"
              ? links.list(owner, destination)
              : links.eligible(owner, destination),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
          expect(collected).toEqual(new Set([earlier.board.id, later.board.id]));
        });
      for (const changed of ["grant", "checkpoint", "link", "source revision"] as const)
        it.skipIf(backend !== "memory")(
          `revalidates current ${changed} after final destination access`,
          async () => {
            if (!(repository instanceof MemoryRepository)) return;
            const memoryRepository = repository;
            const destination = await target(),
              { board, versionId, sourceId } = await source(changed === "source revision"),
              input = create(board.id, versionId);
            await links.create(owner, destination, input);
            const canvasStore = repository.getOrCreateLifecycleExtension("canvasBoards", () => {
              throw new Error("Expected initialized canvas");
            }) as unknown as {
              rows: Map<
                string,
                {
                  grants: Array<{ userId: string; role: string; createdAt: string }>;
                  facilitation: { versions: Array<{ metadata: { id: string } }> };
                }
              >;
            };
            let actor = owner;
            if (changed === "grant") {
              actor = await creator(repository);
              const platform = createPlatformRepository(repository),
                organization = (await platform.getOrganizationForWorkspace(workspaceId))!;
              await platform.setOrganizationMember({
                organizationId: organization.id,
                actorId: owner.userId,
                userId: actor.userId,
                role: "member",
              });
              repository.workspaceMembers.set(`${workspaceId}:${actor.userId}`, {
                workspaceId,
                userId: actor.userId,
                role: "viewer",
                joinedAt: new Date(),
              });
              canvasStore.rows.get(board.id)!.grants.push({
                userId: actor.userId,
                role: "viewer",
                createdAt: new Date().toISOString(),
              });
            }
            const internals = links as unknown as {
              refreshSource(...args: unknown[]): Promise<void>;
              target(...args: unknown[]): Promise<unknown>;
            };
            const refresh = internals.refreshSource.bind(internals),
              destinationAccess = internals.target.bind(internals);
            let refreshed = false;
            vi.spyOn(internals, "refreshSource").mockImplementation(async (...args) => {
              await refresh(...args);
              refreshed = true;
            });
            vi.spyOn(internals, "target").mockImplementation(async (...args) => {
              const result = await destinationAccess(...args);
              if (refreshed) {
                const state = canvasStore.rows.get(board.id)!;
                if (changed === "grant") state.grants = [];
                else if (changed === "checkpoint") state.facilitation.versions = [];
                else if (changed === "link") {
                  const store = memoryRepository.getOrCreateLifecycleExtension(
                    "canvasArtifactLinks",
                    () => {
                      throw new Error("Expected initialized links");
                    },
                  ) as unknown as { links: Map<string, unknown> };
                  store.links.delete(input.linkId);
                } else {
                  const store = memoryRepository.getOrCreateLifecycleExtension("ideaBoards", () => {
                    throw new Error("Expected initialized workshop");
                  }) as unknown as { rows: Map<string, { revision: number }> };
                  store.rows.get(sourceId!)!.revision++;
                }
              }
              return result;
            });
            await expect(links.preview(actor, destination, input.linkId)).rejects.toMatchObject({
              code: "NOT_FOUND",
            });
          },
        );
      it("cascades checkpoint, board and destination removal without retaining scenes or removing source checkpoints", async () => {
        const destination = await target(),
          { board, versionId } = await source(),
          input = create(board.id, versionId);
        await links.create(owner, destination, input);
        const exported = await repository.exportAccount(owner.userId);
        expect(JSON.stringify(exported.canvasArtifactLinks)).toContain(input.linkId);
        expect(JSON.stringify(exported.canvasArtifactLinks)).not.toContain("objects");
        await canvases.facilitate(owner, board.id, {
          schemaVersion: 1,
          operationId: randomUUID(),
          command: { type: "version_delete", versionId, expectedVersion: 1 },
        });
        expect((await links.list(owner, destination)).links).toEqual([]);
        const other = await source(),
          second = create(other.board.id, other.versionId);
        await links.create(owner, destination, second);
        await canvases.delete(owner, other.board.id);
        expect((await links.list(owner, destination)).links).toEqual([]);
        const third = await source();
        for (const kind of ["round", "presentation"] as const) {
          const selected = await target(kind);
          await links.create(owner, selected, create(third.board.id, third.versionId));
          if (kind === "round") {
            await repository.archiveQuiz(workspaceId, selected.id, true);
            expect(await repository.deleteQuiz(workspaceId, selected.id)).toBe("deleted");
          } else {
            const presentations = createPresentationRepository(repository);
            await presentations.archivePresentation(workspaceId, selected.id, true);
            expect(await presentations.deletePresentation(workspaceId, selected.id)).toBe(
              "deleted",
            );
          }
          await expect(links.list(owner, selected)).rejects.toMatchObject({ code: "NOT_FOUND" });
          expect(
            (await canvases.getVersion(owner, third.board.id, third.versionId)).version.id,
          ).toBe(third.versionId);
        }
      });
      it("bounds retained link relationships at20 while allowing deletion and source-version cleanup", async () => {
        const destination = await target(),
          saved: Array<{ boardId: string; versionId: string }> = [];
        for (let index = 0; index < 3; index++) {
          const first = await source();
          saved.push({ boardId: first.board.id, versionId: first.versionId });
          for (let version = 1; version < 10 && saved.length < 21; version++) {
            const versionId = randomUUID();
            await canvases.facilitate(owner, first.board.id, {
              schemaVersion: 1,
              operationId: randomUUID(),
              command: { type: "version_create", versionId, name: `Saved ${version}` },
            });
            saved.push({ boardId: first.board.id, versionId });
          }
        }
        for (const item of saved.slice(0, 20))
          await links.create(owner, destination, create(item.boardId, item.versionId));
        const overflow = saved[20]!;
        await expect(
          links.create(owner, destination, create(overflow.boardId, overflow.versionId)),
        ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
        const all = (await links.list(owner, destination)).links;
        expect(all).toHaveLength(20);
        await links.delete(owner, destination, all[0]!.id, {
          schemaVersion: 1,
          operationId: randomUUID(),
          expectedRevision: 1,
        });
        await links.create(owner, destination, create(overflow.boardId, overflow.versionId));
        expect((await links.list(owner, destination)).links).toHaveLength(20);
      }, 30000);
      it("keeps retired receipt storage bounded and still accepts an exact replay at capacity", async () => {
        const destination = await target(),
          { board, versionId } = await source(),
          input = create(board.id, versionId);
        const accepted = await links.create(owner, destination, input);
        if (repository instanceof MemoryRepository) {
          const store = repository.getOrCreateLifecycleExtension("canvasArtifactLinks", () => {
            throw new Error("Expected initialized link store");
          }) as unknown as { receipts: Array<Record<string, unknown>> };
          const template = store.receipts.find((row) => row.targetId === destination.id)!;
          for (let index = 1; index < 2000; index++)
            store.receipts.push({
              ...template,
              operationId: randomUUID(),
              requestedLinkId: randomUUID(),
            });
        } else {
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              "SELECT set_config('app.workspace_id',$1,true),set_config('app.canvas_artifact_target_kind','round',true),set_config('app.canvas_artifact_target_id',$2,true)",
              [workspaceId, destination.id],
            );
            await client.query(
              "INSERT INTO canvas_artifact_link_receipts(workspace_id,target_kind,target_id,quiz_id,actor_id,operation_id,request_hash,requested_link_id,link_id,deleted) SELECT $1,'round',$2,$2,$3,gen_random_uuid(),repeat('a',64),gen_random_uuid(),$4,false FROM generate_series(1,1999)",
              [workspaceId, destination.id, owner.userId, input.linkId],
            );
            await client.query("COMMIT");
          } finally {
            client.release();
          }
        }
        expect(await links.create(owner, destination, input)).toEqual(accepted);
        await expect(
          links.create(owner, destination, create(board.id, versionId)),
        ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
      }, 30000);
      it.skipIf(backend !== "memory")(
        "reserves unlink receipts when new-link admission reaches its retained operation budget",
        async () => {
          if (!(repository instanceof MemoryRepository)) return;
          const destination = await target(),
            { board, versionId } = await source(),
            input = create(board.id, versionId);
          await links.create(owner, destination, input);
          const store = repository.getOrCreateLifecycleExtension("canvasArtifactLinks", () => {
            throw new Error("Expected initialized links");
          }) as unknown as { receipts: Array<Record<string, unknown>> };
          const template = store.receipts.find((row) => row.targetId === destination.id)!;
          for (let index = 1; index < 1980; index++)
            store.receipts.push({
              ...template,
              operationId: randomUUID(),
              requestedLinkId: randomUUID(),
            });
          await expect(
            links.create(owner, destination, create(board.id, versionId)),
          ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
          await links.delete(owner, destination, input.linkId, {
            schemaVersion: 1,
            operationId: randomUUID(),
            expectedRevision: 1,
          });
          expect((await links.list(owner, destination)).links).toEqual([]);
        },
      );
      it("clears deleted creator attribution without deleting surviving source boards or links", async () => {
        const destination = await target(),
          { board, versionId } = await source(),
          input = create(board.id, versionId);
        await links.create(owner, destination, input);
        const platform = createPlatformRepository(repository),
          successor = await creator(repository);
        const organization = (await platform.getOrganizationForWorkspace(workspaceId))!;
        await platform.setOrganizationMember({
          organizationId: organization.id,
          actorId: owner.userId,
          userId: successor.userId,
          role: "owner",
        });
        await platform.assignOrganizationUserLicense(
          organization.id,
          owner.userId,
          successor.userId,
          false,
        );
        await platform.transferWorkspaceOwnership(workspaceId, owner.userId, successor.userId);
        await repository.deleteUserIdentity(owner.userId);
        expect((await links.list(successor, destination)).links[0]).toMatchObject({
          id: input.linkId,
          createdBy: null,
          canDelete: true,
        });
        expect((await links.preview(successor, destination, input.linkId)).version.id).toBe(
          versionId,
        );
        if (repository instanceof MemoryRepository) {
          const linked = repository.getOrCreateLifecycleExtension("canvasArtifactLinks", () => {
            throw new Error("Expected initialized links");
          }) as unknown as {
            links: Map<string, { createdBy: string | null }>;
            receipts: Array<{ actorId: string | null }>;
          };
          const sourceStore = repository.getOrCreateLifecycleExtension("canvasBoards", () => {
            throw new Error("Expected initialized canvas");
          }) as unknown as { rows: Map<string, unknown> };
          expect(sourceStore.rows.has(board.id)).toBe(true);
          expect(linked.links.get(input.linkId)?.createdBy).toBeNull();
          expect(linked.receipts.every((row) => row.actorId === null)).toBe(true);
        } else {
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.canvas_lifecycle','on',true)");
            expect(
              (await client.query("SELECT id FROM canvas_boards WHERE id=$1", [board.id])).rows,
            ).toHaveLength(1);
            expect(
              (
                await client.query("SELECT created_by FROM canvas_artifact_links WHERE id=$1", [
                  input.linkId,
                ])
              ).rows,
            ).toEqual([{ created_by: null }]);
            expect(
              (
                await client.query(
                  "SELECT actor_id FROM canvas_artifact_link_receipts WHERE target_id=$1",
                  [destination.id],
                )
              ).rows,
            ).toEqual([{ actor_id: null }]);
          } finally {
            await client.query("ROLLBACK");
            client.release();
          }
        }
      });
      it.skipIf(backend !== "memory")(
        "rolls back staged links and retry receipts when source expiry crosses an awaited write",
        async () => {
          if (!(repository instanceof MemoryRepository)) return;
          const destination = await target(),
            { board, versionId } = await source(),
            input = create(board.id, versionId);
          const storage = links as unknown as { saveReceipt(...args: unknown[]): Promise<void> };
          const original = storage.saveReceipt.bind(storage);
          vi.useFakeTimers();
          vi.spyOn(storage, "saveReceipt").mockImplementationOnce(async (...args) => {
            await original(...args);
            vi.setSystemTime(new Date(board.expiresAt));
          });
          await expect(links.create(owner, destination, input)).rejects.toMatchObject({
            code: "NOT_FOUND",
          });
          vi.useRealTimers();
          expect((await links.list(owner, destination)).links).toEqual([]);
          const store = repository.getOrCreateLifecycleExtension("canvasArtifactLinks", () => {
            throw new Error("Expected initialized links");
          }) as unknown as { receipts: unknown[] };
          expect(store.receipts).toEqual([]);
        },
      );
      it("forces target-scoped PostgreSQL RLS and never grants cross-workspace target/source references", async () => {
        if (!(repository instanceof PostgresRepository)) return;
        const destination = await target(),
          { board, versionId } = await source();
        await links.create(owner, destination, create(board.id, versionId));
        for (const table of ["canvas_artifact_links", "canvas_artifact_link_receipts"])
          expect((await repository.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
        const flags = await repository.pool.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",
          [["canvas_artifact_links", "canvas_artifact_link_receipts"]],
        );
        expect(flags.rows).toHaveLength(2);
        expect(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
        const other = await creator(repository);
        await expect(
          links.list(other, { ...destination, workspaceId: other.workspaceId }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const client = await repository.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "SELECT set_config('app.workspace_id',$1,true),set_config('app.canvas_artifact_target_kind','round',true),set_config('app.canvas_artifact_target_id',$2,true)",
            [workspaceId, destination.id],
          );
          await expect(
            client.query(
              "INSERT INTO canvas_artifact_links(id,workspace_id,target_kind,target_id,quiz_id,board_id,version_id,created_at) VALUES($1,$2,'round',$3,NULL,$4,$5,now())",
              [randomUUID(), workspaceId, destination.id, board.id, versionId],
            ),
          ).rejects.toMatchObject({ code: "23514" });
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      });
    },
  );
