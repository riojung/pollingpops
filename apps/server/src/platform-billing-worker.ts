import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type {
  PlatformBillingEvent,
  PlatformOffer,
  PlatformPurchase,
  PlatformRepository,
  PlatformSubscription,
  PlatformStripeTransaction,
} from "@openround/db";
import type { AppConfig } from "./config.js";
export { bootstrapPlatformCatalog } from "./platform-catalog.js";

const graceMilliseconds = 7 * 24 * 60 * 60 * 1_000;
const identifier = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : value && typeof value === "object" && "id" in value && typeof value.id === "string"
      ? value.id
      : null;
const settledCheckout = (checkout: Stripe.Checkout.Session) =>
  checkout.payment_status === "paid" ||
  (checkout.payment_status === "no_payment_required" &&
    checkout.status === "complete" &&
    checkout.amount_total === 0);

/** Provider notifications are a durable trigger; authoritative provider reads decide access. */
export class PlatformBillingWorker {
  readonly stripe: Stripe | null;

  constructor(
    private readonly platform: PlatformRepository,
    private readonly config: AppConfig,
    stripeClient?: Stripe | null,
  ) {
    this.stripe =
      stripeClient !== undefined
        ? stripeClient
        : config.BILLING_MODE === "stripe"
          ? new Stripe(config.STRIPE_SECRET_KEY!, { timeout: 10_000, maxNetworkRetries: 0 })
          : null;
  }

  async runOnce(): Promise<"idle" | "completed" | "retry_scheduled"> {
    if (!this.config.BUSINESS_PLATFORM_ENABLED || !this.stripe) return "idle";
    if ((await this.platform.getWorkerControl("billing-reconciliation"))?.paused) return "idle";
    const event = await this.platform.claimBillingEvent(
      this.config.BUSINESS_BILLING_WORKER_LEASE_MS,
    );
    if (!event) return "idle";
    try {
      await this.process(event);
      if (!(await this.platform.completeBillingEvent(event.id, event.leaseToken!)))
        throw new Error("Billing event lease was lost");
      return "completed";
    } catch {
      // Provider errors can contain contact/payment data. Retain a bounded diagnostic category.
      await this.platform.failBillingEvent(
        event.id,
        event.leaseToken!,
        "Authoritative billing reconciliation failed; retry scheduled",
      );
      return "retry_scheduled";
    }
  }

  async runUntilIdle(limit = 100): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    for (let index = 0; index < limit; index += 1) {
      const result = await this.runOnce();
      if (result === "idle") break;
      if (result === "retry_scheduled") {
        failed += 1;
        break;
      }
      processed += 1;
    }
    await this.platform.heartbeat({
      id: "platform-billing",
      status: failed ? "degraded" : "healthy",
      details: {
        processed,
        failed,
        enabled: Boolean(this.stripe && this.config.BUSINESS_PLATFORM_ENABLED),
      },
    });
    return { processed, failed };
  }

  async reconcileAll(): Promise<number> {
    if (!this.config.BUSINESS_PLATFORM_ENABLED || !this.stripe) return 0;
    if ((await this.platform.getWorkerControl("billing-reconciliation"))?.paused) return 0;
    let reconciled = 0;
    let failed = 0;
    const scanTime = new Date();
    for (const purchase of await this.platform.listPendingPurchases(1_000)) {
      if (!purchase.checkoutId) continue;
      await this.platform.enqueueBillingEvent({
        providerEventId: `reconcile-checkout:${purchase.checkoutId}:${Math.floor(scanTime.getTime() / this.config.BUSINESS_BILLING_RECONCILE_INTERVAL_MS)}`,
        eventType: "checkout.session.completed",
        payload: { id: purchase.checkoutId },
        providerCreatedAt: scanTime,
      });
    }
    for (const subscription of await this.platform.listSubscriptions()) {
      if (!subscription.subscriptionId) continue;
      try {
        await this.reconcileSubscription(subscription.organizationId, subscription.subscriptionId);
        reconciled += 1;
      } catch {
        failed += 1;
        const now = new Date();
        await this.platform.enqueueBillingEvent({
          providerEventId: `reconcile:${subscription.subscriptionId}:${Math.floor(now.getTime() / this.config.BUSINESS_BILLING_RECONCILE_INTERVAL_MS)}`,
          eventType: "customer.subscription.updated",
          payload: {
            id: subscription.subscriptionId,
            metadata: { organizationId: subscription.organizationId },
          },
          providerCreatedAt: now,
        });
      }
    }
    await this.platform.heartbeat({
      id: "platform-billing-reconciliation",
      status: failed ? "degraded" : "healthy",
      details: { reconciled, failed },
    });
    return reconciled;
  }

  private async process(event: PlatformBillingEvent) {
    const object = event.payload;
    if (event.eventType.startsWith("checkout.session.")) {
      const checkoutId = identifier(object);
      if (!checkoutId) return;
      // Completed sessions may still be unpaid. The later async event uses the same path.
      const checkout = await this.stripe!.checkout.sessions.retrieve(checkoutId, {
        expand: ["line_items.data.price"],
      });
      const purchaseId = checkout.metadata?.purchaseId;
      if (!purchaseId) {
        if (checkout.mode === "subscription")
          await this.reconcileLegacyMetadata(checkout.metadata, identifier(checkout.subscription));
        return;
      }
      const purchase = await this.platform.getPurchase(purchaseId);
      if (!purchase || checkout.metadata?.organizationId !== purchase.organizationId)
        throw new Error("Unknown billing purchase");
      if (purchase.checkoutId && purchase.checkoutId !== checkout.id)
        throw new Error("Purchase checkout does not match");
      if (
        !settledCheckout(checkout) &&
        (checkout.status === "expired" ||
          event.eventType === "checkout.session.async_payment_failed")
      ) {
        await this.withVerifiedCheckout(purchase, checkout.id, async (scoped, verified) => {
          if (
            !settledCheckout(verified) &&
            (verified.status === "expired" ||
              (verified.status === "complete" && verified.payment_status === "unpaid"))
          )
            await scoped.cancelPurchase(purchase.id);
        });
        return;
      }
      const customerId = identifier(checkout.customer);
      if (checkout.mode === "subscription") {
        await this.reconcileSubscription(
          purchase.organizationId,
          identifier(checkout.subscription),
        );
        if (settledCheckout(checkout)) {
          await this.withVerifiedCheckout(purchase, checkout.id, async (scoped, verified) => {
            const lines = verified.line_items?.data ?? [];
            const subscriptionId = identifier(verified.subscription);
            if (
              !settledCheckout(verified) ||
              !subscriptionId ||
              purchase.offer.kind !== "workspace_subscription" ||
              lines.length !== 1 ||
              identifier(lines[0]!.price) !== purchase.offer.stripePriceId ||
              lines[0]!.quantity !== purchase.quantity
            )
              throw new Error("Subscription purchase does not match its immutable offer");
            await scoped.updatePurchaseCheckout(purchase.id, verified.id);
            await scoped.markSubscriptionPurchasePaid(purchase.id, subscriptionId);
          });
        }
        return;
      }
      if (!settledCheckout(checkout)) return;
      await this.withVerifiedCheckout(purchase, checkout.id, async (scoped, verified) => {
        const lines = verified.line_items?.data ?? [];
        if (
          !settledCheckout(verified) ||
          verified.mode !== "payment" ||
          purchase.offer.kind !== "credit_pack" ||
          lines.length !== 1 ||
          identifier(lines[0]!.price) !== purchase.offer.stripePriceId ||
          lines[0]!.quantity !== purchase.quantity
        )
          throw new Error("Credit purchase does not match its immutable offer");
        const paymentId =
          identifier(verified.payment_intent) ??
          (verified.amount_total === 0 ? `settled-checkout:${verified.id}` : null);
        if (!paymentId || !customerId)
          throw new Error("Paid checkout is missing its payment reference");
        await scoped.recordStripeTransaction(
          this.checkoutTransaction(verified, purchase.organizationId, event.id),
        );
        await scoped.updatePurchaseCheckout(purchase.id, verified.id);
        await scoped.fulfillCreditPurchase(purchase.id, paymentId);
        const prior = await scoped.getSubscription(purchase.organizationId);
        if (!prior.customerId) await scoped.applySubscriptionSnapshot({ ...prior, customerId });
      });
      return;
    }
    const metadata =
      object.metadata && typeof object.metadata === "object"
        ? (object.metadata as Record<string, string>)
        : null;
    let subscriptionId: string | null = null;
    if (event.eventType.startsWith("customer.subscription.")) subscriptionId = identifier(object);
    if (event.eventType.startsWith("invoice.")) {
      const invoice = await this.stripe!.invoices.retrieve(identifier(object)!);
      subscriptionId = identifier(invoice.parent?.subscription_details?.subscription);
      const subscriptionMetadata = invoice.parent?.subscription_details?.metadata;
      if (subscriptionId) {
        const organizationId = await this.reconcileLegacyMetadata(
          subscriptionMetadata,
          subscriptionId,
        );
        if (organizationId)
          await this.platform.withProviderBillingLock(organizationId, async () => {
            const verified = await this.stripe!.invoices.retrieve(invoice.id);
            const transactions = await this.invoiceTransactions(verified, organizationId, event.id);
            await this.platform.withOrganizationBillingLock(organizationId, async (scoped) => {
              for (const transaction of transactions)
                await scoped.recordStripeTransaction(transaction);
            });
          });
      }
      return;
    }
    if (subscriptionId) await this.reconcileLegacyMetadata(metadata, subscriptionId);
    if (event.eventType.startsWith("charge.dispute.") || event.eventType === "charge.refunded") {
      await this.processReversal(event);
    }
  }

  private async processReversal(event: PlatformBillingEvent) {
    const disputeId = event.eventType.startsWith("charge.dispute.")
      ? identifier(event.payload)
      : null;
    const discoveredDispute = disputeId ? await this.stripe!.disputes.retrieve(disputeId) : null;
    const chargeId = discoveredDispute
      ? identifier(discoveredDispute.charge)
      : identifier(event.payload);
    if (!chargeId) throw new Error("Payment reversal is missing a charge reference");
    const discoveredCharge = await this.stripe!.charges.retrieve(chargeId);
    const paymentId = identifier(discoveredCharge.payment_intent);
    let purchase = paymentId ? await this.platform.findPurchaseByPaymentId(paymentId) : null;
    let organizationId = purchase?.organizationId;
    // Refunds may arrive before the Checkout fulfillment notification. Validate the saved
    // Checkout ID against provider payment linkage rather than trusting provider metadata.
    if (!purchase && paymentId) {
      const checkouts = await this.stripe!.checkout.sessions.list({
        payment_intent: paymentId,
        limit: 100,
      });
      purchase =
        (await this.platform.listPendingPurchases(1_000)).find((candidate) =>
          checkouts.data.some((checkout) => checkout.id === candidate.checkoutId),
        ) ?? null;
      organizationId = purchase?.organizationId;
    }
    if (!organizationId && paymentId) {
      const payments = await this.stripe!.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentId },
        limit: 100,
      });
      const subscriptions = await this.platform.listSubscriptions();
      for (const payment of payments.data) {
        const invoiceId = identifier(payment.invoice);
        if (!invoiceId) continue;
        const invoice = await this.stripe!.invoices.retrieve(invoiceId);
        const subscriptionId = identifier(invoice.parent?.subscription_details?.subscription);
        const mapped = subscriptions.find(
          (candidate) =>
            candidate.subscriptionId === subscriptionId &&
            candidate.customerId === identifier(discoveredCharge.customer),
        );
        if (mapped) {
          organizationId = mapped.organizationId;
          purchase = subscriptionId
            ? await this.platform.findPurchaseByPaymentId(subscriptionId)
            : null;
          break;
        }
      }
    }
    if (!organizationId) {
      await this.platform.createCase({
        organizationId: null,
        category: "billing_review",
        title: "Unmapped payment reversal requires review",
        details: { providerEventId: event.id, chargeId, paymentId, disputeId },
      });
      return;
    }
    const mappedOrganizationId = organizationId;
    const mappedPurchase = purchase;
    await this.platform.withProviderBillingLock(mappedOrganizationId, async () => {
      const charge = await this.stripe!.charges.retrieve(chargeId);
      const dispute = disputeId ? await this.stripe!.disputes.retrieve(disputeId) : null;
      if (identifier(charge.payment_intent) !== paymentId)
        throw new Error("Payment linkage changed during reconciliation");
      const disputeStatus = dispute?.status ?? "none";
      const actionableDispute =
        dispute !== null && !["won", "warning_closed", "prevented"].includes(disputeStatus);
      if (charge.amount_refunded <= 0 && !actionableDispute) return;
      const sourceKey = `financial-review:${charge.id}:${charge.amount_refunded}:${disputeStatus}`;
      await this.platform.withTransaction((transaction) =>
        transaction.withOrganizationBillingLock(mappedOrganizationId, async (scoped) => {
          const command = await scoped.beginCommand({
            actorId: "system:billing",
            idempotencyKey: sourceKey,
            requestHash: sourceKey,
          });
          if (!command.created && command.receipt.state === "complete") return;
          if (mappedPurchase) {
            const current = await scoped.getPurchase(mappedPurchase.id);
            if (!current || current.organizationId !== mappedOrganizationId)
              throw new Error("Payment purchase mapping changed");
            await scoped.markPurchaseRefunded(
              current.id,
              current.paymentId ? undefined : (paymentId ?? undefined),
            );
          }
          await scoped.setOrganizationCommercialHold(
            mappedOrganizationId,
            true,
            "A payment refund or dispute requires financial review",
          );
          const billingCase = await scoped.createCase({
            organizationId: mappedOrganizationId,
            category: "billing_review",
            title: "Payment reversal requires financial review",
            details: {
              providerEventId: event.id,
              chargeId: charge.id,
              paymentId,
              purchaseId: mappedPurchase?.id ?? null,
              refundedAmountMinor: charge.amount_refunded,
              disputeId,
              disputeStatus,
            },
          });
          await scoped.appendAuditEvent({
            actorId: "system:billing",
            organizationId: mappedOrganizationId,
            action: "billing.commercial_hold",
            targetId: mappedPurchase?.id ?? charge.id,
            reason: "Authoritative payment reversal",
            requestId: event.id,
            before: null,
            after: { held: true, caseId: billingCase.id },
          });
          await scoped.completeCommand(command.receipt.id, { held: true, caseId: billingCase.id });
        }),
      );
      // Apply the hold before optional financial-detail reads. A provider outage
      // must not leave a verified reversal available for new room funding.
      const refunds =
        charge.amount_refunded > 0
          ? await this.stripe!.refunds.list({ charge: charge.id, limit: 100 })
          : { data: [] };
      const settledSale =
        mappedPurchase?.offer.kind === "credit_pack" && mappedPurchase.checkoutId
          ? await this.stripe!.checkout.sessions.retrieve(mappedPurchase.checkoutId)
          : null;
      await this.platform.withOrganizationBillingLock(mappedOrganizationId, async (scoped) => {
        if (
          settledSale &&
          settledCheckout(settledSale) &&
          identifier(settledSale.payment_intent) === paymentId
        )
          await scoped.recordStripeTransaction(
            this.checkoutTransaction(settledSale, mappedOrganizationId, event.id),
          );
        for (const refund of refunds.data) {
          if (refund.status === "succeeded")
            await scoped.recordStripeTransaction({
              id: refund.id,
              organizationId: mappedOrganizationId,
              kind: "refund",
              amountMinor: refund.amount,
              currency: refund.currency.toUpperCase(),
              occurredAt: new Date(refund.created * 1_000),
              paymentId,
              invoiceId: null,
              sourceEventId: event.id,
            });
        }
      });
    });
  }

  private async withVerifiedCheckout(
    purchase: PlatformPurchase,
    checkoutId: string,
    work: (scoped: PlatformRepository, checkout: Stripe.Checkout.Session) => Promise<void>,
  ) {
    await this.platform.withProviderBillingLock(purchase.organizationId, async () => {
      const verified = await this.stripe!.checkout.sessions.retrieve(checkoutId, {
        expand: ["line_items.data.price"],
      });
      await this.platform.withOrganizationBillingLock(purchase.organizationId, async (scoped) => {
        const current = await scoped.getPurchase(purchase.id);
        if (
          !current ||
          verified.metadata?.purchaseId !== current.id ||
          verified.metadata?.organizationId !== current.organizationId ||
          (current.checkoutId && current.checkoutId !== verified.id)
        )
          throw new Error("Purchase checkout identity does not match");
        if (current.status === "refunded") return;
        await work(scoped, verified);
      });
    });
  }

  private async reconcileLegacyMetadata(
    metadata: Record<string, string> | null | undefined,
    subscriptionId: string | null,
  ) {
    if (!subscriptionId) return;
    let organizationId = metadata?.organizationId;
    if (!organizationId && metadata?.workspaceId)
      organizationId = (await this.platform.getOrganizationForWorkspace(metadata.workspaceId))?.id;
    if (!organizationId) {
      const subscription = await this.stripe!.subscriptions.retrieve(subscriptionId);
      organizationId = subscription.metadata.organizationId;
      if (!organizationId && subscription.metadata.workspaceId)
        organizationId = (
          await this.platform.getOrganizationForWorkspace(subscription.metadata.workspaceId)
        )?.id;
    }
    if (organizationId) await this.reconcileSubscription(organizationId, subscriptionId);
    return organizationId;
  }

  private checkoutTransaction(
    checkout: Stripe.Checkout.Session,
    organizationId: string,
    sourceEventId: string,
  ): PlatformStripeTransaction {
    if (checkout.amount_total === null || checkout.amount_total === undefined || !checkout.currency)
      throw new Error("Settled checkout is missing its commercial amount");
    const paymentId = identifier(checkout.payment_intent);
    return {
      id: paymentId ?? `zero-checkout:${checkout.id}`,
      organizationId,
      kind: "sale",
      amountMinor: checkout.amount_total,
      currency: checkout.currency.toUpperCase(),
      occurredAt: new Date(checkout.created * 1_000),
      paymentId,
      invoiceId: identifier(checkout.invoice),
      sourceEventId,
    };
  }

  private async invoiceTransactions(
    invoice: Stripe.Invoice,
    organizationId: string,
    sourceEventId: string,
  ): Promise<PlatformStripeTransaction[]> {
    if (invoice.status !== "paid" || typeof invoice.amount_paid !== "number") return [];
    const payments = await this.stripe!.invoicePayments.list({
      invoice: invoice.id,
      status: "paid",
      limit: 100,
    });
    if (!payments.data.length)
      return [
        {
          id: `invoice:${invoice.id}`,
          organizationId,
          kind: "sale",
          amountMinor: invoice.amount_paid,
          currency: invoice.currency.toUpperCase(),
          occurredAt: new Date((invoice.status_transitions.paid_at ?? invoice.created) * 1_000),
          paymentId: null,
          invoiceId: invoice.id,
          sourceEventId,
        },
      ];
    return payments.data.map((payment) => {
      const paymentId = identifier(payment.payment.payment_intent);
      return {
        id: paymentId ?? payment.id,
        organizationId,
        kind: "sale",
        amountMinor: payment.amount_paid ?? 0,
        currency: payment.currency.toUpperCase(),
        occurredAt: new Date((payment.status_transitions.paid_at ?? payment.created) * 1_000),
        paymentId,
        invoiceId: invoice.id,
        sourceEventId,
      };
    });
  }

  async reconcileSubscription(organizationId: string, subscriptionId: string | null) {
    if (!subscriptionId || !this.stripe) return;
    await this.platform.withProviderBillingLock(organizationId, async () => {
      const subscription = await this.stripe!.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice"],
      });
      const paidInvoice =
        subscription.latest_invoice && typeof subscription.latest_invoice === "object"
          ? subscription.latest_invoice
          : null;
      const transactions = paidInvoice
        ? await this.invoiceTransactions(paidInvoice, organizationId, `reconcile:${paidInvoice.id}`)
        : [];
      await this.platform.withOrganizationBillingLock(organizationId, async (scoped) => {
        const prior = await scoped.getSubscription(organizationId);
        // A notification for a replaced subscription must not overwrite its replacement.
        if (
          prior.subscriptionId &&
          prior.subscriptionId !== subscriptionId &&
          !["free", "canceled", "incomplete_expired"].includes(prior.status)
        )
          return;
        const items = subscription.items.data;
        const offers = await scoped.listOffers(true);
        let capturedPurchaseId: string | undefined;
        let hasPurchaseEvidence = false;
        let offer: PlatformOffer | undefined;
        if (
          items.length === 1 &&
          prior.subscriptionId === subscriptionId &&
          prior.offerSnapshot?.id === prior.offerId &&
          prior.offerSnapshot?.kind === "workspace_subscription" &&
          prior.offerSnapshot.stripePriceId === items[0]!.price.id
        )
          offer = prior.offerSnapshot;
        if (!offer && items.length === 1) {
          // Catalog publication replaces the current offer, but outstanding checkouts and
          // renewals still use their immutable purchase terms and original provider price.
          const purchase = subscription.metadata.purchaseId
            ? await scoped.getPurchase(subscription.metadata.purchaseId)
            : await scoped.findPurchaseByPaymentId(subscriptionId);
          hasPurchaseEvidence = Boolean(purchase);
          if (
            purchase?.organizationId === organizationId &&
            purchase.offer.kind === "workspace_subscription" &&
            purchase.offer.stripePriceId === items[0]!.price.id &&
            ["pending", "paid"].includes(purchase.status) &&
            (!purchase.paymentId || purchase.paymentId === subscriptionId)
          ) {
            offer = purchase.offer;
            capturedPurchaseId = purchase.id;
          }
        }
        if (!offer && items.length === 1)
          offer = offers.find(
            (candidate) =>
              candidate.kind === "workspace_subscription" &&
              candidate.stripePriceId === items[0]!.price.id,
          );
        // Existing licensed subscriptions retain their paid capacity while an invoice is unpaid.
        const invoice =
          subscription.latest_invoice && typeof subscription.latest_invoice === "object"
            ? subscription.latest_invoice
            : null;
        const paid = invoice?.status === "paid";
        // Migration 065 retained linked subscriptions before the versioned catalog existed.
        // Renew only that exact legacy contract; an unknown price cannot change its tier or seats.
        const legacyContinuation =
          !offer &&
          items.length === 1 &&
          prior.organizationId === organizationId &&
          prior.subscriptionId === subscriptionId &&
          subscription.id === subscriptionId &&
          (prior.customerId === null || prior.customerId === identifier(subscription.customer)) &&
          prior.offerId === null &&
          !prior.offerSnapshot &&
          !hasPurchaseEvidence &&
          !subscription.metadata.purchaseId &&
          (prior.licenseUnit ?? "workspace") === "workspace" &&
          (prior.legacyPlan === "pro" || prior.legacyPlan === "team") &&
          prior.licenseQuantity > 0;
        if (!offer && !legacyContinuation && (paid || prior.subscriptionId !== subscriptionId))
          throw new Error("Subscription uses an unrecognized offer");
        if (paid && items.length !== 1)
          throw new Error("Subscription must contain exactly one licensed item");
        const paidThrough = paid
          ? new Date(items[0]!.current_period_end * 1_000)
          : prior.paidThrough;
        const failedRenewal =
          ["past_due", "unpaid"].includes(subscription.status) && paidThrough !== null;
        const graceUntil = failedRenewal
          ? new Date(paidThrough.getTime() + graceMilliseconds)
          : null;
        const next: Omit<PlatformSubscription, "updatedAt"> = {
          organizationId,
          customerId: identifier(subscription.customer),
          subscriptionId: subscription.id,
          status: subscription.status,
          licenseQuantity: paid && offer ? (items[0]!.quantity ?? 1) : prior.licenseQuantity,
          licenseUnit: offer?.licenseUnit ?? prior.licenseUnit ?? "workspace",
          offerId: offer?.id ?? prior.offerId,
          ...(offer ? { offerSnapshot: offer } : {}),
          ...(legacyContinuation ? { legacyPlan: prior.legacyPlan } : {}),
          paidThrough,
          graceUntil,
        };
        await scoped.applySubscriptionSnapshot({
          ...next,
          ...(capturedPurchaseId ? { purchaseId: capturedPurchaseId } : {}),
        });
        for (const transaction of transactions) await scoped.recordStripeTransaction(transaction);
        const changed =
          prior.status !== next.status ||
          prior.licenseQuantity !== next.licenseQuantity ||
          prior.paidThrough?.getTime() !== next.paidThrough?.getTime();
        if (changed && (await scoped.getIntegrationConnection("hubspot"))?.status === "connected") {
          const organization = (await scoped.listAllOrganizations()).find(
            (candidate) => candidate.id === organizationId,
          );
          if (organization)
            await scoped.enqueueIntegrationJob({
              integration: "hubspot",
              organizationId,
              eventType: "crm.organization.upsert",
              deduplicationKey: `subscription-snapshot:${subscription.id}:${randomUUID()}`,
              payload: {
                organizationId,
                name: organization.name,
                designatedContacts: [],
                commercialStatus: next.status,
                ...(next.licenseUnit === "user"
                  ? {}
                  : { licensedWorkspaces: next.licenseQuantity }),
              },
            });
        }
      });
    });
  }
}
