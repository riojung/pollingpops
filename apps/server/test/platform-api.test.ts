import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { entitlementsFor } from "../src/entitlements.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const config = (extra: Record<string, string> = {}) =>
  ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    BUSINESS_PLATFORM_ENABLED: "true",
    BUSINESS_EVENT_CREDITS_ENABLED: "true",
    LOG_LEVEL: "silent",
    ...extra,
  });
const key = () => ({ "x-idempotency-key": randomUUID() });
async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(target, `/v1/auth/verify?token=${token}`, email);
  const rawCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(rawCookie) ? rawCookie[0]! : rawCookie).split(";")[0]!;
  const me = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  return {
    cookie,
    creator: me.json<{ creator: { userId: string; workspaceId: string } }>().creator,
  };
}

describe("customer organization administration", () => {
  it.each([
    { enabled: false, existingCustomer: false, subscriptionOffer: false },
    { enabled: false, existingCustomer: true, subscriptionOffer: false },
    { enabled: true, existingCustomer: false, subscriptionOffer: false },
    { enabled: true, existingCustomer: true, subscriptionOffer: false },
    { enabled: true, existingCustomer: true, subscriptionOffer: true },
  ])(
    "configures Checkout tax=$enabled with existing customer=$existingCustomer and subscription=$subscriptionOffer",
    async ({ enabled, existingCustomer, subscriptionOffer }) => {
      const repository = new MemoryRepository();
      const createCheckout = vi.fn(async (_input: Stripe.Checkout.SessionCreateParams) => ({
        id: "cs_tax_fixture",
        url: "https://checkout.stripe.com/tax-fixture",
      }));
      const stripe = {
        prices: {
          retrieve: vi.fn(async () => ({
            id: "price_taxfixture",
            active: true,
            currency: "cad",
            unit_amount: 1000,
            type: subscriptionOffer ? "recurring" : "one_time",
            ...(subscriptionOffer
              ? { recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } }
              : {}),
          })),
        },
        checkout: { sessions: { create: createCheckout } },
      } as unknown as Stripe;
      const settings = config({
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "sk_test_tax_fixture",
        STRIPE_WEBHOOK_SECRET: "whsec_tax_fixture",
        ...(enabled ? { BUSINESS_STRIPE_AUTOMATIC_TAX_ENABLED: "true" } : {}),
        BUSINESS_CATALOG_JSON: JSON.stringify([
          {
            id: "tax-fixture",
            version: 1,
            title: subscriptionOffer ? "Workspace license" : "Five event credits",
            kind: subscriptionOffer ? "workspace_subscription" : "event_credit_pack",
            published: true,
            stripePriceId: "price_taxfixture",
            currency: "cad",
            unitAmount: 1000,
            ...(subscriptionOffer ? { interval: "month" } : { creditsPerUnit: 5 }),
          },
        ]),
      });
      const built = await buildApp(settings, {
        repository,
        cache: new MemorySessionCache(),
        stripe,
      });
      app = built.app;
      const owner = await signIn(app, "checkout-tax@example.com");
      const platform = createPlatformRepository(repository);
      const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
      if (existingCustomer)
        await platform.applySubscriptionSnapshot({
          organizationId: organization.id,
          customerId: "cus_existing_tax",
          subscriptionId: null,
          status: "free",
          licenseQuantity: 0,
          offerId: null,
          paidThrough: null,
          graceUntil: null,
        });
      const response = await app.inject({
        method: "POST",
        url: `/v1/organizations/${organization.id}/billing/checkout`,
        headers: { cookie: owner.cookie, ...key() },
        payload: { offerId: "tax-fixture", offerVersion: 1, quantity: 1 },
      });
      expect(response.statusCode).toBe(200);
      const submitted = createCheckout.mock.calls[0]![0];
      expect(submitted.automatic_tax).toEqual({ enabled });
      expect(submitted.billing_address_collection).toBe(enabled ? "required" : undefined);
      expect(submitted.tax_id_collection).toEqual(enabled ? { enabled: true } : undefined);
      expect(submitted.customer_update).toEqual(
        enabled && existingCustomer ? { address: "auto", name: "auto" } : undefined,
      );
      expect(submitted.customer).toBe(existingCustomer ? "cus_existing_tax" : undefined);
      expect(submitted.customer_creation).toBe(
        !existingCustomer && !subscriptionOffer ? "always" : undefined,
      );
    },
  );
  it("closes an idle organization through an owner command while preserving workspace and financial records", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(config(), { repository, cache: new MemorySessionCache() });
    app = built.app;
    const owner = await signIn(app, "organization-closure@example.com");
    const platform = createPlatformRepository(repository);
    const organization = await platform.createOrganization({
      name: "Closable organization",
      actorId: owner.creator.userId,
    });
    const workspace = await platform.createOrganizationWorkspace({
      organizationId: organization.id,
      actorId: owner.creator.userId,
      name: "Retained content",
      segment: "workplace",
    });
    await platform.grantCredits({
      organizationId: organization.id,
      quantity: 3,
      actorId: owner.creator.userId,
      reason: "Closure fixture",
      sourceKey: "closure-fixture",
    });
    const wrongConfirmation = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/close`,
      headers: { cookie: owner.cookie, ...key() },
      payload: { confirmation: "Close" },
    });
    expect(wrongConfirmation.statusCode).toBe(400);
    const closed = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/close`,
      headers: { cookie: owner.cookie, ...key() },
      payload: { confirmation: organization.name },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ organization: { status: "closed" } });
    expect(repository.workspaces.has(workspace.id)).toBe(true);
    expect(await platform.listCreditLedger(organization.id, owner.creator.userId)).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organization.id}/billing/export`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("handles a refund before fulfillment using saved Checkout linkage and prevents a later paid event from granting credits", async () => {
    const repository = new MemoryRepository();
    let checkout: Record<string, unknown> = {};
    const stripe = {
      refunds: {
        list: vi.fn(async () => ({
          data: [
            {
              id: "re_early_refund",
              status: "succeeded",
              amount: 1000,
              currency: "cad",
              created: 124,
            },
          ],
        })),
      },
      charges: {
        retrieve: vi.fn(async () => ({
          id: "ch_early_refund",
          payment_intent: "pi_early_refund",
          customer: "cus_early_refund",
          amount_refunded: 1000,
        })),
      },
      checkout: {
        sessions: {
          list: vi.fn(async () => ({ data: [{ id: "cs_early_refund" }] })),
          retrieve: vi.fn(async () => checkout),
        },
      },
    } as unknown as Stripe;
    const settings = config({
      BUSINESS_CATALOG_JSON: JSON.stringify([
        {
          id: "early-refund-pack",
          version: 1,
          title: "Five event credits",
          kind: "event_credit_pack",
          published: true,
          stripePriceId: "price_earlyrefund",
          currency: "cad",
          unitAmount: 1000,
          creditsPerUnit: 5,
        },
      ]),
    });
    const built = await buildApp(settings, { repository, cache: new MemorySessionCache(), stripe });
    app = built.app;
    const owner = await signIn(app, "early-refund@example.com");
    const platform = createPlatformRepository(repository);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const purchase = await platform.createPurchase({
      organizationId: organization.id,
      actorId: owner.creator.userId,
      offerId: "early-refund-pack",
      quantity: 1,
      idempotencyKey: randomUUID(),
    });
    await platform.updatePurchaseCheckout(purchase.id, "cs_early_refund");
    checkout = {
      id: "cs_early_refund",
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_early_refund",
      customer: "cus_early_refund",
      amount_total: 1000,
      currency: "cad",
      created: 123,
      metadata: { organizationId: organization.id, purchaseId: purchase.id },
      line_items: { data: [{ price: { id: "price_earlyrefund" }, quantity: 1 }] },
    };
    await platform.enqueueBillingEvent({
      providerEventId: "evt_early_refund",
      eventType: "charge.refunded",
      payload: { id: "ch_early_refund" },
      providerCreatedAt: new Date(),
    });
    vi.mocked(stripe.refunds.list).mockRejectedValueOnce(
      new Error("Financial details unavailable"),
    );
    expect(await built.platformBillingWorker.runUntilIdle()).toEqual({ processed: 0, failed: 1 });
    expect((await platform.getPurchase(purchase.id))?.status).toBe("refunded");
    expect((await platform.getOrganizationCommercialHold(organization.id))?.held).toBe(true);
    await platform.enqueueBillingEvent({
      providerEventId: "evt_early_refund_retry",
      eventType: "charge.refunded",
      payload: { id: "ch_early_refund" },
      providerCreatedAt: new Date(),
    });
    expect(await built.platformBillingWorker.runUntilIdle()).toEqual({ processed: 1, failed: 0 });
    await platform.enqueueBillingEvent({
      providerEventId: "evt_paid_after_refund",
      eventType: "checkout.session.completed",
      payload: { id: "cs_early_refund" },
      providerCreatedAt: new Date(),
    });
    await built.platformBillingWorker.runUntilIdle();
    expect((await platform.getCreditBalance(organization.id)).balance).toBe(0);
    expect(await platform.listCreditLedger(organization.id, owner.creator.userId)).toHaveLength(0);
    const transactions = await platform.listStripeTransactionsForOperator(
      organization.id,
      new Date(0),
      new Date("1970-01-02"),
    );
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pi_early_refund",
          kind: "sale",
          amountMinor: 1000,
          currency: "CAD",
        }),
        expect.objectContaining({
          id: "re_early_refund",
          kind: "refund",
          amountMinor: 1000,
          currency: "CAD",
        }),
      ]),
    );
  });
  it("keeps credit admission independent while an authoritative billing provider read is stalled", async () => {
    const repository = new MemoryRepository();
    let resolveProvider!: (value: unknown) => void;
    const stalled = new Promise((resolve) => {
      resolveProvider = resolve;
    });
    const stripe = { subscriptions: { retrieve: vi.fn(() => stalled) } } as unknown as Stripe;
    const settings = config();
    const built = await buildApp(settings, { repository, cache: new MemorySessionCache(), stripe });
    app = built.app;
    const owner = await signIn(app, "provider-isolation@example.com");
    const platform = createPlatformRepository(repository);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    await platform.applySubscriptionSnapshot({
      organizationId: organization.id,
      customerId: "cus_isolation",
      subscriptionId: "sub_isolation",
      status: "active",
      licenseQuantity: 1,
      offerId: null,
      paidThrough: new Date(Date.now() + 60_000),
      graceUntil: null,
    });
    await platform.grantCredits({
      organizationId: organization.id,
      quantity: 1,
      actorId: owner.creator.userId,
      reason: "Isolation fixture",
      sourceKey: "isolation-fixture",
    });
    const roomId = randomUUID();
    await platform.reserveRoomCoverage({
      artifactType: "round",
      roomId,
      workspaceId: owner.creator.workspaceId,
      actorId: owner.creator.userId,
      funding: "credit",
      snapshot: entitlementsFor("pro", settings),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await platform.enqueueBillingEvent({
      providerEventId: "evt_isolation",
      eventType: "customer.subscription.updated",
      payload: { id: "sub_isolation", metadata: { organizationId: organization.id } },
      providerCreatedAt: new Date(),
    });
    const reconciliation = built.platformBillingWorker.runOnce();
    await vi.waitFor(() => expect(stripe.subscriptions.retrieve).toHaveBeenCalled());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          platform.consumeRoomCoverage("round", roomId),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Audience admission waited for the billing provider")),
              500,
            );
          }),
        ]),
      ).resolves.toMatchObject({ reservationState: "consumed" });
    } finally {
      clearTimeout(timeout);
      resolveProvider({
        id: "sub_isolation",
        customer: "cus_isolation",
        status: "active",
        items: {
          data: [
            {
              price: { id: "price_legacy" },
              quantity: 1,
              current_period_end: Math.floor(Date.now() / 1000) + 60,
            },
          ],
        },
        latest_invoice: { status: "paid" },
      });
      await reconciliation;
    }
  });
  it("accepts email invitations only for the verified recipient and never exposes token hashes in invitation listings or audit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const repository = new MemoryRepository();
    const built = await buildApp(config(), { repository, cache: new MemorySessionCache() });
    app = built.app;
    const owner = await signIn(app, "inviting-owner@example.com");
    const recipient = await signIn(app, "invited-finance@example.com");
    const wrongRecipient = await signIn(app, "wrong-recipient@example.com");
    const platform = createPlatformRepository(repository);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const invited = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/invitations`,
      headers: { cookie: owner.cookie, ...key() },
      payload: { email: "invited-finance@example.com", role: "billing" },
    });
    expect(invited.statusCode).toBe(201);
    const token = new URL(invited.json<{ inviteUrl: string }>().inviteUrl).searchParams.get(
      "token",
    )!;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/organization-invitations/accept",
          headers: { cookie: wrongRecipient.cookie },
          payload: { token },
        })
      ).statusCode,
    ).toBe(409);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/organization-invitations/accept",
      headers: { cookie: recipient.cookie },
      payload: { token },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ organizationId: organization.id, role: "billing" });
    const listing = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/invitations`,
      headers: { cookie: owner.cookie },
    });
    expect(listing.body).not.toContain("tokenHash");
    expect(JSON.stringify(await platform.listAuditEvents(organization.id))).not.toContain(token);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organization.id}/billing`,
          headers: { cookie: recipient.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("keeps billing-only principal access independent from workspace content and denies cross-organization reads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const repository = new MemoryRepository();
    const built = await buildApp(config(), { repository, cache: new MemorySessionCache() });
    app = built.app;
    const owner = await signIn(app, "organization-owner@example.com");
    const finance = await signIn(app, "organization-finance@example.com");
    const platform = createPlatformRepository(repository);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const denied = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/billing`,
      headers: { cookie: finance.cookie },
    });
    expect(denied.statusCode).toBe(403);
    const added = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.id}/members/${finance.creator.userId}`,
      headers: { cookie: owner.cookie, ...key() },
      payload: { role: "billing" },
    });
    expect(added.statusCode).toBe(200);
    for (const [membershipKey, member] of repository.workspaceMembers)
      if (member.userId === finance.creator.userId)
        repository.workspaceMembers.delete(membershipKey);
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: finance.cookie } }))
        .statusCode,
    ).toBe(401);
    vi.advanceTimersByTime(61_000);
    const freshMagic = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: {
        email: "organization-finance@example.com",
        segment: "workplace",
        acceptPolicies: true,
      },
    });
    const freshToken = new URL(freshMagic.json<{ debugUrl: string }>().debugUrl).searchParams.get(
      "token",
    )!;
    const freshVerified = await verifyEmailAndSignIn(
      app,
      `/v1/auth/verify?token=${freshToken}`,
      "organization-finance@example.com",
    );
    expect(freshVerified.statusCode).toBe(200);
    expect(freshVerified.json().redirectTo).toBe("http://localhost:3000/organization");
    const freshCookies = freshVerified.headers["set-cookie"]!;
    const freshCookie = (Array.isArray(freshCookies) ? freshCookies[0]! : freshCookies).split(
      ";",
    )[0]!;
    const identity = await app.inject({
      method: "GET",
      url: "/v1/auth/user",
      headers: { cookie: freshCookie },
    });
    expect(identity.json()).toMatchObject({
      user: { userId: finance.creator.userId, email: "organization-finance@example.com" },
      businessManagementEnabled: true,
    });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/account/locale",
          headers: { cookie: freshCookie },
          payload: { locale: "ko-KR" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organization.id}/billing`,
          headers: { cookie: freshCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/quizzes", headers: { cookie: freshCookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organization.id}/billing`,
          headers: { cookie: finance.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organization.id}/members`,
          headers: { cookie: finance.cookie },
        })
      ).statusCode,
    ).toBe(403);
    const downgrade = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.id}/members/${owner.creator.userId}`,
      headers: { cookie: owner.cookie, ...key() },
      payload: { role: "member" },
    });
    expect(downgrade.statusCode).toBe(409);
  });
  it("replays workspace creation without duplication and keeps free credit redemption once per organization", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(config(), { repository, cache: new MemorySessionCache() });
    app = built.app;
    const owner = await signIn(app, "organization-credits@example.com");
    const platform = createPlatformRepository(repository);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const headers = { cookie: owner.cookie, ...key() };
    const request = {
      method: "POST" as const,
      url: `/v1/organizations/${organization.id}/workspaces`,
      headers,
      payload: { name: "Training department", segment: "workplace" },
    };
    const first = await app.inject(request);
    const retry = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(
      (await platform.listOrganizationWorkspaces(organization.id, owner.creator.userId)).filter(
        (workspace) => workspace.name === "Training department",
      ),
    ).toHaveLength(1);
    await platform.savePromotion({
      id: randomUUID(),
      codeHash: createHash("sha256").update("WELCOME-FIVE").digest("hex"),
      name: "Welcome credits",
      kind: "credits",
      creditQuantity: 5,
      stripePromotionCodeId: null,
      organizationId: null,
      maximumRedemptions: 100,
      expiresAt: null,
      active: true,
      createdAt: new Date(),
    });
    const redemption = {
      method: "POST" as const,
      url: `/v1/organizations/${organization.id}/promotions/redeem`,
      headers: { cookie: owner.cookie, ...key() },
      payload: { code: "welcome-five" },
    };
    expect((await app.inject(redemption)).statusCode).toBe(200);
    expect((await app.inject(redemption)).statusCode).toBe(200);
    expect((await platform.getCreditBalance(organization.id)).available).toBe(5);
    expect(
      (await platform.listCreditLedger(organization.id, owner.creator.userId)).filter(
        (entry) => entry.delta > 0,
      ),
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/organizations/${organization.id}/catalog`,
          headers: { cookie: owner.cookie },
        })
      ).json(),
    ).toMatchObject({ offers: [] });
  });
  it("durably acknowledges signed webhooks before fulfillment and grants credits only on authoritative delayed payment", async () => {
    const repository = new MemoryRepository();
    let providerEvent = {
      id: "evt_pending",
      type: "checkout.session.completed",
      created: 123,
      data: { object: { id: "cs_purchase" } },
    };
    let checkout: Record<string, unknown> = {};
    const stripe = {
      refunds: {
        list: vi.fn(async () => ({
          data: [
            { id: "re_purchase", status: "succeeded", amount: 1000, currency: "cad", created: 124 },
          ],
        })),
      },
      charges: {
        retrieve: vi.fn(async () => ({
          id: "ch_purchase",
          payment_intent: "pi_purchase",
          customer: "cus_purchase",
          amount_refunded: 1000,
          metadata: { organizationId: "untrusted-wrong-organization" },
        })),
      },
      prices: {
        retrieve: vi.fn(async () => ({
          id: "price_pack",
          active: true,
          currency: "cad",
          unit_amount: 1000,
          type: "one_time",
        })),
      },
      webhooks: { constructEvent: vi.fn(() => providerEvent) },
      checkout: {
        sessions: {
          create: vi.fn(async (input: { metadata: Record<string, string> }) => {
            checkout = {
              id: "cs_purchase",
              url: "https://checkout.stripe.com/example",
              status: "open",
              mode: "payment",
              customer: "cus_purchase",
              metadata: input.metadata,
              payment_status: "unpaid",
              payment_intent: "pi_purchase",
              amount_total: 2000,
              currency: "cad",
              created: 123,
              line_items: { data: [{ price: { id: "price_pack" }, quantity: 2 }] },
            };
            return checkout;
          }),
          retrieve: vi.fn(async () => checkout),
        },
      },
    } as unknown as Stripe;
    const built = await buildApp(
      config({
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "sk_test_local",
        STRIPE_WEBHOOK_SECRET: "whsec_local",
        BUSINESS_CATALOG_JSON: JSON.stringify([
          {
            id: "event-five",
            version: 1,
            title: "Five event credits",
            kind: "event_credit_pack",
            published: true,
            stripePriceId: "price_pack",
            currency: "cad",
            unitAmount: 1000,
            creditsPerUnit: 5,
          },
        ]),
      }),
      { repository, cache: new MemorySessionCache(), stripe },
    );
    app = built.app;
    const owner = await signIn(app, "organization-paid@example.com");
    const platform = createPlatformRepository(repository);
    const organization = (await platform.getOrganizationForWorkspace(owner.creator.workspaceId))!;
    const purchased = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/billing/checkout`,
      headers: { cookie: owner.cookie, ...key() },
      payload: { offerId: "event-five", offerVersion: 1, quantity: 2 },
    });
    expect(purchased.statusCode).toBe(200);
    const webhook = () =>
      app!.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": "test-signature" },
        payload: JSON.stringify(providerEvent),
      });
    expect((await webhook()).statusCode).toBe(204);
    expect(await platform.listBillingEvents()).toHaveLength(1);
    expect((await platform.getCreditBalance(organization.id)).balance).toBe(0);
    await built.platformBillingWorker.runUntilIdle();
    expect((await platform.getCreditBalance(organization.id)).balance).toBe(0);
    checkout.payment_status = "paid";
    providerEvent = {
      ...providerEvent,
      id: "evt_paid",
      type: "checkout.session.async_payment_succeeded",
    };
    expect((await webhook()).statusCode).toBe(204);
    expect((await webhook()).statusCode).toBe(204);
    await built.platformBillingWorker.runUntilIdle();
    expect((await platform.getCreditBalance(organization.id)).balance).toBe(10);
    expect(
      (await platform.listCreditLedger(organization.id, owner.creator.userId)).filter(
        (entry) => entry.delta > 0,
      ),
    ).toHaveLength(1);
    providerEvent = {
      ...providerEvent,
      id: "evt_refunded",
      type: "charge.refunded",
      data: { object: { id: "ch_purchase" } },
    };
    expect((await webhook()).statusCode).toBe(204);
    await built.platformBillingWorker.runUntilIdle();
    expect((await platform.getOrganizationCommercialHold(organization.id))?.held).toBe(true);
    const purchase = (await platform.listPurchases(organization.id, owner.creator.userId))[0]!;
    expect(purchase.status).toBe("refunded");
    await expect(
      platform.reserveRoomCoverage({
        artifactType: "round",
        roomId: randomUUID(),
        workspaceId: owner.creator.workspaceId,
        actorId: owner.creator.userId,
        funding: "credit",
        snapshot: purchase.offer.entitlements,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toMatchObject({ code: "COMMERCIAL_HOLD" });
    providerEvent = {
      ...providerEvent,
      id: "evt_late_paid",
      type: "checkout.session.completed",
      data: { object: { id: "cs_purchase" } },
    };
    expect((await webhook()).statusCode).toBe(204);
    await built.platformBillingWorker.runUntilIdle();
    expect((await platform.listPurchases(organization.id, owner.creator.userId))[0]!.status).toBe(
      "refunded",
    );
    expect((await platform.getCreditBalance(organization.id)).balance).toBe(10);
  });
});
