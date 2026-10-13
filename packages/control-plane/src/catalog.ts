import { z } from "zod";

/** Prices are operator configuration. An empty catalog deliberately cannot sell anything. */
export const CatalogOfferSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    kind: z.enum(["workspace_subscription", "event_credit_pack"]),
    published: z.boolean().default(false),
    stripePriceId: z
      .string()
      .regex(/^price_[A-Za-z0-9]+$/)
      .optional(),
    currency: z
      .string()
      .regex(/^[a-z]{3}$/)
      .optional(),
    unitAmount: z.number().int().nonnegative().optional(),
    interval: z.enum(["month", "year"]).optional(),
    creditsPerUnit: z.number().int().min(1).max(100_000).optional(),
  })
  .strict()
  .superRefine((offer, context) => {
    if (
      offer.published &&
      (!offer.stripePriceId || !offer.currency || offer.unitAmount === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Published offers require a price, currency, and amount",
      });
    }
    if (offer.kind === "workspace_subscription" && !offer.interval) {
      context.addIssue({
        code: "custom",
        path: ["interval"],
        message: "Subscriptions require an interval",
      });
    }
    if (offer.kind === "event_credit_pack" && !offer.creditsPerUnit) {
      context.addIssue({
        code: "custom",
        path: ["creditsPerUnit"],
        message: "Credit packs require a credit quantity",
      });
    }
    if (offer.kind === "workspace_subscription" && offer.creditsPerUnit !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Subscription offers cannot grant event credits",
      });
    }
    if (offer.kind === "event_credit_pack" && offer.interval !== undefined) {
      context.addIssue({ code: "custom", message: "Credit packs are one-time purchases" });
    }
  });

export type CatalogOffer = z.infer<typeof CatalogOfferSchema>;
export type PublicCatalogOffer = Omit<CatalogOffer, "stripePriceId">;

const CatalogSchema = z
  .array(CatalogOfferSchema)
  .max(100)
  .superRefine((offers, context) => {
    if (new Set(offers.map((offer) => offer.id)).size !== offers.length) {
      context.addIssue({ code: "custom", message: "Catalog offer IDs must be unique" });
    }
    const prices = offers.map((offer) => offer.stripePriceId).filter(Boolean);
    if (new Set(prices).size !== prices.length) {
      context.addIssue({
        code: "custom",
        message: "Each price must identify exactly one catalog offer",
      });
    }
  });

export function parseCatalog(source = "[]"): CatalogOffer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("BUSINESS_CATALOG_JSON must be valid JSON");
  }
  return CatalogSchema.parse(parsed);
}

export function publicCatalog(offers: readonly CatalogOffer[]): PublicCatalogOffer[] {
  return offers
    .filter((offer) => offer.published)
    .map(({ stripePriceId: _priceId, ...offer }) => offer);
}

export function requirePublishedOffer(
  offers: readonly CatalogOffer[],
  id: string,
  version: number,
): CatalogOffer {
  const offer = offers.find(
    (candidate) => candidate.id === id && candidate.version === version && candidate.published,
  );
  if (!offer)
    throw new Error("This offer is no longer available. Refresh the catalog and try again.");
  return offer;
}
