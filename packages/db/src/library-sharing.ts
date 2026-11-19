import { createHash, randomUUID } from "node:crypto";
import {
  LibraryShareCreateSchema,
  LibraryShareCopySchema,
  LibraryShareListQuerySchema,
  type LibraryShareListQuery,
  type LibraryShareListFacets,
  PresentationDraftSchema,
  QuizDraftSchema,
  type LibraryArtifactKind,
  type LibraryShareCreate,
  type LibraryShareProgress,
  type LibraryShareRecipient,
  type LibraryShareSummary,
  type PresentationContent,
  type QuizDraft,
} from "@openround/contracts";
import { SurveyDraftSchema, type SurveyDraft } from "@openround/contracts/surveys";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { getMemoryPlatformRepository } from "./platform-memory.js";
import type {
  OrganizationMemberRecord,
  OrganizationRecord,
  OrganizationWorkspaceRecord,
  PlatformSubscription,
  UserLicenseAssignment,
} from "./platform-types.js";
import {
  stablePlatformJson,
  workspaceLicenseTerms,
  selectWorkspaceLicenseAssignment,
} from "./platform-service.js";
import {
  createPresentationRepository,
  type MemoryPresentationRepository,
} from "./presentations.js";
import { createSurveyRepository, type SurveyRecord, type SurveyVersion } from "./surveys.js";
import { presentationMediaIds, quizMediaIds } from "./media-references.js";
import { roundArtifactSchemaVersion } from "./artifact-schemas.js";
import type { MediaAssetCreateInput, MediaAssetRecord, Repository } from "./types.js";
import { createPostgresLibrarySharingRun } from "./library-sharing-postgres.js";

/** Trusted server-only content. Never serialize this object as a reader response. */
export type LibraryShareSnapshot =
  | { artifactType: "round"; content: QuizDraft }
  | { artifactType: "presentation"; content: PresentationContent }
  | { artifactType: "survey"; content: SurveyDraft };
export interface LibraryShareRecord extends LibraryShareSummary {
  snapshot: LibraryShareSnapshot;
  createdBy: string | null;
  requestId: string;
}
export interface LibraryShareCopyResult {
  artifactType: LibraryArtifactKind;
  artifactId: string;
  replayed: boolean;
}
export interface LibraryShareCopyMaterialization {
  snapshot: LibraryShareSnapshot;
  mediaAssets: MediaAssetCreateInput[];
  sourceMedia?: Array<Pick<MediaAssetRecord, "id" | "objectKey" | "sizeBytes" | "mimeType">>;
}
export interface LibrarySharingRepository {
  create(input: {
    actorId: string;
    workspaceId: string;
    input: LibraryShareCreate;
    now: Date;
  }): Promise<{ share: LibraryShareRecord; replayed: boolean }>;
  list(input: { actorId: string } & Partial<LibraryShareListQuery>): Promise<{
    shares: LibraryShareSummary[];
    nextCursor: string | null;
    facets?: LibraryShareListFacets;
  }>;
  read(input: { actorId: string; id: string; now?: Date }): Promise<LibraryShareRecord | null>;
  revoke(input: { actorId: string; id: string; now: Date }): Promise<boolean>;
  progress(input: {
    actorId: string;
    id: string;
    status: "in_progress" | "done";
    now: Date;
  }): Promise<LibraryShareSummary | null>;
  recipients(input: {
    actorId: string;
    workspaceId: string;
    search?: string;
  }): Promise<LibraryShareRecipient[]>;
  copy(
    input: {
      actorId: string;
      id: string;
      destinationWorkspaceId: string;
      requestId: string;
      expectedVersionId?: string;
      maximumSurveySchemaVersion?: 2 | 3;
      now: Date;
    },
    materialize: (share: LibraryShareRecord) => Promise<LibraryShareCopyMaterialization>,
  ): Promise<LibraryShareCopyResult>;
}
export class LibrarySharingError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION_ERROR"
      | "IDEMPOTENCY_CONFLICT"
      | "SURVEY_PAGES_NOT_ENABLED",
    message = "This shared item is unavailable",
  ) {
    super(message);
    this.name = "LibrarySharingError";
  }
}
export interface StoredLibraryShare {
  id: string;
  organizationId: string;
  sourceWorkspaceId: string;
  artifactType: LibraryArtifactKind;
  artifactId: string;
  versionId: string;
  title: string;
  description: string;
  sharedAt: string;
  permission: "view" | "use";
  audience: "organization" | "people";
  recipientIds: string[];
  message: string;
  dueAt: string | null;
  createdBy: string | null;
  requestId: string;
  intentHash: string;
  revokedAt: string | null;
  snapshot?: LibraryShareSnapshot;
  surveySchemaVersion?: number;
}
export interface LibrarySharingContext {
  organizationId: string;
  organizationName: string;
  workspaceName: string;
  eligible: boolean;
  create: boolean;
  manage: boolean;
  joinedAt: string | null;
}
export interface LibrarySharingTransaction {
  context(workspaceId: string): Promise<LibrarySharingContext | null>;
  source(
    workspaceId: string,
    type: LibraryArtifactKind,
    artifactId: string,
    versionId: string,
  ): Promise<LibraryShareSnapshot | null>;
  sourceExists(row: StoredLibraryShare): Promise<boolean>;
  get(id: string, lock?: boolean): Promise<StoredLibraryShare | null>;
  request(workspaceId: string, requestId: string): Promise<StoredLibraryShare | null>;
  list(input: LibraryShareListQuery & { after?: LibraryShareCursorPosition }): Promise<{
    rows: LibrarySharingListRow[];
    facets: LibraryShareListFacets;
  }>;
  insert(row: StoredLibraryShare): Promise<void>;
  revoke(id: string, now: Date): Promise<void>;
  status(id: string): Promise<LibraryShareProgress>;
  setStatus(id: string, status: "in_progress" | "done", now: Date): Promise<void>;
  recipients(
    organizationId: string,
    search: string,
    ids?: string[],
  ): Promise<LibraryShareRecipient[]>;
  copyReceipt(requestId: string): Promise<{
    shareId: string;
    destinationWorkspaceId: string;
    artifactType: LibraryArtifactKind;
    artifactId: string;
  } | null>;
  sourceMediaValid(
    workspaceId: string,
    sources: NonNullable<LibraryShareCopyMaterialization["sourceMedia"]>,
  ): Promise<boolean>;
  copy(
    row: StoredLibraryShare,
    destinationWorkspaceId: string,
    requestId: string,
    value: LibraryShareCopyMaterialization,
    now: Date,
  ): Promise<LibraryShareCopyResult>;
}
export type LibrarySharingRun = <T>(
  actorId: string,
  work: (tx: LibrarySharingTransaction) => Promise<T>,
) => Promise<T>;
export function librarySharingSeat(
  organization: OrganizationRecord | null,
  subscription: PlatformSubscription | null,
  assignments: UserLicenseAssignment[],
  held: boolean,
  workspaceId: string,
  actorId: string,
  communityMode: boolean,
) {
  if (communityMode || organization?.licenseUnit !== "user") return true;
  const terms = workspaceLicenseTerms(organization, subscription, held, new Date());
  if (!terms) return false;
  const active = [...assignments]
    .sort(
      (a, b) =>
        new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime() ||
        a.userId.localeCompare(b.userId),
    )
    .slice(0, terms.quantity);
  return (
    active.some((assignment) => assignment.userId === actorId) &&
    !!selectWorkspaceLicenseAssignment(
      active,
      workspaceId,
      terms.quantity,
      (assignment) => assignment.userId,
    )
  );
}
function fail(code: LibrarySharingError["code"] = "NOT_FOUND", message?: string): never {
  throw new LibrarySharingError(code, message);
}
const intentHash = (input: LibraryShareCreate) =>
  createHash("sha256")
    .update(
      stablePlatformJson({
        ...input,
        recipientIds: input.recipientIds.map((id) => id.toLowerCase()).sort(),
      }),
    )
    .digest("hex");
export interface LibraryShareCursorPosition {
  sharedAt: string;
  id: string;
  title?: string;
}
export interface LibrarySharingListRow extends Omit<
  LibraryShareSummary,
  "organizationName" | "sourceWorkspaceName" | "capabilities" | "copyUnavailableReason"
> {
  context: LibrarySharingContext;
  surveySchemaVersion?: number;
}
// Default Unicode lowercasing matches PostgreSQL root ICU; byte ordering matches C collation.
export function normalizeLibraryShareText(value: string) {
  return value.normalize("NFC").toLowerCase().normalize("NFC");
}
const compareText = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function cursorContext(actorId: string, query: LibraryShareListQuery) {
  const context = {
    scope: query.scope,
    organizationId: query.organizationId,
    q: query.q,
    kind: query.kind,
    sort: query.sort,
    progress: query.progress,
    permission: query.permission,
  };
  return createHash("sha256")
    .update(stablePlatformJson({ actorId, ...context, q: normalizeLibraryShareText(context.q) }))
    .digest("hex");
}
function cursor(value: string | undefined, context: string, query: LibraryShareListQuery) {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return fail("VALIDATION_ERROR", "Invalid Library cursor");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
    const position = parsed.v === 2 ? parsed.position : parsed;
    if (
      !position ||
      typeof position.sharedAt !== "string" ||
      !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(position.sharedAt) ||
      !Number.isFinite(Date.parse(position.sharedAt)) ||
      new Date(position.sharedAt).toISOString() !== position.sharedAt ||
      !LibraryShareCopySchema.safeParse({ requestId: position.id }).success
    )
      return fail("VALIDATION_ERROR", "Invalid Library cursor");
    if (parsed.v === 2) {
      if (
        Object.keys(parsed).sort().join(",") !== "context,position,v" ||
        Object.keys(position).sort().join(",") !== "id,sharedAt,title" ||
        parsed.context !== context ||
        typeof position.title !== "string" ||
        position.title.length > 1000 ||
        position.title.includes("\0") ||
        position.title !== normalizeLibraryShareText(position.title)
      )
        return fail("VALIDATION_ERROR", "Invalid Library cursor");
    } else if (
      Object.keys(parsed).sort().join(",") !== "id,sharedAt" ||
      query.q ||
      query.kind !== "all" ||
      query.sort !== "recent" ||
      query.progress !== "all" ||
      query.permission !== "all"
    ) {
      return fail("VALIDATION_ERROR", "Invalid Library cursor");
    }
    return { ...position, id: position.id.toLowerCase() } as LibraryShareCursorPosition;
  } catch {
    return fail("VALIDATION_ERROR", "Invalid Library cursor");
  }
}
function nextCursor(row: Pick<StoredLibraryShare, "id" | "sharedAt" | "title">, context: string) {
  const payload = {
    v: 2,
    context,
    position: { sharedAt: row.sharedAt, id: row.id, title: normalizeLibraryShareText(row.title) },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
function visible(row: StoredLibraryShare, actorId: string, context: LibrarySharingContext | null) {
  return (
    !!context?.eligible &&
    context.organizationId === row.organizationId &&
    !row.revokedAt &&
    (context.manage ||
      row.audience === "organization" ||
      (row.recipientIds.includes(actorId) &&
        !!context.joinedAt &&
        context.joinedAt <= row.sharedAt))
  );
}
function parseCopy(
  value: LibraryShareCopyMaterialization,
  type: LibraryArtifactKind,
  workspaceId: string,
) {
  if (value.snapshot.artifactType !== type)
    fail("VALIDATION_ERROR", "The copied content type changed");
  const snapshot: LibraryShareSnapshot =
    value.snapshot.artifactType === "round"
      ? { artifactType: "round", content: QuizDraftSchema.parse(value.snapshot.content) }
      : value.snapshot.artifactType === "presentation"
        ? {
            artifactType: "presentation",
            content: PresentationDraftSchema.parse(value.snapshot.content) as PresentationContent,
          }
        : { artifactType: "survey", content: SurveyDraftSchema.parse(value.snapshot.content) };
  const ids = libraryShareMediaIds(snapshot);
  if (
    new Set(value.mediaAssets.map((asset) => asset.id)).size !== value.mediaAssets.length ||
    value.mediaAssets.some(
      (asset) =>
        asset.workspaceId !== workspaceId ||
        asset.scanStatus !== "clean" ||
        !asset.objectKey.startsWith(`media/${workspaceId}/${asset.id}.`) ||
        !ids.includes(asset.id),
    ) ||
    ids.some((id) => !value.mediaAssets.some((asset) => asset.id === id))
  )
    fail("VALIDATION_ERROR", "Every copied image must have an independent destination asset");
  return { snapshot, mediaAssets: value.mediaAssets, sourceMedia: value.sourceMedia ?? [] };
}
export function libraryShareMediaIds(snapshot: LibraryShareSnapshot): string[] {
  return snapshot.artifactType === "round"
    ? quizMediaIds(snapshot.content)
    : snapshot.artifactType === "presentation"
      ? presentationMediaIds(snapshot.content)
      : [];
}
export class LibrarySharingService implements LibrarySharingRepository {
  constructor(private readonly run: LibrarySharingRun) {}
  private async summary(
    tx: LibrarySharingTransaction,
    row: StoredLibraryShare,
    context: LibrarySharingContext,
  ): Promise<LibraryShareSummary> {
    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName: context.organizationName,
      sourceWorkspaceId: row.sourceWorkspaceId,
      sourceWorkspaceName: context.workspaceName,
      artifactType: row.artifactType,
      artifactId: row.artifactId,
      versionId: row.versionId,
      title: row.title,
      description: row.description,
      sharedAt: row.sharedAt,
      permission: row.permission,
      audience: row.audience,
      message: row.message,
      dueAt: row.dueAt,
      progress: await tx.status(row.id),
      capabilities: {
        view: true,
        copy:
          row.permission === "use" &&
          !(
            row.surveySchemaVersion === 3 ||
            (row.snapshot?.artifactType === "survey" && row.snapshot.content.schemaVersion === 3)
          ),
        manage: context.manage,
      },
      copyUnavailableReason:
        row.surveySchemaVersion === 3 ||
        (row.snapshot?.artifactType === "survey" && row.snapshot.content.schemaVersion === 3)
          ? "Creating paged Survey copies is not enabled yet"
          : row.permission === "use"
            ? null
            : "This item was shared for viewing",
    };
  }
  private async record(
    tx: LibrarySharingTransaction,
    row: StoredLibraryShare,
    context: LibrarySharingContext,
  ): Promise<LibraryShareRecord> {
    if (!row.snapshot) fail();
    return {
      ...(await this.summary(tx, row, context)),
      snapshot: structuredClone(row.snapshot!),
      createdBy: row.createdBy,
      requestId: row.requestId,
    };
  }
  create({
    actorId,
    workspaceId,
    input: raw,
    now,
  }: Parameters<LibrarySharingRepository["create"]>[0]) {
    const parsed = LibraryShareCreateSchema.safeParse(raw);
    if (!parsed.success || !Number.isFinite(now.getTime()))
      return Promise.reject(
        new LibrarySharingError(
          "VALIDATION_ERROR",
          "Choose a published item and valid sharing options",
        ),
      );
    const input = {
      ...parsed.data,
      recipientIds: parsed.data.recipientIds.map((id) => id.toLowerCase()).sort(),
    };
    return this.run(actorId, async (tx) => {
      const context = await tx.context(workspaceId);
      if (!context?.eligible || !context.create)
        fail("FORBIDDEN", "Only current source workspace editors can share an item");
      const previous = await tx.request(workspaceId, input.requestId);
      if (previous) {
        if (previous.intentHash !== intentHash(input))
          fail("IDEMPOTENCY_CONFLICT", "This request was already used for another share");
        if (!visible(previous, actorId, context) || !(await tx.sourceExists(previous))) fail();
        return { share: await this.record(tx, previous, context), replayed: true };
      }
      const snapshot = await tx.source(
        workspaceId,
        input.artifactType,
        input.artifactId,
        input.versionId,
      );
      if (!snapshot) fail();
      if (input.audience === "people") {
        const recipients = await tx.recipients(context.organizationId, "", input.recipientIds);
        if (input.recipientIds.some((id) => !recipients.some((person) => person.userId === id)))
          fail("VALIDATION_ERROR", "Choose current verified members of this organization");
      }
      const row: StoredLibraryShare = {
        ...input,
        id: randomUUID(),
        organizationId: context.organizationId,
        sourceWorkspaceId: workspaceId,
        title: snapshot!.content.title,
        description: snapshot!.content.description ?? "",
        sharedAt: now.toISOString(),
        createdBy: actorId,
        intentHash: intentHash(input),
        revokedAt: null,
        snapshot: snapshot!,
      };
      await tx.insert(row);
      return { share: await this.record(tx, row, context), replayed: false };
    });
  }
  list(input: Parameters<LibrarySharingRepository["list"]>[0]) {
    const { actorId, ...raw } = input;
    const parsed = LibraryShareListQuerySchema.safeParse(raw);
    if (!parsed.success)
      return Promise.reject(new LibrarySharingError("VALIDATION_ERROR", "Check the Library query"));
    const query = { ...parsed.data, organizationId: parsed.data.organizationId?.toLowerCase() };
    return this.run(actorId, async (tx) => {
      const context = cursorContext(actorId, query);
      const after = cursor(query.cursor, context, query);
      const { rows, facets } = await tx.list({ ...query, limit: query.limit + 1, after });
      const shares = rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        organizationName: row.context.organizationName,
        sourceWorkspaceId: row.sourceWorkspaceId,
        sourceWorkspaceName: row.context.workspaceName,
        artifactType: row.artifactType,
        artifactId: row.artifactId,
        versionId: row.versionId,
        title: row.title,
        description: row.description,
        sharedAt: row.sharedAt,
        permission: row.permission,
        audience: row.audience,
        message: row.message,
        dueAt: row.dueAt,
        progress: row.progress,
        capabilities: {
          view: true,
          copy: row.permission === "use" && row.surveySchemaVersion !== 3,
          manage: row.context.manage,
        },
        copyUnavailableReason:
          row.surveySchemaVersion === 3
            ? "Creating paged Survey copies is not enabled yet"
            : row.permission === "use"
              ? null
              : "This item was shared for viewing",
      }));
      return {
        shares,
        facets,
        nextCursor: rows.length > query.limit ? nextCursor(rows[query.limit - 1]!, context) : null,
      };
    });
  }
  read({ actorId, id }: Parameters<LibrarySharingRepository["read"]>[0]) {
    return this.run(actorId, async (tx) => {
      const row = await tx.get(id);
      if (!row) return null;
      const context = await tx.context(row.sourceWorkspaceId);
      return visible(row, actorId, context) && (await tx.sourceExists(row))
        ? this.record(tx, row, context!)
        : null;
    });
  }
  revoke({ actorId, id, now }: Parameters<LibrarySharingRepository["revoke"]>[0]) {
    return this.run(actorId, async (tx) => {
      const row = await tx.get(id, true);
      if (!row) return false;
      const context = await tx.context(row.sourceWorkspaceId);
      if (!context?.eligible || !context.manage)
        fail(
          "FORBIDDEN",
          "Only source workspace editors or organization administrators can revoke sharing",
        );
      await tx.revoke(id, now);
      return true;
    });
  }
  progress({ actorId, id, status, now }: Parameters<LibrarySharingRepository["progress"]>[0]) {
    if (status !== "in_progress" && status !== "done")
      return Promise.reject(new LibrarySharingError("VALIDATION_ERROR"));
    return this.run(actorId, async (tx) => {
      const row = await tx.get(id, true);
      if (!row) return null;
      const context = await tx.context(row.sourceWorkspaceId);
      if (!visible(row, actorId, context) || !(await tx.sourceExists(row))) return null;
      await tx.setStatus(id, status, now);
      return this.summary(tx, row, context!);
    });
  }
  recipients({
    actorId,
    workspaceId,
    search = "",
  }: Parameters<LibrarySharingRepository["recipients"]>[0]) {
    return this.run(actorId, async (tx) => {
      const context = await tx.context(workspaceId);
      if (!context?.eligible || !context.create) fail("FORBIDDEN");
      return (await tx.recipients(context.organizationId, search.trim().slice(0, 200))).slice(
        0,
        100,
      );
    });
  }
  copy(
    input: Parameters<LibrarySharingRepository["copy"]>[0],
    materialize: Parameters<LibrarySharingRepository["copy"]>[1],
  ) {
    if (!LibraryShareCopySchema.safeParse({ requestId: input.requestId }).success)
      return Promise.reject(new LibrarySharingError("VALIDATION_ERROR"));
    return this.run(input.actorId, async (tx) => {
      const row = await tx.get(input.id, true);
      if (!row) fail();
      if (input.expectedVersionId && input.expectedVersionId !== row!.versionId) fail();
      const context = await tx.context(row!.sourceWorkspaceId);
      const destination = await tx.context(input.destinationWorkspaceId);
      if (!visible(row!, input.actorId, context) || !(await tx.sourceExists(row!))) fail();
      if (
        row!.permission !== "use" ||
        !destination?.eligible ||
        !destination.create ||
        destination.organizationId !== row!.organizationId
      )
        fail(
          "FORBIDDEN",
          "Copying requires use permission and an editable workspace in this organization",
        );
      const previous = await tx.copyReceipt(input.requestId);
      if (previous) {
        if (
          previous.shareId !== input.id ||
          previous.destinationWorkspaceId !== input.destinationWorkspaceId
        )
          fail("IDEMPOTENCY_CONFLICT", "This request was already used for another copy");
        return {
          artifactType: previous.artifactType,
          artifactId: previous.artifactId,
          replayed: true,
        };
      }
      if (
        row!.snapshot?.artifactType === "survey" &&
        row!.snapshot.content.schemaVersion === 3 &&
        input.maximumSurveySchemaVersion !== 3
      )
        fail("SURVEY_PAGES_NOT_ENABLED", "Creating paged Survey copies is not enabled yet");
      const value = parseCopy(
        await materialize(await this.record(tx, row!, context!)),
        row!.artifactType,
        input.destinationWorkspaceId,
      );
      if (
        value.snapshot.artifactType === "survey" &&
        value.snapshot.content.schemaVersion === 3 &&
        input.maximumSurveySchemaVersion !== 3
      )
        fail("SURVEY_PAGES_NOT_ENABLED", "Creating paged Survey copies is not enabled yet");
      const sourceMedia = value.sourceMedia ?? [],
        originalIds = libraryShareMediaIds(row!.snapshot!);
      if (
        sourceMedia.length !== value.mediaAssets.length ||
        sourceMedia.some(
          (source, index) =>
            !originalIds.includes(source.id) ||
            source.id === value.mediaAssets[index]?.id ||
            source.mimeType !== value.mediaAssets[index]?.mimeType ||
            source.sizeBytes !== value.mediaAssets[index]?.sizeBytes,
        ) ||
        !(await tx.sourceMediaValid(row!.sourceWorkspaceId, sourceMedia))
      )
        fail("VALIDATION_ERROR", "A source image is no longer available");
      // Memory callers can change membership while external storage is being copied; recheck it too.
      const currentRow = await tx.get(input.id, true),
        current = await tx.context(row!.sourceWorkspaceId),
        target = await tx.context(input.destinationWorkspaceId);
      if (
        !currentRow ||
        !visible(currentRow, input.actorId, current) ||
        !target?.eligible ||
        !target.create ||
        target.organizationId !== row!.organizationId ||
        !(await tx.sourceExists(row!))
      )
        fail();
      return tx.copy(row!, input.destinationWorkspaceId, input.requestId, value, input.now);
    });
  }
}

interface MemorySurveys extends MemoryRepositoryLifecycleExtension {
  surveys: Map<string, SurveyRecord>;
  survey_versions: Map<string, SurveyVersion>;
}
function memorySurveys(repository: MemoryRepository) {
  createSurveyRepository(repository);
  return repository.getOrCreateLifecycleExtension<MemorySurveys>("surveys", () => {
    throw new Error("Survey store was not initialized");
  });
}
export class MemoryLibrarySharingStore implements MemoryRepositoryLifecycleExtension {
  readonly shares = new Map<string, StoredLibraryShare>();
  readonly statuses = new Map<string, LibraryShareProgress>();
  readonly copies = new Map<
    string,
    {
      shareId: string;
      destinationWorkspaceId: string;
      artifactType: LibraryArtifactKind;
      artifactId: string;
    }
  >();
  constructor(
    private readonly repository: MemoryRepository,
    private readonly communityMode = false,
  ) {}
  private async sourceExists(row: StoredLibraryShare) {
    // Inspect only the parent identity/status metadata; discovery never clones a draft.
    createPresentationRepository(this.repository);
    const parent =
      row.artifactType === "round"
        ? this.repository.quizzes.get(row.artifactId)
        : row.artifactType === "presentation"
          ? this.repository
              .getOrCreateLifecycleExtension<MemoryPresentationRepository>("presentations", () => {
                throw new Error("Presentation store was not initialized");
              })
              .presentations.get(row.artifactId)
          : memorySurveys(this.repository).surveys.get(row.artifactId);
    return !!parent && parent.workspaceId === row.sourceWorkspaceId && parent.status !== "archived";
  }

  run: LibrarySharingRun = (actorId, work) =>
    getMemoryPlatformRepository(this.repository).withTransaction(async () => {
      const platform = getMemoryPlatformRepository(this.repository).memoryStore;
      let sharesBefore: Map<string, StoredLibraryShare> | undefined;
      let statusesBefore: Map<string, LibraryShareProgress> | undefined;
      let copiesBefore: typeof this.copies | undefined;
      const checkpoint = () => {
        sharesBefore ??= structuredClone(this.shares);
        statusesBefore ??= structuredClone(this.statuses);
        copiesBefore ??= structuredClone(this.copies);
      };
      const context = async (workspaceId: string): Promise<LibrarySharingContext | null> => {
        const workspace = platform.getSync<OrganizationWorkspaceRecord>("workspace", workspaceId);
        if (!workspace) return null;
        const organization = platform.getSync<OrganizationRecord>(
          "organization",
          workspace.organizationId,
        );
        const member = platform.getSync<OrganizationMemberRecord>(
          "member",
          `${workspace.organizationId}:${actorId}`,
        );
        const user = this.repository.users.get(actorId);
        const role = this.repository.workspaceMembers.get(`${workspaceId}:${actorId}`)?.role;
        const eligible =
          !!user?.emailVerifiedAt &&
          !user.deletedAt &&
          !!member &&
          member.role !== "billing" &&
          organization?.accountType === "organization" &&
          organization.status === "active" &&
          workspace.status === "active" &&
          !this.repository.workspaceMediaDeletionJobs.has(workspaceId);
        const seat = librarySharingSeat(
          organization,
          platform.getSync<PlatformSubscription>("subscription", workspace.organizationId),
          platform.listSync<UserLicenseAssignment>("user_license", workspace.organizationId),
          !!platform.getSync<{ held: boolean }>("commercial_hold", workspace.organizationId)?.held,
          workspaceId,
          actorId,
          this.communityMode,
        );
        const create = (role === "owner" || role === "editor") && seat;
        return {
          organizationId: workspace.organizationId,
          organizationName: organization?.name ?? "",
          workspaceName: workspace.name,
          eligible,
          create,
          manage:
            role === "owner" ||
            role === "editor" ||
            member?.role === "owner" ||
            member?.role === "admin",
          joinedAt: member?.createdAt ? new Date(member.createdAt).toISOString() : null,
        };
      };
      const recipients = async (organizationId: string, search: string, ids?: string[]) =>
        platform
          .listSync<OrganizationMemberRecord>("member", organizationId)
          .flatMap((member) => {
            const user = this.repository.users.get(member.userId);
            return user?.emailVerifiedAt &&
              !user.deletedAt &&
              member.role !== "billing" &&
              (!ids || ids.includes(member.userId)) &&
              user.email.toLowerCase().includes(search.toLowerCase())
              ? [{ userId: member.userId, email: user.email }]
              : [];
          })
          .sort((a, b) => a.email.localeCompare(b.email))
          .slice(0, 100);
      const tx: LibrarySharingTransaction = {
        context,
        recipients,
        sourceExists: (row) => this.sourceExists(row),
        source: async (workspaceId, type, artifactId, versionId) => {
          if (
            !(await this.sourceExists({
              sourceWorkspaceId: workspaceId,
              artifactType: type,
              artifactId,
            } as StoredLibraryShare))
          )
            return null;
          if (type === "round") {
            const version = await this.repository.getQuizVersion(workspaceId, versionId);
            return version?.quizId === artifactId
              ? { artifactType: "round", content: structuredClone(version.content) }
              : null;
          }
          if (type === "presentation") {
            const version = await createPresentationRepository(
              this.repository,
            ).getPresentationVersion(workspaceId, versionId);
            return version?.presentationId === artifactId
              ? { artifactType: "presentation", content: structuredClone(version.content) }
              : null;
          }
          const version = memorySurveys(this.repository).survey_versions.get(versionId);
          return version?.workspaceId === workspaceId && version.surveyId === artifactId
            ? { artifactType: "survey", content: structuredClone(version.content) }
            : null;
        },
        get: async (id) => structuredClone(this.shares.get(id) ?? null),
        request: async (workspaceId, requestId) =>
          structuredClone(
            [...this.shares.values()].find(
              (row) =>
                row.sourceWorkspaceId === workspaceId &&
                row.createdBy === actorId &&
                row.requestId === requestId,
            ) ?? null,
          ),
        list: async (input) => {
          const rows: LibrarySharingListRow[] = [];
          const facets: LibraryShareListFacets = {
            kinds: { round: 0, presentation: 0, survey: 0 },
            progress: { new: 0, in_progress: 0, done: 0 },
            permissions: { view: 0, use: 0 },
            total: 0,
          };
          const contexts = new Map<string, LibrarySharingContext | null>();
          for (const row of this.shares.values()) {
            if (!contexts.has(row.sourceWorkspaceId))
              contexts.set(row.sourceWorkspaceId, await context(row.sourceWorkspaceId));
            const access = contexts.get(row.sourceWorkspaceId)!;
            if (
              !visible(row, actorId, access) ||
              !(await this.sourceExists(row)) ||
              (input.organizationId && row.organizationId !== input.organizationId)
            )
              continue;
            if (input.scope === "organization" && row.audience !== "organization") continue;
            if (
              input.scope === "shared" &&
              (row.audience !== "people" || !row.recipientIds.includes(actorId))
            )
              continue;
            if (input.scope === "managed" && !access?.manage) continue;
            if (
              ![
                row.title,
                row.description,
                row.message,
                access!.organizationName,
                access!.workspaceName,
              ].some((value) =>
                normalizeLibraryShareText(value).includes(normalizeLibraryShareText(input.q)),
              )
            )
              continue;
            const progress = this.statuses.get(`${row.id}:${actorId}`) ?? "new";
            facets.kinds[row.artifactType]++;
            facets.progress[progress]++;
            facets.permissions[row.permission]++;
            if (
              (input.kind !== "all" && row.artifactType !== input.kind) ||
              (input.progress !== "all" && progress !== input.progress) ||
              (input.permission !== "all" && row.permission !== input.permission)
            )
              continue;
            facets.total++;
            rows.push({
              id: row.id,
              organizationId: row.organizationId,
              sourceWorkspaceId: row.sourceWorkspaceId,
              artifactType: row.artifactType,
              artifactId: row.artifactId,
              versionId: row.versionId,
              title: row.title,
              description: row.description,
              sharedAt: row.sharedAt,
              permission: row.permission,
              audience: row.audience,
              message: row.message,
              dueAt: row.dueAt,
              context: access!,
              surveySchemaVersion:
                row.snapshot?.artifactType === "survey"
                  ? row.snapshot.content.schemaVersion
                  : undefined,
              progress,
            });
          }
          const order = (
            a: LibraryShareCursorPosition & { title?: string },
            b: LibraryShareCursorPosition & { title?: string },
          ) =>
            (input.sort === "recent"
              ? compareText(b.sharedAt, a.sharedAt)
              : compareText(
                  normalizeLibraryShareText(a.title ?? ""),
                  normalizeLibraryShareText(b.title ?? ""),
                ) * (input.sort === "title_asc" ? 1 : -1)) || compareText(b.id, a.id);
          return {
            rows: rows
              .sort(order)
              .filter((row) => !input.after || order(row, input.after) > 0)
              .slice(0, input.limit),
            facets,
          };
        },
        insert: async (row) => {
          checkpoint();
          const active = [...this.shares.values()].filter((share) => !share.revokedAt);
          if (
            active.filter((share) => share.organizationId === row.organizationId).length >= 1000 ||
            active.filter(
              (share) =>
                share.sourceWorkspaceId === row.sourceWorkspaceId &&
                share.artifactType === row.artifactType &&
                share.artifactId === row.artifactId,
            ).length >= 100
          )
            fail("VALIDATION_ERROR", "Library sharing limit reached");
          this.shares.set(row.id, structuredClone(row));
        },
        revoke: async (id, now) => {
          checkpoint();
          const row = this.shares.get(id);
          if (row) row.revokedAt ??= now.toISOString();
        },
        status: async (id) => this.statuses.get(`${id}:${actorId}`) ?? "new",
        setStatus: async (id, status) => {
          checkpoint();
          this.statuses.set(`${id}:${actorId}`, status);
        },
        copyReceipt: async (requestId) =>
          structuredClone(this.copies.get(`${actorId}:${requestId}`) ?? null),
        sourceMediaValid: async (workspaceId, sources) =>
          sources.every((source) => {
            const asset = this.repository.mediaAssets.get(source.id);
            return (
              !!asset &&
              asset.workspaceId === workspaceId &&
              asset.scanStatus === "clean" &&
              !asset.deletionStartedAt &&
              asset.objectKey === source.objectKey &&
              asset.mimeType === source.mimeType &&
              asset.sizeBytes === source.sizeBytes
            );
          }),
        copy: async (row, workspaceId, requestId, value, now) => {
          checkpoint();
          const artifactId = randomUUID();
          for (const asset of value.mediaAssets) await this.repository.createMediaAsset(asset);
          try {
            if (value.snapshot.artifactType === "round") {
              const draft = value.snapshot.content;
              await this.repository.createQuiz({
                id: artifactId,
                workspaceId,
                title: draft.title,
                description: draft.description,
                status: "draft",
                draft,
                draftRevision: 0,
                draftSchemaVersion: roundArtifactSchemaVersion(draft),
                currentVersionId: null,
                publishedDraftRevision: null,
                lastEditedBy: actorId,
                folderId: null,
                tags: [],
                createdAt: now,
                updatedAt: now,
              });
            } else if (value.snapshot.artifactType === "presentation") {
              const draft = value.snapshot.content;
              await createPresentationRepository(this.repository).createPresentation({
                id: artifactId,
                workspaceId,
                title: draft.title,
                description: draft.description,
                status: "draft",
                draft,
                draftRevision: 0,
                draftSchemaVersion: draft.schemaVersion,
                currentVersionId: null,
                publishedDraftRevision: null,
                lastEditedBy: actorId,
                folderId: null,
                createdAt: now,
                updatedAt: now,
              });
            } else
              await createSurveyRepository(this.repository).create(
                workspaceId,
                artifactId,
                value.snapshot.content,
                requestId,
                { maximumSchemaVersion: 3 },
              );
          } catch (error) {
            for (const asset of value.mediaAssets) this.repository.mediaAssets.delete(asset.id);
            throw error;
          }
          const receipt = {
            shareId: row.id,
            destinationWorkspaceId: workspaceId,
            artifactType: row.artifactType,
            artifactId,
          };
          this.copies.set(`${actorId}:${requestId}`, receipt);
          return { artifactType: row.artifactType, artifactId, replayed: false };
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        for (const [target, before] of [
          [this.shares, sharesBefore],
          [this.statuses, statusesBefore],
          [this.copies, copiesBefore],
        ] as const) {
          if (!before) continue;
          target.clear();
          for (const [key, value] of before) (target as Map<string, unknown>).set(key, value);
        }
        throw error;
      }
    });
  deleteLibraryArtifactMetadata(workspaceId: string, artifactType: string, artifactId: string) {
    for (const [id, row] of this.shares)
      if (
        row.sourceWorkspaceId === workspaceId &&
        row.artifactType === artifactType &&
        row.artifactId === artifactId
      ) {
        this.shares.delete(id);
        this.repository.deleteLibraryShareMetadata(id);
        for (const key of this.statuses.keys())
          if (key.startsWith(`${id}:`)) this.statuses.delete(key);
      }
  }
  exportAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      libraryShares: structuredClone(
        [...this.shares.values()]
          .filter((row) => row.createdBy === userId || ownedWorkspaceIds.has(row.sourceWorkspaceId))
          .map(
            ({
              snapshot: _snapshot,
              intentHash: _intentHash,
              recipientIds: _recipientIds,
              ...metadata
            }) => metadata,
          ),
      ),
      libraryShareProgress: [...this.statuses]
        .filter(([key]) => key.endsWith(`:${userId}`))
        .map(([key, status]) => ({ shareId: key.split(":")[0], status })),
      libraryShareCopies: [...this.copies]
        .filter(([key]) => key.startsWith(`${userId}:`))
        .map(([key, value]) => ({ requestId: key.split(":")[1], ...structuredClone(value) })),
    };
  }
  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, row] of this.shares) {
      if (ownedWorkspaceIds.has(row.sourceWorkspaceId)) {
        this.shares.delete(id);
        this.repository.deleteLibraryShareMetadata(id);
      } else {
        if (row.createdBy === userId) row.createdBy = null;
        row.recipientIds = row.recipientIds.filter((id) => id !== userId);
      }
    }
    for (const key of this.statuses.keys())
      if (key.endsWith(`:${userId}`) || !this.shares.has(key.split(":")[0]!))
        this.statuses.delete(key);
    for (const [key, receipt] of this.copies)
      if (
        key.startsWith(`${userId}:`) ||
        ownedWorkspaceIds.has(receipt.destinationWorkspaceId) ||
        !this.shares.has(receipt.shareId)
      )
        this.copies.delete(key);
  }
}
export function createLibrarySharingRepository(
  repository: Repository,
  options: { communityMode?: boolean } = {},
): LibrarySharingRepository {
  if (repository instanceof PostgresRepository)
    return new LibrarySharingService(
      createPostgresLibrarySharingRun(repository, !!options.communityMode),
    );
  if (repository instanceof MemoryRepository) {
    const store = repository.getOrCreateLifecycleExtension(
      "library-sharing",
      () => new MemoryLibrarySharingStore(repository, !!options.communityMode),
    );
    return new LibrarySharingService(store.run);
  }
  throw new Error("Unsupported Library sharing repository");
}
