import type { PlatformRepository } from "@openround/db";
import { parseCatalog } from "@openround/control-plane";
import type { AppConfig } from "./config.js";
import { entitlementsFor } from "./entitlements.js";

export async function bootstrapPlatformCatalog(platform: PlatformRepository, config: AppConfig) {
  const configured = parseCatalog(config.BUSINESS_CATALOG_JSON);
  return platform.withTransaction(async (scoped) => {
    for (const stored of await scoped.listOffers(true)) {
      if (!configured.some((offer) => offer.id === stored.id) && stored.status !== "archived") {
        await scoped.saveOffer({ ...stored, status: "archived", updatedAt: new Date() });
      }
    }
    for (const offer of configured) {
      const previous = await scoped.getOffer(offer.id);
      if (previous && previous.version > offer.version) continue;
      if (
        previous &&
        previous.version === offer.version &&
        (previous.stripePriceId !== (offer.stripePriceId ?? null) ||
          previous.currency !== (offer.currency ?? null) ||
          previous.amountMinor !== (offer.unitAmount ?? null) ||
          previous.creditQuantity !== (offer.creditsPerUnit ?? 0) ||
          previous.interval !== (offer.interval ?? null) ||
          previous.kind !==
            (offer.kind === "event_credit_pack" ? "credit_pack" : "workspace_subscription"))
      ) {
        throw new Error(
          `Catalog offer ${offer.id} requires a new version for price or fulfillment changes`,
        );
      }
      const now = new Date();
      await scoped.saveOffer({
        id: offer.id,
        name: offer.title,
        productKey: "pollingpops",
        kind: offer.kind === "event_credit_pack" ? "credit_pack" : "workspace_subscription",
        status: offer.published ? "published" : "draft",
        version: offer.version,
        stripePriceId: offer.stripePriceId ?? null,
        currency: offer.currency ?? null,
        amountMinor: offer.unitAmount ?? null,
        interval: offer.interval ?? null,
        creditQuantity: offer.creditsPerUnit ?? 0,
        entitlements: entitlementsFor("pro", config),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
    }
  });
}
