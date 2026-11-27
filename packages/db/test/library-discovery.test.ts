import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LibraryItemsQuerySchema,
  LibraryItemsResponseSchema,
  type LibraryArtifactKind,
} from "@openround/contracts";
import {
  createLibraryDiscoveryRepository,
  createLibraryMetadataRepository,
  createPlatformRepository,
  createPresentationRepository,
  createSurveyRepository,
  LibraryDiscoveryAuthorizationError,
  LibraryDiscoveryCursorError,
  MemoryRepository,
  PostgresRepository,
  type CreatorContext,
  type LibraryDiscoveryRepository,
  type LibraryMetadataRepository,
  type PresentationRepository,
  type Repository,
  type SurveyRepository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import { surveyFixture } from "./support/survey-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const instant = new Date("2026-11-17T12:00:00.000Z");
const allowedKinds = ["round", "presentation", "survey"] as const;

async function creator(repository: Repository): Promise<CreatorContext> {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `library-${randomUUID()}@example.test`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

for (const backend of ["memory", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `Library discovery ${backend} conformance`,
    () => {
      let repository: Repository;
      let discovery: LibraryDiscoveryRepository;
      let presentations: PresentationRepository;
      let surveys: SurveyRepository;
      let metadata: LibraryMetadataRepository;
      let owner: CreatorContext;
      const databaseName = `library_discovery_${randomUUID().replaceAll("-", "")}`;
      let isolatedRuntimeUrl: string;
      beforeAll(async () => {
        if (backend !== "postgres") return;
        await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
        } finally {
          await cluster.close();
        }
        const administrator = new URL(adminUrl!);
        administrator.pathname = `/${databaseName}`;
        const runtime = new URL(runtimeUrl!);
        runtime.pathname = `/${databaseName}`;
        isolatedRuntimeUrl = runtime.toString();
        const admin = new PostgresRepository(administrator.toString());
        try {
          await admin.migrate();
          await admin.migrate();
        } finally {
          await admin.close();
        }
      });
      afterAll(async () => {
        if (backend !== "postgres") return;
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        } finally {
          await cluster.close();
        }
      });
      beforeEach(async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(instant);
        repository =
          backend === "memory"
            ? new MemoryRepository()
            : new PostgresRepository(isolatedRuntimeUrl);
        await repository.initialize();
        owner = await creator(repository);
        presentations = createPresentationRepository(repository);
        surveys = createSurveyRepository(repository);
        metadata = createLibraryMetadataRepository(repository);
        discovery = createLibraryDiscoveryRepository({
          repository,
          presentations,
          surveys,
          libraryMetadata: metadata,
        });
      });
      afterEach(async () => {
        vi.useRealTimers();
        await repository?.close();
      });

      function list(
        query: Record<string, unknown> = {},
        context: Partial<{
          userId: string;
          workspaceId: string;
          allowedKinds: readonly LibraryArtifactKind[];
        }> = {},
      ) {
        return discovery.list({
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          allowedKinds,
          ...context,
          query: LibraryItemsQuerySchema.parse(query),
        });
      }
      async function join(user: CreatorContext) {
        const tokenHash = randomUUID();
        await repository.createWorkspaceInvitation({
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          email: user.email,
          role: "viewer",
          tokenHash,
          invitedBy: owner.userId,
          expiresAt: new Date(instant.getTime() + 60_000),
          acceptedAt: null,
          revokedAt: null,
          createdAt: instant,
        });
        expect(
          await repository.acceptWorkspaceInvitation(tokenHash, instant, "test"),
        ).not.toBeNull();
      }
      async function add(
        kind: LibraryArtifactKind,
        options: {
          id?: string;
          title?: string;
          description?: string;
          status?: "draft" | "published" | "archived";
          workspaceId?: string;
          updatedAt?: Date;
          folderId?: string | null;
          withContent?: boolean;
        } = {},
      ) {
        const id = options.id ?? randomUUID();
        const title = options.title ?? "Same title";
        const description =
          options.description ?? "Private content remains in the authoring record";
        const workspaceId = options.workspaceId ?? owner.workspaceId;
        const now = options.updatedAt ?? instant;
        const questions = options.withContent
          ? surveyFixture().items.map((item) => item.question)
          : [];
        if (kind === "round")
          await repository.createQuiz({
            id,
            workspaceId,
            title,
            description,
            status: options.status ?? "draft",
            draft: { title, description, questions },
            currentVersionId: null,
            folderId: options.folderId ?? null,
            createdAt: now,
            updatedAt: now,
          });
        if (kind === "presentation")
          await presentations.createPresentation({
            id,
            workspaceId,
            title,
            description,
            status: options.status ?? "draft",
            draft: {
              schemaVersion: 2,
              title,
              description,
              experiencePreset: { id: "focus", version: 1 },
              blocks: questions.map((question) => ({
                id: randomUUID(),
                kind: "question" as const,
                question,
              })),
            },
            draftRevision: 0,
            draftSchemaVersion: 2,
            currentVersionId: null,
            folderId: options.folderId ?? null,
            publishedDraftRevision: null,
            lastEditedBy: null,
            createdAt: now,
            updatedAt: now,
          });
        if (kind === "survey") {
          await surveys.create(
            workspaceId,
            id,
            {
              schemaVersion: 2,
              title,
              description,
              category: "general",
              experiencePreset: { id: "focus", version: 1 },
              items: questions.map((question) => ({ required: false, question })),
            },
            randomUUID(),
          );
          if (options.status === "archived")
            await surveys.archive(workspaceId, id, 0, randomUUID());
        }
        return id;
      }

      it("pages every kind deterministically with duplicate IDs and tied timestamps/titles, metadata only", async () => {
        const duplicateId = randomUUID();
        for (const kind of allowedKinds) await add(kind, { id: duplicateId, withContent: true });
        for (const sort of ["recent", "title_asc", "title_desc"] as const) {
          const found = [];
          let cursor: string | undefined;
          do {
            const result = await list({ limit: 1, sort, ...(cursor ? { cursor } : {}) });
            expect(LibraryItemsResponseSchema.safeParse(result).success).toBe(true);
            expect(result.facets).toEqual({
              kinds: { round: 1, presentation: 1, survey: 1 },
              statuses: { draft: 3, published: 0, archived: 0 },
              total: 3,
            });
            found.push(...result.items);
            cursor = result.nextCursor ?? undefined;
          } while (cursor);
          expect(found.map((item) => item.artifactType)).toEqual([
            "presentation",
            "round",
            "survey",
          ]);
          for (const item of found) {
            expect(item.itemCount).toBe(2);
            expect(JSON.stringify(item)).not.toContain("What would help next?");
            expect(JSON.stringify(item)).not.toContain("Not useful");
            expect(Object.keys(item).sort()).toEqual([
              "artifactType",
              "currentVersionId",
              "description",
              "favorite",
              "folderId",
              "id",
              "itemCount",
              "status",
              "title",
              "updatedAt",
            ]);
          }
        }
      });

      it("searches the complete workspace with literal wildcards and Unicode normalized case", async () => {
        for (let index = 0; index < 36; index++) await add("round", { title: `Ordinary ${index}` });
        const target = await add("survey", { title: "ÉCOLE ΟΣ İ", description: "Needle 100%_!" });
        await add("presentation", { title: "Other", description: "Needle 100abcZ!" });
        for (const q of ["100%_!", "e\u0301cole", "ος", "i\u0307"]) {
          const result = await list({ q, limit: 1 });
          expect(result.items.map((item) => item.id)).toEqual([target]);
          expect(result.facets.total).toBe(1);
          expect(result.nextCursor).toBeNull();
        }
      });

      it("orders Unicode titles consistently across keyset pages in both directions", async () => {
        const titles = ["Éclair", "e\u0301CLAIR", "ΟΣ", "İ", "i\u0307", "Alpha", "💠"];
        const records = [];
        for (const title of titles) records.push({ title, id: await add("round", { title }) });
        for (const sort of ["title_asc", "title_desc"] as const) {
          const expected = [...records].sort((left, right) => {
            const primary = Buffer.compare(
              Buffer.from(left.title.normalize("NFC").toLowerCase().normalize("NFC")),
              Buffer.from(right.title.normalize("NFC").toLowerCase().normalize("NFC")),
            );
            return (
              (sort === "title_asc" ? primary : -primary) ||
              Buffer.compare(Buffer.from(left.id), Buffer.from(right.id))
            );
          });
          const found = [];
          let cursor: string | undefined;
          do {
            const page = await list({ limit: 2, sort, ...(cursor ? { cursor } : {}) });
            found.push(...page.items.map((item) => item.id));
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          expect(found).toEqual(expected.map((item) => item.id));
        }
      });

      it("pages and searches canonically equivalent titles after Unicode lowercasing", async () => {
        const round = await add("round", { title: "ǰ workshop" });
        const presentation = await add("presentation", { title: "J\u030c workshop" });
        const survey = await add("survey", { title: "K workshop" });
        const alpha = await add("round", { title: "Alpha" });
        for (const [sort, expected] of [
          ["title_asc", [alpha, survey, presentation, round]],
          ["title_desc", [presentation, round, survey, alpha]],
        ] as const) {
          const found: string[] = [];
          let cursor: string | undefined;
          for (let pageIndex = 0; pageIndex < expected.length; pageIndex++) {
            const page = await list({ limit: 1, sort, ...(cursor ? { cursor } : {}) });
            expect(page.items).toHaveLength(1);
            expect(page.facets.total).toBe(4);
            found.push(page.items[0]!.id);
            cursor = page.nextCursor ?? undefined;
          }
          expect(cursor).toBeUndefined();
          expect(found).toEqual(expected);
        }
        for (const q of ["J\u030c workshop", "j\u030c workshop", "ǰ workshop"]) {
          const result = await list({ q, sort: "title_asc" });
          expect(result.items.map((item) => item.id)).toEqual([presentation, round]);
          expect(result.facets.total).toBe(2);
        }
      });

      it("counts complete q/favorites/folder matches before kind/status filters and isolates favorites", async () => {
        const folderId = randomUUID();
        await repository.createFolder({
          id: folderId,
          workspaceId: owner.workspaceId,
          name: "Folder",
          artifactType: "round",
          createdAt: instant,
          updatedAt: instant,
        });
        const round = await add("round", { title: "Matched", status: "published", folderId });
        const presentation = await add("presentation", { title: "Matched" });
        await add("survey", { title: "Matched", status: "archived" });
        await add("round", { title: "Excluded" });
        await metadata.setFavorite({
          workspaceId: owner.workspaceId,
          userId: owner.userId,
          artifactType: "round",
          artifactId: round,
          favorite: true,
          now: instant,
        });
        const other = await creator(repository);
        await join(other);
        await metadata.setFavorite({
          workspaceId: owner.workspaceId,
          userId: other.userId,
          artifactType: "presentation",
          artifactId: presentation,
          favorite: true,
          now: instant,
        });
        expect(
          (await list({ q: "Matched", kind: "round", status: "published", limit: 1 })).facets,
        ).toEqual({
          kinds: { round: 1, presentation: 1, survey: 1 },
          statuses: { draft: 1, published: 1, archived: 1 },
          total: 1,
        });
        expect(
          (await list({ q: "Matched", favorites: "true" })).items.map((item) => item.id),
        ).toEqual([round]);
        expect(
          (await list({ q: "Matched", favorites: "true" }, { userId: other.userId })).items.map(
            (item) => item.id,
          ),
        ).toEqual([presentation]);
        expect((await list({ q: "Matched", favorites: "false", status: "all" })).facets.total).toBe(
          2,
        );
        expect((await list({ folder: folderId })).items.map((item) => item.id)).toEqual([round]);
        expect((await list({ q: "Matched", folder: "unfiled", status: "all" })).facets.total).toBe(
          2,
        );
        expect(
          (await list({ q: "Matched", status: "archived" })).items.map((item) => item.artifactType),
        ).toEqual(["survey"]);
      });

      it("filters all artifact types and facet counts by inclusive update time before paginating", async () => {
        const from = "2026-11-17T07:00:00.000Z";
        const to = "2026-11-18T06:59:59.999Z";
        const firstBoundary = await add("round", { updatedAt: new Date(from) });
        const lastBoundary = await add("presentation", { updatedAt: new Date(to) });
        if (repository instanceof PostgresRepository) {
          const client = await repository.pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.workspace_id', $1, true)", [
              owner.workspaceId,
            ]);
            const updated = await client.query(
              "UPDATE presentations SET updated_at = $1::timestamptz + interval '999 microseconds' WHERE id = $2",
              [to, lastBoundary],
            );
            expect(updated.rowCount).toBe(1);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        }
        const middle = await add("survey");
        await add("presentation", { updatedAt: new Date(Date.parse(from) - 1) });
        await add("round", { updatedAt: new Date(Date.parse(to) + 1) });

        const range = { from, to, limit: 2 };
        const first = await list(range);
        expect(first.items.map((item) => item.id)).toEqual([lastBoundary, middle]);
        expect(first.items[0]?.updatedAt).toBe(to);
        expect(first.facets).toEqual({
          kinds: { round: 1, presentation: 1, survey: 1 },
          statuses: { draft: 3, published: 0, archived: 0 },
          total: 3,
        });
        expect(first.nextCursor).not.toBeNull();
        const second = await list({ ...range, cursor: first.nextCursor });
        expect(second.items.map((item) => item.id)).toEqual([firstBoundary]);
        expect(second.facets).toEqual(first.facets);
        expect(second.nextCursor).toBeNull();
        expect((await list({ from })).facets.total).toBe(4);
        expect((await list({ to })).facets.total).toBe(4);
        await expect(
          list({ from, limit: range.limit, cursor: first.nextCursor }),
        ).rejects.toBeInstanceOf(LibraryDiscoveryCursorError);
      });

      it("binds cursors to actor, workspace, filters and features and validates boundaries", async () => {
        await add("round");
        await add("survey");
        const first = await list({ limit: 1 });
        expect(first.nextCursor).not.toBeNull();
        for (const query of [
          { q: "Changed" },
          { limit: 2 },
          { favorites: false },
          { folder: "unfiled" },
          { status: "all" },
          { kind: "round" },
          { sort: "title_asc" },
          { from: instant.toISOString() },
          { to: instant.toISOString() },
        ]) {
          await expect(
            list({ limit: 1, ...query, cursor: first.nextCursor }),
          ).rejects.toBeInstanceOf(LibraryDiscoveryCursorError);
        }
        for (const context of [
          { userId: randomUUID() },
          { workspaceId: randomUUID() },
          { allowedKinds: ["round"] as const },
        ])
          await expect(
            list({ limit: 1, cursor: first.nextCursor }, context),
          ).rejects.toBeInstanceOf(LibraryDiscoveryCursorError);
        await expect(
          list({ cursor: Buffer.from("{}").toString("base64url") }),
        ).rejects.toBeInstanceOf(LibraryDiscoveryCursorError);
        const decoded = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"));
        for (const malformed of [
          { ...decoded, version: 2 },
          { ...decoded, extra: true },
          { ...decoded, key: "not a timestamp" },
          { ...decoded, key: "0000-01-01T00:00:00.000Z" },
          { ...decoded, key: "\u0000" },
          { ...decoded, key: "\ud800" },
          { ...decoded, id: "bad" },
        ])
          await expect(
            list({
              limit: 1,
              cursor: Buffer.from(JSON.stringify(malformed)).toString("base64url"),
            }),
          ).rejects.toBeInstanceOf(LibraryDiscoveryCursorError);
      });

      it("uses current authority and excludes foreign/feature-disabled metadata and counts", async () => {
        await add("round");
        await add("presentation");
        await add("survey");
        const outsider = await creator(repository);
        await add("round", { workspaceId: outsider.workspaceId, title: "Foreign private item" });
        expect((await list()).facets.total).toBe(3);
        expect((await list({}, { allowedKinds: ["round"] })).facets).toEqual({
          kinds: { round: 1, presentation: 0, survey: 0 },
          statuses: { draft: 1, published: 0, archived: 0 },
          total: 1,
        });
        await expect(list({}, { userId: outsider.userId })).rejects.toBeInstanceOf(
          LibraryDiscoveryAuthorizationError,
        );
        const platform = createPlatformRepository(repository);
        await platform.updateWorkspaceStatus(owner.workspaceId, "suspended");
        await expect(list()).rejects.toBeInstanceOf(LibraryDiscoveryAuthorizationError);
        await platform.updateWorkspaceStatus(owner.workspaceId, "active");
        const org = (await platform.getOrganizationForWorkspace(owner.workspaceId))!;
        await platform.updateOrganizationStatus(org.id, "suspended");
        await expect(list()).rejects.toBeInstanceOf(LibraryDiscoveryAuthorizationError);
        await platform.updateOrganizationStatus(org.id, "active");
        await join(outsider);
        expect((await list({}, { userId: outsider.userId })).facets.total).toBe(3);
        await repository.removeWorkspaceMember(owner.workspaceId, outsider.userId);
        await expect(list({}, { userId: outsider.userId })).rejects.toBeInstanceOf(
          LibraryDiscoveryAuthorizationError,
        );
      });

      it("continues after a removed anchor and avoids repeats when newer content arrives", async () => {
        const archived = await add("round", {
          status: "archived",
          updatedAt: new Date(instant.getTime() + 2000),
        });
        const next = await add("round", { updatedAt: new Date(instant.getTime() + 1000) });
        await add("round");
        const first = await list({ status: "all", limit: 1 });
        expect(first.items[0]?.id).toBe(archived);
        await repository.deleteQuiz(owner.workspaceId, archived);
        await add("presentation", {
          title: "Newer",
          updatedAt: new Date(instant.getTime() + 3000),
        });
        const page = await list({ status: "all", limit: 1, cursor: first.nextCursor });
        expect(page.items[0]?.id).toBe(next);
        expect(page.facets.total).toBe(3);
      });
    },
  );
}
