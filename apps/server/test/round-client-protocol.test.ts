import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentRoundClientCapabilities,
  legacyRoundProtocol,
  type QuizDraft,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { MemorySessionCache } from "../src/cache";
import { ConfigSchema } from "../src/config";
import { MetricsService } from "../src/metrics";
import { SessionService } from "../src/session-service";

const services: SessionService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
});
async function fixture(enabled = true, allowlisted = true, audienceLimit = 20) {
  const repository = new MemoryRepository();
  const now = new Date();
  const hash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${hash}@example.com`,
    segment: "workplace",
    tokenHash: hash,
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(hash, now))!;
  const quiz: QuizDraft = {
    title: "Protocol fixture",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "Two plus two?",
        correctValue: "4",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 300,
        basePoints: 100,
        explanation: "Two pairs.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const saved = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    title: quiz.title,
    description: "",
    status: "draft",
    draft: quiz,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    quizId: saved.id,
    version: 1,
    content: quiz,
    contentHash: randomUUID(),
    publishedAt: now,
  });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    LOG_LEVEL: "silent",
    COMMUNITY_MODE: String(audienceLimit > 20),
    FEATURE_ROUND_CLIENT_PROTOCOL: String(enabled),
    CORE_PARITY_WORKSPACE_ALLOWLIST: allowlisted ? creator.workspaceId : "",
  });
  const restart = (flag = enabled) => {
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      { ...config, FEATURE_ROUND_CLIENT_PROTOCOL: flag },
      new MetricsService(),
    );
    services.push(service);
    return service;
  };
  const service = restart();
  const session = await service.createSession(
    creator,
    saved.id,
    {
      audienceLimit,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    },
    { clientCapabilities: currentRoundClientCapabilities() },
  );
  return { repository, service, session, restart, creator };
}
describe("Round client admission and recovery", () => {
  it("rejects only incompatible clients in a mixed answer batch", async () => {
    const f = await fixture();
    const guests = await Promise.all(
      ["Compatible one", "Outdated", "Compatible two"].map((nickname) =>
        f.service.join({ code: f.session.code, nickname }),
      ),
    );
    const opened = await f.service.hostCommand({
      sessionId: f.session.sessionId,
      hostToken: f.session.hostToken,
      action: "start",
      commandId: randomUUID(),
      expectedVersion: guests.at(-1)!.snapshot.version,
    });
    f.service.close();
    const stored = (await f.repository.getSessionById(f.session.sessionId))!;
    stored.state = {
      ...stored.state,
      version: stored.state.version + 1,
      roundProtocol: {
        schemaVersion: 1,
        minimumClientVersion: 3,
        requiredCapabilities: ["poll.multiselect"],
      },
    };
    await f.repository.saveSession(stored, stored.state.version - 1);
    const service = f.restart(false);
    const commits = vi.spyOn(f.repository, "commitAnswers");
    const requests = guests.map((guest, index) => ({
      sessionId: f.session.sessionId,
      roundId: opened.roundId!,
      participantToken: guest.participantToken,
      idempotencyKey: randomUUID(),
      response: { kind: "numeric" as const, value: "4" },
      clientCapabilities:
        index === 1
          ? { protocolVersion: 2 as const, capabilities: [] }
          : { protocolVersion: 3 as const, capabilities: ["poll.multiselect" as const] },
    }));
    const results = await Promise.allSettled(requests.map((request) => service.answer(request)));
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { accepted: true } });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "CLIENT_UPDATE_REQUIRED" },
    });
    expect(results[2]).toMatchObject({ status: "fulfilled", value: { accepted: true } });
    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits.mock.calls[0]![1]).toHaveLength(2);
    const evidence = await f.repository.getSessionEvidence(
      f.creator.workspaceId,
      f.session.sessionId,
    );
    expect(evidence.answers).toHaveLength(2);
    expect(evidence.answers.map((answer) => answer.participantId).sort()).toEqual(
      [guests[0]!.participantId, guests[2]!.participantId].sort(),
    );
    const retry = await service.answer(requests[0]!);
    expect(retry).toMatchObject({ accepted: true, duplicate: true });
    const snapshot = await service.snapshot({
      sessionId: f.session.sessionId,
      hostToken: f.session.hostToken,
      clientCapabilities: requests[0]!.clientCapabilities,
    });
    expect(snapshot.answerCount).toBe(2);
    expect(snapshot.participants.filter((participant) => participant.score === 100)).toHaveLength(
      2,
    );
  });
  it("preserves exactly one durable response per participant in a 100-participant service burst", async () => {
    const f = await fixture(true, true, 100);
    const guests = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        f.service.join({
          code: f.session.code,
          nickname: `Synthetic ${index}`,
          clientCapabilities: currentRoundClientCapabilities(),
        }),
      ),
    );
    const lobby = await f.service.snapshot({
      sessionId: f.session.sessionId,
      hostToken: f.session.hostToken,
    });
    expect(lobby.participants).toHaveLength(100);
    const opened = await f.service.hostCommand({
      sessionId: f.session.sessionId,
      hostToken: f.session.hostToken,
      action: "start",
      commandId: randomUUID(),
      expectedVersion: lobby.version,
      clientCapabilities: currentRoundClientCapabilities(),
    });
    const requests = guests.map((guest) => ({
      sessionId: f.session.sessionId,
      roundId: opened.roundId!,
      participantToken: guest.participantToken,
      idempotencyKey: randomUUID(),
      response: { kind: "numeric" as const, value: "4" },
      clientCapabilities: currentRoundClientCapabilities(),
    }));
    const accepted = await Promise.all(requests.map((request) => f.service.answer(request)));
    expect(accepted.every((ack) => ack.accepted && !ack.duplicate)).toBe(true);
    f.service.close();
    const restored = f.restart(false);
    const retries = await Promise.all(requests.map((request) => restored.answer(request)));
    expect(retries.map((ack) => ack.answerId)).toEqual(accepted.map((ack) => ack.answerId));
    expect(retries.every((ack) => ack.accepted && ack.duplicate)).toBe(true);
    const evidence = await f.repository.getSessionEvidence(
      f.creator.workspaceId,
      f.session.sessionId,
    );
    expect(evidence.answers).toHaveLength(100);
    const result = await restored.snapshot({
      sessionId: f.session.sessionId,
      hostToken: f.session.hostToken,
    });
    expect(result.roundProtocol).toEqual(legacyRoundProtocol());
    expect(result.participants.every((participant) => participant.score === 100)).toBe(true);
    expect(result.answerCount).toBe(100);
    const durable = (await f.repository.getSessionById(f.session.sessionId))!.state;
    expect(
      Object.values(durable.participants).every(
        (participant) => participant.score === 100 && participant.correctCount === 1,
      ),
    ).toBe(true);
  });
  it("requires the rollout flag and workspace allowlist; otherwise new rooms retain legacy state", async () => {
    for (const [enabled, allowlisted] of [
      [false, true],
      [true, false],
      [false, false],
    ]) {
      const f = await fixture(enabled, allowlisted);
      expect(f.session.snapshot.stateSchemaVersion).toBe(5);
      expect(f.session.snapshot).not.toHaveProperty("roundProtocol");
    }
    const f = await fixture();
    expect(f.session.snapshot).toMatchObject({
      stateSchemaVersion: 7,
      roundProtocol: legacyRoundProtocol(),
    });
  });
  it("accepts legacy and explicit clients, exact answers and restored rooms after flag-off", async () => {
    const f = await fixture();
    const guest = await f.service.join({ code: f.session.code, nickname: "Synthetic" });
    const opened = await f.service.hostCommand({
      sessionId: f.session.sessionId,
      hostToken: f.session.hostToken,
      action: "start",
      commandId: randomUUID(),
      expectedVersion: guest.snapshot.version,
    });
    const answer = {
      sessionId: f.session.sessionId,
      roundId: opened.roundId!,
      participantToken: guest.participantToken,
      idempotencyKey: randomUUID(),
      response: { kind: "numeric" as const, value: "4" },
    };
    const accepted = await f.service.answer(answer);
    expect(accepted.accepted).toBe(true);
    f.service.close();
    const restored = f.restart(false);
    const synced = await restored.sync({
      sessionId: f.session.sessionId,
      role: "participant",
      participantToken: guest.participantToken,
      lastSeq: 0,
      clientCapabilities: currentRoundClientCapabilities(),
    });
    expect(synced.snapshot).toMatchObject({
      stateSchemaVersion: 7,
      roundProtocol: legacyRoundProtocol(),
      roundId: opened.roundId,
      myResponse: answer.response,
    });
    expect(await restored.answer(answer)).toMatchObject({
      accepted: true,
      duplicate: true,
      answerId: accepted.answerId,
    });
    const resumed = await restored.join({
      code: f.session.code,
      resumeToken: guest.participantToken,
    });
    expect(resumed.participantId).toBe(guest.participantId);
    expect(
      (await restored.snapshot({ sessionId: f.session.sessionId, hostToken: f.session.hostToken }))
        .roundProtocol,
    ).toEqual(legacyRoundProtocol());
  });
  it("fences incompatible joins, reads, resumes, answers and host retries before mutating state", async () => {
    const f = await fixture();
    const guest = await f.service.join({ code: f.session.code, nickname: "Synthetic" });
    const opened = await f.service.hostCommand({
      sessionId: f.session.sessionId,
      hostToken: f.session.hostToken,
      action: "start",
      commandId: randomUUID(),
      expectedVersion: guest.snapshot.version,
    });
    f.service.close();
    const stored = (await f.repository.getSessionById(f.session.sessionId))!;
    // Simulate a future writer creating frozen requirements; this release has no such writer.
    stored.state = {
      ...stored.state,
      version: stored.state.version + 1,
      roundProtocol: {
        schemaVersion: 1,
        minimumClientVersion: 3,
        requiredCapabilities: ["poll.multiselect"],
      },
    };
    await f.repository.saveSession(stored, stored.state.version - 1);
    const service = f.restart(false);
    const version = stored.state.version;
    const rejected = { code: "CLIENT_UPDATE_REQUIRED" };
    await expect(service.join({ code: f.session.code })).rejects.toMatchObject(rejected);
    await expect(
      service.join({ code: f.session.code, resumeToken: guest.participantToken }),
    ).rejects.toMatchObject(rejected);
    for (const role of ["host", "presenter", "participant"] as const) {
      const credential =
        role === "participant"
          ? { participantToken: guest.participantToken }
          : { hostToken: f.session.hostToken };
      await expect(
        service.snapshot({ sessionId: f.session.sessionId, role, ...credential }),
      ).rejects.toMatchObject(rejected);
      await expect(
        service.sync({ sessionId: f.session.sessionId, role, lastSeq: 0, ...credential }),
      ).rejects.toMatchObject(rejected);
    }
    await expect(
      service.hostCommand({
        sessionId: f.session.sessionId,
        hostToken: f.session.hostToken,
        action: "pause",
        commandId: randomUUID(),
        expectedVersion: version,
      }),
    ).rejects.toMatchObject(rejected);
    await expect(
      service.hostCommand({
        sessionId: f.session.sessionId,
        hostToken: f.session.hostToken,
        action: "reveal",
        commandId: randomUUID(),
        expectedVersion: version,
      }),
    ).rejects.toMatchObject(rejected);
    await expect(
      service.answer({
        sessionId: f.session.sessionId,
        roundId: opened.roundId!,
        participantToken: guest.participantToken,
        idempotencyKey: randomUUID(),
        response: { kind: "numeric", value: "4" },
      }),
    ).rejects.toMatchObject(rejected);
    expect((await f.repository.getSessionById(f.session.sessionId))!.state.version).toBe(version);
    expect(
      (await f.repository.getSessionEvidence(f.creator.workspaceId, f.session.sessionId)).answers,
    ).toHaveLength(0);
    const capable = { protocolVersion: 3 as const, capabilities: ["poll.multiselect" as const] };
    expect(
      (
        await service.sync({
          sessionId: f.session.sessionId,
          role: "participant",
          participantToken: guest.participantToken,
          lastSeq: 0,
          clientCapabilities: capable,
        })
      ).snapshot.roundProtocol,
    ).toEqual(stored.state.roundProtocol);
    expect(
      (await service.join({ code: f.session.code, clientCapabilities: capable })).snapshot
        .roundProtocol,
    ).toEqual(stored.state.roundProtocol);
  });
  it("authenticates before revealing compatibility requirements", async () => {
    const f = await fixture();
    await expect(
      f.service.snapshot({
        sessionId: f.session.sessionId,
        hostToken: "wrong-token-long-enough",
        clientCapabilities: { protocolVersion: 99, capabilities: [] } as never,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
