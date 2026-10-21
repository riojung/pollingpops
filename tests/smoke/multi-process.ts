import { authenticateMailpitCreator } from "../support/mailpit-auth.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { io, type Socket } from "socket.io-client";
import { waitForReadyReport } from "../support/report-readiness.js";

const primaryUrl = (process.env.MULTI_WRITER_PRIMARY_URL ?? "http://127.0.0.1:4401").replace(
  /\/$/,
  "",
);
const secondaryUrl = (process.env.MULTI_WRITER_SECONDARY_URL ?? "http://127.0.0.1:4402").replace(
  /\/$/,
  "",
);
const mailpitUrl = (process.env.SMOKE_MAILPIT_URL ?? "http://127.0.0.1:8025").replace(/\/$/, "");
const browserOrigin = process.env.MULTI_WRITER_ORIGIN ?? "http://localhost:8080";
const runFile = promisify(execFile);
const composeArguments = [
  "compose",
  "-f",
  "compose.yaml",
  "-f",
  "compose.test.yaml",
  "-f",
  "compose.multiwriter.yaml",
];

interface Snapshot {
  sessionId: string;
  version: number;
  seq: number;
  phase: string;
  roundId: string | null;
  answerCount: number;
  question: unknown;
  participants: Array<{ id: string; nickname: string; score: number }>;
}

interface Envelope {
  payload: { snapshot: Snapshot };
}

interface Ack<T> {
  data?: T;
  error?: { code: string; message: string };
}

interface JoinedParticipant {
  socket: Socket;
  endpoint: string;
  participantId: string;
  participantToken: string;
}

let creatorCookie = "";
let accountCreated = false;
let primaryStopped = false;
let smokeFailed = false;
const sockets = new Set<Socket>();

async function requestAt(endpoint: string, path: string, init: RequestInit = {}, bearer?: string) {
  return fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      origin: browserOrigin,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(creatorCookie ? { cookie: creatorCookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...init.headers,
    },
  });
}

async function apiAt<T>(
  endpoint: string,
  path: string,
  init: RequestInit = {},
  bearer?: string,
): Promise<T> {
  const response = await requestAt(endpoint, path, init, bearer);
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${endpoint}${path} returned ${response.status}: ${await response.text()}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function connectSocket(endpoint: string) {
  const socket = io(endpoint, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 10_000,
    forceNew: true,
    extraHeaders: { origin: browserOrigin },
  });
  sockets.add(socket);
  return new Promise<Socket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Socket timed out at ${endpoint}`)), 12_000);
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

function waitForEvent(
  socket: Socket,
  event: string,
  predicate: (envelope: Envelope) => boolean,
  timeoutMs = 15_000,
) {
  return new Promise<Envelope>((resolve, reject) => {
    let lastEnvelope: Envelope | null = null;
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(
        new Error(
          `${event} broadcast timed out${
            lastEnvelope
              ? ` (last snapshot version ${lastEnvelope.payload.snapshot.version}, answer count ${lastEnvelope.payload.snapshot.answerCount})`
              : " (no matching event received)"
          }`,
        ),
      );
    }, timeoutMs);
    const handler = (envelope: Envelope, acknowledge?: () => void) => {
      acknowledge?.();
      lastEnvelope = envelope;
      if (!predicate(envelope)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(envelope);
    };
    socket.on(event, handler);
  });
}

async function waitForReady(endpoint: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${endpoint}/health/ready`)).ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${endpoint} did not become ready`);
}

async function readMetric(endpoint: string, sample: string) {
  const response = await fetch(`${endpoint}/metrics`);
  if (!response.ok) throw new Error(`Metrics endpoint returned ${response.status}`);
  const line = (await response.text())
    .split("\n")
    .find((candidate) => candidate.startsWith(`${sample} `));
  return line ? Number(line.slice(sample.length + 1)) : 0;
}

async function waitForMetric(
  endpoint: string,
  sample: string,
  minimum: number,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readMetric(endpoint, sample)) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Metric sample did not reach ${minimum}: ${sample}`);
}

async function setPrimaryRunning(running: boolean) {
  if (running) {
    await runFile("docker", [...composeArguments, "up", "-d", "server"], {
      cwd: process.cwd(),
      timeout: 60_000,
    });
    await waitForReady(primaryUrl);
    primaryStopped = false;
    return;
  }
  await runFile("docker", [...composeArguments, "stop", "server"], {
    cwd: process.cwd(),
    timeout: 45_000,
  });
  primaryStopped = true;
}

async function removeSecondary() {
  await runFile("docker", [...composeArguments, "rm", "--stop", "--force", "server-secondary"], {
    cwd: process.cwd(),
    timeout: 45_000,
  });
}

async function main() {
  await Promise.all([waitForReady(primaryUrl), waitForReady(secondaryUrl)]);
  const email = `multi-process-${Date.now()}-${randomUUID()}@example.com`;
  creatorCookie = await authenticateMailpitCreator({
    baseUrl: primaryUrl,
    browserOrigin,
    mailpitUrl,
    email,
  });
  accountCreated = true;

  const created = await apiAt<{ quiz: { id: string } }>(primaryUrl, "/v1/quizzes", {
    method: "POST",
    body: JSON.stringify({ title: "Two-process recovery", description: "" }),
  });
  const correctChoiceId = randomUUID();
  await apiAt(primaryUrl, `/v1/quizzes/${created.quiz.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Two-process recovery",
      description: "Cross-writer correctness fixture.",
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "A second realtime process can safely continue the session.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 120,
          basePoints: 1_000,
          explanation: "Mutations have distributed ownership and database fencing.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    }),
  });
  await apiAt(primaryUrl, `/v1/quizzes/${created.quiz.id}/publish`, {
    method: "POST",
    body: "{}",
  });
  const session = await apiAt<{ sessionId: string; code: string; hostToken: string }>(
    primaryUrl,
    "/v1/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        quizId: created.quiz.id,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      }),
    },
  );

  const participants = await Promise.all(
    Array.from({ length: 12 }, async (_, index): Promise<JoinedParticipant> => {
      const endpoint = index % 2 === 0 ? primaryUrl : secondaryUrl;
      const socket = await connectSocket(endpoint);
      const joined = await emitAck<{ participantId: string; participantToken: string }>(
        socket,
        "session.join",
        { code: session.code, nickname: "Cross writer" },
      );
      return { socket, endpoint, ...joined };
    }),
  );
  const lobby = await apiAt<{ snapshot: Snapshot }>(
    secondaryUrl,
    `/v1/sessions/${session.sessionId}/snapshot?role=host`,
    {},
    session.hostToken,
  );
  assert.equal(lobby.snapshot.participants.length, 12);
  assert.equal(new Set(lobby.snapshot.participants.map(({ nickname }) => nickname)).size, 12);

  const hostSocket = await connectSocket(primaryUrl);
  await emitAck(hostSocket, "sync.request", {
    sessionId: session.sessionId,
    role: "host",
    hostToken: session.hostToken,
    lastSeq: 0,
  });
  const receiptSample =
    'openround_client_event_receipt_duration_seconds_count{event_type="question.open",role="participant",outcome="acknowledged"}';
  const receiptCountBefore = await readMetric(primaryUrl, receiptSample);
  const questionBroadcasts = participants.map(({ socket }) =>
    waitForEvent(socket, "question.open", () => true),
  );
  const startCommandId = randomUUID();
  const started = await apiAt<{ snapshot: Snapshot }>(
    primaryUrl,
    `/v1/sessions/${session.sessionId}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        commandId: startCommandId,
        expectedVersion: lobby.snapshot.version,
        action: "start",
      }),
    },
    session.hostToken,
  );
  const delivered = await Promise.all(questionBroadcasts);
  for (const envelope of delivered) {
    const serialized = JSON.stringify(envelope.payload.snapshot.question);
    assert.ok(!serialized.includes("isCorrect"));
    assert.ok(!serialized.includes("Mutations have distributed ownership"));
  }
  await waitForMetric(primaryUrl, receiptSample, receiptCountBefore + participants.length);
  const retriedStart = await apiAt<{ snapshot: Snapshot }>(
    secondaryUrl,
    `/v1/sessions/${session.sessionId}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        commandId: startCommandId,
        expectedVersion: lobby.snapshot.version,
        action: "start",
      }),
    },
    session.hostToken,
  );
  assert.equal(retriedStart.snapshot.version, started.snapshot.version);
  assert.equal(retriedStart.snapshot.roundId, started.snapshot.roundId);

  const first = participants.find(({ endpoint }) => endpoint === secondaryUrl)!;
  const firstIdempotencyKey = randomUUID();
  const crossProcessAnswerEvent = waitForEvent(
    hostSocket,
    "session.snapshot",
    ({ payload }) => payload.snapshot.answerCount >= 1,
  );
  const firstAnswer = await emitAck<{ accepted: boolean; duplicate: boolean; answerId: string }>(
    first.socket,
    "answer.submit",
    {
      sessionId: session.sessionId,
      roundId: started.snapshot.roundId,
      choiceId: correctChoiceId,
      participantToken: first.participantToken,
      idempotencyKey: firstIdempotencyKey,
    },
  );
  assert.equal(firstAnswer.accepted, true);
  assert.equal(firstAnswer.duplicate, false);
  await crossProcessAnswerEvent;
  const duplicate = await apiAt<{ accepted: boolean; duplicate: boolean; answerId: string }>(
    primaryUrl,
    `/v1/sessions/${session.sessionId}/answers`,
    {
      method: "POST",
      body: JSON.stringify({
        roundId: started.snapshot.roundId,
        choiceId: correctChoiceId,
        idempotencyKey: firstIdempotencyKey,
      }),
    },
    first.participantToken,
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.answerId, firstAnswer.answerId);

  await Promise.all(
    participants
      .filter(({ participantId }) => participantId !== first.participantId)
      .map(({ socket, participantToken }) =>
        emitAck(socket, "answer.submit", {
          sessionId: session.sessionId,
          roundId: started.snapshot.roundId,
          choiceId: correctChoiceId,
          participantToken,
          idempotencyKey: randomUUID(),
        }),
      ),
  );
  const answered = await apiAt<{ snapshot: Snapshot }>(
    secondaryUrl,
    `/v1/sessions/${session.sessionId}/snapshot?role=host`,
    {},
    session.hostToken,
  );
  assert.equal(answered.snapshot.answerCount, 12);
  assert.ok(answered.snapshot.participants.every(({ score }) => score === 1_000));

  const raceRequests = [
    requestAt(
      primaryUrl,
      `/v1/sessions/${session.sessionId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          commandId: randomUUID(),
          expectedVersion: answered.snapshot.version,
          action: "lock",
        }),
      },
      session.hostToken,
    ),
    requestAt(
      secondaryUrl,
      `/v1/sessions/${session.sessionId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          commandId: randomUUID(),
          expectedVersion: answered.snapshot.version,
          action: "pause",
        }),
      },
      session.hostToken,
    ),
  ];
  const race = await Promise.all(raceRequests);
  assert.deepEqual(
    race.map(({ status }) => status).sort((left, right) => left - right),
    [200, 409],
  );
  const rejected = race.find(({ status }) => status === 409)!;
  assert.equal(
    ((await rejected.json()) as { error: { code: string } }).error.code,
    "STALE_VERSION",
  );

  await setPrimaryRunning(false);
  await waitForReady(secondaryUrl);
  hostSocket.disconnect();
  sockets.delete(hostSocket);

  let current = await apiAt<{ snapshot: Snapshot }>(
    secondaryUrl,
    `/v1/sessions/${session.sessionId}/snapshot?role=host`,
    {},
    session.hostToken,
  ).then(({ snapshot }) => snapshot);
  const command = async (action: "resume" | "lock" | "reveal" | "next") => {
    current = await apiAt<{ snapshot: Snapshot }>(
      secondaryUrl,
      `/v1/sessions/${session.sessionId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          commandId: randomUUID(),
          expectedVersion: current.version,
          action,
        }),
      },
      session.hostToken,
    ).then(({ snapshot }) => snapshot);
  };
  if (current.phase === "paused") await command("resume");
  if (current.phase === "question_open") await command("lock");
  await command("reveal");
  await command("next");
  assert.equal(current.phase, "finished");

  const replacementHost = await connectSocket(secondaryUrl);
  const synchronized = await emitAck<{
    snapshot: Snapshot;
    replay: Array<{ seq: number }>;
    replayComplete: boolean;
  }>(replacementHost, "sync.request", {
    sessionId: session.sessionId,
    role: "host",
    hostToken: session.hostToken,
    lastSeq: 0,
  });
  assert.equal(synchronized.replayComplete, true);
  assert.deepEqual(
    synchronized.replay.map(({ seq }) => seq),
    Array.from({ length: synchronized.snapshot.seq }, (_, index) => index + 1),
  );
  const report = await waitForReadyReport((signal) =>
    apiAt<{
      report: {
        status: "pending" | "ready" | "failed";
        metrics: { participantCount: number; answerCount: number; accuracyPercent: number };
      };
    }>(secondaryUrl, `/v1/sessions/${session.sessionId}/report`, { signal }).then(
      ({ report }) => report,
    ),
  );
  assert.deepEqual(report.metrics, {
    participantCount: 12,
    completedCount: 12,
    answerCount: 12,
    accuracyPercent: 100,
  });

  await apiAt(secondaryUrl, "/v1/account", {
    method: "DELETE",
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  accountCreated = false;
  process.stdout.write(
    `${JSON.stringify(
      {
        processes: 2,
        participants: 12,
        crossProcessBroadcast: true,
        crossProcessReceiptTelemetry: true,
        duplicateHostCommand: "idempotent",
        duplicateAnswer: "idempotent",
        conflictingCommands: "one_applied_one_stale",
        primaryProcessLoss: "secondary_completed_game",
        replayComplete: synchronized.replayComplete,
        durableAnswers: report.metrics.answerCount,
      },
      null,
      2,
    )}\n`,
  );
}

void main()
  .catch((error: unknown) => {
    smokeFailed = true;
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const socket of sockets) socket.disconnect();
    if (accountCreated) {
      await apiAt(secondaryUrl, "/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: "DELETE" }),
      }).catch(() => undefined);
    }
    if (primaryStopped) {
      await setPrimaryRunning(true).catch((error: unknown) => {
        smokeFailed = true;
        process.stderr.write(`Primary server restore failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
    }
    if (!smokeFailed) {
      await removeSecondary().catch((error: unknown) => {
        process.stderr.write(`Secondary server cleanup failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
    }
  });
