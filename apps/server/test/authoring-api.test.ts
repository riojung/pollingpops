import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import type { AuthoringAssistant } from "../src/authoring-assistant.js";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
const BETA_WORKSPACE_ID = "10000000-0000-4000-8000-000000000006";

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function signIn(target: FastifyInstance, email: string) {
  const requested = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "education", acceptPolicies: true },
  });
  const token = new URL(requested.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(target, `/v1/auth/verify?token=${token}`, email);
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

function testAssistant(): AuthoringAssistant {
  return {
    providerName: "approved-test-provider",
    modelName: "grounded-test-model",
    generate: vi.fn().mockResolvedValue({
      title: "Energy isolation",
      description: "Generated for human review.",
      conceptKey: "energy-isolation",
      citations: [
        {
          locator: "paragraph 1",
          excerpt: "Lockout physically isolates hazardous energy",
        },
      ],
      main: {
        type: "single_select",
        prompt: "What physically isolates hazardous energy?",
        purpose: "diagnostic",
        confidence: "required",
        explanation: "Lockout provides physical isolation.",
        timeLimitSeconds: 30,
        citationIndexes: [0],
        choices: [
          {
            label: "Lockout",
            isCorrect: true,
            rationale: "It provides physical isolation.",
            misconceptionLabel: null,
          },
          {
            label: "A warning sign",
            isCorrect: false,
            rationale: "A sign does not isolate energy.",
            misconceptionLabel: "warning-is-isolation",
          },
        ],
      },
      recheck: {
        type: "single_select",
        prompt: "Which action separates a machine from hazardous energy before maintenance?",
        purpose: "practice",
        confidence: "optional",
        explanation: "Apply lockout before maintenance.",
        timeLimitSeconds: 30,
        citationIndexes: [0],
        choices: [
          {
            label: "Apply lockout",
            isCorrect: true,
            rationale: "It separates the energy source.",
            misconceptionLabel: null,
          },
          {
            label: "Post a reminder",
            isCorrect: false,
            rationale: "A reminder is not isolation.",
            misconceptionLabel: "communication-is-control",
          },
        ],
      },
    }),
  };
}

function config() {
  return ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
    FEATURE_PRESENTATIONS: "true",
    AUTH_DEBUG_MAGIC_LINKS: "true",
    LOG_LEVEL: "silent",
  });
}

describe("authoring assistant API", () => {
  it("reports a disabled deployment and refuses to retain a source", async () => {
    const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
    const built = await buildApp(config(), {
      repository,
      cache: new MemorySessionCache(),
      authoringAssistant: null,
    });
    app = built.app;
    const cookie = await signIn(app, "disabled-authoring@example.com");

    const status = await app.inject({
      method: "GET",
      url: "/v1/authoring/status",
      headers: { cookie },
    });
    expect(status.json()).toMatchObject({
      status: { enabled: false, monthlyLimit: 3, used: 0, remaining: 3 },
    });
    const attempted = await app.inject({
      method: "POST",
      url: "/v1/authoring/jobs",
      headers: { cookie },
      payload: {
        sourceType: "pasted_text",
        sourceName: "Private notes",
        text: "This source is long enough to pass request validation but must not be stored.",
      },
    });
    expect(attempted.statusCode).toBe(503);
    expect(attempted.json()).toMatchObject({ error: { code: "AUTHORING_DISABLED" } });
    expect(repository.authoringJobs.size).toBe(0);
  });

  it("queues, processes, reviews, and explicitly applies an unpublished draft", async () => {
    const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
    const assistant = testAssistant();
    const built = await buildApp(config(), {
      repository,
      cache: new MemorySessionCache(),
      authoringAssistant: assistant,
    });
    app = built.app;
    const cookie = await signIn(app, "enabled-authoring@example.com");
    const source =
      "Lockout physically isolates hazardous energy before maintenance. A warning sign does not provide isolation.";

    const queued = await app.inject({
      method: "POST",
      url: "/v1/authoring/jobs",
      headers: { cookie },
      payload: { sourceType: "pasted_text", sourceName: "Safety guide", text: source },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.body).not.toContain(source);
    const jobId = queued.json<{ job: { id: string } }>().job.id;

    const workerResult = await built.authoringWorker.runOnce();
    const persistedJob = repository.authoringJobs.get(jobId);
    expect(workerResult, persistedJob?.lastError ?? "Authoring worker failed").toBe("completed");
    const reviewed = await app.inject({
      method: "GET",
      url: `/v1/authoring/jobs/${jobId}`,
      headers: { cookie },
    });
    expect(reviewed.json()).toMatchObject({
      job: {
        status: "ready",
        output: {
          provider: "approved-test-provider",
          checkpointSet: { title: "Energy isolation" },
        },
      },
    });
    const proposal = reviewed.json<{
      job: {
        output: {
          contentSlideProposals: Array<{ id: string; title: string }>;
          checkpointSet: {
            questions: Array<{ id: string; choices?: Array<{ id: string }> }>;
          };
        };
      };
    }>().job.output;
    expect(proposal.contentSlideProposals).toEqual([
      expect.objectContaining({
        title: "Lockout physically isolates hazardous energy before maintenance.",
      }),
    ]);
    expect(reviewed.body).not.toContain(source);

    const beforeConfirmation = await app.inject({
      method: "GET",
      url: "/v1/presentations",
      headers: { cookie },
    });
    expect(beforeConfirmation.json()).toMatchObject({ presentations: [] });

    const applied = await app.inject({
      method: "POST",
      url: `/v1/authoring/jobs/${jobId}/apply`,
      headers: { cookie },
      payload: {},
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json()).toMatchObject({
      quiz: { status: "draft", currentVersionId: null, tags: ["ai-assisted"] },
    });
    const presentationApplied = await app.inject({
      method: "POST",
      url: `/v1/authoring/jobs/${jobId}/apply-presentation`,
      headers: { cookie },
      payload: {},
    });
    expect(presentationApplied.statusCode).toBe(201);
    expect(presentationApplied.json()).toMatchObject({
      presentation: {
        status: "draft",
        currentVersionId: null,
        draft: {
          title: "Energy isolation",
          sourceDisclosure: {
            sourceName: "Safety guide",
            provider: "approved-test-provider",
            model: "grounded-test-model",
          },
          blocks: [
            {
              kind: "content",
              textElements: expect.arrayContaining([
                expect.objectContaining({
                  role: "title",
                  text: "Lockout physically isolates hazardous energy before maintenance.",
                }),
              ]),
              citations: [{ locator: "paragraph 1" }],
            },
            { kind: "question", citations: [{ locator: "paragraph 1" }] },
            { kind: "question", citations: [{ locator: "paragraph 1" }] },
          ],
        },
      },
    });
    expect(repository.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "authoring.job.create",
        "authoring.job.apply",
        "presentation.source_proposal.apply",
      ]),
    );

    const created = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Existing presentation", description: "" },
    });
    const target = created.json<{
      presentation: { id: string; draftRevision: number; draft: { blocks: Array<{ id: string }> } };
    }>().presentation;
    const mutationId = randomUUID();
    const insertionPayload = {
      authoringJobId: jobId,
      selectedContentSlideIds: [proposal.contentSlideProposals[0]!.id],
      // Selecting either half brings the complete Recovery pair across.
      selectedQuestionIds: [proposal.checkpointSet.questions[0]!.id],
      afterBlockId: target.draft.blocks[0]!.id,
      expectedRevision: target.draftRevision,
      mutationId,
    };
    const inserted = await app.inject({
      method: "POST",
      url: `/v1/presentations/${target.id}/blocks/source-proposals`,
      headers: { cookie },
      payload: insertionPayload,
    });
    expect(inserted.statusCode).toBe(200);
    const insertedBody = inserted.json<{
      insertedBlockIds: string[];
      presentation: {
        draftRevision: number;
        draft: {
          blocks: Array<{
            id: string;
            kind: "content" | "question";
            citations?: Array<{ locator: string; excerpt: string }>;
            question?: {
              id: string;
              linkedRecheckQuestionId: string | null;
              choices?: Array<{ id: string }>;
            };
            sourceDisclosure?: { provider: string; sourceDigest: string };
          }>;
        };
      };
    }>();
    expect(insertedBody.insertedBlockIds).toHaveLength(3);
    expect(insertedBody.presentation.draft.blocks.slice(1).map(({ kind }) => kind)).toEqual([
      "content",
      "question",
      "question",
    ]);
    const insertedQuestions = insertedBody.presentation.draft.blocks
      .slice(1)
      .filter((block) => block.kind === "question");
    expect(insertedQuestions[0]?.question?.id).not.toBe(proposal.checkpointSet.questions[0]!.id);
    expect(insertedQuestions[0]?.question?.linkedRecheckQuestionId).toBe(
      insertedQuestions[1]?.question?.id,
    );
    expect(insertedQuestions[0]?.question?.choices?.map(({ id }) => id)).not.toEqual(
      proposal.checkpointSet.questions[0]!.choices?.map(({ id }) => id),
    );
    expect(insertedBody.presentation.draft.blocks[1]?.citations).toEqual([
      expect.objectContaining({ locator: "paragraph 1" }),
    ]);
    expect(insertedBody.presentation.draft.blocks[1]?.sourceDisclosure).toMatchObject({
      provider: "approved-test-provider",
      sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const retriedInsertion = await app.inject({
      method: "POST",
      url: `/v1/presentations/${target.id}/blocks/source-proposals`,
      headers: { cookie },
      payload: insertionPayload,
    });
    expect(retriedInsertion.statusCode).toBe(200);
    expect(retriedInsertion.json()).toMatchObject({
      insertedBlockIds: insertedBody.insertedBlockIds,
      presentation: { draftRevision: 1 },
    });
    expect(
      retriedInsertion.json<{
        presentation: { draft: { blocks: unknown[] } };
      }>().presentation.draft.blocks,
    ).toHaveLength(4);
  });

  it("accepts a private file request above the global JSON body limit", async () => {
    const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
    const built = await buildApp(config(), {
      repository,
      cache: new MemorySessionCache(),
      authoringAssistant: testAssistant(),
      scanner: { scan: vi.fn().mockResolvedValue({ clean: true, signature: null }) },
    });
    app = built.app;
    const cookie = await signIn(app, "file-authoring@example.com");
    const fakePdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(180_000, 32)]);
    const queued = await app.inject({
      method: "POST",
      url: "/v1/authoring/jobs",
      headers: { cookie },
      payload: {
        sourceType: "pdf",
        sourceName: "Large handout.pdf",
        mimeType: "application/pdf",
        encoding: "base64",
        data: fakePdf.toString("base64"),
      },
    });
    expect(queued.statusCode).toBe(202);
  });

  it("rejects file sources before retention when malware scanning fails", async () => {
    const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
    const built = await buildApp(config(), {
      repository,
      cache: new MemorySessionCache(),
      authoringAssistant: testAssistant(),
      scanner: { scan: vi.fn().mockResolvedValue({ clean: false, signature: "test-signature" }) },
    });
    app = built.app;
    const cookie = await signIn(app, "unsafe-file-authoring@example.com");
    const fakePdf = Buffer.from("%PDF-test-source");
    const response = await app.inject({
      method: "POST",
      url: "/v1/authoring/jobs",
      headers: { cookie },
      payload: {
        sourceType: "pdf",
        sourceName: "unsafe.pdf",
        mimeType: "application/pdf",
        encoding: "base64",
        data: fakePdf.toString("base64"),
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "ANSWER_INVALID" } });
    expect(repository.authoringJobs.size).toBe(0);
  });
});
