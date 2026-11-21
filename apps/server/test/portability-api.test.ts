import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function authenticatedApp(communityMode: boolean, repository = new MemoryRepository()) {
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: String(communityMode),
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: `portable-${communityMode ? "community" : "free"}@example.com`,
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    `portable-${communityMode ? "community" : "free"}@example.com`,
  );
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  return { app, cookie };
}

async function createCheckpointSet(server: FastifyInstance, cookie: string) {
  const created = await server.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers: { cookie },
    payload: { title: "Portable safety set", description: "Transfer without lock-in" },
  });
  const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
  const updated = await server.inject({
    method: "PATCH",
    url: `/v1/quizzes/${quizId}`,
    headers: { cookie },
    payload: {
      expectedDraftRevision: 0,
      draft: {
        title: "Portable safety set",
        description: "Transfer without lock-in",
        questions: [
          {
            id: randomUUID(),
            type: "single_select",
            prompt: "=Which procedure is safe?",
            choices: [
              { id: randomUUID(), label: "Complete procedure", isCorrect: true },
              { id: randomUUID(), label: "Shortcut", isCorrect: false },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "Use the complete procedure.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
    },
  });
  expect(updated.statusCode).toBe(200);
  return quizId;
}

describe("checkpoint-set portability API", () => {
  it("exports, validates, and imports in the Community edition", async () => {
    const { app: server, cookie } = await authenticatedApp(true);
    const quizId = await createCheckpointSet(server, cookie);

    const createdFolder = await server.inject({
      method: "POST",
      url: "/v1/folders",
      headers: { cookie },
      payload: { name: "Safety training" },
    });
    expect(createdFolder.statusCode).toBe(201);
    const folderId = createdFolder.json<{ folder: { id: string } }>().folder.id;
    const organized = await server.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}/organization`,
      headers: { cookie },
      payload: { folderId, tags: ["Compliance", "compliance", "New hire"] },
    });
    expect(organized.statusCode).toBe(200);
    expect(organized.json()).toMatchObject({
      quiz: { folderId, tags: ["Compliance", "New hire"] },
    });
    const folders = await server.inject({ method: "GET", url: "/v1/folders", headers: { cookie } });
    expect(folders.json()).toMatchObject({ folders: [{ id: folderId, name: "Safety training" }] });
    expect(
      (
        await server.inject({
          method: "PATCH",
          url: `/v1/folders/${folderId}`,
          headers: { cookie },
          payload: { name: "Core safety" },
        })
      ).json(),
    ).toMatchObject({ folder: { id: folderId, name: "Core safety" } });

    const jsonExport = await server.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/export.json`,
      headers: { cookie },
    });
    expect(jsonExport.statusCode).toBe(200);
    expect(jsonExport.headers["content-disposition"]).toContain(`${quizId}.json`);
    expect(jsonExport.json()).toMatchObject({
      format: "openround.checkpoint-set",
      version: 2,
      checkpointSet: { title: "Portable safety set" },
    });

    const csvExport = await server.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/export.csv`,
      headers: { cookie },
    });
    expect(csvExport.statusCode).toBe(200);
    expect(csvExport.body).toContain("'=Which procedure is safe?");

    const qtiExport = await server.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/export.qti.zip`,
      headers: { cookie },
    });
    expect(qtiExport.statusCode).toBe(200);
    expect(qtiExport.headers["content-type"]).toContain("application/zip");
    expect(qtiExport.rawPayload.subarray(0, 2).toString("binary")).toBe("PK");

    const qtiImported = await server.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: { cookie },
      payload: {
        format: "qti3",
        encoding: "base64",
        data: qtiExport.rawPayload.toString("base64"),
        title: "Imported QTI safety set",
      },
    });
    expect(qtiImported.statusCode).toBe(201);
    expect(qtiImported.json()).toMatchObject({
      quiz: { title: "Imported QTI safety set", status: "draft" },
      validation: { format: "qti3", importedCheckpoints: 1, errors: [] },
    });

    const imported = await server.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: { cookie },
      payload: {
        format: "openround_json",
        data: jsonExport.body,
        title: "Imported safety set",
      },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      quiz: { title: "Imported safety set", status: "draft" },
      validation: { importedCheckpoints: 1, errors: [] },
    });
    expect(imported.json<{ quiz: { id: string } }>().quiz.id).not.toBe(quizId);

    expect(
      (
        await server.inject({
          method: "DELETE",
          url: `/v1/folders/${folderId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/v1/quizzes/${quizId}`,
          headers: { cookie },
        })
      ).json(),
    ).toMatchObject({ quiz: { folderId: null, tags: ["Compliance", "New hire"] } });

    const invalid = await server.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: { cookie },
      payload: { format: "csv", data: "type,prompt\nsingle_select,Question" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      error: { code: "IMPORT_VALIDATION_FAILED" },
      validation: { importedCheckpoints: 0, errors: [{ code: "MISSING_HEADERS" }] },
    });
  });

  it("keeps hosted portability behind the configured Pro entitlement", async () => {
    const { app: server, cookie } = await authenticatedApp(false);
    const quizId = await createCheckpointSet(server, cookie);

    const exported = await server.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/export.json`,
      headers: { cookie },
    });
    expect(exported.statusCode).toBe(402);
    expect(exported.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });

    const imported = await server.inject({
      method: "POST",
      url: "/v1/quizzes/import",
      headers: { cookie },
      payload: { format: "bulk", data: "Question\n* Correct\n- Incorrect" },
    });
    expect(imported.statusCode).toBe(402);
    expect(imported.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });

    const qtiExport = await server.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}/export.qti.zip`,
      headers: { cookie },
    });
    expect(qtiExport.statusCode).toBe(402);
  });

  it("reports unavailable exports and branding when a Pro workspace has both features disabled", async () => {
    const repository = new MemoryRepository();
    const { app: server, cookie } = await authenticatedApp(false, repository);
    const quizId = await createCheckpointSet(server, cookie);
    const headers = { cookie };
    const { creator } = (await server.inject({ url: "/v1/auth/me", headers })).json<{
      creator: { userId: string; workspaceId: string };
    }>();
    await repository.setPlan(creator.workspaceId, "pro");
    await createPlatformRepository(repository).saveFeaturePolicy({
      expectedRevision: 0,
      features: {
        csvExport: { enabled: false, plans: [] },
        brandTheme: { enabled: false, plans: [] },
      },
    });
    const account = await server.inject({ url: "/v1/auth/me", headers });
    expect(account.statusCode).toBe(200);
    expect(account.json()).toMatchObject({
      entitlements: { plan: "pro", csvExport: false, brandTheme: false },
    });

    for (const format of ["json", "csv", "qti.zip"]) {
      const exported = await server.inject({
        url: `/v1/quizzes/${quizId}/export.${format}`,
        headers,
      });
      expect(exported.statusCode).toBe(402);
      expect(exported.json()).toMatchObject({
        error: {
          code: "ENTITLEMENT_LIMIT",
          message: "Checkpoint-set export is unavailable for this workspace",
        },
      });
    }

    const themePath = `/v1/account/theme?expectedWorkspaceId=${creator.workspaceId}`;
    const availability = await server.inject({ url: themePath, headers });
    expect(availability.statusCode).toBe(200);
    expect(availability.json()).toMatchObject({
      theme: null,
      enabled: false,
      unavailableReason: "operator_policy",
    });

    const theme = await server.inject({
      method: "PUT",
      url: themePath,
      headers,
      payload: {
        organizationName: "Northern Learning",
        primaryColor: "#0B2239",
        accentColor: "#087375",
      },
    });
    expect(theme.statusCode).toBe(402);
    expect(theme.headers["cache-control"]).toBe("private, no-store");
    expect(theme.json()).toMatchObject({
      error: {
        code: "ENTITLEMENT_LIMIT",
        message: "Saving the live brand is unavailable for this workspace",
        details: {
          unavailableReason: "operator_policy",
          actorId: creator.userId,
          workspaceId: creator.workspaceId,
        },
      },
    });
  });

  it("explains the Free plan default and preserves branding management through policy changes", async () => {
    const repository = new MemoryRepository();
    const { app: server, cookie } = await authenticatedApp(false, repository);
    const headers = { cookie };
    const { creator } = (await server.inject({ url: "/v1/auth/me", headers })).json<{
      creator: { userId: string; workspaceId: string; plan: string };
    }>();
    expect(creator.plan).toBe("free");
    const url = `/v1/account/theme?expectedWorkspaceId=${creator.workspaceId}`;
    const payload = {
      organizationName: "Northern Learning",
      primaryColor: "#0B2239",
      accentColor: "#087375",
    };

    const defaultRead = await server.inject({ url, headers });
    expect(defaultRead.statusCode).toBe(200);
    expect(defaultRead.json()).toMatchObject({
      theme: null,
      enabled: false,
      unavailableReason: "plan_limit",
    });
    const defaultDenied = await server.inject({
      method: "PUT",
      url: "/v1/account/theme",
      headers,
      payload,
    });
    expect(defaultDenied.statusCode).toBe(402);
    expect(defaultDenied.headers["cache-control"]).toBe("private, no-store");
    expect(defaultDenied.json()).toMatchObject({
      error: {
        code: "ENTITLEMENT_LIMIT",
        details: {
          unavailableReason: "plan_limit",
          actorId: creator.userId,
          workspaceId: creator.workspaceId,
        },
      },
    });

    const platform = createPlatformRepository(repository);
    const grant = await platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: { brandTheme: { enabled: true, plans: ["free"] } },
    });
    const granted = await server.inject({ url, headers });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({ enabled: true, unavailableReason: null });
    const saved = await server.inject({ method: "PUT", url, headers, payload });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.headers["cache-control"]).toBe("private, no-store");
    expect(saved.json()).toMatchObject({ theme: payload });

    await platform.saveFeaturePolicy({
      expectedRevision: grant.revision,
      features: { brandTheme: { enabled: true, plans: ["pro"] } },
    });
    const revoked = await server.inject({ url, headers });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      theme: payload,
      enabled: false,
      unavailableReason: "operator_policy",
    });
    const reset = await server.inject({ method: "DELETE", url, headers });
    expect(reset.statusCode).toBe(204);
    expect((await server.inject({ url, headers })).json()).toMatchObject({
      theme: null,
      enabled: false,
      unavailableReason: "operator_policy",
    });
  });
});
