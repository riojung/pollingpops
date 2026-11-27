import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import {
  LibraryItemSummarySchema,
  LibraryItemsQuerySchema,
  type LibraryArtifactKind,
  type LibraryItemSummary,
  type LibraryItemsQuery,
  type LibraryItemsResponse,
} from "@openround/contracts";
import { libraryDateRangeFilter } from "./library-date-range.js";
import { MemoryRepository } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { getMemoryPlatformRepository } from "./platform-memory.js";
import type { OrganizationRecord, OrganizationWorkspaceRecord } from "./platform-types.js";
import type { LibraryMetadataRepository } from "./library-metadata.js";
import type { PresentationRepository } from "./presentation-types.js";
import type { SurveyRepository } from "./surveys.js";
import type { Repository } from "./types.js";

export interface LibraryDiscoveryInput {
  workspaceId: string;
  userId: string;
  allowedKinds: readonly LibraryArtifactKind[];
  query: LibraryItemsQuery;
}
export interface LibraryDiscoveryRepository {
  list(input: LibraryDiscoveryInput): Promise<LibraryItemsResponse>;
}
export class LibraryDiscoveryCursorError extends Error {
  constructor() {
    super("The Library cursor is invalid or belongs to different filters or access context");
    this.name = "LibraryDiscoveryCursorError";
  }
}
export class LibraryDiscoveryAuthorizationError extends Error {
  constructor() {
    super("Your workspace access is no longer available");
    this.name = "LibraryDiscoveryAuthorizationError";
  }
}

interface Cursor {
  version: 1;
  scope: string;
  key: string;
  artifactType: LibraryArtifactKind;
  id: string;
}
function parseCursor(value: unknown): Cursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !== "artifactType,id,key,scope,version" ||
    row.version !== 1 ||
    typeof row.scope !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.scope) ||
    typeof row.key !== "string" ||
    row.key.length > 1000 ||
    !LibraryItemSummarySchema.shape.id.safeParse(row.id).success ||
    !LibraryItemSummarySchema.shape.artifactType.safeParse(row.artifactType).success
  )
    throw new Error("shape");
  return row as unknown as Cursor;
}

// Lowercasing can introduce combining sequences, so normalize again to keep
// cursor keys canonical and idempotent. SQL mirrors this with ICU root lowercase
// and C comparison, independently of database/user locale.
function normalized(value: string) {
  return value.normalize("NFC").toLowerCase().normalize("NFC");
}
function compareText(left: string, right: string) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
function scopeFingerprint(input: LibraryDiscoveryInput, query: LibraryItemsQuery) {
  const filters = {
    q: query.q,
    kind: query.kind,
    status: query.status,
    sort: query.sort,
    favorites: query.favorites ?? null,
    folder: query.folder,
    limit: query.limit,
    from: query.from,
    to: query.to,
  };
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        userId: input.userId,
        workspaceId: input.workspaceId,
        allowedKinds: [...new Set(input.allowedKinds)].sort(),
        filters,
      }),
    )
    .digest("hex");
}
function readCursor(query: LibraryItemsQuery, scope: string): Cursor | null {
  if (!query.cursor) return null;
  try {
    const decoded = Buffer.from(query.cursor, "base64url");
    if (decoded.toString("base64url") !== query.cursor) throw new Error("encoding");
    if (!Buffer.from(decoded.toString("utf8")).equals(decoded)) throw new Error("encoding");
    const cursor = parseCursor(JSON.parse(decoded.toString("utf8")));
    if (
      cursor.scope !== scope ||
      cursor.key.includes("\u0000") ||
      Buffer.from(cursor.key).toString("utf8") !== cursor.key ||
      (query.sort === "recent"
        ? !/^[0-9]{4}-/.test(cursor.key) ||
          cursor.key.startsWith("0000-") ||
          new Date(cursor.key).toISOString() !== cursor.key
        : normalized(cursor.key) !== cursor.key)
    )
      throw new Error("scope");
    return cursor;
  } catch {
    throw new LibraryDiscoveryCursorError();
  }
}
function sortKey(item: LibraryItemSummary, query: LibraryItemsQuery) {
  return query.sort === "recent" ? item.updatedAt : normalized(item.title);
}
function compareItem(
  left: LibraryItemSummary,
  right: Pick<Cursor, "key" | "artifactType" | "id">,
  query: LibraryItemsQuery,
) {
  const primary = compareText(sortKey(left, query), right.key);
  return (
    (query.sort === "title_asc" ? primary : -primary) ||
    compareText(left.artifactType, right.artifactType) ||
    compareText(left.id, right.id)
  );
}
function finish(
  items: LibraryItemSummary[],
  facets: LibraryItemsResponse["facets"],
  query: LibraryItemsQuery,
  scope: string,
): LibraryItemsResponse {
  const page = items.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page,
    facets,
    nextCursor:
      items.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              scope,
              key: sortKey(last, query),
              artifactType: last.artifactType,
              id: last.id,
            } satisfies Cursor),
          ).toString("base64url")
        : null,
  };
}
function matchesFinal(item: LibraryItemSummary, query: LibraryItemsQuery) {
  return (
    (query.kind === "all" || item.artifactType === query.kind) &&
    (query.status === "all" ||
      (query.status === "active" ? item.status !== "archived" : item.status === query.status))
  );
}

interface Dependencies {
  repository: Repository;
  presentations: PresentationRepository;
  surveys: SurveyRepository;
  libraryMetadata: LibraryMetadataRepository;
}

export class MemoryLibraryDiscoveryRepository implements LibraryDiscoveryRepository {
  constructor(private readonly dependencies: Dependencies) {}

  async list(input: LibraryDiscoveryInput) {
    const query = LibraryItemsQuerySchema.parse(input.query);
    const scope = scopeFingerprint(input, query);
    const cursor = readCursor(query, scope);
    const { repository, presentations, surveys, libraryMetadata } = this.dependencies;
    if (!(await repository.getCreatorByUserId(input.userId, input.workspaceId)))
      throw new LibraryDiscoveryAuthorizationError();
    if (repository instanceof MemoryRepository) {
      const store = getMemoryPlatformRepository(repository).memoryStore;
      const workspace = store.getSync<OrganizationWorkspaceRecord>("workspace", input.workspaceId);
      const organization =
        workspace && store.getSync<OrganizationRecord>("organization", workspace.organizationId);
      if (
        !repository.users.get(input.userId)?.emailVerifiedAt ||
        workspace?.status !== "active" ||
        organization?.status !== "active"
      )
        throw new LibraryDiscoveryAuthorizationError();
    }
    const favorites = new Set(
      (await libraryMetadata.listFavorites(input.workspaceId, input.userId)).map(
        (favorite) => `${favorite.artifactType}:${favorite.artifactId}`,
      ),
    );
    const sources = await Promise.all([
      input.allowedKinds.includes("round") ? repository.listQuizzes(input.workspaceId, true) : [],
      input.allowedKinds.includes("presentation")
        ? presentations.listPresentations(input.workspaceId, true)
        : [],
      input.allowedKinds.includes("survey") ? surveys.list(input.workspaceId) : [],
    ]);
    const items: LibraryItemSummary[] = [
      ...sources[0].map((item) => ({
        id: item.id,
        artifactType: "round" as const,
        title: item.title,
        description: item.description,
        status: item.status,
        updatedAt: item.updatedAt.toISOString(),
        folderId: item.folderId ?? null,
        currentVersionId: item.currentVersionId,
        itemCount: item.draft.questions.length,
        favorite: favorites.has(`round:${item.id}`),
      })),
      ...sources[1].map((item) => ({
        id: item.id,
        artifactType: "presentation" as const,
        title: item.title,
        description: item.description,
        status: item.status,
        updatedAt: item.updatedAt.toISOString(),
        folderId: item.folderId,
        currentVersionId: item.currentVersionId,
        itemCount: item.blockCount,
        favorite: favorites.has(`presentation:${item.id}`),
      })),
      ...sources[2].map((item) => ({
        id: item.id,
        artifactType: "survey" as const,
        title: item.draft.title,
        description: item.draft.description,
        status: item.status,
        updatedAt: item.updatedAt ?? new Date(0).toISOString(),
        folderId: item.folderId ?? null,
        currentVersionId: item.versionId,
        itemCount: item.draft.items.length,
        favorite: favorites.has(`survey:${item.id}`),
      })),
    ];
    const needle = normalized(query.q);
    const matchesDate = libraryDateRangeFilter(query);
    const matches = items.filter(
      (item) =>
        matchesDate(item.updatedAt) &&
        (!needle || normalized(`${item.title}\n${item.description}`).includes(needle)) &&
        (query.favorites === undefined || item.favorite === query.favorites) &&
        (query.folder === "all" ||
          (query.folder === "unfiled" ? item.folderId === null : item.folderId === query.folder)),
    );
    const facets: LibraryItemsResponse["facets"] = {
      kinds: { round: 0, presentation: 0, survey: 0 },
      statuses: { draft: 0, published: 0, archived: 0 },
      total: 0,
    };
    for (const item of matches) {
      facets.kinds[item.artifactType]++;
      facets.statuses[item.status]++;
    }
    const filtered = matches.filter((item) => matchesFinal(item, query));
    facets.total = filtered.length;
    filtered.sort((left, right) =>
      compareItem(
        left,
        { key: sortKey(right, query), artifactType: right.artifactType, id: right.id },
        query,
      ),
    );
    return finish(
      filtered.filter((item) => !cursor || compareItem(item, cursor, query) > 0),
      facets,
      query,
      scope,
    );
  }
}

function mapItem(row: QueryResultRow): LibraryItemSummary {
  return {
    id: row.id,
    artifactType: row.artifact_type,
    title: row.title,
    description: row.description,
    status: row.status,
    updatedAt: new Date(row.updated_at).toISOString(),
    folderId: row.folder_id,
    favorite: row.favorite,
    currentVersionId: row.current_version_id,
    itemCount: Number(row.item_count),
  };
}

export class PostgresLibraryDiscoveryRepository implements LibraryDiscoveryRepository {
  constructor(private readonly repository: PostgresRepository) {}

  async list(input: LibraryDiscoveryInput) {
    const query = LibraryItemsQuerySchema.parse(input.query);
    const scope = scopeFingerprint(input, query);
    const cursor = readCursor(query, scope);
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query(
        "SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)",
        [input.workspaceId, input.userId],
      );
      // Recheck current membership in the same snapshot used for all metadata and counts.
      // Principal identity tables are system-only; metadata reads below retain workspace RLS.
      await client.query("SELECT set_config('app.system_access', 'on', true)");
      const authorized = await client.query(
        `SELECT 1 FROM workspace_members member
         JOIN users actor ON actor.id = member.user_id AND actor.deleted_at IS NULL AND actor.email_verified_at IS NOT NULL
         JOIN workspaces workspace ON workspace.id = member.workspace_id AND workspace.platform_status = 'active'
         JOIN organizations organization ON organization.id = workspace.organization_id AND organization.status = 'active'
         WHERE member.workspace_id = $1 AND member.user_id = $2`,
        [input.workspaceId, input.userId],
      );
      if (!authorized.rowCount) throw new LibraryDiscoveryAuthorizationError();
      await client.query("SELECT set_config('app.system_access', 'off', true)");
      const fold = (value: string) =>
        `normalize(lower(normalize((${value}), NFC) COLLATE "und-x-icu"), NFC) COLLATE "C"`;
      const key = query.sort === "recent" ? "updated_at" : fold("title");
      const direction = query.sort === "title_asc" ? "ASC" : "DESC";
      const operator = direction === "ASC" ? ">" : "<";
      const cursorKey = query.sort === "recent" ? "$9::timestamptz" : '$9::text COLLATE "C"';
      const order = `${key} ${direction}, artifact_type COLLATE "C" ASC, id ASC`;
      // Include the entire millisecond represented by the upper bound.
      const updatedDuringRange = `($13::timestamptz IS NULL OR updated_at >= $13)
        AND ($14::timestamptz IS NULL OR updated_at < ($14 + interval '1 millisecond'))`;
      const result = await client.query(
        `
        WITH raw AS (
          SELECT id, 'round'::text artifact_type, title, description, status,
            date_trunc('milliseconds', updated_at) updated_at, folder_id, current_version_id,
            jsonb_array_length(draft->'questions') item_count
          FROM quizzes WHERE workspace_id = $1 AND 'round' = ANY($3::text[])
            AND ${updatedDuringRange}
          UNION ALL
          SELECT id, 'presentation', title, description, status,
            date_trunc('milliseconds', updated_at), folder_id, current_version_id,
            jsonb_array_length(draft->'blocks')
          FROM presentations WHERE workspace_id = $1 AND 'presentation' = ANY($3::text[])
            AND ${updatedDuringRange}
          UNION ALL
          SELECT id, 'survey', data->'draft'->>'title', coalesce(data->'draft'->>'description', ''), data->>'status',
            date_trunc('milliseconds', updated_at), folder_id, (data->>'versionId')::uuid,
            jsonb_array_length(data->'draft'->'items')
          FROM surveys WHERE workspace_id = $1 AND 'survey' = ANY($3::text[])
            AND ${updatedDuringRange}
        ), metadata AS (
          SELECT raw.*, EXISTS(SELECT 1 FROM library_favorites f WHERE f.workspace_id = $1 AND f.user_id = $2 AND f.artifact_type = raw.artifact_type AND f.artifact_id = raw.id) favorite
          FROM raw
        ), matches AS MATERIALIZED (
          SELECT * FROM metadata WHERE ($4::text = '' OR ${fold("title || E'\\n' || description")} LIKE $4 ESCAPE '!')
            AND ($5::boolean IS NULL OR favorite = $5)
            AND ($6::text = 'all' OR ($6 = 'unfiled' AND folder_id IS NULL) OR folder_id::text = $6)
        ), filtered AS (
          SELECT * FROM matches WHERE ($7::text = 'all' OR artifact_type = $7)
            AND ($8::text = 'all' OR ($8 = 'active' AND status <> 'archived') OR status = $8)
        ), page AS (
          SELECT * FROM filtered WHERE ($9::text IS NULL OR ${key} ${operator} ${cursorKey}
            OR (${key} = ${cursorKey} AND (artifact_type COLLATE "C", id) > ($10::text COLLATE "C", $11::uuid)))
          ORDER BY ${order} LIMIT $12
        )
        SELECT coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${order}) FROM page), '[]'::jsonb) items,
          (SELECT count(*) FROM filtered) total,
          count(*) FILTER (WHERE artifact_type = 'round') round_count,
          count(*) FILTER (WHERE artifact_type = 'presentation') presentation_count,
          count(*) FILTER (WHERE artifact_type = 'survey') survey_count,
          count(*) FILTER (WHERE status = 'draft') draft_count,
          count(*) FILTER (WHERE status = 'published') published_count,
          count(*) FILTER (WHERE status = 'archived') archived_count
        FROM matches`,
        [
          input.workspaceId,
          input.userId,
          [...new Set(input.allowedKinds)],
          query.q
            ? `%${normalized(query.q).replace(/[!%_]/g, (character) => `!${character}`)}%`
            : "",
          query.favorites ?? null,
          query.folder,
          query.kind,
          query.status,
          cursor?.key ?? null,
          cursor?.artifactType ?? null,
          cursor?.id ?? null,
          query.limit + 1,
          query.from ?? null,
          query.to ?? null,
        ],
      );
      await client.query("COMMIT");
      const row = result.rows[0]!;
      return finish(
        row.items.map(mapItem),
        {
          kinds: {
            round: Number(row.round_count),
            presentation: Number(row.presentation_count),
            survey: Number(row.survey_count),
          },
          statuses: {
            draft: Number(row.draft_count),
            published: Number(row.published_count),
            archived: Number(row.archived_count),
          },
          total: Number(row.total),
        },
        query,
        scope,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createLibraryDiscoveryRepository(
  dependencies: Dependencies,
): LibraryDiscoveryRepository {
  if (dependencies.repository instanceof PostgresRepository)
    return new PostgresLibraryDiscoveryRepository(dependencies.repository);
  if (dependencies.repository instanceof MemoryRepository)
    return new MemoryLibraryDiscoveryRepository(dependencies);
  throw new Error("Unsupported Library discovery repository adapter");
}
