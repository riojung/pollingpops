import type {
  PresentationVisualImportJob,
  PresentationVisualImportPage,
} from "@openround/contracts";
import type { MediaAssetCreateInput } from "./types.js";

export interface PresentationVisualImportInputFile {
  name: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
}
export interface PresentationVisualImportCreateInput {
  id: string;
  workspaceId: string;
  presentationId: string;
  createdBy: string;
  requestId: string;
  requestHash: string;
  sourceDigest: string;
  files: PresentationVisualImportInputFile[];
  now?: Date;
  expiresAt?: Date;
}
export interface PresentationVisualImportClaim extends PresentationVisualImportJob {
  workspaceId: string;
  createdBy: string | null;
  requestId: string;
  requestHash: string;
  attempt: number;
  leaseToken: string;
  leaseUntil: Date;
  files: PresentationVisualImportInputFile[];
}
export interface PresentationVisualImportFence {
  jobId: string;
  attempt: number;
  leaseToken: string;
  now?: Date;
}
export interface PresentationVisualImportRepository {
  create(
    input: PresentationVisualImportCreateInput,
  ): Promise<{ status: "created" | "duplicate"; job: PresentationVisualImportJob }>;
  get(
    workspaceId: string,
    presentationId: string,
    jobId: string,
    now?: Date,
  ): Promise<PresentationVisualImportJob | null>;
  findByRequest(
    workspaceId: string,
    presentationId: string,
    requestId: string,
    now?: Date,
  ): Promise<{ requestHash: string; job: PresentationVisualImportJob } | null>;
  list(
    workspaceId: string,
    presentationId: string,
    limit?: number,
    now?: Date,
  ): Promise<PresentationVisualImportJob[]>;
  claim(now: Date, leaseUntil: Date): Promise<PresentationVisualImportClaim | null>;
  reservePageAssets(
    input: PresentationVisualImportFence & { assets: MediaAssetCreateInput[] },
  ): Promise<boolean>;
  complete(
    input: PresentationVisualImportFence & {
      pages: PresentationVisualImportPage[];
      warnings: string[];
    },
  ): Promise<boolean>;
  retry(
    input: PresentationVisualImportFence & {
      errorCode: string;
      errorMessage: string;
      availableAt: Date;
      failed: boolean;
    },
  ): Promise<boolean>;
  cancel(
    workspaceId: string,
    presentationId: string,
    jobId: string,
    now?: Date,
  ): Promise<PresentationVisualImportJob | null>;
  purgeExpired(now: Date): Promise<string[]>;
}
export class PresentationVisualImportError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "LIMIT_REACHED",
    message = "The visual import is unavailable for this request",
  ) {
    super(message);
  }
}
