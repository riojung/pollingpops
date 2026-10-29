import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRepository,
  PostgresRepository,
  createPlatformRepository,
  type CreatorContext,
  type EmailPinChallengeRecord,
  type Repository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** Keep every real SQL call intact while controlling the order of competing transactions. */
function observeQueries(
  repository: PostgresRepository,
  hooks: { before?: (sql: string) => void; after?: (sql: string) => Promise<void> },
) {
  const connect = repository.pool.connect.bind(repository.pool);
  const observed = new WeakSet<object>();
  const restoreQueries: Array<() => void> = [];
  const connectSpy = vi.spyOn(repository.pool, "connect");
  connectSpy.mockImplementation((async () => {
    const client = await connect();
    if (!observed.has(client)) {
      observed.add(client);
      const query = client.query.bind(client);
      const querySpy = vi.spyOn(client, "query");
      querySpy.mockImplementation((async (...args: unknown[]) => {
        const sql = typeof args[0] === "string" ? args[0] : "";
        hooks.before?.(sql);
        const result = await Reflect.apply(query, client, args);
        await hooks.after?.(sql);
        return result;
      }) as typeof client.query);
      restoreQueries.push(() => querySpy.mockRestore());
    }
    return client;
  }) as typeof repository.pool.connect);
  return () => {
    connectSpy.mockRestore();
    for (const restore of restoreQueries) restore();
  };
}

const locksUser = (sql: string) => /\bFROM\s+users\b/i.test(sql) && /\bFOR\s+UPDATE\b/i.test(sql);

async function verifiedCreator(repository: Repository) {
  const tokenHash = hash(randomUUID());
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `email-pin-${randomUUID()}@example.test`,
    segment: "education",
    policyVersion: "verification-policy",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

function challengeFor(userId: string): EmailPinChallengeRecord {
  return {
    id: randomUUID(),
    userId,
    tokenHash: hash(randomUUID()),
    pinHash: hash(randomUUID()),
    policyVersion: "sign-in-policy",
    returnTo: "/lti/link?from=email",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    consumedAt: null,
    attempts: 0,
  };
}

for (const backend of ["memory", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `Verified email PIN ${backend} conformance`,
    () => {
      let repository: Repository;
      let creator: CreatorContext;
      let administrator: PostgresRepository | undefined;
      let isolatedRuntimeUrl: string;
      const databaseName = `email_pin_${randomUUID().replaceAll("-", "")}`;
      beforeAll(async () => {
        if (backend !== "postgres") return;
        await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
        } finally {
          await cluster.close();
        }
        const admin = new URL(adminUrl!);
        const runtime = new URL(runtimeUrl!);
        admin.pathname = `/${databaseName}`;
        runtime.pathname = `/${databaseName}`;
        isolatedRuntimeUrl = runtime.toString();
        administrator = new PostgresRepository(admin.toString());
        await administrator.migrate();
      });
      afterAll(async () => {
        await administrator?.close();
        if (backend !== "postgres") return;
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        } finally {
          await cluster.close();
        }
      });
      beforeEach(async () => {
        repository =
          backend === "memory"
            ? new MemoryRepository()
            : new PostgresRepository(isolatedRuntimeUrl);
        await repository.initialize();
        creator = await verifiedCreator(repository);
      });
      afterEach(async () => {
        await repository?.close();
      });

      async function storedChallenge(tokenHash: string) {
        if (repository instanceof MemoryRepository)
          return repository.emailPinChallenges.get(tokenHash) ?? null;
        const result = await administrator!.pool.query(
          "SELECT * FROM auth_email_pin_challenges WHERE token_hash = $1",
          [tokenHash],
        );
        return result.rows[0] ?? null;
      }

      it("marks verification and trusted invitation identities without creating a session", async () => {
        expect(await repository.getVerifiedEmailIdentity(creator.email)).toMatchObject({
          user: { userId: creator.userId },
        });
        if (repository instanceof MemoryRepository) {
          expect(repository.users.get(creator.userId)?.emailVerifiedAt).toBeInstanceOf(Date);
          expect(repository.creatorSessions.size).toBe(0);
        } else {
          expect(
            (
              await administrator!.pool.query(
                "SELECT id FROM creator_sessions WHERE user_id = $1",
                [creator.userId],
              )
            ).rows,
          ).toEqual([]);
        }
        const tokenHash = hash(randomUUID());
        const email = `invited-${randomUUID()}@example.test`;
        await repository.createWorkspaceInvitation({
          id: randomUUID(),
          workspaceId: creator.workspaceId,
          email,
          role: "viewer",
          tokenHash,
          invitedBy: creator.userId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          revokedAt: null,
        });
        const invited = await repository.acceptWorkspaceInvitation(
          tokenHash,
          new Date(),
          "invitation-policy",
        );
        expect(await repository.getVerifiedEmailIdentity(email)).toMatchObject({
          user: { userId: invited!.userId },
          creator: { role: "viewer", workspaceId: creator.workspaceId },
        });
      });

      it("serializes separate verification links for the same mailbox without duplicating the account", async () => {
        const email = `concurrent-verification-${randomUUID()}@example.test`;
        const tokens = [hash(randomUUID()), hash(randomUUID())];
        const segments = ["workplace", "education"] as const;
        await Promise.all(
          tokens.map((tokenHash, index) =>
            repository.createMagicToken({
              id: randomUUID(),
              tokenHash,
              email: index === 0 ? email : ` ${email.toUpperCase()} `,
              segment: segments[index]!,
              policyVersion: `concurrent-${index}`,
              expiresAt: new Date(Date.now() + 60_000),
              consumedAt: null,
            }),
          ),
        );
        const identities = await Promise.all(
          tokens.map((tokenHash) => repository.consumeMagicLinkIdentity(tokenHash, new Date())),
        );
        expect(identities[0]?.user.userId).toBeDefined();
        expect(identities[1]?.user.userId).toBe(identities[0]!.user.userId);
        expect(identities[1]?.creator?.workspaceId).toBe(identities[0]!.creator!.workspaceId);
        expect(identities.map((identity) => identity?.newlyVerified).sort()).toEqual([false, true]);
        const initialIndex = identities.findIndex((identity) => identity?.newlyVerified);
        const identity = identities[initialIndex]!;
        expect(identity?.user.email).toBe(email);
        expect(await repository.listWorkspaces(identity!.user.userId)).toEqual([
          expect.objectContaining({
            id: identity!.creator!.workspaceId,
            segment: segments[initialIndex],
            role: "owner",
          }),
        ]);
        expect((await repository.exportAccount(identity!.user.userId)).consentRecords).toEqual([
          expect.objectContaining({
            [backend === "memory" ? "documentVersion" : "document_version"]:
              `concurrent-${initialIndex}`,
          }),
          expect.objectContaining({
            [backend === "memory" ? "documentVersion" : "document_version"]:
              `concurrent-${initialIndex}`,
          }),
        ]);
      });

      it("acknowledges a verified mailbox without changing its workspace, locale, plan, verification marker or consent", async () => {
        const platform = createPlatformRepository(repository);
        await repository.setPlan(creator.workspaceId, "pro");
        await repository.updateUserLocale(creator.userId, "ja-JP");
        await platform.renameWorkspace(creator.workspaceId, creator.userId, "Configured workspace");
        const before = await repository.exportAccount(creator.userId);
        const tokenHash = hash(randomUUID());
        await repository.createMagicToken({
          id: randomUUID(),
          tokenHash,
          email: ` ${creator.email.toUpperCase()} `,
          segment: "workplace",
          policyVersion: "untrusted-repeat-policy",
          expiresAt: new Date(Date.now() + 60000),
          consumedAt: null,
        });
        const result = await repository.consumeMagicLinkIdentity(tokenHash, new Date());
        expect(result).toMatchObject({
          newlyVerified: false,
          user: { userId: creator.userId, locale: "ja-JP", localePreferenceSet: true },
          creator: {
            workspaceId: creator.workspaceId,
            segment: "education",
            plan: "pro",
            role: "owner",
          },
        });
        const after = await repository.exportAccount(creator.userId);
        expect(after.profile).toEqual(before.profile);
        expect(after.workspaces).toEqual(before.workspaces);
        expect(after.workspaceMemberships).toEqual(before.workspaceMemberships);
        expect(after.consentRecords).toEqual(before.consentRecords);
        expect(await repository.consumeMagicLinkIdentity(tokenHash, new Date())).toBeNull();
      });

      it.skipIf(backend !== "postgres").each(["deleteAccount", "deleteUserIdentity"] as const)(
        "serializes verification with %s after deletion has locked the identity",
        async (method) => {
          if (method === "deleteUserIdentity") {
            const platform = createPlatformRepository(repository);
            const organization = await platform.getOrganizationForWorkspace(creator.workspaceId);
            await platform.closeOrganization(organization!.id, creator.userId);
          }
          const tokenHash = hash(randomUUID());
          await repository.createMagicToken({
            id: randomUUID(),
            tokenHash,
            email: creator.email,
            segment: "education",
            policyVersion: "deletion-race",
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: null,
          });
          const verifier = new PostgresRepository(isolatedRuntimeUrl);
          const deletionLocked = deferred();
          const releaseDeletion = deferred();
          const verifierAttemptingLock = deferred();
          const restoreDeletion = observeQueries(repository as PostgresRepository, {
            after: async (sql) => {
              if (locksUser(sql)) {
                deletionLocked.resolve();
                await releaseDeletion.promise;
              }
            },
          });
          const restoreVerification = observeQueries(verifier, {
            before: (sql) => {
              if (locksUser(sql)) verifierAttemptingLock.resolve();
            },
          });
          const deletion = Promise.allSettled([repository[method](creator.userId)]);
          let verification: Promise<PromiseSettledResult<unknown>[]> | undefined;
          try {
            await Promise.race([
              deletionLocked.promise,
              deletion.then(() => {
                throw new Error("Deletion settled before reaching its user-lock barrier");
              }),
            ]);
            verification = Promise.allSettled([
              verifier.consumeMagicLinkIdentity(tokenHash, new Date()),
            ]);
            await Promise.race([
              verifierAttemptingLock.promise,
              verification.then(() => {
                throw new Error("Verification settled before attempting the user lock");
              }),
            ]);
            releaseDeletion.resolve();
            const [deleted, verified] = await Promise.all([deletion, verification]);
            expect(deleted[0]).toMatchObject({ status: "fulfilled" });
            expect(verified[0]).toEqual({ status: "fulfilled", value: null });
            expect(await verifier.consumeMagicLinkIdentity(tokenHash, new Date())).toBeNull();
            expect(await verifier.getVerifiedEmailIdentity(creator.email)).toBeNull();
            expect(
              (
                await administrator!.pool.query(
                  "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
                  [creator.email],
                )
              ).rows,
            ).toEqual([]);
          } finally {
            releaseDeletion.resolve();
            await deletion;
            await verification;
            restoreDeletion();
            restoreVerification();
            await verifier.close();
          }
        },
        10_000,
      );

      it.skipIf(backend !== "postgres").each(["user", "token"] as const)(
        "rechecks verification expiry after waiting for the %s lock",
        async (heldLock) => {
          const tokenHash = hash(randomUUID());
          await repository.createMagicToken({
            id: randomUUID(),
            tokenHash,
            email: creator.email,
            segment: "education",
            policyVersion: "expiry-race",
            expiresAt: new Date(Date.now() + 200),
            consumedAt: null,
          });
          const blocker = await administrator!.pool.connect();
          const reachedLock = deferred();
          const restore = observeQueries(repository as PostgresRepository, {
            before: (sql) => {
              if (
                heldLock === "user"
                  ? locksUser(sql)
                  : /\bauth_magic_tokens\b/.test(sql) &&
                    (/\bFOR\s+UPDATE\b/i.test(sql) || /^UPDATE\s/i.test(sql.trim()))
              )
                reachedLock.resolve();
            },
          });
          let verification: Promise<PromiseSettledResult<unknown>[]> | undefined;
          try {
            await blocker.query("BEGIN");
            await blocker.query(
              heldLock === "user"
                ? "SELECT id FROM users WHERE id = $1 FOR UPDATE"
                : "SELECT id FROM auth_magic_tokens WHERE token_hash = $1 FOR UPDATE",
              [heldLock === "user" ? creator.userId : tokenHash],
            );
            verification = Promise.allSettled([
              repository.consumeMagicLinkIdentity(tokenHash, new Date()),
            ]);
            await Promise.race([
              reachedLock.promise,
              verification.then(() => {
                throw new Error("Verification settled before attempting the held lock");
              }),
            ]);
            await blocker.query("SELECT pg_sleep(0.25)");
            await blocker.query("COMMIT");
            expect((await verification)[0]).toEqual({ status: "fulfilled", value: null });
            expect(
              (
                await administrator!.pool.query(
                  "SELECT consumed_at FROM auth_magic_tokens WHERE token_hash = $1",
                  [tokenHash],
                )
              ).rows,
            ).toEqual([{ consumed_at: null }]);
            expect(await repository.consumeMagicLinkIdentity(tokenHash, new Date())).toBeNull();
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
            await verification;
            restore();
          }
        },
        10_000,
      );

      it("requires mailbox verification, preserves current identity and records consent only after success", async () => {
        expect(await repository.getVerifiedEmailIdentity("unknown@example.test")).toBeNull();
        const pendingEmail = `pending-${randomUUID()}@example.test`;
        await repository.createMagicToken({
          id: randomUUID(),
          tokenHash: hash(randomUUID()),
          email: pendingEmail,
          segment: "workplace",
          policyVersion: "pending",
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: null,
        });
        expect(await repository.getVerifiedEmailIdentity(pendingEmail)).toBeNull();
        const absent = challengeFor(randomUUID());
        await repository.createEmailPinChallenge(absent);
        expect(await storedChallenge(absent.tokenHash)).toBeNull();
        await repository.setPlan(creator.workspaceId, "pro");
        await repository.updateUserLocale(creator.userId, "ja-JP");
        expect(
          await repository.getVerifiedEmailIdentity(` ${creator.email.toUpperCase()} `),
        ).toMatchObject({
          user: { userId: creator.userId, locale: "ja-JP", localePreferenceSet: true },
          creator: {
            workspaceId: creator.workspaceId,
            segment: "education",
            role: "owner",
            plan: "pro",
          },
        });
        const challenge = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(challenge);
        expect((await repository.exportAccount(creator.userId)).consentRecords).toHaveLength(2);
        expect(
          await repository.consumeEmailPinChallenge(challenge.tokenHash, hash("wrong"), new Date()),
        ).toBeNull();
        expect((await repository.exportAccount(creator.userId)).consentRecords).toHaveLength(2);
        const result = await repository.consumeEmailPinChallenge(
          challenge.tokenHash,
          challenge.pinHash,
          new Date(),
        );
        expect(result).toMatchObject({
          identity: {
            user: { userId: creator.userId },
            creator: { workspaceId: creator.workspaceId, plan: "pro" },
          },
          returnTo: challenge.returnTo,
        });
        const exported = await repository.exportAccount(creator.userId);
        const consentRecords = exported.consentRecords as Array<Record<string, unknown>>;
        expect(consentRecords).toHaveLength(4);
        expect(
          consentRecords.filter(
            (record) => (record.documentVersion ?? record.document_version) === "sign-in-policy",
          ),
        ).toHaveLength(2);
        expect(
          await repository.consumeEmailPinChallenge(
            challenge.tokenHash,
            challenge.pinHash,
            new Date(),
          ),
        ).toBeNull();
      });

      it("persists five wrong attempts across concurrent writers and rejects the correct PIN after exhaustion", async () => {
        const challenge = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(challenge);
        const other =
          backend === "postgres" ? new PostgresRepository(isolatedRuntimeUrl) : repository;
        try {
          const results = await Promise.all(
            Array.from({ length: 8 }, (_, index) =>
              (index % 2 ? other : repository).consumeEmailPinChallenge(
                challenge.tokenHash,
                hash("wrong"),
                new Date(),
              ),
            ),
          );
          expect(results).toEqual(Array(8).fill(null));
          expect(await storedChallenge(challenge.tokenHash)).toMatchObject({ attempts: 5 });
          expect(
            await other.consumeEmailPinChallenge(
              challenge.tokenHash,
              challenge.pinHash,
              new Date(),
            ),
          ).toBeNull();
        } finally {
          if (other !== repository) await other.close();
        }
      });

      it("consumes a correct PIN exactly once across concurrent writers", async () => {
        const challenge = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(challenge);
        const other =
          backend === "postgres" ? new PostgresRepository(isolatedRuntimeUrl) : repository;
        try {
          const results = await Promise.all([
            repository.consumeEmailPinChallenge(challenge.tokenHash, challenge.pinHash, new Date()),
            other.consumeEmailPinChallenge(challenge.tokenHash, challenge.pinHash, new Date()),
          ]);
          expect(results.filter(Boolean)).toHaveLength(1);
        } finally {
          if (other !== repository) await other.close();
        }
      });

      it("rejects unknown, expired and revoked challenges and replaces outstanding challenges on resend", async () => {
        expect(
          await repository.consumeEmailPinChallenge(hash("unknown"), hash("unknown"), new Date()),
        ).toBeNull();
        const expired = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(expired);
        expect(
          await repository.consumeEmailPinChallenge(
            expired.tokenHash,
            expired.pinHash,
            expired.expiresAt,
          ),
        ).toBeNull();
        const revoked = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(revoked);
        await repository.revokeEmailPinChallenge(revoked.tokenHash);
        expect(
          await repository.consumeEmailPinChallenge(revoked.tokenHash, revoked.pinHash, new Date()),
        ).toBeNull();
        const first = challengeFor(creator.userId);
        const second = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(first);
        await repository.createEmailPinChallenge(second);
        expect(
          await repository.consumeEmailPinChallenge(first.tokenHash, first.pinHash, new Date()),
        ).toBeNull();
        expect(
          await repository.consumeEmailPinChallenge(second.tokenHash, second.pinHash, new Date()),
        ).not.toBeNull();
      });

      it("serializes simultaneous resends so only the final challenge can authenticate", async () => {
        const challenges = [challengeFor(creator.userId), challengeFor(creator.userId)];
        await Promise.all(
          challenges.map((challenge) => repository.createEmailPinChallenge(challenge)),
        );
        const results = await Promise.all(
          challenges.map((challenge) =>
            repository.consumeEmailPinChallenge(challenge.tokenHash, challenge.pinHash, new Date()),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
      });

      it("authenticates a verified identity without creating a missing content membership", async () => {
        if (repository instanceof MemoryRepository) {
          for (const [key, membership] of repository.workspaceMembers)
            if (membership.userId === creator.userId) repository.workspaceMembers.delete(key);
        } else {
          await administrator!.pool.query("DELETE FROM workspace_members WHERE user_id = $1", [
            creator.userId,
          ]);
        }
        expect(await repository.getVerifiedEmailIdentity(creator.email)).toMatchObject({
          user: { userId: creator.userId },
          creator: null,
        });
        const challenge = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(challenge);
        expect(
          await repository.consumeEmailPinChallenge(
            challenge.tokenHash,
            challenge.pinHash,
            new Date(),
          ),
        ).toMatchObject({ identity: { user: { userId: creator.userId }, creator: null } });
        expect(await repository.getVerifiedEmailIdentity(creator.email)).toMatchObject({
          creator: null,
        });
      });

      it("selects an invited workspace through the PIN only while its membership remains valid", async () => {
        const invitedWorkspaceOwner = await verifiedCreator(repository);
        const invitationTokenHash = hash(randomUUID());
        await repository.createWorkspaceInvitation({
          id: randomUUID(),
          workspaceId: invitedWorkspaceOwner.workspaceId,
          email: creator.email,
          role: "editor",
          tokenHash: invitationTokenHash,
          invitedBy: invitedWorkspaceOwner.userId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          revokedAt: null,
        });
        await repository.acceptWorkspaceInvitation(
          invitationTokenHash,
          new Date(),
          "invitation-policy",
        );
        const targeted = {
          ...challengeFor(creator.userId),
          workspaceId: invitedWorkspaceOwner.workspaceId,
        };
        await repository.createEmailPinChallenge(targeted);
        expect(
          await repository.consumeEmailPinChallenge(
            targeted.tokenHash,
            targeted.pinHash,
            new Date(),
          ),
        ).toMatchObject({
          identity: { creator: { workspaceId: invitedWorkspaceOwner.workspaceId, role: "editor" } },
        });
        const consentRecords = (await repository.exportAccount(creator.userId))
          .consentRecords as Array<Record<string, unknown>>;
        expect(
          consentRecords.filter(
            (record) => (record.documentVersion ?? record.document_version) === "sign-in-policy",
          ),
        ).toHaveLength(2);
        const revokedTarget = {
          ...challengeFor(creator.userId),
          workspaceId: invitedWorkspaceOwner.workspaceId,
        };
        await repository.createEmailPinChallenge(revokedTarget);
        expect(
          await repository.removeWorkspaceMember(invitedWorkspaceOwner.workspaceId, creator.userId),
        ).toBe(true);
        expect(
          await repository.consumeEmailPinChallenge(
            revokedTarget.tokenHash,
            revokedTarget.pinHash,
            new Date(),
          ),
        ).toMatchObject({
          identity: { creator: { workspaceId: creator.workspaceId, role: "owner" } },
        });
        const foreignTarget = {
          ...challengeFor(creator.userId),
          workspaceId: invitedWorkspaceOwner.workspaceId,
        };
        await repository.createEmailPinChallenge(foreignTarget);
        expect(
          await repository.consumeEmailPinChallenge(
            foreignTarget.tokenHash,
            foreignTarget.pinHash,
            new Date(),
          ),
        ).toMatchObject({
          identity: { creator: { workspaceId: creator.workspaceId, role: "owner" } },
        });
        const missingTarget = { ...challengeFor(creator.userId), workspaceId: randomUUID() };
        await repository.createEmailPinChallenge(missingTarget);
        expect(
          await repository.consumeEmailPinChallenge(
            missingTarget.tokenHash,
            missingTarget.pinHash,
            new Date(),
          ),
        ).toMatchObject({ identity: { creator: { workspaceId: creator.workspaceId } } });
      });

      it.each(["deleteAccount", "deleteUserIdentity"] as const)(
        "removes credentials on %s and cannot revive the deleted identity",
        async (method) => {
          const challenge = challengeFor(creator.userId);
          await repository.createEmailPinChallenge(challenge);
          if (method === "deleteUserIdentity") {
            const platform = createPlatformRepository(repository);
            const organization = await platform.getOrganizationForWorkspace(creator.workspaceId);
            await platform.closeOrganization(organization!.id, creator.userId);
          }
          await repository[method](creator.userId);
          expect(await storedChallenge(challenge.tokenHash)).toBeNull();
          expect(await repository.getVerifiedEmailIdentity(creator.email)).toBeNull();
          expect(
            await repository.consumeEmailPinChallenge(
              challenge.tokenHash,
              challenge.pinHash,
              new Date(),
            ),
          ).toBeNull();
          await repository.createEmailPinChallenge(challenge);
          expect(await storedChallenge(challenge.tokenHash)).toBeNull();
        },
      );

      it("removes expired credentials during retention cleanup", async () => {
        const challenge = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(challenge);
        await repository.purgeExpired(challenge.expiresAt);
        expect(await storedChallenge(challenge.tokenHash)).toBeNull();
      });

      it("does not authenticate an identity whose verified marker was removed", async () => {
        const challenge = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(challenge);
        if (repository instanceof MemoryRepository)
          repository.users.get(creator.userId)!.emailVerifiedAt = null;
        else
          await administrator!.pool.query(
            "UPDATE users SET email_verified_at = NULL WHERE id = $1",
            [creator.userId],
          );
        expect(await repository.getVerifiedEmailIdentity(creator.email)).toBeNull();
        const replacement = challengeFor(creator.userId);
        await repository.createEmailPinChallenge(replacement);
        expect(await storedChallenge(replacement.tokenHash)).toBeNull();
        expect(
          await repository.consumeEmailPinChallenge(
            challenge.tokenHash,
            challenge.pinHash,
            new Date(),
          ),
        ).toBeNull();
      });

      it.skipIf(backend !== "postgres")(
        "checks real expiry after a challenge waits on the user lock",
        async () => {
          const challenge = challengeFor(creator.userId);
          challenge.expiresAt = new Date(Date.now() + 100);
          await repository.createEmailPinChallenge(challenge);
          const lock = await administrator!.pool.connect();
          try {
            await lock.query("BEGIN");
            await lock.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [creator.userId]);
            const consumed = repository.consumeEmailPinChallenge(
              challenge.tokenHash,
              challenge.pinHash,
              new Date(),
            );
            await lock.query("SELECT pg_sleep(0.15)");
            await lock.query("COMMIT");
            expect(await consumed).toBeNull();
          } finally {
            await lock.query("ROLLBACK");
            lock.release();
          }
        },
      );

      it.skipIf(backend !== "postgres")(
        "backfills only active legacy identities and enforces private credential RLS",
        async () => {
          const activeId = randomUUID();
          const deletedId = randomUUID();
          await administrator!.pool.query(
            "INSERT INTO users (id, email, deleted_at) VALUES ($1,$2,NULL), ($3,$4,now())",
            [activeId, `${activeId}@example.test`, deletedId, `${deletedId}@example.test`],
          );
          await administrator!.pool.query(
            await readFile(
              new URL("../migrations/075_verified_email_pin_auth.sql", import.meta.url),
              "utf8",
            ),
          );
          expect(
            await repository.getVerifiedEmailIdentity(`${activeId}@example.test`),
          ).toMatchObject({ user: { userId: activeId }, creator: null });
          expect(await repository.getVerifiedEmailIdentity(`${deletedId}@example.test`)).toBeNull();
          const challenge = challengeFor(creator.userId);
          await repository.createEmailPinChallenge(challenge);
          const postgres = repository as PostgresRepository;
          expect(
            (await postgres.pool.query("SELECT * FROM auth_email_pin_challenges")).rows,
          ).toEqual([]);
          const security = await administrator!.pool.query(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'auth_email_pin_challenges'",
          );
          expect(security.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
        },
      );
    },
  );
}
