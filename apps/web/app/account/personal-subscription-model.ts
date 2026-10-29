import type { SupportedLocale } from "@openround/contracts";

export interface PersonalSubscriptionOffer {
  id: string;
  name: string;
  kind: "workspace_subscription" | "credit_pack";
  licenseUnit?: "workspace" | "user";
  currency: string | null;
  amountMinor: number | null;
  interval: "month" | "year" | null;
}

export interface PersonalSubscriptionCatalog {
  offers: PersonalSubscriptionOffer[];
  checkoutEnabled: boolean;
}

export function personalSubscriptionOffers(catalog: PersonalSubscriptionCatalog) {
  return catalog.offers.filter(
    (offer) =>
      offer.kind === "workspace_subscription" && (offer.licenseUnit ?? "workspace") === "workspace",
  );
}

export function formatPersonalOfferPrice(
  offer: PersonalSubscriptionOffer,
  locale: SupportedLocale,
) {
  if (
    !offer.currency ||
    offer.amountMinor === null ||
    !Number.isSafeInteger(offer.amountMinor) ||
    offer.amountMinor < 0 ||
    !offer.interval
  )
    return null;
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: offer.currency,
    });
    const minorDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(offer.amountMinor / 10 ** minorDigits);
  } catch {
    return null;
  }
}

export function selectedPersonalOffer(catalog: PersonalSubscriptionCatalog, selectedId: string) {
  const offers = personalSubscriptionOffers(catalog);
  return (
    offers.find((offer) => offer.id === selectedId) ?? (offers.length === 1 ? offers[0] : null)
  );
}

export function personalCheckoutOfferId(
  catalog: PersonalSubscriptionCatalog,
  selectedId: string,
  locale: SupportedLocale,
) {
  const offer = selectedPersonalOffer(catalog, selectedId);
  return catalog.checkoutEnabled && offer && formatPersonalOfferPrice(offer, locale)
    ? offer.id
    : null;
}
