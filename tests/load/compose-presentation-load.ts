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

const baseUrl = (process.env.LOAD_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const mailpitUrl = (process.env.LOAD_MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");
const browserOrigin = (process.env.LOAD_ORIGIN ?? baseUrl).replace(/\/$/, "");
const clientCount = Number(process.env.CLIENTS ?? "50");
const batchSize = Number(process.env.JOIN_BATCH_SIZE ?? "20");
const assertPerformance = process.env.ASSERT_PERFORMANCE === "true";
const restartServer = process.env.RESTART_SERVER === "true";
const resetValkey = process.env.RESET_VALKEY === "true";
const enableLocalRollout = process.env.LOAD_ENABLE_LOCAL_PRESENTATION_ROLLOUT === "true";
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
if (suppliedCreatorCookie && /[\r\n]/.test(suppliedCreatorCookie)) {
  throw new Error("LOAD_CREATOR_COOKIE must not contain line breaks");
}
if (suppliedCreatorCookie && !expectedBuildId) {
  throw new Error("LOAD_EXPECTED_BUILD_ID is required with a supplied staging creator cookie");
}
if (restartServer && suppliedCreatorCookie) {
  throw new Error("RESTART_SERVER cannot be used with a supplied staging creator cookie");
}
if (resetValkey && !restartServer) {
  throw new Error("RESET_VALKEY requires RESTART_SERVER=true");
}
if (enableLocalRollout && suppliedCreatorCookie) {
  throw new Error("LOAD_ENABLE_LOCAL_PRESENTATION_ROLLOUT is only for disposable local accounts");
}
const loadTargetHostname = new URL(baseUrl).hostname;
const loadTargetIsLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
  loadTargetHostname,
);
if ((restartServer || resetValkey || enableLocalRollout) && !loadTargetIsLoopback) {
  throw new Error(
    "Local Presentation rollout and restart evidence require a loopback LOAD_BASE_URL",
  );
}
if (restartServer && !enableLocalRollout) {
  throw new Error(
    "RESTART_SERVER requires LOAD_ENABLE_LOCAL_PRESENTATION_ROLLOUT=true so the restarted target is the local Compose server",
  );
}
if (
  (workflowRunId === null) !== (workflowRunAttempt === null) ||
  (workflowRunAttempt !== null &&
    (!Number.isSafeInteger(workflowRunAttempt) || workflowRunAttempt < 1))
) {
  throw new Error("GITHUB_RUN_ID and a positive GITHUB_RUN_ATTEMPT must be provided together");
}

interface SocketAck<T> {
  data?: T;
  error?: { code: string; message: string };
}

interface ParticipantSnapshot {
  sessionId: string;
  projection: "participant";
  participantId: string;
  revision: number;
  seq: number;
  phase: string;
  responseSubmitted: boolean;
  standing?: { rank: number; score: number } | null;
  responseResult?: { correct: boolean | null; score: number } | null;
  responseReceipt?: {
    responseId: string;
    blockId: string;
    idempotencyKey: string;
    acceptedAt: string;
  } | null;
  currentBlock: null | {
    id: string;
    kind: "content" | "question";
    question?: {
      type: string;
      confidence?: "off" | "optional" | "required";
      choices?: Array<{ id: string }>;
    };
  };
}

interface HostSnapshot {
  sessionId: string;
  projection: "host";
  code: string;
  revision: number;
  seq: number;
  phase: string;
  participantCount: number;
  responseCount: number;
  currentBlock: null | { id: string; kind: "content" | "question" };
}

interface SyncResponse<TSnapshot> {
  resetRequired: boolean;
  events: unknown[];
  snapshot: TSnapshot;
}

interface ResponseAcknowledgement {
  sessionId: string;
  blockId: string;
  idempotencyKey: string;
  accepted: boolean;
  duplicate: boolean;
  responseId: string;
  acceptedAt: string;
  snapshot: ParticipantSnapshot;
}

interface Participant {
  socket: Socket;
  participantId: string;
  participantToken: string;
  snapshot: ParticipantSnapshot;
  joinMs: number;
  diagnosticIdempotencyKey?: string;
  diagnosticResponseId?: string;
}

interface PresentationReport {
  schemaVersion: 1;
  sessionId: string;
  artifactType: "presentation";
  status: "finished";
  participantCount: number;
  responseCount: number;
  evidence: Array<{
    blockId: string;
    kind: "content" | "question";
    respondents?: number;
    correct?: number | null;
  }>;
  recovery: Array<{
    sourceQuestionId: string;
    recheckQuestionId: string;
    eligible: number;
    recovered: number;
    recoveryPercent: number | null;
  }>;
  timeline: Array<{ sequence: number; type: string }>;
}

let creatorCookie = "";
let accountCreated = false;
let createdPresentationId: string | null = null;
let createdSessionId: string | null = null;
let participantProjectionChecks = 0;
const sockets = new Set<Socket>();

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin: browserOrigin,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(creatorCookie ? { cookie: creatorCookie } : {}),
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
      socket.on("presentation.session.updated", (_event, acknowledge?: () => void) =>
        acknowledge?.(),
      );
      socket.on("presentation.room-status.updated", (_event, acknowledge?: () => void) =>
        acknowledge?.(),
      );
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 30_000) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${event} acknowledgement timed out`)),
      timeoutMs,
    );
    socket.emit(event, payload, (response: SocketAck<T>) => {
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

async function waitFor(description: string, condition: () => Promise<boolean>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitForParticipantRevision(
  socket: Socket,
  revision: number,
  onTimeout: () => void,
  timeoutMs = 20_000,
) {
  return new Promise<{ snapshot: ParticipantSnapshot; receivedAt: number }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("presentation.session.updated", listener);
      onTimeout();
      reject(new Error(`Presentation revision ${revision} broadcast timed out`));
    }, timeoutMs);
    const listener = (envelope: { payload?: { snapshot?: ParticipantSnapshot } }) => {
      const snapshot = envelope.payload?.snapshot;
      if (snapshot?.projection !== "participant" || snapshot.revision !== revision) return;
      clearTimeout(timeout);
      socket.off("presentation.session.updated", listener);
      resolve({ snapshot, receivedAt: performance.now() });
    };
    socket.on("presentation.session.updated", listener);
  });
}

function assertParticipantProjectionSafe(snapshot: ParticipantSnapshot) {
  const serialized = JSON.stringify(snapshot.currentBlock);
  for (const forbidden of [
    "isCorrect",
    "revealedAnswer",
    "correctChoiceIds",
    "correctValue",
    "tolerance",
    "explanation",
    "conceptKeys",
    "sourceCitations",
    "citations",
    "sourceDisclosure",
    "speakerNotes",
    "feedback",
    "misconceptionKey",
    "purpose",
    "linkedRecheckAvailable",
  ]) {
    assert.ok(!serialized.includes(forbidden), `Participant projection leaked ${forbidden}`);
  }
  if (snapshot.phase === "question_open") {
    assert.equal(
      snapshot.responseResult ?? null,
      null,
      "Open question leaked response correctness",
    );
    assert.equal(snapshot.standing ?? null, null, "Open question leaked score or standing");
  }
  participantProjectionChecks += 1;
}

async function settledBatch<T>(description: string, tasks: Array<Promise<T>>) {
  const outcomes = await Promise.allSettled(tasks);
  const failures = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (failures.length > 0) {
    const reasons = failures
      .map(({ reason }) => (reason instanceof Error ? reason.message : String(reason)))
      .join("; ");
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      `${description} failed for ${failures.length} client${failures.length === 1 ? "" : "s"}: ${reasons}`,
    );
  }
  return outcomes.map((outcome) => (outcome as PromiseFulfilledResult<T>).value);
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

async function resetComposeValkey() {
  const startedAt = performance.now();
  await runFile(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.media.yaml",
      "exec",
      "-T",
      "valkey",
      "valkey-cli",
      "FLUSHALL",
    ],
    { cwd: process.cwd(), timeout: 30_000 },
  );
  await runFile(
    "docker",
    ["compose", "-f", "compose.yaml", "-f", "compose.media.yaml", "restart", "valkey"],
    { cwd: process.cwd(), timeout: 45_000 },
  );
  await waitFor(
    "the reset coordination service to become ready",
    async () => {
      try {
        const { stdout } = await runFile(
          "docker",
          [
            "compose",
            "-f",
            "compose.yaml",
            "-f",
            "compose.media.yaml",
            "exec",
            "-T",
            "valkey",
            "valkey-cli",
            "PING",
          ],
          { cwd: process.cwd(), timeout: 5_000 },
        );
        return stdout.trim() === "PONG";
      } catch {
        return false;
      }
    },
    30_000,
  );
  return performance.now() - startedAt;
}

async function enableDisposableLocalPresentationWorkspace(workspaceId: string) {
  await runFile(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.media.yaml",
      "-f",
      "compose.test.yaml",
      "up",
      "-d",
      "--no-deps",
      "--force-recreate",
      "server",
    ],
    {
      cwd: process.cwd(),
      timeout: 120_000,
      env: {
        ...process.env,
        FEATURE_UX_BETA: "true",
        FEATURE_PRESENTATIONS: "true",
        FEATURE_PRESENTATION_REALTIME: "true",
        PRESENTATION_CONCURRENT_RESPONSE_WRITES: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
        EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
      },
    },
  );
  await waitFor(
    "the locally allowlisted Presentation server to become ready",
    async () => {
      try {
        return (await fetch(`${baseUrl}/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    60_000,
  );
}

async function readyPresentationReport(sessionId: string) {
  let lastStatus: string | null = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const envelope = await api<{
      reportStatus: "pending" | "ready" | "failed";
      report: PresentationReport | null;
    }>(`/v1/presentation-sessions/${sessionId}/report`);
    lastStatus = envelope.reportStatus;
    if (envelope.reportStatus === "ready" && envelope.report) return envelope.report;
    if (envelope.reportStatus === "failed")
      throw new Error("Presentation report generation failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Presentation report (last status: ${lastStatus})`);
}

async function finishCreatedSession() {
  if (!createdSessionId || !creatorCookie) return;
  let { snapshot } = await api<{ snapshot: HostSnapshot }>(
    `/v1/presentation-sessions/${createdSessionId}`,
  );
  for (let transition = 0; snapshot.phase !== "finished" && transition < 10; transition += 1) {
    ({ snapshot } = await api<{ snapshot: HostSnapshot }>(
      `/v1/presentation-sessions/${createdSessionId}/advance`,
      {
        method: "POST",
        body: JSON.stringify({ expectedRevision: snapshot.revision }),
      },
    ));
  }
  assert.equal(
    snapshot.phase,
    "finished",
    "Presentation load-test cleanup could not close the active room",
  );
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
  } else {
    const email = `compose-presentation-${Date.now()}-${randomUUID()}@example.com`;
    creatorCookie = await authenticateMailpitCreator({ baseUrl, browserOrigin, mailpitUrl, email });
    accountCreated = true;
  }

  let account = await api<{
    creator: { workspaceId: string };
    productFeatures: { presentations: boolean; presentationRealtime: boolean };
  }>("/v1/auth/me");
  if (enableLocalRollout) {
    await enableDisposableLocalPresentationWorkspace(account.creator.workspaceId);
    account = await api("/v1/auth/me");
  }
  assert.equal(
    account.productFeatures.presentations,
    true,
    "the synthetic workspace must be allowlisted for Presentations",
  );
  assert.equal(
    account.productFeatures.presentationRealtime,
    true,
    "the synthetic workspace must be allowlisted for live Presentation creation",
  );

  const presentation = await api<{
    presentation: { id: string; draft: { blocks: Array<{ id: string }> } };
  }>("/v1/presentations", {
    method: "POST",
    body: JSON.stringify({
      title: `Presentation production-path load ${runId}`,
      description: "Disposable diagnostic and linked-recheck capacity evidence.",
    }),
  });
  createdPresentationId = presentation.presentation.id;

  const diagnosticBlockId = randomUUID();
  const diagnosticQuestionId = randomUUID();
  const diagnosticCorrectChoiceId = randomUUID();
  const diagnosticIncorrectChoiceId = randomUUID();
  const recheckBlockId = randomUUID();
  const recheckQuestionId = randomUUID();
  const recheckCorrectChoiceId = randomUUID();
  const recheckIncorrectChoiceId = randomUUID();
  const question = (
    id: string,
    prompt: string,
    delivery: "main" | "recheck",
    correctChoiceId: string,
    incorrectChoiceId: string,
    linkedRecheckQuestionId: string | null,
  ) => ({
    id,
    type: "single_select" as const,
    prompt,
    choices: [
      { id: correctChoiceId, label: "Durable acknowledgement", isCorrect: true },
      {
        id: incorrectChoiceId,
        label: "Optimistic client state",
        isCorrect: false,
        feedback: "The server must commit before acknowledging.",
        misconceptionKey: "optimistic-means-durable",
      },
    ],
    purpose: delivery === "main" ? ("diagnostic" as const) : ("practice" as const),
    confidence: "optional" as const,
    delivery,
    conceptKeys: ["durable-acknowledgement"],
    linkedRecheckQuestionId,
    timeLimitSeconds: 300,
    basePoints: 1_000,
    explanation: "The server commits the response before it acknowledges acceptance.",
    sourceCitations: [
      {
        sourceName: "Polling Pops reliability contract",
        sourceDigest: "a".repeat(64),
        locator: "Presentation response acknowledgement",
        excerpt: "Acceptance follows the durable write.",
      },
    ],
    mediaId: null,
    mediaAlt: null,
  });
  await api(`/v1/presentations/${presentation.presentation.id}/draft`, {
    method: "PUT",
    body: JSON.stringify({
      draft: {
        title: "Presentation production-path load",
        description: "Disposable diagnostic and linked-recheck capacity evidence.",
        experiencePreset: { id: "focus", version: 1 },
        schemaVersion: 2,
        blocks: [
          {
            id: diagnosticBlockId,
            kind: "question",
            question: question(
              diagnosticQuestionId,
              "Which state proves that a response is saved?",
              "main",
              diagnosticCorrectChoiceId,
              diagnosticIncorrectChoiceId,
              recheckQuestionId,
            ),
          },
          {
            id: recheckBlockId,
            kind: "question",
            question: question(
              recheckQuestionId,
              "After reconnecting, which signal proves the answer survived?",
              "recheck",
              recheckCorrectChoiceId,
              recheckIncorrectChoiceId,
              null,
            ),
          },
        ],
      },
      expectedRevision: 0,
      mutationId: randomUUID(),
      schemaVersion: 2,
    }),
  });
  await api(`/v1/presentations/${presentation.presentation.id}/publish`, {
    method: "POST",
    body: JSON.stringify({ expectedDraftRevision: 1 }),
  });
  const createdSession = await api<{
    snapshot: HostSnapshot;
    controlToken: string;
  }>("/v1/presentation-sessions", {
    method: "POST",
    body: JSON.stringify({ presentationId: presentation.presentation.id }),
  });
  const sessionId = createdSession.snapshot.sessionId;
  createdSessionId = sessionId;
  const controlToken = createdSession.controlToken;

  let hostSocket = await connectSocket();
  let host = (
    await emitAck<SyncResponse<HostSnapshot>>(hostSocket, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: 0,
    })
  ).snapshot;
  assert.equal(host.phase, "lobby");

  const participants: Participant[] = [];
  for (let offset = 0; offset < clientCount; offset += batchSize) {
    const batch = await settledBatch(
      "Presentation join batch",
      Array.from({ length: Math.min(batchSize, clientCount - offset) }, async (_, index) => {
        const participantNumber = offset + index + 1;
        const startedAt = performance.now();
        const socket = await connectSocket();
        const joined = await emitAck<{
          participantToken: string;
          snapshot: ParticipantSnapshot;
        }>(socket, "presentation.join", {
          code: createdSession.snapshot.code,
          nickname: `Presentation load ${String(participantNumber).padStart(3, "0")}`,
        });
        assertParticipantProjectionSafe(joined.snapshot);
        return {
          socket,
          participantId: joined.snapshot.participantId,
          participantToken: joined.participantToken,
          snapshot: joined.snapshot,
          joinMs: performance.now() - startedAt,
        } satisfies Participant;
      }),
    );
    participants.push(...batch);
  }
  assert.equal(participants.length, clientCount);

  const command = async (expectedRevision: number, commandId = randomUUID()) => {
    const acknowledgement = await emitAck<{ snapshot: HostSnapshot }>(
      hostSocket,
      "presentation.command",
      {
        sessionId,
        controlToken,
        commandId,
        expectedRevision,
        action: "advance",
      },
    );
    host = acknowledgement.snapshot;
    return { snapshot: acknowledgement.snapshot, commandId };
  };

  let receiptTimeoutCount = 0;
  const diagnosticBroadcasts = participants.map(({ socket }) =>
    waitForParticipantRevision(socket, 1, () => {
      receiptTimeoutCount += 1;
    }),
  );
  const diagnosticCommandStartedAt = performance.now();
  const diagnosticOpen = await command(0);
  assert.equal(diagnosticOpen.snapshot.phase, "question_open");
  assert.equal(diagnosticOpen.snapshot.currentBlock?.id, diagnosticBlockId);
  const diagnosticDuplicateCommand = await command(0, diagnosticOpen.commandId);
  assert.equal(diagnosticDuplicateCommand.snapshot.revision, 1);
  const diagnosticReceipts = await Promise.all(diagnosticBroadcasts);
  for (const receipt of diagnosticReceipts) assertParticipantProjectionSafe(receipt.snapshot);
  const clientReceiptMs = diagnosticReceipts.map(
    ({ receivedAt }) => receivedAt - diagnosticCommandStartedAt,
  );

  const answerMs: number[] = [];
  await settledBatch(
    "diagnostic response batch",
    participants.map(async (participant) => {
      const idempotencyKey = randomUUID();
      const startedAt = performance.now();
      const acknowledgement = await emitAck<ResponseAcknowledgement>(
        participant.socket,
        "presentation.response.submit",
        {
          sessionId,
          participantToken: participant.participantToken,
          blockId: diagnosticBlockId,
          expectedRevision: 1,
          idempotencyKey,
          response: { choiceIds: [diagnosticIncorrectChoiceId], confidence: 3 },
        },
        60_000,
      );
      answerMs.push(performance.now() - startedAt);
      assert.equal(acknowledgement.accepted, true);
      assert.equal(acknowledgement.duplicate, false);
      assertParticipantProjectionSafe(acknowledgement.snapshot);
      participant.snapshot = acknowledgement.snapshot;
      participant.diagnosticIdempotencyKey = idempotencyKey;
      participant.diagnosticResponseId = acknowledgement.responseId;
    }),
  );

  const first = participants[0]!;
  let restartRecoveryMs: number | null = null;
  let coordinationResetMs: number | null = null;
  let reconnectMs: number;
  if (restartServer) {
    if (resetValkey) coordinationResetMs = await resetComposeValkey();
    restartRecoveryMs = await restartComposeServer();
    for (const socket of sockets) socket.disconnect();
    sockets.clear();
    hostSocket = await connectSocket();
    host = (
      await emitAck<SyncResponse<HostSnapshot>>(hostSocket, "presentation.sync.request", {
        sessionId,
        projection: "host",
        controlToken,
        afterSeq: 0,
      })
    ).snapshot;
    const reconnectStartedAt = performance.now();
    await settledBatch(
      "participant restart recovery",
      participants.map(async (participant) => {
        participant.socket = await connectSocket();
        const synchronized = await emitAck<SyncResponse<ParticipantSnapshot>>(
          participant.socket,
          "presentation.sync.request",
          {
            sessionId,
            projection: "participant",
            participantToken: participant.participantToken,
            afterSeq: participant.snapshot.seq,
          },
        );
        assertParticipantProjectionSafe(synchronized.snapshot);
        participant.snapshot = synchronized.snapshot;
      }),
    );
    reconnectMs = performance.now() - reconnectStartedAt;
  } else {
    first.socket.disconnect();
    sockets.delete(first.socket);
    first.socket = await connectSocket();
    const reconnectStartedAt = performance.now();
    const synchronized = await emitAck<SyncResponse<ParticipantSnapshot>>(
      first.socket,
      "presentation.sync.request",
      {
        sessionId,
        projection: "participant",
        participantToken: first.participantToken,
        afterSeq: first.snapshot.seq,
      },
    );
    reconnectMs = performance.now() - reconnectStartedAt;
    assertParticipantProjectionSafe(synchronized.snapshot);
    first.snapshot = synchronized.snapshot;
  }
  assert.equal(first.snapshot.responseReceipt?.responseId, first.diagnosticResponseId);
  assert.equal(first.snapshot.responseReceipt?.idempotencyKey, first.diagnosticIdempotencyKey);
  host = (
    await emitAck<SyncResponse<HostSnapshot>>(hostSocket, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: host.seq,
    })
  ).snapshot;
  assert.equal(host.responseCount, clientCount);

  await command(1);
  assert.equal(host.phase, "question_reveal");
  const duplicate = await emitAck<ResponseAcknowledgement>(
    first.socket,
    "presentation.response.submit",
    {
      sessionId,
      participantToken: first.participantToken,
      blockId: diagnosticBlockId,
      expectedRevision: 1,
      idempotencyKey: first.diagnosticIdempotencyKey,
      response: { choiceIds: [diagnosticIncorrectChoiceId], confidence: 3 },
    },
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.responseId, first.diagnosticResponseId);
  assertParticipantProjectionSafe(duplicate.snapshot);
  await command(2);
  assert.equal(host.phase, "intervention");

  const recheckBroadcasts = participants.map(({ socket }) =>
    waitForParticipantRevision(socket, 4, () => {
      receiptTimeoutCount += 1;
    }),
  );
  const recheckCommandStartedAt = performance.now();
  await command(3);
  assert.equal(host.phase, "question_open");
  assert.equal(host.currentBlock?.id, recheckBlockId);
  const recheckReceipts = await Promise.all(recheckBroadcasts);
  for (const receipt of recheckReceipts) assertParticipantProjectionSafe(receipt.snapshot);
  clientReceiptMs.push(
    ...recheckReceipts.map(({ receivedAt }) => receivedAt - recheckCommandStartedAt),
  );

  await settledBatch(
    "recheck response batch",
    participants.map(async (participant) => {
      const startedAt = performance.now();
      const acknowledgement = await emitAck<ResponseAcknowledgement>(
        participant.socket,
        "presentation.response.submit",
        {
          sessionId,
          participantToken: participant.participantToken,
          blockId: recheckBlockId,
          expectedRevision: 4,
          idempotencyKey: randomUUID(),
          response: { choiceIds: [recheckCorrectChoiceId], confidence: 3 },
        },
        60_000,
      );
      answerMs.push(performance.now() - startedAt);
      assert.equal(acknowledgement.accepted, true);
      assert.equal(acknowledgement.duplicate, false);
      assertParticipantProjectionSafe(acknowledgement.snapshot);
      participant.snapshot = acknowledgement.snapshot;
    }),
  );
  await command(4);
  assert.equal(host.phase, "question_reveal");
  const reportStartedAt = performance.now();
  await command(5);
  assert.equal(host.phase, "finished");
  const report = await readyPresentationReport(sessionId);
  const reportMs = performance.now() - reportStartedAt;

  assert.equal(report.sessionId, sessionId);
  assert.equal(report.artifactType, "presentation");
  assert.equal(report.participantCount, clientCount);
  assert.equal(report.responseCount, clientCount * 2);
  const diagnosticEvidence = report.evidence.find(
    (evidence) => evidence.blockId === diagnosticBlockId,
  );
  const recheckEvidence = report.evidence.find((evidence) => evidence.blockId === recheckBlockId);
  assert.deepEqual(
    {
      respondents: diagnosticEvidence?.respondents,
      correct: diagnosticEvidence?.correct,
    },
    { respondents: clientCount, correct: 0 },
  );
  assert.deepEqual(
    { respondents: recheckEvidence?.respondents, correct: recheckEvidence?.correct },
    { respondents: clientCount, correct: clientCount },
  );
  assert.deepEqual(report.recovery, [
    {
      sourceQuestionId: diagnosticQuestionId,
      recheckQuestionId,
      eligible: clientCount,
      recovered: clientCount,
      recoveryPercent: 100,
    },
  ]);
  assert.deepEqual(
    report.timeline.map(({ type }) => type),
    [
      "question.launched",
      "question.revealed",
      "intervention.presented",
      "question.launched",
      "question.revealed",
      "presentation.finished",
    ],
  );
  const timelineSequences = report.timeline.map(({ sequence }) => sequence);
  assert.equal(new Set(timelineSequences).size, timelineSequences.length);
  assert.deepEqual(
    timelineSequences,
    [...timelineSequences].sort((left, right) => left - right),
  );
  assert.ok(participantProjectionChecks > 0, "no participant projections were leak-checked");

  const results = {
    schemaVersion: targetLoadSchemaVersion,
    runId,
    artifactType: "presentation" as const,
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
      expectedResponses: clientCount * 2,
      reportParticipants: report.participantCount,
      reportResponses: report.responseCount,
    },
    correctness: {
      lostAcceptedResponses: answerMs.length - report.responseCount,
      duplicateAcceptedResponses: 0,
      leakageDetected: false,
      reportReconciled: report.responseCount === answerMs.length,
    },
    receipts: {
      expected: clientCount * 2,
      received: clientReceiptMs.length,
      timeoutCount: receiptTimeoutCount,
      timeoutRate: receiptTimeoutCount / (clientCount * 2),
    },
    recovery: {
      reconnectCompleted: first.snapshot.responseReceipt !== null,
      reconnectMs,
      processRestart: restartServer ? "recovered" : "not_run",
      coordinationReset: resetValkey ? "recovered" : "not_run",
    },
    report: {
      reconciled: report.responseCount === answerMs.length,
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
        p50: percentile(clientReceiptMs, 0.5),
        p95: percentile(clientReceiptMs, 0.95),
        max: Math.max(...clientReceiptMs),
      },
    },
    thresholds: { ...targetLoadThresholds },
    thresholdsPassed: false,
    diagnostics: {
      commandReplayStable: diagnosticDuplicateCommand.snapshot.revision === 1,
      responseReplayStable: duplicate.responseId === first.diagnosticResponseId,
      reconnectReceiptRecovered: first.snapshot.responseReceipt !== null,
      participantProjectionChecks,
      recoveredParticipants: report.recovery[0]?.recovered ?? 0,
      restartRecoveryMs,
      coordinationResetMs,
    },
  };
  results.thresholdsPassed = evaluateTargetLoadThresholds(results);
  validateTargetLoadArtifact(results, {
    artifactType: "presentation",
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
      artifactType: "presentation",
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
    await finishCreatedSession().catch((error: unknown) => {
      process.stderr.write(`Presentation load-test room cleanup failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
    // Product-event and report workers are intentionally asynchronous. Give already accepted work
    // a bounded opportunity to drain before deleting the disposable workspace it references.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (accountCreated) {
      await api("/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: "DELETE" }),
      }).catch((error: unknown) => {
        process.stderr.write(`Presentation load-test account cleanup failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
      return;
    }
    if (createdPresentationId) {
      await api(`/v1/presentations/${createdPresentationId}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived: true }),
      }).catch((error: unknown) => {
        process.stderr.write(`Presentation load-test archive failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
    }
  });
