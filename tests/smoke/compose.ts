import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { composeOperationalFeatures } from "../support/compose-operational-features.js";
import { waitForReadyReport } from "../support/report-readiness.js";

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const mailpitUrl = (process.env.SMOKE_MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");
const email = `compose-smoke-${Date.now()}@example.com`;
let creatorCookie = "";
let browserOrigin = process.env.SMOKE_ORIGIN?.replace(/\/$/, "") ?? "";

async function api<T>(path: string, init: RequestInit = {}, bearer?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin: browserOrigin || baseUrl,
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

async function magicLink(): Promise<string> {
  await api("/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({ email, segment: "education", acceptPolicies: true }),
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = (await fetch(`${mailpitUrl}/api/v1/messages`).then((response) =>
      response.json(),
    )) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
    };
    const message = list.messages.find((candidate) =>
      candidate.To.some((recipient) => recipient.Address === email),
    );
    if (message) {
      const detail = (await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`).then((response) =>
        response.json(),
      )) as { Text: string };
      const link = detail.Text.match(/https?:\/\/\S+\/v1\/auth\/verify\?token=[^\s]+/)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The smoke-test magic link did not reach Mailpit");
}

async function main() {
  if (!browserOrigin) {
    const response = await fetch(`${baseUrl}/v1/features`);
    if (!response.ok) {
      throw new Error(`GET /v1/features returned ${response.status}: ${await response.text()}`);
    }
    const bootstrap = (await response.json()) as { publicWebUrl: string };
    browserOrigin = new URL(bootstrap.publicWebUrl).origin;
  }

  for (const method of ["GET", "PATCH"]) {
    const response = await fetch(`${baseUrl}/v1/admin/features`, {
      method,
      headers: { origin: browserOrigin, "content-type": "application/json" },
      ...(method === "PATCH" ? { body: JSON.stringify({ signups: true }) } : {}),
    });
    assert.equal(response.status, 404, "The product proxy must not expose operator routes");
  }
  await composeOperationalFeatures({ signups: true, sessionCreation: true, mediaUploads: true });
  const verifyResponse = await fetch(await magicLink(), { redirect: "manual" });
  assert.ok([301, 302, 303, 307, 308].includes(verifyResponse.status));
  creatorCookie = verifyResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  assert.match(creatorCookie, /^openround_creator=/);

  const me = await api<{
    creator: { workspaceId: string; plan: string };
    entitlements: { reportRetentionDays: number; csvExport: boolean; brandTheme: boolean };
  }>("/v1/auth/me");
  assert.equal(me.creator.plan, "team");
  assert.equal(me.entitlements.reportRetentionDays, 365);
  assert.equal(me.entitlements.csvExport, true);
  assert.equal(me.entitlements.brandTheme, true);

  const featureView = await composeOperationalFeatures();
  try {
    const paused = await composeOperationalFeatures({
      signups: false,
      sessionCreation: false,
      mediaUploads: false,
    });
    assert.deepEqual(paused.effective, {
      ...featureView.effective,
      signups: false,
      sessionCreation: false,
      mediaUploads: false,
    });
    const publicPaused = await api<{
      signups: boolean;
      sessionCreation: boolean;
      mediaUploads: boolean;
    }>("/v1/features");
    assert.deepEqual(publicPaused, {
      ...publicPaused,
      signups: false,
      sessionCreation: false,
      mediaUploads: false,
    });
    for (const request of [
      fetch(`${baseUrl}/v1/auth/magic-link`, {
        method: "POST",
        headers: { origin: browserOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          email: `paused-${Date.now()}@example.com`,
          segment: "education",
          acceptPolicies: true,
        }),
      }),
      fetch(`${baseUrl}/v1/sessions`, {
        method: "POST",
        headers: {
          origin: browserOrigin,
          cookie: creatorCookie,
          "content-type": "application/json",
        },
        body: "{}",
      }),
      fetch(`${baseUrl}/v1/media`, {
        method: "POST",
        headers: {
          origin: browserOrigin,
          cookie: creatorCookie,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    ]) {
      assert.equal((await request).status, 503);
    }
  } finally {
    await composeOperationalFeatures({ signups: true, sessionCreation: true, mediaUploads: true });
  }
  const resumedFeatures = await api<{
    signups: boolean;
    sessionCreation: boolean;
    mediaUploads: boolean;
  }>("/v1/features");
  assert.deepEqual(resumedFeatures, {
    ...resumedFeatures,
    ...featureView.configured,
  });

  const brandTheme = {
    organizationName: "Compose Learning",
    primaryColor: "#0B2239",
    accentColor: "#087375",
  };
  assert.deepEqual(
    (
      await api<{ theme: typeof brandTheme }>("/v1/account/theme", {
        method: "PUT",
        body: JSON.stringify(brandTheme),
      })
    ).theme,
    brandTheme,
  );
  const features = resumedFeatures;

  let mediaId: string | null = null;
  let mediaDownloadUrl: string | null = null;
  let mediaAssetCount = 0;
  if (features.mediaUploads) {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const ticket = await api<{ mediaId: string; uploadUrl: string; scanStatus: string }>(
      "/v1/media",
      {
        method: "POST",
        body: JSON.stringify({
          fileName: "durability.png",
          mimeType: "image/png",
          sizeBytes: png.byteLength,
          altText: "A one-pixel production-path test image",
        }),
      },
    );
    assert.equal(ticket.scanStatus, "pending");
    const preflight = await fetch(ticket.uploadUrl, {
      method: "OPTIONS",
      headers: {
        origin: browserOrigin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204, await preflight.text());
    assert.equal(preflight.headers.get("access-control-allow-origin"), browserOrigin);
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /PUT/);
    const uploaded = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png", "content-length": String(png.byteLength) },
      body: png,
    });
    assert.equal(uploaded.status, 200, await uploaded.text());
    const completed = await api<{
      media: { id: string; scanStatus: string; altText: string };
      downloadUrl: string;
    }>(`/v1/media/${ticket.mediaId}/complete`, { method: "POST", body: "{}" });
    assert.equal(completed.media.scanStatus, "clean");
    assert.equal(completed.media.altText, "A one-pixel production-path test image");
    mediaId = ticket.mediaId;
    mediaAssetCount += 1;
    mediaDownloadUrl = completed.downloadUrl;
    const downloaded = await fetch(mediaDownloadUrl);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);

    const unsafePng = Buffer.from("This is not a PNG despite its declared content type.");
    const unsafeTicket = await api<{ mediaId: string; uploadUrl: string }>("/v1/media", {
      method: "POST",
      body: JSON.stringify({
        fileName: "invalid-signature.png",
        mimeType: "image/png",
        sizeBytes: unsafePng.byteLength,
        altText: "An invalid image payload that must never be served",
      }),
    });
    mediaAssetCount += 1;
    const unsafeUploaded = await fetch(unsafeTicket.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        "content-length": String(unsafePng.byteLength),
      },
      body: unsafePng,
    });
    assert.equal(unsafeUploaded.status, 200, await unsafeUploaded.text());
    const rejected = await api<{ media: { scanStatus: string }; downloadUrl?: string }>(
      `/v1/media/${unsafeTicket.mediaId}/complete`,
      { method: "POST", body: "{}" },
    );
    assert.equal(rejected.media.scanStatus, "rejected");
    assert.equal(rejected.downloadUrl, undefined);
  }

  const created = await api<{ quiz: { id: string } }>("/v1/quizzes", {
    method: "POST",
    body: JSON.stringify({ title: "Compose production-path smoke", description: "" }),
  });
  const questionId = randomUUID();
  const correctChoiceId = randomUUID();
  const incorrectChoiceId = randomUUID();
  await api(`/v1/quizzes/${created.quiz.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Compose production-path smoke",
      description: "Exercises PostgreSQL, Valkey, Caddy, and the authoritative engine.",
      questions: [
        {
          id: questionId,
          type: "true_false",
          prompt: "Accepted answers are durable before acknowledgement.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: incorrectChoiceId, label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "The database transaction commits before the response is sent.",
          mediaId,
          mediaAlt: mediaId ? "A one-pixel production-path test image" : null,
        },
      ],
    }),
  });
  await api(`/v1/quizzes/${created.quiz.id}/publish`, { method: "POST", body: "{}" });

  const session = await api<{
    sessionId: string;
    code: string;
    hostToken: string;
    snapshot: { version: number; brandTheme: typeof brandTheme | null };
  }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      quizId: created.quiz.id,
      settings: {
        audienceLimit: 100,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    }),
  });
  assert.deepEqual(session.snapshot.brandTheme, brandTheme);
  const participant = await api<{
    participantId: string;
    participantToken: string;
  }>("/v1/sessions/join", {
    method: "POST",
    body: JSON.stringify({ code: session.code, nickname: "Ignored by friendly-only mode" }),
  });
  if (mediaId) {
    const denied = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/media/${mediaId}`, {
      headers: { origin: browserOrigin },
    });
    assert.equal(denied.status, 401);
    const sessionMedia = await api<{ downloadUrl: string; media: { id: string } }>(
      `/v1/sessions/${session.sessionId}/media/${mediaId}`,
      {},
      participant.participantToken,
    );
    assert.equal(sessionMedia.media.id, mediaId);
    assert.equal((await fetch(sessionMedia.downloadUrl)).status, 200);
  }

  let version = session.snapshot.version + 1;
  async function host(action: string) {
    const response = await api<{ snapshot: { version: number; roundId: string | null } }>(
      `/v1/sessions/${session.sessionId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          commandId: randomUUID(),
          expectedVersion: version,
          action,
        }),
      },
      session.hostToken,
    );
    version = response.snapshot.version;
    return response.snapshot;
  }

  const started = await host("start");
  assert.ok(started.roundId);
  const idempotencyKey = randomUUID();
  const answerBody = JSON.stringify({
    roundId: started.roundId,
    choiceId: correctChoiceId,
    idempotencyKey,
  });
  const firstAnswer = await api<{ accepted: boolean; duplicate: boolean; answerId: string }>(
    `/v1/sessions/${session.sessionId}/answers`,
    { method: "POST", body: answerBody },
    participant.participantToken,
  );
  const retriedAnswer = await api<{ accepted: boolean; duplicate: boolean; answerId: string }>(
    `/v1/sessions/${session.sessionId}/answers`,
    { method: "POST", body: answerBody },
    participant.participantToken,
  );
  assert.equal(firstAnswer.accepted, true);
  assert.equal(retriedAnswer.duplicate, true);
  assert.equal(retriedAnswer.answerId, firstAnswer.answerId);

  // Answer acceptance advances the authoritative version once.
  version += 1;
  await host("lock");
  await host("reveal");
  await host("next");

  const report = await waitForReadyReport((signal) =>
    api<{
      report: {
        id: string;
        status: "pending" | "ready" | "failed";
        generatedAt: string | null;
        expiresAt: string;
        metrics: { answerCount: number; accuracyPercent: number };
      };
    }>(`/v1/sessions/${session.sessionId}/report`, { signal }).then(({ report }) => report),
  );
  assert.equal(report.metrics.answerCount, 1);
  assert.equal(report.metrics.accuracyPercent, 100);
  assert.ok(report.generatedAt);
  const retentionMs = new Date(report.expiresAt).getTime() - new Date(report.generatedAt).getTime();
  assert.ok(retentionMs >= 365 * 24 * 60 * 60_000 - 5_000);
  assert.ok(retentionMs <= 365 * 24 * 60 * 60_000 + 5_000);
  const csv = await fetch(`${baseUrl}/v1/reports/${report.id}.csv`, {
    headers: { cookie: creatorCookie },
  }).then((response) => response.text());
  assert.match(csv, /participant_id,nickname,score,correct_count,answer_count/);

  const exported = await api<{
    workspaces: Array<{ brand_theme?: typeof brandTheme; brandTheme?: typeof brandTheme }>;
    quizzes: unknown[];
    quizVersions: unknown[];
    mediaAssets: unknown[];
    sessions: unknown[];
    participants: unknown[];
    answers: unknown[];
    reports: unknown[];
    consentRecords: unknown[];
  }>("/v1/account/export");
  assert.equal(exported.workspaces.length, 1);
  assert.deepEqual(
    exported.workspaces[0]?.brand_theme ?? exported.workspaces[0]?.brandTheme,
    brandTheme,
  );
  assert.equal(exported.quizzes.length, 1);
  assert.equal(exported.quizVersions.length, 1);
  assert.equal(exported.mediaAssets.length, mediaAssetCount);
  assert.equal(exported.sessions.length, 1);
  assert.equal(exported.participants.length, 1);
  assert.equal(exported.answers.length, 1);
  assert.equal(exported.reports.length, 1);
  assert.equal(exported.consentRecords.length, 2);
  await api("/v1/account", { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE" }) });
  if (mediaDownloadUrl) assert.equal((await fetch(mediaDownloadUrl)).status, 404);
  const deletedParticipant = await fetch(
    `${baseUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
    {
      headers: {
        origin: browserOrigin,
        authorization: `Bearer ${participant.participantToken}`,
      },
    },
  );
  assert.equal(deletedParticipant.status, 404);
  const deletedSession = await fetch(`${baseUrl}/v1/auth/me`, {
    headers: { cookie: creatorCookie, origin: browserOrigin },
  });
  assert.equal(deletedSession.status, 401);

  process.stdout.write(
    `Compose smoke passed: auth, runtime kill switches, tenant RLS, authoring, live play, idempotency, reporting, export, deletion${features.mediaUploads ? ", and scanned media" : ""} (${me.creator.workspaceId}).\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
