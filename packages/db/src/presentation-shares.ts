import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { CreatePresentationShareSchema } from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { createPresentationRepository } from "./presentations.js";
import { upcastPresentationContent } from "./artifact-schemas.js";
import type { Repository } from "./types.js";
import {
  PresentationShareError,
  type CreatePresentationShareInput,
  type PresentationShareRecord,
  type PresentationShareRepository,
} from "./presentation-share-types.js";
export * from "./presentation-share-types.js";
const day = 86_400_000;
const hash = /^[a-f0-9]{64}$/;
const unavailable = () => new PresentationShareError("UNAVAILABLE");
const key = (input: Pick<CreatePresentationShareInput, "workspaceId" | "actorId" | "requestId">) =>
  `${input.workspaceId}:${input.actorId}:${input.requestId}`;
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function validate(input: CreatePresentationShareInput) {
  CreatePresentationShareSchema.omit({ token: true }).parse({
    requestId: input.requestId,
    versionId: input.versionId,
    expiresAt: input.expiresAt,
  });
  if (
    !hash.test(input.intentHash) ||
    !hash.test(input.tokenHash) ||
    !Number.isFinite(input.now.getTime())
  )
    throw unavailable();
}
function expiry(input: CreatePresentationShareInput) {
  const date = new Date(input.expiresAt);
  if (date <= input.now)
    throw new PresentationShareError(
      "REQUEST_EXPIRED",
      "This link request expired before it was accepted. Create a new link to choose a fresh expiry.",
    );
  if (date.getTime() > input.now.getTime() + 30 * day) throw unavailable();
  return date;
}
function replay(share: PresentationShareRecord, input: CreatePresentationShareInput) {
  if (
    share.intentHash !== input.intentHash ||
    share.presentationId !== input.presentationId ||
    share.versionId !== input.versionId ||
    share.expiresAt.toISOString() !== input.expiresAt
  )
    throw new PresentationShareError("IDEMPOTENCY_CONFLICT", "This sharing request has changed");
  return { share: structuredClone(share), replayed: true };
}
function metadata(share: PresentationShareRecord) {
  return structuredClone({
    id: share.id,
    workspaceId: share.workspaceId,
    presentationId: share.presentationId,
    versionId: share.versionId,
    actorId: share.actorId,
    requestId: share.requestId,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
  });
}
export class MemoryPresentationShareRepository
  implements PresentationShareRepository, MemoryRepositoryLifecycleExtension
{
  private shares = new Map<string, PresentationShareRecord>();
  private queues = new Map<string, Promise<unknown>>();
  private presentations;
  constructor(private parent: MemoryRepository) {
    this.presentations = createPresentationRepository(parent);
  }
  /** Internal synchronous authority read for atomic Memory review mutations; never a public DTO. */
  reviewShareRecord(shareId: string): PresentationShareRecord | null {
    const share = this.shares.get(shareId);
    return share ? structuredClone(share) : null;
  }
  private member(workspaceId: string, actorId: string) {
    const actor = this.parent.users.get(actorId),
      member = this.parent.workspaceMembers.get(`${workspaceId}:${actorId}`);
    return (
      !!actor &&
      !actor.deletedAt &&
      !!member &&
      this.parent.workspaces.has(workspaceId) &&
      ["owner", "editor"].includes(actor.workspaceId === workspaceId ? actor.role : member.role)
    );
  }
  private async serial<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(work);
    this.queues.set(workspaceId, pending);
    try {
      return await pending;
    } finally {
      if (this.queues.get(workspaceId) === pending) this.queues.delete(workspaceId);
    }
  }
  async createShare(input: CreatePresentationShareInput) {
    validate(input);
    return this.serial(input.workspaceId, async () => {
      this.parent.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
      if (!this.member(input.workspaceId, input.actorId)) throw unavailable();
      const existing = [...this.shares.values()].find((s) => key(s) === key(input));
      if (existing) return replay(existing, input);
      const presentation = await this.presentations.getPresentation(
        input.workspaceId,
        input.presentationId,
      );
      const version = await this.presentations.getPresentationVersion(
        input.workspaceId,
        input.versionId,
      );
      if (
        !presentation ||
        presentation.status === "archived" ||
        !version ||
        version.presentationId !== input.presentationId ||
        !this.member(input.workspaceId, input.actorId) ||
        !this.parent.hasLibraryArtifact(input.workspaceId, "presentation", input.presentationId)
      )
        throw unavailable();
      const expiresAt = expiry(input);
      this.parent.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
      this.purgeExpired(input.now);
      const retained = [...this.shares.values()].filter(
        (s) => s.workspaceId === input.workspaceId && s.presentationId === input.presentationId,
      );
      if (
        retained.length >= 100 ||
        retained.filter((s) => !s.revokedAt && s.expiresAt > input.now).length >= 20
      )
        throw new PresentationShareError(
          "LINK_LIMIT",
          "Revoke an active link or wait for expired links to clear",
        );
      if ([...this.shares.values()].some((s) => s.tokenHash === input.tokenHash))
        throw unavailable();
      const share: PresentationShareRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        presentationId: input.presentationId,
        versionId: input.versionId,
        actorId: input.actorId,
        requestId: input.requestId,
        intentHash: input.intentHash,
        tokenHash: input.tokenHash,
        createdAt: new Date(input.now),
        expiresAt,
        revokedAt: null,
      };
      this.shares.set(share.id, share);
      return { share: structuredClone(share), replayed: false };
    });
  }
  async listShares(workspaceId: string, presentationId: string, actorId: string) {
    if (!this.member(workspaceId, actorId)) throw unavailable();
    return [...this.shares.values()]
      .filter((s) => s.workspaceId === workspaceId && s.presentationId === presentationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, 100)
      .map((s) => structuredClone(s));
  }
  async revokeShare(
    workspaceId: string,
    presentationId: string,
    shareId: string,
    actorId: string,
    now: Date,
  ) {
    if (!this.member(workspaceId, actorId)) throw unavailable();
    const share = this.shares.get(shareId);
    if (!share || share.workspaceId !== workspaceId || share.presentationId !== presentationId)
      return false;
    share.revokedAt ??= new Date(now);
    return true;
  }
  async getPublicShare(shareId: string, tokenHash: string, now: Date) {
    const share = this.shares.get(shareId);
    if (
      !share ||
      !hash.test(tokenHash) ||
      !same(share.tokenHash, tokenHash) ||
      share.revokedAt ||
      share.expiresAt <= now ||
      !this.member(share.workspaceId, share.actorId)
    )
      return null;
    const version = await this.presentations.getPresentationVersion(
      share.workspaceId,
      share.versionId,
    );
    if (
      !version ||
      share.revokedAt ||
      !this.member(share.workspaceId, share.actorId) ||
      !this.parent.hasLibraryArtifact(share.workspaceId, "presentation", share.presentationId)
    )
      return null;
    return structuredClone({ share, version });
  }
  async getPublicShareAccess(shareId: string, tokenHash: string, now: Date) {
    const share = this.shares.get(shareId);
    if (
      !share ||
      !hash.test(tokenHash) ||
      !same(share.tokenHash, tokenHash) ||
      share.revokedAt ||
      share.expiresAt <= now ||
      !this.member(share.workspaceId, share.actorId) ||
      !this.parent.hasLibraryArtifact(share.workspaceId, "presentation", share.presentationId)
    )
      return null;
    return structuredClone(share);
  }
  deleteLibraryArtifactMetadata(workspaceId: string, artifactType: string, artifactId: string) {
    if (artifactType === "presentation")
      for (const [id, s] of this.shares)
        if (s.workspaceId === workspaceId && s.presentationId === artifactId)
          this.shares.delete(id);
  }
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      presentationShares: [...this.shares.values()]
        .filter((s) => ownedWorkspaceIds.has(s.workspaceId))
        .map(metadata),
    };
  }
  deleteAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    for (const [id, s] of this.shares)
      if (ownedWorkspaceIds.has(s.workspaceId) || s.actorId === userId) this.shares.delete(id);
  }
  purgeExpired(now: Date) {
    for (const [id, s] of this.shares)
      if (s.expiresAt.getTime() <= now.getTime() - 7 * day) this.shares.delete(id);
    return [];
  }
}
function mapShare(row: QueryResultRow): PresentationShareRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    presentationId: row.presentation_id,
    versionId: row.version_id,
    actorId: row.actor_id,
    requestId: row.request_id,
    intentHash: row.intent_hash,
    tokenHash: row.token_hash,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}
export class PostgresPresentationShareRepository implements PresentationShareRepository {
  constructor(private parent: PostgresRepository) {}
  private async transaction<T>(
    workspaceId: string | null,
    work: (client: PoolClient) => Promise<T>,
    write = false,
  ) {
    const client = await this.parent.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config($1,$2,true)", [
        workspaceId ? "app.workspace_id" : "app.system_access",
        workspaceId ?? "on",
      ]);
      if (write && workspaceId) {
        const workspace = await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
          workspaceId,
        ]);
        if (
          !workspace.rowCount ||
          (
            await client.query(
              "SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=$1",
              [workspaceId],
            )
          ).rowCount
        )
          throw unavailable();
      }
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
  private async member(client: PoolClient, workspaceId: string, actorId: string) {
    await client.query("SELECT set_config('app.system_access','on',true)");
    const result = await client.query(
      "SELECT member.role FROM workspace_members member JOIN users actor ON actor.id=member.user_id WHERE member.workspace_id=$1 AND member.user_id=$2 AND actor.deleted_at IS NULL FOR SHARE OF member,actor",
      [workspaceId, actorId],
    );
    await client.query("SELECT set_config('app.system_access','',true)");
    return !!result.rowCount && ["owner", "editor"].includes(result.rows[0].role);
  }
  async createShare(input: CreatePresentationShareInput) {
    validate(input);
    return this.transaction(
      input.workspaceId,
      async (client) => {
        if (!(await this.member(client, input.workspaceId, input.actorId))) throw unavailable();
        const previous = await client.query(
          "SELECT * FROM presentation_shares WHERE workspace_id=$1 AND actor_id=$2 AND request_id=$3",
          [input.workspaceId, input.actorId, input.requestId],
        );
        if (previous.rows[0]) return replay(mapShare(previous.rows[0]), input);
        const source = await client.query(
          "SELECT parent.status FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND version.id=$3 FOR UPDATE OF parent",
          [input.workspaceId, input.presentationId, input.versionId],
        );
        if (!source.rowCount || source.rows[0].status === "archived") throw unavailable();
        const expiresAt = expiry(input);
        await client.query("SELECT set_config('app.system_access','on',true)");
        await client.query(
          "DELETE FROM presentation_shares WHERE workspace_id=$1 AND presentation_id=$2 AND expires_at<=$3",
          [input.workspaceId, input.presentationId, new Date(input.now.getTime() - 7 * day)],
        );
        await client.query("SELECT set_config('app.system_access','',true)");
        const counts = await client.query(
          "SELECT count(*)::integer AS retained,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>$3)::integer AS active FROM presentation_shares WHERE workspace_id=$1 AND presentation_id=$2",
          [input.workspaceId, input.presentationId, input.now],
        );
        if (counts.rows[0].retained >= 100 || counts.rows[0].active >= 20)
          throw new PresentationShareError(
            "LINK_LIMIT",
            "Revoke an active link or wait for expired links to clear",
          );
        const result = await client.query(
          "INSERT INTO presentation_shares(id,workspace_id,presentation_id,version_id,actor_id,request_id,intent_hash,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            randomUUID(),
            input.workspaceId,
            input.presentationId,
            input.versionId,
            input.actorId,
            input.requestId,
            input.intentHash,
            input.tokenHash,
            input.now,
            expiresAt,
          ],
        );
        return { share: mapShare(result.rows[0]), replayed: false };
      },
      true,
    );
  }
  async listShares(workspaceId: string, presentationId: string, actorId: string) {
    return this.transaction(workspaceId, async (client) => {
      if (!(await this.member(client, workspaceId, actorId))) throw unavailable();
      return (
        await client.query(
          "SELECT * FROM presentation_shares WHERE workspace_id=$1 AND presentation_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100",
          [workspaceId, presentationId],
        )
      ).rows.map(mapShare);
    });
  }
  async revokeShare(
    workspaceId: string,
    presentationId: string,
    shareId: string,
    actorId: string,
    now: Date,
  ) {
    return this.transaction(workspaceId, async (client) => {
      if (!(await this.member(client, workspaceId, actorId))) throw unavailable();
      return !!(
        await client.query(
          "UPDATE presentation_shares SET revoked_at=coalesce(revoked_at,$4) WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 RETURNING id",
          [workspaceId, presentationId, shareId, now],
        )
      ).rowCount;
    });
  }
  async getPublicShare(shareId: string, tokenHash: string, now: Date) {
    if (!hash.test(tokenHash)) return null;
    return this.transaction(null, async (client) => {
      const lookup = await client.query(
        "SELECT * FROM presentation_shares WHERE id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>$3",
        [shareId, tokenHash, now],
      );
      if (!lookup.rows[0]) return null;
      const share = mapShare(lookup.rows[0]);
      await client.query(
        "SELECT set_config('app.workspace_id',$1,true),set_config('app.system_access','',true)",
        [share.workspaceId],
      );
      if (!(await this.member(client, share.workspaceId, share.actorId))) return null;
      const source = await client.query(
        "SELECT version.* FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND version.id=$3 FOR SHARE OF parent",
        [share.workspaceId, share.presentationId, share.versionId],
      );
      if (!source.rows[0]) return null;
      const current = await client.query(
        "SELECT * FROM presentation_shares WHERE workspace_id=$1 AND id=$2 AND token_hash=$3 AND revoked_at IS NULL AND expires_at>$4 FOR SHARE",
        [share.workspaceId, shareId, tokenHash, now],
      );
      if (!current.rows[0]) return null;
      const row = source.rows[0];
      return {
        share: mapShare(current.rows[0]),
        version: {
          id: row.id,
          workspaceId: row.workspace_id,
          presentationId: row.presentation_id,
          version: row.version,
          content: upcastPresentationContent(row.content, row.content_schema_version),
          contentSchemaVersion: row.content_schema_version,
          contentHash: row.content_hash,
          sourceDraftRevision: row.source_draft_revision,
          publishedAt: new Date(row.published_at),
        },
      };
    });
  }
  async getPublicShareAccess(shareId: string, tokenHash: string, now: Date) {
    if (!hash.test(tokenHash)) return null;
    return this.transaction(null, async (client) => {
      const lookup = await client.query(
        "SELECT * FROM presentation_shares WHERE id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>$3",
        [shareId, tokenHash, now],
      );
      if (!lookup.rows[0]) return null;
      const share = mapShare(lookup.rows[0]);
      await client.query(
        "SELECT set_config('app.workspace_id',$1,true),set_config('app.system_access','',true)",
        [share.workspaceId],
      );
      if (!(await this.member(client, share.workspaceId, share.actorId))) return null;
      const parent = await client.query(
        "SELECT id FROM presentations WHERE workspace_id=$1 AND id=$2 FOR SHARE",
        [share.workspaceId, share.presentationId],
      );
      if (!parent.rowCount) return null;
      const current = await client.query(
        "SELECT * FROM presentation_shares WHERE workspace_id=$1 AND id=$2 AND token_hash=$3 AND revoked_at IS NULL AND expires_at>$4 FOR SHARE",
        [share.workspaceId, shareId, tokenHash, now],
      );
      return current.rows[0] ? mapShare(current.rows[0]) : null;
    });
  }
}
export function createPresentationShareRepository(
  repository: Repository,
): PresentationShareRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationShareRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "presentation-shares",
      () => new MemoryPresentationShareRepository(repository),
    );
  throw new Error("Unsupported presentation share repository");
}
