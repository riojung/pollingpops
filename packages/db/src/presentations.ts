import { createHash, randomUUID } from "node:crypto";
import { CreatePresentationSchema, type PresentationDraft } from "@openround/contracts";
import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { assertMemoryPresentationVisualImportReady } from "./presentation-visual-imports.js";
import { PresentationVisualImportError } from "./presentation-visual-import-types.js";
import { assertMemoryPresentationAssistanceReady } from "./presentation-assistance.js";
import { PresentationAssistanceError } from "./presentation-assistance-types.js";
import {
  assertMemoryPresentationTextAssistanceReady,
  assertPresentationTextAssistanceSource,
} from "./presentation-text-assistance.js";
import { PresentationTextAssistanceError } from "./presentation-text-assistance-types.js";
import {
  assertMemoryPresentationQuestionSuggestionsReady,
  assertPresentationQuestionSuggestionsSource,
  assertPresentationQuestionSuggestionsInsertion,
} from "./presentation-question-suggestions.js";
import { PresentationQuestionSuggestionsError } from "./presentation-question-suggestions-types.js";
import { lockPresentationAssistanceActors } from "./presentation-assistance-identity.js";
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
  PresentationCreationError,
  type PresentationCreationIntent,
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

interface PresentationCreationReceipt {
  workspaceId: string;
  presentationId: string;
  intentHash: string;
}

function creationIdentity(input: PresentationRecord, intent: PresentationCreationIntent) {
  const request = CreatePresentationSchema.parse({
    title: input.title,
    description: input.description,
    ...intent,
  });
  if (
    request.creationContext?.actorId !== input.lastEditedBy?.toLowerCase() ||
    request.creationContext?.workspaceId !== input.workspaceId.toLowerCase()
  )
    throw new PresentationCreationError("CONFLICT");
  if (
    !input.lastEditedBy ||
    input.status !== "draft" ||
    input.draftRevision !== 0 ||
    input.currentVersionId !== null ||
    input.publishedDraftRevision !== null ||
    input.folderId !== null ||
    !Number.isFinite(input.createdAt.getTime()) ||
    presentationMediaIds(input.draft).length
  )
    throw new PresentationCreationError("CONFLICT");
  return {
    requestId: request.creationRequestId!,
    intentHash: createHash("sha256")
      .update(
        JSON.stringify({
          kind: "presentation-creation-v1",
          actorId: input.lastEditedBy.toLowerCase(),
          workspaceId: input.workspaceId.toLowerCase(),
          creationContext: request.creationContext,
          title: request.title,
          description: request.description,
          initialSlide: request.initialSlide ?? "classic",
        }),
      )
      .digest("hex"),
  };
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
    previewBlock: presentationLibraryPreview(draft),
  };
}

function presentationLibraryPreview(draft: PresentationDraft) {
  const block = draft.blocks.find((item) => !item.hidden);
  if (!block) return null;
  return block.kind === "content"
    ? {
        ...block,
        speakerNotes: "",
        citations: [],
        sourceDisclosure: undefined,
        textAssistance: undefined,
      }
    : block;
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
  private readonly creations = new Map<string, PresentationCreationReceipt>();
  private readonly creationLocks = new Map<string, Promise<void>>();

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
      | "users"
      | "workspaceMembers"
      | "workspaces"
      | "workspaceMediaDeletionClaims"
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
    for (const [requestId, receipt] of this.creations)
      if (ownedWorkspaceIds.has(receipt.workspaceId)) this.creations.delete(requestId);
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
        return {
          ...summary,
          blockCount: draft.blocks.length,
          previewBlock: presentationLibraryPreview(draft),
        };
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

  async createPresentationIdempotently(
    input: PresentationRecord,
    intent: PresentationCreationIntent,
  ) {
    const identity = creationIdentity(input, intent);
    const previous = this.creationLocks.get(identity.requestId) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.creationLocks.set(identity.requestId, lock);
    await previous;
    try {
      const actor = this.repository?.users.get(input.lastEditedBy!);
      const member = this.repository?.workspaceMembers.get(
        `${input.workspaceId}:${input.lastEditedBy}`,
      );
      if (
        !actor ||
        actor.deletedAt ||
        !member ||
        !["owner", "editor"].includes(member.role) ||
        !this.repository?.workspaces.has(input.workspaceId) ||
        this.repository.workspaceMediaDeletionClaims.has(input.workspaceId)
      )
        throw new PresentationCreationError("UNAUTHORIZED");
      const prior = this.creations.get(identity.requestId);
      if (prior) {
        if (prior.workspaceId !== input.workspaceId || prior.intentHash !== identity.intentHash)
          throw new PresentationCreationError("CONFLICT");
        const presentation = this.presentations.get(prior.presentationId);
        if (!presentation) throw new PresentationCreationError("DELETED");
        return {
          status: "duplicate" as const,
          presentation: clone(normalizePresentationRecord(presentation)),
        };
      }
      if (this.presentations.has(input.id)) throw new PresentationCreationError("CONFLICT");
      const presentation = await this.createPresentation(input);
      this.creations.set(identity.requestId, {
        workspaceId: input.workspaceId,
        presentationId: presentation.id,
        intentHash: identity.intentHash,
      });
      return { status: "created" as const, presentation };
    } finally {
      release();
      if (this.creationLocks.get(identity.requestId) === lock)
        this.creationLocks.delete(identity.requestId);
    }
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
    if (
      (input.assistanceJobId || input.textAssistanceJobId || input.questionSuggestionsJobId) &&
      this.repository instanceof MemoryRepository
    ) {
      const editor = this.repository.users.get(input.editorId),
        member = this.repository.workspaceMembers.get(`${input.workspaceId}:${input.editorId}`);
      if (
        !editor ||
        editor.deletedAt ||
        !member ||
        !["owner", "editor"].includes(member.role) ||
        this.repository.workspaceMediaDeletionClaims.has(input.workspaceId)
      )
        throw input.questionSuggestionsJobId
          ? new PresentationQuestionSuggestionsError("CONFLICT")
          : input.textAssistanceJobId
            ? new PresentationTextAssistanceError("CONFLICT")
            : new PresentationAssistanceError("CONFLICT");
    }
    const key = mutationKey(input.workspaceId, input.mutationId);
    const retry = this.mutations.get(key);
    if (retry) {
      assertMutationMatches(retry, input);
      return this.replayPresentationDraftMutation(presentation, retry);
    }
    if (presentation.status === "archived") return null;
    if (input.visualImportId && this.repository instanceof MemoryRepository) {
      assertMemoryPresentationVisualImportReady(
        this.repository,
        input.workspaceId,
        input.presentationId,
        input.visualImportId,
      );
    }
    if (input.assistanceJobId && this.repository instanceof MemoryRepository) {
      assertMemoryPresentationAssistanceReady(
        this.repository,
        input.workspaceId,
        input.presentationId,
        input.assistanceJobId,
        input.assistanceProposalHash ?? "",
      );
    }
    if (input.textAssistanceJobId && this.repository instanceof MemoryRepository) {
      assertMemoryPresentationTextAssistanceReady(
        this.repository,
        input.workspaceId,
        input.presentationId,
        input.textAssistanceJobId,
        input.textAssistanceProposalHash ?? "",
        input.textAssistanceSourceDigest ?? "",
        input.textAssistanceBlockId ?? "",
        input.textAssistanceNodeId ?? "",
        normalizePresentationRecord(presentation).draft,
        input.textAssistanceTargetLanguage,
        input.textAssistanceSourceLanguage,
      );
    }
    if (input.questionSuggestionsJobId && this.repository instanceof MemoryRepository) {
      assertMemoryPresentationQuestionSuggestionsReady(
        this.repository,
        input.workspaceId,
        input.presentationId,
        input.questionSuggestionsJobId,
        input.questionSuggestionsProposalHash ?? "",
        input.questionSuggestionsSourceDigest ?? "",
        input.questionSuggestionsBlockId ?? "",
        input.questionSuggestionsSuggestionId ?? "",
        normalizePresentationRecord(presentation).draft,
        draft,
        input.mutationId,
      );
    }
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

  async recoverPresentationDraftMutation(
    input: Pick<
      PresentationDraftUpdate,
      "workspaceId" | "presentationId" | "expectedRevision" | "mutationId" | "draftHash"
    >,
  ) {
    const presentation = this.presentations.get(input.presentationId);
    if (!presentation || presentation.workspaceId !== input.workspaceId) return null;
    const receipt = this.mutations.get(mutationKey(input.workspaceId, input.mutationId));
    if (!receipt) return null;
    assertMutationMatches(receipt, input);
    return this.replayPresentationDraftMutation(presentation, receipt);
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

  async recoverPresentationDraftMutation(
    input: Pick<
      PresentationDraftUpdate,
      "workspaceId" | "presentationId" | "expectedRevision" | "mutationId" | "draftHash"
    >,
  ) {
    return this.transaction(input.workspaceId, async (client) => {
      const current = await client.query(
        "SELECT * FROM presentations WHERE workspace_id=$1 AND id=$2 FOR SHARE",
        [input.workspaceId, input.presentationId],
      );
      if (!current.rows[0]) return null;
      const stored = await client.query(
        "SELECT * FROM presentation_draft_mutations WHERE workspace_id=$1 AND mutation_id=$2",
        [input.workspaceId, input.mutationId],
      );
      if (!stored.rows[0]) return null;
      const receipt = mapMutationReceipt(stored.rows[0]);
      assertMutationMatches(receipt, input);
      return this.replayPresentationDraftMutation(client, input, receipt, current.rows[0]);
    });
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

  private async insertPresentation(client: PoolClient, normalized: PresentationRecord) {
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
  }

  async createPresentation(input: PresentationRecord) {
    const normalized = normalizePresentationRecord(input);
    return this.transaction(normalized.workspaceId, (client) =>
      this.insertPresentation(client, normalized),
    );
  }

  async createPresentationIdempotently(
    input: PresentationRecord,
    intent: PresentationCreationIntent,
  ) {
    const identity = creationIdentity(input, intent);
    try {
      return await this.transaction(input.workspaceId, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `presentation-creation:${identity.requestId}`,
        ]);
        const active = await lockPresentationAssistanceActors(client, [input.lastEditedBy!]);
        const workspace = await client.query(
          "SELECT id FROM workspaces WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) FOR SHARE",
          [input.workspaceId],
        );
        const member = await client.query(
          "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role IN('owner','editor') FOR SHARE",
          [input.workspaceId, input.lastEditedBy],
        );
        if (active.rowCount !== 1 || workspace.rowCount !== 1 || member.rowCount !== 1)
          throw new PresentationCreationError("UNAUTHORIZED");
        const prior = await client.query(
          "SELECT presentation_id,intent_hash FROM presentation_creation_receipts WHERE workspace_id=$1 AND request_id=$2",
          [input.workspaceId, identity.requestId],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].intent_hash !== identity.intentHash)
            throw new PresentationCreationError("CONFLICT");
          const current = await client.query(
            "SELECT * FROM presentations WHERE workspace_id=$1 AND id=$2 FOR SHARE",
            [input.workspaceId, prior.rows[0].presentation_id],
          );
          if (!current.rows[0]) throw new PresentationCreationError("DELETED");
          return { status: "duplicate" as const, presentation: mapPresentation(current.rows[0]) };
        }
        const presentation = await this.insertPresentation(
          client,
          normalizePresentationRecord(input),
        );
        const receipt = await client.query(
          "INSERT INTO presentation_creation_receipts(request_id,workspace_id,presentation_id,intent_hash,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id) DO NOTHING RETURNING request_id",
          [
            identity.requestId,
            input.workspaceId,
            presentation.id,
            identity.intentHash,
            input.createdAt,
          ],
        );
        if (receipt.rowCount !== 1) throw new PresentationCreationError("CONFLICT");
        return { status: "created" as const, presentation };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new PresentationCreationError("CONFLICT");
      throw error;
    }
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
      let assistanceActorsReady = false;
      let assistanceEditorReady = false;
      if (input.assistanceJobId || input.textAssistanceJobId || input.questionSuggestionsJobId) {
        const source = await client.query<{ created_by: string | null }>(
          `SELECT created_by FROM ${input.questionSuggestionsJobId ? "presentation_question_suggestions_jobs" : input.textAssistanceJobId ? "presentation_text_assistance_jobs" : "presentation_assistance_jobs"} WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3`,
          [
            input.workspaceId,
            input.presentationId,
            input.questionSuggestionsJobId ?? input.textAssistanceJobId ?? input.assistanceJobId,
          ],
        );
        const creator = source.rows[0]?.created_by;
        const actors = [...new Set([input.editorId, ...(creator ? [creator] : [])])].sort();
        const activeActors = await lockPresentationAssistanceActors(client, actors);
        const workspace = await client.query(
          "SELECT id FROM workspaces WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) FOR SHARE",
          [input.workspaceId],
        );
        const members = await client.query(
          "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND role IN('owner','editor') ORDER BY user_id FOR SHARE",
          [input.workspaceId, actors],
        );
        assistanceActorsReady =
          !!creator &&
          activeActors.rowCount === actors.length &&
          workspace.rowCount === 1 &&
          members.rowCount === actors.length;
        assistanceEditorReady =
          workspace.rowCount === 1 &&
          activeActors.rows.some((actor) => actor.id === input.editorId) &&
          members.rows.some((member) => member.user_id === input.editorId);
      }
      if (input.visualImportId) {
        await client.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [input.workspaceId]);
      }
      const locked = await client.query(
        "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.presentationId],
      );
      if (!locked.rows[0]) return null;
      assertRecoveryPackUpdateSource(input);
      if (
        (input.assistanceJobId || input.textAssistanceJobId || input.questionSuggestionsJobId) &&
        !assistanceEditorReady
      )
        throw input.questionSuggestionsJobId
          ? new PresentationQuestionSuggestionsError("CONFLICT")
          : input.textAssistanceJobId
            ? new PresentationTextAssistanceError("CONFLICT")
            : new PresentationAssistanceError("CONFLICT");
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
      if (input.assistanceJobId) {
        const source = await client.query(
          "SELECT id FROM presentation_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 FOR SHARE",
          [input.workspaceId, input.presentationId, input.assistanceJobId],
        );
        const ready = await client.query(
          "SELECT id FROM presentation_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 AND status='ready' AND proposal_hash=$4 AND expires_at>clock_timestamp()",
          [
            input.workspaceId,
            input.presentationId,
            input.assistanceJobId,
            input.assistanceProposalHash ?? "",
          ],
        );
        if (!assistanceActorsReady || source.rowCount !== 1 || ready.rowCount !== 1)
          throw new PresentationAssistanceError(
            "CONFLICT",
            "This reviewed proposal is no longer available to insert",
          );
      }
      if (input.textAssistanceJobId) {
        if (
          !input.textAssistanceProposalHash ||
          !input.textAssistanceSourceDigest ||
          !input.textAssistanceBlockId ||
          !input.textAssistanceNodeId
        )
          throw new PresentationTextAssistanceError("CONFLICT");
        const ready = await client.query(
          "SELECT role,operation,target_language,source_language FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 AND status='ready' AND proposal_hash=$4 AND source_digest=$5 AND block_id=$6 AND node_id=$7 AND expires_at>clock_timestamp() FOR SHARE",
          [
            input.workspaceId,
            input.presentationId,
            input.textAssistanceJobId,
            input.textAssistanceProposalHash ?? "",
            input.textAssistanceSourceDigest ?? "",
            input.textAssistanceBlockId,
            input.textAssistanceNodeId ?? "",
          ],
        );
        if (
          !assistanceActorsReady ||
          ready.rowCount !== 1 ||
          (ready.rows[0].operation === "translate"
            ? ready.rows[0].target_language !== input.textAssistanceTargetLanguage ||
              ready.rows[0].source_language !== input.textAssistanceSourceLanguage
            : input.textAssistanceTargetLanguage !== undefined ||
              input.textAssistanceSourceLanguage !== undefined)
        )
          throw new PresentationTextAssistanceError(
            "CONFLICT",
            "This reviewed text proposal is no longer available to apply",
          );
        const current = mapPresentation(locked.rows[0]);
        assertPresentationTextAssistanceSource(
          current.draft,
          input.textAssistanceBlockId ?? "",
          input.textAssistanceNodeId ?? "",
          input.textAssistanceSourceDigest ?? "",
          ready.rows[0].role,
          undefined,
          ready.rows[0].operation === "translate" ? ready.rows[0].source_language : undefined,
        );
      }
      if (input.questionSuggestionsJobId) {
        if (
          !input.questionSuggestionsProposalHash ||
          !input.questionSuggestionsSourceDigest ||
          !input.questionSuggestionsBlockId ||
          !input.questionSuggestionsSuggestionId
        )
          throw new PresentationQuestionSuggestionsError("CONFLICT");
        const ready = await client.query(
          "SELECT proposal FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 AND status='ready' AND proposal_hash=$4 AND source_digest=$5 AND block_id=$6 AND expires_at>clock_timestamp() FOR SHARE",
          [
            input.workspaceId,
            input.presentationId,
            input.questionSuggestionsJobId,
            input.questionSuggestionsProposalHash,
            input.questionSuggestionsSourceDigest,
            input.questionSuggestionsBlockId,
          ],
        );
        if (!assistanceActorsReady || ready.rowCount !== 1)
          throw new PresentationQuestionSuggestionsError("CONFLICT");
        const current = mapPresentation(locked.rows[0]);
        assertPresentationQuestionSuggestionsSource(
          current.draft,
          input.questionSuggestionsBlockId,
          input.questionSuggestionsSourceDigest,
          ready.rows[0].proposal.source,
        );
        assertPresentationQuestionSuggestionsInsertion({
          draft,
          current: current.draft,
          proposal: ready.rows[0].proposal,
          jobId: input.questionSuggestionsJobId,
          suggestionId: input.questionSuggestionsSuggestionId,
          mutationId: input.mutationId,
        });
      }
      if (input.visualImportId) {
        await client.query(
          "SELECT id FROM presentation_visual_imports WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 FOR SHARE",
          [input.workspaceId, input.presentationId, input.visualImportId],
        );
        const ready = await client.query(
          "SELECT id FROM presentation_visual_imports WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 AND status='ready' AND expires_at>clock_timestamp()",
          [input.workspaceId, input.presentationId, input.visualImportId],
        );
        if (!ready.rows.length)
          throw new PresentationVisualImportError(
            "CONFLICT",
            "This conversion was canceled or expired. Upload the source again.",
          );
      }
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
