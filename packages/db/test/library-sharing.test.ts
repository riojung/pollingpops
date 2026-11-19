import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { QuizContentSchema, type LibraryShareCreate } from "@openround/contracts";
import {
  MemoryRepository,
  PostgresRepository,
  createLibrarySharingRepository,
  createPlatformRepository,
  createPresentationRepository,
  createSurveyRepository,
  assertRestrictedRuntimeDatabasePrincipal,
  type Repository,
  type CreatorContext,
} from "../src/index.js";
import { surveyFixture } from "./support/survey-conformance.js";
import { surveyPagesFixture } from "./support/survey-pages-conformance.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

async function principal(repository: Repository): Promise<CreatorContext> {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `library-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}
async function fixture(repository: Repository, media = false) {
  const owner = await principal(repository),
    recipient = await principal(repository),
    other = await principal(repository),
    outsider = await principal(repository);
  const platform = createPlatformRepository(repository);
  const organization = await platform.createOrganization({
    name: "Shared company",
    actorId: owner.userId,
    accountType: "organization",
    licenseUnit: "workspace",
  });
  for (const user of [recipient, other])
    await platform.setOrganizationMember({
      organizationId: organization.id,
      actorId: owner.userId,
      userId: user.userId,
      role: "member",
    });
  const source = await platform.createOrganizationWorkspace({
    organizationId: organization.id,
    actorId: owner.userId,
    name: "Source team",
    segment: "workplace",
  });
  const destination = await platform.createOrganizationWorkspace({
    organizationId: organization.id,
    actorId: owner.userId,
    name: "Recipient drafts",
    segment: "workplace",
  });
  if (repository instanceof MemoryRepository)
    repository.workspaceMembers.set(`${destination.id}:${recipient.userId}`, {
      workspaceId: destination.id,
      userId: recipient.userId,
      role: "editor",
      joinedAt: new Date(),
    });
  else {
    const client = await (repository as PostgresRepository).pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.system_access','on',true)");
      await client.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor')",
        [destination.id, recipient.userId],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }
  const now = new Date(),
    mediaId = media ? randomUUID() : null;
  if (mediaId)
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId: source.id,
      objectKey: `media/${source.id}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 8,
      scanStatus: "clean",
      altText: "Chart",
      createdAt: now,
    });
  const content = QuizContentSchema.parse({
    title: "Pinned Round",
    description: "Published description",
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
        explanation: "PRIVATE_EXPLANATION",
        mediaId,
        mediaAlt: mediaId ? "Chart" : null,
      },
    ],
  });
  const round = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: source.id,
    title: content.title,
    description: content.description,
    status: "draft",
    draft: content,
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
  const shares = createLibrarySharingRepository(repository);
  const input = (override: Partial<LibraryShareCreate> = {}): LibraryShareCreate => ({
    requestId: randomUUID(),
    artifactType: "round",
    artifactId: round.id,
    versionId: version.id,
    audience: "people",
    recipientIds: [recipient.userId],
    permission: "use",
    message: "Please review",
    dueAt: null,
    ...override,
  });
  return {
    owner,
    recipient,
    other,
    outsider,
    organization,
    source,
    destination,
    now,
    round,
    version,
    content,
    mediaId,
    shares,
    input,
    platform,
  };
}
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
for (const backend of ["memory", "postgres"] as const)
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `organization published library ${backend}`,
    () => {
      const database = `library_sharing_${randomUUID().replaceAll("-", "")}`;
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
          [["library_shares", "library_share_progress", "library_share_copies"]],
        );
        expect(tables.rows).toHaveLength(3);
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
      it("pins published versions, discovers across workspaces, isolates progress and enforces exact retries", async () => {
        const f = await fixture(repository),
          input = f.input();
        const results = await Promise.all([
          f.shares.create({ actorId: f.owner.userId, workspaceId: f.source.id, input, now: f.now }),
          f.shares.create({ actorId: f.owner.userId, workspaceId: f.source.id, input, now: f.now }),
        ]);
        expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
        const share = results[0]!.share;
        expect(await repository.getCreatorByUserId(f.recipient.userId, f.source.id)).toBeNull();
        expect(
          (await f.shares.read({ actorId: f.recipient.userId, id: share.id }))?.snapshot,
        ).toEqual({ artifactType: "round", content: f.content });
        expect(await f.shares.read({ actorId: f.other.userId, id: share.id })).toBeNull();
        expect(await f.shares.read({ actorId: f.outsider.userId, id: share.id })).toBeNull();
        expect(
          (
            await f.shares.list({
              actorId: f.recipient.userId,
              scope: "shared",
              organizationId: f.organization.id,
            })
          ).shares,
        ).toEqual([
          expect.objectContaining({
            id: share.id,
            progress: "new",
            capabilities: { view: true, copy: true, manage: false },
          }),
        ]);
        const serialized = JSON.stringify(
          await f.shares.list({
            actorId: f.recipient.userId,
            scope: "shared",
            organizationId: f.organization.id,
          }),
        );
        expect(serialized).not.toMatch(
          /snapshot|correctValue|PRIVATE_EXPLANATION|recipientIds|intentHash/,
        );
        await f.shares.progress({
          actorId: f.recipient.userId,
          id: share.id,
          status: "done",
          now: new Date(),
        });
        expect((await f.shares.read({ actorId: f.recipient.userId, id: share.id }))?.progress).toBe(
          "done",
        );
        expect((await f.shares.read({ actorId: f.owner.userId, id: share.id }))?.progress).toBe(
          "new",
        );
        expect(
          await f.shares.progress({
            actorId: f.other.userId,
            id: share.id,
            status: "done",
            now: new Date(),
          }),
        ).toBeNull();
        await expect(
          f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: { ...input, message: "Changed" },
            now: f.now,
          }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        expect(
          (
            await f.shares.list({
              actorId: f.recipient.userId,
              scope: "managed",
              organizationId: f.organization.id,
            })
          ).shares,
        ).toEqual([]);
        expect(
          (
            await f.shares.list({
              actorId: f.owner.userId,
              scope: "managed",
              organizationId: f.organization.id,
            })
          ).shares,
        ).toHaveLength(1);
        await expect(
          f.shares.revoke({ actorId: f.recipient.userId, id: share.id, now: new Date() }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
      it("bounds metadata pages and keeps organization visibility separate from personal assignments", async () => {
        const f = await fixture(repository);
        for (let index = 0; index < 3; index++)
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input({ audience: "organization", recipientIds: [] }),
            now: f.now,
          });
        const first = await f.shares.list({
          actorId: f.other.userId,
          scope: "organization",
          organizationId: f.organization.id,
          limit: 2,
        });
        expect(first.shares).toHaveLength(2);
        expect(first.nextCursor).toBeTruthy();
        const second = await f.shares.list({
          actorId: f.other.userId,
          scope: "organization",
          organizationId: f.organization.id,
          limit: 2,
          cursor: first.nextCursor!,
        });
        expect(second.shares).toHaveLength(1);
        expect(second.nextCursor).toBeNull();
        expect(new Set([...first.shares, ...second.shares].map((row) => row.id)).size).toBe(3);
        expect(
          (
            await f.shares.list({
              actorId: f.other.userId,
              scope: "shared",
              organizationId: f.organization.id,
            })
          ).shares,
        ).toEqual([]);
        await expect(
          f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input({ recipientIds: [f.outsider.userId] }),
            now: new Date(),
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      });
      it("searches all authorized metadata before limiting and reports exact actor-specific facets", async () => {
        const f = await fixture(repository);
        const targets = [];
        for (let index = 0; index < 4; index++)
          targets.push(
            (
              await f.shares.create({
                actorId: f.owner.userId,
                workspaceId: f.source.id,
                input: f.input({
                  recipientIds: [f.recipient.userId, f.other.userId],
                  permission: index === 0 ? "view" : "use",
                  message: index < 2 ? "needle%_\\ literal" : "needle-other",
                }),
                now: f.now,
              })
            ).share,
          );
        // A newer page full of nonmatches must not hide the older search results.
        for (let index = 0; index < 52; index++)
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input({ message: "filler" }),
            now: new Date(f.now.getTime() + index + 1),
          });
        await f.shares.progress({
          actorId: f.recipient.userId,
          id: targets[0]!.id,
          status: "done",
          now: f.now,
        });
        await f.shares.progress({
          actorId: f.recipient.userId,
          id: targets[1]!.id,
          status: "in_progress",
          now: f.now,
        });
        await f.shares.progress({
          actorId: f.other.userId,
          id: targets[2]!.id,
          status: "done",
          now: f.now,
        });
        const foreign = await fixture(repository);
        await foreign.shares.create({
          actorId: foreign.owner.userId,
          workspaceId: foreign.source.id,
          input: foreign.input({ message: "needle%_\\ literal" }),
          now: foreign.now,
        });
        const input = {
          actorId: f.recipient.userId,
          organizationId: f.organization.id,
          scope: "shared" as const,
          q: "  NEEDLE  ",
          limit: 2,
        };
        const first = await f.shares.list(input);
        expect(first.shares).toHaveLength(2);
        expect(
          (await f.shares.list({ ...input, organizationId: f.organization.id.toUpperCase() }))
            .facets?.total,
        ).toBe(4);
        expect(first.facets).toEqual({
          kinds: { round: 4, presentation: 0, survey: 0 },
          progress: { new: 2, in_progress: 1, done: 1 },
          permissions: { view: 1, use: 3 },
          total: 4,
        });
        expect(first.nextCursor).toBeTruthy();
        const second = await f.shares.list({ ...input, cursor: first.nextCursor! });
        expect(new Set([...first.shares, ...second.shares].map((row) => row.id))).toEqual(
          new Set(targets.map((row) => row.id)),
        );
        expect(second.nextCursor).toBeNull();
        expect(second.facets).toEqual(first.facets);
        const filtered = await f.shares.list({ ...input, progress: "new", permission: "use" });
        expect(filtered.facets).toEqual({ ...first.facets, total: 2 });
        expect(
          filtered.shares.every((row) => row.progress === "new" && row.permission === "use"),
        ).toBe(true);
        expect((await f.shares.list({ ...input, q: "%_\\" })).facets?.total).toBe(2);
        for (const q of ["Pinned Round", "Published description", "Source team", "Shared company"])
          expect((await f.shares.list({ ...input, q })).facets?.total).toBe(56);
        const other = await f.shares.list({ ...input, actorId: f.other.userId });
        expect(other.facets?.progress).toEqual({ new: 3, in_progress: 0, done: 1 });
        expect((await f.shares.list({ ...input, actorId: f.outsider.userId })).facets?.total).toBe(
          0,
        );
        expect(
          (await f.shares.list({ ...input, organizationId: randomUUID() })).facets?.total,
        ).toBe(0);
        expect((await f.shares.list({ ...input, scope: "managed" })).facets?.total).toBe(0);
        expect((await f.shares.list({ ...input, scope: "organization" })).facets?.total).toBe(0);
        if (repository instanceof MemoryRepository) {
          const read = vi
            .spyOn(repository, "getQuiz")
            .mockRejectedValue(new Error("Draft read forbidden"));
          try {
            expect((await f.shares.list(input)).facets?.total).toBe(4);
          } finally {
            read.mockRestore();
          }
        }
      });
      it("binds strict cursors to actor/query/scope, accepts default legacy cursors and rechecks access between pages", async () => {
        const f = await fixture(repository);
        const targets = [];
        for (let index = 0; index < 4; index++)
          targets.push(
            (
              await f.shares.create({
                actorId: f.owner.userId,
                workspaceId: f.source.id,
                input: f.input({ recipientIds: [f.recipient.userId, f.other.userId] }),
                now: f.now,
              })
            ).share,
          );
        const input = {
          actorId: f.recipient.userId,
          organizationId: f.organization.id,
          scope: "shared" as const,
          limit: 1,
        };
        const first = await f.shares.list(input);
        for (const change of [
          { actorId: f.other.userId },
          { organizationId: randomUUID() },
          { scope: "organization" as const },
          { q: "Pinned" },
          { kind: "round" as const },
          { progress: "new" as const },
          { permission: "use" as const },
          { sort: "title_asc" as const },
        ])
          await expect(
            f.shares.list({ ...input, ...change, cursor: first.nextCursor! }),
          ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        const decoded = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString());
        for (const malformed of [
          "!bad",
          Buffer.from("null").toString("base64url"),
          { ...decoded, extra: true },
          { ...decoded, position: { ...decoded.position, sharedAt: "nonsense" } },
          { ...decoded, position: { ...decoded.position, sharedAt: 1 } },
          { ...decoded, position: { ...decoded.position, sharedAt: "0000-01-01T00:00:00.000Z" } },
          { ...decoded, position: { ...decoded.position, title: "invalid\0text" } },
          { ...decoded, position: { ...decoded.position, title: 2 } },
        ]) {
          const cursor =
            typeof malformed === "string"
              ? malformed
              : Buffer.from(JSON.stringify(malformed)).toString("base64url");
          await expect(f.shares.list({ ...input, cursor })).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
          });
        }
        const legacy = Buffer.from(
          JSON.stringify({ id: first.shares[0]!.id, sharedAt: first.shares[0]!.sharedAt }),
        ).toString("base64url");
        expect((await f.shares.list({ ...input, cursor: legacy })).shares).toHaveLength(1);
        await expect(
          f.shares.list({ ...input, q: "Pinned", cursor: legacy }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        await f.shares.revoke({ actorId: f.owner.userId, id: first.shares[0]!.id, now: f.now });
        expect((await f.shares.list({ ...input, cursor: first.nextCursor! })).facets?.total).toBe(
          3,
        );
        await f.platform.removeOrganizationMember(
          f.organization.id,
          f.owner.userId,
          f.recipient.userId,
        );
        const denied = await f.shares.list({ ...input, cursor: first.nextCursor! });
        expect(denied.shares).toEqual([]);
        expect(denied.facets).toEqual({
          kinds: { round: 0, presentation: 0, survey: 0 },
          progress: { new: 0, in_progress: 0, done: 0 },
          permissions: { view: 0, use: 0 },
          total: 0,
        });
        const otherInput = { ...input, actorId: f.other.userId };
        const otherFirst = await f.shares.list(otherInput);
        // A removed source must disappear from every count even with an earlier page cursor.
        await repository.archiveQuiz(f.source.id, f.round.id, true);
        expect((await f.shares.list({ ...input, actorId: f.other.userId })).facets?.total).toBe(0);
        await repository.deleteQuiz(f.source.id, f.round.id);
        expect(
          (await f.shares.list({ ...otherInput, cursor: otherFirst.nextCursor! })).facets?.total,
        ).toBe(0);
      });
      it("rechecks source workspace management membership and uses metadata discovery with one connection", async () => {
        const f = await fixture(repository);
        for (let index = 0; index < 3; index++)
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input(),
            now: f.now,
          });
        if (repository instanceof MemoryRepository)
          repository.workspaceMembers.set(`${f.source.id}:${f.other.userId}`, {
            workspaceId: f.source.id,
            userId: f.other.userId,
            role: "editor",
            joinedAt: f.now,
          });
        else
          await administrator!.pool.query(
            "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor')",
            [f.source.id, f.other.userId],
          );
        const input = {
          actorId: f.other.userId,
          scope: "managed" as const,
          organizationId: f.organization.id,
          limit: 1,
        };
        let first;
        if (repository instanceof PostgresRepository) {
          // A nested repository/pool lookup would deadlock with this connection bound.
          const isolatedRuntime = new URL(runtimeUrl!);
          isolatedRuntime.pathname = `/${database}`;
          const runtime = new PostgresRepository(isolatedRuntime.toString());
          runtime.pool.options.max = 1;
          const discovery = createLibrarySharingRepository(runtime);
          const client = await runtime.pool.connect();
          const query = vi.spyOn(client, "query");
          client.release();
          try {
            first = await discovery.list(input);
            const statements = query.mock.calls
              .map(([statement]) => (typeof statement === "string" ? statement : ""))
              .join("\n");
            expect(statements).toContain("WITH authorized AS MATERIALIZED");
            // Only the version discriminator may be extracted; never discover snapshot bodies.
            expect(statements).toContain("share.snapshot->'content'->>'schemaVersion'");
            expect(
              statements.replaceAll("share.snapshot->'content'->>'schemaVersion'", ""),
            ).not.toMatch(/share\.snapshot|version\.content|parent\.draft|media_assets/);
            expect(statements).not.toContain("SELECT status FROM library_share_progress");
          } finally {
            query.mockRestore();
            await runtime.close();
          }
        } else first = await f.shares.list(input);
        expect(first.facets?.total).toBe(3);
        expect(first.shares[0]?.capabilities.manage).toBe(true);
        await repository.removeWorkspaceMember(f.source.id, f.other.userId);
        const removed = await f.shares.list({ ...input, cursor: first.nextCursor! });
        expect(removed.shares).toEqual([]);
        expect(removed.facets?.total).toBe(0);
      });
      it("normalizes Unicode titles and search canonically across every pagination order", async () => {
        const f = await fixture(repository);
        const titles = [
          { title: "ÉCOLE", key: "école" },
          { title: "école", key: "école" },
          { title: "ÉCOLE", key: "école" },
          // Lowercasing can create a decomposed sequence even after initial NFC.
          { title: "J\u030c workshop", key: "ǰ workshop" },
          { title: "ǰ workshop", key: "ǰ workshop" },
          { title: "İstanbul", key: "i̇stanbul" },
          { title: "i̇stanbul", key: "i̇stanbul" },
          { title: "ΟΣ", key: "ος" },
          { title: "ος", key: "ος" },
          { title: "alpha", key: "alpha" },
          { title: "Zulu", key: "zulu" },
        ];
        const entries = [];
        for (const { title, key } of titles) {
          const content = { ...f.content, title };
          const round = await repository.createQuiz({
            id: randomUUID(),
            workspaceId: f.source.id,
            title,
            description: content.description,
            status: "draft",
            draft: content,
            currentVersionId: null,
            createdAt: f.now,
            updatedAt: f.now,
          });
          const version = await repository.publishQuiz({
            id: randomUUID(),
            workspaceId: f.source.id,
            quizId: round.id,
            version: 1,
            content,
            contentHash: randomUUID(),
            publishedAt: f.now,
          });
          entries.push({
            ...(
              await f.shares.create({
                actorId: f.owner.userId,
                workspaceId: f.source.id,
                input: f.input({ artifactId: round.id, versionId: version.id }),
                now: new Date(f.now.getTime() + entries.length),
              })
            ).share,
            key,
          });
        }
        const input = {
          actorId: f.recipient.userId,
          scope: "shared" as const,
          organizationId: f.organization.id,
          limit: 1,
        };
        for (const sort of ["recent", "title_asc", "title_desc"] as const) {
          const ids: string[] = [];
          let cursor: string | undefined;
          do {
            const page = await f.shares.list({ ...input, sort, cursor });
            expect(page.shares).toHaveLength(1);
            ids.push(...page.shares.map((row) => row.id));
            expect(ids.length).toBeLessThanOrEqual(entries.length);
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          const expected = [...entries].sort(
            (a, b) =>
              (sort === "recent"
                ? Date.parse(b.sharedAt) - Date.parse(a.sharedAt)
                : Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)) *
                  (sort === "title_asc" ? 1 : -1)) || b.id.localeCompare(a.id),
          );
          expect(ids).toEqual(expected.map((row) => row.id));
          expect(new Set(ids).size).toBe(entries.length);
        }
        expect((await f.shares.list({ ...input, q: "ÉCOLE" })).facets?.total).toBe(3);
        expect((await f.shares.list({ ...input, q: "ÉCOLE" })).facets?.total).toBe(3);
        expect((await f.shares.list({ ...input, q: "İstanbul" })).facets?.total).toBe(2);
        expect((await f.shares.list({ ...input, q: "ΟΣ" })).facets?.total).toBe(2);
        const workshopIds = entries
          .filter((row) => row.key === "ǰ workshop")
          .sort((a, b) => b.id.localeCompare(a.id))
          .map((row) => row.id);
        for (const q of ["J\u030c workshop", "ǰ workshop"]) {
          const page = await f.shares.list({ ...input, q, sort: "title_asc", limit: 100 });
          expect(page.shares.map((row) => row.id)).toEqual(workshopIds);
          expect(page.facets?.total).toBe(2);
        }
        const first = await f.shares.list({ ...input, q: "J\u030c workshop", sort: "title_asc" });
        const second = await f.shares.list({
          ...input,
          q: "ǰ workshop",
          sort: "title_asc",
          cursor: first.nextCursor!,
        });
        expect([...first.shares, ...second.shares].map((row) => row.id)).toEqual(workshopIds);
        expect(second.nextCursor).toBeNull();
      });
      it("copies independent media, draft and history in one authorized receipt transaction", async () => {
        const f = await fixture(repository, true);
        const { share } = await f.shares.create({
          actorId: f.owner.userId,
          workspaceId: f.source.id,
          input: f.input(),
          now: new Date(),
        });
        const newId = randomUUID(),
          copySnapshot = { artifactType: "round" as const, content: structuredClone(f.content) };
        copySnapshot.content.questions[0]!.mediaId = newId;
        const original = (await repository.getMediaAsset(f.source.id, f.mediaId!))!;
        const prepared = {
          snapshot: copySnapshot,
          mediaAssets: [
            {
              id: newId,
              workspaceId: f.destination.id,
              objectKey: `media/${f.destination.id}/${newId}.png`,
              mimeType: "image/png" as const,
              sizeBytes: 8,
              scanStatus: "clean" as const,
              altText: "Copied chart",
              createdAt: new Date(),
            },
          ],
          sourceMedia: [
            {
              id: original.id,
              objectKey: original.objectKey,
              mimeType: original.mimeType,
              sizeBytes: original.sizeBytes,
            },
          ],
        };
        const input = {
          actorId: f.recipient.userId,
          id: share.id,
          destinationWorkspaceId: f.destination.id,
          requestId: randomUUID(),
          expectedVersionId: share.versionId,
          now: new Date(),
        };
        const copied = await f.shares.copy(input, async () => prepared);
        expect(copied.replayed).toBe(false);
        const draft = await repository.getQuiz(f.destination.id, copied.artifactId);
        expect(draft).toMatchObject({
          status: "draft",
          currentVersionId: null,
          folderId: null,
          draft: { questions: [{ mediaId: newId }] },
        });
        expect(await repository.getMediaAsset(f.destination.id, newId)).toMatchObject({
          scanStatus: "clean",
          objectKey: prepared.mediaAssets[0]!.objectKey,
        });
        expect(
          await f.shares.copy(input, async () => {
            throw new Error("Replay must not materialize twice");
          }),
        ).toEqual({ ...copied, replayed: true });
        if (administrator) {
          const references = await administrator.pool.query(
            "SELECT owner_type FROM media_references WHERE workspace_id=$1 AND media_id=$2 ORDER BY owner_type",
            [f.destination.id, newId],
          );
          expect(references.rows).toEqual([
            { owner_type: "quiz_draft" },
            { owner_type: "quiz_history" },
          ]);
        } else {
          expect(
            [...(repository as MemoryRepository).mediaReferences.values()]
              .filter((row) => row.workspaceId === f.destination.id && row.mediaId === newId)
              .map((row) => row.ownerType)
              .sort(),
          ).toEqual(["quiz_draft", "quiz_history"]);
        }
        const exported = await repository.exportAccount(f.recipient.userId);
        expect(exported.libraryShareProgress).toEqual([]);
        expect(exported.libraryShareCopies).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ shareId: share.id, artifactId: copied.artifactId }),
          ]),
        );
        const ownerExport = await repository.exportAccount(f.owner.userId);
        expect(ownerExport.libraryShares).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: share.id })]),
        );
        expect(JSON.stringify(ownerExport.libraryShares)).not.toMatch(
          /snapshot|intentHash|recipientIds|PRIVATE_EXPLANATION/,
        );
        await f.shares.revoke({ actorId: f.owner.userId, id: share.id, now: new Date() });
        expect(await f.shares.read({ actorId: f.recipient.userId, id: share.id })).toBeNull();
        await expect(
          f.shares.copy({ ...input, requestId: randomUUID() }, async () => prepared),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await repository.getQuiz(f.destination.id, copied.artifactId)).not.toBeNull();
      });
      it("reads pinned Survey pages but gates new copies after exact receipt recovery", async () => {
        const f = await fixture(repository);
        const surveys = createSurveyRepository(repository),
          draft = surveyPagesFixture(),
          policy = { maximumSchemaVersion: 3 as const };
        const source = await surveys.create(f.source.id, randomUUID(), draft, randomUUID(), policy);
        const published = await surveys.publish(
          f.source.id,
          source.id,
          0,
          randomUUID(),
          null,
          policy,
        );
        const { share } = await f.shares.create({
          actorId: f.owner.userId,
          workspaceId: f.source.id,
          input: f.input({
            artifactType: "survey",
            artifactId: source.id,
            versionId: published.versionId!,
          }),
          now: new Date(),
        });
        const input = {
          actorId: f.recipient.userId,
          id: share.id,
          destinationWorkspaceId: f.destination.id,
          requestId: randomUUID(),
          now: new Date(),
        };
        const materialize = vi.fn(async () => ({ snapshot: share.snapshot, mediaAssets: [] }));
        expect(
          (await f.shares.read({ actorId: f.recipient.userId, id: share.id }))?.capabilities.copy,
        ).toBe(false);
        const listed = await f.shares.list({
          actorId: f.recipient.userId,
          organizationId: f.organization.id,
          scope: "shared",
        });
        expect(listed.shares.find((entry) => entry.id === share.id)).toMatchObject({
          surveySchemaVersion: 3,
          capabilities: { copy: false },
          copyUnavailableReason: "Creating paged Survey copies is not enabled yet",
        });
        await expect(f.shares.copy(input, materialize)).rejects.toMatchObject({
          code: "SURVEY_PAGES_NOT_ENABLED",
        });
        expect(materialize).not.toHaveBeenCalled();
        const copied = await f.shares.copy(
          { ...input, maximumSurveySchemaVersion: 3 },
          materialize,
        );
        expect((await surveys.get(f.destination.id, copied.artifactId))?.draft).toEqual(draft);
        expect(
          await f.shares.copy(input, async () => {
            throw new Error("Replay must not materialize");
          }),
        ).toEqual({ ...copied, replayed: true });
        await expect(
          f.shares.copy({ ...input, requestId: randomUUID() }, materialize),
        ).rejects.toMatchObject({ code: "SURVEY_PAGES_NOT_ENABLED" });
      });
      it("does not restore direct assignments when a removed member rejoins, while org posts remain discoverable", async () => {
        const f = await fixture(repository);
        const direct = (
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input(),
            now: new Date(),
          })
        ).share;
        const company = (
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input({ audience: "organization", recipientIds: [] }),
            now: new Date(),
          })
        ).share;
        await f.shares.progress({
          actorId: f.recipient.userId,
          id: direct.id,
          status: "in_progress",
          now: new Date(),
        });
        await f.platform.removeOrganizationMember(
          f.organization.id,
          f.owner.userId,
          f.recipient.userId,
        );
        expect(await f.shares.read({ actorId: f.recipient.userId, id: direct.id })).toBeNull();
        await f.platform.setOrganizationMember({
          organizationId: f.organization.id,
          actorId: f.owner.userId,
          userId: f.recipient.userId,
          role: "member",
        });
        expect(await f.shares.read({ actorId: f.recipient.userId, id: direct.id })).toBeNull();
        expect(await f.shares.read({ actorId: f.recipient.userId, id: company.id })).not.toBeNull();
      });
      it("rejects changed source images and view-only copies without creating destination records", async () => {
        const f = await fixture(repository, true);
        const share = (
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input(),
            now: new Date(),
          })
        ).share;
        const before = (await repository.listQuizzes(f.destination.id)).length;
        const id = randomUUID(),
          snapshot = { artifactType: "round" as const, content: structuredClone(f.content) };
        snapshot.content.questions[0]!.mediaId = id;
        await expect(
          f.shares.copy(
            {
              actorId: f.recipient.userId,
              id: share.id,
              destinationWorkspaceId: f.destination.id,
              requestId: randomUUID(),
              now: new Date(),
            },
            async () => ({
              snapshot,
              mediaAssets: [
                {
                  id,
                  workspaceId: f.destination.id,
                  objectKey: `media/${f.destination.id}/${id}.png`,
                  mimeType: "image/png",
                  sizeBytes: 8,
                  scanStatus: "clean",
                  altText: "Chart",
                  createdAt: new Date(),
                },
              ],
              sourceMedia: [
                {
                  id: f.mediaId!,
                  objectKey: "media/changed-source.png",
                  mimeType: "image/png",
                  sizeBytes: 8,
                },
              ],
            }),
          ),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(await repository.getMediaAsset(f.destination.id, id)).toBeNull();
        expect(await repository.listQuizzes(f.destination.id)).toHaveLength(before);
        const view = (
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input({ permission: "view" }),
            now: new Date(),
          })
        ).share;
        await expect(
          f.shares.copy(
            {
              actorId: f.recipient.userId,
              id: view.id,
              destinationWorkspaceId: f.destination.id,
              requestId: randomUUID(),
              now: new Date(),
            },
            async () => {
              throw new Error("No materialization allowed");
            },
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
      it("serializes copy against revocation and organization membership removal", async () => {
        for (const action of ["revoke", "remove"] as const) {
          const f = await fixture(repository);
          const share = (
            await f.shares.create({
              actorId: f.owner.userId,
              workspaceId: f.source.id,
              input: f.input(),
              now: new Date(),
            })
          ).share;
          const copying = f.shares.copy(
            {
              actorId: f.recipient.userId,
              id: share.id,
              destinationWorkspaceId: f.destination.id,
              requestId: randomUUID(),
              now: new Date(),
            },
            async () => ({ snapshot: share.snapshot, mediaAssets: [] }),
          );
          const removing =
            action === "revoke"
              ? f.shares.revoke({ actorId: f.owner.userId, id: share.id, now: new Date() })
              : f.platform.removeOrganizationMember(
                  f.organization.id,
                  f.owner.userId,
                  f.recipient.userId,
                );
          const [copy, removal] = await Promise.allSettled([copying, removing]);
          expect(removal.status).toBe("fulfilled");
          expect(await f.shares.read({ actorId: f.recipient.userId, id: share.id })).toBeNull();
          if (copy.status === "fulfilled")
            expect(
              await repository.getQuiz(f.destination.id, copy.value.artifactId),
            ).not.toBeNull();
          else
            expect(copy.reason).toMatchObject({
              code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
            });
        }
      });
      it("rechecks creator seats after prepared content was authorized", async () => {
        const owner = await principal(repository),
          recipient = await principal(repository),
          platform = createPlatformRepository(repository);
        const org = await platform.createOrganization({
          actorId: owner.userId,
          name: "Seat company",
          accountType: "organization",
          licenseUnit: "user",
        });
        await platform.applySubscriptionSnapshot({
          organizationId: org.id,
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
        await platform.setOrganizationMember({
          organizationId: org.id,
          actorId: owner.userId,
          userId: recipient.userId,
          role: "member",
        });
        const assignments = (await platform.getOrganizationUserLicenses(org.id, owner.userId))
          .assignments;
        const source = assignments.find((row) => row.userId === owner.userId)!.workspaceId,
          destination = assignments.find((row) => row.userId === recipient.userId)!.workspaceId;
        const content = QuizContentSchema.parse({
          title: "Seat Round",
          description: "",
          questions: [
            {
              id: randomUUID(),
              type: "numeric",
              prompt: "How many?",
              correctValue: "1",
              tolerance: "0",
              unit: null,
              timeLimitSeconds: 30,
              basePoints: 1000,
              explanation: "",
              mediaId: null,
              mediaAlt: null,
            },
          ],
        });
        const id = randomUUID(),
          versionId = randomUUID(),
          now = new Date();
        await repository.createQuiz({
          id,
          workspaceId: source,
          title: content.title,
          description: "",
          status: "draft",
          draft: content,
          currentVersionId: null,
          createdAt: now,
          updatedAt: now,
        });
        await repository.publishQuiz({
          id: versionId,
          workspaceId: source,
          quizId: id,
          version: 1,
          content,
          contentHash: randomUUID(),
          publishedAt: now,
        });
        const shares = createLibrarySharingRepository(repository),
          share = (
            await shares.create({
              actorId: owner.userId,
              workspaceId: source,
              input: {
                requestId: randomUUID(),
                artifactType: "round",
                artifactId: id,
                versionId,
                audience: "people",
                recipientIds: [recipient.userId],
                permission: "use",
                message: "",
                dueAt: null,
              },
              now: new Date(),
            })
          ).share;
        expect(await shares.read({ actorId: recipient.userId, id: share.id })).not.toBeNull();
        await platform.assignOrganizationUserLicense(org.id, owner.userId, recipient.userId, false);
        expect(await shares.read({ actorId: recipient.userId, id: share.id })).not.toBeNull();
        await expect(
          shares.copy(
            {
              actorId: recipient.userId,
              id: share.id,
              destinationWorkspaceId: destination,
              requestId: randomUUID(),
              now: new Date(),
            },
            async () => ({ snapshot: share.snapshot, mediaAssets: [] }),
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
      it("pins all three artifact kinds and source deletion removes catalog access", async () => {
        const f = await fixture(repository),
          presentations = createPresentationRepository(repository),
          surveys = createSurveyRepository(repository);
        const content = {
          schemaVersion: 2 as const,
          title: "Published presentation",
          description: "",
          experiencePreset: { id: "focus" as const, version: 1 as const },
          blocks: [
            { id: randomUUID(), kind: "question" as const, question: f.content.questions[0]! },
          ],
        };
        const presentation = await presentations.createPresentation({
          id: randomUUID(),
          workspaceId: f.source.id,
          title: content.title,
          description: "",
          status: "draft",
          draft: content,
          draftRevision: 0,
          draftSchemaVersion: 2,
          currentVersionId: null,
          folderId: null,
          publishedDraftRevision: null,
          lastEditedBy: f.owner.userId,
          createdAt: f.now,
          updatedAt: f.now,
        });
        const published = await presentations.publishPresentation(
          {
            id: randomUUID(),
            workspaceId: f.source.id,
            presentationId: presentation.id,
            version: 1,
            content,
            contentHash: randomUUID(),
            sourceDraftRevision: 0,
            publishedAt: f.now,
          },
          0,
        );
        const deck = (
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input({
              artifactType: "presentation",
              artifactId: presentation.id,
              versionId: published.id,
            }),
            now: new Date(),
          })
        ).share;
        const survey = await surveys.create(
          f.source.id,
          randomUUID(),
          surveyFixture(),
          randomUUID(),
        );
        const surveyPublished = await surveys.publish(
          f.source.id,
          survey.id,
          0,
          randomUUID(),
          null,
        );
        const poll = (
          await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input({
              artifactType: "survey",
              artifactId: survey.id,
              versionId: surveyPublished.versionId!,
            }),
            now: new Date(),
          })
        ).share;
        expect(
          (await f.shares.read({ actorId: f.recipient.userId, id: deck.id }))?.snapshot
            .artifactType,
        ).toBe("presentation");
        expect(
          (await f.shares.read({ actorId: f.recipient.userId, id: poll.id }))?.snapshot
            .artifactType,
        ).toBe("survey");
        const query = {
          actorId: f.recipient.userId,
          scope: "shared" as const,
          organizationId: f.organization.id,
        };
        expect((await f.shares.list(query)).facets?.kinds).toEqual({
          round: 0,
          presentation: 1,
          survey: 1,
        });
        expect(
          (await f.shares.list({ ...query, kind: "presentation", limit: 1 })).shares.map(
            (row) => row.id,
          ),
        ).toEqual([deck.id]);
        expect(
          (await f.shares.list({ ...query, kind: "survey", limit: 1 })).shares.map((row) => row.id),
        ).toEqual([poll.id]);
        for (const share of [deck, poll]) {
          const copied = await f.shares.copy(
            {
              actorId: f.recipient.userId,
              id: share.id,
              destinationWorkspaceId: f.destination.id,
              requestId: randomUUID(),
              now: new Date(),
            },
            async () => ({ snapshot: share.snapshot, mediaAssets: [] }),
          );
          expect(copied.artifactType).toBe(share.artifactType);
        }
        await presentations.archivePresentation(f.source.id, presentation.id, true);
        expect(await presentations.deletePresentation(f.source.id, presentation.id)).toBe(
          "deleted",
        );
        expect(await f.shares.read({ actorId: f.recipient.userId, id: deck.id })).toBeNull();
        if (administrator)
          expect(
            (await administrator.pool.query("SELECT id FROM library_shares WHERE id=$1", [deck.id]))
              .rows,
          ).toEqual([]);
      });
      it.skipIf(backend !== "postgres")(
        "enforces actor RLS independently of selected workspace and retains company posts after publisher deletion",
        async () => {
          const f = await fixture(repository);
          const { share } = await f.shares.create({
            actorId: f.owner.userId,
            workspaceId: f.source.id,
            input: f.input(),
            now: new Date(),
          });
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.source.id]);
            expect(
              (await client.query("SELECT id FROM library_shares WHERE id=$1", [share.id])).rows,
            ).toEqual([]);
            await client.query("SELECT set_config('app.library_user_id',$1,true)", [
              f.outsider.userId,
            ]);
            expect(
              (await client.query("SELECT id FROM library_shares WHERE id=$1", [share.id])).rows,
            ).toEqual([]);
            await client.query("SELECT set_config('app.library_user_id',$1,true)", [
              f.recipient.userId,
            ]);
            expect(
              (await client.query("SELECT id FROM library_shares WHERE id=$1", [share.id])).rows,
            ).toEqual([{ id: share.id }]);
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
          await administrator!.pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
            f.owner.userId,
          ]);
          expect(
            (await f.shares.read({ actorId: f.recipient.userId, id: share.id }))?.createdBy,
          ).toBeNull();
        },
      );
    },
  );
