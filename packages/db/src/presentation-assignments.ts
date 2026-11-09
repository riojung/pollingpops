import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { createPresentationRepository } from "./presentations.js";
import type { Repository } from "./types.js";
import { PostgresPresentationAssignmentRepository } from "./presentation-assignments-postgres.js";
import type {
  CreatePresentationAssignmentInput,
  PresentationAssignmentRecord,
  PresentationAssignmentRepository,
  StartPresentationReadingAttemptInput,
  MutatePresentationReadingAttemptInput,
} from "./presentation-assignment-types.js";
import {
  blockIds,
  changeReading,
  day,
  effectiveNow,
  expiry,
  fail,
  hash,
  initialAttempt,
  replayAssignment,
  validateCreate,
  type ReadingState,
} from "./presentation-assignment-state.js";
export class MemoryPresentationAssignmentRepository
  implements PresentationAssignmentRepository, MemoryRepositoryLifecycleExtension
{
  private assignments = new Map<string, PresentationAssignmentRecord>();
  private attempts = new Map<string, ReadingState>();
  private queue: Promise<unknown> = Promise.resolve();
  private presentations;
  constructor(private parent: MemoryRepository) {
    this.presentations = createPresentationRepository(parent);
  }
  private async serial<T>(work: () => Promise<T>) {
    const pending = this.queue.catch(() => undefined).then(work);
    this.queue = pending;
    return pending;
  }
  private member(workspaceId: string, actorId: string) {
    const user = this.parent.users.get(actorId),
      member = this.parent.workspaceMembers.get(`${workspaceId}:${actorId}`);
    return (
      !!user &&
      !user.deletedAt &&
      !!member &&
      this.parent.workspaces.has(workspaceId) &&
      ["owner", "editor"].includes(user.workspaceId === workspaceId ? user.role : member.role)
    );
  }
  private parentActive(assignment: PresentationAssignmentRecord) {
    if (
      !this.member(assignment.workspaceId, assignment.actorId) ||
      !this.parent.hasLibraryArtifact(
        assignment.workspaceId,
        "presentation",
        assignment.presentationId,
      )
    )
      return false;
    try {
      this.parent.assertWorkspaceLiveSessionCreationAllowed(assignment.workspaceId);
      return true;
    } catch {
      return false;
    }
  }
  private async source(assignmentId: string, now: Date, tokenHash?: string) {
    const assignment = this.assignments.get(assignmentId);
    if (
      !assignment ||
      !Number.isFinite(now.getTime()) ||
      (tokenHash !== undefined &&
        (!hash.test(tokenHash) ||
          !timingSafeEqual(Buffer.from(assignment.tokenHash), Buffer.from(tokenHash)))) ||
      !this.parentActive(assignment)
    )
      return null;
    const presentation = await this.presentations.getPresentation(
        assignment.workspaceId,
        assignment.presentationId,
      ),
      version = await this.presentations.getPresentationVersion(
        assignment.workspaceId,
        assignment.versionId,
      );
    if (
      !presentation ||
      !version ||
      assignment.revokedAt ||
      assignment.expiresAt <= effectiveNow(now) ||
      !this.parentActive(assignment)
    )
      return null;
    return { assignment, version };
  }
  async createAssignment(input: CreatePresentationAssignmentInput) {
    validateCreate(input);
    return this.serial(async () => {
      if (!this.member(input.workspaceId, input.actorId)) fail();
      this.parent.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
      const previous = [...this.assignments.values()].find(
        (a) =>
          a.workspaceId === input.workspaceId &&
          a.actorId === input.actorId &&
          a.requestId === input.requestId,
      );
      if (previous) return replayAssignment(previous, input);
      const presentation = await this.presentations.getPresentation(
          input.workspaceId,
          input.presentationId,
        ),
        version = await this.presentations.getPresentationVersion(
          input.workspaceId,
          input.versionId,
        );
      if (
        !presentation ||
        presentation.status === "archived" ||
        !version ||
        version.presentationId !== input.presentationId ||
        !this.member(input.workspaceId, input.actorId) ||
        !this.parent.hasLibraryArtifact(input.workspaceId, "presentation", input.presentationId) ||
        blockIds(version).length === 0 ||
        blockIds(version).length > 200
      )
        fail();
      const expiresAt = expiry(input);
      this.parent.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
      this.purgeExpired(input.now);
      const retained = [...this.assignments.values()].filter(
        (a) => a.workspaceId === input.workspaceId && a.presentationId === input.presentationId,
      );
      if (
        retained.length >= 100 ||
        retained.filter((a) => !a.revokedAt && a.expiresAt > effectiveNow(input.now)).length >= 20
      )
        fail("ASSIGNMENT_LIMIT");
      if ([...this.assignments.values()].some((a) => a.tokenHash === input.tokenHash)) fail();
      const assignment: PresentationAssignmentRecord = {
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
      this.assignments.set(assignment.id, assignment);
      return { assignment: structuredClone(assignment), replayed: false };
    });
  }
  async listAssignments(workspaceId: string, presentationId: string, actorId: string) {
    if (!this.member(workspaceId, actorId)) fail();
    return [...this.assignments.values()]
      .filter((a) => a.workspaceId === workspaceId && a.presentationId === presentationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, 100)
      .map((a) => structuredClone(a));
  }
  async revokeAssignment(
    workspaceId: string,
    presentationId: string,
    assignmentId: string,
    actorId: string,
    now: Date,
  ) {
    return this.serial(async () => {
      if (!this.member(workspaceId, actorId)) fail();
      const assignment = this.assignments.get(assignmentId);
      if (
        !assignment ||
        assignment.workspaceId !== workspaceId ||
        assignment.presentationId !== presentationId
      )
        return false;
      assignment.revokedAt ??= effectiveNow(now);
      return true;
    });
  }
  async getPublicAssignment(assignmentId: string, tokenHash: string, now: Date) {
    const value = await this.source(assignmentId, now, tokenHash);
    return value ? structuredClone(value) : null;
  }
  async getAssignmentAccess(assignmentId: string, tokenHash: string, now: Date) {
    return (await this.getPublicAssignment(assignmentId, tokenHash, now))?.assignment ?? null;
  }
  async startAttempt(input: StartPresentationReadingAttemptInput) {
    return this.serial(async () => {
      const source = await this.source(input.assignmentId, input.now, input.assignmentTokenHash);
      if (!source || !hash.test(input.tokenHash)) fail();
      const previous = this.attempts.get(input.attemptId);
      if (previous) {
        if (
          previous.attempt.assignmentId !== input.assignmentId ||
          previous.attempt.tokenHash !== input.tokenHash
        )
          fail("IDEMPOTENCY_CONFLICT");
        return { ...structuredClone(source), attempt: initialAttempt(previous), replayed: true };
      }
      const all = [...this.attempts.values()];
      if (
        all.filter((a) => a.attempt.assignmentId === input.assignmentId).length >= 1000 ||
        all.filter((a) => a.attempt.workspaceId === source.assignment.workspaceId).length >= 5000 ||
        all.filter(
          (a) =>
            this.assignments.get(a.attempt.assignmentId)?.presentationId ===
            source.assignment.presentationId,
        ).length >= 2000
      )
        fail("ATTEMPT_LIMIT");
      const now = effectiveNow(input.now),
        state: ReadingState = {
          attempt: {
            id: input.attemptId,
            assignmentId: input.assignmentId,
            workspaceId: source.assignment.workspaceId,
            tokenHash: input.tokenHash,
            revision: 0,
            readBlockIds: [],
            currentBlockId: null,
            startedAt: now,
            updatedAt: now,
            completedAt: null,
          },
          readRevisions: {},
          receipts: {},
        };
      this.attempts.set(input.attemptId, state);
      return {
        ...structuredClone(source),
        attempt: structuredClone(state.attempt),
        replayed: false,
      };
    });
  }
  async getAttempt(assignmentId: string, attemptId: string, tokenHash: string, now: Date) {
    const state = this.attempts.get(attemptId);
    if (
      !state ||
      state.attempt.assignmentId !== assignmentId ||
      !hash.test(tokenHash) ||
      !timingSafeEqual(Buffer.from(state.attempt.tokenHash), Buffer.from(tokenHash))
    )
      return null;
    const source = await this.source(assignmentId, now);
    return source ? { ...structuredClone(source), attempt: structuredClone(state.attempt) } : null;
  }
  async mutateAttempt(input: MutatePresentationReadingAttemptInput) {
    return this.serial(async () => {
      const source = await this.getAttempt(
        input.assignmentId,
        input.attemptId,
        input.tokenHash,
        input.now,
      );
      if (!source) fail();
      const state = this.attempts.get(input.attemptId)!;
      return {
        ...source,
        ...changeReading(state, source.version, input.mutation, effectiveNow(input.now)),
      };
    });
  }
  private remove(id: string) {
    this.assignments.delete(id);
    for (const [key, state] of this.attempts)
      if (state.attempt.assignmentId === id) this.attempts.delete(key);
  }
  deleteLibraryArtifactMetadata(workspaceId: string, artifactType: string, artifactId: string) {
    if (artifactType === "presentation")
      for (const [id, a] of this.assignments)
        if (a.workspaceId === workspaceId && a.presentationId === artifactId) this.remove(id);
  }
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      presentationAssignments: [...this.assignments.values()]
        .filter((a) => ownedWorkspaceIds.has(a.workspaceId))
        .map(({ tokenHash: _token, intentHash: _intent, ...a }) => structuredClone(a)),
      presentationReadingAttempts: [...this.attempts.values()]
        .filter((s) => ownedWorkspaceIds.has(s.attempt.workspaceId))
        .map(({ attempt: { tokenHash: _token, ...attempt } }) => structuredClone(attempt)),
    };
  }
  deleteAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    for (const [id, a] of this.assignments)
      if (ownedWorkspaceIds.has(a.workspaceId) || a.actorId === userId) this.remove(id);
  }
  purgeExpired(now: Date) {
    for (const [id, a] of this.assignments)
      if (a.expiresAt.getTime() <= now.getTime() - 7 * day) this.remove(id);
    return [];
  }
}
export function createPresentationAssignmentRepository(
  repository: Repository,
): PresentationAssignmentRepository {
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "presentation-assignments",
      () => new MemoryPresentationAssignmentRepository(repository),
    );
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationAssignmentRepository(repository);
  throw new Error("Unsupported Presentation assignment repository");
}
