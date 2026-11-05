import type { PresentationContent, PresentationDraft } from "@openround/contracts";
import type { LibraryArtifactDeletionResult } from "./types.js";

export interface PresentationRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: PresentationDraft;
  draftRevision: number;
  draftSchemaVersion: number;
  currentVersionId: string | null;
  folderId: string | null;
  publishedDraftRevision: number | null;
  lastEditedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PresentationVersionRecord {
  id: string;
  workspaceId: string;
  presentationId: string;
  version: number;
  content: PresentationContent;
  /** Contract version used to validate and upcast immutable published content. */
  contentSchemaVersion?: number;
  contentHash: string;
  sourceDraftRevision: number;
  publishedAt: Date;
}

export interface PresentationSummaryRecord extends Omit<PresentationRecord, "draft"> {
  blockCount: number;
}

export interface PresentationHistoryRecord {
  id: string;
  workspaceId: string;
  presentationId: string;
  revision: number;
  draft: PresentationDraft;
  /** Contract version used to validate and upcast this recovery snapshot. */
  draftSchemaVersion?: number;
  savedBy: string | null;
  mutationId: string | null;
  createdAt: Date;
}

export interface PresentationDraftUpdate {
  workspaceId: string;
  presentationId: string;
  draft: PresentationDraft;
  expectedRevision: number;
  mutationId: string;
  editorId: string;
  draftHash: string;
  /** Retain the pre-update draft while this accepted Recovery Pack update is current. */
  recoveryPackUpdateSourceRevision?: number | null;
  /** Serialize visual insertion with cancellation and preview expiry. */
  visualImportId?: string;
}

export interface PresentationRepository {
  listPresentations(
    workspaceId: string,
    includeArchived?: boolean,
  ): Promise<PresentationSummaryRecord[]>;
  createPresentation(input: PresentationRecord): Promise<PresentationRecord>;
  getPresentation(workspaceId: string, presentationId: string): Promise<PresentationRecord | null>;
  updatePresentationDraft(input: PresentationDraftUpdate): Promise<PresentationRecord | null>;
  recoverPresentationDraftMutation(
    input: Pick<
      PresentationDraftUpdate,
      "workspaceId" | "presentationId" | "expectedRevision" | "mutationId" | "draftHash"
    >,
  ): Promise<PresentationRecord | null>;
  publishPresentation(
    input: PresentationVersionRecord,
    expectedDraftRevision: number,
  ): Promise<PresentationVersionRecord>;
  getPresentationVersion(
    workspaceId: string,
    versionId: string,
  ): Promise<PresentationVersionRecord | null>;
  listPresentationHistory(
    workspaceId: string,
    presentationId: string,
    limit?: number,
  ): Promise<PresentationHistoryRecord[]>;
  restorePresentationHistory(input: {
    workspaceId: string;
    presentationId: string;
    historyRevision: number;
    expectedRevision: number;
    mutationId: string;
    editorId: string;
  }): Promise<PresentationRecord | null>;
  organizePresentation(
    workspaceId: string,
    presentationId: string,
    folderId: string | null,
  ): Promise<PresentationRecord | null>;
  deletePresentation(
    workspaceId: string,
    presentationId: string,
  ): Promise<LibraryArtifactDeletionResult>;
  archivePresentation(
    workspaceId: string,
    presentationId: string,
    archived: boolean,
  ): Promise<PresentationRecord | null>;
}

export class PresentationDraftConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
    public readonly currentEditorId: string | null,
  ) {
    super("The presentation was changed in another editor");
    this.name = "PresentationDraftConflictError";
  }
}

export class PresentationMutationConflictError extends Error {
  constructor(public readonly mutationId: string) {
    super("The presentation mutation ID was already used for another change");
    this.name = "PresentationMutationConflictError";
  }
}

export class PresentationArchivedError extends Error {
  constructor() {
    super("Archived presentations cannot be published");
    this.name = "PresentationArchivedError";
  }
}
