import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
const BETA_WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";

async function signIn(target: FastifyInstance) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "presentation-author@example.com",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    target,
    `/v1/auth/verify?token=${token}`,
    "presentation-author@example.com",
  );
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("presentation authoring API", () => {
  it("creates, revision-saves, restores, and publishes a mixed live deck", async () => {
    const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository,
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app);

    const created = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Quarterly learning review", description: "" },
    });
    expect(created.statusCode).toBe(201);
    const presentation = created.json<{
      presentation: { id: string; draftRevision: number; draft: { blocks: Array<{ id: string }> } };
    }>().presentation;
    expect(presentation.draftRevision).toBe(0);
    expect(presentation.draft.blocks).toHaveLength(1);

    const mutationId = randomUUID();
    const draft = {
      title: "Quarterly learning review",
      description: "A grounded interactive deck",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [
        {
          id: presentation.draft.blocks[0]!.id,
          kind: "content",
          layout: "title_body",
          textElements: [
            {
              id: `${presentation.draft.blocks[0]!.id}:title`,
              role: "title",
              text: "What changed this quarter?",
              region: "top_center",
              order: 0,
            },
            {
              id: `${presentation.draft.blocks[0]!.id}:body`,
              role: "body",
              text: "Review the evidence, then answer together.",
              region: "middle_center",
              order: 0,
            },
          ],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "Pause for questions.",
        },
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "single_select",
            prompt: "Which signal is strongest?",
            choices: [
              { id: randomUUID(), label: "Observed behaviour", isCorrect: true },
              { id: randomUUID(), label: "Raw volume", isCorrect: false },
            ],
            purpose: "diagnostic",
            confidence: "optional",
            delivery: "main",
            conceptKeys: ["evidence"],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 20,
            basePoints: 1000,
            explanation: "Behaviour is the direct signal.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    };
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie },
      payload: { draft, expectedRevision: 0, mutationId, schemaVersion: 2 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers.etag).toBe('"draft-1"');
    expect(saved.json()).toMatchObject({ presentation: { draftRevision: 1 } });
    const currentEditorId = saved.json<{ presentation: { lastEditedBy: string } }>().presentation
      .lastEditedBy;

    const interveningDraft = { ...draft, description: "An intervening editor save" };
    const intervening = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: interveningDraft,
        expectedRevision: 1,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(intervening.statusCode).toBe(200);
    expect(intervening.json()).toMatchObject({ presentation: { draftRevision: 2 } });

    const retried = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie },
      payload: { draft, expectedRevision: 0, mutationId, schemaVersion: 2 },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.headers.etag).toBe('"draft-1"');
    expect(retried.json()).toMatchObject({
      presentation: {
        draftRevision: 1,
        draft: { description: "A grounded interactive deck" },
      },
    });

    const stale = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: { ...draft, title: "Stale overwrite" },
        expectedRevision: 0,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: "STALE_DRAFT",
        details: { expectedDraftRevision: 0, currentDraftRevision: 2, currentEditorId },
      },
    });

    const history = await app.inject({
      method: "GET",
      url: `/v1/presentations/${presentation.id}/history`,
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    const historyItems = history.json<{ history: Array<Record<string, unknown>> }>().history;
    expect(historyItems).toHaveLength(3);
    expect(historyItems[0]).not.toHaveProperty("draft");
    expect(historyItems[0]).not.toHaveProperty("mutationId");
    expect(historyItems[0]).not.toHaveProperty("workspaceId");

    const restoreMutationId = randomUUID();
    const restored = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/history/1/restore`,
      headers: { cookie },
      payload: { expectedRevision: 2, mutationId: restoreMutationId },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.headers.etag).toBe('"draft-3"');
    expect(restored.json()).toMatchObject({ presentation: { draftRevision: 3 } });
    const afterRestore = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: { ...draft, description: "Saved after restore" },
        expectedRevision: 3,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(afterRestore.statusCode).toBe(200);
    expect(afterRestore.json()).toMatchObject({ presentation: { draftRevision: 4 } });
    const restoreRetry = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/history/1/restore`,
      headers: { cookie },
      payload: { expectedRevision: 2, mutationId: restoreMutationId },
    });
    expect(restoreRetry.statusCode).toBe(200);
    expect(restoreRetry.headers.etag).toBe('"draft-3"');
    expect(restoreRetry.json()).toMatchObject({
      presentation: {
        draftRevision: 3,
        draft: { description: "A grounded interactive deck" },
      },
    });

    const published = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 4 },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      version: { version: 1, sourceDraftRevision: 4 },
      presentation: { status: "published", hasUnpublishedChanges: false },
    });
    const publishRetry = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 4 },
    });
    expect(publishRetry.statusCode).toBe(200);
    expect(publishRetry.json()).toMatchObject({
      version: { id: published.json<{ version: { id: string } }>().version.id },
    });
    await built.productEvents.drain();
    expect(
      repository.productEvents.filter(
        (event) =>
          event.name === "round_published" && event.dimensions.artifactType === "presentation",
      ),
    ).toEqual([
      expect.objectContaining({
        workspaceId: BETA_WORKSPACE_ID,
        dimensions: {
          artifactType: "presentation",
          betaVersion: "p0-2026",
          segment: "workplace",
        },
      }),
    ]);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/presentations",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      presentations: [{ id: presentation.id, title: "Quarterly learning review", blockCount: 2 }],
    });
    expect(listed.json<{ presentations: unknown[] }>().presentations[0]).not.toHaveProperty(
      "draft",
    );
  });

  it("rejects mutation-key reuse and reports stale publish before validating newer content", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app);
    const first = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "First presentation", description: "" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Second presentation", description: "" },
    });
    const firstPresentation = first.json<{
      presentation: { id: string; draft: Record<string, unknown> };
    }>().presentation;
    const secondPresentation = second.json<{
      presentation: { id: string; draft: Record<string, unknown> };
    }>().presentation;
    const mutationId = randomUUID();
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${firstPresentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: { ...firstPresentation.draft, title: "First save" },
        expectedRevision: 0,
        mutationId,
        schemaVersion: 2,
      },
    });
    expect(saved.statusCode).toBe(200);

    const changedPayload = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${firstPresentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: { ...firstPresentation.draft, title: "Different save" },
        expectedRevision: 0,
        mutationId,
        schemaVersion: 2,
      },
    });
    expect(changedPayload.statusCode).toBe(409);
    expect(changedPayload.json()).toMatchObject({ error: { code: "CONFLICT" } });

    const changedTarget = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${secondPresentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: secondPresentation.draft,
        expectedRevision: 0,
        mutationId,
        schemaVersion: 2,
      },
    });
    expect(changedTarget.statusCode).toBe(409);
    expect(changedTarget.json()).toMatchObject({ error: { code: "CONFLICT" } });

    const invalidDraft = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${firstPresentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: {
          title: "",
          description: "",
          experiencePreset: { id: "focus", version: 1 },
          schemaVersion: 2,
          blocks: [],
        },
        expectedRevision: 1,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(invalidDraft.statusCode).toBe(200);

    const stalePublish = await app.inject({
      method: "POST",
      url: `/v1/presentations/${firstPresentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(stalePublish.statusCode).toBe(409);
    expect(stalePublish.json()).toMatchObject({ error: { code: "STALE_DRAFT" } });

    const blockedPublish = await app.inject({
      method: "POST",
      url: `/v1/presentations/${firstPresentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 2 },
    });
    expect(blockedPublish.statusCode).toBe(422);
    const blockers = blockedPublish.json<{
      error: {
        code: string;
        details: {
          issues: Array<{
            artifactType: string;
            artifactId: string;
            blockId: string | null;
            field: string;
            path: string;
            message: string;
          }>;
        };
      };
      validation: { issues: unknown[] };
    }>();
    expect(blockers.error.code).toBe("VALIDATION_ERROR");
    expect(blockers.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactType: "presentation",
          artifactId: firstPresentation.id,
          blockId: null,
          field: "title",
          path: "title",
        }),
        expect.objectContaining({
          artifactType: "presentation",
          artifactId: firstPresentation.id,
          blockId: null,
          field: "blocks",
          path: "blocks",
        }),
      ]),
    );
    expect(blockers.validation.issues).toEqual(blockers.error.details.issues);
  });

  it("copies selected published Round questions with independent IDs", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app);
    const round = await app.inject({
      method: "POST",
      url: "/v1/starters/misconception-check/use",
      headers: { cookie },
    });
    const source = round.json<{
      quiz: {
        id: string;
        draft: { questions: Array<{ id: string; choices: Array<{ id: string }> }> };
      };
    }>().quiz;
    const publishedRound = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${source.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 0 },
    });
    const sourceVersionId = publishedRound.json<{ version: { id: string } }>().version.id;
    const created = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Imported questions", description: "" },
    });
    const presentation = created.json<{ presentation: { id: string } }>().presentation;
    const mutationId = randomUUID();
    const importPayload = {
      sourceQuizVersionId: sourceVersionId,
      // Selecting only the recheck still copies its diagnostic pair in source order.
      questionIds: [source.draft.questions[1]!.id],
      afterBlockId: null,
      expectedRevision: 0,
      mutationId,
    };
    const imported = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/blocks/import`,
      headers: { cookie },
      payload: importPayload,
    });
    expect(imported.statusCode).toBe(200);
    const blocks = imported.json<{
      presentation: {
        draft: {
          blocks: Array<{
            kind: string;
            question?: {
              id: string;
              choices?: Array<{ id: string }>;
              linkedRecheckQuestionId?: string;
            };
          }>;
        };
      };
    }>().presentation.draft.blocks;
    const copied = blocks.filter((block) => block.kind === "question");
    expect(copied).toHaveLength(source.draft.questions.length);
    expect(
      copied.map(
        (block) =>
          (block as { provenance?: { sourceQuestionId: string } }).provenance?.sourceQuestionId,
      ),
    ).toEqual(source.draft.questions.map((question) => question.id));
    expect(copied.map((block) => block.question!.id)).not.toEqual(
      source.draft.questions.map((question) => question.id),
    );
    expect(copied[0]?.question?.linkedRecheckQuestionId).toBe(copied[1]?.question?.id);

    const retried = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/blocks/import`,
      headers: { cookie },
      payload: importPayload,
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      insertedBlockIds: imported.json<{ insertedBlockIds: string[] }>().insertedBlockIds,
      presentation: { draftRevision: 1 },
    });
    expect(
      retried.json<{ presentation: { draft: { blocks: unknown[] } } }>().presentation.draft.blocks,
    ).toHaveLength(blocks.length);

    const missingAnchor = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/blocks/import`,
      headers: { cookie },
      payload: {
        ...importPayload,
        expectedRevision: 1,
        mutationId: randomUUID(),
        afterBlockId: randomUUID(),
      },
    });
    expect(missingAnchor.statusCode).toBe(422);
    expect(missingAnchor.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
