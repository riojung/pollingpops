import { randomUUID, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createGameState, addParticipant } from "@openround/game-engine";
import type { Report } from "@openround/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
        await repository?.close();
      });

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
            await admin.close();
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
      it("allows a closed organization owner's identity deletion without cascading business data", async () => {
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
        expect(await platform.getOrganizationForWorkspace(owner.workspaceId)).toMatchObject({
          id: org,
          status: "closed",
        });
        expect(await platform.getCreditBalance(org)).toMatchObject({ balance: 2 });
        expect(await platform.listCreditLedgerForOperator(org)).toHaveLength(1);
      });
      it.each(["sole owner", "replacement owner", "multiple owners"] as const)(
        "cleans up Group memberships for a deleted identity with %s while preserving team content",
        async (scenario) => {
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
