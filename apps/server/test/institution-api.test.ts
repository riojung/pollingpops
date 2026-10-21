import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import type { OidcProvider } from "../src/oidc-service.js";

class FakeOidcProvider implements OidcProvider {
  async authorizationUrl(input: { state: string }) {
    return `https://identity.example.edu/authorize?state=${encodeURIComponent(input.state)}`;
  }

  async exchange() {
    return {
      issuer: "https://identity.example.edu",
      subject: "subject-123",
      emailHint: "owner@example.edu",
    };
  }
}

async function signIn(app: FastifyInstance) {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "owner@example.edu", segment: "education", acceptPolicies: true },
  });
  const token = new URL(requested.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "owner@example.edu",
  );
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

describe("institution policy and OIDC API", () => {
  it("keeps policy operator-gated and supports explicit link followed by login", async () => {
    const repository = new MemoryRepository();
    const adminToken = "institution-admin-token-123456789";
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
        ADMIN_TOKEN: adminToken,
        OIDC_MODE: "generic",
        OIDC_ISSUER: "https://identity.example.edu",
        OIDC_CLIENT_ID: "openround-test",
        OIDC_CLIENT_SECRET: "test-secret",
        OIDC_PROVIDER_NAME: "Example University",
      }),
      {
        repository,
        cache: new MemorySessionCache(),
        oidcProvider: new FakeOidcProvider(),
      },
    );
    const app = built.app;
    try {
      const cookie = await signIn(app);
      const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
      const workspaceId = account.json<{ creator: { workspaceId: string } }>().creator.workspaceId;

      const initialPolicy = await app.inject({
        method: "GET",
        url: "/v1/workspace/institution-policy",
        headers: { cookie },
      });
      expect(initialPolicy.json()).toMatchObject({
        contractStatus: "disabled",
        identityRequirement: "guest",
        capabilities: { oidc: false },
        k12Enabled: false,
      });
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/v1/admin/workspaces/${workspaceId}/institution-policy`,
            payload: {
              contractStatus: "pilot",
              identityRequirement: "optional",
              capabilities: {
                oidc: true,
                managedSso: false,
                scim: false,
                lti: false,
                nrps: false,
                ags: false,
                auditExports: true,
                residencyControls: true,
              },
              k12Enabled: false,
            },
          })
        ).statusCode,
      ).toBe(401);

      const granted = await app.inject({
        method: "PUT",
        url: `/v1/admin/workspaces/${workspaceId}/institution-policy`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          contractStatus: "pilot",
          identityRequirement: "optional",
          capabilities: {
            oidc: true,
            managedSso: false,
            scim: false,
            lti: false,
            nrps: false,
            ags: false,
            auditExports: true,
            residencyControls: true,
          },
          k12Enabled: false,
        },
      });
      expect(granted.statusCode).toBe(200);
      expect(granted.json()).toMatchObject({ contractStatus: "pilot", k12Enabled: false });

      const auditExport = await app.inject({
        method: "GET",
        url: "/v1/workspace/audit-export",
        headers: { cookie },
      });
      expect(auditExport.statusCode).toBe(200);
      expect(auditExport.headers["cache-control"]).toBe("no-store");
      expect(auditExport.json()).toMatchObject({
        format: "openround.audit",
        schemaVersion: 1,
        workspace: { id: workspaceId, homeRegion: "ca-central-1" },
        range: { truncated: false, maximumEvents: 10_000 },
        events: [expect.objectContaining({ action: "institution.policy.update" })],
      });
      expect(repository.audits.at(-1)).toMatchObject({
        action: "institution.audit.export",
        actorId: expect.any(String),
      });

      const status = await app.inject({
        method: "GET",
        url: `/v1/auth/oidc/status?workspaceId=${workspaceId}`,
      });
      expect(status.json()).toEqual({
        enabled: true,
        providerName: "Example University",
        workspaceId,
        identityRequirement: "optional",
      });

      const startedLink = await app.inject({
        method: "POST",
        url: "/v1/auth/oidc/start",
        headers: { cookie },
        payload: { workspaceId, mode: "link" },
      });
      expect(startedLink.statusCode).toBe(200);
      const linkUrl = new URL(startedLink.json<{ authorizationUrl: string }>().authorizationUrl);
      const linkState = linkUrl.searchParams.get("state")!;
      const linked = await app.inject({
        method: "GET",
        url: `/v1/auth/oidc/callback?state=${encodeURIComponent(linkState)}&code=test`,
        headers: { cookie },
      });
      expect(linked.statusCode).toBe(302);
      expect(linked.headers.location).toBe("http://localhost:3000/account?federated=linked");

      const identities = await app.inject({
        method: "GET",
        url: "/v1/auth/federated-identities",
        headers: { cookie },
      });
      expect(identities.body).not.toContain("subject-123");
      expect(identities.json()).toMatchObject({
        identities: [{ provider: "oidc", issuer: "https://identity.example.edu" }],
      });

      const startedLogin = await app.inject({
        method: "POST",
        url: "/v1/auth/oidc/start",
        payload: { workspaceId, mode: "login" },
      });
      const loginState = new URL(
        startedLogin.json<{ authorizationUrl: string }>().authorizationUrl,
      ).searchParams.get("state")!;
      const loggedIn = await app.inject({
        method: "GET",
        url: `/v1/auth/oidc/callback?state=${encodeURIComponent(loginState)}&code=test`,
      });
      expect(loggedIn.statusCode).toBe(302);
      expect(loggedIn.headers["set-cookie"]).toBeDefined();
      expect(loggedIn.headers.location).toBe("http://localhost:3000/dashboard?federated=1");

      expect(
        repository.audits
          .map((audit) => audit.action)
          .filter((action) => action.startsWith("federated")),
      ).toEqual(["federated_identity.link", "federated_identity.login"]);
      expect(repository.audits.some((audit) => audit.action === "institution.policy.update")).toBe(
        true,
      );
    } finally {
      await app.close();
    }
  });

  it("rejects invalid capability combinations and cannot enable K-12", async () => {
    const repository = new MemoryRepository();
    const adminToken = "institution-admin-token-123456789";
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
        ADMIN_TOKEN: adminToken,
      }),
      { repository, cache: new MemorySessionCache() },
    );
    const app = built.app;
    try {
      const cookie = await signIn(app);
      const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
      const workspaceId = me.json<{ creator: { workspaceId: string } }>().creator.workspaceId;
      const deniedExport = await app.inject({
        method: "GET",
        url: "/v1/workspace/audit-export",
        headers: { cookie },
      });
      expect(deniedExport.statusCode).toBe(403);
      expect(deniedExport.json()).toMatchObject({
        error: { code: "INSTITUTION_NOT_ENABLED" },
      });
      const invalid = await app.inject({
        method: "PUT",
        url: `/v1/admin/workspaces/${workspaceId}/institution-policy`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          contractStatus: "active",
          identityRequirement: "guest",
          capabilities: {
            oidc: false,
            managedSso: false,
            scim: false,
            lti: true,
            nrps: true,
            ags: false,
            auditExports: false,
            residencyControls: false,
          },
          k12Enabled: true,
        },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    } finally {
      await app.close();
    }
  });
});
