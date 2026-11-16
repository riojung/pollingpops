import type {
  PresentationContent,
  PresentationDraft,
  PresentationBlockDraft,
  PresentationTextLanguage,
} from "@openround/contracts";
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
  /** Creator-only first visible slide for Library recognition; no separate draft fetch. */
  previewBlock?: PresentationBlockDraft | null;
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
  /** Serialize reviewed AI insertion with source erasure, role changes and expiry. */
  assistanceJobId?: string;
  assistanceProposalHash?: string;
  /** Bind a reviewed single-node text replacement inside the locked draft transaction. */
  textAssistanceJobId?: string;
  textAssistanceProposalHash?: string;
  textAssistanceSourceDigest?: string;
  textAssistanceBlockId?: string;
  textAssistanceNodeId?: string;
  textAssistanceTargetLanguage?: PresentationTextLanguage;
  textAssistanceSourceLanguage?: PresentationTextLanguage | null;
  /** Serialize reviewed question insertion with exact saved source and private proposal authority. */
  questionSuggestionsJobId?: string;
  questionSuggestionsProposalHash?: string;
  questionSuggestionsSourceDigest?: string;
  questionSuggestionsBlockId?: string;
  questionSuggestionsSuggestionId?: string;
}

export interface PresentationRepository {
  listPresentations(
    workspaceId: string,
    includeArchived?: boolean,
  ): Promise<PresentationSummaryRecord[]>;
  createPresentation(input: PresentationRecord): Promise<PresentationRecord>;
  createPresentationIdempotently(
    input: PresentationRecord,
    intent: PresentationCreationIntent,
  ): Promise<{ status: "created" | "duplicate"; presentation: PresentationRecord }>;
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

export class PresentationCreationError extends Error {
  constructor(readonly code: "CONFLICT" | "DELETED" | "UNAUTHORIZED") {
    super("This presentation creation request is unavailable");
    this.name = "PresentationCreationError";
  }
}

export interface PresentationCreationIntent {
  creationRequestId: string;
  creationContext: { actorId: string; workspaceId: string };
  initialSlide?: "native" | "classic";
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
