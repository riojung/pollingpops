import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function fixture(enabled = true) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    LOG_LEVEL: "silent",
    FEATURE_AUDIENCE_SCOPES: "true",
    FEATURE_FEEDBACK_ROOMS: "true",
    FEATURE_SURVEYS: String(enabled),
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "survey-owner@example.com", segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token");
  const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
  return { app, config, repository, headers: { cookie } };
}
describe("Survey creator and participant APIs", () => {
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
      expect(accepted.statusCode, accepted.body).toBe(200);
      const memberHeaders = { cookie: String(accepted.headers["set-cookie"]).split(";")[0]! };
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
