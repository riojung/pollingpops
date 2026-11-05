import type { CreatePresentationShare } from "@openround/contracts";
import type { PresentationVersionRecord } from "./presentation-types.js";
export class PresentationShareError extends Error {
  constructor(
    public readonly code: "UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "LINK_LIMIT" | "REQUEST_EXPIRED",
    message = "This presentation link is unavailable",
  ) {
    super(message);
  }
}
export interface PresentationShareRecord {
  id: string;
  workspaceId: string;
  presentationId: string;
  versionId: string;
  actorId: string;
  requestId: string;
  intentHash: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface CreatePresentationShareInput extends Omit<CreatePresentationShare, "token"> {
  workspaceId: string;
  presentationId: string;
  actorId: string;
  intentHash: string;
  tokenHash: string;
  now: Date;
}
export interface PresentationShareRepository {
  getPublicShareAccess(
    shareId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PresentationShareRecord | null>;
  createShare(
    input: CreatePresentationShareInput,
  ): Promise<{ share: PresentationShareRecord; replayed: boolean }>;
  listShares(
    workspaceId: string,
    presentationId: string,
    actorId: string,
  ): Promise<PresentationShareRecord[]>;
  revokeShare(
    workspaceId: string,
    presentationId: string,
    shareId: string,
    actorId: string,
    now: Date,
  ): Promise<boolean>;
  getPublicShare(
    shareId: string,
    tokenHash: string,
    now: Date,
  ): Promise<{ share: PresentationShareRecord; version: PresentationVersionRecord } | null>;
}
