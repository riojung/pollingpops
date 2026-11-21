import { createHash, randomUUID } from "node:crypto";
import {
  AuthoringJobSchema,
  QuizDraftSchema,
  type AuthoringJob,
  type CreateAuthoringJob,
  type QuizDraft,
} from "@openround/contracts";
import type { AuthoringJobRecord, CreatorContext, QuizRecord, Repository } from "@openround/db";
import type { MalwareScanner } from "./malware-scanner.js";

const MAX_SOURCE_BYTES = 6_000_000;

export class AuthoringError extends Error {
  constructor(
    public readonly code:
      "NOT_FOUND" | "CONFLICT" | "AUTHORING_DISABLED" | "AUTHORING_LIMIT" | "ANSWER_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "AuthoringError";
  }
}

function jobView(job: AuthoringJobRecord): AuthoringJob {
  return AuthoringJobSchema.parse({
    id: job.id,
    sourceType: job.sourceType,
    sourceName: job.sourceName,
    status: job.status,
    attempts: job.attempts,
    appliedQuizId: job.appliedQuizId,
    output: job.output,
    error: job.lastError,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}

function validBase64(value: string) {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0;
}

function expectedSignature(sourceType: Exclude<CreateAuthoringJob["sourceType"], "pasted_text">) {
  return sourceType === "pdf" ? "%PDF-" : "PK";
}

function freshDraft(draft: QuizDraft, title?: string) {
  const idMap = new Map(draft.questions.map((question) => [question.id, randomUUID()]));
  return QuizDraftSchema.parse({
    ...structuredClone(draft),
    ...(title ? { title } : {}),
    questions: draft.questions.map((question) => ({
      ...structuredClone(question),
      id: idMap.get(question.id)!,
      linkedRecheckQuestionId: question.linkedRecheckQuestionId
        ? (idMap.get(question.linkedRecheckQuestionId) ?? null)
        : null,
      ...("choices" in question
        ? { choices: question.choices.map((choice) => ({ ...choice, id: randomUUID() })) }
        : {}),
    })),
  });
}

export class AuthoringService {
  constructor(
    private readonly repository: Repository,
    readonly enabled: boolean,
    private readonly scanner: MalwareScanner | null = null,
  ) {}

  async status(workspaceId: string, monthlyLimit: number | null, now = new Date()) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const used = await this.repository.countAuthoringJobsSince(workspaceId, monthStart);
    return {
      enabled: this.enabled,
      fileUploadAvailable: this.enabled && this.scanner !== null,
      monthlyLimit,
      used,
      remaining: monthlyLimit === null ? null : Math.max(0, monthlyLimit - used),
    };
  }

  async create(
    creator: CreatorContext,
    input: CreateAuthoringJob,
    monthlyLimit: number | null,
    retentionDays: number,
    now = new Date(),
  ) {
    if (!this.enabled) {
      throw new AuthoringError(
        "AUTHORING_DISABLED",
        "The source-grounded authoring assistant is not configured on this deployment",
      );
    }
    let sourceText: string | null = null;
    let sourceBlob: Buffer | null = null;
    let sourceMimeType: string | null = null;
    if (input.sourceType === "pasted_text") sourceText = input.text;
    else {
      if (!validBase64(input.data)) {
        throw new AuthoringError("ANSWER_INVALID", "Uploaded source is not valid base64 data");
      }
      sourceBlob = Buffer.from(input.data, "base64");
      if (!sourceBlob.length || sourceBlob.length > MAX_SOURCE_BYTES) {
        throw new AuthoringError("ANSWER_INVALID", "Uploaded source must be 6 MB or smaller");
      }
      const signature = expectedSignature(input.sourceType);
      const actual = sourceBlob.subarray(0, signature.length).toString("binary");
      if (actual !== signature) {
        throw new AuthoringError(
          "ANSWER_INVALID",
          `Uploaded content does not match the ${input.sourceType.toUpperCase()} file type`,
        );
      }
      if (!this.scanner) {
        throw new AuthoringError(
          "AUTHORING_DISABLED",
          "File-based authoring requires malware scanning on this deployment",
        );
      }
      let scan: Awaited<ReturnType<MalwareScanner["scan"]>>;
      try {
        scan = await this.scanner.scan(sourceBlob);
      } catch {
        throw new AuthoringError(
          "AUTHORING_DISABLED",
          "The source security scan is temporarily unavailable",
        );
      }
      if (!scan.clean) {
        throw new AuthoringError(
          "ANSWER_INVALID",
          "The uploaded source did not pass the security scan",
        );
      }
      sourceMimeType = input.mimeType;
    }
    const sourceBytes = sourceBlob ?? Buffer.from(sourceText!, "utf8");
    const job: AuthoringJobRecord = {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      createdBy: creator.userId,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      sourceMimeType,
      sourceText,
      sourceBlob,
      sourceDigest: createHash("sha256").update(sourceBytes).digest("hex"),
      status: "pending",
      attempts: 0,
      appliedQuizId: null,
      availableAt: now,
      output: null,
      lastError: null,
      expiresAt: new Date(now.getTime() + retentionDays * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    };
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const created = await this.repository.createAuthoringJobWithinLimit(
      job,
      monthStart,
      monthlyLimit,
    );
    if (!created) {
      throw new AuthoringError(
        "AUTHORING_LIMIT",
        `This workspace has used its ${monthlyLimit}-job monthly authoring allowance`,
      );
    }
    return jobView(created);
  }

  async get(workspaceId: string, jobId: string) {
    const job = await this.repository.getAuthoringJob(workspaceId, jobId);
    if (!job) throw new AuthoringError("NOT_FOUND", "Authoring job not found");
    return jobView(job);
  }

  async list(workspaceId: string, limit = 10) {
    return (await this.repository.listAuthoringJobs(workspaceId, limit)).map(jobView);
  }

  async apply(creator: CreatorContext, jobId: string, title: string | undefined, now = new Date()) {
    const job = await this.repository.getAuthoringJob(creator.workspaceId, jobId);
    if (!job) throw new AuthoringError("NOT_FOUND", "Authoring job not found");
    if (job.status !== "ready" || !job.output) {
      throw new AuthoringError("CONFLICT", "The authoring draft is not ready to review");
    }
    const draft = freshDraft(job.output.checkpointSet, title);
    const quiz: QuizRecord = {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftSchemaVersion: 1,
      lastEditedBy: creator.userId,
      currentVersionId: null,
      folderId: null,
      tags: ["ai-assisted"],
      createdAt: now,
      updatedAt: now,
    };
    const applied = await this.repository.applyAuthoringJobDraft(creator.workspaceId, jobId, quiz);
    if (!applied) throw new AuthoringError("CONFLICT", "The authoring draft could not be applied");
    return applied;
  }
}
