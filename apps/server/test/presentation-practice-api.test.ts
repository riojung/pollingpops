import Fastify, { type FastifyInstance } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@openround/db";
import { practiceAssignmentFixture } from "../../../packages/db/test/support/presentation-practice-conformance.js";
import { registerPresentationPracticeRoutes } from "../src/presentation-practice-routes.js";
import { ConfigSchema } from "../src/config.js";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const token = () => randomBytes(32).toString("base64url");
async function fixture() {
  const repository = new MemoryRepository(),
    f = await practiceAssignmentFixture(repository);
  const state = { actor: f.actor, authenticated: true, enabled: true, admitted: true };
  const readImage = vi.fn(async (): Promise<Buffer<ArrayBuffer>> => Buffer.alloc(8)),
    app = Fastify({ logger: false });
  apps.push(app);
  await registerPresentationPracticeRoutes(app, {
    auth: {
      requireCreator: async (_request, reply) => {
        if (state.authenticated) return state.actor;
        reply.code(401).send({ error: { code: "UNAUTHORIZED" } });
        return null;
      },
    },
    repository,
    assignments: f.assignments,
    storage: { readImage },
    config: ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      LOG_LEVEL: "silent",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
    }),
    consumeAdmission: async () => state.admitted,
    featureEnabled: async () => state.enabled,
  });
  const input = {
    requestId: randomUUID(),
    versionId: f.version.id,
    token: token(),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  const author = `/v1/presentations/${f.presentation.id}/practice-assignments`;
  const create = (payload = input) => app.inject({ method: "POST", url: author, payload });
  const preview = (id: string, key = input.token) =>
    app.inject({
      url: `/v1/presentation-practice/${id}`,
      headers: { authorization: `Bearer ${key}` },
    });
  const start = (
    id: string,
    body: { attemptId: string; token: string } = { attemptId: randomUUID(), token: token() },
    key = input.token,
  ) =>
    app.inject({
      method: "POST",
      url: `/v1/presentation-practice/${id}/attempts`,
      headers: { authorization: `Bearer ${key}` },
      payload: body,
    });
  const resume = (id: string, attempt: string, key: string) =>
    app.inject({
      url: `/v1/presentation-practice/${id}/attempts/${attempt}`,
      headers: { authorization: `Bearer ${key}` },
    });
  const progress = (id: string, attempt: string, key: string, payload: object) =>
    app.inject({
      method: "POST",
      url: `/v1/presentation-practice/${id}/attempts/${attempt}/progress`,
      headers: { authorization: `Bearer ${key}` },
      payload,
    });
  const insights = (id: string, presentationId = f.presentation.id) =>
    app.inject({ url: `/v1/presentations/${presentationId}/practice-assignments/${id}/insights` });
  const revoke = (id: string) => app.inject({ method: "DELETE", url: `${author}/${id}` });
  const publish = (content: typeof f.content) =>
    f.presentations.publishPresentation(
      {
        ...f.version,
        id: randomUUID(),
        version: 3,
        content,
        contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      },
      0,
    );
  return {
    ...f,
    repository,
    state,
    readImage,
    app,
    input,
    author,
    create,
    preview,
    start,
    resume,
    progress,
    insights,
    revoke,
    publish,
  };
}
describe("Presentation practice HTTP", () => {
  it("keeps all answer keys and feedback private until this reader's answer is accepted", async () => {
    const f = await fixture(),
      created = await f.create();
    expect(created.statusCode, created.body).toBe(201);
    const { assignment, url } = created.json();
    expect(url).toContain(`/presentation-practice/${assignment.id}#token=`);
    expect((await f.create()).json()).toEqual({ ...created.json(), replayed: true });
    const preview = await f.preview(assignment.id.toUpperCase());
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.headers["cache-control"]).toBe("private, no-store");
    for (const secret of [
      "isCorrect",
      "feedback",
      "PRIVATE_EXPLANATION",
      "PRIVATE_SELECTED_FEEDBACK",
      "PRIVATE_OTHER_FEEDBACK",
      "PRIVATE_SPEAKER_NOTES",
      "tokenHash",
    ])
      expect(preview.body).not.toContain(secret);
    const reader = { attemptId: randomUUID(), token: token() },
      started = await f.start(assignment.id.toUpperCase(), {
        ...reader,
        attemptId: reader.attemptId.toUpperCase(),
      });
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json().attempt).toMatchObject({ revision: 0, answers: [], readBlockIds: [] });
    const answer = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "answer",
      blockId: f.content.blocks[1]!.id,
      choiceId: f.choices[1]!.id,
    };
    const accepted = await f.progress(assignment.id, reader.attemptId, reader.token, answer);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().attempt.answers).toEqual([
      {
        blockId: answer.blockId,
        choiceId: answer.choiceId,
        correct: false,
        submittedAt: expect.any(String),
        feedback: {
          correctChoiceId: f.choices[0]!.id,
          explanation: "PRIVATE_EXPLANATION",
          selectedFeedback: "PRIVATE_OTHER_FEEDBACK",
        },
      },
    ]);
    expect(accepted.body).not.toContain("PRIVATE_SELECTED_FEEDBACK");
    expect(accepted.body).not.toContain("PRIVATE_SPEAKER_NOTES");
    expect((await f.start(assignment.id, reader)).json().attempt).toMatchObject({
      revision: 0,
      answers: [],
    });
    expect(
      (await f.resume(assignment.id, reader.attemptId, reader.token)).json().attempt.answers,
    ).toHaveLength(1);
    expect((await f.resume(assignment.id, reader.attemptId, f.input.token)).statusCode).toBe(404);
    const other = { attemptId: randomUUID(), token: token() };
    expect((await f.start(assignment.id, other)).json().attempt.answers).toEqual([]);
    expect((await f.resume(assignment.id, reader.attemptId, other.token)).statusCode).toBe(404);
    expect((await f.preview(assignment.id)).body).not.toContain("PRIVATE_EXPLANATION");
    expect(
      (
        await f.progress(assignment.id, reader.attemptId, reader.token, {
          ...answer,
          requestId: randomUUID(),
          expectedRevision: 1,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await f.progress(assignment.id, reader.attemptId, reader.token, {
          ...answer,
          choiceId: f.choices[0]!.id,
        })
      ).statusCode,
    ).toBe(409);
  });
  it("requires content acknowledgement and accepted answers before explicit completion, preserving exact old receipts", async () => {
    const f = await fixture(),
      { assignment } = (await f.create()).json(),
      reader = { attemptId: randomUUID(), token: token() };
    await f.start(assignment.id, reader);
    const send = (payload: object) =>
      f.progress(assignment.id, reader.attemptId, reader.token, payload);
    expect(
      (await send({ requestId: randomUUID(), expectedRevision: 0, kind: "complete" })).statusCode,
    ).toBe(409);
    expect(
      (
        await send({
          requestId: randomUUID(),
          expectedRevision: 0,
          kind: "read",
          blockId: f.content.blocks[1]!.id,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await send({
          requestId: randomUUID(),
          expectedRevision: 0,
          kind: "answer",
          blockId: f.content.blocks[1]!.id,
          choiceId: randomUUID(),
        })
      ).statusCode,
    ).toBe(422);
    const read = {
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "read",
        blockId: f.content.blocks[0]!.id,
      },
      readResult = await send(read);
    expect(readResult.statusCode, readResult.body).toBe(200);
    expect(
      (await send({ requestId: randomUUID(), expectedRevision: 1, kind: "complete" })).statusCode,
    ).toBe(409);
    const answer = {
        requestId: randomUUID(),
        expectedRevision: 1,
        kind: "answer",
        blockId: f.content.blocks[1]!.id,
        choiceId: f.choices[0]!.id,
      },
      answered = await send(answer);
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.json().attempt.answers[0].correct).toBe(true);
    const finish = { requestId: randomUUID(), expectedRevision: 2, kind: "complete" },
      done = await send(finish);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().attempt).toMatchObject({
      revision: 3,
      completedAt: expect.any(String),
      answers: [{ correct: true }],
    });
    expect((await send(finish)).json()).toEqual({ ...done.json(), replayed: true });
    expect((await send(answer)).json()).toEqual({ ...answered.json(), replayed: true });
    expect((await send(read)).json()).toEqual({ ...readResult.json(), replayed: true });
    expect((await f.resume(assignment.id, reader.attemptId, reader.token)).json().attempt).toEqual(
      done.json().attempt,
    );
    const privateValues = JSON.stringify(done.json());
    for (const value of [
      reader.token,
      f.input.token,
      "tokenHash",
      "readRevisions",
      "score",
      "mastery",
    ])
      expect(privateValues).not.toContain(value);
  });
  it("rejects unsupported publications explicitly and supports authored true/false checks", async () => {
    const f = await fixture(),
      unsupported = structuredClone(f.content);
    if (unsupported.blocks[1]!.kind !== "question") throw new Error("Expected question");
    unsupported.blocks[1]!.question.confidence = "required";
    const bad = await f.publish(unsupported),
      rejected = await f.create({ ...f.input, versionId: bad.id });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json().error.code).toBe("PRESENTATION_PRACTICE_UNSUPPORTED_CONTENT");
    const valid = structuredClone(f.content),
      q = valid.blocks[1]!;
    if (q.kind !== "question" || !("choices" in q.question)) throw new Error("Expected choices");
    q.question = {
      ...q.question,
      type: "true_false",
      choices: q.question.choices.map((choice, index) => ({
        ...choice,
        label: index === 0 ? "True" : "False",
      })),
    };
    const published = await f.presentations.publishPresentation(
      {
        ...f.version,
        id: randomUUID(),
        version: 4,
        content: valid,
        contentHash: createHash("sha256").update(JSON.stringify(valid)).digest("hex"),
      },
      0,
    );
    const { assignment } = (
        await f.create({ ...f.input, versionId: published.id, requestId: randomUUID() })
      ).json(),
      reader = { attemptId: randomUUID(), token: token() };
    await f.start(assignment.id, reader);
    const accepted = await f.progress(assignment.id, reader.attemptId, reader.token, {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "answer",
      blockId: q.id,
      choiceId: f.choices[0]!.id,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().attempt.answers[0].correct).toBe(true);
  });
  it("fences access by current authority, feature, credentials, revocation and deadlines", async () => {
    const f = await fixture(),
      { assignment } = (await f.create()).json(),
      reader = { attemptId: randomUUID(), token: token() };
    await f.start(assignment.id, reader);
    expect((await f.preview(assignment.id, token())).statusCode).toBe(404);
    f.state.authenticated = false;
    expect((await f.insights(assignment.id)).statusCode).toBe(401);
    f.state.authenticated = true;
    expect((await f.insights(assignment.id, randomUUID())).statusCode).toBe(404);
    const owner = f.state.actor;
    f.state.actor = { ...owner, role: "viewer" };
    expect((await f.insights(assignment.id)).statusCode).toBe(404);
    f.state.actor = { ...owner, workspaceId: randomUUID() };
    expect((await f.insights(assignment.id)).statusCode).toBe(404);
    f.state.actor = owner;
    f.state.enabled = false;
    expect((await f.preview(assignment.id)).statusCode).toBe(404);
    expect((await f.insights(assignment.id)).statusCode).toBe(404);
    f.state.enabled = true;
    f.state.admitted = false;
    expect((await f.preview(assignment.id)).statusCode).toBe(429);
    f.state.admitted = true;
    expect((await f.revoke(assignment.id)).statusCode).toBe(204);
    expect((await f.preview(assignment.id)).statusCode).toBe(404);
    expect((await f.resume(assignment.id, reader.attemptId, reader.token)).statusCode).toBe(404);
    expect((await f.start(assignment.id, reader)).statusCode).toBe(404);
    expect((await f.insights(assignment.id)).json().assignment.revokedAt).toEqual(
      expect.any(String),
    );
    const deadline = await f.create({ ...f.input, requestId: randomUUID(), token: token() });
    expect(deadline.statusCode, deadline.body).toBe(201);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(f.input.expiresAt));
    expect(
      (await f.preview(deadline.json().assignment.id, new URL(deadline.json().url).hash.slice(7)))
        .statusCode,
    ).toBe(404);
  });
  it("reports only privacy-suppressed anonymous starts and explicit completions", async () => {
    const f = await fixture(),
      { assignment } = (await f.create()).json();
    for (let i = 0; i < 6; i++) await f.preview(assignment.id);
    expect((await f.insights(assignment.id)).json()).toMatchObject({
      startedAttempts: null,
      completedAttempts: null,
      inProgressAttempts: null,
    });
    for (let i = 0; i < 10; i++) {
      const reader = { attemptId: randomUUID(), token: token() };
      await f.start(assignment.id, reader);
      await f.start(assignment.id, reader);
      if (i < 5) {
        await f.progress(assignment.id, reader.attemptId, reader.token, {
          requestId: randomUUID(),
          expectedRevision: 0,
          kind: "read",
          blockId: f.content.blocks[0]!.id,
        });
        await f.progress(assignment.id, reader.attemptId, reader.token, {
          requestId: randomUUID(),
          expectedRevision: 1,
          kind: "answer",
          blockId: f.content.blocks[1]!.id,
          choiceId: f.choices[0]!.id,
        });
        const done = { requestId: randomUUID(), expectedRevision: 2, kind: "complete" };
        await f.progress(assignment.id, reader.attemptId, reader.token, done);
        await f.progress(assignment.id, reader.attemptId, reader.token, done);
      }
      if (i === 4)
        expect((await f.insights(assignment.id)).json()).toMatchObject({
          startedAttempts: 5,
          completedAttempts: 5,
          inProgressAttempts: 0,
        });
    }
    const report = await f.insights(assignment.id);
    expect(report.json()).toMatchObject({
      startedAttempts: 10,
      completedAttempts: 5,
      inProgressAttempts: 5,
    });
    for (const word of ["answers", "choiceId", "correct", "submittedAt", "PRIVATE_"])
      expect(report.body).not.toContain(word);
  });
  it("bounds private-image concurrency and rechecks revocation after storage returns", async () => {
    const f = await fixture(),
      mediaId = randomUUID();
    await f.repository.createMediaAsset({
      id: mediaId,
      workspaceId: f.actor.workspaceId,
      objectKey: `media/${f.actor.workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 8,
      scanStatus: "clean",
      altText: "Public image",
      createdAt: new Date(),
    });
    const content = structuredClone(f.content),
      block = content.blocks[0]!;
    if (block.kind !== "content") throw new Error("Expected content");
    block.mediaId = mediaId;
    block.mediaAlt = "Public image";
    const version = await f.publish(content);
    const { assignment } = (await f.create({ ...f.input, versionId: version.id })).json();
    const image = (id = mediaId) =>
      f.app.inject({
        url: `/v1/presentation-practice/${assignment.id}/media/${id}`,
        headers: { authorization: `Bearer ${f.input.token}` },
      });
    expect((await image(randomUUID())).statusCode).toBe(404);
    let release!: (value: Buffer<ArrayBuffer>) => void;
    const bytes = new Promise<Buffer<ArrayBuffer>>((resolve) => {
      release = resolve;
    });
    f.readImage.mockImplementation(() => bytes);
    const pending = Array.from({ length: 4 }, () => image());
    try {
      await vi.waitFor(() => expect(f.readImage).toHaveBeenCalledTimes(4));
      expect((await image()).statusCode).toBe(503);
      expect((await f.revoke(assignment.id)).statusCode).toBe(204);
    } finally {
      release(Buffer.alloc(8));
    }
    for (const response of await Promise.all(pending)) expect(response.statusCode).toBe(404);
  });
});
