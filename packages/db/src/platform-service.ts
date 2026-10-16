import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  ProductFeatureRulesSchema,
  type ProductFeaturePolicy,
  type ProductFeatureRules,
} from "@openround/contracts";
import type * as P from "./platform-types.js";
import { PASSWORD_OPERATOR_ISSUER, PlatformError } from "./platform-types.js";
import { hasUsableFounderReplacement } from "./operator-founder.js";

export interface PlatformStore {
  transaction<T>(scope: string, work: (store: PlatformStore) => Promise<T>): Promise<T>;
  get<T>(kind: string, id: string): Promise<T | null>;
  list<T>(kind: string, organizationId?: string): Promise<T[]>;
  put<T>(kind: string, id: string, organizationId: string | null, value: T): Promise<void>;
  remove(kind: string, id: string): Promise<boolean>;
  userExists(userId: string): Promise<boolean>;
  userEmail(userId: string): Promise<string | null>;
  createWorkspace(input: P.OrganizationWorkspaceRecord): Promise<void>;
  transferWorkspaceOwner(workspaceId: string, userId: string): Promise<void>;
  deleteUserMemberships(userId: string): Promise<void>;
  organizationIdForWorkspace(workspaceId: string): Promise<string | null>;
  workspaceOwnerIds(userId: string): Promise<string[]>;
  hasActiveSubscriptionRoom(workspaceId: string): Promise<boolean>;
  hasActiveOrganizationRoom(organizationId: string): Promise<boolean>;
  lockWorkspace(workspaceId: string): Promise<void>;
  listActiveRooms(
    organizationId: string | undefined,
    limit: number,
  ): Promise<P.ActiveRoomSummary[]>;
  getProductQueueHealth(now: Date): Promise<P.ProductQueueHealth[]>;
  retryFailedProductJob(kind: P.ProductQueueKind, id: string, now: Date): Promise<boolean>;
  withRoomLifecycleLock<T>(
    artifactType: P.PlatformRoomType,
    roomId: string,
    work: (
      store: PlatformStore,
      state: { closed: boolean; hasAudience: boolean } | null,
    ) => Promise<T>,
  ): Promise<T>;
}
export const platformMemberKey = (org: string, user: string) => `${org}:${user}`;
export const platformRoomKey = (type: P.PlatformRoomType, room: string) => `${type}:${room}`;
export function stablePlatformJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    return input;
  };
  return JSON.stringify(normalize(value));
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type ProviderLock = { key: string; token: string; expiresAt: Date };
const providerFence = new AsyncLocalStorage<ProviderLock & { lost: boolean }>();
const integer = (value: number, maximum = 1_000_000) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new PlatformError("VALIDATION_ERROR", "Expected a positive bounded integer");
};
export function activeSubscription(subscription: P.PlatformSubscription, now = new Date()) {
  return (
    (["active", "trialing"].includes(subscription.status) ||
      (["past_due", "unpaid"].includes(subscription.status) &&
        subscription.graceUntil !== null &&
        subscription.graceUntil > now)) &&
    (subscription.paidThrough === null ||
      subscription.paidThrough > now ||
      (subscription.graceUntil !== null && subscription.graceUntil > now))
  );
}
const emptySubscription = (organizationId: string): P.PlatformSubscription => ({
  organizationId,
  customerId: null,
  subscriptionId: null,
  status: "free",
  licenseQuantity: 0,
  offerId: null,
  paidThrough: null,
  graceUntil: null,
  updatedAt: new Date(),
});

/** Domain methods authorize customer operations explicitly. Trusted operator/worker methods
 * are deliberately distinct and must only be exposed through the operator authorization layer. */
export class PlatformService implements P.PlatformRepository {
  constructor(protected readonly store: PlatformStore) {}
  protected run<T>(scope: string, work: (store: PlatformStore) => Promise<T>) {
    return this.store.transaction(scope, async (store) => {
      const fence = providerFence.getStore();
      if (fence) {
        const lock = await store.get<ProviderLock>("provider_lock", fence.key);
        if (fence.lost || !lock || lock.token !== fence.token || lock.expiresAt <= new Date())
          throw new PlatformError(
            "BILLING_LOCK_LOST",
            "Provider synchronization lease was lost; retry from provider state",
          );
      }
      return work(store);
    });
  }
  private async member(
    store: PlatformStore,
    org: string,
    user: string,
    roles: P.OrganizationRole[],
  ) {
    const member = await store.get<P.OrganizationMemberRecord>(
      "member",
      platformMemberKey(org, user),
    );
    if (!member || !roles.includes(member.role) || !(await store.userExists(user)))
      throw new PlatformError("FORBIDDEN", "Organization role does not allow this action");
    return member;
  }
  private async organization(store: PlatformStore, id: string) {
    const organization = await store.get<P.OrganizationRecord>("organization", id);
    if (!organization) throw new PlatformError("NOT_FOUND", "Organization not found");
    return organization;
  }
  async withOperatorTransaction<T>(
    work: (repository: P.PlatformRepository) => Promise<T>,
  ): Promise<T> {
    return this.run("operator", (store) => work(new PlatformService(store)));
  }
  async withTransaction<T>(work: (repository: P.PlatformRepository) => Promise<T>): Promise<T> {
    return this.withOperatorTransaction(work);
  }
  async getFeaturePolicy() {
    return this.store.get<ProductFeaturePolicy>("feature_policy", "global");
  }
  async saveFeaturePolicy(input: { expectedRevision: number; features: ProductFeatureRules }) {
    const features = ProductFeatureRulesSchema.safeParse(input.features);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      !features.success
    )
      throw new PlatformError("VALIDATION_ERROR", "Invalid product feature policy");
    return this.run("operator", async (store) => {
      const previous = await store.get<ProductFeaturePolicy>("feature_policy", "global");
      if ((previous?.revision ?? 0) !== input.expectedRevision)
        throw new PlatformError("CONFLICT", "Feature policy changed; refresh before retry");
      const policy: ProductFeaturePolicy = {
        revision: input.expectedRevision + 1,
        features: features.data,
        updatedAt: new Date(),
      };
      await store.put("feature_policy", "global", null, policy);
      return policy;
    });
  }
  async withOrganizationBillingLock<T>(
    org: string,
    work: (repository: P.PlatformRepository) => Promise<T>,
  ): Promise<T> {
    return this.run(`org:${org}`, (store) => work(new PlatformService(store)));
  }
  async withProviderBillingLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const deadline = Date.now() + 10000;
    let claimed: boolean;
    do {
      claimed = await this.run(`provider:${key}`, async (store) => {
        const previous = await store.get<ProviderLock>("provider_lock", key);
        if (previous && previous.expiresAt > new Date()) return false;
        await store.put("provider_lock", key, null, {
          key,
          token,
          expiresAt: new Date(Date.now() + 60000),
        });
        return true;
      });
      if (!claimed) await new Promise((resolve) => setTimeout(resolve, 25));
    } while (!claimed && Date.now() < deadline);
    if (!claimed)
      throw new PlatformError("BILLING_BUSY", "Provider synchronization is busy; retry shortly");
    const fence = { key, token, expiresAt: new Date(Date.now() + 60000), lost: false };
    const renewal = setInterval(() => {
      void providerFence
        .exit(() =>
          this.run(`provider:${key}`, async (store) => {
            const lock = await store.get<ProviderLock>("provider_lock", key);
            if (!lock || lock.token !== token || lock.expiresAt <= new Date()) {
              fence.lost = true;
              return;
            }
            await store.put("provider_lock", key, null, {
              ...lock,
              expiresAt: new Date(Date.now() + 60000),
            });
          }),
        )
        .catch(() => {
          fence.lost = true;
        });
    }, 10000);
    renewal.unref();
    try {
      return await providerFence.run(fence, work);
    } finally {
      clearInterval(renewal);
      await providerFence
        .exit(() =>
          this.run(`provider:${key}`, async (store) => {
            const lock = await store.get<ProviderLock>("provider_lock", key);
            if (lock?.token === token) await store.remove("provider_lock", key);
          }),
        )
        .catch(() => undefined);
    }
  }
  async getOrganizationCommercialHold(org: string) {
    return this.store.get<P.OrganizationCommercialHold>("commercial_hold", org);
  }
  async setOrganizationCommercialHold(org: string, held: boolean, reason: string) {
    return this.run(`org:${org}`, async (store) => {
      await this.organization(store, org);
      if (!reason.trim())
        throw new PlatformError("VALIDATION_ERROR", "Commercial hold requires a reason");
      const hold: P.OrganizationCommercialHold = {
        organizationId: org,
        held,
        reason,
        updatedAt: new Date(),
      };
      await store.put("commercial_hold", org, org, hold);
      return hold;
    });
  }
  async listAllOrganizations(limit = 1000) {
    return (await this.store.list<P.OrganizationRecord>("organization")).slice(0, limit);
  }
  async listOrganizations(userId: string) {
    if (!(await this.store.userExists(userId))) return [];
    const members = (await this.store.list<P.OrganizationMemberRecord>("member")).filter(
      (m) => m.userId === userId,
    );
    const organizations = await this.store.list<P.OrganizationRecord>("organization");
    return members.flatMap((member) => {
      const org = organizations.find((organization) => organization.id === member.organizationId);
      return org ? [{ ...org, role: member.role }] : [];
    });
  }
  async getOrganization(org: string, user: string) {
    await this.requireOrganizationRole(org, user, ["owner", "admin", "billing", "member"]);
    return this.organization(this.store, org);
  }
  async getOrganizationForWorkspace(workspaceId: string) {
    const org = await this.store.organizationIdForWorkspace(workspaceId);
    return org ? this.store.get<P.OrganizationRecord>("organization", org) : null;
  }
  async createOrganization(input: { id?: string; name: string; actorId: string }) {
    return this.run("identity", async (store) => {
      if (!(await store.userExists(input.actorId)))
        throw new PlatformError("NOT_FOUND", "User not found");
      const name = input.name.trim();
      if (!name || name.length > 120)
        throw new PlatformError("VALIDATION_ERROR", "Organization name is required");
      const id = input.id ?? randomUUID();
      if (await store.get("organization", id))
        throw new PlatformError("CONFLICT", "Organization already exists");
      const now = new Date();
      const org: P.OrganizationRecord = {
        id,
        name,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      await store.put("organization", id, id, org);
      await store.put("member", platformMemberKey(id, input.actorId), id, {
        organizationId: id,
        userId: input.actorId,
        role: "owner",
        createdAt: now,
      });
      return org;
    });
  }
  async updateOrganizationStatus(id: string, status: P.OrganizationStatus) {
    return this.run(`org:${id}`, async (store) => {
      const org = await this.organization(store, id);
      if (org.status === "closed" && status !== "closed")
        throw new PlatformError("ORGANIZATION_CLOSED", "Closed organizations cannot be reopened");
      const updated = { ...org, status, updatedAt: new Date() };
      await store.put("organization", id, id, updated);
      return updated;
    });
  }
  async closeOrganization(id: string, actorId: string) {
    return this.run(`org:${id}`, async (store) => {
      await this.member(store, id, actorId, ["owner"]);
      const organization = await this.organization(store, id);
      if (organization.status === "closed") return organization;
      const subscription = await store.get<P.PlatformSubscription>("subscription", id);
      if (subscription && !["free", "canceled", "incomplete_expired"].includes(subscription.status))
        throw new PlatformError(
          "ACTIVE_SUBSCRIPTION",
          "Cancel the organization subscription before closing",
        );
      if (
        (await store.list<P.PlatformPurchase>("purchase", id)).some(
          (purchase) => purchase.status === "pending",
        )
      )
        throw new PlatformError(
          "PENDING_PURCHASE",
          "Complete or cancel pending purchases before closing",
        );
      if (await store.hasActiveOrganizationRoom(id))
        throw new PlatformError(
          "ACTIVE_ROOMS",
          "Finish all live rooms before closing the organization",
        );
      const updated = { ...organization, status: "closed" as const, updatedAt: new Date() };
      await store.put("organization", id, id, updated);
      return updated;
    });
  }
  async requireOrganizationRole(org: string, user: string, roles: P.OrganizationRole[]) {
    return this.member(this.store, org, user, roles);
  }
  async listOrganizationMembers(org: string, user: string) {
    await this.member(this.store, org, user, ["owner", "admin"]);
    return this.store.list<P.OrganizationMemberRecord>("member", org);
  }
  async getVerifiedOrganizationContact(org: string, user: string) {
    const membership = await this.store.get<P.OrganizationMemberRecord>(
      "member",
      platformMemberKey(org, user),
    );
    const email = membership ? await this.store.userEmail(user) : null;
    return email ? { userId: user, email } : null;
  }
  async listOrganizationContactsForOperator(org: string) {
    const contacts = await Promise.all(
      (await this.store.list<P.OrganizationMemberRecord>("member", org)).map((member) =>
        this.getVerifiedOrganizationContact(org, member.userId),
      ),
    );
    return contacts.filter(
      (contact): contact is { userId: string; email: string } => contact !== null,
    );
  }
  async setOrganizationMember(input: {
    organizationId: string;
    actorId: string;
    userId: string;
    role: P.OrganizationRole;
  }) {
    return this.run("identity", async (store) =>
      store.transaction(`org:${input.organizationId}`, async (store) => {
        const actor = await this.member(store, input.organizationId, input.actorId, [
          "owner",
          "admin",
        ]);
        const id = platformMemberKey(input.organizationId, input.userId);
        const previous = await store.get<P.OrganizationMemberRecord>("member", id);
        if ((input.role === "owner" || previous?.role === "owner") && actor.role !== "owner")
          throw new PlatformError("FORBIDDEN", "Only owners can change organization ownership");
        if (!(await store.userExists(input.userId)))
          throw new PlatformError("NOT_FOUND", "User not found");
        if (previous?.role === "owner" && input.role !== "owner")
          await this.ensureAnotherOwner(store, input.organizationId, input.userId);
        const member: P.OrganizationMemberRecord = {
          organizationId: input.organizationId,
          userId: input.userId,
          role: input.role,
          createdAt: previous?.createdAt ?? new Date(),
        };
        await store.put("member", id, input.organizationId, member);
        return member;
      }),
    );
  }
  private async ensureAnotherOwner(store: PlatformStore, org: string, excludedUser: string) {
    const owners = (await store.list<P.OrganizationMemberRecord>("member", org)).filter(
      (m) => m.role === "owner" && m.userId !== excludedUser,
    );
    if (!owners.length)
      throw new PlatformError(
        "OWNERSHIP_TRANSFER_REQUIRED",
        "Transfer organization ownership first",
      );
  }
  async removeOrganizationMember(org: string, actorId: string, userId: string) {
    return this.run("identity", async (store) =>
      store.transaction(`org:${org}`, async (store) => {
        const actor = await this.member(store, org, actorId, ["owner", "admin"]);
        const member = await store.get<P.OrganizationMemberRecord>(
          "member",
          platformMemberKey(org, userId),
        );
        if (!member) return false;
        if (member.role === "owner") {
          if (actor.role !== "owner")
            throw new PlatformError("FORBIDDEN", "Only owners can remove owners");
          await this.ensureAnotherOwner(store, org, userId);
        }
        return store.remove("member", platformMemberKey(org, userId));
      }),
    );
  }
  async createOrganizationInvitation(input: {
    organizationId: string;
    actorId: string;
    email: string;
    role: P.OrganizationRole;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.run(`org:${input.organizationId}`, async (store) => {
      const actor = await this.member(store, input.organizationId, input.actorId, [
        "owner",
        "admin",
      ]);
      if (input.role === "owner" && actor.role !== "owner")
        throw new PlatformError("FORBIDDEN", "Only an owner can invite another owner");
      const email = input.email.trim().toLowerCase();
      const now = new Date();
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 320 ||
        input.expiresAt <= now ||
        !input.tokenHash
      )
        throw new PlatformError("VALIDATION_ERROR", "Invitation is invalid");
      const existing = (
        await store.list<P.OrganizationInvitationRecord>("invitation", input.organizationId)
      ).find(
        (invite) =>
          invite.email === email &&
          !invite.acceptedAt &&
          !invite.revokedAt &&
          invite.expiresAt > now,
      );
      if (existing)
        throw new PlatformError("CONFLICT", "An active invitation already exists for this email");
      const invitation: P.OrganizationInvitationRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        email,
        role: input.role,
        tokenHash: input.tokenHash,
        createdBy: input.actorId,
        expiresAt: input.expiresAt,
        acceptedAt: null,
        revokedAt: null,
        createdAt: now,
      };
      await store.put("invitation", invitation.id, input.organizationId, invitation);
      return invitation;
    });
  }
  async listOrganizationInvitations(org: string, actor: string) {
    await this.member(this.store, org, actor, ["owner", "admin"]);
    return this.store.list<P.OrganizationInvitationRecord>("invitation", org);
  }
  async revokeOrganizationInvitation(org: string, actor: string, id: string) {
    return this.run(`org:${org}`, async (store) => {
      await this.member(store, org, actor, ["owner", "admin"]);
      const invite = await store.get<P.OrganizationInvitationRecord>("invitation", id);
      if (!invite || invite.organizationId !== org || invite.acceptedAt || invite.revokedAt)
        return false;
      await store.put("invitation", id, org, { ...invite, revokedAt: new Date() });
      return true;
    });
  }
  async acceptOrganizationInvitation(input: {
    tokenHash: string;
    actorId: string;
    userEmail?: string;
    now?: Date;
  }) {
    const invite = (await this.store.list<P.OrganizationInvitationRecord>("invitation")).find(
      (entry) => entry.tokenHash === input.tokenHash,
    );
    if (!invite) throw new PlatformError("INVALID_INVITATION", "Invitation is unavailable");
    return this.run("identity", async (store) =>
      store.transaction(`org:${invite.organizationId}`, async (store) => {
        const invitation = (await store.get<P.OrganizationInvitationRecord>(
          "invitation",
          invite.id,
        ))!;
        const now = input.now ?? new Date();
        const email = await store.userEmail(input.actorId);
        if (
          !email ||
          email.toLowerCase() !== invitation.email ||
          invitation.acceptedAt ||
          invitation.revokedAt ||
          invitation.expiresAt <= now ||
          (await this.organization(store, invitation.organizationId)).status !== "active"
        )
          throw new PlatformError(
            "INVALID_INVITATION",
            "Invitation does not match your verified account or has expired",
          );
        const key = platformMemberKey(invitation.organizationId, input.actorId);
        const previous = await store.get<P.OrganizationMemberRecord>("member", key);
        const member: P.OrganizationMemberRecord = previous ?? {
          organizationId: invitation.organizationId,
          userId: input.actorId,
          role: invitation.role,
          createdAt: now,
        };
        if (!previous) await store.put("member", key, invitation.organizationId, member);
        await store.put("invitation", invitation.id, invitation.organizationId, {
          ...invitation,
          acceptedAt: now,
        });
        return member;
      }),
    );
  }
  async listOrganizationWorkspaces(org: string, user: string) {
    await this.member(this.store, org, user, ["owner", "admin", "billing", "member"]);
    return this.store.list<P.OrganizationWorkspaceRecord>("workspace", org);
  }
  async listOrganizationWorkspacesForOperator(org: string) {
    return this.store.list<P.OrganizationWorkspaceRecord>("workspace", org);
  }
  async createOrganizationWorkspace(input: {
    organizationId: string;
    actorId: string;
    name: string;
    segment: "education" | "workplace";
    id?: string;
  }) {
    return this.run(`org:${input.organizationId}`, async (store) => {
      await this.member(store, input.organizationId, input.actorId, ["owner", "admin"]);
      const org = await this.organization(store, input.organizationId);
      if (org.status !== "active")
        throw new PlatformError("ORGANIZATION_SUSPENDED", "Organization is not active");
      const name = input.name.trim();
      if (!name || name.length > 120)
        throw new PlatformError("VALIDATION_ERROR", "Workspace name is required");
      const workspace: P.OrganizationWorkspaceRecord = {
        id: input.id ?? randomUUID(),
        organizationId: input.organizationId,
        name,
        segment: input.segment,
        homeRegion: "ca-central-1",
        ownerId: input.actorId,
        status: "active",
      };
      await store.createWorkspace(workspace);
      return workspace;
    });
  }
  async transferWorkspaceOwnership(workspace: string, actor: string, user: string) {
    const org = await this.store.organizationIdForWorkspace(workspace);
    if (!org) throw new PlatformError("NOT_FOUND", "Workspace not found");
    return this.run("identity", async (store) =>
      store.transaction(`workspace:${workspace}`, async (store) => {
        await this.member(store, org, actor, ["owner", "admin"]);
        if (!(await store.userExists(user))) throw new PlatformError("NOT_FOUND", "User not found");
        await store.transferWorkspaceOwner(workspace, user);
      }),
    );
  }
  async updateWorkspaceStatus(id: string, status: "active" | "suspended") {
    const org = await this.store.organizationIdForWorkspace(id);
    if (!org) throw new PlatformError("NOT_FOUND", "Workspace not found");
    return this.run("read", async (store) => {
      await store.lockWorkspace(id);
      return store.transaction(`org:${org}`, async (store) => {
        const workspace = await store.get<P.OrganizationWorkspaceRecord>("workspace", id);
        if (!workspace) throw new PlatformError("NOT_FOUND", "Workspace not found");
        const updated = { ...workspace, status };
        await store.put("workspace", id, org, updated);
        return updated;
      });
    });
  }
  async getSubscription(org: string) {
    return (
      (await this.store.get<P.PlatformSubscription>("subscription", org)) ?? emptySubscription(org)
    );
  }
  async listSubscriptions() {
    return this.store.list<P.PlatformSubscription>("subscription");
  }
  async applySubscriptionSnapshot(
    input: Omit<P.PlatformSubscription, "updatedAt"> & { now?: Date },
  ) {
    return this.run(`org:${input.organizationId}`, async (store) => {
      await this.organization(store, input.organizationId);
      if (
        !Number.isSafeInteger(input.licenseQuantity) ||
        input.licenseQuantity < 0 ||
        input.licenseQuantity > 10000
      )
        throw new PlatformError("VALIDATION_ERROR", "Invalid license quantity");
      const { now, ...snapshot } = input;
      const previous = await store.get<P.PlatformSubscription>(
        "subscription",
        input.organizationId,
      );
      const subscription: P.PlatformSubscription = {
        ...snapshot,
        ...((input.legacyPlan ?? previous?.legacyPlan)
          ? { legacyPlan: input.legacyPlan ?? previous?.legacyPlan }
          : {}),
        authoritative: true,
        updatedAt: now ?? new Date(),
      };
      await store.put("subscription", input.organizationId, input.organizationId, subscription);
      return subscription;
    });
  }
  async listLicenseAssignments(org: string, user: string) {
    await this.member(this.store, org, user, ["owner", "admin", "billing"]);
    return this.store.list<P.LicenseAssignment>("license", org);
  }
  async assignWorkspaceLicense(org: string, actor: string, workspace: string, assigned: boolean) {
    return this.run(`org:${org}`, async (store) => {
      await this.member(store, org, actor, ["owner", "admin", "billing"]);
      if ((await store.organizationIdForWorkspace(workspace)) !== org)
        throw new PlatformError("NOT_FOUND", "Workspace does not belong to organization");
      const previous = await store.get<P.LicenseAssignment>("license", workspace);
      if (!assigned) {
        if (await store.hasActiveSubscriptionRoom(workspace))
          throw new PlatformError(
            "WORKSPACE_BUSY",
            "Subscription licenses can only be removed when their workspace has no active covered rooms",
          );
        const subscription = await store.get<P.PlatformSubscription>("subscription", org);
        if (subscription)
          await store.put("subscription", org, org, { ...subscription, authoritative: true });
        await store.remove("license", workspace);
        return null;
      }
      if (previous) return previous;
      const subscription =
        (await store.get<P.PlatformSubscription>("subscription", org)) ?? emptySubscription(org);
      const assignments = await store.list<P.LicenseAssignment>("license", org);
      if (!activeSubscription(subscription) || assignments.length >= subscription.licenseQuantity)
        throw new PlatformError("LICENSE_LIMIT", "No subscription license is available");
      const assignment: P.LicenseAssignment = {
        organizationId: org,
        workspaceId: workspace,
        assignedBy: actor,
        assignedAt: new Date(),
      };
      await store.put("subscription", org, org, { ...subscription, authoritative: true });
      await store.put("license", workspace, org, assignment);
      return assignment;
    });
  }
  async workspaceHasLicense(workspace: string, now = new Date()) {
    return this.hasLicense(this.store, workspace, now);
  }
  async effectiveWorkspacePlan(
    workspace: string,
    now = new Date(),
  ): Promise<"free" | "pro" | "team" | null> {
    const org = await this.store.organizationIdForWorkspace(workspace);
    if (!org) return null;
    const subscription = await this.store.get<P.PlatformSubscription>("subscription", org);
    if (!subscription?.authoritative) return null;
    if (!(await this.hasLicense(this.store, workspace, now))) return "free";
    const offer = subscription.offerId ? await this.getOffer(subscription.offerId) : null;
    return offer?.entitlements.plan === "team" || (!offer && subscription.legacyPlan === "team")
      ? "team"
      : "pro";
  }
  async getWorkspaceAdmissionRestriction(workspace: string) {
    return this.store.get<P.WorkspaceAdmissionRestriction>("admission", workspace);
  }
  async setWorkspaceAdmissionRestriction(workspace: string, blocked: boolean) {
    const org = await this.store.organizationIdForWorkspace(workspace);
    if (!org) throw new PlatformError("NOT_FOUND", "Workspace not found");
    return this.run("read", async (store) => {
      await store.lockWorkspace(workspace);
      const restriction = { workspaceId: workspace, blocked, updatedAt: new Date() };
      await store.put("admission", workspace, org, restriction);
      return restriction;
    });
  }
  private async hasLicense(store: PlatformStore, workspace: string, now: Date) {
    const org = await store.organizationIdForWorkspace(workspace);
    if (!org) return false;
    const organization = await store.get<P.OrganizationRecord>("organization", org);
    const subscription = await store.get<P.PlatformSubscription>("subscription", org);
    const assignment = await store.get<P.LicenseAssignment>("license", workspace);
    const hold = await store.get<P.OrganizationCommercialHold>("commercial_hold", org);
    if (hold?.held) return false;
    if (
      !organization ||
      organization.status !== "active" ||
      !subscription ||
      !assignment ||
      !activeSubscription(subscription, now)
    )
      return false;
    const assignments = (await store.list<P.LicenseAssignment>("license", org)).sort(
      (a, b) =>
        a.assignedAt.getTime() - b.assignedAt.getTime() ||
        a.workspaceId.localeCompare(b.workspaceId),
    );
    return assignments
      .slice(0, subscription.licenseQuantity)
      .some((entry) => entry.workspaceId === workspace);
  }
  async listOffers(includeDraft = false) {
    return (await this.store.list<P.PlatformOffer>("offer")).filter(
      (o) => includeDraft || o.status === "published",
    );
  }
  async getOffer(id: string) {
    return this.store.get<P.PlatformOffer>("offer", id);
  }
  async saveOffer(offer: P.PlatformOffer) {
    return this.run("catalog", async (store) => {
      if (
        !offer.id ||
        offer.productKey !== "pollingpops" ||
        !Number.isInteger(offer.version) ||
        offer.version < 1
      )
        throw new PlatformError("VALIDATION_ERROR", "Invalid offer");
      if (offer.kind === "credit_pack") integer(offer.creditQuantity);
      if (
        offer.status === "published" &&
        (!offer.stripePriceId || !offer.currency || offer.amountMinor === null)
      )
        throw new PlatformError(
          "UNPUBLISHED_PRICE",
          "A published offer requires provider price, currency, and amount",
        );
      const previous = await store.get<P.PlatformOffer>("offer", offer.id);
      if (previous && offer.version < previous.version)
        throw new PlatformError("CONFLICT", "Offer version cannot decrease");
      await store.put("offer", offer.id, null, offer);
      return offer;
    });
  }
  async createPurchase(input: {
    organizationId: string;
    actorId: string;
    offerId: string;
    quantity: number;
    idempotencyKey: string;
  }) {
    return this.run(`org:${input.organizationId}`, async (store) => {
      await this.member(store, input.organizationId, input.actorId, ["owner", "admin", "billing"]);
      if ((await this.organization(store, input.organizationId)).status !== "active")
        throw new PlatformError("ORGANIZATION_SUSPENDED", "Organization is not active");
      integer(input.quantity, 10000);
      const key = hash(`${input.organizationId}:${input.idempotencyKey}`);
      const prior = await store.get<P.PlatformPurchase>("purchase", key);
      if (prior) {
        if (prior.offer.id !== input.offerId || prior.quantity !== input.quantity)
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Purchase key was already used with a different offer or quantity",
          );
        return prior;
      }
      const offer = await store.get<P.PlatformOffer>("offer", input.offerId);
      if (!offer || offer.status !== "published" || !offer.stripePriceId)
        throw new PlatformError("UNPUBLISHED_PRICE", "Offer is not available for purchase");
      if (offer.kind === "credit_pack") integer(offer.creditQuantity * input.quantity);
      if (offer.amountMinor === null || !Number.isSafeInteger(offer.amountMinor * input.quantity))
        throw new PlatformError("VALIDATION_ERROR", "Purchase total exceeds supported amount");
      const now = new Date();
      const purchase: P.PlatformPurchase = {
        id: key,
        organizationId: input.organizationId,
        offer,
        quantity: input.quantity,
        checkoutId: null,
        paymentId: null,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      await store.put("purchase", key, input.organizationId, purchase);
      return purchase;
    });
  }
  async getPurchase(id: string) {
    return this.store.get<P.PlatformPurchase>("purchase", id);
  }
  async findPurchaseByPaymentId(payment: string) {
    return (
      (await this.store.list<P.PlatformPurchase>("purchase")).find(
        (purchase) => purchase.paymentId === payment,
      ) ?? null
    );
  }
  async listPendingPurchases(limit = 100) {
    return (await this.store.list<P.PlatformPurchase>("purchase"))
      .filter((purchase) => purchase.status === "pending")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }
  async updatePurchaseCheckout(id: string, checkout: string) {
    const prior = await this.getPurchase(id);
    if (!prior) throw new PlatformError("NOT_FOUND", "Purchase not found");
    return this.run(`org:${prior.organizationId}`, async (store) => {
      const purchase = await store.get<P.PlatformPurchase>("purchase", id);
      if (!purchase) throw new PlatformError("NOT_FOUND", "Purchase not found");
      if (purchase.checkoutId && purchase.checkoutId !== checkout)
        throw new PlatformError("CONFLICT", "Purchase already belongs to a different Checkout");
      const duplicate = (await store.list<P.PlatformPurchase>("purchase")).find(
        (p) => p.checkoutId === checkout && p.id !== id,
      );
      if (duplicate)
        throw new PlatformError("CONFLICT", "Checkout already belongs to another purchase");
      const next = { ...purchase, checkoutId: checkout, updatedAt: new Date() };
      await store.put("purchase", id, purchase.organizationId, next);
      return next;
    });
  }
  async listPurchases(org: string, user: string) {
    await this.member(this.store, org, user, ["owner", "admin", "billing"]);
    return this.store.list<P.PlatformPurchase>("purchase", org);
  }
  async fulfillCreditPurchase(id: string, paymentId: string, now = new Date()) {
    const prior = await this.getPurchase(id);
    if (!prior) throw new PlatformError("NOT_FOUND", "Purchase not found");
    return this.run(`org:${prior.organizationId}`, async (store) => {
      const purchase = (await store.get<P.PlatformPurchase>("purchase", id))!;
      if (purchase.status === "paid") {
        if (purchase.paymentId !== paymentId)
          throw new PlatformError("CONFLICT", "Purchase already fulfilled by a different payment");
        return purchase;
      }
      if (purchase.status !== "pending" || purchase.offer.kind !== "credit_pack")
        throw new PlatformError("CONFLICT", "Purchase cannot grant credits");
      await this.grant(
        store,
        {
          organizationId: purchase.organizationId,
          quantity: purchase.offer.creditQuantity * purchase.quantity,
          reason: "credit_pack_purchase",
          sourceKey: `purchase:${purchase.id}`,
          actorId: null,
        },
        now,
      );
      const next: P.PlatformPurchase = { ...purchase, status: "paid", paymentId, updatedAt: now };
      await store.put("purchase", id, purchase.organizationId, next);
      return next;
    });
  }
  async markSubscriptionPurchasePaid(id: string, subscriptionId: string, now = new Date()) {
    const previous = await this.getPurchase(id);
    if (!previous) throw new PlatformError("NOT_FOUND", "Purchase not found");
    return this.run(`org:${previous.organizationId}`, async (store) => {
      const purchase = (await store.get<P.PlatformPurchase>("purchase", id))!;
      if (
        purchase.offer.kind !== "workspace_subscription" ||
        purchase.status === "refunded" ||
        purchase.status === "canceled"
      )
        throw new PlatformError("CONFLICT", "Purchase cannot receive subscription fulfillment");
      if (purchase.status === "paid" && purchase.paymentId !== subscriptionId)
        throw new PlatformError("CONFLICT", "Purchase already belongs to a different subscription");
      const updated: P.PlatformPurchase = {
        ...purchase,
        status: "paid",
        paymentId: subscriptionId,
        updatedAt: now,
      };
      await store.put("purchase", id, purchase.organizationId, updated);
      return updated;
    });
  }
  async cancelPurchase(id: string) {
    const previous = await this.getPurchase(id);
    if (!previous) throw new PlatformError("NOT_FOUND", "Purchase not found");
    return this.run(`org:${previous.organizationId}`, async (store) => {
      const purchase = (await store.get<P.PlatformPurchase>("purchase", id))!;
      if (purchase.status !== "pending" && purchase.status !== "canceled")
        throw new PlatformError("CONFLICT", "Only an unpaid purchase may be canceled");
      const updated: P.PlatformPurchase = {
        ...purchase,
        status: "canceled",
        updatedAt: new Date(),
      };
      await store.put("purchase", id, purchase.organizationId, updated);
      return updated;
    });
  }
  async markPurchaseRefunded(id: string, paymentId?: string) {
    const previous = await this.getPurchase(id);
    if (!previous) throw new PlatformError("NOT_FOUND", "Purchase not found");
    return this.run(`org:${previous.organizationId}`, async (store) => {
      const purchase = (await store.get<P.PlatformPurchase>("purchase", id))!;
      if (!["pending", "paid", "refunded"].includes(purchase.status))
        throw new PlatformError(
          "CONFLICT",
          "Canceled purchases cannot receive a refund projection",
        );
      if (
        paymentId &&
        purchase.paymentId &&
        purchase.paymentId !== paymentId &&
        purchase.offer.kind === "credit_pack"
      )
        throw new PlatformError("CONFLICT", "Refund payment does not match the saved purchase");
      const updated: P.PlatformPurchase = {
        ...purchase,
        status: "refunded",
        paymentId: purchase.paymentId ?? paymentId ?? null,
        updatedAt: new Date(),
      };
      await store.put("purchase", id, purchase.organizationId, updated);
      return updated;
    });
  }
  async getCreditBalance(org: string) {
    const account = await this.store.get<{ balance: number; reserved: number }>("account", org);
    return {
      organizationId: org,
      balance: account?.balance ?? 0,
      reserved: account?.reserved ?? 0,
      available: (account?.balance ?? 0) - (account?.reserved ?? 0),
    };
  }
  async listCreditLedger(org: string, user: string) {
    await this.member(this.store, org, user, ["owner", "admin", "billing"]);
    return this.listCreditLedgerForOperator(org);
  }
  async listCreditLedgerForOperator(org: string, limit = 1000) {
    return (await this.store.list<P.CreditLedgerEntry>("ledger", org))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  private boundedPeriod(from: Date, to: Date) {
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from >= to ||
      to.getTime() - from.getTime() > 366 * 86400000
    )
      throw new PlatformError(
        "VALIDATION_ERROR",
        "Export period must be positive and at most 366 days",
      );
  }
  async listCreditLedgerPageForOperator(
    org: string,
    options: { from: Date; to: Date; cursor?: string; limit?: number },
  ) {
    this.boundedPeriod(options.from, options.to);
    const limit = options.limit ?? 1000;
    integer(limit, 1000);
    const scope = hash(`${org}:${options.from.toISOString()}:${options.to.toISOString()}`);
    type LedgerCursor = { time: number; id: string; scope: string };
    let cursor: LedgerCursor | null = null;
    if (options.cursor) {
      try {
        cursor = JSON.parse(
          Buffer.from(options.cursor, "base64url").toString("utf8"),
        ) as LedgerCursor;
      } catch {
        throw new PlatformError("VALIDATION_ERROR", "Invalid ledger cursor");
      }
      if (
        !cursor ||
        cursor.scope !== scope ||
        !Number.isFinite(cursor.time) ||
        typeof cursor.id !== "string"
      )
        throw new PlatformError(
          "VALIDATION_ERROR",
          "Ledger cursor does not match its export period",
        );
    }
    const rows = (await this.store.list<P.CreditLedgerEntry>("ledger", org))
      .filter((entry) => entry.createdAt >= options.from && entry.createdAt < options.to)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .filter(
        (entry) =>
          !cursor ||
          entry.createdAt.getTime() > cursor.time ||
          (entry.createdAt.getTime() === cursor.time && entry.id > cursor.id),
      );
    const entries = rows.slice(0, limit);
    const last = entries.at(-1);
    return {
      entries,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ time: last.createdAt.getTime(), id: last.id, scope }),
            ).toString("base64url")
          : null,
    };
  }
  async recordStripeTransaction(input: P.PlatformStripeTransaction) {
    return this.run(`org:${input.organizationId}`, async (store) => {
      if (
        !input.id ||
        !input.sourceEventId ||
        !["sale", "refund"].includes(input.kind) ||
        !/^[A-Z]{3}$/.test(input.currency) ||
        !Number.isSafeInteger(input.amountMinor) ||
        input.amountMinor < 0 ||
        !Number.isFinite(input.occurredAt.getTime())
      )
        throw new PlatformError("VALIDATION_ERROR", "Financial transaction is invalid");
      await this.organization(store, input.organizationId);
      const previous = await store.get<P.PlatformStripeTransaction>("stripe_transaction", input.id);
      if (previous) {
        const stableTerms = (transaction: P.PlatformStripeTransaction) => ({
          ...transaction,
          sourceEventId: null,
        });
        if (stablePlatformJson(stableTerms(previous)) !== stablePlatformJson(stableTerms(input)))
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Financial reference already has different terms",
          );
        return previous;
      }
      await store.put("stripe_transaction", input.id, input.organizationId, input);
      return input;
    });
  }
  async listStripeTransactionsForOperator(org: string, from: Date, to: Date) {
    this.boundedPeriod(from, to);
    return (await this.store.list<P.PlatformStripeTransaction>("stripe_transaction", org))
      .filter((entry) => entry.occurredAt >= from && entry.occurredAt < to)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  }
  async getBusinessHealth(now = new Date()): Promise<P.BusinessHealth> {
    const [billing, jobs, coverage, heartbeats] = await Promise.all([
      this.store.list<P.PlatformBillingEvent>("billing_event"),
      this.store.list<P.PlatformIntegrationJob>("integration_job"),
      this.store.list<P.PlatformRoomCoverage>("coverage"),
      this.store.list<P.PlatformWorkerHeartbeat>("heartbeat"),
    ]);
    const age = (dates: Date[]) =>
      dates.length
        ? Math.max(
            0,
            (now.getTime() -
              dates.reduce((oldest, date) => Math.min(oldest, date.getTime()), Infinity)) /
              1000,
          )
        : 0;
    const knownAdapters = ["jira-service-management", "hubspot", "quickbooks"];
    const integrations = [...knownAdapters, "other"].map((integration) => {
      const rows = jobs.filter((job) =>
        integration === "other"
          ? !knownAdapters.includes(job.integration)
          : job.integration === integration,
      );
      return {
        integration,
        pending: rows.filter((job) => job.state === "pending").length,
        processing: rows.filter((job) => job.state === "processing").length,
        failed: rows.filter((job) => job.state === "failed").length,
        ambiguous: rows.filter((job) => job.state === "ambiguous").length,
        oldestPendingAgeSeconds: age(
          rows
            .filter((job) => ["pending", "processing"].includes(job.state))
            .map((job) => job.createdAt),
        ),
      };
    });
    const knownHeartbeats = [
      "jobs",
      "platform-billing",
      "platform-billing-reconciliation",
      "business-integrations",
    ];
    return {
      billing: {
        pending: billing.filter((event) => event.state === "pending").length,
        processing: billing.filter((event) => event.state === "processing").length,
        failed: billing.filter((event) => event.state === "failed").length,
        oldestPendingAgeSeconds: age(
          billing
            .filter((event) => ["pending", "processing"].includes(event.state))
            .map((event) => event.createdAt),
        ),
      },
      integrations,
      reservations: {
        active: coverage.filter(
          (item) => item.reservationState === "reserved" && item.expiresAt > now,
        ).length,
        expired: coverage.filter(
          (item) => item.reservationState === "reserved" && item.expiresAt <= now,
        ).length,
      },
      heartbeats: knownHeartbeats.map((id) => {
        const row = heartbeats.find((item) => item.id === id);
        return {
          id,
          status: row?.status ?? "degraded",
          ageSeconds: row ? age([row.updatedAt]) : -1,
        };
      }),
    };
  }
  async listActiveRooms(org?: string, limit = 100) {
    integer(limit, 1000);
    return this.store.listActiveRooms(org, limit);
  }
  async getProductQueueHealth(now = new Date()) {
    return this.store.getProductQueueHealth(now);
  }
  async retryFailedProductJob(kind: P.ProductQueueKind, id: string, now = new Date()) {
    if (!["round-report", "presentation-report", "authoring"].includes(kind))
      throw new PlatformError("VALIDATION_ERROR", "Unknown product queue");
    return this.run("operator", (store) => store.retryFailedProductJob(kind, id, now));
  }
  async retryBillingEvent(id: string, now = new Date()) {
    return this.run("billing-queue", async (store) => {
      const event = await store.get<P.PlatformBillingEvent>("billing_event", id);
      if (!event || event.state !== "failed") return false;
      await store.put("billing_event", id, null, {
        ...event,
        state: "pending",
        availableAt: now,
        leaseUntil: null,
        leaseToken: null,
        lastError: null,
      });
      return true;
    });
  }
  private async grant(
    store: PlatformStore,
    input: {
      organizationId: string;
      quantity: number;
      reason: string;
      sourceKey: string;
      actorId: string | null;
    },
    now = new Date(),
  ) {
    integer(input.quantity);
    if (!input.reason.trim() || !input.sourceKey)
      throw new PlatformError("VALIDATION_ERROR", "Credit grant requires reason and source key");
    await this.organization(store, input.organizationId);
    const key = hash(`${input.organizationId}:${input.sourceKey}`);
    const prior = await store.get<P.CreditLedgerEntry>("ledger", key);
    if (prior) {
      if (prior.delta !== input.quantity || prior.reason !== input.reason)
        throw new PlatformError(
          "IDEMPOTENCY_CONFLICT",
          "Credit grant key conflicts with an earlier grant",
        );
      return prior;
    }
    const account = (await store.get<{ balance: number; reserved: number }>(
      "account",
      input.organizationId,
    )) ?? { balance: 0, reserved: 0 };
    if (!Number.isSafeInteger(account.balance + input.quantity))
      throw new PlatformError("VALIDATION_ERROR", "Credit balance overflow");
    const entry: P.CreditLedgerEntry = {
      id: key,
      organizationId: input.organizationId,
      delta: input.quantity,
      reason: input.reason,
      sourceKey: input.sourceKey,
      actorId: input.actorId,
      roomId: null,
      artifactType: null,
      createdAt: now,
    };
    await store.put("ledger", key, input.organizationId, entry);
    await store.put("account", input.organizationId, input.organizationId, {
      ...account,
      balance: account.balance + input.quantity,
    });
    return entry;
  }
  async grantCredits(input: {
    organizationId: string;
    quantity: number;
    reason: string;
    sourceKey: string;
    actorId: string | null;
  }) {
    return this.run(`org:${input.organizationId}`, (store) => this.grant(store, input));
  }
  async adjustCredits(input: {
    organizationId: string;
    quantity: number;
    reason: string;
    sourceKey: string;
    actorId: string;
  }) {
    if (input.quantity > 0) return this.grantCredits(input);
    integer(-input.quantity);
    return this.run(`org:${input.organizationId}`, async (store) => {
      if (!input.reason.trim() || !input.sourceKey || !input.actorId)
        throw new PlatformError(
          "VALIDATION_ERROR",
          "Credit adjustment requires reason, source, and actor",
        );
      const id = hash(`${input.organizationId}:${input.sourceKey}`);
      const previous = await store.get<P.CreditLedgerEntry>("ledger", id);
      if (previous) {
        if (previous.delta !== input.quantity || previous.reason !== input.reason)
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Credit adjustment conflicts with an earlier entry",
          );
        return previous;
      }
      const account = await store.get<{ balance: number; reserved: number }>(
        "account",
        input.organizationId,
      );
      if (!account || account.balance - account.reserved < -input.quantity)
        throw new PlatformError(
          "INSUFFICIENT_CREDITS",
          "Reserved or used credits cannot be retracted",
        );
      const entry: P.CreditLedgerEntry = {
        id,
        organizationId: input.organizationId,
        delta: input.quantity,
        reason: input.reason,
        sourceKey: input.sourceKey,
        actorId: input.actorId,
        roomId: null,
        artifactType: null,
        createdAt: new Date(),
      };
      await store.put("ledger", id, input.organizationId, entry);
      await store.put("account", input.organizationId, input.organizationId, {
        ...account,
        balance: account.balance + input.quantity,
      });
      return entry;
    });
  }
  async reverseCreditConsumption(input: {
    artifactType: P.PlatformRoomType;
    roomId: string;
    actorId: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const coverage = await this.getRoomCoverage(input.artifactType, input.roomId);
    if (!coverage || coverage.reservationState !== "consumed")
      throw new PlatformError(
        "CONFLICT",
        "Only a consumed credit can receive a compensating credit",
      );
    return this.run(`org:${coverage.organizationId}`, (store) =>
      this.grant(store, {
        organizationId: coverage.organizationId,
        quantity: 1,
        reason: input.reason,
        sourceKey: `compensation:${input.artifactType}:${input.roomId}`,
        actorId: input.actorId,
      }),
    );
  }
  async getRoomCoverage(type: P.PlatformRoomType, room: string) {
    return this.store.get<P.PlatformRoomCoverage>("coverage", platformRoomKey(type, room));
  }
  async getRoomCoverageByCreationKey(workspaceId: string, creationKey: string) {
    return (
      (await this.store.list<P.PlatformRoomCoverage>("coverage")).find(
        (coverage) => coverage.workspaceId === workspaceId && coverage.creationKey === creationKey,
      ) ?? null
    );
  }
  async reserveRoomCoverage(input: P.PlatformRoomCoverageInput) {
    const org = await this.store.organizationIdForWorkspace(input.workspaceId);
    if (!org) throw new PlatformError("NOT_FOUND", "Workspace not found");
    return this.run(`org:${org}`, async (store) => {
      const key = platformRoomKey(input.artifactType, input.roomId);
      const prior = await store.get<P.PlatformRoomCoverage>("coverage", key);
      if (prior) {
        if (
          prior.workspaceId !== input.workspaceId ||
          stablePlatformJson(prior.snapshot) !== stablePlatformJson(input.snapshot) ||
          (input.funding !== "auto" && prior.funding !== input.funding) ||
          (input.creationKey && prior.creationKey !== input.creationKey) ||
          prior.creationRequestHash !== input.creationRequestHash
        )
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Room coverage was already frozen with different terms",
          );
        return prior;
      }
      const organization = await this.organization(store, org);
      const workspace = await store.get<P.OrganizationWorkspaceRecord>(
        "workspace",
        input.workspaceId,
      );
      if (organization.status !== "active" || workspace?.status !== "active")
        throw new PlatformError("ORGANIZATION_SUSPENDED", "Organization or workspace is suspended");
      const now = new Date();
      if (input.expiresAt <= now)
        throw new PlatformError("VALIDATION_ERROR", "Room coverage must expire in the future");
      const licensed = await this.hasLicense(store, input.workspaceId, now);
      const funding =
        input.funding === "auto" ? (licensed ? "subscription" : "credit") : input.funding;
      const hold = await store.get<P.OrganizationCommercialHold>("commercial_hold", org);
      if (hold?.held && (funding === "subscription" || funding === "credit"))
        throw new PlatformError("COMMERCIAL_HOLD", "Premium room creation is on commercial hold");
      if (funding === "subscription" && !licensed)
        throw new PlatformError("LICENSE_LIMIT", "Workspace has no active subscription license");
      if (input.creationKey) {
        const previous = (await store.list<P.PlatformRoomCoverage>("coverage", org)).find(
          (c) => c.workspaceId === input.workspaceId && c.creationKey === input.creationKey,
        );
        if (previous)
          throw new PlatformError(
            "CREATION_ALREADY_EXISTS",
            "Creation key already belongs to another room",
          );
      }
      const coverage: P.PlatformRoomCoverage = {
        ...input,
        organizationId: org,
        funding,
        reservationState: funding === "credit" ? "reserved" : "none",
        createdAt: now,
        consumedAt: null,
        releasedAt: null,
      };
      if (funding === "credit") {
        const account = (await store.get<{ balance: number; reserved: number }>(
          "account",
          org,
        )) ?? { balance: 0, reserved: 0 };
        if (account.balance - account.reserved < 1)
          throw new PlatformError("INSUFFICIENT_CREDITS", "No event credit is available");
        await store.put("account", org, org, { ...account, reserved: account.reserved + 1 });
      }
      await store.put("coverage", key, org, coverage);
      return coverage;
    });
  }
  private async transitionCoverage(type: P.PlatformRoomType, room: string, consume: boolean) {
    const prior = await this.getRoomCoverage(type, room);
    if (!prior) return null;
    return this.run(`org:${prior.organizationId}`, async (store) => {
      const key = platformRoomKey(type, room);
      const coverage = (await store.get<P.PlatformRoomCoverage>("coverage", key))!;
      if (coverage.reservationState === "released" && consume)
        throw new PlatformError("ROOM_CLOSED", "Room credit reservation has been released");
      if (coverage.reservationState !== "reserved") return coverage;
      const account = await store.get<{ balance: number; reserved: number }>(
        "account",
        coverage.organizationId,
      );
      if (!account || account.reserved < 1 || account.balance < 1)
        throw new PlatformError(
          "LEDGER_INVARIANT",
          "Credit reservation does not match its balance",
        );
      const now = new Date();
      if (consume && coverage.expiresAt <= now)
        throw new PlatformError("ROOM_CLOSED", "Room credit reservation has expired");
      const updated: P.PlatformRoomCoverage = {
        ...coverage,
        reservationState: consume ? "consumed" : "released",
        consumedAt: consume ? now : null,
        releasedAt: consume ? null : now,
      };
      await store.put("account", coverage.organizationId, coverage.organizationId, {
        balance: account.balance - (consume ? 1 : 0),
        reserved: account.reserved - 1,
      });
      if (consume) {
        const sourceKey = `consume:${key}`;
        const id = hash(`${coverage.organizationId}:${sourceKey}`);
        const entry: P.CreditLedgerEntry = {
          id,
          organizationId: coverage.organizationId,
          delta: -1,
          reason: "first_audience_join",
          sourceKey,
          actorId: coverage.actorId,
          roomId: room,
          artifactType: type,
          createdAt: now,
        };
        await store.put("ledger", id, coverage.organizationId, entry);
      }
      await store.put("coverage", key, coverage.organizationId, updated);
      return updated;
    });
  }
  async consumeRoomCoverage(type: P.PlatformRoomType, room: string) {
    return this.transitionCoverage(type, room, true);
  }
  async releaseRoomCoverage(type: P.PlatformRoomType, room: string) {
    return this.transitionCoverage(type, room, false);
  }
  async releaseExpiredRoomReservation(type: P.PlatformRoomType, room: string) {
    return this.store.withRoomLifecycleLock(type, room, async (store, state) => {
      const scoped = new PlatformService(store);
      const coverage = await scoped.getRoomCoverage(type, room);
      if (!coverage || coverage.reservationState !== "reserved") return coverage;
      // Missing parent evidence is an anomaly, not proof of an empty cancellation.
      // Monitoring retains the expired reservation for an operator to investigate.
      if (!state || !state.closed || state.hasAudience) return coverage;
      return scoped.releaseRoomCoverage(type, room);
    });
  }
  async listReservedRoomCoverages(now?: Date) {
    return (await this.store.list<P.PlatformRoomCoverage>("coverage")).filter(
      (c) => c.reservationState === "reserved" && (!now || c.expiresAt <= now),
    );
  }
  async savePromotion(promotion: P.PlatformPromotion) {
    return this.run("promotions", async (store) => {
      integer(promotion.maximumRedemptions);
      if (promotion.kind === "credits") integer(promotion.creditQuantity);
      if (promotion.kind === "discount" && !promotion.stripePromotionCodeId)
        throw new PlatformError(
          "VALIDATION_ERROR",
          "Discount promotion requires a provider promotion code",
        );
      const duplicate = (await store.list<P.PlatformPromotion>("promotion")).find(
        (p) => p.codeHash === promotion.codeHash && p.id !== promotion.id,
      );
      if (duplicate) throw new PlatformError("CONFLICT", "Promotion code is already assigned");
      await store.put("promotion", promotion.id, null, promotion);
      return promotion;
    });
  }
  async listPromotions() {
    return this.store.list<P.PlatformPromotion>("promotion");
  }
  async redeemPromotion(input: {
    organizationId: string;
    actorId: string;
    codeHash: string;
    idempotencyKey: string;
    now?: Date;
  }) {
    return this.run("promotions", async (store) => {
      await this.member(store, input.organizationId, input.actorId, ["owner", "admin", "billing"]);
      const promotion = (await store.list<P.PlatformPromotion>("promotion")).find(
        (p) => p.codeHash === input.codeHash,
      );
      if (!promotion) throw new PlatformError("INVALID_PROMOTION", "Promotion code is unavailable");
      const id = hash(`${input.organizationId}:${promotion.id}`);
      const prior = await store.get<P.PlatformRedemption>("redemption", id);
      if (prior) return prior;
      const now = input.now ?? new Date();
      const redemptions = (await store.list<P.PlatformRedemption>("redemption")).filter(
        (r) => r.promotionId === promotion.id,
      );
      if (
        !promotion.active ||
        (promotion.expiresAt && promotion.expiresAt <= now) ||
        (promotion.organizationId && promotion.organizationId !== input.organizationId) ||
        redemptions.length >= promotion.maximumRedemptions
      )
        throw new PlatformError("INVALID_PROMOTION", "Promotion code is unavailable");
      const redemption: P.PlatformRedemption = {
        id,
        organizationId: input.organizationId,
        promotionId: promotion.id,
        actorId: input.actorId,
        stripePromotionCodeId: promotion.stripePromotionCodeId,
        creditQuantity: promotion.kind === "credits" ? promotion.creditQuantity : 0,
        createdAt: now,
      };
      if (redemption.creditQuantity)
        await this.grant(
          store,
          {
            organizationId: input.organizationId,
            quantity: redemption.creditQuantity,
            reason: "promotion",
            sourceKey: `promotion:${promotion.id}`,
            actorId: input.actorId,
          },
          now,
        );
      await store.put("redemption", id, input.organizationId, redemption);
      return redemption;
    });
  }
  async enqueueBillingEvent(input: {
    providerEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    providerCreatedAt: Date;
  }) {
    return this.run("billing-queue", async (store) => {
      if (await store.get("billing_event", input.providerEventId)) return false;
      const now = new Date();
      const event: P.PlatformBillingEvent = {
        id: input.providerEventId,
        eventType: input.eventType,
        payload: input.payload,
        providerCreatedAt: input.providerCreatedAt,
        state: "pending",
        attempts: 0,
        availableAt: now,
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
        createdAt: now,
        completedAt: null,
      };
      await store.put("billing_event", event.id, null, event);
      return true;
    });
  }
  private async claimQueue<T extends P.PlatformBillingEvent | P.PlatformIntegrationJob>(
    kind: "billing_event" | "integration_job",
    integration: string | null,
    leaseMs: number,
    now: Date,
  ): Promise<T | null> {
    if (!Number.isFinite(leaseMs) || leaseMs < 1000 || leaseMs > 600000)
      throw new PlatformError("VALIDATION_ERROR", "Invalid job lease duration");
    return this.run(
      kind === "billing_event" ? "billing-queue" : `integration:${integration}`,
      async (store) => {
        const jobs = (await store.list<T>(kind))
          .filter(
            (job) => !integration || (job as P.PlatformIntegrationJob).integration === integration,
          )
          .sort(
            (a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.id.localeCompare(b.id),
          );
        for (const job of jobs) {
          const readOnlyIntegration =
            kind === "integration_job" &&
            (((job as P.PlatformIntegrationJob).integration === "jira-service-management" &&
              ["support.status", "support.reconcile"].includes(
                (job as P.PlatformIntegrationJob).eventType,
              )) ||
              ((job as P.PlatformIntegrationJob).integration === "quickbooks" &&
                (job as P.PlatformIntegrationJob).eventType === "accounting.reconcile"));
          if (
            job.state === "processing" &&
            job.leaseUntil &&
            job.leaseUntil <= now &&
            kind === "integration_job" &&
            !readOnlyIntegration
          ) {
            // External side effects may have succeeded before the worker died. Reconcile rather
            // than sending a second ticket/accounting transaction without a known outcome.
            const ambiguous = {
              ...job,
              state: "ambiguous",
              leaseToken: null,
              leaseUntil: null,
              lastError: "Worker lease expired; reconcile the external result before retry",
            };
            await store.put(
              kind,
              job.id,
              (job as P.PlatformIntegrationJob).organizationId ?? null,
              ambiguous,
            );
            continue;
          }
          if (!(
            (job.state === "pending" && job.availableAt <= now) ||
            ((kind === "billing_event" || readOnlyIntegration) &&
              job.state === "processing" &&
              job.leaseUntil &&
              job.leaseUntil <= now)
          ))
            continue;
          const claimed = {
            ...job,
            state: "processing" as const,
            attempts: job.attempts + 1,
            leaseToken: randomUUID(),
            leaseUntil: new Date(now.getTime() + leaseMs),
          };
          await store.put(
            kind,
            job.id,
            (job as P.PlatformIntegrationJob).organizationId ?? null,
            claimed,
          );
          return claimed;
        }
        return null;
      },
    );
  }
  async claimBillingEvent(leaseMs = 60000, now = new Date()) {
    return this.claimQueue<P.PlatformBillingEvent>("billing_event", null, leaseMs, now);
  }
  private async settleQueue(
    kind: "billing_event" | "integration_job",
    id: string,
    token: string,
    error: string | null,
    externalId: string | null,
    ambiguous: boolean,
    now: Date,
  ) {
    const prior = await this.store.get<P.PlatformBillingEvent | P.PlatformIntegrationJob>(kind, id);
    if (!prior) return false;
    return this.run(
      kind === "billing_event"
        ? "billing-queue"
        : `integration:${(prior as P.PlatformIntegrationJob).integration}`,
      async (store) => {
        const job = await store.get<P.PlatformBillingEvent | P.PlatformIntegrationJob>(kind, id);
        if (
          !job ||
          job.state !== "processing" ||
          job.leaseToken !== token ||
          !job.leaseUntil ||
          job.leaseUntil <= now
        )
          return false;
        const next = {
          ...job,
          state: error
            ? ambiguous
              ? "ambiguous"
              : job.attempts >= 10
                ? "failed"
                : "pending"
            : "complete",
          leaseToken: null,
          leaseUntil: null,
          completedAt: error ? null : now,
          availableAt: error
            ? new Date(now.getTime() + Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12)))
            : job.availableAt,
          lastError: error?.slice(0, 500) ?? null,
          ...(kind === "integration_job" ? { externalId } : {}),
        };
        await store.put(kind, id, (job as P.PlatformIntegrationJob).organizationId ?? null, next);
        return true;
      },
    );
  }
  async completeBillingEvent(id: string, token: string, now = new Date()) {
    return this.settleQueue("billing_event", id, token, null, null, false, now);
  }
  async failBillingEvent(id: string, token: string, error: string, now = new Date()) {
    return this.settleQueue("billing_event", id, token, error, null, false, now);
  }
  async listBillingEvents(limit = 100) {
    return (await this.store.list<P.PlatformBillingEvent>("billing_event"))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async provisionOperator(
    input: Omit<P.PlatformOperator, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ) {
    return this.run("operator", async (store) => {
      const operators = await store.list<P.PlatformOperator>("operator");
      const previous = operators.find(
        (o) => o.issuer === input.issuer && o.subject === input.subject,
      );
      if (
        previous?.active &&
        previous.role === "founder" &&
        (!input.active || input.role !== "founder") &&
        !(await hasUsableFounderReplacement(previous, operators, (username) =>
          store.get<P.PlatformOperatorPasswordCredential>("operator_credential", username),
        ))
      )
        throw new PlatformError(
          "LAST_FOUNDER",
          "An active founder must remain for this authentication issuer",
        );
      const now = new Date();
      const operator: P.PlatformOperator = {
        ...input,
        id: previous?.id ?? input.id ?? randomUUID(),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      if (!input.issuer || !input.subject || !input.name)
        throw new PlatformError("VALIDATION_ERROR", "Operator identity is incomplete");
      await store.put("operator", operator.id, null, operator);
      if (
        previous &&
        (!operator.active ||
          previous.role !== operator.role ||
          JSON.stringify(previous.capabilities) !== JSON.stringify(operator.capabilities))
      ) {
        for (const session of await store.list<P.PlatformOperatorSession>("operator_session")) {
          if (session.operatorId === operator.id && !session.revokedAt)
            await store.put("operator_session", session.tokenHash, null, {
              ...session,
              revokedAt: now,
            });
        }
      }
      return operator;
    });
  }
  async getOperatorPasswordCredential(username: string) {
    return this.store.get<P.PlatformOperatorPasswordCredential>("operator_credential", username);
  }
  async saveOperatorPasswordCredential(
    input: Omit<P.PlatformOperatorPasswordCredential, "revision">,
    expectedRevision: number | null,
  ) {
    return this.run("operator", async (store) => {
      const prior = await store.get<P.PlatformOperatorPasswordCredential>(
        "operator_credential",
        input.username,
      );
      if ((prior?.revision ?? null) !== expectedRevision)
        throw new PlatformError("CONFLICT", "Operator credentials changed; retry the operation");
      const operator = await store.get<P.PlatformOperator>("operator", input.operatorId);
      if (
        !operator ||
        operator.issuer !== PASSWORD_OPERATOR_ISSUER ||
        operator.subject !== input.username ||
        !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(input.username) ||
        (prior && prior.operatorId !== input.operatorId)
      )
        throw new PlatformError("VALIDATION_ERROR", "Invalid operator credential identity");
      const credential: P.PlatformOperatorPasswordCredential = {
        ...input,
        revision: (prior?.revision ?? 0) + 1,
      };
      await store.put("operator_credential", input.username, null, credential);
      return credential;
    });
  }
  async consumeOperatorTotp(username: string, revision: number, counter: number, now: Date) {
    return this.run("operator", async (store) => {
      const prior = await store.get<P.PlatformOperatorPasswordCredential>(
        "operator_credential",
        username,
      );
      if (
        !prior ||
        prior.revision !== revision ||
        !Number.isSafeInteger(counter) ||
        counter < 0 ||
        (prior.lastUsedCounter !== null && counter <= prior.lastUsedCounter)
      )
        return false;
      await store.put("operator_credential", username, null, {
        ...prior,
        lastUsedCounter: counter,
        updatedAt: now,
      });
      return true;
    });
  }
  async recordOperatorPasswordAttempt(
    key: string,
    now: Date,
    limit = { maxAttempts: 5, windowMs: 15 * 60_000 },
  ) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !Number.isSafeInteger(limit.maxAttempts) ||
      limit.maxAttempts < 1 ||
      limit.maxAttempts > 1000 ||
      !Number.isSafeInteger(limit.windowMs) ||
      limit.windowMs < 1000 ||
      limit.windowMs > 24 * 60 * 60_000
    )
      throw new PlatformError("VALIDATION_ERROR", "Invalid operator login throttle key");
    return this.run("operator", async (store) => {
      const prior = await store.get<P.PlatformOperatorLoginThrottle>(
        "operator_login_throttle",
        key,
      );
      if (prior?.lockedUntil && prior.lockedUntil > now) return false;
      const duration = limit.windowMs;
      const fresh = !prior || now.getTime() - prior.windowStartedAt.getTime() >= duration;
      const attempts = (fresh ? 0 : prior.attempts) + 1;
      if (attempts > limit.maxAttempts) return false;
      if (!prior) {
        // A fixed upper bound prevents arbitrary usernames growing the private record store.
        const buckets =
          await store.list<P.PlatformOperatorLoginThrottle>("operator_login_throttle");
        if (buckets.length >= 4096) {
          let remaining = buckets.length;
          for (const bucket of buckets) {
            if (
              now.getTime() - bucket.windowStartedAt.getTime() >= 15 * 60_000 &&
              (!bucket.lockedUntil || bucket.lockedUntil <= now)
            ) {
              await store.remove("operator_login_throttle", bucket.key);
              remaining--;
            }
          }
          if (remaining >= 4096) return false;
        }
      }
      await store.put("operator_login_throttle", key, null, {
        key,
        attempts,
        windowStartedAt: fresh ? now : prior.windowStartedAt,
        lockedUntil: attempts >= limit.maxAttempts ? new Date(now.getTime() + duration) : null,
      } satisfies P.PlatformOperatorLoginThrottle);
      return true;
    });
  }
  async getOperatorByIdentity(issuer: string, subject: string) {
    return (
      (await this.store.list<P.PlatformOperator>("operator")).find(
        (o) => o.issuer === issuer && o.subject === subject,
      ) ?? null
    );
  }
  async getOperator(id: string) {
    return this.store.get<P.PlatformOperator>("operator", id);
  }
  async listOperators() {
    return this.store.list<P.PlatformOperator>("operator");
  }
  async createOperatorSession(input: P.PlatformOperatorSession) {
    return this.run("operator", async (store) => {
      const operator = await store.get<P.PlatformOperator>("operator", input.operatorId);
      if (!operator?.active || input.expiresAt <= new Date())
        throw new PlatformError("FORBIDDEN", "Operator session cannot be created");
      if (await store.get("operator_session", input.tokenHash))
        throw new PlatformError("CONFLICT", "Operator session already exists");
      await store.put("operator_session", input.tokenHash, null, {
        ...input,
        authenticatedAt: input.authenticatedAt ?? input.createdAt,
        lastSeenAt: input.lastSeenAt ?? input.createdAt,
      });
    });
  }
  async getOperatorSession(tokenHash: string, now = new Date()) {
    const session = await this.store.get<P.PlatformOperatorSession>("operator_session", tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const operator = await this.getOperator(session.operatorId);
    return operator?.active ? { session, operator } : null;
  }
  async touchOperatorSession(token: string, now: Date, cutoff: Date) {
    return this.run("operator", async (store) => {
      const service = new PlatformService(store);
      const current = await service.getOperatorSession(token, now);
      if (!current || (current.session.lastSeenAt ?? current.session.createdAt) < cutoff)
        return null;
      const session = { ...current.session, lastSeenAt: now };
      await store.put("operator_session", token, null, session);
      return { session, operator: current.operator };
    });
  }
  async revokeOperatorSession(tokenHash: string) {
    return this.run("operator", async (store) => {
      const session = await store.get<P.PlatformOperatorSession>("operator_session", tokenHash);
      if (!session || session.revokedAt) return false;
      await store.put("operator_session", tokenHash, null, { ...session, revokedAt: new Date() });
      return true;
    });
  }
  async revokeOperatorSessions(operatorId: string) {
    return this.run("operator", async (store) => {
      let count = 0;
      for (const session of await store.list<P.PlatformOperatorSession>("operator_session")) {
        if (session.operatorId === operatorId && !session.revokedAt) {
          await store.put("operator_session", session.tokenHash, null, {
            ...session,
            revokedAt: new Date(),
          });
          count++;
        }
      }
      return count;
    });
  }
  async createOperatorOidcTransaction(input: P.PlatformOperatorOidcTransaction) {
    return this.run("operator-auth", async (store) => {
      if (await store.get("operator_oidc", input.stateHash))
        throw new PlatformError("CONFLICT", "OIDC state already exists");
      await store.put("operator_oidc", input.stateHash, null, input);
    });
  }
  async consumeOperatorOidcTransaction(state: string, binding: string, now = new Date()) {
    return this.run("operator-auth", async (store) => {
      const transaction = await store.get<P.PlatformOperatorOidcTransaction>(
        "operator_oidc",
        state,
      );
      if (
        !transaction ||
        transaction.consumedAt ||
        transaction.expiresAt <= now ||
        transaction.browserBindingHash !== binding
      )
        return null;
      await store.put("operator_oidc", state, null, { ...transaction, consumedAt: now });
      return transaction;
    });
  }
  async appendAuditEvent(input: Omit<P.PlatformAuditEvent, "id" | "createdAt">) {
    if (!input.reason.trim() || !input.actorId || !input.requestId)
      throw new PlatformError(
        "VALIDATION_ERROR",
        "Audit events require actor, request, and reason",
      );
    const event: P.PlatformAuditEvent = { ...input, id: randomUUID(), createdAt: new Date() };
    await this.store.put("audit", event.id, input.organizationId, event);
    return event;
  }
  async listAuditEvents(org?: string, limit = 100) {
    return (await this.store.list<P.PlatformAuditEvent>("audit", org))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async beginCommand(input: { actorId: string; idempotencyKey: string; requestHash: string }) {
    return this.run("operator", async (store) => {
      if (!input.idempotencyKey || !input.requestHash)
        throw new PlatformError(
          "VALIDATION_ERROR",
          "Command requires an idempotency key and request digest",
        );
      const id = hash(`${input.actorId}:${input.idempotencyKey}`);
      const previous = await store.get<P.PlatformCommandReceipt>("command", id);
      if (previous) {
        if (previous.requestHash !== input.requestHash)
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Command key was used with a different request",
          );
        return { receipt: previous, created: false };
      }
      const now = new Date();
      const receipt: P.PlatformCommandReceipt = {
        id,
        ...input,
        state: "running",
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      await store.put("command", id, null, receipt);
      return { receipt, created: true };
    });
  }
  private async finishCommand(id: string, result: unknown, error: string | null) {
    return this.run("operator", async (store) => {
      const receipt = await store.get<P.PlatformCommandReceipt>("command", id);
      if (!receipt) throw new PlatformError("NOT_FOUND", "Command receipt not found");
      if (receipt.state !== "running") return receipt;
      const next: P.PlatformCommandReceipt = {
        ...receipt,
        state: error ? "failed" : "complete",
        result,
        error: error?.slice(0, 500) ?? null,
        updatedAt: new Date(),
      };
      await store.put("command", id, null, next);
      return next;
    });
  }
  async completeCommand(id: string, result: unknown) {
    return this.finishCommand(id, result, null);
  }
  async failCommand(id: string, error: string) {
    return this.finishCommand(id, null, error);
  }
  async enqueueIntegrationJob(input: {
    integration: string;
    organizationId: string | null;
    eventType: string;
    deduplicationKey: string;
    payload: Record<string, unknown>;
  }) {
    return this.run(`integration:${input.integration}`, async (store) => {
      const id = hash(`${input.integration}:${input.deduplicationKey}`);
      const prior = await store.get<P.PlatformIntegrationJob>("integration_job", id);
      if (prior) {
        if (
          prior.eventType !== input.eventType ||
          stablePlatformJson(prior.payload) !== stablePlatformJson(input.payload)
        )
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Integration delivery key conflicts with an earlier event",
          );
        return prior;
      }
      const now = new Date();
      const job: P.PlatformIntegrationJob = {
        ...input,
        id,
        state: "pending",
        attempts: 0,
        availableAt: now,
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
        externalId: null,
        createdAt: now,
        completedAt: null,
      };
      await store.put("integration_job", id, input.organizationId, job);
      return job;
    });
  }
  async claimIntegrationJob(integration: string, leaseMs = 60000, now = new Date()) {
    return this.claimQueue<P.PlatformIntegrationJob>("integration_job", integration, leaseMs, now);
  }
  async completeIntegrationJob(
    id: string,
    token: string,
    externalId: string | null,
    now = new Date(),
    result?: Record<string, unknown>,
  ) {
    const settled = await this.settleQueue(
      "integration_job",
      id,
      token,
      null,
      externalId,
      false,
      now,
    );
    if (settled && result) {
      const job = (await this.store.get<P.PlatformIntegrationJob>("integration_job", id))!;
      await this.store.put("integration_job", id, job.organizationId, { ...job, result });
    }
    return settled;
  }
  async failIntegrationJob(
    id: string,
    token: string,
    error: string,
    ambiguous = false,
    now = new Date(),
  ) {
    return this.settleQueue("integration_job", id, token, error, null, ambiguous, now);
  }
  async listIntegrationJobs(integration?: string, limit = 100) {
    return (await this.store.list<P.PlatformIntegrationJob>("integration_job"))
      .filter((job) => !integration || job.integration === integration)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async getIntegrationJobByDeduplication(integration: string, deduplicationKey: string) {
    return this.store.get<P.PlatformIntegrationJob>(
      "integration_job",
      hash(`${integration}:${deduplicationKey}`),
    );
  }
  async getIntegrationJob(id: string) {
    return this.store.get<P.PlatformIntegrationJob>("integration_job", id);
  }
  async resolveAmbiguousIntegrationJob(
    id: string,
    externalId: string,
    result: Record<string, unknown>,
    now = new Date(),
  ) {
    return this.run("integration:jira-service-management", async (store) => {
      const job = await store.get<P.PlatformIntegrationJob>("integration_job", id);
      if (
        !job ||
        job.integration !== "jira-service-management" ||
        job.eventType !== "support.create"
      )
        return false;
      if (
        !externalId.trim() ||
        externalId.length > 128 ||
        result.caseId !== job.payload.caseId ||
        result.organizationId !== job.organizationId ||
        job.payload.organizationId !== job.organizationId
      )
        throw new PlatformError(
          "REFERENCE_MISMATCH",
          "Verified support receipt does not match the original delivery",
        );
      if (job.state === "complete") {
        if (job.externalId !== externalId)
          throw new PlatformError(
            "IDEMPOTENCY_CONFLICT",
            "Support delivery already maps to a different external issue",
          );
        return true;
      }
      if (job.state !== "ambiguous") return false;
      await store.put("integration_job", id, job.organizationId, {
        ...job,
        state: "complete",
        externalId,
        result,
        completedAt: now,
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
      });
      return true;
    });
  }
  async resolveAmbiguousSupportDelivery(
    id: string,
    externalId: string,
    result: Record<string, unknown>,
    now = new Date(),
  ) {
    return this.resolveAmbiguousIntegrationJob(id, externalId, result, now);
  }
  async retryIntegrationJob(id: string) {
    const previous = await this.store.get<P.PlatformIntegrationJob>("integration_job", id);
    if (!previous) throw new PlatformError("NOT_FOUND", "Integration job not found");
    return this.run(`integration:${previous.integration}`, async (store) => {
      const job = (await store.get<P.PlatformIntegrationJob>("integration_job", id))!;
      if (job.state === "complete" || job.state === "processing")
        throw new PlatformError("CONFLICT", "A completed or leased job cannot be retried");
      const next: P.PlatformIntegrationJob = {
        ...job,
        state: "pending",
        availableAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      };
      await store.put("integration_job", id, job.organizationId, next);
      return next;
    });
  }
  async saveIntegrationConnection(input: P.PlatformIntegrationConnection) {
    await this.store.put("integration_connection", input.id, null, input);
    return input;
  }
  async getIntegrationConnection(id: string) {
    return this.store.get<P.PlatformIntegrationConnection>("integration_connection", id);
  }
  async createCase(input: {
    organizationId: string | null;
    category: string;
    title: string;
    details: Record<string, unknown>;
  }) {
    if (!input.title.trim()) throw new PlatformError("VALIDATION_ERROR", "Case title is required");
    const now = new Date();
    const record: P.PlatformCase = {
      ...input,
      id: randomUUID(),
      state: "open",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put("case", record.id, input.organizationId, record);
    return record;
  }
  async listCases(state?: "open" | "closed") {
    return (await this.store.list<P.PlatformCase>("case")).filter(
      (record) => !state || record.state === state,
    );
  }
  async closeCase(id: string) {
    return this.run("cases", async (store) => {
      const record = await store.get<P.PlatformCase>("case", id);
      if (!record) throw new PlatformError("NOT_FOUND", "Case not found");
      const next: P.PlatformCase = { ...record, state: "closed", updatedAt: new Date() };
      await store.put("case", id, record.organizationId, next);
      return next;
    });
  }
  async updateCaseProviderMirror(
    id: string,
    mirror: {
      issueKey: string;
      status: string;
      assignee: { accountId: string; displayName: string } | null;
      checkedAt: Date;
    },
  ) {
    return this.run("operator", async (store) => {
      const record = await store.get<P.PlatformCase>("case", id);
      if (!record) throw new PlatformError("NOT_FOUND", "Support case not found");
      if (
        !mirror.issueKey.trim() ||
        !mirror.status.trim() ||
        !Number.isFinite(mirror.checkedAt.getTime())
      )
        throw new PlatformError("VALIDATION_ERROR", "Invalid provider status mirror");
      const next = {
        ...record,
        details: { ...record.details, providerMirror: mirror },
        updatedAt: new Date(),
      };
      await store.put("case", id, record.organizationId, next);
      return next;
    });
  }
  async heartbeat(input: Omit<P.PlatformWorkerHeartbeat, "updatedAt">) {
    const heartbeat = { ...input, updatedAt: new Date() };
    await this.store.put("heartbeat", input.id, null, heartbeat);
    return heartbeat;
  }
  async listHeartbeats() {
    return this.store.list<P.PlatformWorkerHeartbeat>("heartbeat");
  }
  async getWorkerControl(id: string) {
    return this.store.get<P.PlatformWorkerControl>("worker_control", id);
  }
  async setWorkerControl(id: string, paused: boolean) {
    const control: P.PlatformWorkerControl = { id, paused, updatedAt: new Date() };
    await this.store.put("worker_control", id, null, control);
    return control;
  }
  async assertIdentityDeletionAllowed(userId: string) {
    return this.run("identity", async (store) => {
      const members = (await store.list<P.OrganizationMemberRecord>("member")).filter(
        (m) => m.userId === userId && m.role === "owner",
      );
      for (const member of members) {
        const org = await store.get<P.OrganizationRecord>("organization", member.organizationId);
        if (org?.status !== "closed")
          await this.ensureAnotherOwner(store, member.organizationId, userId);
      }
      for (const workspaceId of await store.workspaceOwnerIds(userId)) {
        const org = await store.organizationIdForWorkspace(workspaceId);
        if (
          !org ||
          (await store.get<P.OrganizationRecord>("organization", org))?.status !== "closed"
        )
          throw new PlatformError(
            "OWNERSHIP_TRANSFER_REQUIRED",
            "Transfer workspace stewardship before deleting your identity",
          );
      }
    });
  }
  async deleteIdentityMemberships(userId: string) {
    return this.run("identity", async (store) => {
      await new PlatformService(store).assertIdentityDeletionAllowed(userId);
      for (const member of await store.list<P.OrganizationMemberRecord>("member"))
        if (member.userId === userId)
          await store.remove("member", platformMemberKey(member.organizationId, userId));
      await store.deleteUserMemberships(userId);
    });
  }
}
