import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import type {
  PlatformBillingEvent,
  PlatformOffer,
  PlatformPurchase,
  PlatformRepository,
  PlatformSubscription,
} from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { entitlementsFor } from "../src/entitlements.js";
import { PlatformBillingWorker } from "../src/platform-billing-worker.js";
import { bootstrapPlatformCatalog } from "../src/platform-catalog.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  BUSINESS_PLATFORM_ENABLED: "true",
  BUSINESS_EVENT_CREDITS_ENABLED: "true",
});
const offer: PlatformOffer = {
  id: "pro-monthly",
  name: "Pro workspace",
  productKey: "pollingpops",
  kind: "workspace_subscription",
  status: "published",
  version: 1,
  stripePriceId: "price_pro",
  currency: "cad",
  amountMinor: 1000,
  interval: "month",
  creditQuantity: 0,
  entitlements: entitlementsFor("pro", config),
  createdAt: new Date(),
  updatedAt: new Date(),
};
const initial: PlatformSubscription = {
  organizationId,
  subscriptionId: "sub_one",
  customerId: "cus_one",
  status: "active",
  licenseQuantity: 2,
  offerId: offer.id,
  paidThrough: new Date("2026-10-01T00:00:00Z"),
  graceUntil: null,
  updatedAt: new Date(),
};
const event = (
  id: string,
  eventType = "customer.subscription.updated",
  payload: Record<string, unknown> = { id: "sub_one", metadata: { organizationId } },
): PlatformBillingEvent => ({
  id,
  eventType,
  payload,
  providerCreatedAt: new Date(),
  state: "processing",
  attempts: 1,
  availableAt: new Date(),
  leaseToken: `lease-${id}`,
  leaseUntil: new Date(Date.now() + 60_000),
  lastError: null,
  createdAt: new Date(),
  completedAt: null,
});

function fixture(
  events: PlatformBillingEvent[],
  provider: Record<string, unknown>,
  startingSnapshot = initial,
) {
  let snapshot = { ...startingSnapshot };
  const platform = {
    claimBillingEvent: vi.fn(async () => events.shift() ?? null),
    completeBillingEvent: vi.fn(async () => true),
    failBillingEvent: vi.fn(async () => true),
    heartbeat: vi.fn(async () => undefined),
    withProviderBillingLock: vi.fn(async (_id: string, work: () => Promise<unknown>) => work()),
    listSubscriptions: vi.fn(async () => [snapshot]),
    listPendingPurchases: vi.fn(async () => []),
    getSubscription: vi.fn(async () => snapshot),
    getPurchase: vi.fn(async (): Promise<PlatformPurchase | null> => null),
    findPurchaseByPaymentId: vi.fn(async (): Promise<PlatformPurchase | null> => null),
    listOffers: vi.fn(async () => [offer]),
    getIntegrationConnection: vi.fn(async () => null),
    getWorkerControl: vi.fn(async () => null),
    recordStripeTransaction: vi.fn(async () => undefined),
    applySubscriptionSnapshot: vi.fn(async (input: PlatformSubscription) => {
      snapshot = input;
      return snapshot;
    }),
    withOrganizationBillingLock: vi.fn(
      async (_id: string, work: (scoped: PlatformRepository) => Promise<unknown>) =>
        work(platform as unknown as PlatformRepository),
    ),
  };
  const stripe = { subscriptions: { retrieve: vi.fn(async () => provider) } } as unknown as Stripe;
  const worker = new PlatformBillingWorker(
    platform as unknown as PlatformRepository,
    config,
    stripe,
  );
  return { platform, stripe, worker, snapshot: () => snapshot };
}

const subscription = (invoiceStatus: string, status = "active", quantity = 3) => ({
  id: "sub_one",
  customer: "cus_one",
  status,
  metadata: { organizationId },
  items: {
    data: [
      {
        id: "si_one",
        price: { id: "price_pro" },
        quantity,
        current_period_end: Date.parse("2026-11-01T00:00:00Z") / 1000,
      },
    ],
  },
  latest_invoice: { id: "in_one", status: invoiceStatus },
});

describe("durable platform billing reconciliation", () => {
  it.each([
    ["workspace", "price_prov2"],
    ["user", "price_prov2"],
    ["workspace", "price_pro"],
  ] as const)(
    "renews captured workspace terms after republishing %s licenses at %s",
    async (republishedUnit, republishedPrice) => {
      const repository = new MemoryRepository();
      const tokenHash = randomUUID();
      await repository.createMagicToken({
        id: randomUUID(),
        tokenHash,
        email: "captured-offer@example.test",
        segment: "workplace",
        policyVersion: "test",
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
      });
      const owner = (await repository.consumeMagicToken(tokenHash, new Date()))!;
      const platform = createPlatformRepository(repository);
      const organization = (await platform.getOrganizationForWorkspace(owner.workspaceId))!;
      const catalog = (
        version: number,
        stripePriceId: string,
        licenseUnit?: "workspace" | "user",
      ) =>
        ConfigSchema.parse({
          NODE_ENV: "test",
          ALLOW_IN_MEMORY: "true",
          BUSINESS_PLATFORM_ENABLED: "true",
          BUSINESS_CATALOG_JSON: JSON.stringify([
            {
              id: offer.id,
              title: offer.name,
              kind: "workspace_subscription",
              published: true,
              version,
              stripePriceId,
              ...(licenseUnit ? { licenseUnit } : {}),
              currency: "cad",
              unitAmount: 1000,
              interval: "month",
            },
          ]),
        });
      await bootstrapPlatformCatalog(platform, catalog(1, "price_pro"));
      const purchase = await platform.createPurchase({
        organizationId: organization.id,
        actorId: owner.userId,
        offerId: offer.id,
        quantity: 3,
        idempotencyKey: randomUUID(),
      });
      await platform.updatePurchaseCheckout(purchase.id, "cs_captured");
      await bootstrapPlatformCatalog(platform, catalog(2, republishedPrice, republishedUnit));
      expect(await platform.getOffer(offer.id)).toMatchObject({
        version: 2,
        licenseUnit: republishedUnit,
        entitlements: { plan: republishedUnit === "user" ? "team" : "pro" },
      });

      let paid = false;
      let quantity = 3;
      let providerPriceId = "price_pro";
      let periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const metadata: Record<string, string> = {
        organizationId: organization.id,
        purchaseId: purchase.id,
      };
      const stripe = {
        subscriptions: {
          retrieve: vi.fn(async () => {
            const current = subscription(
              paid ? "paid" : "open",
              paid ? "active" : "incomplete",
              quantity,
            );
            return {
              ...current,
              metadata,
              items: {
                data: current.items.data.map((item) => ({
                  ...item,
                  price: { id: providerPriceId },
                  current_period_end: periodEnd,
                })),
              },
            };
          }),
        },
        checkout: {
          sessions: {
            retrieve: vi.fn(async () => ({
              id: "cs_captured",
              mode: "subscription",
              status: "complete",
              payment_status: paid ? "paid" : "unpaid",
              subscription: "sub_one",
              customer: "cus_one",
              metadata,
              line_items: { data: [{ price: { id: "price_pro" }, quantity: 3 }] },
            })),
          },
        },
      } as unknown as Stripe;
      const worker = new PlatformBillingWorker(platform, config, stripe);
      const enqueue = async (id: string, eventType: string, payload: Record<string, unknown>) =>
        platform.enqueueBillingEvent({
          providerEventId: id,
          eventType,
          payload,
          providerCreatedAt: new Date(),
        });
      await enqueue("captured-unpaid", "checkout.session.completed", { id: "cs_captured" });
      expect(await worker.runUntilIdle()).toEqual({ processed: 1, failed: 0 });
      expect(await platform.getSubscription(organization.id)).toMatchObject({
        licenseQuantity: 0,
        paidThrough: null,
        graceUntil: null,
      });
      expect((await platform.getPurchase(purchase.id))?.status).toBe("pending");

      paid = true;
      await enqueue("captured-paid", "checkout.session.async_payment_succeeded", {
        id: "cs_captured",
      });
      expect(await worker.runUntilIdle()).toEqual({ processed: 1, failed: 0 });
      expect(await platform.getSubscription(organization.id)).toMatchObject({
        subscriptionId: "sub_one",
        licenseQuantity: 3,
        licenseUnit: "workspace",
        offerId: offer.id,
        paidThrough: new Date(periodEnd * 1000),
      });
      expect(await platform.getPurchase(purchase.id)).toMatchObject({
        status: "paid",
        paymentId: "sub_one",
        offer: { version: 1, stripePriceId: "price_pro", entitlements: { plan: "pro" } },
      });
      await platform.assignWorkspaceLicense(organization.id, owner.userId, owner.workspaceId, true);
      expect(await platform.effectiveWorkspacePlan(owner.workspaceId)).toBe("pro");
      expect(await repository.getPlan(owner.workspaceId)).toBe("pro");
      await enqueue("captured-replay", "checkout.session.completed", { id: "cs_captured" });
      expect(await worker.runUntilIdle()).toEqual({ processed: 1, failed: 0 });

      quantity = 4;
      periodEnd += 30 * 24 * 60 * 60;
      await enqueue("captured-renewal", "customer.subscription.updated", {
        id: "sub_one",
        metadata,
      });
      expect(await worker.runUntilIdle()).toEqual({ processed: 1, failed: 0 });
      expect(await platform.getSubscription(organization.id)).toMatchObject({
        licenseQuantity: 4,
        licenseUnit: "workspace",
        paidThrough: new Date(periodEnd * 1000),
      });
      expect(await platform.effectiveWorkspacePlan(owner.workspaceId)).toBe("pro");

      // The durable provider link also identifies the captured offer if metadata is removed.
      delete metadata.purchaseId;
      quantity = 5;
      periodEnd += 30 * 24 * 60 * 60;
      await enqueue("captured-renewal-without-metadata", "customer.subscription.updated", {
        id: "sub_one",
        metadata,
      });
      expect(await worker.runUntilIdle()).toEqual({ processed: 1, failed: 0 });
      expect(await platform.getSubscription(organization.id)).toMatchObject({
        licenseQuantity: 5,
        licenseUnit: "workspace",
        paidThrough: new Date(periodEnd * 1000),
        offerSnapshot: { version: 1, stripePriceId: "price_pro", entitlements: { plan: "pro" } },
      });
      expect((await platform.getSubscription(organization.id)).offerSnapshot?.entitlements).toEqual(
        purchase.offer.entitlements,
      );
      expect(await repository.getPlan(owner.workspaceId)).toBe("pro");

      const beforeMismatch = await platform.getSubscription(organization.id);
      periodEnd += 30 * 24 * 60 * 60;
      providerPriceId = republishedPrice;
      if (republishedUnit === "user") {
        await expect(worker.reconcileSubscription(organization.id, "sub_one")).rejects.toThrow(
          /licensed unit/,
        );
        expect(await platform.getSubscription(organization.id)).toEqual(beforeMismatch);
      } else if (republishedPrice !== "price_pro") {
        await worker.reconcileSubscription(organization.id, "sub_one");
        const updated = await platform.getSubscription(organization.id);
        expect(updated).toMatchObject({
          licenseUnit: "workspace",
          paidThrough: new Date(periodEnd * 1000),
          offerSnapshot: { version: 2, stripePriceId: "price_prov2" },
        });
        expect(updated.offerSnapshot).toEqual(await platform.getOffer(offer.id));
      } else {
        await worker.reconcileSubscription(organization.id, "sub_one");
        expect(await platform.getSubscription(organization.id)).toMatchObject({
          licenseUnit: "workspace",
          paidThrough: new Date(periodEnd * 1000),
          offerSnapshot: { version: 1, stripePriceId: "price_pro" },
        });
      }
      const beforeUnknownPrice = await platform.getSubscription(organization.id);
      periodEnd += 30 * 24 * 60 * 60;
      providerPriceId = "price_unknown";
      await expect(worker.reconcileSubscription(organization.id, "sub_one")).rejects.toThrow(
        "Subscription uses an unrecognized offer",
      );
      expect(await platform.getSubscription(organization.id)).toEqual(beforeUnknownPrice);
      expect(await repository.getPlan(owner.workspaceId)).toBe("pro");
    },
  );
  it.each(["organization", "subscription", "price"] as const)(
    "rejects a captured offer linked to a different %s",
    async (mismatch) => {
      const provider = { ...subscription("paid"), metadata: { organizationId, purchaseId: "p1" } };
      const built = fixture([event("mismatched-purchase")], provider);
      built.platform.listOffers.mockResolvedValue([
        { ...offer, version: 2, stripePriceId: "price_v2" },
      ]);
      built.platform.getSubscription.mockResolvedValue({
        ...initial,
        subscriptionId: null,
        status: "free",
        offerId: null,
        licenseQuantity: 0,
        paidThrough: null,
      });
      const purchase: PlatformPurchase = {
        id: "p1",
        organizationId: mismatch === "organization" ? randomUUID() : organizationId,
        offer: mismatch === "price" ? { ...offer, stripePriceId: "price_other" } : offer,
        quantity: 3,
        checkoutId: "cs_p1",
        paymentId: mismatch === "subscription" ? "sub_other" : null,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      Object.assign(built.platform, { getPurchase: vi.fn(async () => purchase) });
      expect(await built.worker.runUntilIdle()).toEqual({ processed: 0, failed: 1 });
      expect(built.platform.applySubscriptionSnapshot).not.toHaveBeenCalled();
    },
  );
  it.each(["pro", "team"] as const)(
    "renews a migrated %s subscription without catalog or purchase terms",
    async (legacyPlan) => {
      const provider = subscription("paid", "active", 99);
      provider.items.data[0]!.price.id = "price_uncataloged_legacy";
      const legacy: PlatformSubscription = {
        ...initial,
        licenseQuantity: 1,
        offerId: null,
        legacyPlan,
      };
      expect(legacy.authoritative).toBeUndefined();
      expect(legacy.licenseUnit).toBeUndefined();
      const built = fixture([event("legacy-paid-renewal")], provider, legacy);
      expect(await built.worker.runUntilIdle()).toEqual({ processed: 1, failed: 0 });
      expect(built.snapshot()).toMatchObject({
        subscriptionId: legacy.subscriptionId,
        customerId: legacy.customerId,
        licenseQuantity: 1,
        licenseUnit: "workspace",
        legacyPlan,
        offerId: null,
        paidThrough: new Date("2026-11-01T00:00:00Z"),
        graceUntil: null,
      });
      expect(built.snapshot().offerSnapshot).toBeUndefined();
    },
  );
  it("does not continue an uncataloged legacy contract for a different provider customer", async () => {
    const provider = subscription("paid");
    provider.customer = "cus_other";
    provider.items.data[0]!.price.id = "price_uncataloged_legacy";
    const legacy: PlatformSubscription = {
      ...initial,
      licenseQuantity: 1,
      offerId: null,
      legacyPlan: "team",
    };
    const built = fixture([event("legacy-customer-mismatch")], provider, legacy);
    expect(await built.worker.runUntilIdle()).toEqual({ processed: 0, failed: 1 });
    expect(built.platform.applySubscriptionSnapshot).not.toHaveBeenCalled();
    expect(built.snapshot()).toEqual(legacy);
  });
  it("imports verified invoice payment amounts with stable provider references instead of deriving revenue from catalog prices", async () => {
    const provider = {
      ...subscription("paid"),
      latest_invoice: {
        id: "in_actual",
        status: "paid",
        amount_paid: 750,
        currency: "cad",
        created: 123,
        status_transitions: { paid_at: 124 },
      },
    };
    const built = fixture([event("invoice-trigger")], provider);
    Object.assign(built.stripe, {
      invoicePayments: {
        list: vi.fn(async () => ({
          data: [
            {
              id: "inpay_actual",
              amount_paid: 750,
              currency: "cad",
              created: 123,
              status_transitions: { paid_at: 124 },
              payment: { payment_intent: "pi_actual" },
            },
          ],
        })),
      },
    });
    await built.worker.runUntilIdle();
    expect(built.platform.recordStripeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pi_actual",
        organizationId,
        kind: "sale",
        amountMinor: 750,
        currency: "CAD",
        invoiceId: "in_actual",
        paymentId: "pi_actual",
      }),
    );
  });
  it("uses authoritative retrieval rather than event creation order or embedded quantities", async () => {
    const built = fixture([event("new-event"), event("late-old-event")], subscription("paid"));
    expect(await built.worker.runUntilIdle()).toEqual({ processed: 2, failed: 0 });
    expect(built.snapshot().licenseQuantity).toBe(3);
    expect(built.snapshot().paidThrough?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(built.platform.withOrganizationBillingLock).toHaveBeenCalledTimes(2);
    expect(built.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
  });
  it("does not grant unpaid initial capacity or extend grace on repeated failed renewal events", async () => {
    const built = fixture(
      [event("failed-one"), event("failed-two")],
      subscription("open", "past_due", 9),
    );
    await built.worker.runUntilIdle();
    expect(built.snapshot().licenseQuantity).toBe(2);
    expect(built.snapshot().paidThrough?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(built.snapshot().graceUntil?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    const unpaid = fixture([event("initial-unpaid")], subscription("open", "incomplete"));
    unpaid.platform.getSubscription.mockResolvedValue({
      ...initial,
      offerId: null,
      licenseQuantity: 0,
      paidThrough: null,
    });
    await unpaid.worker.runUntilIdle();
    expect(unpaid.platform.applySubscriptionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ licenseQuantity: 0, paidThrough: null, graceUntil: null }),
    );
  });
  it("retains a durable retry when the provider cannot be read and avoids recording provider contact data", async () => {
    const built = fixture([event("unavailable")], subscription("paid"));
    vi.mocked(built.stripe.subscriptions.retrieve).mockRejectedValue(
      new Error("private@example.com payment failure"),
    );
    expect(await built.worker.runUntilIdle()).toEqual({ processed: 0, failed: 1 });
    expect(built.platform.applySubscriptionSnapshot).not.toHaveBeenCalled();
    expect(built.platform.completeBillingEvent).not.toHaveBeenCalled();
    expect(built.platform.failBillingEvent).toHaveBeenCalledWith(
      "unavailable",
      "lease-unavailable",
      "Authoritative billing reconciliation failed; retry scheduled",
    );
  });
  it("waits for confirmed payment and validates purchased credit quantity against the saved offer", async () => {
    const pack = {
      ...offer,
      id: "credit-five",
      kind: "credit_pack" as const,
      interval: null,
      stripePriceId: "price_pack",
      creditQuantity: 5,
    };
    const purchase = {
      id: "purchase-one",
      organizationId,
      offer: pack,
      quantity: 2,
      checkoutId: "cs_one",
      paymentId: null,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let paid = false;
    const checkout = () => ({
      id: "cs_one",
      mode: "payment",
      customer: "cus_one",
      metadata: { organizationId, purchaseId: purchase.id },
      payment_status: paid ? "paid" : "unpaid",
      payment_intent: "pi_one",
      amount_total: 2000,
      currency: "cad",
      created: 123,
      line_items: { data: [{ price: { id: "price_pack" }, quantity: 2 }] },
    });
    const built = fixture(
      [event("checkout-start", "checkout.session.completed", { id: "cs_one" })],
      subscription("paid"),
    );
    const platform = Object.assign(built.platform, {
      getPurchase: vi.fn(async () => purchase),
      fulfillCreditPurchase: vi.fn(async () => ({ ...purchase, status: "paid" })),
      updatePurchaseCheckout: vi.fn(async () => purchase),
    });
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn(async () => checkout()) } },
    } as unknown as Stripe;
    const worker = new PlatformBillingWorker(
      platform as unknown as PlatformRepository,
      config,
      stripe,
    );
    await worker.runUntilIdle();
    expect(platform.fulfillCreditPurchase).not.toHaveBeenCalled();
    paid = true;
    platform.claimBillingEvent.mockResolvedValueOnce(
      event("delayed-paid", "checkout.session.async_payment_succeeded", { id: "cs_one" }),
    );
    await worker.runUntilIdle();
    expect(platform.fulfillCreditPurchase).toHaveBeenCalledWith(purchase.id, "pi_one");
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(3);
    vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({
      ...checkout(),
      line_items: { data: [{ price: { id: "price_pack" }, quantity: 99 }] },
    } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    platform.claimBillingEvent.mockResolvedValueOnce(
      event("invalid-quantity", "checkout.session.completed", { id: "cs_one" }),
    );
    expect(await worker.runUntilIdle()).toEqual({ processed: 0, failed: 1 });
    expect(platform.fulfillCreditPurchase).toHaveBeenCalledTimes(1);
  });
});
