import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { MemoryRepository } from "./memory.js";
import { createPresentationSessionRepository } from "./presentation-sessions.js";
import { countSurveyParticipantsInMemory } from "./surveys.js";
import {
  PlatformService,
  activeSubscription,
  platformMemberKey,
  platformRoomKey,
  stablePlatformJson,
  type PlatformStore,
} from "./platform-service.js";
import {
  PlatformError,
  type PlatformRoomCoverage,
  type PlatformRoomCoverageInput,
  type OrganizationRecord,
  type OrganizationMemberRecord,
  type OrganizationWorkspaceRecord,
  type PlatformSubscription,
  type LicenseAssignment,
  type UserLicenseAssignment,
  type CreditLedgerEntry,
  type PlatformRoomType,
  type ProductQueueKind,
  type ProductQueueHealth,
  type ActiveRoomSummary,
} from "./platform-types.js";

type StoredValue = { organizationId: string | null; value: unknown };
const memoryTransaction = new AsyncLocalStorage<MemoryPlatformStore>();
export class MemoryPlatformStore implements PlatformStore {
  readonly records = new Map<string, StoredValue>();
  private tail: Promise<void> = Promise.resolve();
  busy = false;
  private rollbackActions: Array<() => void> = [];
  constructor(
    readonly repository: MemoryRepository,
    private readonly bound = false,
    private readonly parent?: MemoryPlatformStore,
  ) {}
  private root() {
    return this.parent ?? this;
  }
  private key(kind: string, id: string) {
    return `${kind}\u0000${id}`;
  }
  ensureLegacyWorkspaces() {
    const root = this.root();
    for (const workspace of this.repository.workspaces.values()) {
      if (root.records.has(this.key("workspace_link", workspace.id))) continue;
      const owner = [...this.repository.workspaceMembers.values()].find(
        (m) => m.workspaceId === workspace.id && m.role === "owner",
      );
      if (!owner) continue;
      const org = workspace.id;
      const now = new Date();
      root.records.set(this.key("organization", org), {
        organizationId: org,
        value: {
          id: org,
          name: workspace.name,
          status: "active",
          accountType: "personal",
          licenseUnit: "workspace",
          createdAt: now,
          updatedAt: now,
        },
      });
      root.records.set(this.key("member", platformMemberKey(org, owner.userId)), {
        organizationId: org,
        value: { organizationId: org, userId: owner.userId, role: "owner", createdAt: now },
      });
      root.records.set(this.key("workspace_link", workspace.id), {
        organizationId: org,
        value: org,
      });
      root.records.set(this.key("workspace_owner", workspace.id), {
        organizationId: org,
        value: owner.userId,
      });
      const plan = this.repository.plans.get(workspace.id) ?? "free";
      if (plan !== "free") {
        const subscription: PlatformSubscription = {
          organizationId: org,
          customerId: null,
          subscriptionId: null,
          status: "active",
          licenseQuantity: 1,
          offerId: null,
          paidThrough: null,
          graceUntil: null,
          updatedAt: now,
          legacyPlan: plan,
        };
        root.records.set(this.key("subscription", org), {
          organizationId: org,
          value: subscription,
        });
        root.records.set(this.key("license", workspace.id), {
          organizationId: org,
          value: {
            organizationId: org,
            workspaceId: workspace.id,
            assignedBy: owner.userId,
            assignedAt: now,
          },
        });
      }
    }
  }
  getSync<T>(kind: string, id: string): T | null {
    this.ensureLegacyWorkspaces();
    if (kind === "workspace") {
      const workspace = this.repository.workspaces.get(id);
      if (!workspace) return null;
      const organizationId = this.root().records.get(this.key("workspace_link", id))?.value as
        string | undefined;
      const owner = [...this.repository.workspaceMembers.values()].find(
        (m) => m.workspaceId === id && m.role === "owner",
      );
      const ownerId =
        (this.root().records.get(this.key("workspace_owner", id))?.value as string | undefined) ??
        owner?.userId;
      if (!organizationId || !ownerId) return null;
      const status = this.root().records.get(this.key("workspace_status", id))?.value ?? "active";
      return structuredClone({ ...workspace, organizationId, ownerId, status }) as T;
    }
    const value = this.root().records.get(this.key(kind, id));
    return value ? (structuredClone(value.value) as T) : null;
  }
  listSync<T>(kind: string, org?: string): T[] {
    this.ensureLegacyWorkspaces();
    if (kind === "workspace")
      return [...this.repository.workspaces.keys()]
        .map((id) => this.getSync<OrganizationWorkspaceRecord>(kind, id))
        .filter((w): w is OrganizationWorkspaceRecord =>
          Boolean(w && (!org || w.organizationId === org)),
        ) as T[];
    return [...this.root().records.entries()]
      .filter(
        ([key, record]) =>
          key.startsWith(`${kind}\u0000`) && (!org || record.organizationId === org),
      )
      .map(([, record]) => structuredClone(record.value) as T);
  }
  putSync<T>(kind: string, id: string, org: string | null, value: T) {
    if (kind === "workspace") {
      const workspace = value as OrganizationWorkspaceRecord;
      const current = this.repository.workspaces.get(id);
      if (!current) throw new PlatformError("NOT_FOUND", "Workspace not found");
      current.name = workspace.name;
      this.root().records.set(this.key("workspace_status", id), {
        organizationId: org,
        value: workspace.status,
      });
      return;
    }
    const prior = this.root().records.get(this.key(kind, id));
    if (["ledger", "audit", "stripe_transaction"].includes(kind) && prior)
      throw new PlatformError("IMMUTABLE_RECORD", "Ledger and audit entries are append-only");
    if (kind === "coverage" && prior) {
      const before = prior.value as PlatformRoomCoverage;
      const after = value as PlatformRoomCoverage;
      if (
        before.organizationId !== after.organizationId ||
        before.workspaceId !== after.workspaceId ||
        before.funding !== after.funding ||
        stablePlatformJson(before.snapshot) !== stablePlatformJson(after.snapshot) ||
        before.expiresAt.getTime() !== after.expiresAt.getTime()
      )
        throw new PlatformError("IMMUTABLE_RECORD", "Room commercial terms are immutable");
    }
    this.root().records.set(this.key(kind, id), {
      organizationId: org,
      value: structuredClone(value),
    });
  }
  async get<T>(kind: string, id: string) {
    if (!this.bound && this.root().busy && memoryTransaction.getStore()?.root() !== this.root())
      await this.root().tail;
    return this.getSync<T>(kind, id);
  }
  async list<T>(kind: string, org?: string) {
    if (!this.bound && this.root().busy && memoryTransaction.getStore()?.root() !== this.root())
      await this.root().tail;
    return this.listSync<T>(kind, org);
  }
  async put<T>(kind: string, id: string, org: string | null, value: T): Promise<void> {
    if (!this.bound)
      return this.transaction(`write:${kind}`, (store) => store.put(kind, id, org, value));
    this.putSync(kind, id, org, value);
  }
  async remove(kind: string, id: string) {
    if (!this.bound) return this.transaction(`delete:${kind}`, (store) => store.remove(kind, id));
    if (["ledger", "audit", "coverage", "stripe_transaction"].includes(kind))
      throw new PlatformError("IMMUTABLE_RECORD", "Financial and audit records cannot be deleted");
    return this.root().records.delete(this.key(kind, id));
  }
  async userExists(id: string) {
    const user = this.repository.users.get(id);
    return Boolean(user && !user.deletedAt);
  }
  async userEmail(id: string) {
    const user = this.repository.users.get(id);
    return user && !user.deletedAt ? user.email : null;
  }
  async organizationIdForWorkspace(workspace: string) {
    this.ensureLegacyWorkspaces();
    return (
      (this.root().records.get(this.key("workspace_link", workspace))?.value as
        string | undefined) ?? null
    );
  }
  async createWorkspace(input: OrganizationWorkspaceRecord) {
    if (this.repository.workspaces.has(input.id))
      throw new PlatformError("CONFLICT", "Workspace already exists");
    this.repository.workspaces.set(input.id, {
      id: input.id,
      name: input.name,
      segment: input.segment,
      homeRegion: input.homeRegion,
      embedAllowedOrigins: [],
    });
    this.repository.workspaceMembers.set(`${input.id}:${input.ownerId}`, {
      workspaceId: input.id,
      userId: input.ownerId,
      role: "owner",
      joinedAt: new Date(),
    });
    this.repository.plans.set(input.id, "free");
    this.root().records.set(this.key("workspace_link", input.id), {
      organizationId: input.organizationId,
      value: input.organizationId,
    });
    this.root().records.set(this.key("workspace_owner", input.id), {
      organizationId: input.organizationId,
      value: input.ownerId,
    });
  }
  async transferWorkspaceOwner(id: string, userId: string) {
    const successor = this.repository.workspaceMembers.get(`${id}:${userId}`);
    if (!successor)
      throw new PlatformError("NOT_FOUND", "New steward must already belong to the workspace");
    for (const member of this.repository.workspaceMembers.values()) {
      if (member.workspaceId === id && member.role === "owner") {
        member.role = "editor";
        const previousUser = this.repository.users.get(member.userId);
        if (previousUser?.workspaceId === id) previousUser.role = "editor";
      }
    }
    successor.role = "owner";
    const nextUser = this.repository.users.get(userId);
    if (nextUser?.workspaceId === id) nextUser.role = "owner";
    this.root().records.set(this.key("workspace_owner", id), {
      organizationId: await this.organizationIdForWorkspace(id),
      value: userId,
    });
  }
  async grantWorkspaceMembership(
    workspaceId: string,
    userId: string,
    role: "owner" | "editor" | "viewer",
  ) {
    const current = this.repository.workspaceMembers.get(`${workspaceId}:${userId}`);
    if (current && role !== "owner") return;
    this.repository.workspaceMembers.set(`${workspaceId}:${userId}`, {
      workspaceId,
      userId,
      role,
      joinedAt: new Date(),
    });
  }
  async revokeOrganizationWorkspaceMemberships(organizationId: string, userId: string) {
    const now = new Date();
    const scoped = this.listSync<OrganizationWorkspaceRecord>("workspace", organizationId);
    const controlled = new Set(
      scoped
        .filter(
          (workspace) =>
            workspace.ownerId === userId ||
            this.repository.workspaceMembers.has(`${workspace.id}:${userId}`) ||
            [...this.repository.sessionStaff.values()].some(
              (credential) =>
                credential.workspaceId === workspace.id &&
                credential.createdBy === userId &&
                !credential.revokedAt &&
                credential.expiresAt > now,
            ),
        )
        .map((workspace) => workspace.id),
    );
    for (const room of this.repository.sessions.values()) {
      if (scoped.some((workspace) => workspace.id === room.workspaceId) && room.hostId === userId)
        controlled.add(room.workspaceId);
      if (
        controlled.has(room.workspaceId) &&
        room.expiresAt > now &&
        room.state.phase !== "finished"
      )
        throw new PlatformError(
          "WORKSPACE_BUSY",
          "Finish or expire active Round and Presentation rooms before removing this user's organization access",
        );
    }
    for (const workspace of scoped) {
      const rooms = await createPresentationSessionRepository(this.repository).listSessions(
        workspace.id,
      );
      if (rooms.some((room) => room.createdBy === userId)) controlled.add(workspace.id);
      if (
        controlled.has(workspace.id) &&
        rooms.some((room) => room.status === "active" && room.liveExpiresAt > now)
      )
        throw new PlatformError(
          "WORKSPACE_BUSY",
          "Finish or expire active Round and Presentation rooms before removing this user's organization access",
        );
    }
    if (
      [...this.repository.liveRoomCodes.values()].some(
        (room) =>
          controlled.has(room.workspaceId) &&
          (room.artifactType === "round" || room.artifactType === "presentation") &&
          !room.releasedAt &&
          room.expiresAt > now,
      )
    )
      throw new PlatformError(
        "WORKSPACE_BUSY",
        "Finish or expire active Round and Presentation rooms before removing this user's organization access",
      );
    const affected = new Set(
      this.listSync<OrganizationWorkspaceRecord>("workspace", organizationId).map(
        (workspace) => workspace.id,
      ),
    );
    for (const [key, membership] of this.repository.workspaceMembers) {
      if (membership.userId === userId && affected.has(membership.workspaceId))
        this.repository.workspaceMembers.delete(key);
    }
    // Keep the selected workspace pinned. Missing membership makes creator authorization
    // fail until the user explicitly selects another workspace; never redirect stale writes.
  }
  async workspaceOwnerIds(user: string) {
    return [...this.repository.workspaceMembers.values()]
      .filter((m) => m.userId === user && m.role === "owner")
      .map((m) => m.workspaceId);
  }
  async legacyWorkspaceSubscription(workspaceId: string) {
    return this.repository.billingProfiles.get(workspaceId) ?? null;
  }
  async hasActiveSubscriptionRoom(workspace: string) {
    const now = new Date();
    for (const coverage of this.listSync<PlatformRoomCoverage>("coverage")) {
      if (
        coverage.workspaceId !== workspace ||
        coverage.funding !== "subscription" ||
        coverage.expiresAt <= now
      )
        continue;
      if (coverage.artifactType === "round") {
        const room = this.repository.sessions.get(coverage.roomId);
        if (room && room.state.phase !== "finished" && room.expiresAt > now) return true;
      } else {
        const room = await createPresentationSessionRepository(this.repository).getSessionById(
          coverage.roomId,
        );
        if (room && room.status !== "finished" && room.liveExpiresAt > now) return true;
      }
    }
    return false;
  }
  async hasActiveOrganizationRoom(org: string) {
    const workspaces = new Set(
      this.listSync<OrganizationWorkspaceRecord>("workspace", org).map((workspace) => workspace.id),
    );
    return [...this.repository.liveRoomCodes.values()].some(
      (room) => workspaces.has(room.workspaceId) && !room.releasedAt && room.expiresAt > new Date(),
    );
  }
  async lockWorkspace(_id: string) {
    /* Memory transactions serialize all workspace mutations. */
  }
  async listActiveRooms(org: string | undefined, limit: number): Promise<ActiveRoomSummary[]> {
    if (!this.bound) return this.transaction("read", (store) => store.listActiveRooms(org, limit));
    const rooms: ActiveRoomSummary[] = [];
    for (const room of [...this.repository.liveRoomCodes.values()]
      .filter((room) => !room.releasedAt && room.expiresAt > new Date())
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || a.artifactId.localeCompare(b.artifactId),
      )) {
      const workspace = this.getSync<OrganizationWorkspaceRecord>("workspace", room.workspaceId);
      if (!workspace || (org && workspace.organizationId !== org)) continue;
      const organization = this.getSync<OrganizationRecord>(
        "organization",
        workspace.organizationId,
      )!;
      const coverage = this.getSync<PlatformRoomCoverage>(
        "coverage",
        `${room.artifactType}:${room.artifactId}`,
      );
      const participantCount =
        room.artifactType === "round"
          ? [...this.repository.participants.values()].filter(
              (participant) => participant.sessionId === room.artifactId,
            ).length
          : room.artifactType === "presentation"
            ? (
                await createPresentationSessionRepository(this.repository).listParticipants(
                  room.artifactId,
                )
              ).length
            : countSurveyParticipantsInMemory(this.repository, room.artifactId);
      rooms.push({
        organizationId: organization.id,
        organizationName: organization.name,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        artifactType: room.artifactType,
        roomId: room.artifactId,
        code: room.code,
        participantCount,
        expiresAt: room.expiresAt,
        funding: coverage?.funding ?? null,
      });
      if (rooms.length === limit) break;
    }
    return rooms;
  }
  async getProductQueueHealth(now: Date): Promise<ProductQueueHealth[]> {
    if (!this.bound) return this.transaction("read", (store) => store.getProductQueueHealth(now));
    const round = [...this.repository.reports.values()].map((report) => {
      const metadata = this.repository.reportJobs.get(report.id);
      const room = this.repository.sessions.get(report.sessionId);
      return {
        id: report.id,
        status: report.status,
        createdAt:
          this.repository.reportCreatedAt.get(report.id) ?? new Date(report.generatedAt ?? now),
        processing:
          report.status === "pending" &&
          Boolean(
            metadata && metadata.attempts > 0 && metadata.availableAt > now && !metadata.lastError,
          ),
        retryable: report.status === "failed" && Boolean(room && room.retentionExpiresAt > now),
      };
    });
    const presentation = createPresentationSessionRepository(
      this.repository,
    ).operatorReportQueueRows(now);
    const authoring = [...this.repository.authoringJobs.values()].map((job) => ({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      processing: job.status === "processing",
      retryable:
        job.status === "failed" &&
        job.expiresAt > now &&
        !job.appliedQuizId &&
        !job.output &&
        Boolean(job.sourceText !== null || job.sourceBlob !== null),
    }));
    return (
      [
        { kind: "round-report", rows: round },
        { kind: "presentation-report", rows: presentation },
        { kind: "authoring", rows: authoring },
      ] as const
    ).map(({ kind, rows }) => {
      const failed = rows
        .filter((row) => row.status === "failed")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      const pending = rows.filter((row) => row.status === "pending" || row.status === "processing");
      return {
        kind,
        pending: rows.filter((row) => row.status === "pending" && !row.processing).length,
        processing: rows.filter((row) => row.processing).length,
        failed: failed.length,
        oldestPendingAgeSeconds: pending.length
          ? Math.max(
              0,
              (now.getTime() - Math.min(...pending.map((row) => row.createdAt.getTime()))) / 1000,
            )
          : 0,
        failedIds: failed.slice(0, 100).map((row) => row.id),
        retryableFailedIds: failed
          .filter((row) => row.retryable)
          .slice(0, 100)
          .map((row) => row.id),
      };
    });
  }
  async retryFailedProductJob(kind: ProductQueueKind, id: string, now: Date): Promise<boolean> {
    if (!this.bound)
      return this.transaction("operator", (store) => store.retryFailedProductJob(kind, id, now));
    if (kind === "presentation-report") {
      const undo = createPresentationSessionRepository(
        this.repository,
      ).retryFailedReportForOperator(id, now);
      if (!undo) return false;
      this.root().rollbackActions.push(undo);
      return true;
    }
    if (kind === "authoring") {
      const job = this.repository.authoringJobs.get(id);
      if (
        !job ||
        job.status !== "failed" ||
        job.expiresAt <= now ||
        job.appliedQuizId ||
        job.output ||
        (job.sourceText === null && job.sourceBlob === null)
      )
        return false;
      const before = structuredClone(job);
      this.root().rollbackActions.push(() => this.repository.authoringJobs.set(id, before));
      this.repository.authoringJobs.set(id, {
        ...job,
        status: "pending",
        availableAt: now,
        lastError: null,
        updatedAt: now,
      });
      return true;
    }
    const report = this.repository.reports.get(id);
    const room = report ? this.repository.sessions.get(report.sessionId) : null;
    if (!report || report.status !== "failed" || !room || room.retentionExpiresAt <= now)
      return false;
    const before = structuredClone(report);
    const metadata = this.repository.reportJobs.get(id);
    const priorMetadata = metadata ? structuredClone(metadata) : null;
    this.root().rollbackActions.push(() => {
      this.repository.reports.set(id, before);
      if (priorMetadata) this.repository.reportJobs.set(id, priorMetadata);
      else this.repository.reportJobs.delete(id);
    });
    this.repository.reports.set(id, { ...report, status: "pending" });
    this.repository.reportJobs.set(id, {
      workspaceId: room.workspaceId,
      attempts: metadata?.attempts ?? 0,
      availableAt: now,
      lastError: null,
    });
    return true;
  }
  async withRoomLifecycleLock<T>(
    type: PlatformRoomType,
    roomId: string,
    work: (
      store: PlatformStore,
      state: { closed: boolean; hasAudience: boolean } | null,
    ) => Promise<T>,
  ): Promise<T> {
    if (!this.bound)
      return this.transaction("room-repair", (store) =>
        store.withRoomLifecycleLock(type, roomId, work),
      );
    if (type === "round") {
      const room = this.repository.sessions.get(roomId);
      if (!room) return work(this, null);
      return work(this, {
        closed: room.state.phase === "finished" || room.expiresAt <= new Date(),
        hasAudience:
          Object.keys(room.state.participants).length > 0 ||
          [...this.repository.participants.values()].some(
            (participant) => participant.sessionId === roomId,
          ),
      });
    }
    const presentations = createPresentationSessionRepository(this.repository);
    const room = await presentations.getSessionById(roomId);
    return work(
      this,
      room
        ? {
            closed: room.status === "finished" || room.liveExpiresAt <= new Date(),
            hasAudience: (await presentations.listParticipants(roomId)).length > 0,
          }
        : null,
    );
  }
  async deleteUserMemberships(user: string) {
    for (const [key, member] of this.repository.workspaceMembers)
      if (member.userId === user) this.repository.workspaceMembers.delete(key);
  }
  async transaction<T>(_scope: string, work: (store: PlatformStore) => Promise<T>): Promise<T> {
    if (this.bound) return work(this);
    const active = memoryTransaction.getStore();
    if (active?.root() === this.root()) return work(active);
    const root = this.root();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = root.tail;
    root.tail = previous.then(() => next);
    await previous;
    const records = structuredClone(root.records);
    const workspaces = structuredClone(this.repository.workspaces);
    const memberships = structuredClone(this.repository.workspaceMembers);
    const plans = structuredClone(this.repository.plans);
    const users = structuredClone(this.repository.users);
    const sessions = structuredClone(this.repository.creatorSessions);
    root.busy = true;
    root.rollbackActions = [];
    try {
      const scoped = new MemoryPlatformStore(this.repository, true, root);
      return await memoryTransaction.run(scoped, () => work(scoped));
    } catch (error) {
      for (const undo of root.rollbackActions.reverse()) undo();
      root.records.clear();
      for (const [key, value] of records) root.records.set(key, value);
      this.repository.workspaces.clear();
      for (const [key, value] of workspaces) this.repository.workspaces.set(key, value);
      this.repository.workspaceMembers.clear();
      for (const [key, value] of memberships) this.repository.workspaceMembers.set(key, value);
      this.repository.plans.clear();
      for (const [key, value] of plans) this.repository.plans.set(key, value);
      this.repository.users.clear();
      for (const [key, value] of users) this.repository.users.set(key, value);
      this.repository.creatorSessions.clear();
      for (const [key, value] of sessions) this.repository.creatorSessions.set(key, value);
      throw error;
    } finally {
      root.rollbackActions = [];
      root.busy = false;
      release();
    }
  }
  atomicSync<T>(work: () => T) {
    const root = this.root();
    if (root.busy && memoryTransaction.getStore()?.root() !== root)
      throw new PlatformError("CONFLICT", "Platform transaction is busy; retry");
    const snapshot = structuredClone(root.records);
    try {
      return work();
    } catch (error) {
      root.records.clear();
      for (const [key, value] of snapshot) root.records.set(key, value);
      throw error;
    }
  }
  assertMutationAllowed() {
    const root = this.root();
    if (root.busy && memoryTransaction.getStore()?.root() !== root)
      throw new PlatformError("CONFLICT", "Platform transaction is busy; retry");
  }
}

const memoryPlatforms = new WeakMap<MemoryRepository, MemoryPlatformRepository>();
export function getMemoryPlatformRepository(repository: MemoryRepository) {
  let platform = memoryPlatforms.get(repository);
  if (!platform) {
    platform = new MemoryPlatformRepository(repository);
    memoryPlatforms.set(repository, platform);
  }
  return platform;
}
export function reserveRoomCoverageInMemory(
  repository: MemoryRepository,
  input: PlatformRoomCoverageInput,
) {
  return getMemoryPlatformRepository(repository).reserveSync(input);
}
export function consumeRoomCoverageInMemory(
  repository: MemoryRepository,
  type: "round" | "presentation",
  room: string,
) {
  return getMemoryPlatformRepository(repository).transitionSync(type, room, true);
}
export function releaseRoomCoverageInMemory(
  repository: MemoryRepository,
  type: "round" | "presentation",
  room: string,
) {
  return getMemoryPlatformRepository(repository).transitionSync(type, room, false);
}
export function assertAudienceAdmissionInMemory(repository: MemoryRepository, workspace: string) {
  const restriction = getMemoryPlatformRepository(repository).memoryStore.getSync<{
    blocked: boolean;
  }>("admission", workspace);
  if (restriction?.blocked)
    throw new PlatformError(
      "ADMISSION_RESTRICTED",
      "Audience admission is restricted for this workspace",
    );
}

function licensedWorkspaceSync(
  store: MemoryPlatformStore,
  organization: OrganizationRecord,
  subscription: PlatformSubscription,
  workspaceId: string,
) {
  if ((subscription.licenseUnit ?? organization.licenseUnit ?? "workspace") === "user") {
    const assignment = store
      .listSync<UserLicenseAssignment>("user_license", organization.id)
      .sort(
        (a, b) =>
          a.assignedAt.getTime() - b.assignedAt.getTime() || a.userId.localeCompare(b.userId),
      )
      .slice(0, subscription.licenseQuantity)
      .find((candidate) => candidate.workspaceId === workspaceId);
    if (!assignment) return false;
    const member = store.getSync<OrganizationMemberRecord>(
      "member",
      platformMemberKey(organization.id, assignment.userId),
    );
    return Boolean(member && member.role !== "billing");
  }
  return store
    .listSync<LicenseAssignment>("license", organization.id)
    .sort(
      (a, b) =>
        a.assignedAt.getTime() - b.assignedAt.getTime() ||
        a.workspaceId.localeCompare(b.workspaceId),
    )
    .slice(0, subscription.licenseQuantity)
    .some((assignment) => assignment.workspaceId === workspaceId);
}

export class MemoryPlatformRepository extends PlatformService {
  readonly memoryStore: MemoryPlatformStore;
  constructor(repository: MemoryRepository) {
    const store = new MemoryPlatformStore(repository);
    super(store);
    this.memoryStore = store;
  }
  assertWorkspaceCreationSync(workspaceId: string) {
    this.memoryStore.atomicSync(() => {
      const workspace = this.memoryStore.getSync<OrganizationWorkspaceRecord>(
        "workspace",
        workspaceId,
      );
      if (!workspace) return;
      const org = this.memoryStore.getSync<OrganizationRecord>(
        "organization",
        workspace.organizationId,
      );
      if (org?.status !== "active")
        throw new PlatformError("ORGANIZATION_SUSPENDED", "Organization is not active");
      if (workspace.status !== "active")
        throw new PlatformError("WORKSPACE_SUSPENDED", "Workspace is not active");
    });
  }
  effectivePlanSync(workspace: string): "free" | "pro" | "team" | null {
    const record = this.memoryStore.getSync<OrganizationWorkspaceRecord>("workspace", workspace);
    if (!record) return null;
    const org = this.memoryStore.getSync<OrganizationRecord>("organization", record.organizationId);
    const subscription = this.memoryStore.getSync<PlatformSubscription>(
      "subscription",
      record.organizationId,
    );
    if (!subscription?.authoritative) return null;
    if (this.memoryStore.getSync<{ held: boolean }>("commercial_hold", record.organizationId)?.held)
      return "free";
    if (org?.status !== "active" || !activeSubscription(subscription)) return "free";
    if (!licensedWorkspaceSync(this.memoryStore, org, subscription, workspace)) return "free";
    const offer =
      subscription.offerSnapshot ??
      (subscription.offerId
        ? this.memoryStore.getSync<{ entitlements: { plan: "free" | "pro" | "team" } }>(
            "offer",
            subscription.offerId,
          )
        : null);
    return offer?.entitlements.plan === "team" || (!offer && subscription.legacyPlan === "team")
      ? "team"
      : "pro";
  }
  reserveSync(input: PlatformRoomCoverageInput): PlatformRoomCoverage {
    return this.memoryStore.atomicSync(() => {
      const store = this.memoryStore;
      const workspace = store.getSync<OrganizationWorkspaceRecord>("workspace", input.workspaceId);
      if (!workspace) throw new PlatformError("NOT_FOUND", "Workspace not found");
      const org = store.getSync<OrganizationRecord>("organization", workspace.organizationId);
      const key = platformRoomKey(input.artifactType, input.roomId);
      const previous = store.getSync<PlatformRoomCoverage>("coverage", key);
      if (previous) {
        if (
          previous.workspaceId !== input.workspaceId ||
          stablePlatformJson(previous.snapshot) !== stablePlatformJson(input.snapshot) ||
          (input.funding !== "auto" && previous.funding !== input.funding) ||
          previous.creationRequestHash !== input.creationRequestHash
        )
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Room coverage already has different terms",
          );
        return previous;
      }
      if (org?.status !== "active" || workspace.status !== "active")
        throw new PlatformError("ORGANIZATION_SUSPENDED", "Organization or workspace is suspended");
      const now = new Date();
      if (input.expiresAt <= now)
        throw new PlatformError("VALIDATION_ERROR", "Room coverage must expire in the future");
      const subscription = store.getSync<PlatformSubscription>("subscription", org.id);
      const licensed =
        subscription &&
        activeSubscription(subscription, now) &&
        licensedWorkspaceSync(store, org, subscription, input.workspaceId);
      const funding =
        input.funding === "auto" ? (licensed ? "subscription" : "credit") : input.funding;
      if (
        store.getSync<{ held: boolean }>("commercial_hold", org.id)?.held &&
        (funding === "credit" || funding === "subscription")
      )
        throw new PlatformError("COMMERCIAL_HOLD", "Premium room creation is on commercial hold");
      if (funding === "subscription" && !licensed)
        throw new PlatformError("LICENSE_LIMIT", "No active license");
      if (
        input.creationKey &&
        store
          .listSync<PlatformRoomCoverage>("coverage", org.id)
          .some((c) => c.workspaceId === input.workspaceId && c.creationKey === input.creationKey)
      )
        throw new PlatformError(
          "CREATION_ALREADY_EXISTS",
          "Creation key already belongs to another room",
        );
      const coverage: PlatformRoomCoverage = {
        ...input,
        organizationId: org.id,
        funding,
        reservationState: funding === "credit" ? "reserved" : "none",
        createdAt: now,
        consumedAt: null,
        releasedAt: null,
      };
      if (funding === "credit") {
        const balance = store.getSync<{ balance: number; reserved: number }>("account", org.id) ?? {
          balance: 0,
          reserved: 0,
        };
        if (balance.balance - balance.reserved < 1)
          throw new PlatformError("INSUFFICIENT_CREDITS", "No event credit is available");
        store.putSync("account", org.id, org.id, { ...balance, reserved: balance.reserved + 1 });
      }
      store.putSync("coverage", key, org.id, coverage);
      return coverage;
    });
  }
  transitionSync(type: "round" | "presentation", room: string, consume: boolean) {
    return this.memoryStore.atomicSync(() => {
      const store = this.memoryStore;
      const key = platformRoomKey(type, room);
      const previous = store.getSync<PlatformRoomCoverage>("coverage", key);
      if (!previous) return null;
      if (consume && previous.reservationState === "released")
        throw new PlatformError("ROOM_CLOSED", "Reservation is released");
      if (previous.reservationState !== "reserved") return previous;
      const balance = store.getSync<{ balance: number; reserved: number }>(
        "account",
        previous.organizationId,
      );
      if (!balance || balance.reserved < 1 || balance.balance < 1)
        throw new PlatformError("LEDGER_INVARIANT", "Reservation does not match balance");
      const now = new Date();
      if (consume && previous.expiresAt <= now)
        throw new PlatformError("ROOM_CLOSED", "Reservation has expired");
      const updated: PlatformRoomCoverage = {
        ...previous,
        reservationState: consume ? "consumed" : "released",
        consumedAt: consume ? now : null,
        releasedAt: consume ? null : now,
      };
      store.putSync("account", previous.organizationId, previous.organizationId, {
        balance: balance.balance - (consume ? 1 : 0),
        reserved: balance.reserved - 1,
      });
      if (consume) {
        const sourceKey = `consume:${key}`;
        const id = createHash("sha256")
          .update(`${previous.organizationId}:${sourceKey}`)
          .digest("hex");
        const entry: CreditLedgerEntry = {
          id,
          organizationId: previous.organizationId,
          delta: -1,
          reason: "first_audience_join",
          sourceKey,
          actorId: previous.actorId,
          roomId: room,
          artifactType: type,
          createdAt: now,
        };
        store.putSync("ledger", id, previous.organizationId, entry);
      }
      store.putSync("coverage", key, previous.organizationId, updated);
      return updated;
    });
  }
}
