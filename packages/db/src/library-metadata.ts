import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";

export type LibraryArtifactType = "round" | "presentation" | "survey";

export interface LibraryFavoriteRecord {
  workspaceId: string;
  userId: string;
  artifactType: LibraryArtifactType;
  artifactId: string;
  createdAt: Date;
}

export interface LibraryMetadataRepository {
  listFavorites(workspaceId: string, userId: string): Promise<LibraryFavoriteRecord[]>;
  setFavorite(input: {
    workspaceId: string;
    userId: string;
    artifactType: LibraryArtifactType;
    artifactId: string;
    favorite: boolean;
    now: Date;
  }): Promise<LibraryFavoriteRecord | null>;
}

function favoriteKey(
  record: Pick<LibraryFavoriteRecord, "workspaceId" | "userId" | "artifactType" | "artifactId">,
) {
  return `${record.workspaceId}:${record.userId}:${record.artifactType}:${record.artifactId}`;
}

function mapFavorite(row: QueryResultRow): LibraryFavoriteRecord {
  return {
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    artifactType: row.artifact_type,
    artifactId: String(row.artifact_id),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

export class MemoryLibraryMetadataRepository
  implements LibraryMetadataRepository, MemoryRepositoryLifecycleExtension
{
  readonly favorites = new Map<string, LibraryFavoriteRecord>();

  constructor(private readonly repository?: Pick<MemoryRepository, "hasLibraryArtifact">) {}

  deleteLibraryArtifactMetadata(
    workspaceId: string,
    artifactType: LibraryArtifactType,
    artifactId: string,
  ) {
    for (const [key, favorite] of this.favorites) {
      if (
        favorite.workspaceId === workspaceId &&
        favorite.artifactType === artifactType &&
        favorite.artifactId === artifactId
      )
        this.favorites.delete(key);
    }
  }

  exportAccount({ userId }: MemoryRepositoryLifecycleContext) {
    return {
      libraryFavorites: [...this.favorites.values()]
        .filter((favorite) => favorite.userId === userId)
        .map((favorite) => structuredClone(favorite)),
    };
  }

  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [key, favorite] of this.favorites) {
      if (favorite.userId === userId || ownedWorkspaceIds.has(favorite.workspaceId)) {
        this.favorites.delete(key);
      }
    }
  }

  async listFavorites(workspaceId: string, userId: string) {
    return [...this.favorites.values()]
      .filter((favorite) => favorite.workspaceId === workspaceId && favorite.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((favorite) => structuredClone(favorite));
  }

  async setFavorite(input: {
    workspaceId: string;
    userId: string;
    artifactType: LibraryArtifactType;
    artifactId: string;
    favorite: boolean;
    now: Date;
  }) {
    const key = favoriteKey(input);
    if (!input.favorite) {
      this.favorites.delete(key);
      return null;
    }
    if (
      this.repository &&
      !this.repository.hasLibraryArtifact(input.workspaceId, input.artifactType, input.artifactId)
    )
      return null;
    const existing = this.favorites.get(key);
    if (existing) return structuredClone(existing);
    const favorite: LibraryFavoriteRecord = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      artifactType: input.artifactType,
      artifactId: input.artifactId,
      createdAt: input.now,
    };
    this.favorites.set(key, favorite);
    return structuredClone(favorite);
  }
}

export class PostgresLibraryMetadataRepository implements LibraryMetadataRepository {
  constructor(private readonly repository: PostgresRepository) {}

  private async transaction<T>(
    workspaceId: string,
    userId: string,
    work: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listFavorites(workspaceId: string, userId: string) {
    return this.transaction(workspaceId, userId, async (client) => {
      const result = await client.query(
        `SELECT workspace_id, user_id, artifact_type, artifact_id, created_at
         FROM library_favorites
         WHERE workspace_id = $1 AND user_id = $2
         ORDER BY created_at DESC, artifact_type, artifact_id`,
        [workspaceId, userId],
      );
      return result.rows.map(mapFavorite);
    });
  }

  async setFavorite(input: {
    workspaceId: string;
    userId: string;
    artifactType: LibraryArtifactType;
    artifactId: string;
    favorite: boolean;
    now: Date;
  }) {
    return this.transaction(input.workspaceId, input.userId, async (client) => {
      if (!input.favorite) {
        await client.query(
          `DELETE FROM library_favorites
           WHERE workspace_id = $1 AND user_id = $2 AND artifact_type = $3 AND artifact_id = $4`,
          [input.workspaceId, input.userId, input.artifactType, input.artifactId],
        );
        return null;
      }
      const artifact = await client.query(
        input.artifactType === "round"
          ? "SELECT id FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR KEY SHARE"
          : input.artifactType === "survey"
            ? "SELECT id FROM surveys WHERE workspace_id = $1 AND id = $2 FOR KEY SHARE"
            : "SELECT id FROM presentations WHERE workspace_id = $1 AND id = $2 FOR KEY SHARE",
        [input.workspaceId, input.artifactId],
      );
      if (!artifact.rows[0]) return null;
      const result = await client.query(
        `INSERT INTO library_favorites
           (workspace_id, user_id, artifact_type, artifact_id, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, user_id, artifact_type, artifact_id)
         DO UPDATE SET artifact_id = EXCLUDED.artifact_id
         RETURNING workspace_id, user_id, artifact_type, artifact_id, created_at`,
        [input.workspaceId, input.userId, input.artifactType, input.artifactId, input.now],
      );
      return mapFavorite(result.rows[0]!);
    });
  }
}

export function createLibraryMetadataRepository(repository: Repository): LibraryMetadataRepository {
  if (repository instanceof PostgresRepository) {
    return new PostgresLibraryMetadataRepository(repository);
  }
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "library-metadata",
      () => new MemoryLibraryMetadataRepository(repository),
    );
  }
  return new MemoryLibraryMetadataRepository();
}
