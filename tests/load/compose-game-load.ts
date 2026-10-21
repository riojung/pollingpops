import { authenticateMailpitCreator } from "../support/mailpit-auth.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { io, type Socket } from "socket.io-client";
import {
  evaluateTargetLoadThresholds,
  targetLoadSchemaVersion,
  targetLoadThresholds,
  validateTargetLoadArtifact,
} from "../../scripts/ops/target-load-evidence.mjs";
import { optionalImmutableBuildId } from "../support/readiness-contract.js";
import { waitForReadyReport } from "../support/report-readiness.js";

const baseUrl = (process.env.LOAD_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const mailpitUrl = (process.env.LOAD_MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");
const browserOrigin = (process.env.LOAD_ORIGIN ?? baseUrl).replace(/\/$/, "");
const clientCount = Number(process.env.CLIENTS ?? "100");
const batchSize = Number(process.env.JOIN_BATCH_SIZE ?? "20");
const assertPerformance = process.env.ASSERT_PERFORMANCE === "true";
const restartServer = process.env.RESTART_SERVER === "true";
const synchronizedStartAtMs = Number(process.env.START_AT_MS ?? "0");
const synchronizedAnswerAtMs = Number(process.env.ANSWER_AT_MS ?? "0");
const suppliedCreatorCookie = process.env.LOAD_CREATOR_COOKIE?.trim() ?? "";
const expectedBuildId = optionalImmutableBuildId(process.env, "LOAD_EXPECTED_BUILD_ID");
const keepData = process.env.LOAD_KEEP_DATA === "true";
const runId = process.env.LOAD_RUN_ID?.trim() || randomUUID();
const runnerRegion = process.env.LOAD_RUNNER_REGION?.trim() || "local-compose";
const outputPath = process.env.LOAD_OUTPUT?.trim();
const workflowRunId = process.env.GITHUB_RUN_ID?.trim() || null;
const workflowRunAttempt = process.env.GITHUB_RUN_ATTEMPT
  ? Number(process.env.GITHUB_RUN_ATTEMPT)
  : null;
const executionStartedAt = new Date().toISOString();
const runFile = promisify(execFile);

if (!Number.isInteger(clientCount) || clientCount < 1 || clientCount > 250) {
  throw new Error("CLIENTS must be an integer between 1 and 250");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
  throw new Error("JOIN_BATCH_SIZE must be an integer between 1 and 50");
}
if (!Number.isFinite(synchronizedStartAtMs) || synchronizedStartAtMs < 0) {
  throw new Error("START_AT_MS must be a non-negative Unix timestamp in milliseconds");
}
if (!Number.isFinite(synchronizedAnswerAtMs) || synchronizedAnswerAtMs < 0) {
  throw new Error("ANSWER_AT_MS must be a non-negative Unix timestamp in milliseconds");
}
if (
  synchronizedStartAtMs > 0 &&
  synchronizedAnswerAtMs > 0 &&
  synchronizedAnswerAtMs < synchronizedStartAtMs
) {
  throw new Error("ANSWER_AT_MS must not be earlier than START_AT_MS");
}
if (suppliedCreatorCookie && /[\r\n]/.test(suppliedCreatorCookie)) {
  throw new Error("LOAD_CREATOR_COOKIE must not contain line breaks");
}
if (restartServer && suppliedCreatorCookie) {
  throw new Error("RESTART_SERVER cannot be used with a supplied staging creator cookie");
}
if (suppliedCreatorCookie && !expectedBuildId) {
  throw new Error("LOAD_EXPECTED_BUILD_ID is required with a supplied staging creator cookie");
}
if (
  (workflowRunId === null) !== (workflowRunAttempt === null) ||
  (workflowRunAttempt !== null &&
    (!Number.isSafeInteger(workflowRunAttempt) || workflowRunAttempt < 1))
) {
  throw new Error("GITHUB_RUN_ID and a positive GITHUB_RUN_ATTEMPT must be provided together");
}

interface Ack<T> {
  data?: T;
  error?: { code: string; message: string };
}

interface Participant {
  socket: Socket;
  participantId: string;
  participantToken: string;
  connectMs: number;
  joinAcknowledgementMs: number;
  joinMs: number;
  answerId?: string;
  idempotencyKey?: string;
}

interface Snapshot {
  sessionId: string;
  version: number;
  seq: number;
  phase: string;
  roundId: string | null;
  answerCount: number;
  participants: Array<{ id: string; connected: boolean }>;
  question: unknown;
}

let creatorCookie = "";
let accountCreated = false;
let createdQuizId: string | null = null;
let createdSessionId: string | null = null;
const sockets = new Set<Socket>();

async function api<T>(path: string, init: RequestInit = {}, bearer?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin: browserOrigin,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(creatorCookie ? { cookie: creatorCookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} returned ${response.status}: ${await response.text()}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function connectSocket() {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 10_000,
    forceNew: true,
    extraHeaders: { origin: browserOrigin },
  });
  sockets.add(socket);
  return new Promise<Socket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out")), 12_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 20_000) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${event} acknowledgement timed out`)),
      timeoutMs,
    );
    socket.emit(event, payload, (response: Ack<T>) => {
      clearTimeout(timeout);
      if (response.error) {
        reject(new Error(`${event} failed (${response.error.code}): ${response.error.message}`));
      } else if (response.data === undefined) {
        reject(new Error(`${event} returned no data`));
      } else {
        resolve(response.data);
      }
    });
  });
}

function percentile(samples: number[], fraction: number) {
  assert.ok(samples.length > 0, "A percentile requires at least one sample");
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

async function waitFor(description: string, condition: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function restartComposeServer() {
  const startedAt = performance.now();
  await runFile(
    "docker",
    ["compose", "-f", "compose.yaml", "-f", "compose.media.yaml", "restart", "server"],
    { cwd: process.cwd(), timeout: 45_000 },
  );
  await waitFor(
    "the restarted server to become ready",
    async () => {
      try {
        return (await fetch(`${baseUrl}/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    30_000,
  );
  return performance.now() - startedAt;
}

async function main() {
  const deployment = await api<{ status: string; buildId: string }>("/health/live");
  assert.equal(deployment.status, "ok", "load target liveness status must be ok");
  assert.equal(typeof deployment.buildId, "string", "load target omitted its build identifier");
  if (expectedBuildId) {
    assert.equal(
      deployment.buildId,
      expectedBuildId,
      "load target build does not match LOAD_EXPECTED_BUILD_ID",
    );
  }

  if (suppliedCreatorCookie) {
    creatorCookie = suppliedCreatorCookie;
    await api("/v1/auth/me");
  } else {
    const email = `compose-load-${Date.now()}-${randomUUID()}@example.com`;
    creatorCookie = await authenticateMailpitCreator({ baseUrl, browserOrigin, mailpitUrl, email });
    accountCreated = true;
  }

  const created = await api<{ quiz: { id: string } }>("/v1/quizzes", {
    method: "POST",
    body: JSON.stringify({ title: `Production-path load check ${runId}`, description: "" }),
  });
  createdQuizId = created.quiz.id;
  const questionId = randomUUID();
  const correctChoiceId = randomUUID();
  const incorrectChoiceId = randomUUID();
  await api(`/v1/quizzes/${created.quiz.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Production-path load check",
      description: "A disposable correctness and latency sample.",
      questions: [
        {
          id: questionId,
          type: "true_false",
          prompt: "The server commits an accepted answer before acknowledging it.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: incorrectChoiceId, label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 300,
          basePoints: 1_000,
          explanation: "PostgreSQL is the durable source of truth.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    }),
  });
  await api(`/v1/quizzes/${created.quiz.id}/publish`, { method: "POST", body: "{}" });
  const session = await api<{
    sessionId: string;
    code: string;
    hostToken: string;
  }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      quizId: created.quiz.id,
      settings: {
        audienceLimit: clientCount,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    }),
  });
  createdSessionId = session.sessionId;

  const participants: Participant[] = [];
  for (let offset = 0; offset < clientCount; offset += batchSize) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(batchSize, clientCount - offset) }, async (_, index) => {
        const participantNumber = offset + index + 1;
        const startedAt = performance.now();
        const socket = await connectSocket();
        const connectedAt = performance.now();
        const joined = await emitAck<{
          participantId: string;
          participantToken: string;
        }>(socket, "session.join", {
          code: session.code,
          nickname: `Load ${String(participantNumber).padStart(3, "0")}`,
        });
        const acknowledgedAt = performance.now();
        return {
          ...joined,
          socket,
          connectMs: connectedAt - startedAt,
          joinAcknowledgementMs: acknowledgedAt - connectedAt,
          joinMs: acknowledgedAt - startedAt,
        };
      }),
    );
    participants.push(...batch);
  }
  assert.equal(participants.length, clientCount);

  if (synchronizedStartAtMs > Date.now()) {
    await new Promise((resolve) => setTimeout(resolve, synchronizedStartAtMs - Date.now()));
  }

  let questionCommandStartedAt = 0;
  let receiptTimeoutCount = 0;
  const broadcastSamples = participants.map(
    ({ socket }) =>
      new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          receiptTimeoutCount += 1;
          reject(new Error("question.open broadcast timed out"));
        }, 15_000);
        socket.once(
          "question.open",
          (envelope: { payload?: { snapshot?: Snapshot } }, acknowledge?: () => void) => {
            acknowledge?.();
            clearTimeout(timeout);
            const serialized = JSON.stringify(envelope.payload?.snapshot?.question);
            assert.ok(!serialized.includes("isCorrect"), "Open question leaked answer correctness");
            assert.ok(
              !serialized.includes("PostgreSQL is the durable"),
              "Open question leaked explanation",
            );
            resolve(performance.now() - questionCommandStartedAt);
          },
        );
      }),
  );
  const beforeStart = await api<{ snapshot: Snapshot }>(
    `/v1/sessions/${session.sessionId}/snapshot?role=host`,
    {},
    session.hostToken,
  );
  questionCommandStartedAt = performance.now();
  const startCommandId = randomUUID();
  const started = await api<{ snapshot: Snapshot }>(
    `/v1/sessions/${session.sessionId}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        commandId: startCommandId,
        expectedVersion: beforeStart.snapshot.version,
        action: "start",
      }),
    },
    session.hostToken,
  );
  assert.equal(started.snapshot.phase, "question_open");
  assert.ok(started.snapshot.roundId);
  const broadcastMs = await Promise.all(broadcastSamples);

  const answerBarrierDelayMs = synchronizedAnswerAtMs - Date.now();
  if (synchronizedAnswerAtMs > 0 && answerBarrierDelayMs <= 0) {
    throw new Error("Question broadcast missed the synchronized answer barrier");
  }
  if (answerBarrierDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, answerBarrierDelayMs));
  }

  const answerMs = await Promise.all(
    participants.map(async (participant) => {
      participant.idempotencyKey = randomUUID();
      const submittedAt = performance.now();
      const answer = await emitAck<{
        accepted: boolean;
        duplicate: boolean;
        answerId: string;
      }>(
        participant.socket,
        "answer.submit",
        {
          sessionId: session.sessionId,
          roundId: started.snapshot.roundId,
          choiceId: correctChoiceId,
          participantToken: participant.participantToken,
          idempotencyKey: participant.idempotencyKey,
        },
        60_000,
      );
      assert.equal(answer.accepted, true);
      assert.equal(answer.duplicate, false);
      participant.answerId = answer.answerId;
      return performance.now() - submittedAt;
    }),
  );

  const first = participants[0]!;
  let restartRecoveryMs: number | null = null;
  if (restartServer) {
    restartRecoveryMs = await restartComposeServer();
    sockets.clear();
    const retriedStart = await api<{ snapshot: Snapshot }>(
      `/v1/sessions/${session.sessionId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          commandId: startCommandId,
          expectedVersion: beforeStart.snapshot.version,
          action: "start",
        }),
      },
      session.hostToken,
    );
    assert.equal(retriedStart.snapshot.phase, "question_open");
    assert.equal(retriedStart.snapshot.answerCount, clientCount);
  } else {
    first.socket.disconnect();
    sockets.delete(first.socket);
    await waitFor("authoritative participant disconnect", async () => {
      const current = await api<{ snapshot: Snapshot }>(
        `/v1/sessions/${session.sessionId}/snapshot?role=host`,
        {},
        session.hostToken,
      );
      return current.snapshot.participants.some(
        (participant) => participant.id === first.participantId && !participant.connected,
      );
    });
  }

  const replacement = await connectSocket();
  const reconnectStartedAt = performance.now();
  const synchronized = await emitAck<{
    snapshot: Snapshot;
    replay: unknown[];
    replayComplete: boolean;
  }>(replacement, "sync.request", {
    sessionId: session.sessionId,
    role: "participant",
    participantToken: first.participantToken,
    lastSeq: started.snapshot.seq,
  });
  const reconnectMs = performance.now() - reconnectStartedAt;
  assert.equal(synchronized.snapshot.answerCount, clientCount);
  assert.equal(synchronized.replayComplete, true);
  assert.ok(synchronized.replay.length >= clientCount);
  assert.equal(
    synchronized.snapshot.participants.find((participant) => participant.id === first.participantId)
      ?.connected,
    true,
  );
  first.socket = replacement;

  const duplicate = await emitAck<{
    accepted: boolean;
    duplicate: boolean;
    answerId: string;
  }>(first.socket, "answer.submit", {
    sessionId: session.sessionId,
    roundId: started.snapshot.roundId,
    choiceId: correctChoiceId,
    participantToken: first.participantToken,
    idempotencyKey: first.idempotencyKey,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.answerId, first.answerId);

  let hostState = await api<{ snapshot: Snapshot }>(
    `/v1/sessions/${session.sessionId}/snapshot?role=host`,
    {},
    session.hostToken,
  ).then(({ snapshot }) => snapshot);
  const command = async (action: string) => {
    const response = await api<{ snapshot: Snapshot }>(
      `/v1/sessions/${session.sessionId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          commandId: randomUUID(),
          expectedVersion: hostState.version,
          action,
        }),
      },
      session.hostToken,
    );
    hostState = response.snapshot;
  };
  await command("lock");
  await command("reveal");
  const reportStartedAt = performance.now();
  await command("next");
  const report = await waitForReadyReport(
    (signal) =>
      api<{
        report: {
          status: "pending" | "ready" | "failed";
          metrics: { participantCount: number; answerCount: number; accuracyPercent: number };
        };
      }>(`/v1/sessions/${session.sessionId}/report`, { signal }).then(({ report }) => report),
    { timeoutMs: 60_000 },
  );
  const reportMs = performance.now() - reportStartedAt;
  assert.equal(report.metrics.participantCount, clientCount);
  assert.equal(report.metrics.answerCount, clientCount);
  assert.equal(report.metrics.accuracyPercent, 100);

  const results = {
    schemaVersion: targetLoadSchemaVersion,
    runId,
    artifactType: "round" as const,
    profile: clientCount,
    target: new URL(baseUrl).origin,
    runnerRegion,
    workflow: { runId: workflowRunId, runAttempt: workflowRunAttempt },
    startedAt: executionStartedAt,
    finishedAt: new Date().toISOString(),
    build: {
      expectedBuildId,
      observedBuildId: deployment.buildId,
      matched: expectedBuildId !== null && deployment.buildId === expectedBuildId,
    },
    counts: {
      requestedParticipants: clientCount,
      joinedParticipants: participants.length,
      acceptedResponses: answerMs.length,
      expectedResponses: clientCount,
      reportParticipants: report.metrics.participantCount,
      reportResponses: report.metrics.answerCount,
    },
    correctness: {
      lostAcceptedResponses: answerMs.length - report.metrics.answerCount,
      duplicateAcceptedResponses: 0,
      leakageDetected: false,
      reportReconciled: report.metrics.answerCount === answerMs.length,
    },
    receipts: {
      expected: clientCount,
      received: broadcastMs.length,
      timeoutCount: receiptTimeoutCount,
      timeoutRate: receiptTimeoutCount / clientCount,
    },
    recovery: {
      reconnectCompleted: synchronized.replayComplete,
      reconnectMs,
      processRestart: restartServer ? "recovered" : "not_run",
      coordinationReset: "not_run" as const,
    },
    report: {
      reconciled: report.metrics.answerCount === answerMs.length,
      availableMs: reportMs,
    },
    latencyMs: {
      join: {
        p50: percentile(
          participants.map(({ joinMs }) => joinMs),
          0.5,
        ),
        p95: percentile(
          participants.map(({ joinMs }) => joinMs),
          0.95,
        ),
      },
      answerAcknowledgement: {
        p50: percentile(answerMs, 0.5),
        p95: percentile(answerMs, 0.95),
        p99: percentile(answerMs, 0.99),
      },
      clientReceipt: {
        p50: percentile(broadcastMs, 0.5),
        p95: percentile(broadcastMs, 0.95),
        max: Math.max(...broadcastMs),
      },
    },
    thresholds: { ...targetLoadThresholds },
    thresholdsPassed: false,
    diagnostics: {
      socketConnection: {
        p50: percentile(
          participants.map(({ connectMs }) => connectMs),
          0.5,
        ),
        p95: percentile(
          participants.map(({ connectMs }) => connectMs),
          0.95,
        ),
      },
      joinAcknowledgement: {
        p50: percentile(
          participants.map(({ joinAcknowledgementMs }) => joinAcknowledgementMs),
          0.5,
        ),
        p95: percentile(
          participants.map(({ joinAcknowledgementMs }) => joinAcknowledgementMs),
          0.95,
        ),
      },
      restartRecoveryMs,
    },
  };
  results.thresholdsPassed = evaluateTargetLoadThresholds(results);
  validateTargetLoadArtifact(results, {
    artifactType: "round",
    profile: clientCount,
  });

  const serializedResults = `${JSON.stringify(results, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializedResults, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(serializedResults);
  if (assertPerformance) {
    validateTargetLoadArtifact(results, {
      artifactType: "round",
      profile: clientCount,
      enforceThresholds: true,
    });
  }
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const socket of sockets) socket.disconnect();
    if (keepData) return;
    if (accountCreated) {
      await api("/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: "DELETE" }),
      }).catch((error: unknown) => {
        process.stderr.write(`Load-test account cleanup failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
      return;
    }
    if (createdSessionId) {
      await api(`/v1/sessions/${createdSessionId}`, { method: "DELETE" }).catch(
        (error: unknown) => {
          process.stderr.write(`Load-test session cleanup failed: ${String(error)}\n`);
          process.exitCode = 1;
        },
      );
    }
    if (createdQuizId) {
      await api(`/v1/quizzes/${createdQuizId}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived: true }),
      }).catch((error: unknown) => {
        process.stderr.write(`Load-test quiz cleanup failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
    }
  });
