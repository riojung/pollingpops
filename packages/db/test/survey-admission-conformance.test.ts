import { createHash, randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRepository,
  PostgresRepository,
  createPlatformRepository,
  createSurveyRepository,
  type CreatorContext,
  type PlatformRepository,
  type Repository,
  type SurveyRepository,
  type SurveyRoom,
} from "../src/index.js";
import { surveyFixture } from "./support/survey-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const guestToken = () => createHash("sha256").update(randomUUID()).digest("hex");
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const backend of ["memory", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `Survey audience admission ${backend} conformance`,
    () => {
      let repository: Repository;
      let platform: PlatformRepository;
      let owner: CreatorContext;
      let surveys: SurveyRepository;
      let room: SurveyRoom;
      let observer: PostgresRepository | undefined;
      const databaseName = `survey_admission_${randomUUID().replaceAll("-", "")}`;
      let isolatedRuntimeUrl = runtimeUrl;
      beforeAll(async () => {
        if (backend !== "postgres") return;
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
        } finally {
          await cluster.close();
        }
        const administrator = new URL(adminUrl!);
        administrator.pathname = `/${databaseName}`;
        const runtime = new URL(runtimeUrl!);
        runtime.pathname = `/${databaseName}`;
        isolatedRuntimeUrl = runtime.toString();
        observer = new PostgresRepository(administrator.toString());
        await observer.migrate();
      });
      afterAll(async () => {
        await observer?.close();
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
            : new PostgresRepository(isolatedRuntimeUrl!);
        await repository.initialize();
        const tokenHash = guestToken();
        const now = new Date();
        await repository.createMagicToken({
          id: randomUUID(),
          tokenHash,
          email: `survey-admission-${randomUUID()}@example.test`,
          segment: "workplace",
          policyVersion: "test",
          expiresAt: new Date(now.getTime() + 60_000),
          consumedAt: null,
        });
        owner = (await repository.consumeMagicToken(tokenHash, now))!;
        platform = createPlatformRepository(repository);
        surveys = createSurveyRepository(repository);
        const surveyId = randomUUID();
        await surveys.create(owner.workspaceId, surveyId, surveyFixture(), randomUUID());
        await surveys.publish(owner.workspaceId, surveyId, 0, randomUUID(), null);
        room = await surveys.createRoom(owner.workspaceId, surveyId, 0, randomUUID(), {
          code: String(randomInt(1_000_000, 10_000_000)),
          participantLimit: 20,
          closesAt: new Date(now.getTime() + 60_000).toISOString(),
          expiresAt: new Date(now.getTime() + 120_000).toISOString(),
          windowDays: 1,
        });
      });
      afterEach(async () => {
        await repository?.close();
      });

      async function expectAdmissionWaiting(settled: () => boolean) {
        if (backend === "memory") {
          // Drain the event loop so an admission without the shared transaction lock
          // would have completed its in-memory reads and insert.
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(settled()).toBe(false);
          return;
        }
        await vi.waitFor(
          async () => {
            expect(settled()).toBe(false);
            const waiting = await observer!.pool.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM pg_stat_activity
               WHERE datname = $1 AND wait_event_type = 'Lock'
                 AND query LIKE '%FROM workspaces%FOR SHARE%'`,
              [databaseName],
            );
            expect(Number(waiting.rows[0]?.count ?? 0)).toBeGreaterThan(0);
          },
          { timeout: 3000, interval: 10 },
        );
      }

      it("restricts only new guests, preserving reconnects and accepted response access", async () => {
        const existingToken = guestToken();
        const accepted = await surveys.admit(room.id, existingToken, () => new Date());
        await platform.setWorkspaceAdmissionRestriction(owner.workspaceId, true);
        const deniedToken = guestToken();
        await expect(surveys.admit(room.id, deniedToken, () => new Date())).rejects.toMatchObject({
          code: "ADMISSION_RESTRICTED",
        });
        await expect(surveys.attempt(room.id, deniedToken, new Date())).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        expect(await surveys.admit(room.id, existingToken, () => new Date())).toEqual(accepted);
        const saved = await surveys.respond(
          room.id,
          existingToken,
          {},
          0,
          randomUUID(),
          false,
          () => new Date(),
        );
        expect(saved.revision).toBe(1);
        expect(await surveys.attempt(room.id, existingToken, new Date())).toEqual(saved);
        await platform.setWorkspaceAdmissionRestriction(owner.workspaceId, false);
        await surveys.admit(room.id, deniedToken, () => new Date());
        expect(
          (await platform.listActiveRooms()).find((entry) => entry.roomId === room.id),
        ).toMatchObject({
          participantCount: 2,
        });
      });

      it.each(["commit", "rollback"] as const)(
        "serializes new admission after a restriction transaction %s",
        async (outcome) => {
          const locked = signal();
          const release = signal();
          const rollback = new Error("Synthetic restriction rollback");
          const restriction = platform
            .withTransaction(async (transaction) => {
              await transaction.setWorkspaceAdmissionRestriction(owner.workspaceId, true);
              locked.resolve();
              await release.promise;
              if (outcome === "rollback") throw rollback;
            })
            .then(
              () => null,
              (error: unknown) => error,
            );
          await locked.promise;
          let settled = false;
          const token = guestToken();
          const admission = surveys
            .admit(room.id, token, () => new Date())
            .then(
              (attempt) => {
                settled = true;
                return { attempt };
              },
              (error: unknown) => {
                settled = true;
                return { error };
              },
            );
          try {
            await expectAdmissionWaiting(() => settled);
          } finally {
            release.resolve();
            await restriction;
            await admission;
          }
          if (outcome === "commit") {
            expect(await restriction).toBeNull();
            expect(await admission).toMatchObject({ error: { code: "ADMISSION_RESTRICTED" } });
            await expect(surveys.attempt(room.id, token, new Date())).rejects.toMatchObject({
              code: "UNAUTHORIZED",
            });
          } else {
            expect(await restriction).toBe(rollback);
            expect(await admission).toMatchObject({ attempt: { roomId: room.id, revision: 0 } });
            expect(await surveys.attempt(room.id, token, new Date())).toMatchObject({
              roomId: room.id,
            });
          }
        },
      );

      it("rechecks the Survey deadline after waiting for the workspace lock", async () => {
        const locked = signal();
        const release = signal();
        const restriction = platform.withTransaction(async (transaction) => {
          await transaction.setWorkspaceAdmissionRestriction(owner.workspaceId, false);
          locked.resolve();
          await release.promise;
        });
        await locked.promise;
        let now = new Date();
        let settled = false;
        const token = guestToken();
        const admission = surveys
          .admit(room.id, token, () => now)
          .then(
            (attempt) => {
              settled = true;
              return { attempt };
            },
            (error: unknown) => {
              settled = true;
              return { error };
            },
          );
        try {
          await expectAdmissionWaiting(() => settled);
          now = new Date(room.closesAt);
        } finally {
          release.resolve();
          await restriction;
          await admission;
        }
        expect(await admission).toMatchObject({ error: { code: "ROOM_CLOSED" } });
        await expect(surveys.attempt(room.id, token, new Date())).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      });
    },
  );
}
