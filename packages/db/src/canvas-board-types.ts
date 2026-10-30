import type {
  CanvasBoardCreate,
  CanvasBoardGuestView,
  CanvasBoardInvitation,
  CanvasBoardMutation,
  CanvasBoardMutationResponse,
  CanvasBoardRole,
  CanvasBoardView,
  CanvasObject,
  CanvasBoardEvent,
  IdeaBoardStored,
  CanvasCommentThread,
  CanvasTimer,
  CanvasVersionMetadata,
  CanvasFacilitationView,
  CanvasFacilitationMutation,
  CanvasFacilitationResponse,
  CanvasVersionView,
  CanvasGuestFacilitationView,
} from "@openround/contracts";
import type {
  OrganizationRecord,
  OrganizationMemberRecord,
  PlatformSubscription,
  UserLicenseAssignment,
} from "./platform-types.js";
import type { MediaAssetCreateInput, MediaAssetRecord } from "./types.js";

export type CanvasClock = Date | (() => Date);
export interface CanvasActor {
  userId: string;
}
export interface CanvasBoardAuthorization {
  boardId: string;
  workspaceId: string;
  canvasSeq: number;
  sourceRevision: number | null;
  role: CanvasBoardRole;
  capabilities: CanvasBoardView["capabilities"];
  expiresAt: string;
}
export interface CanvasBoardStored {
  schemaVersion: 1 | 2;
  id: string;
  workspaceId: string;
  organizationId: string;
  ownerUserId: string;
  title: string;
  boardType: "team" | "workshop";
  sourceBoardId: string | null;
  status: "active" | "archived";
  canvasSeq: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  creationKey: string;
  creationHash: string;
  uploadCount: number;
  uploadBytes: number;
}
export interface CanvasReceipt {
  operationId: string;
  actorId: string;
  hash: string;
  canvasSeq: number;
  // Last undo/redo action order; canvasSeq remains the original idempotent acknowledgement.
  historySeq?: number;
  type: string;
  before: CanvasObject[];
  after: CanvasObject[];
  undone: boolean;
  undoable: boolean;
  objectVersions?: Record<string, number>;
  facilitationEntities?: { threadId?: string; messageId?: string; versionId?: string };
}
export interface CanvasState {
  board: CanvasBoardStored;
  objects: CanvasObject[];
  grants: Array<{
    userId: string;
    role: "facilitator" | "editor" | "viewer";
    createdAt: string;
    label?: string;
  }>;
  invitations: CanvasBoardInvitation[];
  receipts: CanvasReceipt[];
  facilitation?: CanvasFacilitationStored;
}
export interface CanvasSavedVersion {
  metadata: CanvasVersionMetadata;
  objects: CanvasObject[];
}
export interface CanvasFacilitationStored {
  threads: CanvasCommentThread[];
  timer: CanvasTimer;
  versions: CanvasSavedVersion[];
}
export interface CanvasMediaUpload {
  boardId: string;
  uploaderUserId: string;
  asset: MediaAssetRecord;
}
export interface CanvasAccessContext {
  workspace: {
    id: string;
    name: string;
    organizationId: string;
    ownerId: string;
    status: string;
    retentionDays: number;
    membership: "owner" | "editor" | "viewer" | null;
  };
  user: { userId: string; email: string; verified: boolean } | null;
  organization: OrganizationRecord | null;
  member: OrganizationMemberRecord | null;
  subscription: PlatformSubscription | null;
  assignments: UserLicenseAssignment[];
  commercialHold: boolean;
  workspaceDeleting: boolean;
  workspaceLicensed: boolean;
}
export interface CanvasTransaction {
  metadata(id: string): Promise<CanvasBoardStored | null>;
  creation(workspaceId: string, operationId: string): Promise<CanvasBoardStored | null>;
  countWorkspace(workspaceId: string, now: Date): Promise<number>;
  timer(boardId: string, lock?: boolean): Promise<CanvasTimer>;
  grant(boardId: string, userId: string): Promise<CanvasState["grants"][number] | null>;
  sourceMetadata(
    id: string,
    guestHash?: string,
    lock?: boolean,
  ): Promise<
    | (Pick<
        IdeaBoardStored,
        "id" | "workspaceId" | "revision" | "status" | "closesAt" | "expiresAt"
      > & { guestPresent: boolean })
    | null
  >;
  list(): Promise<CanvasBoardStored[]>;
  get(id: string, lock?: boolean): Promise<CanvasState | null>;
  put(state: CanvasState, insert?: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  access(workspaceId: string, userId: string): Promise<CanvasAccessContext | null>;
  findUser(
    email: string,
    organizationId: string,
  ): Promise<{ userId: string; email: string } | null>;
  source(id: string, lock?: boolean): Promise<IdeaBoardStored | null>;
  putSource(row: IdeaBoardStored): Promise<void>;
  emit(event: CanvasBoardEvent, expiresAt: string): Promise<void>;
  invitation(id: string): Promise<{ boardId: string } | null>;
  media(boardId: string, mediaId: string): Promise<CanvasMediaUpload | null>;
  reserveMedia(
    board: CanvasBoardStored,
    userId: string,
    input: MediaAssetCreateInput,
  ): Promise<MediaAssetRecord>;
  syncMedia(state: CanvasState): Promise<void>;
}
export type CanvasRun = <T>(
  actor: CanvasActor | null,
  scope: {
    boardId?: string;
    workspaceId?: string;
    sourceBoardId?: string;
    guestHash?: string;
    invitationId?: string;
  },
  work: (tx: CanvasTransaction) => Promise<T>,
) => Promise<T>;
export interface CanvasBoardRepositoryApi {
  getFacilitation(
    actor: CanvasActor,
    id: string,
    clock?: CanvasClock,
  ): Promise<CanvasFacilitationView>;
  facilitate(
    actor: CanvasActor,
    id: string,
    input: CanvasFacilitationMutation,
    clock?: CanvasClock,
  ): Promise<CanvasFacilitationResponse>;
  getVersion(
    actor: CanvasActor,
    id: string,
    versionId: string,
    clock?: CanvasClock,
  ): Promise<CanvasVersionView>;
  getGuestFacilitation(
    sourceBoardId: string,
    tokenHash: string,
    clock?: CanvasClock,
  ): Promise<CanvasGuestFacilitationView | null>;
  authorizeVersionMedia(
    actor: CanvasActor,
    id: string,
    versionId: string,
    mediaId: string,
    clock?: CanvasClock,
  ): Promise<{ workspaceId: string }>;
  create(
    actor: CanvasActor,
    input: CanvasBoardCreate,
    clock?: CanvasClock,
  ): Promise<CanvasBoardView>;
  list(
    actor: CanvasActor,
    query?: { scope?: "all" | "owned" | "shared" | "archived" },
    clock?: CanvasClock,
  ): Promise<CanvasBoardView[]>;
  get(actor: CanvasActor, id: string, clock?: CanvasClock): Promise<CanvasBoardView>;
  command(
    actor: CanvasActor,
    id: string,
    mutation: CanvasBoardMutation,
    clock?: CanvasClock,
  ): Promise<CanvasBoardMutationResponse>;
  getGuest(
    sourceBoardId: string,
    tokenHash: string,
    clock?: CanvasClock,
  ): Promise<CanvasBoardGuestView | null>;
}
