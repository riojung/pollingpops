import { randomUUID, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createGameState, addParticipant, applyHostCommand } from "@openround/game-engine";
import type { Report } from "@openround/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRepository,
  PostgresRepository,
  createPlatformRepository,
  reserveRoomCoverageInMemory,
  consumeRoomCoverageInMemory,
  createPresentationSessionRepository,
  createCollaborationGroupRepository,
  type CreatorContext,
  type PlatformOffer,
  type PlatformRepository,
  type Repository,
} from "../src/index.js";
import type { MemoryPlatformRepository } from "../src/platform-memory.js";
import { createLibraryDeletionFixture } from "./support/library-deletion-fixtures.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

const snapshot = {
  plan: "pro" as const,
  maxParticipants: 100,
  maxPublishedQuizzes: null,
  reportRetentionDays: 365,
  csvExport: true,
  brandTheme: true,
  followups: true,
  cohosting: true,
  authoringJobsPerMonth: 100,
  maxPracticePersonalLinks: 100,
  recoveryTrails: true,
  maxRecoveryStages: 4,
  conceptHealth: true,
  decisionReplay: true,
};
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
async function creator(repository: Repository): Promise<CreatorContext> {
  const tokenHash = randomUUID();
  const now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `platform-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, now))!;
}
for (const backend of ["memory", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `Business platform ${backend} conformance`,
    () => {
      let repository: Repository;
      let platform: PlatformRepository;
      let owner: CreatorContext;
      let org: string;
      const databaseName = `platform_conformance_${randomUUID().replaceAll("-", "")}`;
      let isolatedAdminUrl = adminUrl;
      let isolatedRuntimeUrl = runtimeUrl;
      beforeAll(async () => {
        if (backend === "postgres") {
          await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
          const cluster = new PostgresRepository(adminUrl!);
          await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
          await cluster.close();
          const administrator = new URL(adminUrl!);
          administrator.pathname = `/${databaseName}`;
          const runtime = new URL(runtimeUrl!);
          runtime.pathname = `/${databaseName}`;
          isolatedAdminUrl = administrator.toString();
          isolatedRuntimeUrl = runtime.toString();
          const admin = new PostgresRepository(isolatedAdminUrl);
          await admin.migrate();
          await admin.close();
        }
      });
      afterAll(async () => {
        if (backend === "postgres") {
          const cluster = new PostgresRepository(adminUrl!);
          try {
            await cluster.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
          } finally {
            await cluster.close();
          }
        }
      });
      beforeEach(async () => {
        repository =
          backend === "memory"
            ? new MemoryRepository()
            : new PostgresRepository(isolatedRuntimeUrl!);
        await repository.initialize();
        owner = await creator(repository);
        platform = createPlatformRepository(repository);
        org = (await platform.getOrganizationForWorkspace(owner.workspaceId))!.id;
      });
      afterEach(async () => {
        vi.useRealTimers();
        await repository?.close();
      });

      async function userLicensedOrganization(quantity = 2) {
        const organization = await platform.createOrganization({
          name: "ABC Company",
          actorId: owner.userId,
          accountType: "organization",
          licenseUnit: "user",
        });
        await platform.applySubscriptionSnapshot({
          organizationId: organization.id,
          customerId: null,
          subscriptionId: null,
          status: "active",
          licenseQuantity: quantity,
          licenseUnit: "user",
          offerId: null,
          paidThrough: null,
          graceUntil: null,
          legacyPlan: "team",
        });
        return organization;
      }

      it("keeps personal ownership independent of a historically assigned Team plan", async () => {
        await repository.setPlan(owner.workspaceId, "team");
        expect(await platform.getOrganizationForWorkspace(owner.workspaceId)).toMatchObject({
          accountType: "personal",
          licenseUnit: "workspace",
        });
        const organization = await platform.createOrganization({
          name: "ABC Company",
          actorId: owner.userId,
          accountType: "organization",
          licenseUnit: "user",
        });
        expect(organization).toMatchObject({ accountType: "organization", licenseUnit: "user" });
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ quantity: 0, assigned: 0, reserved: 0, available: 0 });
      });

      it("allocates user seats to distinct organization-owned workspaces rather than licensing every workspace", async () => {
        const organization = await userLicensedOrganization(2);
        const state = await platform.getOrganizationUserLicenses(organization.id, owner.userId);
        expect(state).toMatchObject({
          licenseUnit: "user",
          quantity: 2,
          assigned: 1,
          reserved: 0,
          available: 1,
        });
        const ownerWorkspace = state.assignments[0]!.workspaceId;
        expect(ownerWorkspace).not.toBe(owner.workspaceId);
        expect(await platform.getOrganizationForWorkspace(ownerWorkspace)).toMatchObject({
          id: organization.id,
        });
        expect(await repository.getPlan(ownerWorkspace)).toBe("team");
        expect(await repository.getPlan(owner.workspaceId)).toBe("free");
        await expect(
          platform.createOrganizationWorkspace({
            organizationId: organization.id,
            actorId: owner.userId,
            name: "Unlicensed draft",
            segment: "workplace",
          }),
        ).rejects.toMatchObject({ code: "LICENSE_LIMIT" });
        await expect(
          platform.assignWorkspaceLicense(organization.id, owner.userId, ownerWorkspace, true),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(
          platform.assignOrganizationUserLicense(
            organization.id,
            owner.userId,
            owner.userId,
            true,
            { workspaceId: owner.workspaceId },
          ),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      });

      it("reserves the last creator seat atomically and provisions only the verified recipient's workspace", async () => {
        const organization = await userLicensedOrganization(2);
        const recipients = await Promise.all([creator(repository), creator(repository)]);
        const tokens = [randomUUID(), randomUUID()];
        const outcomes = await Promise.allSettled(
          recipients.map((recipient, index) =>
            platform.createOrganizationInvitation({
              organizationId: organization.id,
              actorId: owner.userId,
              email: recipient.email,
              role: "member",
              workspaceName: `Sales ${index + 1}`,
              tokenHash: tokens[index]!,
              expiresAt: new Date(Date.now() + 60000),
            }),
          ),
        );
        expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((result) => result.status === "rejected")).toEqual([
          expect.objectContaining({ reason: expect.objectContaining({ code: "LICENSE_LIMIT" }) }),
        ]);
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 1, reserved: 1, available: 0 });
        const acceptedIndex = outcomes.findIndex((result) => result.status === "fulfilled");
        const recipient = recipients[acceptedIndex]!;
        await expect(
          platform.acceptOrganizationInvitation({
            tokenHash: tokens[acceptedIndex]!,
            actorId: recipients[1 - acceptedIndex]!.userId,
          }),
        ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
        const accepted = await platform.acceptOrganizationInvitation({
          tokenHash: tokens[acceptedIndex]!,
          actorId: recipient.userId,
        });
        expect(accepted).toMatchObject({ role: "member", workspaceId: expect.any(String) });
        expect(
          await repository.getCreatorByUserId(recipient.userId, accepted.workspaceId!),
        ).toMatchObject({ role: "owner", plan: "team" });
        expect(
          (await repository.listWorkspaces(owner.userId)).some(
            (workspace) => workspace.id === accepted.workspaceId,
          ),
        ).toBe(false);
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 2, reserved: 0, available: 0 });
        await expect(
          platform.createOrganizationInvitation({
            organizationId: organization.id,
            actorId: recipient.userId,
            email: "another@example.test",
            role: "member",
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 60000),
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });

      it("releases revoked and expired reservations without losing occupied licenses", async () => {
        const organization = await userLicensedOrganization(2);
        const recipient = await creator(repository);
        const now = new Date();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        const invitation = await platform.createOrganizationInvitation({
          organizationId: organization.id,
          actorId: owner.userId,
          email: recipient.email,
          role: "member",
          tokenHash: randomUUID(),
          expiresAt: new Date(now.getTime() + 60000),
        });
        expect(
          await platform.revokeOrganizationInvitation(organization.id, owner.userId, invitation.id),
        ).toBe(true);
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 1, reserved: 0, available: 1 });
        const tokenHash = randomUUID();
        await platform.createOrganizationInvitation({
          organizationId: organization.id,
          actorId: owner.userId,
          email: recipient.email,
          role: "member",
          tokenHash,
          expiresAt: new Date(now.getTime() + 60000),
        });
        vi.setSystemTime(new Date(now.getTime() + 60001));
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 1, reserved: 0, available: 1 });
        await expect(
          platform.acceptOrganizationInvitation({ tokenHash, actorId: recipient.userId }),
        ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
      });

      it("keeps billing access separate from creator capacity and content", async () => {
        const organization = await userLicensedOrganization(1);
        const finance = await creator(repository);
        const tokenHash = randomUUID();
        await platform.createOrganizationInvitation({
          organizationId: organization.id,
          actorId: owner.userId,
          email: finance.email,
          role: "billing",
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
        });
        const accepted = await platform.acceptOrganizationInvitation({
          tokenHash,
          actorId: finance.userId,
        });
        expect(accepted.role).toBe("billing");
        expect(accepted.workspaceId).toBeUndefined();
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 1, reserved: 0 });
        await expect(
          platform.assignOrganizationUserLicense(
            organization.id,
            finance.userId,
            finance.userId,
            true,
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          platform.createOrganizationInvitation({
            organizationId: organization.id,
            actorId: owner.userId,
            email: "finance-two@example.test",
            role: "billing",
            workspaceName: "Forbidden",
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 60000),
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const newMember = await creator(repository);
        await expect(
          platform.setOrganizationMember({
            organizationId: organization.id,
            actorId: owner.userId,
            userId: newMember.userId,
            role: "member",
          }),
        ).rejects.toMatchObject({ code: "LICENSE_LIMIT" });
        expect(await platform.listOrganizationMembers(organization.id, owner.userId)).toHaveLength(
          2,
        );
      });

      it("releases a creator license without rebinding stale sessions and retains organization content", async () => {
        const organization = await userLicensedOrganization(2);
        const recipient = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: organization.id,
          actorId: owner.userId,
          userId: recipient.userId,
          role: "member",
        });
        const assignment = (
          await platform.getOrganizationUserLicenses(organization.id, owner.userId)
        ).assignments.find((entry) => entry.userId === recipient.userId)!;
        const tokenHash = randomUUID();
        await repository.createCreatorSession({
          id: randomUUID(),
          userId: recipient.userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
          activeWorkspaceId: assignment.workspaceId,
        });
        expect(await repository.getCreatorBySession(tokenHash, new Date())).toMatchObject({
          workspaceId: assignment.workspaceId,
        });
        await platform.assignOrganizationUserLicense(
          organization.id,
          owner.userId,
          recipient.userId,
          false,
        );
        expect(await repository.getCreatorBySession(tokenHash, new Date())).toBeNull();
        expect(await repository.getUserPrincipalBySession(tokenHash, new Date())).toMatchObject({
          userId: recipient.userId,
        });
        expect(
          await repository.getCreatorByUserId(recipient.userId, assignment.workspaceId),
        ).toBeNull();
        expect(await platform.listOrganizationWorkspaces(organization.id, owner.userId)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: assignment.workspaceId,
              organizationId: organization.id,
            }),
          ]),
        );
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 1, available: 1 });
        expect(
          await platform.removeOrganizationMember(organization.id, owner.userId, recipient.userId),
        ).toBe(true);
        await expect(
          platform.getOrganization(organization.id, recipient.userId),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          platform.renameWorkspace(assignment.workspaceId, recipient.userId, "Hijacked"),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });

      it("rolls back the seat, dedicated workspace and accepted invitation together", async () => {
        const organization = await userLicensedOrganization(2);
        const recipient = await creator(repository);
        const tokenHash = randomUUID();
        await platform.createOrganizationInvitation({
          organizationId: organization.id,
          actorId: owner.userId,
          email: recipient.email,
          role: "member",
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
        });
        const before = await platform.listOrganizationWorkspaces(organization.id, owner.userId);
        await expect(
          platform.withTransaction(async (scoped) => {
            await scoped.acceptOrganizationInvitation({ tokenHash, actorId: recipient.userId });
            throw new Error("Injected commit failure");
          }),
        ).rejects.toThrow("Injected commit failure");
        expect(await platform.listOrganizationWorkspaces(organization.id, owner.userId)).toEqual(
          before,
        );
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 1, reserved: 1 });
        expect(
          (await platform.listOrganizationInvitations(organization.id, owner.userId))[0]!
            .acceptedAt,
        ).toBeNull();
        expect(
          (await platform.acceptOrganizationInvitation({ tokenHash, actorId: recipient.userId }))
            .workspaceId,
        ).toBeTruthy();
      });

      it("transfers a retained creator workspace to an unassigned successor without widening account roles", async () => {
        const organization = await userLicensedOrganization(2);
        const departed = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: organization.id,
          actorId: owner.userId,
          userId: departed.userId,
          role: "member",
        });
        const oldAssignment = (
          await platform.getOrganizationUserLicenses(organization.id, owner.userId)
        ).assignments.find((assignment) => assignment.userId === departed.userId)!;
        await platform.renameWorkspace(oldAssignment.workspaceId, departed.userId, "Sales archive");
        await platform.removeOrganizationMember(organization.id, owner.userId, departed.userId);
        const successor = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: organization.id,
          actorId: owner.userId,
          userId: successor.userId,
          role: "member",
        });
        await expect(
          platform.transferWorkspaceOwnership(
            oldAssignment.workspaceId,
            owner.userId,
            successor.userId,
          ),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await platform.assignOrganizationUserLicense(
          organization.id,
          owner.userId,
          successor.userId,
          false,
        );
        await platform.transferWorkspaceOwnership(
          oldAssignment.workspaceId,
          owner.userId,
          successor.userId,
        );
        expect(
          await repository.getCreatorByUserId(successor.userId, oldAssignment.workspaceId),
        ).toMatchObject({ role: "owner", plan: "team" });
        expect(
          await platform.requireOrganizationRole(organization.id, successor.userId, ["member"]),
        ).toMatchObject({ role: "member" });
        expect(
          await platform.listOrganizationWorkspaces(organization.id, successor.userId),
        ).toEqual([
          expect.objectContaining({
            id: oldAssignment.workspaceId,
            name: "Sales archive",
            organizationId: organization.id,
          }),
        ]);
        expect(
          await repository.getCreatorByUserId(departed.userId, oldAssignment.workspaceId),
        ).toBeNull();
      });

      it("limits workspace metadata by user account role and keeps company renaming separate from content access", async () => {
        const organization = await userLicensedOrganization(3);
        const member = await creator(repository);
        const admin = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: organization.id,
          actorId: owner.userId,
          userId: member.userId,
          role: "member",
        });
        await platform.setOrganizationMember({
          organizationId: organization.id,
          actorId: owner.userId,
          userId: admin.userId,
          role: "admin",
        });
        const memberWorkspaces = await platform.listOrganizationWorkspaces(
          organization.id,
          member.userId,
        );
        expect(memberWorkspaces).toHaveLength(1);
        expect(
          await platform.listOrganizationWorkspaces(organization.id, admin.userId),
        ).toHaveLength(3);
        expect(
          await repository.getCreatorByUserId(admin.userId, memberWorkspaces[0]!.id),
        ).toBeNull();
        await expect(
          platform.renameOrganization(organization.id, member.userId, "Hijacked"),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(
          await platform.renameOrganization(organization.id, admin.userId, "  ABC Sales  "),
        ).toMatchObject({ name: "ABC Sales" });
        await platform.updateOrganizationStatus(organization.id, "suspended");
        await expect(
          platform.renameOrganization(organization.id, owner.userId, "Blocked"),
        ).rejects.toMatchObject({ code: "ORGANIZATION_SUSPENDED" });
      });

      it("requires new commercial terms before changing an offer's licensed unit", async () => {
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Workspace offer",
          productKey: "pollingpops",
          kind: "workspace_subscription",
          status: "published",
          version: 1,
          stripePriceId: "price_workspace",
          currency: "usd",
          amountMinor: 1000,
          interval: "month",
          creditQuantity: 0,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        await expect(platform.saveOffer({ ...offer, licenseUnit: "user" })).rejects.toMatchObject({
          code: "CONFLICT",
        });
        await expect(
          platform.saveOffer({ ...offer, version: 2, licenseUnit: "user" }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(
          await platform.saveOffer({
            ...offer,
            version: 2,
            licenseUnit: "user",
            stripePriceId: "price_user",
          }),
        ).toMatchObject({ licenseUnit: "user", version: 2 });
        await expect(
          platform.createPurchase({
            organizationId: org,
            actorId: owner.userId,
            offerId: offer.id,
            quantity: 1,
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      });

      it("retains captured subscription terms after catalog replacement and adopts only recognized new terms", async () => {
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Personal Pro",
          productKey: "pollingpops",
          kind: "workspace_subscription",
          licenseUnit: "workspace",
          status: "published",
          version: 1,
          stripePriceId: `price_original_${randomUUID()}`,
          currency: "usd",
          amountMinor: 1000,
          interval: "month",
          creditQuantity: 0,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        const purchase = await platform.createPurchase({
          organizationId: org,
          actorId: owner.userId,
          offerId: offer.id,
          quantity: 1,
          idempotencyKey: randomUUID(),
        });
        const subscriptionId = `sub_${randomUUID()}`;
        const initial = await platform.applySubscriptionSnapshot({
          organizationId: org,
          customerId: `cus_${randomUUID()}`,
          subscriptionId,
          licenseQuantity: 1,
          licenseUnit: "workspace",
          offerId: offer.id,
          status: "active",
          paidThrough: new Date(now.getTime() + 60000),
          graceUntil: null,
          purchaseId: purchase.id,
          offerSnapshot: offer,
        });
        await platform.markSubscriptionPurchasePaid(purchase.id, subscriptionId);
        await platform.assignWorkspaceLicense(org, owner.userId, owner.workspaceId, true);
        const replacement: PlatformOffer = {
          ...offer,
          version: 2,
          stripePriceId: `price_replacement_${randomUUID()}`,
          amountMinor: 2000,
          entitlements: { ...snapshot, plan: "team" },
          updatedAt: new Date(now.getTime() + 1000),
        };
        await platform.saveOffer(replacement);
        expect(await repository.getPlan(owner.workspaceId)).toBe("pro");
        const renewed = await platform.applySubscriptionSnapshot({
          ...initial,
          offerSnapshot: offer,
          paidThrough: new Date(now.getTime() + 120000),
        });
        expect(renewed.offerSnapshot).toEqual(offer);
        expect(await platform.effectiveWorkspacePlan(owner.workspaceId)).toBe("pro");
        const upgraded = await platform.applySubscriptionSnapshot({
          ...renewed,
          offerSnapshot: replacement,
          paidThrough: new Date(now.getTime() + 180000),
        });
        expect(upgraded.offerSnapshot).toEqual(replacement);
        expect(await repository.getPlan(owner.workspaceId)).toBe("team");
        await expect(
          platform.applySubscriptionSnapshot({
            ...upgraded,
            offerSnapshot: { ...replacement, stripePriceId: "price_unrecognized" },
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        const userOffer: PlatformOffer = {
          ...replacement,
          version: 3,
          licenseUnit: "user",
          stripePriceId: `price_user_${randomUUID()}`,
        };
        await platform.saveOffer(userOffer);
        expect(await repository.getPlan(owner.workspaceId)).toBe("team");
        await expect(
          platform.applySubscriptionSnapshot({
            ...upgraded,
            licenseUnit: "user",
            offerSnapshot: userOffer,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await platform.getSubscription(org)).toEqual(upgraded);
      });

      it("accepts a pending historical checkout's own terms while rejecting an unrelated purchase", async () => {
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Historical workspace plan",
          productKey: "pollingpops",
          kind: "workspace_subscription",
          licenseUnit: "workspace",
          status: "published",
          version: 1,
          stripePriceId: `price_original_${randomUUID()}`,
          currency: "usd",
          amountMinor: 1000,
          interval: "month",
          creditQuantity: 0,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        const purchase = await platform.createPurchase({
          organizationId: org,
          actorId: owner.userId,
          offerId: offer.id,
          quantity: 1,
          idempotencyKey: randomUUID(),
        });
        await platform.saveOffer({
          ...offer,
          version: 2,
          licenseUnit: "user",
          stripePriceId: `price_user_${randomUUID()}`,
          entitlements: { ...snapshot, plan: "team" },
        });
        const historical = {
          organizationId: org,
          customerId: `cus_${randomUUID()}`,
          subscriptionId: `sub_${randomUUID()}`,
          status: "active",
          licenseQuantity: 1,
          licenseUnit: "workspace" as const,
          offerId: offer.id,
          offerSnapshot: offer,
          paidThrough: new Date(now.getTime() + 60000),
          graceUntil: null,
          purchaseId: purchase.id,
        };
        expect(await platform.applySubscriptionSnapshot(historical)).toMatchObject({
          licenseUnit: "workspace",
          offerSnapshot: offer,
        });
        const anotherOrganization = await platform.createOrganization({
          actorId: owner.userId,
          name: "Unrelated organization",
        });
        await expect(
          platform.applySubscriptionSnapshot({
            ...historical,
            organizationId: anotherOrganization.id,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect((await platform.getSubscription(anotherOrganization.id)).status).toBe("free");
      });

      it("lets a transferred legacy workspace owner rename without receiving an organization role", async () => {
        const successor = await creator(repository);
        const tokenHash = randomUUID();
        await repository.createWorkspaceInvitation({
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          email: successor.email,
          role: "editor",
          tokenHash,
          invitedBy: owner.userId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60000),
          acceptedAt: null,
          revokedAt: null,
        });
        await repository.acceptWorkspaceInvitation(tokenHash, new Date(), "test");
        await expect(
          platform.renameWorkspace(owner.workspaceId, successor.userId, "Not yet owner"),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await platform.transferWorkspaceOwnership(
          owner.workspaceId,
          owner.userId,
          successor.userId,
        );
        expect(
          (await platform.listOrganizations(successor.userId)).some((item) => item.id === org),
        ).toBe(false);
        expect(
          await repository.getCreatorByUserId(successor.userId, owner.workspaceId),
        ).toMatchObject({
          role: "owner",
        });
        expect(
          await platform.renameWorkspace(
            owner.workspaceId,
            successor.userId,
            "  Successor's workspace  ",
          ),
        ).toMatchObject({ name: "Successor's workspace", ownerId: successor.userId });
      });

      it("does not downgrade an existing workspace owner when accepting a scoped legacy organization invitation", async () => {
        const tokenHash = randomUUID();
        await platform.createOrganizationInvitation({
          organizationId: org,
          actorId: owner.userId,
          email: owner.email,
          role: "member",
          workspaceId: owner.workspaceId,
          workspaceRole: "viewer",
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
        });
        await platform.acceptOrganizationInvitation({ tokenHash, actorId: owner.userId });
        expect(await repository.getCreatorByUserId(owner.userId, owner.workspaceId)).toMatchObject({
          role: "owner",
        });
        expect(await platform.requireOrganizationRole(org, owner.userId, ["owner"])).toMatchObject({
          role: "owner",
        });
      });

      it("rejects ordinary workspace invitations and historical tokens for user-license organizations", async () => {
        const organization = await userLicensedOrganization(2);
        const workspace = (
          await platform.listOrganizationWorkspaces(organization.id, owner.userId)
        )[0]!;
        const tokenHash = randomUUID();
        const invitation = {
          id: randomUUID(),
          workspaceId: workspace.id,
          email: "blocked@example.test",
          role: "editor" as const,
          tokenHash,
          invitedBy: owner.userId,
          expiresAt: new Date(Date.now() + 60000),
          acceptedAt: null,
          revokedAt: null,
          createdAt: new Date(),
        };
        // Seed a historical token without bypassing the production invitation guard.
        if (repository instanceof MemoryRepository)
          repository.workspaceInvitations.set(invitation.id, invitation);
        else {
          const administrator = new PostgresRepository(isolatedAdminUrl!);
          try {
            await administrator.pool.query(
              `INSERT INTO workspace_invitations(id,workspace_id,email,role,token_hash,invited_by,expires_at,created_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [
                invitation.id,
                invitation.workspaceId,
                invitation.email,
                invitation.role,
                invitation.tokenHash,
                invitation.invitedBy,
                invitation.expiresAt,
                invitation.createdAt,
              ],
            );
          } finally {
            await administrator.close();
          }
        }
        expect(
          await repository.acceptWorkspaceInvitation(tokenHash, new Date(), "test"),
        ).toBeNull();
        await expect(
          repository.createWorkspaceInvitation({
            ...invitation,
            id: randomUUID(),
            email: "another@example.test",
            tokenHash: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "ORGANIZATION_MEMBERSHIP_REQUIRED" });
        expect((await repository.listWorkspaceInvitations(workspace.id))[0]!.acceptedAt).toBeNull();
      });

      it("rejects subscription and provider-offer licensed-unit changes atomically", async () => {
        const organization = await userLicensedOrganization(2);
        const before = await platform.getSubscription(organization.id);
        await expect(
          platform.applySubscriptionSnapshot({ ...before, licenseUnit: "workspace" }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Legacy workspace offer",
          productKey: "pollingpops",
          kind: "workspace_subscription",
          status: "published",
          version: 1,
          stripePriceId: "price_fixed_workspace",
          currency: "usd",
          amountMinor: 1000,
          interval: "month",
          creditQuantity: 0,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        await expect(
          platform.applySubscriptionSnapshot({ ...before, offerId: offer.id }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await platform.getSubscription(organization.id)).toEqual(before);
        expect(
          await platform.getOrganizationUserLicenses(organization.id, owner.userId),
        ).toMatchObject({ assigned: 1, available: 1 });
      });

      it.each(["round", "presentation"] as const)(
        "blocks creator-seat release while %s controls remain active and preserves unrelated access",
        async (artifactType) => {
          const organization = await userLicensedOrganization(2);
          const recipient = await creator(repository);
          await platform.setOrganizationMember({
            organizationId: organization.id,
            actorId: owner.userId,
            userId: recipient.userId,
            role: "member",
          });
          const assignment = (
            await platform.getOrganizationUserLicenses(organization.id, owner.userId)
          ).assignments.find((entry) => entry.userId === recipient.userId)!;
          const scopedCreator = (await repository.getCreatorByUserId(
            recipient.userId,
            assignment.workspaceId,
          ))!;
          const fixture = await createLibraryDeletionFixture(
            repository,
            scopedCreator,
            recipient.userId,
          );
          const now = new Date();
          const roomId = randomUUID();
          const expiresAt = new Date(now.getTime() + 60000);
          const retentionExpiresAt = new Date(now.getTime() + 86400000);
          const code = String(randomInt(1000000, 10000000));
          const credentialHash = () =>
            randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
          const tokenHash = credentialHash();
          const commercialCoverage = {
            artifactType,
            roomId,
            workspaceId: assignment.workspaceId,
            funding: "subscription" as const,
            snapshot,
            actorId: recipient.userId,
            expiresAt,
          };
          const presentations = createPresentationSessionRepository(repository);
          let finish: () => Promise<unknown>;
          if (artifactType === "round") {
            const state = createGameState({
              sessionId: roomId,
              code,
              quiz: fixture.content,
              settings: {
                audienceLimit: 100,
                scoringMode: "accuracy",
                resultVisibility: "private",
                allowLateJoin: true,
                nicknamePolicy: "friendly_only",
                trustMode: "learning",
              },
            });
            const room = {
              id: roomId,
              workspaceId: assignment.workspaceId,
              quizVersionId: fixture.roundVersion.id,
              hostId: recipient.userId,
              hostTokenHash: tokenHash,
              state,
              expiresAt,
              retentionExpiresAt,
              createdAt: now,
              updatedAt: now,
              commercialCoverage,
            };
            await repository.createSession(room);
            await repository.createSessionStaffCredential({
              id: randomUUID(),
              workspaceId: assignment.workspaceId,
              sessionId: roomId,
              role: "cohost",
              purpose: "creator_resume",
              label: "Creator controls",
              tokenHash: credentialHash(),
              createdBy: recipient.userId,
              expiresAt,
              revokedAt: null,
              createdAt: now,
            });
            finish = async () => {
              const stored = (await repository.getSessionById(roomId))!;
              const ended = applyHostCommand(stored.state, {
                commandId: randomUUID(),
                expectedVersion: stored.state.version,
                action: "end",
                nowMs: Date.now(),
                newRoundId: randomUUID,
              });
              await repository.saveSession({ ...stored, state: ended.state }, stored.state.version);
            };
          } else {
            await presentations.createSessionWithCredential(
              {
                id: roomId,
                workspaceId: assignment.workspaceId,
                presentationId: fixture.presentation.id,
                presentationVersionId: fixture.presentationVersion.id,
                title: fixture.presentationContent.title,
                content: fixture.presentationContent,
                code,
                status: "active",
                phase: "lobby",
                currentBlockIndex: -1,
                revision: 0,
                createdBy: recipient.userId,
                createdAt: now,
                updatedAt: now,
                finishedAt: null,
                liveExpiresAt: expiresAt,
                retentionExpiresAt,
                commercialCoverage,
              },
              {
                id: randomUUID(),
                workspaceId: assignment.workspaceId,
                sessionId: roomId,
                role: "host",
                tokenHash,
                createdAt: now,
                expiresAt,
                revokedAt: null,
              },
            );
            await presentations.createCredential({
              id: randomUUID(),
              workspaceId: assignment.workspaceId,
              sessionId: roomId,
              role: "companion",
              tokenHash: credentialHash(),
              createdAt: now,
              expiresAt,
              revokedAt: null,
            });
            finish = () =>
              presentations.transitionSession({
                workspaceId: assignment.workspaceId,
                sessionId: roomId,
                expectedRevision: 0,
                status: "finished",
                phase: "finished",
                currentBlockIndex: -1,
                event: { type: "presentation.finished", blockId: null, blockIndex: null },
              });
          }
          const frozen = (await platform.getRoomCoverage(artifactType, roomId))!.snapshot;
          await expect(
            platform.assignOrganizationUserLicense(
              organization.id,
              owner.userId,
              recipient.userId,
              false,
            ),
          ).rejects.toMatchObject({ code: "WORKSPACE_BUSY" });
          await expect(
            platform.removeOrganizationMember(organization.id, owner.userId, recipient.userId),
          ).rejects.toMatchObject({ code: "WORKSPACE_BUSY" });
          expect(
            await platform.getOrganizationUserLicenses(organization.id, owner.userId),
          ).toMatchObject({ assigned: 2 });
          expect(
            await repository.getCreatorByUserId(recipient.userId, assignment.workspaceId),
          ).not.toBeNull();
          // A released registry code alone cannot bypass still-active durable control state.
          await repository.releaseLiveRoomCode(artifactType, roomId);
          await expect(
            platform.assignOrganizationUserLicense(
              organization.id,
              owner.userId,
              recipient.userId,
              false,
            ),
          ).rejects.toMatchObject({ code: "WORKSPACE_BUSY" });
          const personalCode = String(randomInt(1000000, 10000000));
          await repository.claimLiveRoomCode({
            code: personalCode,
            workspaceId: recipient.workspaceId,
            artifactType,
            artifactId: randomUUID(),
            expiresAt,
            createdAt: now,
          });
          await finish();
          await platform.removeOrganizationMember(organization.id, owner.userId, recipient.userId);
          expect(await repository.getLiveRoomCode(personalCode)).not.toBeNull();
          expect((await platform.getRoomCoverage(artifactType, roomId))!.snapshot).toEqual(frozen);
          expect(
            artifactType === "round"
              ? await repository.getSessionById(roomId)
              : await presentations.getSessionById(roomId),
          ).not.toBeNull();
        },
      );

      it("persists global feature policies with revision conflicts and concurrent writer protection", async () => {
        expect(await platform.getFeaturePolicy()).toBeNull();
        const features = { sessionSummaries: { enabled: true, plans: ["pro" as const] } };
        const saved = await platform.saveFeaturePolicy({ expectedRevision: 0, features });
        expect(saved).toMatchObject({ revision: 1, features });
        expect(saved.updatedAt).toBeInstanceOf(Date);
        features.sessionSummaries.enabled = false;
        const reader = createPlatformRepository(repository);
        expect(await reader.getFeaturePolicy()).toEqual(saved);
        await expect(
          platform.saveFeaturePolicy({ expectedRevision: 0, features: {} }),
        ).rejects.toMatchObject({ code: "CONFLICT" });

        const writes = await Promise.allSettled([
          platform.saveFeaturePolicy({
            expectedRevision: 1,
            features: { sessionSummaries: { enabled: false, plans: [] } },
          }),
          reader.saveFeaturePolicy({
            expectedRevision: 1,
            features: { sessionSummaries: { enabled: true, plans: ["free", "pro", "team"] } },
          }),
        ]);
        expect(writes.filter((write) => write.status === "fulfilled")).toHaveLength(1);
        expect(writes.filter((write) => write.status === "rejected")).toEqual([
          expect.objectContaining({ reason: expect.objectContaining({ code: "CONFLICT" }) }),
        ]);
        expect(await reader.getFeaturePolicy()).toMatchObject({ revision: 2 });
      });
      it("validates feature policy input before changing stored assignments", async () => {
        const before = await platform.getFeaturePolicy();
        const expectedRevision = before?.revision ?? 0;
        for (const features of [
          { unknownFeature: { enabled: true, plans: ["pro"] } },
          { sessionSummaries: { enabled: true, plans: ["pro", "pro"] } },
          { sessionSummaries: { enabled: true, plans: ["enterprise"] } },
        ])
          await expect(
            platform.saveFeaturePolicy({ expectedRevision, features: features as never }),
          ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER, NaN])
          await expect(
            platform.saveFeaturePolicy({ expectedRevision: revision, features: {} }),
          ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(await platform.getFeaturePolicy()).toEqual(before);
      });
      it("rolls feature policy changes back with the operator audit and receipt", async () => {
        const before = await platform.getFeaturePolicy();
        const key = randomUUID();
        await expect(
          platform.withOperatorTransaction(async (scoped) => {
            const { receipt } = await scoped.beginCommand({
              actorId: "feature-operator",
              idempotencyKey: key,
              requestHash: "feature-policy-digest",
            });
            const after = await scoped.saveFeaturePolicy({
              expectedRevision: before?.revision ?? 0,
              features: { sessionSummaries: { enabled: true, plans: ["team"] } },
            });
            await scoped.appendAuditEvent({
              actorId: "feature-operator",
              organizationId: null,
              action: "features.update",
              targetId: "global",
              reason: "Approved feature policy adjustment",
              requestId: key,
              before,
              after,
            });
            await scoped.completeCommand(receipt.id, after);
            throw new Error("Injected feature policy commit failure");
          }),
        ).rejects.toThrow("Injected feature policy commit failure");
        expect(await platform.getFeaturePolicy()).toEqual(before);
        expect((await platform.listAuditEvents()).some((event) => event.requestId === key)).toBe(
          false,
        );
        expect(
          await platform.beginCommand({
            actorId: "feature-operator",
            idempotencyKey: key,
            requestHash: "feature-policy-digest",
          }),
        ).toMatchObject({ created: true });
      });

      it("keeps organization commercial roles separate from workspace content access", async () => {
        const billing = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: org,
          actorId: owner.userId,
          userId: billing.userId,
          role: "billing",
        });
        expect(await platform.listOrganizations(billing.userId)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: org, role: "billing" })]),
        );
        expect(
          (await repository.listWorkspaces(billing.userId)).some(
            (workspace) => workspace.id === owner.workspaceId,
          ),
        ).toBe(false);
        await expect(
          platform.createOrganizationWorkspace({
            organizationId: org,
            actorId: billing.userId,
            name: "Unauthorized",
            segment: "workplace",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          platform.removeOrganizationMember(org, owner.userId, owner.userId),
        ).rejects.toMatchObject({ code: "OWNERSHIP_TRANSFER_REQUIRED" });
      });
      it("closes only an owner-controlled organization without active commercial obligations", async () => {
        const member = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: org,
          actorId: owner.userId,
          userId: member.userId,
          role: "admin",
        });
        await expect(platform.closeOrganization(org, member.userId)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await platform.applySubscriptionSnapshot({
          organizationId: org,
          customerId: null,
          subscriptionId: null,
          status: "active",
          licenseQuantity: 1,
          offerId: null,
          paidThrough: null,
          graceUntil: null,
        });
        await expect(platform.closeOrganization(org, owner.userId)).rejects.toMatchObject({
          code: "ACTIVE_SUBSCRIPTION",
        });
        const subscription = await platform.getSubscription(org);
        await platform.applySubscriptionSnapshot({ ...subscription, status: "canceled" });
        const activeRoomId = randomUUID();
        await repository.claimLiveRoomCode({
          code: String(randomInt(1000000, 10000000)),
          workspaceId: owner.workspaceId,
          artifactType: "round",
          artifactId: activeRoomId,
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date(),
        });
        await expect(platform.closeOrganization(org, owner.userId)).rejects.toMatchObject({
          code: "ACTIVE_ROOMS",
        });
        await repository.releaseLiveRoomCode("round", activeRoomId);
        expect((await platform.closeOrganization(org, owner.userId)).status).toBe("closed");
        expect((await platform.closeOrganization(org, owner.userId)).status).toBe("closed");
        await expect(platform.updateOrganizationStatus(org, "active")).rejects.toMatchObject({
          code: "ORGANIZATION_CLOSED",
        });
        await expect(platform.updateOrganizationStatus(org, "suspended")).rejects.toMatchObject({
          code: "ORGANIZATION_CLOSED",
        });
        expect(
          (await platform.listOrganizationMembers(org, owner.userId)).some(
            (entry) => entry.userId === owner.userId,
          ),
        ).toBe(true);
        await expect(
          platform.createOrganizationWorkspace({
            organizationId: org,
            actorId: owner.userId,
            name: "After closure",
            segment: "workplace",
          }),
        ).rejects.toMatchObject({ code: "ORGANIZATION_SUSPENDED" });
      });
      it("blocks new registry claims when paused or closed while allowing existing room reads", async () => {
        const code = String(randomInt(1000000, 10000000));
        const input = {
          code,
          workspaceId: owner.workspaceId,
          artifactType: "feedback_room" as const,
          artifactId: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date(),
        };
        await repository.claimLiveRoomCode(input);
        await platform.updateWorkspaceStatus(owner.workspaceId, "suspended");
        expect(await repository.getLiveRoomCode(code)).not.toBeNull();
        await expect(
          repository.claimLiveRoomCode({
            ...input,
            code: String(randomInt(1000000, 10000000)),
            artifactId: randomUUID(),
          }),
        ).rejects.toThrow();
        await platform.updateWorkspaceStatus(owner.workspaceId, "active");
        await platform.updateOrganizationStatus(org, "closed");
        expect(await repository.getLiveRoomCode(code)).not.toBeNull();
        await expect(
          repository.claimLiveRoomCode({
            ...input,
            code: String(randomInt(1000000, 10000000)),
            artifactId: randomUUID(),
          }),
        ).rejects.toThrow();
      });
      it.skipIf(backend !== "postgres")(
        "backfills legacy live-room terms once and preserves them after plan downgrade",
        async () => {
          const fixture = await createLibraryDeletionFixture(repository, owner, owner.userId);
          await repository.setPlan(owner.workspaceId, "pro");
          const now = new Date();
          const expiresAt = new Date(now.getTime() + 60000);
          const retentionExpiresAt = new Date(now.getTime() + 37 * 86400000);
          const roundId = randomUUID();
          const code = String(randomInt(1000000, 10000000));
          const state = createGameState({
            sessionId: roundId,
            code,
            quiz: fixture.content,
            settings: {
              audienceLimit: 77,
              scoringMode: "accuracy",
              resultVisibility: "private",
              allowLateJoin: true,
              nicknamePolicy: "friendly_only",
              trustMode: "learning",
            },
          });
          await repository.createSession({
            id: roundId,
            workspaceId: owner.workspaceId,
            quizVersionId: fixture.roundVersion.id,
            hostId: owner.userId,
            hostTokenHash: randomUUID(),
            state,
            expiresAt,
            retentionExpiresAt,
            createdAt: now,
            updatedAt: now,
          });
          const presentation = await createPresentationSessionRepository(repository).createSession({
            id: randomUUID(),
            workspaceId: owner.workspaceId,
            presentationId: fixture.presentation.id,
            presentationVersionId: fixture.presentationVersion.id,
            title: fixture.presentationContent.title,
            content: fixture.presentationContent,
            code: String(randomInt(1000000, 10000000)),
            status: "active",
            phase: "lobby",
            currentBlockIndex: -1,
            revision: 0,
            createdBy: owner.userId,
            createdAt: now,
            updatedAt: now,
            finishedAt: null,
            liveExpiresAt: expiresAt,
            retentionExpiresAt,
          });
          const migration = await readFile(
            new URL("../migrations/065_business_platform.sql", import.meta.url),
            "utf8",
          );
          const currentOwnershipMigration = await readFile(
            new URL("../migrations/078_customer_account_user_licenses.sql", import.meta.url),
            "utf8",
          );
          const admin = new PostgresRepository(isolatedAdminUrl!);
          try {
            await admin.pool.query(migration);
            const frozen = await platform.getRoomCoverage("round", roundId);
            expect(frozen).toMatchObject({
              funding: "legacy",
              reservationState: "none",
              snapshot: {
                plan: "pro",
                maxParticipants: 77,
                csvExport: true,
                reportRetentionDays: 365,
              },
            });
            expect(await platform.getRoomCoverage("presentation", presentation.id)).toMatchObject({
              funding: "legacy",
              snapshot: { plan: "pro", maxParticipants: 100, csvExport: true },
            });
            await repository.setPlan(owner.workspaceId, "free");
            await admin.pool.query(migration);
            expect(await platform.getRoomCoverage("round", roundId)).toEqual(frozen);
            expect((await repository.getSessionById(roundId))?.retentionExpiresAt).toEqual(
              retentionExpiresAt,
            );
            expect(
              (
                await createPresentationSessionRepository(repository).getSessionById(
                  presentation.id,
                )
              )?.retentionExpiresAt,
            ).toEqual(retentionExpiresAt);
            expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0, reserved: 0 });
            expect(await platform.listCreditLedger(org, owner.userId)).toHaveLength(0);
          } finally {
            try {
              // Replaying the historical migration replaces its provisioning trigger.
              // Restore the current ownership model before later tests create users.
              await admin.pool.query(currentOwnershipMigration);
            } finally {
              await admin.close();
            }
          }
        },
      );
      it("authenticates a billing-only principal again without requiring content membership", async () => {
        const billing = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: org,
          actorId: owner.userId,
          userId: billing.userId,
          role: "billing",
        });
        if (repository instanceof MemoryRepository) {
          for (const [key, member] of repository.workspaceMembers)
            if (member.userId === billing.userId) repository.workspaceMembers.delete(key);
        } else {
          const admin = new PostgresRepository(isolatedAdminUrl!);
          await admin.pool.query("DELETE FROM workspace_members WHERE user_id=$1", [
            billing.userId,
          ]);
          await admin.close();
        }
        const tokenHash = randomUUID();
        const now = new Date();
        await repository.createMagicToken({
          id: randomUUID(),
          tokenHash,
          email: billing.email,
          segment: "workplace",
          policyVersion: "test",
          expiresAt: new Date(now.getTime() + 60000),
          consumedAt: null,
        });
        const identities = await Promise.all([
          repository.consumeMagicLinkIdentity(tokenHash, now),
          repository.consumeMagicLinkIdentity(tokenHash, now),
        ]);
        const identity = identities.find((value) => value !== null);
        expect(identities.filter((value) => value !== null)).toHaveLength(1);
        expect(identity).toMatchObject({
          user: { userId: billing.userId, email: billing.email },
          creator: null,
        });
        const sessionToken = randomUUID();
        await repository.createCreatorSession({
          id: randomUUID(),
          userId: billing.userId,
          tokenHash: sessionToken,
          expiresAt: new Date(now.getTime() + 60000),
        });
        expect(await repository.getUserPrincipalBySession(sessionToken, now)).toMatchObject({
          userId: billing.userId,
        });
        expect(await repository.getCreatorBySession(sessionToken, now)).toBeNull();
        expect(await platform.getOrganization(org, billing.userId)).toMatchObject({ id: org });
      });
      it("reserves one shared credit across concurrent workspaces and consumes once", async () => {
        const second = await platform.createOrganizationWorkspace({
          organizationId: org,
          actorId: owner.userId,
          name: "Other team",
          segment: "workplace",
        });
        await platform.grantCredits({
          organizationId: org,
          quantity: 1,
          reason: "test",
          sourceKey: randomUUID(),
          actorId: null,
        });
        const expiresAt = new Date(Date.now() + 60000);
        const results = await Promise.allSettled(
          [owner.workspaceId, second.id].map((workspaceId) =>
            platform.reserveRoomCoverage({
              artifactType: "round",
              roomId: randomUUID(),
              workspaceId,
              funding: "credit",
              snapshot,
              actorId: owner.userId,
              expiresAt,
            }),
          ),
        );
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const winner = results.find((result) => result.status === "fulfilled");
        if (!winner || winner.status !== "fulfilled") throw new Error("Missing reservation");
        expect(await platform.getCreditBalance(org)).toMatchObject({
          balance: 1,
          reserved: 1,
          available: 0,
        });
        await Promise.all([
          platform.consumeRoomCoverage("round", winner.value.roomId),
          platform.consumeRoomCoverage("round", winner.value.roomId),
        ]);
        expect(await platform.getCreditBalance(org)).toMatchObject({
          balance: 0,
          reserved: 0,
          available: 0,
        });
        expect(
          (await platform.listCreditLedger(org, owner.userId)).filter(
            (entry) => entry.delta === -1,
          ),
        ).toHaveLength(1);
        await platform.releaseRoomCoverage("round", winner.value.roomId);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0, reserved: 0 });
      });
      it("releases an empty reservation without debiting and rejects a released-room join", async () => {
        await platform.grantCredits({
          organizationId: org,
          quantity: 2,
          reason: "test",
          sourceKey: randomUUID(),
          actorId: null,
        });
        const room = randomUUID();
        const coverage = {
          artifactType: "presentation" as const,
          roomId: room,
          workspaceId: owner.workspaceId,
          funding: "credit" as const,
          snapshot,
          actorId: owner.userId,
          expiresAt: new Date(Date.now() + 60000),
          creationKey: randomUUID(),
        };
        await platform.reserveRoomCoverage(coverage);
        await platform.reserveRoomCoverage(coverage);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 2, reserved: 1 });
        await Promise.all([
          platform.releaseRoomCoverage("presentation", room),
          platform.releaseRoomCoverage("presentation", room),
        ]);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 2, reserved: 0 });
        await expect(platform.consumeRoomCoverage("presentation", room)).rejects.toMatchObject({
          code: "ROOM_CLOSED",
        });
        await expect(
          platform.reserveRoomCoverage({
            ...coverage,
            snapshot: { ...snapshot, maxParticipants: 99 },
          }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      });
      it("repairs only empty closed parent rooms and keeps orphan or occupied reservations for review", async () => {
        const fixture = await createLibraryDeletionFixture(repository, owner, owner.userId);
        await platform.grantCredits({
          organizationId: org,
          quantity: 4,
          reason: "repair fixture",
          sourceKey: randomUUID(),
          actorId: null,
        });
        const sessions = createPresentationSessionRepository(repository);
        const makeRoom = async (expired: boolean) => {
          const now = new Date();
          const id = randomUUID();
          const expiresAt = new Date(now.getTime() + (expired ? -60000 : 60000));
          await platform.reserveRoomCoverage({
            artifactType: "presentation",
            roomId: id,
            workspaceId: owner.workspaceId,
            funding: "credit",
            snapshot,
            actorId: owner.userId,
            expiresAt: new Date(now.getTime() + 60000),
          });
          return sessions.createSession({
            id,
            workspaceId: owner.workspaceId,
            presentationId: fixture.presentation.id,
            presentationVersionId: fixture.presentationVersion.id,
            title: fixture.presentationContent.title,
            content: fixture.presentationContent,
            code: String(randomInt(1000000, 10000000)),
            status: "active",
            phase: "lobby",
            currentBlockIndex: -1,
            revision: 0,
            createdBy: owner.userId,
            createdAt: now,
            updatedAt: now,
            finishedAt: null,
            liveExpiresAt: expiresAt,
            retentionExpiresAt: new Date(now.getTime() + 86400000),
          });
        };
        const active = await makeRoom(false);
        expect(
          (await platform.releaseExpiredRoomReservation("presentation", active.id))
            ?.reservationState,
        ).toBe("reserved");
        const empty = await makeRoom(true);
        await Promise.all([
          platform.releaseExpiredRoomReservation("presentation", empty.id),
          platform.releaseExpiredRoomReservation("presentation", empty.id),
        ]);
        expect((await platform.getRoomCoverage("presentation", empty.id))?.reservationState).toBe(
          "released",
        );
        const occupied = await makeRoom(true);
        const now = new Date();
        // Simulate retained pre-consumption audience evidence; repair must not refund it.
        await sessions.addParticipant({
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          sessionId: occupied.id,
          nickname: "Retained audience",
          tokenHash: randomUUID().replaceAll("-", "").repeat(2),
          joinedAt: now,
          lastSeenAt: now,
        });
        expect(
          (await platform.releaseExpiredRoomReservation("presentation", occupied.id))
            ?.reservationState,
        ).toBe("reserved");
        const orphan = randomUUID();
        await platform.reserveRoomCoverage({
          artifactType: "round",
          roomId: orphan,
          workspaceId: owner.workspaceId,
          funding: "credit",
          snapshot,
          actorId: owner.userId,
          expiresAt: new Date(Date.now() + 60000),
        });
        expect(
          (await platform.releaseExpiredRoomReservation("round", orphan))?.reservationState,
        ).toBe("reserved");
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 4, reserved: 3 });
        expect(
          (await platform.listCreditLedger(org, owner.userId)).filter((entry) => entry.delta < 0),
        ).toHaveLength(0);
      });
      it("commits real Round admission and credit consumption together and rolls back a losing parent version", async () => {
        const fixture = await createLibraryDeletionFixture(repository, owner, owner.userId);
        await platform.grantCredits({
          organizationId: org,
          quantity: 1,
          reason: "atomic admission fixture",
          sourceKey: randomUUID(),
          actorId: null,
        });
        const now = new Date();
        const id = randomUUID();
        const expiresAt = new Date(now.getTime() + 60000);
        const state = createGameState({
          sessionId: id,
          code: String(randomInt(1000000, 10000000)),
          quiz: fixture.content,
          settings: {
            audienceLimit: 100,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
            trustMode: "learning",
          },
        });
        await repository.createSession({
          id,
          workspaceId: owner.workspaceId,
          quizVersionId: fixture.roundVersion.id,
          hostId: owner.userId,
          hostTokenHash: randomUUID(),
          state,
          expiresAt,
          retentionExpiresAt: new Date(now.getTime() + 365 * 86400000),
          createdAt: now,
          updatedAt: now,
          commercialCoverage: {
            artifactType: "round",
            roomId: id,
            workspaceId: owner.workspaceId,
            funding: "credit",
            snapshot,
            actorId: owner.userId,
            expiresAt,
          },
        });
        const stored = (await repository.getSessionById(id))!;
        expect((await platform.getRoomCoverage("round", id))?.reservationState).toBe("reserved");
        const participantId = randomUUID();
        const participant = {
          id: participantId,
          sessionId: id,
          nickname: "First paid audience",
          tokenHash: randomUUID(),
          status: "active" as const,
          joinedAt: now,
        };
        const next = {
          ...stored,
          state: addParticipant(stored.state, {
            id: participantId,
            nickname: participant.nickname,
            score: 0,
            correctCount: 0,
            acceptedResponseMs: 0,
            connected: true,
            kicked: false,
          }).state,
        };
        await expect(
          repository.commitParticipants(next, [participant], stored.state.version + 1),
        ).rejects.toThrow();
        expect(await repository.getParticipants(id)).toHaveLength(0);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 1, reserved: 1 });
        // Pausing new launches must preserve existing room admission and its frozen terms.
        await platform.updateWorkspaceStatus(owner.workspaceId, "suspended");
        await repository.commitParticipants(next, [participant], stored.state.version);
        expect(await repository.getParticipants(id)).toHaveLength(1);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0, reserved: 0 });
        expect((await platform.getRoomCoverage("round", id))?.reservationState).toBe("consumed");
        expect(
          (await platform.listCreditLedger(org, owner.userId)).filter(
            (entry) => entry.delta === -1,
          ),
        ).toHaveLength(1);
      });
      it("creates a real Presentation with credit coverage and consumes only after durable authorized admission", async () => {
        const fixture = await createLibraryDeletionFixture(repository, owner, owner.userId);
        await platform.grantCredits({
          organizationId: org,
          quantity: 1,
          reason: "presentation admission fixture",
          sourceKey: randomUUID(),
          actorId: null,
        });
        const now = new Date();
        const id = randomUUID();
        const expiresAt = new Date(now.getTime() + 60000);
        const sessions = createPresentationSessionRepository(repository);
        await sessions.createSessionWithCredential(
          {
            id,
            workspaceId: owner.workspaceId,
            presentationId: fixture.presentation.id,
            presentationVersionId: fixture.presentationVersion.id,
            title: fixture.presentationContent.title,
            content: fixture.presentationContent,
            code: String(randomInt(1000000, 10000000)),
            status: "active",
            phase: "lobby",
            currentBlockIndex: -1,
            revision: 0,
            createdBy: owner.userId,
            createdAt: now,
            updatedAt: now,
            finishedAt: null,
            liveExpiresAt: expiresAt,
            retentionExpiresAt: new Date(now.getTime() + 365 * 86400000),
            commercialCoverage: {
              artifactType: "presentation",
              roomId: id,
              workspaceId: owner.workspaceId,
              funding: "credit",
              snapshot,
              actorId: owner.userId,
              expiresAt,
            },
          },
          {
            id: randomUUID(),
            workspaceId: owner.workspaceId,
            sessionId: id,
            role: "host",
            tokenHash: randomUUID().replaceAll("-", "").repeat(2),
            createdAt: now,
            expiresAt,
            revokedAt: null,
          },
        );
        expect((await platform.getRoomCoverage("presentation", id))?.reservationState).toBe(
          "reserved",
        );
        const participant = {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          sessionId: id,
          nickname: "First paid audience",
          tokenHash: randomUUID().replaceAll("-", "").repeat(2),
          joinedAt: now,
          lastSeenAt: now,
        };
        await platform.setWorkspaceAdmissionRestriction(owner.workspaceId, true);
        await expect(sessions.joinParticipantWithinLimit(participant, 100)).rejects.toMatchObject({
          code: "ADMISSION_RESTRICTED",
        });
        expect(await sessions.listParticipants(id)).toHaveLength(0);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 1, reserved: 1 });
        await platform.setWorkspaceAdmissionRestriction(owner.workspaceId, false);
        expect((await sessions.joinParticipantWithinLimit(participant, 100)).status).toBe(
          "accepted",
        );
        expect(await sessions.listParticipants(id)).toHaveLength(1);
        expect((await platform.getRoomCoverage("presentation", id))?.reservationState).toBe(
          "consumed",
        );
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0, reserved: 0 });
      });
      it("rolls back operator effect, receipt, audit, and outbox together", async () => {
        const key = randomUUID();
        await expect(
          platform.withOperatorTransaction(async (scoped) => {
            const command = await scoped.beginCommand({
              actorId: "operator-test",
              idempotencyKey: key,
              requestHash: "digest",
            });
            await scoped.grantCredits({
              organizationId: org,
              quantity: 5,
              reason: "support correction",
              sourceKey: key,
              actorId: "operator-test",
            });
            await scoped.enqueueIntegrationJob({
              integration: "test",
              organizationId: org,
              eventType: "test",
              deduplicationKey: key,
              payload: {},
            });
            await scoped.appendAuditEvent({
              actorId: "operator-test",
              organizationId: org,
              action: "test",
              targetId: org,
              reason: "test",
              requestId: key,
              before: null,
              after: { credits: 5 },
            });
            await scoped.completeCommand(command.receipt.id, { credits: 5 });
            throw new Error("Injected failure before commit");
          }),
        ).rejects.toThrow("Injected failure");
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0, reserved: 0 });
        expect(await platform.listCreditLedger(org, owner.userId)).toEqual([]);
        expect(
          (await platform.listIntegrationJobs("test")).some((job) => job.deduplicationKey === key),
        ).toBe(false);
        expect((await platform.listAuditEvents(org)).some((event) => event.requestId === key)).toBe(
          false,
        );
        const command = await platform.beginCommand({
          actorId: "operator-test",
          idempotencyKey: key,
          requestHash: "digest",
        });
        expect(command.created).toBe(true);
        await expect(
          platform.beginCommand({
            actorId: "operator-test",
            idempotencyKey: key,
            requestHash: "different",
          }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      });
      it("limits paid licenses, honors grace, and derives product plan from the assignment", async () => {
        await platform.applySubscriptionSnapshot({
          organizationId: org,
          customerId: `cus_${randomUUID()}`,
          subscriptionId: `sub_${randomUUID()}`,
          status: "active",
          licenseQuantity: 1,
          offerId: null,
          paidThrough: new Date(Date.now() + 60000),
          graceUntil: null,
        });
        await platform.assignWorkspaceLicense(org, owner.userId, owner.workspaceId, true);
        const second = await platform.createOrganizationWorkspace({
          organizationId: org,
          actorId: owner.userId,
          name: "Another",
          segment: "workplace",
        });
        await expect(
          platform.assignWorkspaceLicense(org, owner.userId, second.id, true),
        ).rejects.toMatchObject({ code: "LICENSE_LIMIT" });
        expect(await repository.getPlan(owner.workspaceId)).toBe("pro");
        expect(await repository.getPlan(second.id)).toBe("free");
        const subscription = await platform.getSubscription(org);
        await platform.applySubscriptionSnapshot({
          ...subscription,
          status: "past_due",
          paidThrough: new Date(Date.now() - 1000),
          graceUntil: new Date(Date.now() + 60000),
        });
        expect(await platform.workspaceHasLicense(owner.workspaceId)).toBe(true);
        await platform.applySubscriptionSnapshot({
          ...subscription,
          status: "past_due",
          paidThrough: new Date(Date.now() - 1000),
          graceUntil: new Date(Date.now() - 1000),
        });
        expect(await platform.workspaceHasLicense(owner.workspaceId)).toBe(false);
        expect(await repository.getPlan(owner.workspaceId)).toBe("free");
      });
      it("freezes purchase offer terms and grants credits once per payment", async () => {
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Five events",
          productKey: "pollingpops",
          kind: "credit_pack",
          status: "published",
          version: 1,
          stripePriceId: `price_${randomUUID()}`,
          currency: "usd",
          amountMinor: 1000,
          interval: null,
          creditQuantity: 5,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        const key = randomUUID();
        const purchase = await platform.createPurchase({
          organizationId: org,
          actorId: owner.userId,
          offerId: offer.id,
          quantity: 2,
          idempotencyKey: key,
        });
        await expect(
          platform.createPurchase({
            organizationId: org,
            actorId: owner.userId,
            offerId: offer.id,
            quantity: 3,
            idempotencyKey: key,
          }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await platform.saveOffer({ ...offer, version: 2, creditQuantity: 7 });
        await platform.updatePurchaseCheckout(purchase.id, `cs_${randomUUID()}`);
        const payment = `pi_${randomUUID()}`;
        await Promise.all([
          platform.fulfillCreditPurchase(purchase.id, payment),
          platform.fulfillCreditPurchase(purchase.id, payment),
        ]);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 10, available: 10 });
        expect(
          (await platform.listCreditLedger(org, owner.userId)).filter(
            (entry) => entry.sourceKey === `purchase:${purchase.id}`,
          ),
        ).toHaveLength(1);
      });
      it("rejects purchases whose prepaid credits or monetary total cannot be fulfilled safely", async () => {
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Bounded pack",
          productKey: "pollingpops",
          kind: "credit_pack",
          status: "published",
          version: 1,
          stripePriceId: randomUUID(),
          currency: "usd",
          amountMinor: 1000,
          interval: null,
          creditQuantity: 100000,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        await expect(
          platform.createPurchase({
            organizationId: org,
            actorId: owner.userId,
            offerId: offer.id,
            quantity: 11,
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        await platform.saveOffer({
          ...offer,
          version: 2,
          creditQuantity: 1,
          amountMinor: Number.MAX_SAFE_INTEGER,
        });
        await expect(
          platform.createPurchase({
            organizationId: org,
            actorId: owner.userId,
            offerId: offer.id,
            quantity: 2,
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(await platform.listPurchases(org, owner.userId)).toHaveLength(0);
      });
      it("projects answer-free active rooms and atomically retries only failed product and billing work", async () => {
        const fixture = await createLibraryDeletionFixture(repository, owner, owner.userId);
        const now = new Date();
        const id = randomUUID();
        const expiresAt = new Date(now.getTime() + 60000);
        const state = createGameState({
          sessionId: id,
          code: String(randomInt(1000000, 10000000)),
          quiz: fixture.content,
          settings: {
            audienceLimit: 100,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
            trustMode: "learning",
          },
        });
        await repository.createSession({
          id,
          workspaceId: owner.workspaceId,
          quizVersionId: fixture.roundVersion.id,
          hostId: owner.userId,
          hostTokenHash: randomUUID(),
          state,
          expiresAt,
          retentionExpiresAt: new Date(now.getTime() + 86400000),
          createdAt: now,
          updatedAt: now,
          commercialCoverage: {
            artifactType: "round",
            roomId: id,
            workspaceId: owner.workspaceId,
            funding: "legacy",
            snapshot,
            actorId: owner.userId,
            expiresAt,
          },
        });
        const participantId = randomUUID();
        const stored = (await repository.getSessionById(id))!;
        await repository.commitParticipants(
          {
            ...stored,
            state: addParticipant(state, {
              id: participantId,
              nickname: "Private audience name",
              score: 0,
              correctCount: 0,
              acceptedResponseMs: 0,
              connected: true,
              kicked: false,
            }).state,
          },
          [
            {
              id: participantId,
              sessionId: id,
              nickname: "Private audience name",
              tokenHash: randomUUID(),
              status: "active",
              joinedAt: now,
            },
          ],
          state.version,
        );
        const room = (await platform.listActiveRooms(org)).find((room) => room.roomId === id)!;
        expect(room).toMatchObject({
          organizationId: org,
          workspaceId: owner.workspaceId,
          artifactType: "round",
          participantCount: 1,
          funding: "legacy",
        });
        expect(JSON.stringify(room)).not.toContain("Private audience name");
        expect(JSON.stringify(room)).not.toContain("correctValue");
        expect(await platform.listActiveRooms(randomUUID())).toHaveLength(0);
        const report: Report = {
          id: randomUUID(),
          sessionId: id,
          schemaVersion: 1,
          trustMode: "learning",
          timeMode: "timed",
          status: "failed",
          generatedAt: null,
          expiresAt: new Date(now.getTime() + 86400000).toISOString(),
          metrics: { participantCount: 1, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
          questions: [],
          participants: [],
        };
        await repository.saveReport(owner.workspaceId, report);
        const sessions = createPresentationSessionRepository(repository);
        const presentation = await sessions.createSession({
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          presentationId: fixture.presentation.id,
          presentationVersionId: fixture.presentationVersion.id,
          title: fixture.presentationContent.title,
          content: fixture.presentationContent,
          code: String(randomInt(1000000, 10000000)),
          status: "finished",
          phase: "finished",
          currentBlockIndex: -1,
          revision: 0,
          createdBy: owner.userId,
          createdAt: now,
          updatedAt: now,
          finishedAt: new Date(0),
          liveExpiresAt: expiresAt,
          retentionExpiresAt: new Date(now.getTime() + 86400000),
        });
        const presentationJob = (await sessions.claimReportJob(
          now,
          new Date(now.getTime() + 60000),
        ))!;
        expect(presentationJob.sessionId).toBe(presentation.id);
        await sessions.retryReportJob(presentationJob, "terminal fixture failure", now, true);
        const authoring = {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          createdBy: owner.userId,
          sourceType: "pasted_text" as const,
          sourceName: "Operational fixture",
          sourceMimeType: null,
          sourceText: "Retained source",
          sourceBlob: null,
          sourceDigest: "c".repeat(64),
          status: "failed" as const,
          attempts: 3,
          appliedQuizId: null,
          availableAt: now,
          output: null,
          lastError: "failure",
          expiresAt: new Date(now.getTime() + 86400000),
          createdAt: now,
          updatedAt: now,
        };
        await repository.createAuthoringJob(authoring);
        const purged = { ...authoring, id: randomUUID(), sourceText: null };
        await repository.createAuthoringJob(purged);
        const health = await platform.getProductQueueHealth(new Date(now.getTime() + 60000));
        expect(health.find((queue) => queue.kind === "round-report")?.failedIds).toContain(
          report.id,
        );
        expect(
          health.find((queue) => queue.kind === "presentation-report")?.retryableFailedIds,
        ).toContain(presentationJob.reportId);
        expect(health.find((queue) => queue.kind === "authoring")?.retryableFailedIds).toContain(
          authoring.id,
        );
        expect(
          health.find((queue) => queue.kind === "authoring")?.retryableFailedIds,
        ).not.toContain(purged.id);
        const eventId = randomUUID();
        await platform.enqueueBillingEvent({
          providerEventId: eventId,
          eventType: "test.retry",
          payload: {},
          providerCreatedAt: now,
        });
        const billingJob = (await platform.claimBillingEvent(
          1000,
          new Date(now.getTime() + 1000),
        ))!;
        expect(billingJob.id).toBe(eventId);
        // Ten token-fenced failures exhaust automatic retries without losing inbox evidence.
        let billing = billingJob;
        for (let attempt = 0; attempt < 10; attempt++) {
          const attemptAt = new Date(now.getTime() + attempt * 3700000);
          await platform.failBillingEvent(billing.id, billing.leaseToken!, "fixture", attemptAt);
          if (attempt < 9)
            billing = (await platform.claimBillingEvent(
              1000,
              new Date(attemptAt.getTime() + 3700000),
            ))!;
        }
        const before = (await platform.listBillingEvents()).find((row) => row.id === eventId)!;
        expect(before.state).toBe("failed");
        await expect(
          platform.withOperatorTransaction(async (tx) => {
            expect(await tx.retryFailedProductJob("round-report", report.id)).toBe(true);
            expect(
              await tx.retryFailedProductJob("presentation-report", presentationJob.reportId),
            ).toBe(true);
            expect(await tx.retryFailedProductJob("authoring", authoring.id)).toBe(true);
            expect(await tx.retryBillingEvent(eventId)).toBe(true);
            throw new Error("rollback operational retry");
          }),
        ).rejects.toThrow("rollback operational retry");
        expect((await repository.getReport(owner.workspaceId, report.id))?.status).toBe("failed");
        expect((await sessions.getReport(owner.workspaceId, presentation.id))?.status).toBe(
          "failed",
        );
        expect((await repository.getAuthoringJob(owner.workspaceId, authoring.id))?.status).toBe(
          "failed",
        );
        expect((await platform.listBillingEvents()).find((row) => row.id === eventId)?.state).toBe(
          "failed",
        );
        expect(await platform.retryFailedProductJob("round-report", report.id)).toBe(true);
        expect(await platform.retryFailedProductJob("round-report", report.id)).toBe(false);
        expect(
          await platform.retryFailedProductJob("presentation-report", presentationJob.reportId),
        ).toBe(true);
        expect(await platform.retryFailedProductJob("authoring", authoring.id)).toBe(true);
        expect(await platform.retryFailedProductJob("authoring", purged.id)).toBe(false);
        expect(await platform.retryBillingEvent(eventId)).toBe(true);
        expect(await platform.retryBillingEvent(eventId)).toBe(false);
        expect(
          (await platform.listBillingEvents()).find((row) => row.id === eventId)?.attempts,
        ).toBe(before.attempts);
      });
      it("accepts an organization invitation only for the verified matching email", async () => {
        const invited = await creator(repository);
        const other = await creator(repository);
        const tokenHash = randomUUID();
        await platform.createOrganizationInvitation({
          organizationId: org,
          actorId: owner.userId,
          email: invited.email,
          role: "billing",
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
        });
        await expect(
          platform.acceptOrganizationInvitation({
            tokenHash,
            actorId: other.userId,
            userEmail: invited.email,
          }),
        ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
        const membership = await platform.acceptOrganizationInvitation({
          tokenHash,
          actorId: invited.userId,
        });
        expect(membership.role).toBe("billing");
        expect(
          (await repository.listWorkspaces(invited.userId)).some(
            (workspace) => workspace.id === owner.workspaceId,
          ),
        ).toBe(false);
        await expect(
          platform.acceptOrganizationInvitation({ tokenHash, actorId: invited.userId }),
        ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
      });
      it("serializes promotion global limits and makes redemption idempotent per organization", async () => {
        const promotion = {
          id: randomUUID(),
          codeHash: randomUUID(),
          name: "Launch",
          kind: "credits" as const,
          creditQuantity: 3,
          stripePromotionCodeId: null,
          organizationId: null,
          maximumRedemptions: 1,
          expiresAt: null,
          active: true,
          createdAt: new Date(),
        };
        await platform.savePromotion(promotion);
        const first = await platform.redeemPromotion({
          organizationId: org,
          actorId: owner.userId,
          codeHash: promotion.codeHash,
          idempotencyKey: randomUUID(),
        });
        const again = await platform.redeemPromotion({
          organizationId: org,
          actorId: owner.userId,
          codeHash: promotion.codeHash,
          idempotencyKey: randomUUID(),
        });
        expect(again.id).toBe(first.id);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 3 });
        const other = await creator(repository);
        const otherOrg = (await platform.getOrganizationForWorkspace(other.workspaceId))!.id;
        await expect(
          platform.redeemPromotion({
            organizationId: otherOrg,
            actorId: other.userId,
            codeHash: promotion.codeHash,
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "INVALID_PROMOTION" });
      });
      it("persists private credentials and atomically consumes authenticator replay counters with sessions and audit", async () => {
        const username = `admin-${randomUUID()}`;
        const operator = await platform.provisionOperator({
          issuer: "urn:pollingpops:password-totp",
          subject: username,
          name: "Conformance administrator",
          role: "support",
          capabilities: [],
          active: true,
        });
        const now = new Date();
        const credential = await platform.saveOperatorPasswordCredential(
          {
            username,
            operatorId: operator.id,
            passwordVerifier: {
              algorithm: "scrypt",
              salt: "synthetic-salt",
              hash: "synthetic-verifier",
              cost: 32768,
              blockSize: 8,
              parallelization: 3,
            },
            totpCiphertext: "synthetic-encrypted-credential",
            lastUsedCounter: null,
            updatedAt: now,
          },
          null,
        );
        const reader = createPlatformRepository(repository);
        expect(await reader.getOperatorPasswordCredential(username)).toEqual(credential);
        expect(await reader.getOperator(operator.id)).not.toHaveProperty("passwordVerifier");
        await expect(reader.saveOperatorPasswordCredential(credential, null)).rejects.toMatchObject(
          { code: "CONFLICT" },
        );
        const tokens = [randomUUID(), randomUUID()];
        const attempts = await Promise.allSettled(
          tokens.map((token, index) =>
            (index ? reader : platform).withOperatorTransaction(async (scoped) => {
              if (!(await scoped.consumeOperatorTotp(username, credential.revision, 321, now)))
                throw new Error("replayed authenticator");
              await scoped.createOperatorSession({
                id: randomUUID(),
                operatorId: operator.id,
                tokenHash: token,
                csrfHash: "synthetic-csrf-hash",
                authenticatedAt: now,
                lastSeenAt: now,
                createdAt: now,
                expiresAt: new Date(now.getTime() + 60_000),
                revokedAt: null,
              });
              await scoped.appendAuditEvent({
                actorId: operator.id,
                organizationId: null,
                action: "operator.login",
                targetId: operator.id,
                reason: "Conformance two-factor authentication",
                requestId: token,
                before: null,
                after: { authMode: "password" },
              });
            }),
          ),
        );
        expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
        expect(
          (await Promise.all(tokens.map((token) => reader.getOperatorSession(token, now)))).filter(
            Boolean,
          ),
        ).toHaveLength(1);
        expect(
          (await reader.listAuditEvents()).filter((event) => event.targetId === operator.id),
        ).toHaveLength(1);
        expect((await reader.getOperatorPasswordCredential(username))?.lastUsedCounter).toBe(321);
        expect(await reader.consumeOperatorTotp(username, credential.revision, 320, now)).toBe(
          false,
        );
        await expect(
          platform.withOperatorTransaction(async (scoped) => {
            expect(await scoped.consumeOperatorTotp(username, credential.revision, 322, now)).toBe(
              true,
            );
            throw new Error("audit persistence failed");
          }),
        ).rejects.toThrow("audit persistence failed");
        expect(await reader.consumeOperatorTotp(username, credential.revision, 322, now)).toBe(
          true,
        );
        const replacement = await reader.saveOperatorPasswordCredential(
          { ...credential, lastUsedCounter: null },
          credential.revision,
        );
        expect(replacement.revision).toBe(credential.revision + 1);
        expect(await reader.consumeOperatorTotp(username, credential.revision, 323, now)).toBe(
          false,
        );
        if (backend === "postgres") {
          const client = await (repository as PostgresRepository).pool.connect();
          try {
            const exposed = await client.query(
              "SELECT data FROM platform_records WHERE kind='operator_credential' AND id=$1",
              [username],
            );
            expect(exposed.rows).toHaveLength(0);
          } finally {
            client.release();
          }
        }
      });
      it("preserves the final active founder independently for every authentication issuer", async () => {
        const suffix = randomUUID();
        const create = (issuer: string, subject: string) =>
          platform.provisionOperator({
            issuer,
            subject,
            name: "Founder isolation conformance",
            role: "founder",
            capabilities: [],
            active: true,
          });
        await create("urn:pollingpops:local-development", `legacy-${suffix}`);
        const passwordFounder = await create("urn:pollingpops:password-totp", `admin-${suffix}`);
        await expect(
          platform.provisionOperator({ ...passwordFounder, role: "readonly" }),
        ).rejects.toMatchObject({ code: "LAST_FOUNDER" });
        await expect(
          platform.provisionOperator({ ...passwordFounder, active: false }),
        ).rejects.toMatchObject({ code: "LAST_FOUNDER" });
        const replacement = await create(passwordFounder.issuer, `other-${suffix}`);
        await expect(
          platform.provisionOperator({ ...passwordFounder, role: "readonly" }),
        ).rejects.toMatchObject({ code: "LAST_FOUNDER" });
        await platform.saveOperatorPasswordCredential(
          {
            username: replacement.subject,
            operatorId: replacement.id,
            passwordVerifier: {
              algorithm: "scrypt",
              salt: "synthetic-salt",
              hash: "synthetic-verifier",
              cost: 32768,
              blockSize: 8,
              parallelization: 3,
            },
            totpCiphertext: "synthetic-encrypted-credential",
            lastUsedCounter: null,
            updatedAt: new Date(),
          },
          null,
        );
        expect(
          await platform.provisionOperator({ ...passwordFounder, role: "readonly" }),
        ).toMatchObject({ role: "readonly" });
        await platform.provisionOperator(passwordFounder);
        const writes = await Promise.allSettled(
          [passwordFounder, replacement].map((operator) =>
            platform.provisionOperator({ ...operator, active: false }),
          ),
        );
        expect(writes.filter((write) => write.status === "fulfilled")).toHaveLength(1);
        expect(writes.filter((write) => write.status === "rejected")).toEqual([
          expect.objectContaining({ reason: expect.objectContaining({ code: "LAST_FOUNDER" }) }),
        ]);
        const oidc = await create(`https://identity-${suffix}.example.test`, "old-founder");
        await create(`https://new-identity-${suffix}.example.test`, "new-founder");
        await expect(platform.provisionOperator({ ...oidc, active: false })).rejects.toMatchObject({
          code: "LAST_FOUNDER",
        });
        await create(oidc.issuer, "same-issuer-replacement");
        expect(await platform.provisionOperator({ ...oidc, active: false })).toMatchObject({
          active: false,
        });
      });
      it("serializes durable operator attempt budgets across repository instances and releases expired lockouts", async () => {
        const key = randomUUID().replaceAll("-", "").repeat(2);
        const now = new Date();
        const reader = createPlatformRepository(repository);
        const results = await Promise.all(
          Array.from({ length: 9 }, (_, index) =>
            (index % 2 ? platform : reader).recordOperatorPasswordAttempt(key, now),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(5);
        expect(
          await reader.recordOperatorPasswordAttempt(
            key,
            new Date(now.getTime() + 15 * 60_000 - 1),
          ),
        ).toBe(false);
        expect(
          await reader.recordOperatorPasswordAttempt(
            key,
            new Date(now.getTime() + 15 * 60_000 + 1),
          ),
        ).toBe(true);
        await expect(
          reader.recordOperatorPasswordAttempt("invalid-key", now),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      });
      it("clears only the selected operator attempt budget and serializes concurrent reservations", async () => {
        const key = randomUUID().replaceAll("-", "").repeat(2);
        const otherKey = randomUUID().replaceAll("-", "").repeat(2);
        const globalKey = randomUUID().replaceAll("-", "").repeat(2);
        const now = new Date();
        const reader = createPlatformRepository(repository);
        for (const bucket of [key, otherKey, globalKey])
          for (let index = 0; index < 5; index++)
            expect(await platform.recordOperatorPasswordAttempt(bucket, now)).toBe(true);

        await expect(reader.clearOperatorPasswordAttempts("invalid-key")).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        await reader.clearOperatorPasswordAttempts(key);
        // Clearing a missing bucket is safe and does not affect any other username/global key.
        await reader.clearOperatorPasswordAttempts(key);
        const reservations = await Promise.all(
          Array.from({ length: 9 }, (_, index) =>
            (index % 2 ? platform : reader).recordOperatorPasswordAttempt(key, now),
          ),
        );
        expect(reservations.filter(Boolean)).toHaveLength(5);
        for (const bucket of [key, otherKey, globalKey])
          expect(await reader.recordOperatorPasswordAttempt(bucket, now)).toBe(false);
      });
      it("rolls an operator attempt budget clear back with its enclosing transaction", async () => {
        const key = randomUUID().replaceAll("-", "").repeat(2);
        const now = new Date();
        const reader = createPlatformRepository(repository);
        for (let index = 0; index < 5; index++)
          expect(await platform.recordOperatorPasswordAttempt(key, now)).toBe(true);
        await expect(
          platform.withOperatorTransaction(async (scoped) => {
            await scoped.clearOperatorPasswordAttempts(key);
            expect(await scoped.recordOperatorPasswordAttempt(key, now)).toBe(true);
            throw new Error("operator audit failed");
          }),
        ).rejects.toThrow("operator audit failed");
        expect(await reader.recordOperatorPasswordAttempt(key, now)).toBe(false);

        await platform.withOperatorTransaction(async (scoped) => {
          await scoped.clearOperatorPasswordAttempts(key);
        });
        expect(await reader.recordOperatorPasswordAttempt(key, now)).toBe(true);
      });
      it("binds and consumes OIDC state once and revokes sessions when operator privileges change", async () => {
        const identity = await platform.provisionOperator({
          issuer: "https://identity.example.test",
          subject: randomUUID(),
          name: "Support",
          role: "support",
          capabilities: ["organization.read"],
          active: true,
        });
        const now = new Date();
        const token = randomUUID();
        await platform.createOperatorSession({
          id: randomUUID(),
          operatorId: identity.id,
          tokenHash: token,
          expiresAt: new Date(now.getTime() + 60000),
          revokedAt: null,
          createdAt: now,
          lastSeenAt: now,
        });
        const state = randomUUID();
        await platform.createOperatorOidcTransaction({
          stateHash: state,
          browserBindingHash: "browser",
          codeVerifier: "verifier",
          nonce: "nonce",
          expiresAt: new Date(now.getTime() + 60000),
          consumedAt: null,
          returnTo: "/",
        });
        expect(await platform.consumeOperatorOidcTransaction(state, "wrong")).toBeNull();
        expect(await platform.consumeOperatorOidcTransaction(state, "browser")).not.toBeNull();
        expect(await platform.consumeOperatorOidcTransaction(state, "browser")).toBeNull();
        expect(
          await platform.touchOperatorSession(token, now, new Date(now.getTime() - 60000)),
        ).not.toBeNull();
        await platform.provisionOperator({
          ...identity,
          role: "billing",
          capabilities: ["billing.read"],
        });
        expect(await platform.getOperatorSession(token)).toBeNull();
      });
      it("deduplicates billing inbox events and fences stale worker leases", async () => {
        const id = `evt_${randomUUID()}`;
        const now = new Date();
        const input = {
          providerEventId: id,
          eventType: "test",
          payload: { organizationId: org },
          providerCreatedAt: now,
        };
        expect(await platform.enqueueBillingEvent(input)).toBe(true);
        expect(await platform.enqueueBillingEvent(input)).toBe(false);
        // Other PostgreSQL conformance fixtures may leave completed records; claims remain globally ordered.
        let first = await platform.claimBillingEvent(1000, new Date(now.getTime() + 10));
        while (first && first.id !== id) {
          await platform.completeBillingEvent(
            first.id,
            first.leaseToken!,
            new Date(now.getTime() + 20),
          );
          first = await platform.claimBillingEvent(1000, new Date(now.getTime() + 30));
        }
        expect(first?.id).toBe(id);
        const second = await platform.claimBillingEvent(1000, new Date(now.getTime() + 2000));
        expect(second?.id).toBe(id);
        expect(second?.leaseToken).not.toBe(first?.leaseToken);
        expect(
          await platform.completeBillingEvent(
            id,
            first!.leaseToken!,
            new Date(now.getTime() + 2100),
          ),
        ).toBe(false);
        expect(
          await platform.completeBillingEvent(
            id,
            second!.leaseToken!,
            new Date(now.getTime() + 2100),
          ),
        ).toBe(true);
      });
      it("quarantines an external delivery after an expired lease rather than duplicating its effect", async () => {
        const integration = randomUUID();
        const now = new Date();
        const job = await platform.enqueueIntegrationJob({
          integration,
          organizationId: org,
          eventType: "support",
          deduplicationKey: randomUUID(),
          payload: { safe: true },
        });
        const claimed = await platform.claimIntegrationJob(
          integration,
          1000,
          new Date(now.getTime() + 10),
        );
        expect(claimed?.id).toBe(job.id);
        expect(
          await platform.claimIntegrationJob(integration, 1000, new Date(now.getTime() + 2000)),
        ).toBeNull();
        expect((await platform.listIntegrationJobs(integration))[0]?.state).toBe("ambiguous");
        expect(
          await platform.completeIntegrationJob(
            job.id,
            claimed!.leaseToken!,
            "external-id",
            new Date(now.getTime() + 2100),
          ),
        ).toBe(false);
        await platform.retryIntegrationJob(job.id);
        const replay = await platform.claimIntegrationJob(integration);
        expect(replay?.id).toBe(job.id);
        expect(
          await platform.completeIntegrationJob(
            job.id,
            replay!.leaseToken!,
            "external-id",
            new Date(),
            { verified: true },
          ),
        ).toBe(true);
        expect((await platform.listIntegrationJobs(integration))[0]?.result).toEqual({
          verified: true,
        });
      });
      it("deletes a personal sign-in without requiring closure of its automatic personal boundary", async () => {
        await repository.setPlan(owner.workspaceId, "team");
        expect(await platform.getOrganizationForWorkspace(owner.workspaceId)).toMatchObject({
          accountType: "personal",
        });
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).resolves.toBeUndefined();
        const tokenHash = randomUUID();
        await repository.createCreatorSession({
          id: randomUUID(),
          userId: owner.userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
          activeWorkspaceId: owner.workspaceId,
        });
        await repository.deleteUserIdentity(owner.userId);
        expect(await repository.getUserPrincipalById(owner.userId)).toBeNull();
        expect(await repository.getUserPrincipalBySession(tokenHash, new Date())).toBeNull();
        expect(await platform.listOrganizations(owner.userId)).toEqual([]);
        // Hosted identity deletion intentionally retains workspace data; its deletion
        // policy is separate from organization ownership-transfer protection.
        expect(await platform.getOrganizationForWorkspace(owner.workspaceId)).toMatchObject({
          accountType: "personal",
        });
      });

      it("requires completed cancellation before deleting a personal payer even after paid access expires", async () => {
        const external = {
          organizationId: org,
          customerId: `cus_${randomUUID()}`,
          subscriptionId: `sub_${randomUUID()}`,
          licenseQuantity: 1,
          offerId: null,
          paidThrough: new Date(Date.now() - 60000),
          graceUntil: null,
        };
        for (const status of [
          "active",
          "trialing",
          "past_due",
          "unpaid",
          "incomplete",
          "paused",
          "free",
        ]) {
          await platform.applySubscriptionSnapshot({ ...external, status });
          await expect(platform.assertIdentityDeletionAllowed(owner.userId)).rejects.toMatchObject({
            code: "BILLING_CANCELLATION_REQUIRED",
          });
          await expect(repository.deleteUserIdentity(owner.userId)).rejects.toMatchObject({
            code: "BILLING_CANCELLATION_REQUIRED",
          });
          expect(await repository.getUserPrincipalById(owner.userId)).not.toBeNull();
        }
        await platform.applySubscriptionSnapshot({ ...external, status: "incomplete_expired" });
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).resolves.toBeUndefined();
        await platform.applySubscriptionSnapshot({ ...external, status: "canceled" });
        await repository.deleteUserIdentity(owner.userId);
        expect(await repository.getUserPrincipalById(owner.userId)).toBeNull();
        expect(await platform.getSubscription(org)).toMatchObject({
          status: "canceled",
          subscriptionId: external.subscriptionId,
        });
      });

      it("uses current legacy cancellation state until an authoritative business snapshot supersedes it", async () => {
        const subscriptionId = `sub_legacy_${randomUUID()}`;
        const customerId = `cus_legacy_${randomUUID()}`;
        await repository.setPlan(owner.workspaceId, "pro", {
          customerId,
          subscriptionId,
          status: "active",
        });
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).rejects.toMatchObject({
          code: "BILLING_CANCELLATION_REQUIRED",
        });
        const imported = {
          ...(await platform.applySubscriptionSnapshot({
            organizationId: org,
            customerId,
            subscriptionId,
            status: "active",
            licenseQuantity: 1,
            offerId: null,
            paidThrough: null,
            graceUntil: null,
            legacyPlan: "pro",
          })),
          authoritative: false,
        };
        if (backend === "memory")
          (platform as MemoryPlatformRepository).memoryStore.putSync(
            "subscription",
            org,
            org,
            imported,
          );
        else {
          const administrator = new PostgresRepository(isolatedAdminUrl!);
          try {
            await administrator.pool.query(
              "UPDATE platform_records SET data=$2::jsonb WHERE kind='subscription' AND id=$1",
              [org, JSON.stringify(imported)],
            );
          } finally {
            await administrator.close();
          }
        }
        await repository.setPlan(owner.workspaceId, "free", { status: "canceled" });
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).resolves.toBeUndefined();
        await repository.setPlan(owner.workspaceId, "pro", { status: "active" });
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).rejects.toMatchObject({
          code: "BILLING_CANCELLATION_REQUIRED",
        });
        await platform.applySubscriptionSnapshot({ ...imported, status: "canceled" });
        // Legacy webhooks no longer decide this same provider subscription after the
        // business worker has reconciled its completed cancellation.
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).resolves.toBeUndefined();
        await repository.deleteUserIdentity(owner.userId);
        expect(await repository.getUserPrincipalById(owner.userId)).toBeNull();
      });

      it("protects personal subscription checkouts until their cancellation or expiry is reconciled", async () => {
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Personal subscription",
          productKey: "pollingpops",
          kind: "workspace_subscription",
          status: "published",
          version: 1,
          stripePriceId: `price_${randomUUID()}`,
          currency: "usd",
          amountMinor: 1000,
          interval: "month",
          creditQuantity: 0,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        const purchase = await platform.createPurchase({
          organizationId: org,
          actorId: owner.userId,
          offerId: offer.id,
          quantity: 1,
          idempotencyKey: randomUUID(),
        });
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).rejects.toMatchObject({
          code: "BILLING_CANCELLATION_REQUIRED",
        });
        await platform.updatePurchaseCheckout(purchase.id, `cs_${randomUUID()}`);
        await expect(repository.deleteUserIdentity(owner.userId)).rejects.toMatchObject({
          code: "BILLING_CANCELLATION_REQUIRED",
        });
        // The billing worker marks expired/failed external checkouts canceled through
        // this same operation, releasing the protection without deleting evidence.
        await platform.cancelPurchase(purchase.id);
        await repository.deleteUserIdentity(owner.userId);
        expect(await repository.getUserPrincipalById(owner.userId)).toBeNull();
        expect(await platform.getPurchase(purchase.id)).toMatchObject({ status: "canceled" });
      });

      it("still protects actual organization ownership and stewardship when a personal sign-in is deleted", async () => {
        const organization = await platform.createOrganization({
          name: "Real company",
          actorId: owner.userId,
        });
        const workspace = await platform.createOrganizationWorkspace({
          organizationId: organization.id,
          actorId: owner.userId,
          name: "Company data",
          segment: "workplace",
        });
        await expect(platform.assertIdentityDeletionAllowed(owner.userId)).rejects.toMatchObject({
          code: "OWNERSHIP_TRANSFER_REQUIRED",
        });
        const successor = await creator(repository);
        await platform.setOrganizationMember({
          organizationId: organization.id,
          actorId: owner.userId,
          userId: successor.userId,
          role: "owner",
        });
        // Another company owner alone does not transfer stewardship of its content.
        await expect(repository.deleteUserIdentity(owner.userId)).rejects.toMatchObject({
          code: "OWNERSHIP_TRANSFER_REQUIRED",
        });
        const tokenHash = randomUUID();
        await platform.createOrganizationInvitation({
          organizationId: organization.id,
          actorId: owner.userId,
          email: successor.email,
          role: "owner",
          workspaceId: workspace.id,
          workspaceRole: "editor",
          tokenHash,
          expiresAt: new Date(Date.now() + 60000),
        });
        await platform.acceptOrganizationInvitation({ tokenHash, actorId: successor.userId });
        await platform.transferWorkspaceOwnership(workspace.id, owner.userId, successor.userId);
        await repository.deleteUserIdentity(owner.userId);
        expect(await repository.getUserPrincipalById(owner.userId)).toBeNull();
        expect(
          await platform.requireOrganizationRole(organization.id, successor.userId, ["owner"]),
        ).toMatchObject({ role: "owner" });
        expect(await repository.getCreatorByUserId(successor.userId, workspace.id)).toMatchObject({
          role: "owner",
        });
        expect(await platform.getOrganizationForWorkspace(workspace.id)).toMatchObject({
          id: organization.id,
          status: "active",
          accountType: "organization",
        });
      });

      it("allows a closed organization owner's identity deletion without cascading business data", async () => {
        org = (
          await platform.createOrganization({ name: "Retained company", actorId: owner.userId })
        ).id;
        const commercialWorkspace = await platform.createOrganizationWorkspace({
          organizationId: org,
          actorId: owner.userId,
          name: "Retained workspace",
          segment: "workplace",
        });
        await platform.grantCredits({
          organizationId: org,
          quantity: 2,
          sourceKey: randomUUID(),
          reason: "initial",
          actorId: null,
        });
        await expect(repository.deleteUserIdentity(owner.userId)).rejects.toMatchObject({
          code: "OWNERSHIP_TRANSFER_REQUIRED",
        });
        await platform.updateOrganizationStatus(org, "closed");
        await repository.deleteUserIdentity(owner.userId);
        expect(await repository.getUserPrincipalById(owner.userId)).toBeNull();
        expect(await platform.getOrganizationForWorkspace(commercialWorkspace.id)).toMatchObject({
          id: org,
          status: "closed",
        });
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 2 });
        expect(await platform.listCreditLedgerForOperator(org)).toHaveLength(1);
      });
      it.each(["sole owner", "replacement owner", "multiple owners"] as const)(
        "cleans up Group memberships for a deleted identity with %s while preserving team content",
        async (scenario) => {
          org = (
            await platform.createOrganization({ name: "Retained company", actorId: owner.userId })
          ).id;
          const teamOwner = await creator(repository);
          const earliestMember = await creator(repository);
          const now = new Date();
          if (repository instanceof MemoryRepository) {
            for (const userId of [owner.userId, earliestMember.userId]) {
              repository.workspaceMembers.set(`${teamOwner.workspaceId}:${userId}`, {
                workspaceId: teamOwner.workspaceId,
                userId,
                role: "editor",
                joinedAt: now,
              });
            }
          } else {
            const client = await (repository as PostgresRepository).pool.connect();
            try {
              await client.query("BEGIN");
              await client.query("SELECT set_config('app.system_access', 'on', true)");
              await client.query(
                "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'editor')",
                [teamOwner.workspaceId, owner.userId, earliestMember.userId],
              );
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
          }
          const fixture = await createLibraryDeletionFixture(repository, teamOwner, owner.userId);
          const groups = createCollaborationGroupRepository(repository);
          // Non-owner memberships must be removed as well as ownerships.
          await groups.addMember({
            workspaceId: teamOwner.workspaceId,
            groupId: fixture.group.id,
            userId: owner.userId,
            role: "member",
            joinedAt: now,
          });
          const groupId = randomUUID();
          await groups.createGroup(
            {
              id: groupId,
              workspaceId: teamOwner.workspaceId,
              name: `Identity deletion with ${scenario}`,
              description: "Team content belongs to the workspace",
              createdBy: owner.userId,
              createdAt: now,
              updatedAt: now,
            },
            {
              workspaceId: teamOwner.workspaceId,
              groupId,
              userId: owner.userId,
              role: "owner",
              joinedAt: now,
            },
          );
          if (scenario !== "sole owner") {
            await groups.addMember({
              workspaceId: teamOwner.workspaceId,
              groupId,
              userId: teamOwner.userId,
              role: scenario === "multiple owners" ? "owner" : "member",
              joinedAt: new Date(now.getTime() + 2),
            });
            await groups.addMember({
              workspaceId: teamOwner.workspaceId,
              groupId,
              userId: earliestMember.userId,
              role: "member",
              joinedAt: new Date(now.getTime() + 1),
            });
          }
          for (const [artifactType, artifactId] of [
            ["round", fixture.round.id],
            ["presentation", fixture.presentation.id],
          ] as const) {
            await groups.addArtifact({
              id: randomUUID(),
              workspaceId: teamOwner.workspaceId,
              groupId,
              artifactType,
              artifactId,
              addedBy: owner.userId,
              createdAt: now,
            });
          }
          const message = await groups.addMessage({
            id: randomUUID(),
            workspaceId: teamOwner.workspaceId,
            groupId,
            authorId: owner.userId,
            body: "Keep this team facilitation note",
            createdAt: now,
          });
          const schedule = await groups.addSchedule({
            id: randomUUID(),
            workspaceId: teamOwner.workspaceId,
            groupId,
            artifactType: "round",
            artifactId: fixture.round.id,
            kind: "live_session",
            scheduledFor: now,
            note: "Keep this team schedule",
            createdBy: owner.userId,
            createdAt: now,
          });
          await platform.grantCredits({
            organizationId: org,
            quantity: 2,
            sourceKey: randomUUID(),
            reason: "Retained commercial balance",
            actorId: null,
          });
          await expect(repository.deleteUserIdentity(owner.userId)).rejects.toMatchObject({
            code: "OWNERSHIP_TRANSFER_REQUIRED",
          });
          expect(await groups.listMembers(groupId)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ userId: owner.userId, role: "owner" }),
            ]),
          );
          await platform.updateOrganizationStatus(org, "closed");
          await repository.deleteUserIdentity(owner.userId);

          expect(await repository.getUserPrincipalById(owner.userId)).toBeNull();
          expect(
            await repository.getCreatorByUserId(owner.userId, teamOwner.workspaceId),
          ).toBeNull();
          expect(await groups.listGroups(teamOwner.workspaceId, owner.userId)).toHaveLength(0);
          expect(await groups.listMembers(fixture.group.id)).toEqual([
            expect.objectContaining({ userId: teamOwner.userId, role: "owner" }),
          ]);
          if (scenario === "sole owner") {
            expect(await groups.getGroup(teamOwner.workspaceId, groupId)).toBeNull();
            expect(await groups.listMembers(groupId)).toHaveLength(0);
            expect(await groups.listArtifacts(groupId)).toHaveLength(0);
            expect(await groups.listMessages(groupId)).toHaveLength(0);
            expect(await groups.listSchedule(groupId)).toHaveLength(0);
          } else {
            expect(await groups.getGroup(teamOwner.workspaceId, groupId)).not.toBeNull();
            expect(await groups.listMembers(groupId)).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  userId: earliestMember.userId,
                  role: scenario === "replacement owner" ? "owner" : "member",
                }),
                expect.objectContaining({
                  userId: teamOwner.userId,
                  role: scenario === "multiple owners" ? "owner" : "member",
                }),
              ]),
            );
            expect(await groups.listMembers(groupId)).toHaveLength(2);
            expect(await groups.listArtifacts(groupId)).toHaveLength(2);
            expect(await groups.listMessages(groupId)).toEqual([message]);
            expect(await groups.listSchedule(groupId)).toEqual([schedule]);
          }
          expect(
            await repository.getQuizVersion(teamOwner.workspaceId, fixture.roundVersion.id),
          ).toMatchObject({ content: fixture.content });
          expect(
            await fixture.presentations.getPresentation(
              teamOwner.workspaceId,
              fixture.presentation.id,
            ),
          ).toMatchObject({ currentVersionId: fixture.presentationVersion.id });
          expect(await groups.listArtifacts(fixture.group.id)).toHaveLength(2);
          expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 2 });
          expect(await platform.listCreditLedgerForOperator(org)).toHaveLength(1);
        },
      );
      it("blocks new premium rooms after a refund hold without changing existing reserved coverage", async () => {
        await platform.grantCredits({
          organizationId: org,
          quantity: 2,
          sourceKey: randomUUID(),
          reason: "purchase",
          actorId: null,
        });
        const room = randomUUID();
        const input = {
          artifactType: "round" as const,
          roomId: room,
          workspaceId: owner.workspaceId,
          funding: "credit" as const,
          snapshot,
          actorId: owner.userId,
          expiresAt: new Date(Date.now() + 60000),
        };
        await platform.reserveRoomCoverage(input);
        await platform.setOrganizationCommercialHold(org, true, "Refund under review");
        await expect(
          platform.reserveRoomCoverage({ ...input, roomId: randomUUID() }),
        ).rejects.toMatchObject({ code: "COMMERCIAL_HOLD" });
        await platform.consumeRoomCoverage("round", room);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 1, reserved: 0 });
        await platform.adjustCredits({
          organizationId: org,
          quantity: -1,
          reason: "Refund unused credit",
          sourceKey: randomUUID(),
          actorId: "operator",
        });
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0 });
        await expect(
          platform.adjustCredits({
            organizationId: org,
            quantity: -1,
            reason: "Refund",
            sourceKey: randomUUID(),
            actorId: "operator",
          }),
        ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
      });
      it("serializes provider reads while each local projection uses a short separately scoped transaction", async () => {
        let active = 0;
        let maximum = 0;
        const key = randomUUID();
        const work = (sourceKey: string) =>
          platform.withProviderBillingLock(key, async () => {
            active++;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 20));
            await platform.grantCredits({
              organizationId: org,
              quantity: 1,
              reason: "test provider",
              sourceKey,
              actorId: null,
            });
            active--;
          });
        await Promise.all([work(randomUUID()), work(randomUUID())]);
        expect(maximum).toBe(1);
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 2 });
      });
      it("rejects a stale provider callback before its mutation can overwrite a replacement lease", async () => {
        const key = randomUUID();
        await expect(
          platform.withProviderBillingLock(key, async () => {
            if (repository instanceof MemoryRepository) {
              const memory = createPlatformRepository(repository) as MemoryPlatformRepository;
              memory.memoryStore.putSync("provider_lock", key, null, {
                key,
                token: "replacement",
                expiresAt: new Date(Date.now() + 60000),
              });
            } else {
              const admin = new PostgresRepository(isolatedAdminUrl!);
              await admin.pool.query(
                "UPDATE platform_records SET data=jsonb_set(data,'{token}','\"replacement\"') WHERE kind='provider_lock' AND id=$1",
                [key],
              );
              await admin.close();
            }
            await platform.grantCredits({
              organizationId: org,
              quantity: 5,
              reason: "stale",
              sourceKey: randomUUID(),
              actorId: null,
            });
          }),
        ).rejects.toMatchObject({ code: "BILLING_LOCK_LOST" });
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0 });
      });
      it("never fulfills a refunded purchase again on a paid webhook replay", async () => {
        const now = new Date();
        const offer: PlatformOffer = {
          id: randomUUID(),
          name: "Event",
          productKey: "pollingpops",
          kind: "credit_pack",
          status: "published",
          version: 1,
          stripePriceId: randomUUID(),
          currency: "usd",
          amountMinor: 1000,
          interval: null,
          creditQuantity: 1,
          entitlements: snapshot,
          createdAt: now,
          updatedAt: now,
        };
        await platform.saveOffer(offer);
        const purchase = await platform.createPurchase({
          organizationId: org,
          actorId: owner.userId,
          offerId: offer.id,
          quantity: 1,
          idempotencyKey: randomUUID(),
        });
        const payment = randomUUID();
        await platform.fulfillCreditPurchase(purchase.id, payment);
        await platform.markPurchaseRefunded(purchase.id);
        await expect(platform.fulfillCreditPurchase(purchase.id, payment)).rejects.toMatchObject({
          code: "CONFLICT",
        });
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 1 });
        expect((await platform.findPurchaseByPaymentId(payment))?.status).toBe("refunded");
      });
      it("exports the complete ledger through scoped period cursors beyond the recent 1000 entries", async () => {
        const from = new Date(Date.now() - 1000);
        const to = new Date(Date.now() + 60000);
        await platform.withTransaction(async (scoped) => {
          for (let index = 0; index < 1003; index++)
            await scoped.grantCredits({
              organizationId: org,
              quantity: 1,
              reason: "export fixture",
              sourceKey: `export:${index}`,
              actorId: null,
            });
        });
        const first = await platform.listCreditLedgerPageForOperator(org, {
          from,
          to,
          limit: 1000,
        });
        expect(first.entries).toHaveLength(1000);
        expect(first.nextCursor).not.toBeNull();
        const second = await platform.listCreditLedgerPageForOperator(org, {
          from,
          to,
          limit: 1000,
          cursor: first.nextCursor!,
        });
        expect(second.entries).toHaveLength(3);
        expect(second.nextCursor).toBeNull();
        expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(
          1003,
        );
        await expect(
          platform.listCreditLedgerPageForOperator(org, {
            from: new Date(from.getTime() - 1),
            to,
            cursor: first.nextCursor!,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      });
      it("records immutable financial facts once and exports every partial refund separately", async () => {
        const now = new Date();
        const payment = `pi_${randomUUID()}`;
        const sale = {
          id: payment,
          organizationId: org,
          kind: "sale" as const,
          amountMinor: 5000,
          currency: "USD",
          occurredAt: now,
          paymentId: payment,
          invoiceId: null,
          sourceEventId: randomUUID(),
        };
        await platform.recordStripeTransaction(sale);
        await platform.recordStripeTransaction({ ...sale, sourceEventId: randomUUID() });
        await expect(
          platform.recordStripeTransaction({ ...sale, amountMinor: 4999 }),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await platform.recordStripeTransaction({
          ...sale,
          id: `re_${randomUUID()}`,
          kind: "refund",
          amountMinor: 500,
        });
        await platform.recordStripeTransaction({
          ...sale,
          id: `re_${randomUUID()}`,
          kind: "refund",
          amountMinor: 1000,
        });
        const entries = await platform.listStripeTransactionsForOperator(
          org,
          new Date(now.getTime() - 1000),
          new Date(now.getTime() + 1000),
        );
        expect(entries).toHaveLength(3);
        expect(
          entries
            .filter((entry) => entry.kind === "refund")
            .map((entry) => entry.amountMinor)
            .sort((a, b) => a - b),
        ).toEqual([500, 1000]);
      });
      it("reclaims expired leases only for explicitly known read-only integration operations", async () => {
        for (const [integration, eventType] of [
          ["jira-service-management", "support.status"],
          ["quickbooks", "accounting.reconcile"],
        ] as const) {
          const job = await platform.enqueueIntegrationJob({
            integration,
            organizationId: org,
            eventType,
            deduplicationKey: randomUUID(),
            payload: {},
          });
          const now = new Date();
          const first = await platform.claimIntegrationJob(integration, 1000, now);
          expect(first?.id).toBe(job.id);
          const second = await platform.claimIntegrationJob(
            integration,
            1000,
            new Date(now.getTime() + 2000),
          );
          expect(second?.id).toBe(job.id);
          expect(second?.leaseToken).not.toBe(first?.leaseToken);
          expect(await platform.completeIntegrationJob(job.id, first!.leaseToken!, null)).toBe(
            false,
          );
          expect(await platform.completeIntegrationJob(job.id, second!.leaseToken!, null)).toBe(
            true,
          );
        }
      });
      it("resolves uncertain support creation only from a matching verified receipt and rolls back with its audit", async () => {
        const caseId = randomUUID();
        const job = await platform.enqueueIntegrationJob({
          integration: "jira-service-management",
          organizationId: org,
          eventType: "support.create",
          deduplicationKey: `case:${caseId}`,
          payload: { caseId, organizationId: org },
        });
        const now = new Date();
        const claimed = (await platform.claimIntegrationJob("jira-service-management", 1000, now))!;
        expect(claimed.id).toBe(job.id);
        await platform.failIntegrationJob(
          job.id,
          claimed.leaseToken!,
          "unknown provider outcome",
          true,
        );
        const receipt = { caseId, organizationId: org, status: "Open" };
        await expect(
          platform.resolveAmbiguousIntegrationJob(job.id, "SUP-123", {
            ...receipt,
            caseId: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "REFERENCE_MISMATCH" });
        await expect(
          platform.withOperatorTransaction(async (tx) => {
            expect(await tx.resolveAmbiguousIntegrationJob(job.id, "SUP-123", receipt)).toBe(true);
            throw new Error("rollback verified mapping");
          }),
        ).rejects.toThrow("rollback verified mapping");
        expect((await platform.getIntegrationJob(job.id))?.state).toBe("ambiguous");
        expect(await platform.resolveAmbiguousIntegrationJob(job.id, "SUP-123", receipt)).toBe(
          true,
        );
        expect(await platform.resolveAmbiguousIntegrationJob(job.id, "SUP-123", receipt)).toBe(
          true,
        );
        expect(await platform.getIntegrationJob(job.id)).toMatchObject({
          state: "complete",
          externalId: "SUP-123",
          attempts: claimed.attempts,
          result: receipt,
        });
        await expect(
          platform.resolveAmbiguousIntegrationJob(job.id, "SUP-456", receipt),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        const readOnly = await platform.enqueueIntegrationJob({
          integration: "jira-service-management",
          organizationId: org,
          eventType: "support.reconcile",
          deduplicationKey: randomUUID(),
          payload: { caseId, organizationId: org },
        });
        const readAt = new Date(Date.now() + 1000);
        const first = (await platform.claimIntegrationJob(
          "jira-service-management",
          1000,
          readAt,
        ))!;
        expect(first.id).toBe(readOnly.id);
        const replacement = (await platform.claimIntegrationJob(
          "jira-service-management",
          1000,
          new Date(readAt.getTime() + 2000),
        ))!;
        expect(replacement.id).toBe(readOnly.id);
        expect(replacement.leaseToken).not.toBe(first.leaseToken);
        await platform.completeIntegrationJob(replacement.id, replacement.leaseToken!, null);
      });
      it("projects aggregate queue health without recent-list truncation or unbounded tenant labels", async () => {
        const created = new Date();
        await platform.withTransaction(async (scoped) => {
          for (let index = 0; index < 125; index++)
            await scoped.enqueueBillingEvent({
              providerEventId: `evt_health_${randomUUID()}`,
              eventType: "test",
              payload: { id: randomUUID() },
              providerCreatedAt: created,
            });
          await scoped.enqueueIntegrationJob({
            integration: `unknown-${org}`,
            organizationId: org,
            eventType: "test",
            deduplicationKey: randomUUID(),
            payload: {},
          });
        });
        const health = await platform.getBusinessHealth(new Date(created.getTime() + 60000));
        expect(health.billing.pending).toBeGreaterThanOrEqual(125);
        expect(health.billing.oldestPendingAgeSeconds).toBeGreaterThan(50);
        expect(health.integrations.map((item) => item.integration)).toEqual([
          "jira-service-management",
          "hubspot",
          "quickbooks",
          "other",
        ]);
        expect(
          health.integrations.find((item) => item.integration === "other")?.pending,
        ).toBeGreaterThan(0);
        expect(JSON.stringify(health)).not.toContain(org);
      });
    },
  );
}

describe("Synchronous memory room transaction hooks", () => {
  it("shares the canonical platform store and commits consumption before product acknowledgements", async () => {
    const repository = new MemoryRepository();
    const owner = await creator(repository);
    const platform = createPlatformRepository(repository);
    const org = (await platform.getOrganizationForWorkspace(owner.workspaceId))!.id;
    await platform.grantCredits({
      organizationId: org,
      quantity: 1,
      reason: "test",
      sourceKey: "sync-credit",
      actorId: null,
    });
    const room = randomUUID();
    const coverage = reserveRoomCoverageInMemory(repository, {
      artifactType: "round",
      roomId: room,
      workspaceId: owner.workspaceId,
      funding: "credit",
      snapshot,
      actorId: owner.userId,
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(coverage.reservationState).toBe("reserved");
    expect(consumeRoomCoverageInMemory(repository, "round", room)?.reservationState).toBe(
      "consumed",
    );
    expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 0, reserved: 0 });
  });
});
