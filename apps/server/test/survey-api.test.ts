import { verifyEmailAndSignIn, requestPinAndSignIn } from "./support/email-auth.js";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { ApiErrorSchema } from "@openround/contracts";
import { MemoryRepository, SurveyRepository, createPlatformRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.useRealTimers();
});
async function fixture(
  enabled = true,
  options: {
    plan?: "free" | "pro";
    communityRetentionDays?: number;
    businessEnabled?: boolean;
  } = {},
) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({
    initialWorkspaceId: workspaceId,
    initialPlan: options.plan,
  });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: String(options.communityRetentionDays !== undefined),
    COMMUNITY_REPORT_RETENTION_DAYS: options.communityRetentionDays,
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    LOG_LEVEL: "silent",
    FEATURE_AUDIENCE_SCOPES: "true",
    FEATURE_FEEDBACK_ROOMS: "true",
    FEATURE_SURVEYS: String(enabled),
    BUSINESS_PLATFORM_ENABLED: String(options.businessEnabled ?? false),
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  app = built.app;
  return { app, config, repository, workspaceId, headers: await signIn(app) };
}
async function signIn(app: FastifyInstance) {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "survey-owner@example.com", segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token");
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "survey-owner@example.com",
  );
  const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
  return { cookie };
}
describe("Survey creator and participant APIs", () => {
  // Nine real scrypt derivations cover creation retries and both admission paths on shared CI CPUs.
  it("gates protected rooms, admits exact passwords through codes and direct links, and preserves bearer resume", async () => {
    const { app, headers, repository, workspaceId } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
    });
    const id = created.json().survey.id;
    await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/publish`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    const password = " Exact Survey room ";
    const body = { idempotencyKey: randomUUID(), expectedRevision: 0, joinPassword: password };
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: body,
    });
    expect(blocked.statusCode, blocked.body).toBe(402);
    expect(blocked.json().error.code).toBe("ENTITLEMENT_LIMIT");
    const noRooms = await app.inject({ method: "GET", url: "/v1/survey-rooms", headers });
    expect(noRooms.json().rooms).toHaveLength(0);
    await repository.setPlan(workspaceId, "pro");
    const shared = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: body,
    });
    expect(shared.statusCode, shared.body).toBe(201);
    const room = shared.json().room;
    expect(room.passwordRequired).toBe(true);
    const retried = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: body,
    });
    expect(retried.json()).toEqual(shared.json());
    const changed = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: { ...body, joinPassword: "A different password" },
    });
    expect(changed.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    const preflight = await app.inject({
      method: "GET",
      url: `/v1/live-rooms/join/preflight?code=${room.code}`,
    });
    expect(preflight.json()).toMatchObject({
      passwordRequired: true,
      artifactType: "feedback_room",
    });
    const metadata = await app.inject({ method: "GET", url: `/v1/survey-rooms/${room.id}/public` });
    expect(metadata.json().room).toMatchObject({ id: room.id, passwordRequired: true });
    expect(metadata.body).not.toContain("content");
    const guestHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    const unauthorized = await app.inject({
      method: "GET",
      url: `/v1/survey-rooms/${room.id}/attempt`,
      headers: guestHeaders,
    });
    expect(unauthorized.statusCode).toBe(401);
    for (const [supplied, code] of [
      [undefined, "PASSWORD_REQUIRED"],
      [password.trim(), "INVALID_PASSWORD"],
      [password.toLowerCase(), "INVALID_PASSWORD"],
    ] as const) {
      const failed = await app.inject({
        method: "POST",
        url: "/v1/survey-rooms/join",
        headers: guestHeaders,
        payload: { code: room.code, ...(supplied === undefined ? {} : { password: supplied }) },
      });
      expect(failed.statusCode, failed.body).toBe(401);
      expect(ApiErrorSchema.parse(failed.json()).error.code).toBe(code);
    }
    const stillUnauthorized = await app.inject({
      method: "GET",
      url: `/v1/survey-rooms/${room.id}/attempt`,
      headers: guestHeaders,
    });
    expect(stillUnauthorized.statusCode).toBe(401);
    const joined = await app.inject({
      method: "POST",
      url: "/v1/survey-rooms/join",
      headers: guestHeaders,
      payload: { code: room.code, password },
    });
    expect(joined.statusCode, joined.body).toBe(200);
    await repository.setPlan(workspaceId, "free");
    const downgradedRetry = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: body,
    });
    expect(downgradedRetry.json()).toEqual(shared.json());
    const changedAfterDowngrade = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: { ...body, joinPassword: "A different password" },
    });
    expect(changedAfterDowngrade.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    const newAfterDowngrade = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: { ...body, idempotencyKey: randomUUID() },
    });
    expect(newAfterDowngrade.json().error.code).toBe("ENTITLEMENT_LIMIT");
    const resumed = await app.inject({
      method: "POST",
      url: `/v1/survey-rooms/${room.id}/join`,
      headers: guestHeaders,
      payload: {},
    });
    expect(resumed.json()).toEqual(joined.json());
    const directHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    const directMissing = await app.inject({
      method: "POST",
      url: `/v1/survey-rooms/${room.id}/join`,
      headers: directHeaders,
      payload: {},
    });
    expect(ApiErrorSchema.parse(directMissing.json()).error.code).toBe("PASSWORD_REQUIRED");
    const direct = await app.inject({
      method: "POST",
      url: `/v1/survey-rooms/${room.id}/join`,
      headers: directHeaders,
      payload: { password },
    });
    expect(direct.statusCode, direct.body).toBe(200);
    for (const response of [
      shared,
      retried,
      preflight,
      metadata,
      unauthorized,
      joined,
      resumed,
      direct,
    ]) {
      expect(response.body).not.toContain(password);
      expect(response.body).not.toContain("joinPasswordHash");
      expect(response.body).not.toContain("scrypt$");
    }
  }, 15_000);

  it.each([true, false])(
    "blocks new Survey admissions and preserves existing guests when business writers are enabled=%s",
    async (businessEnabled) => {
      const { app, headers, repository, workspaceId } = await fixture(true, { businessEnabled });
      const created = await app.inject({
        method: "POST",
        url: "/v1/surveys",
        headers,
        payload: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().survey.id;
      const published = await app.inject({
        method: "POST",
        url: `/v1/surveys/${id}/publish`,
        headers,
        payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
      });
      expect(published.statusCode, published.body).toBe(200);
      const shared = await app.inject({
        method: "POST",
        url: `/v1/surveys/${id}/rooms`,
        headers,
        payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
      });
      expect(shared.statusCode, shared.body).toBe(201);
      const room = shared.json().room;
      const admittedHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      const joined = await app.inject({
        method: "POST",
        url: "/v1/survey-rooms/join",
        headers: admittedHeaders,
        payload: { code: room.code },
      });
      expect(joined.statusCode, joined.body).toBe(200);
      const platform = createPlatformRepository(repository);
      await platform.setWorkspaceAdmissionRestriction(workspaceId, true);
      const newGuestHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      const blocked = await app.inject({
        method: "POST",
        url: "/v1/survey-rooms/join",
        headers: newGuestHeaders,
        payload: { code: room.code },
      });
      expect(blocked.statusCode, blocked.body).toBe(403);
      expect(blocked.json().error.code).toBe("ADMISSION_RESTRICTED");
      const resumed = await app.inject({
        method: "POST",
        url: "/v1/survey-rooms/join",
        headers: admittedHeaders,
        payload: { code: room.code },
      });
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect(resumed.json()).toEqual(joined.json());
      const draft = await app.inject({
        method: "POST",
        url: `/v1/survey-rooms/${room.id}/draft`,
        headers: admittedHeaders,
        payload: { idempotencyKey: randomUUID(), expectedRevision: 0, responses: {} },
      });
      expect(draft.statusCode, draft.body).toBe(200);
      expect(draft.json().attempt.revision).toBe(1);
      await platform.setWorkspaceAdmissionRestriction(workspaceId, false);
      const unblocked = await app.inject({
        method: "POST",
        url: "/v1/survey-rooms/join",
        headers: newGuestHeaders,
        payload: { code: room.code },
      });
      expect(unblocked.statusCode, unblocked.body).toBe(200);
    },
  );
  it.each(["blank", "template", "duplicate"] as const)(
    "replays a lost legacy %s creation response after deploying v2 writers",
    async (mode) => {
      const { app, headers } = await fixture();
      const create = SurveyRepository.prototype.create;
      // Model the previous release accepting a request and storing its v1 hash/receipt.
      const legacyWriter = vi
        .spyOn(SurveyRepository.prototype, "create")
        .mockImplementation(function (this: SurveyRepository, workspaceId, id, draft, key) {
          return create.call(this, workspaceId, id, { ...draft, schemaVersion: 1 }, key);
        });
      const idempotencyKey = randomUUID();
      let sourceId: string | undefined;
      try {
        if (mode === "duplicate") {
          const source = await app.inject({
            method: "POST",
            url: "/v1/surveys",
            headers,
            payload: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
          });
          expect(source.statusCode, source.body).toBe(201);
          sourceId = source.json().survey.id;
        }
        const payload = {
          idempotencyKey,
          ...(mode === "blank" ? { title: "Legacy blank Survey" } : {}),
          ...(mode === "template" ? { templateId: "training-feedback" } : {}),
          ...(sourceId ? { sourceId } : {}),
        };
        const original = await app.inject({ method: "POST", url: "/v1/surveys", headers, payload });
        expect(original.statusCode, original.body).toBe(201);
        expect(original.json().survey.schemaVersion).toBe(1);
        legacyWriter.mockRestore();

        const retry = await app.inject({ method: "POST", url: "/v1/surveys", headers, payload });
        expect(retry.statusCode, retry.body).toBe(201);
        expect(retry.json()).toEqual(original.json());
        const conflict = await app.inject({
          method: "POST",
          url: "/v1/surveys",
          headers,
          payload: { idempotencyKey, title: "A different Survey" },
        });
        expect(conflict.statusCode, conflict.body).toBe(409);
        expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
        const listed = await app.inject({ method: "GET", url: "/v1/surveys", headers });
        expect(listed.json().surveys).toHaveLength(mode === "duplicate" ? 2 : 1);
      } finally {
        legacyWriter.mockRestore();
      }
    },
  );
  it.each([
    { edition: "Free", plan: "free" as const, retentionDays: 30 },
    { edition: "Pro", plan: "pro" as const, retentionDays: 365 },
    { edition: "Community", plan: "free" as const, retentionDays: 1, communityRetentionDays: 1 },
  ])(
    "keeps a 30-day $edition run readable after natural closure until post-close retention expires",
    async (options) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { app, headers, repository } = await fixture(true, options);
      const created = await app.inject({
        method: "POST",
        url: "/v1/surveys",
        headers,
        payload: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().survey.id;
      await app.inject({
        method: "POST",
        url: `/v1/surveys/${id}/publish`,
        headers,
        payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
      });
      const roomBody = { idempotencyKey: randomUUID(), expectedRevision: 0, windowDays: 30 };
      const shared = await app.inject({
        method: "POST",
        url: `/v1/surveys/${id}/rooms`,
        headers,
        payload: roomBody,
      });
      expect(shared.statusCode, shared.body).toBe(201);
      const room = shared.json().room;
      expect(Date.parse(room.closesAt) - Date.now()).toBe(30 * 86400000);
      expect(Date.parse(room.expiresAt) - Date.parse(room.closesAt)).toBe(
        options.retentionDays * 86400000,
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/surveys/${id}/rooms`,
            headers,
            payload: roomBody,
          })
        ).json().room,
      ).toEqual(room);
      for (let i = 0; i < 5; i++) {
        const guestHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
        const joined = await app.inject({
          method: "POST",
          url: "/v1/survey-rooms/join",
          headers: guestHeaders,
          payload: { code: room.code },
        });
        const responses = Object.fromEntries(
          joined
            .json()
            .attempt.content.items.map(
              ({
                question,
              }: {
                question: { id: string; type: string; choices?: { id: string }[] };
              }) => [
                question.id,
                question.type === "poll"
                  ? { kind: "poll", choiceIds: [question.choices![0]!.id] }
                  : { kind: "rating", value: 4 },
              ],
            ),
        );
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/v1/survey-rooms/${room.id}/submit`,
              headers: guestHeaders,
              payload: { idempotencyKey: randomUUID(), expectedRevision: 0, responses },
            })
          ).statusCode,
        ).toBe(200);
      }
      const collecting = (
        await app.inject({ method: "GET", url: `/v1/survey-rooms/${room.id}/results`, headers })
      ).json().results;
      expect(collecting).toMatchObject({
        suppressed: true,
        resultsStatus: "collecting",
        submittedCount: 5,
      });
      vi.setSystemTime(new Date(room.closesAt));
      // A 30-day creator session also expires here, so sign back in as an actual returning owner.
      const returningOwner = await signIn(app);
      await repository.purgeExpired(new Date());
      const results = await app.inject({
        method: "GET",
        url: `/v1/survey-rooms/${room.id}/results`,
        headers: returningOwner,
      });
      expect(results.statusCode, results.body).toBe(200);
      expect(results.json().results).toMatchObject({
        suppressed: false,
        resultsStatus: "available",
        submittedCount: 5,
      });
      expect(results.json().results.questions[0].distribution[0].count).toBe(5);
      vi.setSystemTime(new Date(Date.parse(room.expiresAt) - 1));
      const retainedOwner = await signIn(app);
      await repository.purgeExpired(new Date());
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/survey-rooms/${room.id}/results`,
            headers: retainedOwner,
          })
        ).statusCode,
      ).toBe(200);
      vi.setSystemTime(new Date(room.expiresAt));
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/survey-rooms/${room.id}/results`,
            headers: retainedOwner,
          })
        ).statusCode,
      ).toBe(404);
      await repository.purgeExpired(new Date());
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/survey-rooms/${room.id}`,
            headers: retainedOwner,
          })
        ).statusCode,
      ).toBe(404);
    },
  );
  it("releases distributions only after closure and keeps accepted submission retries stable", async () => {
    const { app, headers } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
    });
    const id = created.json().survey.id;
    await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/publish`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    const shared = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    expect(shared.statusCode, shared.body).toBe(201);
    const room = shared.json().room;
    let lastSubmission: { headers: { authorization: string }; body: object; receipt: unknown };
    for (let i = 0; i < 6; i++) {
      const guestHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      const joined = await app.inject({
        method: "POST",
        url: "/v1/survey-rooms/join",
        headers: guestHeaders,
        payload: { code: room.code },
      });
      expect(joined.statusCode, joined.body).toBe(200);
      const responses = Object.fromEntries(
        joined
          .json()
          .attempt.content.items.map(
            ({
              question,
            }: {
              question: { id: string; type: string; choices?: { id: string }[] };
            }) => [
              question.id,
              question.type === "poll"
                ? { kind: "poll", choiceIds: [question.choices![i === 5 ? 1 : 0]!.id] }
                : { kind: "rating", value: i === 5 ? 2 : 4 },
            ],
          ),
      );
      const body = { idempotencyKey: randomUUID(), expectedRevision: 0, responses };
      const submitted = await app.inject({
        method: "POST",
        url: `/v1/survey-rooms/${room.id}/submit`,
        headers: guestHeaders,
        payload: body,
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      lastSubmission = { headers: guestHeaders, body, receipt: submitted.json() };
      const results = (
        await app.inject({ method: "GET", url: `/v1/survey-rooms/${room.id}/results`, headers })
      ).json().results;
      expect(results).toMatchObject({
        suppressed: true,
        resultsStatus: "collecting",
        submittedCount: i + 1,
      });
      expect(
        results.questions.every(
          (q: { answeredCount: number | null; distribution: unknown[] }) =>
            q.answeredCount === null && q.distribution.length === 0,
        ),
      ).toBe(true);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/survey-rooms/${room.id}/close`,
          headers,
          payload: { idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(204);
    const final = (
      await app.inject({ method: "GET", url: `/v1/survey-rooms/${room.id}/results`, headers })
    ).json();
    expect(final.results).toMatchObject({
      suppressed: false,
      resultsStatus: "available",
      submittedCount: 6,
    });
    expect(final.results.questions[0].distribution.map((r: { count: number }) => r.count)).toEqual([
      5, 1, 0, 0,
    ]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/survey-rooms/${room.id}/submit`,
          headers: lastSubmission!.headers,
          payload: lastSubmission!.body,
        })
      ).json(),
    ).toEqual(lastSubmission!.receipt);
    expect(
      (
        await app.inject({ method: "GET", url: `/v1/survey-rooms/${room.id}/results`, headers })
      ).json(),
    ).toEqual(final);
  });
  it("allows editors to close runs but reserves permanent deletion for the workspace owner", async () => {
    const { app, headers } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
    });
    const id = created.json().survey.id;
    await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/publish`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    const shared = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    const room = shared.json().room;
    const guestHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    await app.inject({
      method: "POST",
      url: "/v1/survey-rooms/join",
      headers: guestHeaders,
      payload: { code: room.code },
    });
    for (const role of ["editor", "viewer"] as const) {
      const invitation = await app.inject({
        method: "POST",
        url: "/v1/workspace/invitations",
        headers,
        payload: { email: `survey-${role}@example.com`, role },
      });
      expect(invitation.statusCode, invitation.body).toBe(201);
      const token = new URL(invitation.json().debugUrl).searchParams.get("token");
      const accepted = await app.inject({
        method: "POST",
        url: "/v1/invitations/accept",
        payload: { token, acceptPolicies: true },
      });
      expect(accepted.headers["set-cookie"]).toBeUndefined();
      const acceptedSignIn = await requestPinAndSignIn(app, `survey-${role}@example.com`);
      expect(accepted.statusCode, accepted.body).toBe(200);
      const memberHeaders = { cookie: String(acceptedSignIn.headers["set-cookie"]).split(";")[0]! };
      const denied = await app.inject({
        method: "DELETE",
        url: `/v1/survey-rooms/${room.id}`,
        headers: memberHeaders,
      });
      expect(denied.statusCode, denied.body).toBe(403);
      expect(denied.json().error).toMatchObject({
        code: "UNAUTHORIZED",
        message: expect.stringContaining("owner"),
      });
      expect(
        (await app.inject({ method: "GET", url: `/v1/survey-rooms/${room.id}`, headers }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/survey-rooms/${room.id}/attempt`,
            headers: guestHeaders,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/survey-rooms/${room.id}/close`,
            headers: memberHeaders,
            payload: { idempotencyKey: randomUUID() },
          })
        ).statusCode,
      ).toBe(role === "editor" ? 204 : 403);
    }
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/survey-rooms/${room.id}`,
          headers: guestHeaders,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/survey-rooms/${room.id}`, headers }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/survey-rooms/${room.id}/attempt`,
          headers: guestHeaders,
        })
      ).statusCode,
    ).toBe(404);
  });
  it("creates a true self-paced Survey, joins without identity, resumes and finalizes anonymously", async () => {
    const { app, headers, repository } = await fixture();
    const createBody = { idempotencyKey: randomUUID(), templateId: "training-feedback" };
    const created = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: createBody,
    });
    expect(created.statusCode, created.body).toBe(201);
    const survey = created.json().survey;
    const retry = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: createBody,
    });
    expect(retry.json()).toEqual(created.json());
    const publish = await app.inject({
      method: "POST",
      url: `/v1/surveys/${survey.id}/publish`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    expect(publish.statusCode, publish.body).toBe(200);
    const shared = await app.inject({
      method: "POST",
      url: `/v1/surveys/${survey.id}/rooms`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    expect(shared.statusCode, shared.body).toBe(201);
    const room = shared.json().room;
    const preflight = await app.inject({
      method: "GET",
      url: `/v1/live-rooms/join/preflight?code=${room.code}`,
    });
    expect(preflight.json()).toMatchObject({
      artifactType: "feedback_room",
      nicknamePolicy: "friendly_only",
      destination: `/survey/${room.id}`,
    });
    const bearer = randomBytes(32).toString("hex");
    const guestHeaders = { authorization: `Bearer ${bearer}` };
    const join = await app.inject({
      method: "POST",
      url: "/v1/survey-rooms/join",
      headers: guestHeaders,
      payload: { code: room.code },
    });
    expect(join.statusCode, join.body).toBe(200);
    const attempt = join.json().attempt;
    expect(JSON.stringify(attempt)).not.toMatch(
      /"(?:guestId|tokenHash|workspaceId|alias|score|correctness)":/,
    );
    expect(
      (await app.inject({ method: "GET", url: `/v1/survey-rooms/${room.id}/attempt`, headers }))
        .statusCode,
    ).toBe(401);
    const incomplete = await app.inject({
      method: "POST",
      url: `/v1/survey-rooms/${room.id}/submit`,
      headers: guestHeaders,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0, responses: {} },
    });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json().error.message).toContain("Question 1");
    const responses: Record<string, unknown> = {};
    for (const { question } of attempt.content.items)
      responses[question.id] =
        question.type === "poll"
          ? { kind: "poll", choiceIds: [question.choices[0].id] }
          : { kind: "rating", value: 4 };
    const save = await app.inject({
      method: "POST",
      url: `/v1/survey-rooms/${room.id}/draft`,
      headers: guestHeaders,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0, responses },
    });
    expect(save.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/survey-rooms/${room.id}/attempt`,
          headers: guestHeaders,
        })
      ).json().attempt.responses,
    ).toEqual(responses);
    const finalBody = { idempotencyKey: randomUUID(), expectedRevision: 1, responses };
    const final = await app.inject({
      method: "POST",
      url: `/v1/survey-rooms/${room.id}/submit`,
      headers: guestHeaders,
      payload: finalBody,
    });
    expect(final.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/survey-rooms/${room.id}/submit`,
          headers: guestHeaders,
          payload: finalBody,
        })
      ).json(),
    ).toEqual(final.json());
    const report = await app.inject({
      method: "GET",
      url: `/v1/survey-rooms/${room.id}/results`,
      headers,
    });
    expect(report.json().results).toMatchObject({ suppressed: true, submittedCount: 1 });
    expect(JSON.stringify(report.json())).not.toMatch(/responses|guestId|receipt|alias/);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/survey-rooms/${room.id}/results`,
          headers: guestHeaders,
        })
      ).statusCode,
    ).toBe(401);
    expect((await repository.getLiveRoomCode(room.code, new Date()))?.artifactType).toBe(
      "feedback_room",
    );
  });
  it("gates new creation and publication while retaining accepted read/edit/submit routes", async () => {
    const { app, headers, config } = await fixture();
    const create = await app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers,
      payload: { idempotencyKey: randomUUID(), templateId: "icebreaker-poll" },
    });
    const id = create.json().survey.id;
    await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/publish`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    const shared = await app.inject({
      method: "POST",
      url: `/v1/surveys/${id}/rooms`,
      headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
    });
    expect(shared.statusCode, shared.body).toBe(201);
    const room = shared.json().room;
    const guestHeaders = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    const joined = await app.inject({
      method: "POST",
      url: "/v1/survey-rooms/join",
      headers: guestHeaders,
      payload: { code: room.code },
    });
    expect(joined.statusCode, joined.body).toBe(200);
    config.FEATURE_SURVEYS = false;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/surveys",
          headers,
          payload: { idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `/v1/surveys/${id}`, headers })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/me", headers })).json().productFeatures
        .surveys,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/surveys/${id}/publish`,
          headers,
          payload: { idempotencyKey: randomUUID(), expectedRevision: 0 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/survey-rooms/${room.id}/attempt`,
          headers: guestHeaders,
        })
      ).statusCode,
    ).toBe(200);
    const responses = Object.fromEntries(
      joined
        .json()
        .attempt.content.items.map(
          ({
            question,
          }: {
            question: { id: string; type: string; choices?: { id: string }[]; min?: number };
          }) => [
            question.id,
            question.type === "poll"
              ? { kind: "poll", choiceIds: [question.choices![0]!.id] }
              : { kind: "rating", value: question.min },
          ],
        ),
    );
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/survey-rooms/${room.id}/submit`,
      headers: guestHeaders,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0, responses },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().attempt.finalized).toBe(true);
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/surveys/${id}`,
      headers,
      payload: {
        idempotencyKey: randomUUID(),
        expectedRevision: 0,
        draft: { ...create.json().survey.draft, title: "Editable during a creation pause" },
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
  });
  it("rejects graded templates and invalid pagination", async () => {
    const { app, headers } = await fixture();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/surveys",
          headers,
          payload: { idempotencyKey: randomUUID(), templateId: "misconception-check" },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ method: "GET", url: "/v1/surveys?limit=51", headers })).statusCode,
    ).toBe(400);
  });
});
