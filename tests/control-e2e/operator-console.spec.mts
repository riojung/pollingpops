import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { test, expect, type BrowserContext } from "@playwright/test";
import { MemoryRepository, createPlatformRepository } from "../../packages/db/src/index.js";
import {
  loadControlConfig,
  ManagedOperatorOidcProvider,
  OperatorAuthService,
  OperatorError,
  OperatorService,
  operatorCapabilities,
  tokenHash,
  verifyMutationRequest,
} from "../../packages/control-plane/src/index.js";

const origin = "http://127.0.0.1:3302";
const productOrigin = "http://127.0.0.1:3300";
const issuer = "http://127.0.0.1:3303";
const names = {
  session: "pollingpops-operator-local",
  binding: "pollingpops-operator-login-local",
  csrf: "pollingpops-operator-csrf-local",
};
let issuerServer: Server;
let loginSubject = "founder";
let tokenExchanges = 0;

// A local, signed OIDC issuer exercises the real openid-client code/state/nonce/PKCE
// exchange. No external identity provider, customer account, or API is contacted.
test.beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const codes = new Map<string, { nonce: string; challenge: string; subject: string }>();
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "synthetic-test-key",
    alg: "RS256",
    use: "sig",
  };
  issuerServer = createServer(async (request, response) => {
    const url = new URL(request.url!, issuer);
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/authorize") {
      if (
        url.searchParams.get("client_id") !== "operator-test" ||
        url.searchParams.get("redirect_uri") !== `${origin}/auth/callback` ||
        url.searchParams.get("code_challenge_method") !== "S256" ||
        url.searchParams.get("max_age") !== "300"
      )
        return json({ error: "invalid_request" }, 400);
      const code = randomUUID();
      codes.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
        subject: loginSubject,
      });
      const target = new URL("/auth/callback", origin);
      target.searchParams.set("state", url.searchParams.get("state")!);
      target.searchParams.set("code", code);
      // An identity-provider page starts a fresh navigation so Playwright can intercept
      // the application's callback boundary, rather than inheriting a redirect route.
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<script>location.replace(${JSON.stringify(target.href)})</script>`);
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const fields = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const code = fields.get("code")!;
      const grant = codes.get(code);
      codes.delete(code);
      const authorization = request.headers.authorization;
      const basic = authorization?.startsWith("Basic ")
        ? Buffer.from(authorization.slice(6), "base64")
            .toString("utf8")
            .split(":")
            .map((part) => decodeURIComponent(part.replaceAll("+", " ")))
        : [];
      if (
        basic[0] !== "operator-test" ||
        basic[1] !== "synthetic-test-secret" ||
        !grant ||
        createHash("sha256")
          .update(fields.get("code_verifier") ?? "")
          .digest("base64url") !== grant.challenge
      ) {
        return json({ error: "invalid_grant" }, 400);
      }
      tokenExchanges += 1;
      const now = Math.floor(Date.now() / 1000);
      const parts = [
        Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "synthetic-test-key", typ: "JWT" }),
        ).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            iss: issuer,
            sub: grant.subject,
            aud: "operator-test",
            iat: now,
            exp: now + 300,
            auth_time: now,
            nonce: grant.nonce,
            amr: ["pwd", "mfa"],
          }),
        ).toString("base64url"),
      ];
      const signature = sign("RSA-SHA256", Buffer.from(parts.join(".")), privateKey).toString(
        "base64url",
      );
      return json({
        access_token: "synthetic-access",
        token_type: "Bearer",
        expires_in: 300,
        id_token: [...parts, signature].join("."),
      });
    }
    return json({ error: "not_found" }, 404);
  });
  await new Promise<void>((resolve) => issuerServer.listen(3303, "127.0.0.1", resolve));
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    issuerServer.close((error) => (error ? reject(error) : resolve())),
  );
});

async function harness(context: BrowserContext) {
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
  const retryableAuthoringId = randomUUID();
  for (const id of [retryableAuthoringId, randomUUID()])
    await repository.createAuthoringJob({
      id,
      workspaceId: creator.workspaceId,
      createdBy: creator.userId,
      sourceType: "pasted_text",
      sourceName: "Synthetic browser source",
      sourceMimeType: null,
      sourceText: id === retryableAuthoringId ? "PRIVATE_SYNTHETIC_SOURCE_MUST_NOT_RENDER" : null,
      sourceBlob: null,
      sourceDigest: "synthetic",
      status: "failed",
      attempts: 2,
      appliedQuizId: null,
      availableAt: now,
      output: null,
      lastError: "Synthetic provider outage",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
  const config = loadControlConfig({
    NODE_ENV: "test",
    CONTROL_ENABLED: "true",
    CONTROL_PUBLIC_ORIGIN: origin,
    CONTROL_PRODUCT_ORIGIN: productOrigin,
    CONTROL_ALLOW_LOCAL_HTTP: "true",
    CONTROL_DATABASE_URL: "unused",
    OPERATOR_OIDC_ISSUER: issuer,
    OPERATOR_OIDC_CLIENT_ID: "operator-test",
    OPERATOR_OIDC_CLIENT_SECRET: "synthetic-test-secret",
    OPERATOR_OIDC_MFA_POLICY_ENFORCED: "true",
    OPERATOR_OIDC_REQUIRED_AMR: "pwd,mfa",
    OPERATOR_BOOTSTRAP_IDENTITIES: JSON.stringify([
      { issuer, subject: "founder", displayName: "Synthetic founder", role: "founder" },
    ]),
  });
  const auth = new OperatorAuthService(platform, config, new ManagedOperatorOidcProvider(config));
  await auth.provisionConfiguredOperators();
  await platform.provisionOperator({
    issuer,
    subject: "reader",
    name: "Synthetic reader",
    role: "readonly",
    capabilities: [],
    active: true,
  });
  const service = new OperatorService(platform);
  let loseGrantReceipt = true;
  const commandKeys: string[] = [];
  const cookie = async (name: string) =>
    (await context.cookies(origin)).find((entry) => entry.name === name)?.value;
  const setCookie = async (name: string, value: string) =>
    context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
  await context.route(`${origin}/auth/**`, async (route) => {
    try {
      const url = new URL(route.request().url());
      if (url.pathname === "/auth/start") {
        const result = await auth.start();
        await setCookie(names.binding, result.binding);
        await route.fulfill({ status: 303, headers: { location: result.authorizationUrl } });
      } else {
        const result = await auth.callback(
          url,
          url.searchParams.get("state")!,
          (await cookie(names.binding))!,
          randomUUID(),
        );
        await setCookie(names.session, result.token);
        await setCookie(names.csrf, result.csrfToken);
        await route.fulfill({ status: 303, headers: { location: origin } });
      }
    } catch (error) {
      await route.fulfill({
        status: error instanceof OperatorError ? error.status : 503,
        json: {
          error: {
            message: error instanceof OperatorError ? error.message : "Synthetic login failed",
          },
        },
      });
    }
  });
  // Only the HTTP boundary is replaced. All identity assurance, DB sessions,
  // capability checks, command transactions, and audit/ledger effects are real services.
  await context.route(`${origin}/api/**`, async (route) => {
    const navigationRequest = new URL(route.request().url()).pathname === "/api/navigation";
    const corsHeaders: Record<string, string> =
      navigationRequest && route.request().headers().origin === productOrigin
        ? {
            "access-control-allow-origin": productOrigin,
            "access-control-allow-credentials": "true",
            vary: "Origin",
          }
        : {};
    try {
      const request = route.request();
      const url = new URL(request.url());
      const identity = await auth.authenticate(await cookie(names.session));
      if (request.method() !== "GET")
        verifyMutationRequest(
          identity,
          request.headers().origin ?? null,
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
          csrfToken: await cookie(names.csrf),
        };
      else if (navigationRequest) {
        if (request.headers().origin && request.headers().origin !== productOrigin)
          throw new OperatorError(403, "FORBIDDEN_ORIGIN", "Navigation origin denied");
        const labels = {
          organizations: "Tenant management",
          billing: "Billing",
          credits: "Credits and promotions",
          operations: "Operations",
          support: "Support",
          integrations: "Integrations",
          audit: "Audit",
        };
        result = {
          operator: { name: identity.operator.name, role: identity.operator.role },
          links: Object.entries(labels)
            .filter(([view]) => operatorCapabilities(identity.operator).includes(`${view}.read`))
            .map(([id, label]) => ({ id, label, href: `${origin}/?view=${id}` })),
        };
      } else if (url.pathname.startsWith("/api/views/"))
        result = await service.view(
          identity,
          url.pathname.split("/").at(-1) as Parameters<OperatorService["view"]>[1],
          url.searchParams.get("organizationId") ?? undefined,
        );
      else if (url.pathname === "/api/commands") {
        const command = request.postDataJSON();
        commandKeys.push(command.idempotencyKey);
        result = await service.command(identity, command, randomUUID());
        if (command.action === "credits.grant" && loseGrantReceipt) {
          loseGrantReceipt = false;
          await route.abort("failed");
          return;
        }
      } else if (url.pathname === "/api/logout") {
        await auth.logout(identity, randomUUID());
        await context.clearCookies({ name: names.session });
        await context.clearCookies({ name: names.csrf });
        result = { signedOut: true };
      } else throw new OperatorError(404, "NOT_FOUND", "Synthetic API not found");
      await route.fulfill({
        status: 200,
        json: result,
        headers: { "cache-control": "no-store", ...corsHeaders },
      });
    } catch (error) {
      await route.fulfill({
        headers: corsHeaders,
        status:
          error instanceof OperatorError
            ? error.status
            : error instanceof Error && error.name === "ZodError"
              ? 422
              : 503,
        json: {
          error: {
            message: error instanceof OperatorError ? error.message : "Synthetic command failed",
          },
        },
      });
    }
  });
  return { platform, organization, creator, commandKeys, cookie, retryableAuthoringId };
}

test("enabled founder signs in through OIDC, retries one audited credit grant, restricts admission, and session revocation takes effect", async ({
  page,
  context,
}, testInfo) => {
  loginSubject = "founder";
  const fixture = await harness(context);
  await page.goto("/?view=credits");
  await page.getByRole("link", { name: "Sign in with operator identity" }).click();
  await expect(page.getByRole("heading", { name: "Credits", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?view=credits$/);
  expect(tokenExchanges).toBeGreaterThan(0);
  const grant = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Grant event credits", exact: true }) });
  await grant.getByRole("combobox", { name: /Organization/ }).selectOption(fixture.organization.id);
  await grant.getByLabel("Credits", { exact: true }).fill("5");
  await grant.getByLabel("Reason", { exact: true }).fill("Synthetic approved launch grant");
  await grant.getByRole("button", { name: "Grant credits", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/fetch|failed/i);
  await grant.getByRole("button", { name: "Grant credits", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Command completed");
  expect(fixture.commandKeys.slice(0, 2)[0]).toBe(fixture.commandKeys.slice(0, 2)[1]);
  expect(await fixture.platform.getCreditBalance(fixture.organization.id)).toMatchObject({
    balance: 5,
  });
  expect(await fixture.platform.listCreditLedgerForOperator(fixture.organization.id)).toHaveLength(
    1,
  );
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Active rooms", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Product queues", exact: true })).toBeVisible();
  await expect(page.getByText(/requires a new upload by the workspace member/)).toBeVisible();
  await expect(page.getByText("PRIVATE_SYNTHETIC_SOURCE_MUST_NOT_RENDER")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: `Retry failed Authoring · ${fixture.retryableAuthoringId}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic operations approved retained-source retry");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply command", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Command completed");
  await expect(
    page.getByRole("button", {
      name: `Retry failed Authoring · ${fixture.retryableAuthoringId}`,
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (await fixture.platform.getProductQueueHealth()).find((queue) => queue.kind === "authoring"),
  ).toMatchObject({ pending: 1, failed: 1 });
  await page.getByRole("button", { name: "Organizations", exact: true }).click();
  await page.getByRole("button", { name: "Restrict new joins", exact: true }).click();
  const review = page.getByRole("dialog");
  await review
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic incident restricts new admissions");
  await review.getByRole("button", { name: "Apply command", exact: true }).click();
  await expect(page.getByRole("button", { name: "Allow new joins", exact: true })).toBeVisible();
  expect(
    await fixture.platform.getWorkspaceAdmissionRestriction(fixture.creator.workspaceId),
  ).toMatchObject({ blocked: true });
  await page.getByRole("button", { name: "Audit", exact: true }).click();
  await expect(page.getByRole("cell", { name: "credits.grant", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("enabled-founder-console.png"),
    fullPage: true,
  });
  const operator = await fixture.platform.getOperatorByIdentity(issuer, "founder");
  await fixture.platform.revokeOperatorSessions(operator!.id);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in with operator identity" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
});

test("stale CSRF after another tab signs in preserves rejected logout access until confirmed sign-out", async ({
  page,
  context,
}) => {
  loginSubject = "founder";
  const fixture = await harness(context);
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in with operator identity" }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  const firstCsrf = await fixture.cookie(names.csrf);
  const secondTab = await context.newPage();
  await secondTab.goto(`${origin}/auth/start`);
  await expect(secondTab.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  expect(await fixture.cookie(names.csrf)).not.toBe(firstCsrf);
  await secondTab.close();

  const rejected = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/logout",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  expect((await rejected).status()).toBe(403);
  await expect(page.getByRole("status")).toContainText("Sign-out could not be confirmed");
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with operator identity" })).toHaveCount(0);
  expect(await page.evaluate(async () => (await fetch("/api/me")).status)).toBe(200);
  const currentToken = await fixture.cookie(names.session);

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in with operator identity" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toHaveCount(0);
  expect(await fixture.cookie(names.session)).toBeUndefined();
  expect(await fixture.cookie(names.csrf)).toBeUndefined();
  expect(await page.evaluate(async () => (await fetch("/api/me")).status)).toBe(401);
  const operator = await fixture.platform.getOperatorByIdentity(issuer, "founder");
  const audit = await fixture.platform.listAuditEvents(undefined, 100);
  expect(
    audit.filter((event) => event.actorId === operator!.id && event.action === "operator.logout"),
  ).toHaveLength(1);
  expect(currentToken).toBeTruthy();
  expect(await fixture.platform.getOperatorSession(tokenHash(currentToken!))).toBeNull();
});

test("product admin sign-in exposes business menus and opens permitted console areas", async ({
  page,
  context,
}, testInfo) => {
  loginSubject = "founder";
  const fixture = await harness(context);
  await page.goto(`${productOrigin}/signin`);
  await page.getByRole("link", { name: "Business admin sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Operator areas" })).toBeVisible();
  await page.goto(productOrigin);
  await page.locator("summary").filter({ hasText: "Business · Super admin" }).click();
  for (const name of [
    "Tenant management",
    "Billing",
    "Credits and promotions",
    "Operations",
    "Support",
    "Integrations",
    "Audit",
  ])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("product-super-admin-navigation.png") });
  await page.getByRole("link", { name: "Billing", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/?view=billing`);
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  const operator = await fixture.platform.getOperatorByIdentity(issuer, "founder");
  await fixture.platform.revokeOperatorSessions(operator!.id);
  await page.goto(productOrigin);
  await expect(page.locator("summary").filter({ hasText: "Business · Super admin" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Tenant management", exact: true })).toHaveCount(0);
});

test("readonly operator sees permitted views and server rejects a forged credit command", async ({
  page,
  context,
}) => {
  loginSubject = "reader";
  const fixture = await harness(context);
  await page.goto("/?view=billing");
  await page.getByRole("link", { name: "Sign in with operator identity" }).click();
  await expect(page.getByRole("heading", { name: "Organizations", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?view=organizations$/);
  await expect(page.getByRole("button", { name: "Credits", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause new work", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page).toHaveURL(/\?view=operations$/);
  await expect(page.getByRole("heading", { name: "Product queues", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry failed Authoring/ })).toHaveCount(0);
  const status = await page.evaluate(
    async ({ organizationId, key }) => {
      const identity = await (await fetch("/api/me")).json();
      return (
        await fetch("/api/commands", {
          method: "POST",
          headers: { "content-type": "application/json", "x-operator-csrf": identity.csrfToken },
          body: JSON.stringify({
            action: "credits.grant",
            organizationId,
            quantity: 5,
            reason: "Synthetic forged command must be denied",
            idempotencyKey: key,
          }),
        })
      ).status;
    },
    { organizationId: fixture.organization.id, key: randomUUID() },
  );
  expect(status).toBe(403);
  expect(await fixture.platform.getCreditBalance(fixture.organization.id)).toMatchObject({
    balance: 0,
  });
  await page.getByRole("button", { name: "Organizations", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?view=operations$/);
});
