import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createPlatformRepository,
  MemoryPlatformRepository,
  MemoryRepository,
} from "@openround/db";
import {
  PASSWORD_OPERATOR_ISSUER,
  provisionPasswordOperator,
  loadControlConfig,
  OperatorAuthService,
  OperatorError,
  OperatorService,
  operatorCapabilities,
  operatorCookieNames,
  operatorSessionCookieOptions,
  tokenHash,
  verifyMutationRequest,
} from "@openround/control-plane";
import { buildApp } from "../../src/app.js";
import { ConfigSchema } from "../../src/config.js";
import { ConsoleMailer } from "../../src/mailer.js";
import { attachRealtime } from "../../src/realtime.js";

// This executable is a loopback-only browser fixture, never a production server entrypoint.
if (process.env.NODE_ENV !== "test")
  throw new Error("Business browser fixture requires NODE_ENV=test");
const config = ConfigSchema.parse({
  NODE_ENV: "test",
  PORT: process.env.PORT ?? "4300",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3300",
  PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4300",
  HOST: "127.0.0.1",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  BUSINESS_PLATFORM_ENABLED: "true",
  BUSINESS_EVENT_CREDITS_ENABLED: "true",
  BILLING_MODE: "disabled",
  LOG_LEVEL: "silent",
});
if (process.env.CONTROL_AUTH_MODE === "password") {
  // The test UI receives real development links from the HTTP response. Keep
  // synthetic email addresses and single-use credentials out of fixture logs.
  ConsoleMailer.prototype.sendMagicLink = async () => {};
  ConsoleMailer.prototype.sendWorkspaceInvitation = async () => {};
  ConsoleMailer.prototype.sendOrganizationInvitation = async () => {};
}
const repository = new MemoryRepository();
const built = await buildApp(config, { repository });
const platform = createPlatformRepository(repository);
const realtime = await attachRealtime(
  built.app.server,
  built.sessions,
  config,
  built.metrics,
  built.interactions,
  {
    service: built.presentationService,
    consumeAdmission: built.cache.consumeRateLimit.bind(built.cache),
  },
  built.audienceScopeService,
);
built.app.post("/__test/business/seed", async (request) => {
  const input = z
    .object({
      organizationId: z.string().uuid(),
      actorId: z.string().uuid(),
      credits: z.number().int().min(0).max(10).optional(),
      billingOnlyUserId: z.string().uuid().optional(),
    })
    .strict()
    .parse(request.body);
  await platform.requireOrganizationRole(input.organizationId, input.actorId, ["owner"]);
  if (input.credits)
    await platform.grantCredits({
      organizationId: input.organizationId,
      quantity: input.credits,
      actorId: input.actorId,
      reason: "Synthetic browser fixture",
      sourceKey: `browser-fixture:${input.organizationId}`,
    });
  if (input.billingOnlyUserId) {
    await platform.requireOrganizationRole(input.organizationId, input.billingOnlyUserId, [
      "billing",
    ]);
    for (const [id, member] of repository.workspaceMembers)
      if (member.userId === input.billingOnlyUserId) repository.workspaceMembers.delete(id);
  }
  return { seeded: true, receipt: randomUUID() };
});
if (process.env.CONTROL_AUTH_MODE === "password") {
  const control = loadControlConfig({
    NODE_ENV: "test",
    CONTROL_ENABLED: "true",
    CONTROL_AUTH_MODE: "password",
    CONTROL_LOCAL_DEVELOPMENT: "true",
    OPENROUND_DEPLOYMENT_ENVIRONMENT: "development",
    CONTROL_PUBLIC_ORIGIN: process.env.CONTROL_PUBLIC_ORIGIN,
    OPERATOR_CREDENTIAL_KEY: process.env.OPERATOR_CREDENTIAL_KEY,
    CONTROL_DATABASE_URL: "unused",
  });
  const names = operatorCookieNames(control);
  // The browser adapter uses real standalone password/TOTP services and shared memory storage.
  // It is isolated to this test executable and loopback requests.
  const auth = new OperatorAuthService(platform, control, {
    async authorizationUrl() {
      throw new Error("Local browser fixture cannot contact an identity provider");
    },
    async exchange() {
      throw new Error("Local browser fixture cannot contact an identity provider");
    },
  });
  const operators = new OperatorService(platform);
  let username: string | null = null;
  const areas = [
    ["organizations", "Tenant management"],
    ["features", "Features and plans"],
    ["billing", "Billing"],
    ["credits", "Credits and promotions"],
    ["operations", "Operations"],
    ["support", "Support"],
    ["integrations", "Integrations"],
    ["audit", "Audit"],
  ] as const;
  built.app.addHook("preHandler", async (request, reply) => {
    if (
      request.url.startsWith("/__test/local-admin/") &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip)
    )
      return reply.code(403).send({ error: { message: "Loopback fixture access required" } });
  });
  built.app.post("/__test/local-admin/provision", async () => {
    username = `admin-${randomUUID().slice(0, 12)}`;
    const password = `${randomUUID()}!Aa9`;
    const result = await provisionPasswordOperator(platform, control, {
      username,
      password,
      name: "Development administrator",
      role: "founder",
    });
    return { username, password, totpSecret: result.totpSecret };
  });
  built.app.post("/__test/local-admin/control", async (request, reply) => {
    try {
      const input = z
        .object({
          path: z.enum([
            "/auth/password",
            "/api/me",
            "/api/navigation",
            "/api/commands",
            "/api/logout",
            ...areas.map(([id]) => `/api/views/${id}` as const),
          ]),
          method: z.enum(["GET", "POST"]),
          origin: z.string().nullable(),
          csrf: z.string().nullable(),
          organizationId: z.string().uuid().optional(),
          command: z.unknown().optional(),
          credentials: z
            .object({ username: z.string(), password: z.string(), code: z.string() })
            .strict()
            .optional(),
        })
        .strict()
        .parse(request.body);
      const login = input.path === "/auth/password";
      const mutation = login || input.path === "/api/commands" || input.path === "/api/logout";
      if (input.method !== (mutation ? "POST" : "GET")) return reply.code(405).send({});
      const navigation = input.path === "/api/navigation";
      if (input.origin && input.origin !== control.CONTROL_PUBLIC_ORIGIN)
        throw new OperatorError(403, "FORBIDDEN_ORIGIN", "Same-origin console access required");
      if (login) {
        if (input.origin !== control.CONTROL_PUBLIC_ORIGIN || !input.credentials)
          throw new OperatorError(403, "ORIGIN_REJECTED", "Same-origin sign-in required");
        const session = await auth.passwordLogin({
          ...input.credentials,
          requestId: request.id,
          previousToken: request.cookies[names.session],
        });
        reply.setCookie(names.session, session.token, operatorSessionCookieOptions(control));
        reply.setCookie(names.csrf, session.csrfToken, operatorSessionCookieOptions(control));
        return { signedIn: true };
      }
      reply.header("cache-control", "private, no-store");
      reply.header("vary", "Origin");
      const context = await auth.authenticate(request.cookies[names.session]);
      if (mutation) verifyMutationRequest(context, input.origin, input.csrf, control);
      if (input.path === "/api/me")
        return {
          operator: {
            id: context.operator.id,
            name: context.operator.name,
            username: context.operator.subject,
            role: context.operator.role,
            capabilities: operatorCapabilities(context.operator),
          },
          csrfToken: request.cookies[names.csrf] ?? null,
        };
      if (navigation)
        return {
          operator: { name: context.operator.name, role: context.operator.role },
          links: areas
            .filter(([id]) => operatorCapabilities(context.operator).includes(`${id}.read`))
            .map(([id, label]) => ({
              id,
              label,
              href: `${control.CONTROL_PUBLIC_ORIGIN}/?view=${id}`,
            })),
        };
      if (input.path.startsWith("/api/views/"))
        return operators.view(
          context,
          input.path.split("/").at(-1) as Parameters<OperatorService["view"]>[1],
          input.organizationId,
        );
      if (input.path === "/api/commands")
        return { result: await operators.command(context, input.command, request.id) };
      await auth.logout(context, request.id);
      for (const name of [names.session, names.csrf])
        reply.clearCookie(name, operatorSessionCookieOptions(control));
      return { signedOut: true };
    } catch (error) {
      return reply.code(error instanceof OperatorError ? error.status : 422).send({
        error: {
          code: error instanceof OperatorError ? error.code : "INVALID_FIXTURE_REQUEST",
          message: error instanceof OperatorError ? error.message : "Invalid fixture request",
        },
      });
    }
  });
  built.app.post("/__test/local-admin/state", async (request) => {
    const input = z
      .object({
        organizationId: z.string().uuid().optional(),
        workspaceId: z.string().uuid().optional(),
      })
      .strict()
      .parse(request.body);
    const operator = username
      ? await platform.getOperatorByIdentity(PASSWORD_OPERATOR_ISSUER, username)
      : null;
    const token = request.cookies[names.session];
    let authenticated = false;
    try {
      await auth.authenticate(token);
      authenticated = true;
    } catch {
      /* State reports denied/absent access without issuing cookies. */
    }
    return {
      operator: operator
        ? { id: operator.id, name: operator.name, role: operator.role, active: operator.active }
        : null,
      authenticated,
      sessionExists: token ? Boolean(await platform.getOperatorSession(tokenHash(token))) : false,
      balance: input.organizationId ? await platform.getCreditBalance(input.organizationId) : null,
      ledgerEntries: input.organizationId
        ? (await platform.listCreditLedgerForOperator(input.organizationId)).length
        : 0,
      restriction: input.workspaceId
        ? await platform.getWorkspaceAdmissionRestriction(input.workspaceId)
        : null,
      auditActions: (await platform.listAuditEvents(undefined, 100)).map((event) => event.action),
      auditEvents: (await platform.listAuditEvents(undefined, 100)).map((event) => ({
        action: event.action,
        actorId: event.actorId,
        reason: event.reason,
      })),
      issuerConfigured: Boolean(control.OPERATOR_OIDC_ISSUER),
      mfaConfigured: true,
    };
  });
  built.app.post("/__test/local-admin/age-session", async (request) => {
    const context = await auth.authenticate(request.cookies[names.session]);
    if (!(platform instanceof MemoryPlatformRepository))
      throw new Error("Local browser session aging requires isolated memory storage");
    await platform.memoryStore.put("operator_session", context.tokenHash, null, {
      ...context.session,
      authenticatedAt: new Date(Date.now() - 301_000),
    });
    return { aged: true };
  });
  built.app.post("/__test/local-admin/revoke", async (request) => {
    const context = await auth.authenticate(request.cookies[names.session]);
    await provisionPasswordOperator(platform, control, {
      username: `backup-${randomUUID().slice(0, 12)}`,
      password: `${randomUUID()}!Aa9`,
      name: "Synthetic backup founder",
      role: "founder",
    });
    await platform.provisionOperator({
      issuer: context.operator.issuer,
      subject: context.operator.subject,
      name: context.operator.name,
      role: context.operator.role,
      capabilities: context.operator.capabilities,
      active: false,
    });
    return { revoked: true };
  });
}
const close = async () => {
  await realtime.close();
  await built.app.close();
  process.exit(0);
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
await built.app.listen({ host: "127.0.0.1", port: config.PORT });
