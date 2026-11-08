import Fastify, { type FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, createPresentationAssignmentRepository } from "@openround/db";
import { presentationSharingFixture } from "../../../packages/db/test/support/presentation-sharing-conformance.js";
import { registerPresentationAssignmentRoutes } from "../src/presentation-assignment-routes.js";
import { ConfigSchema } from "../src/config.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const token = () => randomBytes(32).toString("base64url");
async function fixture() {
  const repository = new MemoryRepository();
  const mediaId = randomUUID();
  const source = await presentationSharingFixture(repository, "assignment-api", mediaId);
  const assignments = createPresentationAssignmentRepository(repository);
  const enabled = { value: true };
  const admitted = { value: true };
  const actor = { value: source.actor };
  const readImage = vi.fn(async () => Buffer.alloc(8));
  const app = Fastify({ logger: false });
  apps.push(app);
  await registerPresentationAssignmentRoutes(app, {
    auth: { requireCreator: async () => actor.value },
    repository,
    assignments,
    storage: { readImage },
    config: ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      LOG_LEVEL: "silent",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
    }),
    consumeAdmission: async () => admitted.value,
    featureEnabled: async () => enabled.value,
  });
  const createInput = {
    requestId: randomUUID(),
    versionId: source.version.id,
    token: token(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  const create = (payload = createInput) =>
    app.inject({
      method: "POST",
      url: `/v1/presentations/${source.presentation.id}/assignments`,
      payload,
    });
  const preview = (id: string, key = createInput.token) =>
    app.inject({
      url: `/v1/presentation-assignments/${id}`,
      headers: { authorization: `Bearer ${key}` },
    });
  const start = (
    id: string,
    input: { attemptId: string; token: string } = { attemptId: randomUUID(), token: token() },
    key = createInput.token,
  ) =>
    app.inject({
      method: "POST",
      url: `/v1/presentation-assignments/${id}/attempts`,
      headers: { authorization: `Bearer ${key}` },
      payload: input,
    });
  const resume = (id: string, attemptId: string, key: string) =>
    app.inject({
      url: `/v1/presentation-assignments/${id}/attempts/${attemptId}`,
      headers: { authorization: `Bearer ${key}` },
    });
  const progress = (id: string, attemptId: string, key: string, payload: object) =>
    app.inject({
      method: "POST",
      url: `/v1/presentation-assignments/${id}/attempts/${attemptId}/progress`,
      headers: { authorization: `Bearer ${key}` },
      payload,
    });
  const image = (id: string, key = createInput.token, target = mediaId) =>
    app.inject({
      url: `/v1/presentation-assignments/${id}/media/${target}`,
      headers: { authorization: `Bearer ${key}` },
    });
  const revoke = (id: string) =>
    app.inject({
      method: "DELETE",
      url: `/v1/presentations/${source.presentation.id}/assignments/${id}`,
    });
  return {
    ...source,
    repository,
    assignments,
    app,
    enabled,
    admitted,
    actor,
    readImage,
    mediaId,
    createInput,
    create,
    preview,
    start,
    resume,
    progress,
    image,
    revoke,
  };
}

describe("self-paced reading assignment APIs", () => {
  it("canonicalizes UUID case for creation, start, resume and exact progress retry", async () => {
    const f = await fixture();
    const created = await f.app.inject({
      method: "POST",
      url: `/v1/presentations/${f.presentation.id.toUpperCase()}/assignments`,
      payload: {
        ...f.createInput,
        requestId: f.createInput.requestId.toUpperCase(),
        versionId: f.createInput.versionId.toUpperCase(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((await f.create()).json()).toEqual({ ...created.json(), replayed: true });
    const id = created.json().assignment.id;
    const input = { attemptId: randomUUID(), token: token() };
    const started = await f.start(id.toUpperCase(), {
      ...input,
      attemptId: input.attemptId.toUpperCase(),
    });
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json().attempt.id).toBe(input.attemptId);
    expect((await f.start(id, input)).json()).toEqual({ ...started.json(), replayed: true });
    const mark = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: f.content.blocks[0]!.id,
    };
    const first = await f.progress(id.toUpperCase(), input.attemptId.toUpperCase(), input.token, {
      ...mark,
      requestId: mark.requestId.toUpperCase(),
      blockId: mark.blockId.toUpperCase(),
    });
    expect(first.statusCode, first.body).toBe(200);
    const retry = await f.progress(id, input.attemptId, input.token, mark);
    expect(retry.json()).toEqual({ ...first.json(), replayed: true });
    expect(
      (await f.resume(id.toUpperCase(), input.attemptId.toUpperCase(), input.token)).json().attempt,
    ).toEqual(first.json().attempt);
  });

  it("requires current creator authority within the source workspace", async () => {
    const f = await fixture();
    f.actor.value = { ...f.actor.value, role: "viewer" };
    expect((await f.create()).statusCode).toBe(404);
    f.actor.value = { ...f.actor.value, role: "owner", workspaceId: randomUUID() };
    expect((await f.create()).statusCode).toBe(404);
    expect(
      (await f.app.inject({ url: `/v1/presentations/${f.presentation.id}/assignments` }))
        .statusCode,
    ).toBe(404);
  });

  it("pins the publication, keeps preview read-only and excludes private authoring data and credentials", async () => {
    const f = await fixture();
    const created = await f.create();
    expect(created.statusCode, created.body).toBe(201);
    const { assignment, url } = created.json();
    expect(assignment).toMatchObject({ mode: "reading", versionId: f.version.id });
    expect(url).toBe(
      `http://localhost:3000/presentation-assignment/${assignment.id}#token=${f.createInput.token}`,
    );
    const view = await f.preview(assignment.id);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({ assignment, review: { versionId: f.version.id } });
    expect(view.json()).not.toHaveProperty("attempt");
    expect(view.body).not.toMatch(
      /PRIVATE_|correctValue|explanation|speakerNotes|tokenHash|intentHash/,
    );
    expect(view.headers["cache-control"]).toContain("no-store");
    expect(view.headers["referrer-policy"]).toBe("no-referrer");
    expect(view.headers["x-robots-tag"]).toContain("noindex");
    expect((await f.preview(assignment.id, token())).statusCode).toBe(404);
    const listed = await f.app.inject({
      url: `/v1/presentations/${f.presentation.id}/assignments`,
    });
    expect(listed.json()).toEqual({ assignments: [assignment] });
    expect(listed.body).not.toContain(f.createInput.token);
    const retried = await f.create();
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toEqual({ ...created.json(), replayed: true });
    expect((await f.create({ ...f.createInput, token: token() })).statusCode).toBe(409);
  });

  it("starts explicitly and requires the attempt credential rather than the shared assignment link", async () => {
    const f = await fixture();
    const { assignment } = (await f.create()).json();
    const input = { attemptId: randomUUID(), token: token() };
    const started = await f.start(assignment.id, input);
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json()).toMatchObject({
      attempt: { id: input.attemptId, revision: 0, readBlockIds: [], completedAt: null },
      replayed: false,
    });
    expect(started.json()).not.toHaveProperty("review");
    expect(started.body).not.toContain(input.token);
    const retry = await f.start(assignment.id, input);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual({ ...started.json(), replayed: true });
    expect((await f.start(assignment.id, { ...input, token: token() })).statusCode).toBe(409);
    expect((await f.resume(assignment.id, input.attemptId, f.createInput.token)).statusCode).toBe(
      404,
    );
    expect((await f.resume(assignment.id, input.attemptId, token())).statusCode).toBe(404);
    const snapshot = await f.resume(assignment.id, input.attemptId, input.token);
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    expect(snapshot.json()).toMatchObject({
      review: { versionId: f.version.id },
      attempt: started.json().attempt,
    });
    const other = (
      await f.create({ ...f.createInput, requestId: randomUUID(), token: token() })
    ).json();
    expect((await f.resume(other.assignment.id, input.attemptId, input.token)).statusCode).toBe(
      404,
    );
  });

  it("records explicit page acknowledgements with revision fences and completes only after all pages", async () => {
    const f = await fixture();
    const { assignment } = (await f.create()).json();
    const input = { attemptId: randomUUID(), token: token() };
    await f.start(assignment.id, input);
    const send = (payload: object) =>
      f.progress(assignment.id, input.attemptId, input.token, payload);
    const premature = await send({
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "complete",
    });
    expect([409, 422]).toContain(premature.statusCode);
    const mark = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: f.content.blocks[0]!.id,
    };
    const first = await send(mark);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().attempt).toMatchObject({
      revision: 1,
      readBlockIds: [mark.blockId],
      completedAt: null,
    });
    const duplicate = await send(mark);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json()).toEqual({ ...first.json(), replayed: true });
    expect((await send({ ...mark, blockId: f.content.blocks[1]!.id })).statusCode).toBe(409);
    expect(
      (await send({ ...mark, requestId: randomUUID(), blockId: f.content.blocks[1]!.id }))
        .statusCode,
    ).toBe(409);
    const last = await send({
      requestId: randomUUID(),
      expectedRevision: 1,
      kind: "read",
      blockId: f.content.blocks[1]!.id,
    });
    expect(last.statusCode, last.body).toBe(200);
    expect(last.json().attempt.completedAt).toBeNull();
    const completion = {
      requestId: randomUUID(),
      expectedRevision: last.json().attempt.revision,
      kind: "complete",
    };
    const completed = await send(completion);
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json().attempt.completedAt).toEqual(expect.any(String));
    expect(completed.json()).not.toHaveProperty("score");
    expect(completed.json()).not.toHaveProperty("review");
    const retry = await send(completion);
    expect(retry.json()).toEqual({ ...completed.json(), replayed: true });
    const restored = await f.resume(assignment.id, input.attemptId, input.token);
    expect(restored.json().attempt).toEqual(completed.json().attempt);
  });

  it("rejects foreign pages and activity responses without recording progress", async () => {
    const f = await fixture();
    const { assignment } = (await f.create()).json();
    const input = { attemptId: randomUUID(), token: token() };
    await f.start(assignment.id, input);
    const unknown = await f.progress(assignment.id, input.attemptId, input.token, {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: randomUUID(),
    });
    expect([409, 422]).toContain(unknown.statusCode);
    const answer = await f.progress(assignment.id, input.attemptId, input.token, {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "read",
      blockId: f.content.blocks[1]!.id,
      response: { kind: "numeric", value: "917" },
    });
    expect(answer.statusCode).toBe(422);
    expect(
      (await f.resume(assignment.id, input.attemptId, input.token)).json().attempt,
    ).toMatchObject({ revision: 0, readBlockIds: [] });
  });

  it("fences previews, attempts, progress and images after revocation", async () => {
    const f = await fixture();
    const { assignment } = (await f.create()).json();
    const input = { attemptId: randomUUID(), token: token() };
    await f.start(assignment.id, input);
    expect((await f.image(assignment.id)).statusCode).toBe(200);
    expect((await f.revoke(assignment.id)).statusCode).toBe(204);
    expect((await f.revoke(assignment.id)).statusCode).toBe(204);
    expect((await f.preview(assignment.id)).statusCode).toBe(404);
    expect((await f.resume(assignment.id, input.attemptId, input.token)).statusCode).toBe(404);
    expect((await f.start(assignment.id, input)).statusCode).toBe(404);
    expect(
      (
        await f.progress(assignment.id, input.attemptId, input.token, {
          requestId: randomUUID(),
          expectedRevision: 0,
          kind: "read",
          blockId: f.content.blocks[0]!.id,
        })
      ).statusCode,
    ).toBe(404);
    expect((await f.image(assignment.id)).statusCode).toBe(404);
  });

  it("uses deadline and feature fences without rotating accepted creation receipts", async () => {
    const f = await fixture();
    const created = await f.create();
    const { assignment } = created.json();
    const input = { attemptId: randomUUID(), token: token() };
    await f.start(assignment.id, input);
    f.enabled.value = false;
    expect((await f.preview(assignment.id)).statusCode).toBe(404);
    expect((await f.resume(assignment.id, input.attemptId, input.token)).statusCode).toBe(404);
    expect((await f.create()).statusCode).toBe(404);
    f.enabled.value = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(assignment.expiresAt) + 1));
    expect((await f.preview(assignment.id)).statusCode).toBe(404);
    expect((await f.resume(assignment.id, input.attemptId, input.token)).statusCode).toBe(404);
    expect((await f.start(assignment.id, input)).statusCode).toBe(404);
    const replay = await f.create();
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual({ ...created.json(), replayed: true });
    expect(
      (await f.create({ ...f.createInput, requestId: randomUUID(), token: token() })).statusCode,
    ).toBe(410);
  });

  it("rechecks image access after an in-flight read and bounds image concurrency", async () => {
    const f = await fixture();
    const { assignment } = (await f.create()).json();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    f.readImage.mockImplementation(async () => {
      await gate;
      return Buffer.alloc(8);
    });
    const admitted = Array.from({ length: 4 }, () => f.image(assignment.id));
    await vi.waitFor(() => expect(f.readImage).toHaveBeenCalledTimes(4));
    const busy = await f.image(assignment.id);
    expect(busy.statusCode, busy.body).toBe(503);
    expect(busy.headers["retry-after"]).toBe("1");
    await f.revoke(assignment.id);
    release();
    for (const response of await Promise.all(admitted)) expect(response.statusCode).toBe(404);
    expect(f.readImage).toHaveBeenCalledTimes(4);
  });

  it("rejects malformed credentials, unrelated images and denied admissions", async () => {
    const f = await fixture();
    const { assignment } = (await f.create()).json();
    expect((await f.preview(assignment.id, "not-a-capability")).statusCode).toBe(404);
    expect((await f.image(assignment.id, f.createInput.token, randomUUID())).statusCode).toBe(404);
    expect(f.readImage).not.toHaveBeenCalled();
    const invalid = await f.start(assignment.id, {
      attemptId: randomUUID(),
      token: "_".repeat(43),
    });
    expect(invalid.statusCode).toBe(404);
    f.admitted.value = false;
    const limited = await f.preview(assignment.id);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.headers["cache-control"]).toContain("no-store");
  });
});
