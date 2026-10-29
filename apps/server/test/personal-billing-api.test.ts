import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const personalCatalog = [
  {
    id: "pro-monthly",
    version: 1,
    title: "Pro monthly",
    kind: "workspace_subscription",
    published: true,
    stripePriceId: "price_promonthly",
    currency: "cad",
    unitAmount: 1000,
    interval: "month",
  },
  {
    id: "pro-annual",
    version: 2,
    title: "Pro annual",
    kind: "workspace_subscription",
    licenseUnit: "workspace",
    published: true,
    stripePriceId: "price_proannual",
    currency: "cad",
    unitAmount: 10000,
    interval: "year",
  },
  {
    id: "team-users",
    version: 1,
    title: "Team creators",
    kind: "workspace_subscription",
    licenseUnit: "user",
    published: true,
    stripePriceId: "price_teamusers",
    currency: "cad",
    unitAmount: 2000,
    interval: "month",
  },
  {
    id: "pro-draft",
    version: 1,
    title: "Draft Pro",
    kind: "workspace_subscription",
    interval: "month",
  },
  {
    id: "event-five",
    version: 1,
    title: "Five event credits",
    kind: "event_credit_pack",
    published: true,
    stripePriceId: "price_eventfive",
    currency: "cad",
    unitAmount: 1000,
    creditsPerUnit: 5,
  },
];

async function fixture(catalog = personalCatalog, stripeEnabled = true) {
  const repository = new MemoryRepository();
  const createCheckout = vi.fn(async (_input: Stripe.Checkout.SessionCreateParams) => ({
    id: "cs_personal_selected",
    url: "https://checkout.stripe.com/personal-selected",
  }));
  const createPortal = vi.fn(async (_input: Stripe.BillingPortal.SessionCreateParams) => ({
    url: "https://billing.stripe.com/personal-recovery",
  }));
  const stripe = {
    prices: {
      retrieve: vi.fn(async (id: string) => {
        const offer = catalog.find((candidate) => candidate.stripePriceId === id)!;
        return {
          id,
          active: true,
          currency: offer.currency,
          unit_amount: offer.unitAmount,
          type: "recurring",
          recurring: { interval: offer.interval, interval_count: 1, usage_type: "licensed" },
        };
      }),
    },
    checkout: { sessions: { create: createCheckout } },
    billingPortal: { sessions: { create: createPortal } },
  } as unknown as Stripe;
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    BUSINESS_PLATFORM_ENABLED: "true",
    BUSINESS_EVENT_CREDITS_ENABLED: "true",
    BILLING_MODE: "stripe",
    STRIPE_SECRET_KEY: "sk_test_personal_catalog",
    STRIPE_WEBHOOK_SECRET: "whsec_personal_catalog",
    BUSINESS_CATALOG_JSON: JSON.stringify(catalog),
    LOG_LEVEL: "silent",
  });
  const { app } = await buildApp(config, {
    repository,
    cache: new MemorySessionCache(),
    stripe: stripeEnabled ? stripe : null,
  });
  apps.push(app);
  return {
    app,
    repository,
    createCheckout,
    createPortal,
    platform: createPlatformRepository(repository),
  };
}

async function signIn(app: FastifyInstance, email: string) {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  expect(requested.statusCode, requested.body).toBe(202);
  const verification = new URL(requested.json<{ debugUrl: string }>().debugUrl);
  const signedIn = await verifyEmailAndSignIn(
    app,
    verification.pathname + verification.search,
    email,
  );
  const rawCookie = signedIn.headers["set-cookie"]!;
  const cookie = (Array.isArray(rawCookie) ? rawCookie[0]! : rawCookie).split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  expect(me.statusCode, me.body).toBe(200);
  return {
    cookie,
    creator: me.json<{ creator: { userId: string; workspaceId: string } }>().creator,
  };
}

describe("personal subscription selection", () => {
  it("lists published personal offers and purchases the selected annual offer from a mixed catalog", async () => {
    const f = await fixture();
    const owner = await signIn(f.app, "personal-choice@example.com");
    const headers = { cookie: owner.cookie, "x-idempotency-key": randomUUID() };
    const catalog = await f.app.inject({ method: "GET", url: "/v1/billing/catalog", headers });
    expect(catalog.statusCode, catalog.body).toBe(200);
    expect(catalog.json()).toMatchObject({
      checkoutEnabled: true,
      offers: [
        { id: "pro-monthly", name: "Pro monthly", amountMinor: 1000, interval: "month" },
        { id: "pro-annual", name: "Pro annual", amountMinor: 10000, interval: "year" },
      ],
    });
    expect(catalog.json<{ offers: unknown[] }>().offers).toHaveLength(2);
    expect(catalog.body).not.toContain("stripePriceId");
    expect(catalog.body).not.toContain("entitlements");

    for (const payload of [
      {},
      { offerId: "team-users" },
      { offerId: "event-five" },
      { offerId: "pro-draft" },
    ]) {
      const rejected = await f.app.inject({
        method: "POST",
        url: "/v1/billing/checkout",
        headers,
        payload,
      });
      expect(rejected.statusCode, rejected.body).toBe(409);
      expect(rejected.json()).toMatchObject({
        error: {
          code: "CONFLICT",
          message: "Choose an available subscription in Account > Plan and usage",
        },
      });
    }
    const extraFields = await f.app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers,
      payload: { offerId: "pro-annual", quantity: 2 },
    });
    expect(extraFields.statusCode, extraFields.body).toBe(400);
    expect(f.createCheckout).not.toHaveBeenCalled();

    const purchased = await f.app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers,
      payload: { offerId: "pro-annual" },
    });
    expect(purchased.statusCode, purchased.body).toBe(200);
    expect(purchased.json()).toEqual({ url: "https://checkout.stripe.com/personal-selected" });
    expect(f.createCheckout).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        line_items: [{ price: "price_proannual", quantity: 1 }],
        success_url: "http://localhost:3000/account?checkout=success#plan",
        cancel_url: "http://localhost:3000/account?checkout=cancelled#plan",
      }),
      expect.any(Object),
    );
    const organization = (await f.platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    expect(await f.platform.listPurchases(organization.id, owner.creator.userId)).toMatchObject([
      { quantity: 1, offer: { id: "pro-annual", version: 2, licenseUnit: "workspace" } },
    ]);
  });

  it("preserves empty-body checkout when only one matching personal offer is published", async () => {
    const f = await fixture(personalCatalog.filter((offer) => offer.id !== "pro-annual"));
    const owner = await signIn(f.app, "personal-single@example.com");
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: owner.cookie },
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(f.createCheckout.mock.calls[0]![0].line_items).toEqual([
      { price: "price_promonthly", quantity: 1 },
    ]);
  });

  it.each(["past_due", "free"])(
    "keeps a linked %s subscription recoverable with Free access",
    async (providerStatus) => {
      const f = await fixture();
      const owner = await signIn(f.app, "personal-expired-grace@example.com");
      const organization = (await f.platform.getOrganizationForWorkspace(
        owner.creator.workspaceId,
      ))!;
      const subscription = {
        organizationId: organization.id,
        customerId: "cus_personal_recovery",
        subscriptionId: "sub_personal_recovery",
        status: "active",
        licenseQuantity: 1,
        licenseUnit: "workspace" as const,
        offerId: "pro-monthly",
        paidThrough: new Date(Date.now() + 86_400_000),
        graceUntil: null,
      };
      await f.platform.applySubscriptionSnapshot(subscription);
      await f.platform.assignWorkspaceLicense(
        organization.id,
        owner.creator.userId,
        owner.creator.workspaceId,
        true,
      );
      await f.platform.applySubscriptionSnapshot({
        ...subscription,
        status: providerStatus,
        paidThrough: new Date(Date.now() - 2 * 86_400_000),
        graceUntil: new Date(Date.now() - 86_400_000),
      });
      const headers = { cookie: owner.cookie };
      const status = await f.app.inject({ method: "GET", url: "/v1/billing/status", headers });
      expect(status.statusCode, status.body).toBe(200);
      expect(status.json()).toMatchObject({
        billing: {
          plan: "free",
          status: providerStatus,
          customerId: "cus_personal_recovery",
          subscriptionId: "sub_personal_recovery",
        },
      });
      const checkout = await f.app.inject({
        method: "POST",
        url: "/v1/billing/checkout",
        headers,
        payload: { offerId: "pro-monthly" },
      });
      expect(checkout.statusCode, checkout.body).toBe(409);
      expect(f.createCheckout).not.toHaveBeenCalled();
      const portal = await f.app.inject({ method: "POST", url: "/v1/billing/portal", headers });
      expect(portal.statusCode, portal.body).toBe(200);
      expect(portal.json()).toEqual({ url: "https://billing.stripe.com/personal-recovery" });
      expect(f.createPortal).toHaveBeenCalledExactlyOnceWith({
        customer: "cus_personal_recovery",
        return_url: "http://localhost:3000/account#plan",
      });
    },
  );

  it("requires the existing workspace billing permission for both catalog and checkout", async () => {
    const f = await fixture(personalCatalog, false);
    for (const method of ["GET", "POST"] as const) {
      const anonymous = await f.app.inject({
        method,
        url: method === "GET" ? "/v1/billing/catalog" : "/v1/billing/checkout",
        ...(method === "POST" ? { payload: { offerId: "pro-monthly" } } : {}),
      });
      expect(anonymous.statusCode, anonymous.body).toBe(401);
    }
    const owner = await signIn(f.app, "personal-billing-owner@example.com");
    const unavailable = await f.app.inject({
      method: "GET",
      url: "/v1/billing/catalog",
      headers: { cookie: owner.cookie },
    });
    expect(unavailable.statusCode, unavailable.body).toBe(200);
    expect(unavailable.json()).toMatchObject({ checkoutEnabled: false });

    const viewer = await signIn(f.app, "personal-content-viewer@example.com");
    const organization = (await f.platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    await f.platform.setOrganizationMember({
      organizationId: organization.id,
      actorId: owner.creator.userId,
      userId: viewer.creator.userId,
      role: "member",
    });
    f.repository.workspaceMembers.set(`${owner.creator.workspaceId}:${viewer.creator.userId}`, {
      workspaceId: owner.creator.workspaceId,
      userId: viewer.creator.userId,
      role: "viewer",
      joinedAt: new Date(),
    });
    const selected = await f.app.inject({
      method: "POST",
      url: `/v1/workspaces/${owner.creator.workspaceId}/select`,
      headers: { cookie: viewer.cookie },
      payload: {},
    });
    expect(selected.statusCode, selected.body).toBe(200);
    for (const method of ["GET", "POST"] as const) {
      const forbidden = await f.app.inject({
        method,
        url: method === "GET" ? "/v1/billing/catalog" : "/v1/billing/checkout",
        headers: { cookie: viewer.cookie },
        ...(method === "POST" ? { payload: { offerId: "pro-monthly" } } : {}),
      });
      expect(forbidden.statusCode, forbidden.body).toBe(403);
    }
    expect(f.createCheckout).not.toHaveBeenCalled();
  });

  it("matches user-unit organizations without exposing personal offers through the legacy paths", async () => {
    const f = await fixture();
    const owner = await signIn(f.app, "organization-catalog-owner@example.com");
    const setup = await f.app.inject({
      method: "POST",
      url: "/v1/customer/setup",
      headers: { cookie: owner.cookie, "x-idempotency-key": randomUUID() },
      payload: {
        accountType: "organization",
        name: "Catalog organization",
        workspaceName: "Owner workspace",
        segment: "workplace",
      },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    const catalog = await f.app.inject({
      method: "GET",
      url: "/v1/billing/catalog",
      headers: { cookie: owner.cookie },
    });
    expect(catalog.statusCode, catalog.body).toBe(200);
    expect(catalog.json()).toMatchObject({
      offers: [{ id: "team-users", licenseUnit: "user" }],
    });
    expect(catalog.json<{ offers: unknown[] }>().offers).toHaveLength(1);
    const personalOffer = await f.app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: owner.cookie },
      payload: { offerId: "pro-monthly" },
    });
    expect(personalOffer.statusCode, personalOffer.body).toBe(409);
    expect(personalOffer.json()).toMatchObject({
      error: { message: "Choose an available subscription in organization billing" },
    });
    expect(f.createCheckout).not.toHaveBeenCalled();
  });
});
