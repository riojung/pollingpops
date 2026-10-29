import { signInFromVerificationResponse } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import * as yauzl from "yauzl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecoveryPackContentSchema,
  RecoveryPackExportReportEnvelopeSchema,
  RecoveryPackExportReportSchema,
  RecoveryPackJsonSchema,
  recoveryPackContentHash,
  type RecoveryPackContent,
} from "@openround/contracts";
import {
  createRecoveryPackRepository,
  MemoryRepository,
  type RecoveryPackRecord,
  type RecoveryPackVersionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { checkpointSetCsv, importCheckpointSet } from "../src/portability.js";
import { exportQtiPackage, importQtiPackage } from "../src/qti.js";
import { recoveryPackExportProfile } from "../src/recovery-pack-portability.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

function content(mediaId: string | null = null): RecoveryPackContent {
  const citation = {
    sourceName: "Private source name",
    sourceDigest: "a".repeat(64),
    locator: "https://private.example/source",
    excerpt: "Private source excerpt not intended for checkpoint conversion.",
  };
  const common = {
    purpose: "diagnostic" as const,
    confidence: "required" as const,
    delivery: "main" as const,
    conceptKeys: ["evidence"],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: '+Comparer les observations, "漢字".\nThen transfer the evidence.',
    mediaId: null,
    mediaAlt: null,
  };
  const recheckId = randomUUID();
  return RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: 'Evidence, "漢字" recovery',
    description: "Private Pack description not in the converted checkpoints.",
    diagnostic: {
      ...common,
      id: randomUUID(),
      type: "single_select",
      prompt: '=Quel signal, "漢字" & <evidence>?\nCompare evidence &amp; literally.',
      linkedRecheckQuestionId: recheckId,
      mediaId,
      mediaAlt: mediaId ? `https://private.example/media/${mediaId}` : null,
      sourceCitations: [citation],
      choices: [
        { id: randomUUID(), label: "Observation, 漢字", isCorrect: true },
        {
          id: randomUUID(),
          label: 'Assumption "only"',
          isCorrect: false,
          feedback: "Distinguish evidence from assumption.",
          misconceptionKey: "assumption-is-evidence",
        },
      ],
    },
    recheck: {
      ...common,
      id: recheckId,
      type: "numeric",
      prompt: "What is the signed measurement in the transfer scenario?",
      delivery: "recheck",
      correctValue: "-12345678901234567890.123456789",
      tolerance: "0.000000001",
      unit: "métres",
    },
    delayedProbe: {
      ...common,
      id: randomUUID(),
      type: "multi_select",
      prompt: "Which two signals should be checked in the later scenario?",
      confidence: "optional",
      choices: [
        { id: randomUUID(), label: "Observation", isCorrect: true },
        { id: randomUUID(), label: "Comparison", isCorrect: true },
        { id: randomUUID(), label: "Guess", isCorrect: false },
      ],
    },
    interventions: [
      {
        id: randomUUID(),
        title: "Private card title",
        body: "Private card body: https://private.example/card",
        citations: [citation],
      },
    ],
    conceptKeys: ["evidence"],
    misconceptionKeys: ["assumption-is-evidence"],
    citations: [citation],
  });
}

function version(frozen = content()): RecoveryPackVersionRecord {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    packId: randomUUID(),
    version: 1,
    content: frozen,
    contentHash: recoveryPackContentHash(frozen),
    sourceDraftRevision: 0,
    publishedAt: new Date("2026-10-01T12:00:00Z"),
  };
}

async function zipContents(buffer: Buffer) {
  const archive = await yauzl.fromBufferPromise(buffer, { lazyEntries: true });
  const files = new Map<string, string>();
  try {
    for await (const entry of archive.eachEntry()) {
      const chunks: Buffer[] = [];
      for await (const chunk of await archive.openReadStreamPromise(entry)) {
        chunks.push(Buffer.from(chunk));
      }
      files.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
    }
  } finally {
    if (archive.isOpen) archive.close();
  }
  return files;
}

async function signIn(app: FastifyInstance, email = "portability-author@example.com") {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const verified = await signInFromVerificationResponse(app, magic, email);
  const cookies = verified.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function setup(
  options: {
    enabled?: boolean;
    community?: boolean;
    repository?: MemoryRepository;
    workspaceId?: string;
  } = {},
) {
  const workspaceId = options.workspaceId ?? randomUUID();
  const repository =
    options.repository ?? new MemoryRepository({ initialWorkspaceId: workspaceId });
  const { app } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: String(options.community ?? false),
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_RECOVERY_PACKS: String(options.enabled ?? true),
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: options.enabled === false ? "" : workspaceId,
    }),
    { repository, cache: new MemorySessionCache() },
  );
  apps.push(app);
  return { app, repository, workspaceId, cookie: await signIn(app) };
}

async function publish(app: FastifyInstance, cookie: string, frozen = content()) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/recovery-packs",
    headers: { cookie },
    payload: { draft: frozen },
  });
  expect(created.statusCode).toBe(201);
  const pack = created.json<{ pack: RecoveryPackRecord }>().pack;
  const published = await app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${pack.id}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode).toBe(200);
  return published.json<{ pack: RecoveryPackRecord; version: RecoveryPackVersionRecord }>();
}

describe("Recovery Pack checkpoint projections", () => {
  it("reports actual format boundaries deterministically without private media or authored source content", () => {
    const mediaId = randomUUID();
    const frozen = version(content(mediaId));
    const original = structuredClone(frozen);
    const csv = recoveryPackExportProfile(frozen, "csv");
    const qti = recoveryPackExportProfile(frozen, "qti3");
    expect(csv.report).toEqual(recoveryPackExportProfile(frozen, "csv").report);
    expect(csv.report).toMatchObject({
      schemaVersion: 1,
      format: "csv",
      source: {
        artifactType: "recovery_pack",
        packId: frozen.packId,
        packVersionId: frozen.id,
        packVersion: 1,
        contentHash: frozen.contentHash,
        title: frozen.content.title,
      },
      checkpointCount: 3,
      exportedCheckpointCount: 3,
      canExport: true,
    });
    for (const profile of [csv, qti]) {
      expect(RecoveryPackExportReportSchema.safeParse(profile.report).success).toBe(true);
      const serialized = JSON.stringify(profile.report);
      for (const privateValue of [
        mediaId,
        "https://private.example",
        "Private source",
        "Private card",
        frozen.content.description,
      ]) {
        expect(serialized).not.toContain(privateValue);
      }
      expect(profile.draft!.questions.map((question) => question.id)).toEqual([
        frozen.content.diagnostic.id,
        frozen.content.recheck.id,
        frozen.content.delayedProbe!.id,
      ]);
      expect(profile.draft!.questions.some((question) => question.recoveryPackSource)).toBe(false);
      expect(profile.draft!.recoveryPackInsertions).toBeUndefined();
      expect(profile.report.findings).toContainEqual(
        expect.objectContaining({
          code: "CHECKPOINT_MEDIA_OMITTED",
          fieldPath: "diagnostic.media",
        }),
      );
      expect(profile.report.findings).toContainEqual(
        expect.objectContaining({
          code: "CHECKPOINT_CITATIONS_OMITTED",
          fieldPath: "diagnostic.sourceCitations",
        }),
      );
    }
    expect(csv.report.findings).toContainEqual(
      expect.objectContaining({
        code: "CSV_FORMULA_ESCAPED",
        disposition: "transformed",
        fieldPath: "recheck",
      }),
    );
    expect(csv.report.findings.some((finding) => finding.code.startsWith("QTI_"))).toBe(false);
    expect(qti.report.findings).toContainEqual(
      expect.objectContaining({ code: "QTI_CHOICE_METADATA", disposition: "extension_only" }),
    );
    expect(qti.report.findings).toContainEqual(
      expect.objectContaining({ code: "QTI_NUMERIC_FLOAT_PRECISION", disposition: "transformed" }),
    );
    expect(
      qti.report.findings.find((finding) => finding.code === "PACK_TITLE_TRANSFORMED")?.reason,
    ).toContain("not a canonical Pack title");
    expect(frozen).toEqual(original);
  });

  it("round-trips CSV original checkpoint topology, Unicode, feedback and exact negative decimals", () => {
    const frozen = version();
    const { draft, report } = recoveryPackExportProfile(frozen, "csv");
    const exported = checkpointSetCsv(draft!);
    expect(exported).toContain(`"'=Quel signal`); // Protection is inside the CSV field quotes.
    expect(exported).toContain("'-12345678901234567890.123456789");
    expect(exported).toContain(frozen.content.diagnostic.id);
    expect(exported).toContain(frozen.content.recheck.id);
    for (const omitted of [
      frozen.content.interventions[0]!.body,
      frozen.content.description,
      "https://private.example/source",
    ]) {
      expect(exported).not.toContain(omitted);
    }
    const imported = importCheckpointSet("csv", exported, report.source.title);
    expect(imported.validation.errors).toEqual([]);
    const [diagnostic, recheck, probe] = imported.draft!.questions;
    expect(imported.draft!.questions).toHaveLength(3);
    expect(diagnostic!.id).not.toBe(frozen.content.diagnostic.id);
    expect(diagnostic!.linkedRecheckQuestionId).toBe(recheck!.id);
    expect(diagnostic).toMatchObject({
      prompt: frozen.content.diagnostic.prompt,
      conceptKeys: ["evidence"],
      confidence: "required",
      explanation: frozen.content.diagnostic.explanation,
    });
    expect(diagnostic!.type === "single_select" ? diagnostic!.choices[1] : null).toMatchObject({
      feedback: "Distinguish evidence from assumption.",
      misconceptionKey: "assumption-is-evidence",
    });
    expect(recheck).toMatchObject({
      type: "numeric",
      delivery: "recheck",
      correctValue: "-12345678901234567890.123456789",
      tolerance: "0.000000001",
      unit: "métres",
    });
    expect(probe).toMatchObject({ delivery: "main", linkedRecheckQuestionId: null });
    expect(diagnostic!.mediaId).toBeNull();
  });

  it("embeds the identical report in QTI, exports only original checkpoint items and preserves exact decimal reimport", async () => {
    const mediaId = randomUUID();
    const frozen = version(content(mediaId));
    const { report, draft } = recoveryPackExportProfile(frozen, "qti3");
    const exported = await exportQtiPackage(draft!, { exportReport: report });
    expect(exported.validation.errors).toEqual([]);
    const files = await zipContents(exported.archive!);
    expect(JSON.parse(files.get("openround-export-report.json")!)).toEqual(report);
    expect([...files.keys()].filter((path) => path.startsWith("items/"))).toHaveLength(3);
    expect([...files.keys()]).toContain(
      `items/item_${frozen.content.diagnostic.id.replaceAll("-", "_")}.xml`,
    );
    const serialized = [...files.values()].join("\n");
    const metadata = [
      ...serialized.matchAll(
        /identifier="OPENROUND_METADATA"[^>]*><qti-default-value><qti-value>([^<]+)<\/qti-value>/g,
      ),
    ]
      .map((match) => Buffer.from(match[1]!, "base64url").toString("utf8"))
      .join("\n");
    for (const privateValue of [
      mediaId,
      "https://private.example",
      frozen.content.interventions[0]!.body,
      "Private source excerpt",
    ]) {
      expect(serialized).not.toContain(privateValue);
      expect(metadata).not.toContain(privateValue);
    }
    const imported = await importQtiPackage(
      exported.archive!.toString("base64"),
      frozen.content.title,
    );
    expect(imported.validation.errors).toEqual([]);
    expect(imported.draft!.questions).toHaveLength(3);
    const [diagnostic, recheck, probe] = imported.draft!.questions;
    expect(diagnostic!.linkedRecheckQuestionId).toBe(recheck!.id);
    expect(diagnostic).toMatchObject({
      prompt: frozen.content.diagnostic.prompt,
      conceptKeys: ["evidence"],
      confidence: "required",
      mediaId: null,
      mediaAlt: null,
    });
    expect(recheck).toMatchObject({
      type: "numeric",
      prompt: frozen.content.recheck.prompt,
      correctValue: "-12345678901234567890.123456789",
      tolerance: "0.000000001",
      unit: "métres",
      delivery: "recheck",
    });
    expect(probe!.linkedRecheckQuestionId).toBeNull();
    expect(diagnostic!.type === "single_select" ? diagnostic!.choices[1] : null).toMatchObject({
      feedback: "Distinguish evidence from assumption.",
      misconceptionKey: "assumption-is-evidence",
    });
    const legacy = await exportQtiPackage(draft!);
    expect((await zipContents(legacy.archive!)).has("openround-export-report.json")).toBe(false);
  });

  it("counts two checkpoints without a probe and does not invent absent-media, citation or numeric findings", () => {
    const frozen = content();
    frozen.delayedProbe = null;
    frozen.description = "";
    frozen.citations = [];
    frozen.misconceptionKeys = [];
    frozen.interventions[0]!.citations = [];
    frozen.diagnostic.sourceCitations = [];
    const profile = recoveryPackExportProfile(version(frozen), "csv");
    expect(profile.report).toMatchObject({
      checkpointCount: 2,
      exportedCheckpointCount: 2,
      canExport: true,
    });
    expect(
      profile.report.findings.some((finding) =>
        /MEDIA|CITATIONS|DESCRIPTION|MISCONCEPTION/.test(finding.code),
      ),
    ).toBe(false);
  });

  it("reports authored-apostrophe ambiguity instead of claiming a lossless CSV projection", () => {
    const frozen = content();
    frozen.diagnostic.prompt = "'=Literal authored apostrophe";
    const profile = recoveryPackExportProfile(version(frozen), "csv");
    expect(profile.report.findings).toContainEqual(
      expect.objectContaining({
        code: "CSV_LITERAL_APOSTROPHE_AMBIGUOUS",
        disposition: "transformed",
        fieldPath: "diagnostic",
      }),
    );
    const imported = importCheckpointSet("csv", checkpointSetCsv(profile.draft!));
    expect(imported.validation.errors).toEqual([]);
    expect(imported.draft!.questions[0]!.prompt).toBe("=Literal authored apostrophe");
  });

  it("blocks unsupported frozen content with a bounded sanitized report, without partial exports", () => {
    const frozen = version();
    frozen.content.diagnostic.prompt = "";
    for (const format of ["csv", "qti3"] as const) {
      const profile = recoveryPackExportProfile(frozen, format);
      expect(profile.draft).toBeNull();
      expect(profile.report).toMatchObject({
        canExport: false,
        exportedCheckpointCount: 0,
        checkpointCount: 3,
      });
      expect(profile.report.findings).toEqual([
        expect.objectContaining({
          severity: "error",
          disposition: "unsupported",
          fieldPath: "content",
        }),
      ]);
      expect(RecoveryPackExportReportSchema.safeParse(profile.report).success).toBe(true);
    }
  });
});

describe("Recovery Pack text boundaries", () => {
  it("distinguishes QTI XML restrictions from CSV UTF-8 loss and ignores omitted invalid text", async () => {
    const frozen = version();
    frozen.content.diagnostic.prompt = "Control \u0001 in a diagnostic prompt";
    const csv = recoveryPackExportProfile(frozen, "csv");
    expect(csv.report.canExport).toBe(true);
    expect(checkpointSetCsv(csv.draft!)).toContain(frozen.content.diagnostic.prompt);
    const qti = recoveryPackExportProfile(frozen, "qti3");
    expect(qti.report).toMatchObject({ canExport: false, exportedCheckpointCount: 0 });
    expect(qti.report.findings).toContainEqual(
      expect.objectContaining({
        code: "INVALID_QTI_TEXT",
        severity: "error",
        fieldPath: "diagnostic.prompt",
      }),
    );
    expect((await exportQtiPackage(csv.draft!)).archive).toBeNull();
    for (const invalid of ["\ud800", "\udc00"]) {
      frozen.content.diagnostic.prompt = `Unpaired ${invalid} diagnostic text`;
      expect(recoveryPackExportProfile(frozen, "qti3").report.canExport).toBe(false);
      const blocked = recoveryPackExportProfile(frozen, "csv");
      expect(blocked.report).toMatchObject({ canExport: false, exportedCheckpointCount: 0 });
      expect(blocked.report.findings).toContainEqual(
        expect.objectContaining({
          code: "INVALID_CSV_UNICODE",
          severity: "error",
          fieldPath: "diagnostic.prompt",
        }),
      );
    }
    frozen.content.diagnostic.prompt = "Valid 🙂 diagnostic prompt";
    frozen.content.interventions[0]!.body = "Omitted \u0001 and \ud800 card text";
    frozen.content.citations[0]!.excerpt = "Omitted \u0001 and \udc00 source excerpt";
    expect(recoveryPackExportProfile(frozen, "csv").report.canExport).toBe(true);
    expect(recoveryPackExportProfile(frozen, "qti3").report.canExport).toBe(true);
  });
});

describe("Recovery Pack portability API", () => {
  it("makes preview and download availability agree for prohibited XML and invalid Unicode text", async () => {
    const { app, cookie } = await setup();
    for (const [invalid, csvAllowed] of [
      ["\u0001", true],
      ["\ud800", false],
    ] as const) {
      const frozen = content();
      frozen.diagnostic.prompt = `Unsupported ${invalid} text`;
      const { version: published } = await publish(app, cookie, frozen);
      const base = `/v1/recovery-packs/versions/${published.id}`;
      for (const [format, extension, allowed] of [
        ["csv", "csv", csvAllowed],
        ["qti3", "qti.zip", false],
      ] as const) {
        const preview = await app.inject({
          method: "GET",
          url: `${base}/export-report?format=${format}`,
          headers: { cookie },
        });
        expect(preview.statusCode).toBe(200);
        const { report } = RecoveryPackExportReportEnvelopeSchema.parse(preview.json());
        expect(report.canExport).toBe(allowed);
        const download = await app.inject({
          method: "GET",
          url: `${base}/export.${extension}`,
          headers: { cookie },
        });
        expect(download.statusCode).toBe(allowed ? 200 : 422);
        if (!allowed) expect(download.json()).toMatchObject({ error: { details: { report } } });
        else expect(download.body).toContain(published.content.diagnostic.prompt);
      }
    }
  });
  it("exports readable raw attachments, report headers and an unchanged lossless native JSON body", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId,
      objectKey: `private/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Private media",
      createdAt: new Date(),
    });
    const { version: frozen } = await publish(app, cookie, content(mediaId));
    const base = `/v1/recovery-packs/versions/${frozen.id}`;
    const nativeBefore = await app.inject({
      method: "GET",
      url: `${base}/export`,
      headers: { cookie },
    });
    expect(nativeBefore.body).toBe(
      JSON.stringify(
        RecoveryPackJsonSchema.parse({
          format: "openround-recovery-pack",
          schemaVersion: 1,
          content: frozen.content,
        }),
      ),
    );
    expect(nativeBefore.body).toContain(mediaId);
    for (const [format, extension, mime] of [
      ["csv", "csv", "text/csv"],
      ["qti3", "qti.zip", "application/zip"],
    ] as const) {
      const preflight = await app.inject({
        method: "GET",
        url: `${base}/export-report?format=${format}`,
        headers: { cookie },
      });
      expect(preflight.statusCode).toBe(200);
      const { report } = RecoveryPackExportReportEnvelopeSchema.parse(preflight.json());
      const download = await app.inject({
        method: "GET",
        url: `${base}/export.${extension}`,
        headers: { cookie, origin: "http://localhost:3000" },
      });
      expect(download.statusCode).toBe(200);
      expect(download.headers["content-type"]).toContain(mime);
      expect(download.headers["cache-control"]).toBe("private, no-store");
      expect(download.headers["content-disposition"]).toBe(
        `attachment; filename="polling-pops-recovery-pack-${frozen.id}.${extension}"`,
      );
      expect(download.headers["x-openround-export-report"]).toBe(
        `${base}/export-report?format=${format}`,
      );
      expect(download.headers["x-openround-export-warnings"]).toBe(
        String(report.findings.filter((finding) => finding.severity === "warning").length),
      );
      expect(download.headers["access-control-expose-headers"]).toContain(
        "x-openround-export-report",
      );
      expect(download.headers["access-control-expose-headers"]).toContain(
        "x-openround-export-warnings",
      );
      expect(preflight.headers["cache-control"]).toBe("private, no-store");
      expect(preflight.body).not.toContain(mediaId);
      if (format === "csv") expect(download.body).not.toContain(mediaId);
      else
        expect(
          JSON.parse((await zipContents(download.rawPayload)).get("openround-export-report.json")!),
        ).toEqual(report);
    }
    const nativeAfter = await app.inject({
      method: "GET",
      url: `${base}/export`,
      headers: { cookie },
    });
    expect(nativeAfter.body).toBe(nativeBefore.body);
    expect(nativeAfter.headers["content-disposition"]).toBe(
      nativeBefore.headers["content-disposition"],
    );
    expect(nativeAfter.headers["x-openround-export-report"]).toBeUndefined();
  });

  it("keeps reports and exported checkpoints bound to old versions after draft edits and republishing", async () => {
    const { app, cookie } = await setup();
    const { pack, version: first } = await publish(app, cookie);
    const base = `/v1/recovery-packs/versions/${first.id}`;
    const before = await app.inject({
      method: "GET",
      url: `${base}/export-report?format=csv`,
      headers: { cookie },
    });
    const edited = structuredClone(first.content);
    edited.title = "A later draft title";
    edited.diagnostic.prompt = "A later diagnostic prompt";
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/recovery-packs/${pack.id}/draft`,
      headers: { cookie },
      payload: { draft: edited, expectedRevision: 0, mutationId: randomUUID() },
    });
    expect(saved.statusCode).toBe(200);
    const next = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(next.statusCode).toBe(200);
    const second = next.json<{ version: RecoveryPackVersionRecord }>().version;
    expect(second.id).not.toBe(first.id);
    const after = await app.inject({
      method: "GET",
      url: `${base}/export-report?format=csv`,
      headers: { cookie },
    });
    expect(after.body).toBe(before.body);
    const csv = await app.inject({ method: "GET", url: `${base}/export.csv`, headers: { cookie } });
    expect(csv.body).not.toContain("A later diagnostic prompt");
    const latest = await app.inject({
      method: "GET",
      url: `/v1/recovery-packs/versions/${second.id}/export-report?format=csv`,
      headers: { cookie },
    });
    expect(latest.json()).toMatchObject({
      report: {
        source: {
          packVersionId: second.id,
          packVersion: 2,
          contentHash: second.contentHash,
          title: edited.title,
        },
      },
    });
  });

  it("allows viewers and paused/Community workspaces, without an export entitlement gate", async () => {
    const { app, cookie, repository, workspaceId } = await setup();
    const { version: frozen } = await publish(app, cookie);
    const member = [...repository.workspaceMembers.values()].find(
      (entry) => entry.workspaceId === workspaceId,
    )!;
    member.role = "viewer";
    repository.users.get(member.userId)!.role = "viewer";
    repository.plans.set(workspaceId, "free");
    const paused = await setup({ enabled: false, repository, workspaceId });
    const community = await setup({ enabled: false, community: true, repository, workspaceId });
    for (const server of [app, paused.app, community.app]) {
      for (const suffix of [
        "export-report?format=csv",
        "export-report?format=qti3",
        "export.csv",
        "export.qti.zip",
        "export",
      ]) {
        const result = await server.inject({
          method: "GET",
          url: `/v1/recovery-packs/versions/${frozen.id}/${suffix}`,
          headers: { cookie },
        });
        expect(result.statusCode).toBe(200);
        expect(result.headers["cache-control"]).toBe("private, no-store");
      }
    }
  });

  it("denies unauthenticated/other-tenant reads and validates UUIDs and the strict format query", async () => {
    const { app, cookie } = await setup();
    const { version: frozen } = await publish(app, cookie);
    const stranger = await signIn(app, "portability-stranger@example.com");
    for (const suffix of [
      "export-report?format=csv",
      "export-report?format=qti3",
      "export.csv",
      "export.qti.zip",
    ]) {
      const url = `/v1/recovery-packs/versions/${frozen.id}/${suffix}`;
      const unauthenticated = await app.inject({ method: "GET", url });
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.headers["cache-control"]).toBe("private, no-store");
      const otherTenant = await app.inject({ method: "GET", url, headers: { cookie: stranger } });
      expect(otherTenant.statusCode).toBe(404);
      expect(otherTenant.body).not.toContain(frozen.contentHash);
      const missing = await app.inject({
        method: "GET",
        url: `/v1/recovery-packs/versions/${randomUUID()}/${suffix}`,
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
    }
    for (const suffix of [
      "export-report",
      "export-report?format=json",
      "export-report?format=csv&extra=1",
      "export-report?format=csv&format=qti3",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/recovery-packs/versions/${frozen.id}/${suffix}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/recovery-packs/versions/not-a-uuid/export.csv",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("returns a sanitized blocking report for invalid returned content rather than a partial attachment", async () => {
    const { app, cookie, repository } = await setup();
    const { version: frozen } = await publish(app, cookie);
    frozen.content.diagnostic.prompt = "";
    vi.spyOn(createRecoveryPackRepository(repository), "getRecoveryPackVersion").mockResolvedValue(
      frozen,
    );
    for (const [format, extension] of [
      ["csv", "csv"],
      ["qti3", "qti.zip"],
    ] as const) {
      const base = `/v1/recovery-packs/versions/${frozen.id}`;
      const preflight = await app.inject({
        method: "GET",
        url: `${base}/export-report?format=${format}`,
        headers: { cookie },
      });
      expect(preflight.statusCode).toBe(200);
      const { report } = RecoveryPackExportReportEnvelopeSchema.parse(preflight.json());
      expect(report.canExport).toBe(false);
      const download = await app.inject({
        method: "GET",
        url: `${base}/export.${extension}`,
        headers: { cookie },
      });
      expect(download.statusCode).toBe(422);
      expect(download.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR", details: { report } },
      });
      expect(download.headers["content-disposition"]).toBeUndefined();
      expect(download.headers["cache-control"]).toBe("private, no-store");
    }
  });
});
