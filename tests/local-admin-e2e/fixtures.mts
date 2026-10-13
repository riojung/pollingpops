import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { MemoryRepository, createPlatformRepository } from "../../packages/db/src/index.js";
import {
  isLocalControlDevelopment,
  loadControlConfig,
  OperatorAuthService,
  OperatorError,
  OperatorService,
  operatorCapabilities,
  verifyMutationRequest,
} from "../../packages/control-plane/src/index.js";

export const controlOrigin = "http://127.0.0.1:3302";
export const productOrigin = "http://127.0.0.1:3300";
export const cookieNames = {
  session: "pollingpops-operator-local",
  csrf: "pollingpops-operator-csrf-local",
};
export const businessAreas = {
  organizations: "Tenant management",
  billing: "Billing",
  credits: "Credits and promotions",
  operations: "Operations",
  support: "Support",
  integrations: "Integrations",
  audit: "Audit",
};

export async function localAdminHarness(context: BrowserContext) {
  const repository = new MemoryRepository();
  const now = new Date();
  const magicHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: "synthetic-owner@example.test",
    segment: "workplace",
    tokenHash: magicHash,
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(magicHash, now))!;
  const platform = createPlatformRepository(repository);
  const organization = (await platform.getOrganizationForWorkspace(creator.workspaceId))!;
  // No issuer, managed SSO, MFA policy, bootstrap account, or password is configured.
  const config = loadControlConfig({
    NODE_ENV: "test",
    CONTROL_ENABLED: "true",
    CONTROL_AUTH_MODE: "local",
    CONTROL_LOCAL_DEVELOPMENT: "true",
    CONTROL_PUBLIC_ORIGIN: controlOrigin,
    CONTROL_PRODUCT_ORIGIN: productOrigin,
    CONTROL_DATABASE_URL: "unused",
  });
  const provider = {
    authorizationUrl() {
      throw new Error("Local development must not contact an identity provider");
    },
    exchange() {
      throw new Error("Local development must not contact an identity provider");
    },
  };
  const auth = new OperatorAuthService(platform, config, provider as never);
  const service = new OperatorService(platform);
  const cookie = async (name: string) =>
    (await context.cookies(controlOrigin)).find((entry) => entry.name === name)?.value;
  const setCookie = async (name: string, value: string) =>
    context.addCookies([
      {
        name,
        value,
        url: controlOrigin,
        httpOnly: true,
        sameSite: "Lax",
        expires: Date.now() / 1000 + 8 * 60 * 60,
      },
    ]);
  const errorBody = (error: unknown) => ({
    error: {
      message: error instanceof OperatorError ? error.message : "Synthetic request failed",
    },
  });
  // Replace only the HTTP boundary. The auth/session, durable role, capability,
  // mutation verification, tenant controls, ledger and audit services are real.
  await context.route(`${controlOrigin}/auth/**`, async (route) => {
    try {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/auth/start" && request.method() === "GET") {
        await route.fulfill({ status: 303, headers: { location: `${controlOrigin}/` } });
        return;
      }
      if (path !== "/auth/local")
        throw new OperatorError(403, "OIDC_DISABLED", "Managed operator sign-in is disabled");
      if (request.method() !== "POST") {
        await route.fulfill({ status: 405, headers: { allow: "POST" } });
        return;
      }
      if (!isLocalControlDevelopment(config) || request.headers().origin !== controlOrigin)
        throw new OperatorError(403, "FORBIDDEN_ORIGIN", "Local admin sign-in denied");
      const result = await auth.localLogin(randomUUID());
      await setCookie(cookieNames.session, result.token);
      await setCookie(cookieNames.csrf, result.csrfToken);
      await route.fulfill({
        status: 200,
        headers: { "cache-control": "private, no-store" },
        json: { signedIn: true },
      });
    } catch (error) {
      await route.fulfill({
        status: error instanceof OperatorError ? error.status : 503,
        json: errorBody(error),
      });
    }
  });
  await context.route(`${controlOrigin}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const navigation = url.pathname === "/api/navigation";
    const requestOrigin = request.headers().origin;
    const corsHeaders: Record<string, string> =
      navigation && requestOrigin === productOrigin
        ? {
            "access-control-allow-origin": productOrigin,
            "access-control-allow-credentials": "true",
            vary: "Origin",
          }
        : {};
    try {
      if (navigation && requestOrigin && requestOrigin !== productOrigin)
        throw new OperatorError(403, "FORBIDDEN_ORIGIN", "Navigation origin denied");
      const identity = await auth.authenticate(await cookie(cookieNames.session));
      if (request.method() !== "GET")
        verifyMutationRequest(
          identity,
          requestOrigin ?? null,
          request.headers()["x-operator-csrf"] ?? null,
          config,
        );
      let result: unknown;
      if (url.pathname === "/api/me")
        result = {
          operator: {
            id: identity.operator.id,
            name: identity.operator.name,
            role: identity.operator.role,
            capabilities: operatorCapabilities(identity.operator),
          },
          csrfToken: await cookie(cookieNames.csrf),
        };
      else if (navigation)
        result = {
          operator: { name: identity.operator.name, role: identity.operator.role },
          links: Object.entries(businessAreas)
            .filter(([view]) => operatorCapabilities(identity.operator).includes(`${view}.read`))
            .map(([id, label]) => ({ id, label, href: `${controlOrigin}/?view=${id}` })),
        };
      else if (url.pathname.startsWith("/api/views/"))
        result = await service.view(
          identity,
          url.pathname.split("/").at(-1) as Parameters<OperatorService["view"]>[1],
          url.searchParams.get("organizationId") ?? undefined,
        );
      else if (url.pathname === "/api/commands")
        result = await service.command(identity, request.postDataJSON(), randomUUID());
      else if (url.pathname === "/api/logout") {
        await auth.logout(identity, randomUUID());
        await context.clearCookies({ name: cookieNames.session });
        await context.clearCookies({ name: cookieNames.csrf });
        result = { signedOut: true };
      } else throw new OperatorError(404, "NOT_FOUND", "Synthetic API not found");
      await route.fulfill({
        status: 200,
        json: result,
        headers: { "cache-control": "private, no-store", ...corsHeaders },
      });
    } catch (error) {
      await route.fulfill({
        status: error instanceof OperatorError ? error.status : 503,
        headers: corsHeaders,
        json: errorBody(error),
      });
    }
  });
  return { auth, platform, organization, creator, cookie, config };
}
