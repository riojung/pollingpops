import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { FolderError, type LibraryArtifactDeletionResult, type Repository } from "./types.js";
import { presentationMediaIds } from "./media-references.js";
import {
  PRESENTATION_CONTENT_SCHEMA_VERSION,
  PRESENTATION_DRAFT_SCHEMA_VERSION,
  upcastPresentationContent,
  upcastPresentationDraft,
} from "./artifact-schemas.js";
import {
  PresentationArchivedError,
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  type PresentationDraftUpdate,
  type PresentationHistoryRecord,
  type PresentationRecord,
  type PresentationRepository,
  type PresentationSummaryRecord,
  type PresentationVersionRecord,
} from "./presentation-types.js";

interface PresentationMutationReceipt {
  workspaceId: string;
  presentationId: string;
  expectedRevision: number;
  resultingRevision: number;
  draftHash: string;
  recoveryPackUpdateSourceRevision: number | null;
  createdAt: Date;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizePresentationRecord(input: PresentationRecord): PresentationRecord {
  const draftSchemaVersion = input.draftSchemaVersion ?? input.draft.schemaVersion;
  const draft = upcastPresentationDraft(input.draft, draftSchemaVersion);
  return {
    ...input,
    title: draft.title,
    description: draft.description,
    draft,
    draftSchemaVersion,
  };
}

function normalizePresentationVersion(input: PresentationVersionRecord): PresentationVersionRecord {
  const contentSchemaVersion = input.contentSchemaVersion ?? input.content.schemaVersion;
  return {
    ...input,
    content: upcastPresentationContent(input.content, contentSchemaVersion),
    contentSchemaVersion,
  };
}

function normalizePresentationHistory(
  input: PresentationHistoryRecord,
  fallbackSchemaVersion = PRESENTATION_DRAFT_SCHEMA_VERSION,
): PresentationHistoryRecord {
  const draftSchemaVersion = input.draftSchemaVersion ?? fallbackSchemaVersion;
  return {
    ...input,
    draft: upcastPresentationDraft(input.draft, draftSchemaVersion),
    draftSchemaVersion,
  };
}

function presentationAtDraftRevision(
  current: PresentationRecord,
  snapshot: PresentationHistoryRecord,
): PresentationRecord {
  const normalized = normalizePresentationHistory(snapshot);
  return normalizePresentationRecord({
    ...current,
    title: normalized.draft.title,
    description: normalized.draft.description,
    draft: clone(normalized.draft),
    draftRevision: normalized.revision,
    draftSchemaVersion: normalized.draftSchemaVersion ?? PRESENTATION_DRAFT_SCHEMA_VERSION,
    lastEditedBy: normalized.savedBy,
    updatedAt: normalized.createdAt,
  });
}

function mutationKey(workspaceId: string, mutationId: string) {
  return `${workspaceId}:${mutationId}`;
}

function assertMutationMatches(
  receipt: PresentationMutationReceipt,
  input: Pick<
    PresentationDraftUpdate,
    | "workspaceId"
    | "presentationId"
    | "expectedRevision"
    | "mutationId"
    | "draftHash"
    | "recoveryPackUpdateSourceRevision"
  >,
) {
  if (
    receipt.workspaceId !== input.workspaceId ||
    receipt.presentationId !== input.presentationId ||
    receipt.expectedRevision !== input.expectedRevision ||
    receipt.draftHash !== input.draftHash ||
    receipt.recoveryPackUpdateSourceRevision !== (input.recoveryPackUpdateSourceRevision ?? null)
  ) {
    throw new PresentationMutationConflictError(input.mutationId);
  }
}

function assertRecoveryPackUpdateSource(input: PresentationDraftUpdate) {
  if (
    input.recoveryPackUpdateSourceRevision != null &&
    (!Number.isSafeInteger(input.recoveryPackUpdateSourceRevision) ||
      input.recoveryPackUpdateSourceRevision < 0 ||
      input.recoveryPackUpdateSourceRevision !== input.expectedRevision)
  ) {
    throw new PresentationMutationConflictError(input.mutationId);
  }
}

function mapPresentation(row: QueryResultRow): PresentationRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    description: String(row.description),
    status: row.status,
    draft: upcastPresentationDraft(row.draft, draftSchemaVersion),
    draftRevision: Number(row.draft_revision),
    draftSchemaVersion,
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    publishedDraftRevision:
      row.published_draft_revision == null ? null : Number(row.published_draft_revision),
    lastEditedBy: row.last_edited_by ? String(row.last_edited_by) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

function mapPresentationVersion(row: QueryResultRow): PresentationVersionRecord {
  const contentSchemaVersion = Number(
    row.content_schema_version ?? PRESENTATION_CONTENT_SCHEMA_VERSION,
  );
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    version: Number(row.version),
    content: upcastPresentationContent(row.content, contentSchemaVersion),
    contentSchemaVersion,
    contentHash: String(row.content_hash),
    sourceDraftRevision: Number(row.source_draft_revision),
    publishedAt:
      row.published_at instanceof Date ? row.published_at : new Date(String(row.published_at)),
  };
}

function mapPresentationSummary(row: QueryResultRow): PresentationSummaryRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION);
  const draft = upcastPresentationDraft(row.draft, draftSchemaVersion);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    description: String(row.description),
    status: row.status,
    draftRevision: Number(row.draft_revision),
    draftSchemaVersion,
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    publishedDraftRevision:
      row.published_draft_revision == null ? null : Number(row.published_draft_revision),
    lastEditedBy: row.last_edited_by ? String(row.last_edited_by) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    blockCount: draft.blocks.length,
  };
}

function mapPresentationHistory(row: QueryResultRow): PresentationHistoryRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    revision: Number(row.revision),
    draft: upcastPresentationDraft(row.draft, draftSchemaVersion),
    draftSchemaVersion,
    savedBy: row.saved_by ? String(row.saved_by) : null,
    mutationId: row.mutation_id ? String(row.mutation_id) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

function mapMutationReceipt(row: QueryResultRow): PresentationMutationReceipt {
  return {
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    expectedRevision: Number(row.expected_revision),
    resultingRevision: Number(row.resulting_revision),
    draftHash: String(row.draft_hash),
    recoveryPackUpdateSourceRevision:
      row.recovery_pack_update_source_revision == null
        ? null
        : Number(row.recovery_pack_update_source_revision),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

export class MemoryPresentationRepository
  implements PresentationRepository, MemoryRepositoryLifecycleExtension
{
  readonly presentations = new Map<string, PresentationRecord>();
  readonly versions = new Map<string, PresentationVersionRecord>();
  readonly history = new Map<string, PresentationHistoryRecord>();
  private readonly mutations = new Map<string, PresentationMutationReceipt>();

  constructor(
    private readonly repository?: Pick<
      MemoryRepository,
      | "listFolders"
      | "folders"
      | "replaceMediaReferences"
      | "validateMediaReferences"
      | "isLibraryArtifactReferenced"
      | "markLibraryArtifactDeleted"
      | "deleteLibraryArtifactMetadata"
      | "removeMediaReferencesForOwners"
    >,
  ) {}

  hasLibraryArtifact(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    return (
      artifactType === "presentation" &&
      this.presentations.get(artifactId)?.workspaceId === workspaceId
    );
  }

  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      presentations: [...this.presentations.values()]
        .filter((presentation) => ownedWorkspaceIds.has(presentation.workspaceId))
        .map((presentation) => clone(normalizePresentationRecord(presentation))),
      presentationVersions: [...this.versions.values()]
        .filter((version) => ownedWorkspaceIds.has(version.workspaceId))
        .map((version) => clone(normalizePresentationVersion(version))),
      presentationDraftHistory: [...this.history.values()]
        .filter((snapshot) => ownedWorkspaceIds.has(snapshot.workspaceId))
        .map((snapshot) => clone(normalizePresentationHistory(snapshot))),
    };
  }

  deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, presentation] of this.presentations) {
      if (ownedWorkspaceIds.has(presentation.workspaceId)) this.presentations.delete(id);
    }
    for (const [id, version] of this.versions) {
      if (ownedWorkspaceIds.has(version.workspaceId)) this.versions.delete(id);
    }
    for (const [id, snapshot] of this.history) {
      if (ownedWorkspaceIds.has(snapshot.workspaceId)) this.history.delete(id);
    }
    for (const [id, mutation] of this.mutations) {
      if (ownedWorkspaceIds.has(mutation.workspaceId)) this.mutations.delete(id);
    }
  }

  deleteFolderMetadata(workspaceId: string, folderId: string) {
    for (const presentation of this.presentations.values()) {
      if (presentation.workspaceId === workspaceId && presentation.folderId === folderId) {
        presentation.folderId = null;
        presentation.updatedAt = new Date();
      }
    }
  }

  async listPresentations(workspaceId: string, includeArchived = false) {
    const folderIds = new Set(
      (await this.repository?.listFolders(workspaceId, "presentation"))?.map(
        (folder) => folder.id,
      ) ?? [],
    );
    return [...this.presentations.values()]
      .filter(
        (presentation) =>
          presentation.workspaceId === workspaceId &&
          (includeArchived || presentation.status !== "archived"),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((presentation) => {
        const normalized = normalizePresentationRecord(presentation);
        if (presentation.folderId && !folderIds.has(presentation.folderId)) {
          presentation.folderId = null;
          normalized.folderId = null;
        }
        const { draft, ...summary } = clone(normalized);
        return { ...summary, blockCount: draft.blocks.length };
      });
  }

  async createPresentation(input: PresentationRecord) {
    const created = clone(normalizePresentationRecord(input));
    if (created.folderId) {
      const folder = this.repository?.folders.get(created.folderId);
      if (
        !folder ||
        folder.workspaceId !== created.workspaceId ||
        folder.artifactType !== "presentation"
      )
        throw new FolderError("NOT_FOUND", "Selected folder not found in this content library");
    }
    this.repository?.validateMediaReferences(
      created.workspaceId,
      presentationMediaIds(created.draft),
    );
    this.presentations.set(input.id, created);
    const historyId = randomUUID();
    this.history.set(`${input.id}:0`, {
      id: historyId,
      workspaceId: input.workspaceId,
      presentationId: input.id,
      revision: 0,
      draft: clone(created.draft),
      draftSchemaVersion: created.draftSchemaVersion,
      savedBy: input.lastEditedBy,
      mutationId: null,
      createdAt: input.createdAt,
    });
    await this.repository?.replaceMediaReferences(
      input.workspaceId,
      "presentation_draft",
      input.id,
      presentationMediaIds(created.draft),
      input.createdAt,
    );
    await this.repository?.replaceMediaReferences(
      input.workspaceId,
      "presentation_history",
      historyId,
      presentationMediaIds(created.draft),
      input.createdAt,
    );
    return clone(created);
  }

  async getPresentation(workspaceId: string, presentationId: string) {
    const presentation = this.presentations.get(presentationId);
    if (!presentation || presentation.workspaceId !== workspaceId) return null;
    if (presentation.folderId) {
      const folders = await this.repository?.listFolders(workspaceId, "presentation");
      if (!folders?.some((folder) => folder.id === presentation.folderId)) {
        presentation.folderId = null;
      }
    }
    return clone(normalizePresentationRecord(presentation));
  }

  async updatePresentationDraft(input: PresentationDraftUpdate) {
    const draft = upcastPresentationDraft(input.draft, input.draft.schemaVersion);
    const presentation = this.presentations.get(input.presentationId);
    if (!presentation || presentation.workspaceId !== input.workspaceId) {
      return null;
    }
    assertRecoveryPackUpdateSource(input);
    const key = mutationKey(input.workspaceId, input.mutationId);
    const retry = this.mutations.get(key);
    if (retry) {
      assertMutationMatches(retry, input);
      return this.replayPresentationDraftMutation(presentation, retry);
    }
    if (presentation.status === "archived") return null;
    if (presentation.draftRevision !== input.expectedRevision) {
      throw new PresentationDraftConflictError(
        input.expectedRevision,
        presentation.draftRevision,
        presentation.lastEditedBy,
      );
    }
    const meaningful =
      JSON.stringify(normalizePresentationRecord(presentation).draft) !== JSON.stringify(draft);
    if (input.recoveryPackUpdateSourceRevision != null && !meaningful) {
      throw new PresentationMutationConflictError(input.mutationId);
    }
    if (meaningful) {
      this.repository?.validateMediaReferences(input.workspaceId, presentationMediaIds(draft));
    }
    const revision = meaningful ? presentation.draftRevision + 1 : presentation.draftRevision;
    const updatedAt = new Date();
    this.mutations.set(key, {
      workspaceId: input.workspaceId,
      presentationId: input.presentationId,
      expectedRevision: input.expectedRevision,
      resultingRevision: revision,
      draftHash: input.draftHash,
      recoveryPackUpdateSourceRevision: input.recoveryPackUpdateSourceRevision ?? null,
      createdAt: updatedAt,
    });
    if (!meaningful) return clone(normalizePresentationRecord(presentation));

    const updated: PresentationRecord = {
      ...presentation,
      title: draft.title,
      description: draft.description,
      draft: clone(draft),
      draftRevision: revision,
      draftSchemaVersion: draft.schemaVersion,
      lastEditedBy: input.editorId,
      updatedAt,
    };
    this.presentations.set(updated.id, updated);
    const historyId = randomUUID();
    this.history.set(`${updated.id}:${revision}`, {
      id: historyId,
      workspaceId: updated.workspaceId,
      presentationId: updated.id,
      revision,
      draft: clone(updated.draft),
      draftSchemaVersion: updated.draftSchemaVersion,
      savedBy: input.editorId,
      mutationId: input.mutationId,
      createdAt: updated.updatedAt,
    });
    await this.repository?.replaceMediaReferences(
      updated.workspaceId,
      "presentation_draft",
      updated.id,
      presentationMediaIds(updated.draft),
      updated.updatedAt,
    );
    await this.repository?.replaceMediaReferences(
      updated.workspaceId,
      "presentation_history",
      historyId,
      presentationMediaIds(updated.draft),
      updated.updatedAt,
    );
    await this.pruneHistory(updated.id, updated.updatedAt);
    return clone(normalizePresentationRecord(updated));
  }

  private replayPresentationDraftMutation(
    current: PresentationRecord,
    receipt: PresentationMutationReceipt,
  ): PresentationRecord {
    if (current.draftRevision === receipt.resultingRevision) {
      return clone(normalizePresentationRecord(current));
    }
    const snapshot = this.history.get(`${receipt.presentationId}:${receipt.resultingRevision}`);
    if (snapshot && snapshot.workspaceId === receipt.workspaceId) {
      return clone(presentationAtDraftRevision(current, snapshot));
    }
    throw new PresentationDraftConflictError(
      receipt.resultingRevision,
      current.draftRevision,
      current.lastEditedBy,
    );
  }

  private async pruneHistory(presentationId: string, now: Date) {
    const currentRevision = this.presentations.get(presentationId)?.draftRevision;
    const protectedSourceRevisions = new Set(
      [...this.mutations.values()]
        .filter(
          (receipt) =>
            receipt.presentationId === presentationId &&
            receipt.resultingRevision === currentRevision &&
            receipt.recoveryPackUpdateSourceRevision != null,
        )
        .map((receipt) => receipt.recoveryPackUpdateSourceRevision!),
    );
    const snapshots = [...this.history.entries()]
      .filter(([, item]) => item.presentationId === presentationId)
      .sort((left, right) => right[1].revision - left[1].revision);
    const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
    for (const [index, [key, snapshot]] of snapshots.entries()) {
      if (protectedSourceRevisions.has(snapshot.revision)) continue;
      if (index >= 20 || snapshot.createdAt.getTime() < cutoff) {
        this.history.delete(key);
        await this.repository?.replaceMediaReferences(
          snapshot.workspaceId,
          "presentation_history",
          snapshot.id,
          [],
          now,
        );
      }
    }
    for (const [key, receipt] of this.mutations) {
      if (
        receipt.presentationId === presentationId &&
        receipt.createdAt.getTime() < cutoff &&
        !(
          receipt.recoveryPackUpdateSourceRevision != null &&
          receipt.resultingRevision === currentRevision
        )
      ) {
        this.mutations.delete(key);
      }
    }
  }

  async publishPresentation(input: PresentationVersionRecord, expectedDraftRevision: number) {
    const presentation = this.presentations.get(input.presentationId);
    if (!presentation || presentation.workspaceId !== input.workspaceId) {
      throw new Error("Presentation not found");
    }
    if (presentation.status === "archived") throw new PresentationArchivedError();
    if (presentation.draftRevision !== expectedDraftRevision) {
      throw new PresentationDraftConflictError(
        expectedDraftRevision,
        presentation.draftRevision,
        presentation.lastEditedBy,
      );
    }
    const normalizedInput = normalizePresentationVersion(input);
    const existing = [...this.versions.values()].find(
      (version) =>
        version.presentationId === normalizedInput.presentationId &&
        version.contentHash === normalizedInput.contentHash,
    );
    const version = existing ? normalizePresentationVersion(existing) : clone(normalizedInput);
    this.repository?.validateMediaReferences(
      input.workspaceId,
      presentationMediaIds(version.content),
    );
    this.versions.set(version.id, version);
    Object.assign(presentation, {
      status: "published",
      currentVersionId: version.id,
      publishedDraftRevision: expectedDraftRevision,
      updatedAt: new Date(),
    });
    await this.repository?.replaceMediaReferences(
      version.workspaceId,
      "presentation_version",
      version.id,
      presentationMediaIds(version.content),
      version.publishedAt,
    );
    return clone(version);
  }

  async getPresentationVersion(workspaceId: string, versionId: string) {
    const version = this.versions.get(versionId);
    return version?.workspaceId === workspaceId
      ? clone(normalizePresentationVersion(version))
      : null;
  }

  async listPresentationHistory(workspaceId: string, presentationId: string, limit = 20) {
    return [...this.history.values()]
      .filter(
        (snapshot) =>
          snapshot.workspaceId === workspaceId && snapshot.presentationId === presentationId,
      )
      .sort((left, right) => right.revision - left.revision)
      .slice(0, limit)
      .map((snapshot) => clone(normalizePresentationHistory(snapshot)));
  }

  async restorePresentationHistory(input: {
    workspaceId: string;
    presentationId: string;
    historyRevision: number;
    expectedRevision: number;
    mutationId: string;
    editorId: string;
  }) {
    const presentation = this.presentations.get(input.presentationId);
    if (!presentation || presentation.workspaceId !== input.workspaceId) return null;
    const draftHash = `restore:${input.historyRevision}`;
    const retry = this.mutations.get(mutationKey(input.workspaceId, input.mutationId));
    if (retry) {
      assertMutationMatches(retry, { ...input, draftHash });
      return this.replayPresentationDraftMutation(presentation, retry);
    }
    const snapshot = this.history.get(`${input.presentationId}:${input.historyRevision}`);
    if (!snapshot || snapshot.workspaceId !== input.workspaceId) return null;
    return this.updatePresentationDraft({
      ...input,
      draft: normalizePresentationHistory(snapshot).draft,
      draftHash,
    });
  }

  async organizePresentation(workspaceId: string, presentationId: string, folderId: string | null) {
    const presentation = this.presentations.get(presentationId);
    if (!presentation || presentation.workspaceId !== workspaceId) return null;
    if (folderId) {
      const folder = this.repository?.folders.get(folderId);
      if (!folder || folder.workspaceId !== workspaceId || folder.artifactType !== "presentation")
        return null;
    }
    presentation.folderId = folderId;
    presentation.updatedAt = new Date();
    return clone(normalizePresentationRecord(presentation));
  }

  async deletePresentation(
    workspaceId: string,
    presentationId: string,
  ): Promise<LibraryArtifactDeletionResult> {
    const presentation = this.presentations.get(presentationId);
    if (!presentation || presentation.workspaceId !== workspaceId) return "not_found";
    if (presentation.status !== "archived") return "not_archived";
    if (this.repository?.isLibraryArtifactReferenced(workspaceId, "presentation", presentationId))
      return "in_use";

    const versionIds = new Set<string>();
    const historyIds = new Set<string>();
    for (const [id, version] of this.versions) {
      if (version.workspaceId === workspaceId && version.presentationId === presentationId) {
        versionIds.add(id);
        this.versions.delete(id);
      }
    }
    for (const [key, snapshot] of this.history) {
      if (snapshot.workspaceId === workspaceId && snapshot.presentationId === presentationId) {
        historyIds.add(snapshot.id);
        this.history.delete(key);
      }
    }
    for (const [key, mutation] of this.mutations) {
      if (mutation.workspaceId === workspaceId && mutation.presentationId === presentationId)
        this.mutations.delete(key);
    }
    this.repository?.removeMediaReferencesForOwners(workspaceId, [
      { ownerType: "presentation_draft", ownerId: presentationId },
      ...[...versionIds].map((ownerId) => ({
        ownerType: "presentation_version" as const,
        ownerId,
      })),
      ...[...historyIds].map((ownerId) => ({
        ownerType: "presentation_history" as const,
        ownerId,
      })),
    ]);
    this.presentations.delete(presentationId);
    this.repository?.markLibraryArtifactDeleted(workspaceId, "presentation", presentationId);
    this.repository?.deleteLibraryArtifactMetadata(workspaceId, "presentation", presentationId);
    return "deleted";
  }

  async archivePresentation(workspaceId: string, presentationId: string, archived: boolean) {
    const presentation = this.presentations.get(presentationId);
    if (!presentation || presentation.workspaceId !== workspaceId) return null;
    presentation.status = archived
      ? "archived"
      : presentation.currentVersionId
        ? "published"
        : "draft";
    presentation.updatedAt = new Date();
    return clone(normalizePresentationRecord(presentation));
  }
}

export class PostgresPresentationRepository implements PresentationRepository {
  constructor(private readonly repository: PostgresRepository) {}

  private async transaction<T>(workspaceId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
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

  private async replayPresentationDraftMutation(
    client: PoolClient,
    input: Pick<PresentationDraftUpdate, "workspaceId" | "presentationId">,
    receipt: PresentationMutationReceipt,
    currentRow?: QueryResultRow,
  ): Promise<PresentationRecord | null> {
    const currentResult = currentRow
      ? null
      : await client.query("SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2", [
          input.workspaceId,
          input.presentationId,
        ]);
    const row = currentRow ?? currentResult?.rows[0];
    if (!row) return null;
    const current = mapPresentation(row);
    if (current.draftRevision === receipt.resultingRevision) return current;

    const history = await client.query(
      `SELECT * FROM presentation_draft_history
       WHERE workspace_id = $1 AND presentation_id = $2 AND revision = $3`,
      [input.workspaceId, input.presentationId, receipt.resultingRevision],
    );
    if (history.rows[0]) {
      return presentationAtDraftRevision(current, mapPresentationHistory(history.rows[0]));
    }
    throw new PresentationDraftConflictError(
      receipt.resultingRevision,
      current.draftRevision,
      current.lastEditedBy,
    );
  }

  async listPresentations(workspaceId: string, includeArchived = false) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT id, workspace_id, title, description, status, draft, draft_revision,
                draft_schema_version, current_version_id, folder_id, published_draft_revision,
                last_edited_by, created_at, updated_at
         FROM presentations
         WHERE workspace_id = $1 AND ($2::boolean OR status <> 'archived')
         ORDER BY updated_at DESC`,
        [workspaceId, includeArchived],
      );
      return result.rows.map(mapPresentationSummary);
    });
  }

  async createPresentation(input: PresentationRecord) {
    const normalized = normalizePresentationRecord(input);
    return this.transaction(normalized.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO presentations
           (id, workspace_id, title, description, status, draft, draft_revision,
            draft_schema_version, current_version_id, folder_id, published_draft_revision,
            last_edited_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          normalized.id,
          normalized.workspaceId,
          normalized.title,
          normalized.description,
          normalized.status,
          JSON.stringify(normalized.draft),
          normalized.draftRevision,
          normalized.draftSchemaVersion,
          normalized.currentVersionId,
          normalized.folderId,
          normalized.publishedDraftRevision,
          normalized.lastEditedBy,
          normalized.createdAt,
          normalized.updatedAt,
        ],
      );
      await client.query(
        `INSERT INTO presentation_draft_history
           (id, workspace_id, presentation_id, revision, draft, draft_schema_version,
            saved_by, mutation_id, created_at)
         VALUES ($1,$2,$3,0,$4,$5,$6,NULL,$7)`,
        [
          randomUUID(),
          normalized.workspaceId,
          normalized.id,
          JSON.stringify(normalized.draft),
          normalized.draftSchemaVersion,
          normalized.lastEditedBy,
          normalized.createdAt,
        ],
      );
      return mapPresentation(result.rows[0]!);
    });
  }

  async getPresentation(workspaceId: string, presentationId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2",
        [workspaceId, presentationId],
      );
      return result.rows[0] ? mapPresentation(result.rows[0]) : null;
    });
  }

  async updatePresentationDraft(input: PresentationDraftUpdate) {
    const draft = upcastPresentationDraft(input.draft, input.draft.schemaVersion);
    return this.transaction(input.workspaceId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        mutationKey(input.workspaceId, input.mutationId),
      ]);
      const locked = await client.query(
        "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.presentationId],
      );
      if (!locked.rows[0]) return null;
      assertRecoveryPackUpdateSource(input);
      const retried = await client.query(
        `SELECT * FROM presentation_draft_mutations
         WHERE workspace_id = $1 AND mutation_id = $2`,
        [input.workspaceId, input.mutationId],
      );
      if (retried.rows[0]) {
        const receipt = mapMutationReceipt(retried.rows[0]);
        assertMutationMatches(receipt, input);
        return this.replayPresentationDraftMutation(client, input, receipt, locked.rows[0]);
      }
      if (locked.rows[0].status === "archived") return null;
      const currentRevision = Number(locked.rows[0].draft_revision);
      if (currentRevision !== input.expectedRevision) {
        throw new PresentationDraftConflictError(
          input.expectedRevision,
          currentRevision,
          locked.rows[0].last_edited_by ? String(locked.rows[0].last_edited_by) : null,
        );
      }
      const comparison = await client.query<{ meaningful: boolean }>(
        "SELECT $1::jsonb <> $2::jsonb AS meaningful",
        [JSON.stringify(locked.rows[0].draft), JSON.stringify(draft)],
      );
      const meaningful = comparison.rows[0]?.meaningful ?? true;
      if (input.recoveryPackUpdateSourceRevision != null && !meaningful) {
        throw new PresentationMutationConflictError(input.mutationId);
      }
      const revision = meaningful ? currentRevision + 1 : currentRevision;
      await client.query(
        `INSERT INTO presentation_draft_mutations
           (mutation_id, workspace_id, presentation_id, expected_revision, resulting_revision,
            draft_hash, recovery_pack_update_source_revision)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.mutationId,
          input.workspaceId,
          input.presentationId,
          input.expectedRevision,
          revision,
          input.draftHash,
          input.recoveryPackUpdateSourceRevision ?? null,
        ],
      );
      if (!meaningful) return mapPresentation(locked.rows[0]);

      const updated = await client.query(
        `UPDATE presentations SET title = $3, description = $4, draft = $5,
           draft_revision = $6, draft_schema_version = $7, last_edited_by = $8,
           updated_at = now()
         WHERE workspace_id = $1 AND id = $2 RETURNING *`,
        [
          input.workspaceId,
          input.presentationId,
          draft.title,
          draft.description,
          JSON.stringify(draft),
          revision,
          draft.schemaVersion,
          input.editorId,
        ],
      );
      await client.query(
        `INSERT INTO presentation_draft_history
           (id, workspace_id, presentation_id, revision, draft, draft_schema_version,
            saved_by, mutation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          input.workspaceId,
          input.presentationId,
          revision,
          JSON.stringify(draft),
          draft.schemaVersion,
          input.editorId,
          input.mutationId,
        ],
      );
      await this.pruneHistory(client, input.workspaceId, input.presentationId);
      return mapPresentation(updated.rows[0]!);
    });
  }

  private async pruneHistory(client: PoolClient, workspaceId: string, presentationId: string) {
    await client.query(
      `DELETE FROM presentation_draft_history history
       WHERE history.workspace_id = $1 AND history.presentation_id = $2
         AND (history.created_at < now() - interval '30 days' OR history.id NOT IN (
           SELECT kept.id FROM presentation_draft_history kept
           WHERE kept.workspace_id = $1 AND kept.presentation_id = $2
           ORDER BY kept.revision DESC LIMIT 20
         ))
         AND NOT EXISTS (
           SELECT 1 FROM presentation_draft_mutations mutation
           JOIN presentations presentation
             ON presentation.workspace_id = mutation.workspace_id
            AND presentation.id = mutation.presentation_id
           WHERE mutation.workspace_id = history.workspace_id
             AND mutation.presentation_id = history.presentation_id
             AND mutation.recovery_pack_update_source_revision = history.revision
             AND mutation.resulting_revision = presentation.draft_revision
         )`,
      [workspaceId, presentationId],
    );
    await client.query(
      `DELETE FROM presentation_draft_mutations mutation
       WHERE mutation.workspace_id = $1 AND mutation.presentation_id = $2
         AND mutation.created_at < now() - interval '30 days'
         AND NOT EXISTS (
           SELECT 1 FROM presentations presentation
           WHERE presentation.workspace_id = mutation.workspace_id
             AND presentation.id = mutation.presentation_id
             AND mutation.recovery_pack_update_source_revision IS NOT NULL
             AND mutation.resulting_revision = presentation.draft_revision
         )`,
      [workspaceId, presentationId],
    );
  }

  async publishPresentation(input: PresentationVersionRecord, expectedDraftRevision: number) {
    return this.transaction(input.workspaceId, async (client) => {
      const locked = await client.query(
        "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.presentationId],
      );
      if (!locked.rows[0]) throw new Error("Presentation not found");
      if (locked.rows[0].status === "archived") throw new PresentationArchivedError();
      const currentRevision = Number(locked.rows[0].draft_revision);
      if (currentRevision !== expectedDraftRevision) {
        throw new PresentationDraftConflictError(
          expectedDraftRevision,
          currentRevision,
          locked.rows[0].last_edited_by ? String(locked.rows[0].last_edited_by) : null,
        );
      }
      const normalized = normalizePresentationVersion(input);
      const existing = await client.query(
        `SELECT * FROM presentation_versions
         WHERE workspace_id = $1 AND presentation_id = $2 AND content_hash = $3`,
        [normalized.workspaceId, normalized.presentationId, normalized.contentHash],
      );
      let version = existing.rows[0] ? mapPresentationVersion(existing.rows[0]) : null;
      if (!version) {
        const inserted = await client.query(
          `INSERT INTO presentation_versions
             (id, workspace_id, presentation_id, version, content, content_schema_version,
              content_hash, source_draft_revision, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            normalized.id,
            normalized.workspaceId,
            normalized.presentationId,
            normalized.version,
            JSON.stringify(normalized.content),
            normalized.contentSchemaVersion,
            normalized.contentHash,
            normalized.sourceDraftRevision,
            normalized.publishedAt,
          ],
        );
        version = mapPresentationVersion(inserted.rows[0]!);
      }
      await client.query(
        `UPDATE presentations SET status = 'published', current_version_id = $3,
           published_draft_revision = $4, updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [normalized.workspaceId, normalized.presentationId, version.id, expectedDraftRevision],
      );
      return version;
    });
  }

  async getPresentationVersion(workspaceId: string, versionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_versions WHERE workspace_id = $1 AND id = $2",
        [workspaceId, versionId],
      );
      return result.rows[0] ? mapPresentationVersion(result.rows[0]) : null;
    });
  }

  async listPresentationHistory(workspaceId: string, presentationId: string, limit = 20) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT * FROM presentation_draft_history
         WHERE workspace_id = $1 AND presentation_id = $2
         ORDER BY revision DESC LIMIT $3`,
        [workspaceId, presentationId, limit],
      );
      return result.rows.map(mapPresentationHistory);
    });
  }

  async restorePresentationHistory(input: {
    workspaceId: string;
    presentationId: string;
    historyRevision: number;
    expectedRevision: number;
    mutationId: string;
    editorId: string;
  }) {
    const draftHash = `restore:${input.historyRevision}`;
    const replayReceipt = () =>
      this.transaction(input.workspaceId, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          mutationKey(input.workspaceId, input.mutationId),
        ]);
        const current = await client.query(
          "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [input.workspaceId, input.presentationId],
        );
        if (!current.rows[0]) return { handled: true as const, presentation: null };
        const receipt = await client.query(
          `SELECT * FROM presentation_draft_mutations
           WHERE workspace_id = $1 AND mutation_id = $2`,
          [input.workspaceId, input.mutationId],
        );
        if (!receipt.rows[0]) return { handled: false as const, presentation: null };
        const mappedReceipt = mapMutationReceipt(receipt.rows[0]);
        assertMutationMatches(mappedReceipt, { ...input, draftHash });
        return {
          handled: true as const,
          presentation: await this.replayPresentationDraftMutation(
            client,
            input,
            mappedReceipt,
            current.rows[0],
          ),
        };
      });
    const replayed = await replayReceipt();
    if (replayed.handled) return replayed.presentation;
    const snapshot = await this.transaction(input.workspaceId, async (client) => {
      const history = await client.query(
        `SELECT * FROM presentation_draft_history
         WHERE workspace_id = $1 AND presentation_id = $2 AND revision = $3`,
        [input.workspaceId, input.presentationId, input.historyRevision],
      );
      return history.rows[0] ? mapPresentationHistory(history.rows[0]) : null;
    });
    if (!snapshot) {
      const racedReplay = await replayReceipt();
      return racedReplay.handled ? racedReplay.presentation : null;
    }
    return this.updatePresentationDraft({
      ...input,
      draft: snapshot.draft,
      draftHash,
    });
  }

  async organizePresentation(workspaceId: string, presentationId: string, folderId: string | null) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentations SET folder_id = $3, updated_at = now()
         WHERE workspace_id = $1 AND id = $2
           AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM folders WHERE workspace_id = $1 AND id = $3 AND artifact_type = 'presentation'
           ))
         RETURNING *`,
        [workspaceId, presentationId, folderId],
      );
      return result.rows[0] ? mapPresentation(result.rows[0]) : null;
    });
  }

  async deletePresentation(
    workspaceId: string,
    presentationId: string,
  ): Promise<LibraryArtifactDeletionResult> {
    try {
      return await this.transaction(workspaceId, async (client) => {
        const current = await client.query(
          "SELECT status FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [workspaceId, presentationId],
        );
        if (!current.rows[0]) return "not_found";
        if (current.rows[0].status !== "archived") return "not_archived";
        const referenced = await client.query(
          `SELECT 1 FROM presentation_live_sessions
           WHERE workspace_id = $1 AND presentation_id = $2 LIMIT 1`,
          [workspaceId, presentationId],
        );
        if (referenced.rows[0]) return "in_use";
        // Cascades run with the parent table owner's privileges, preserving version immutability grants.
        await client.query("DELETE FROM presentations WHERE workspace_id = $1 AND id = $2", [
          workspaceId,
          presentationId,
        ]);
        return "deleted";
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23503") return "in_use";
      throw error;
    }
  }

  async archivePresentation(workspaceId: string, presentationId: string, archived: boolean) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentations
         SET status = CASE
               WHEN $3 THEN 'archived'
               WHEN current_version_id IS NOT NULL THEN 'published'
               ELSE 'draft'
             END,
             archived_at = CASE WHEN $3 THEN now() ELSE NULL END,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [workspaceId, presentationId, archived],
      );
      return result.rows[0] ? mapPresentation(result.rows[0]) : null;
    });
  }
}

export function createPresentationRepository(repository: Repository): PresentationRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationRepository(repository);
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "presentations",
      () => new MemoryPresentationRepository(repository),
    );
  }
  return new MemoryPresentationRepository();
}
