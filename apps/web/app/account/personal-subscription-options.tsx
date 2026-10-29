"use client";

import { useEffect, useState } from "react";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import {
  formatPersonalOfferPrice,
  personalCheckoutOfferId,
  personalSubscriptionOffers,
  selectedPersonalOffer,
  type PersonalSubscriptionCatalog,
} from "./personal-subscription-model";
import styles from "./account.module.css";

interface ChoicesProps {
  catalog: PersonalSubscriptionCatalog;
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onCheckout: (offerId: string) => void;
}

export function PersonalSubscriptionChoices({
  catalog,
  selectedId,
  busy,
  onSelect,
  onCheckout,
}: ChoicesProps) {
  const { locale, t } = useLocale();
  const offers = personalSubscriptionOffers(catalog);
  const selected = selectedPersonalOffer(catalog, selectedId);
  const checkoutOfferId = personalCheckoutOfferId(catalog, selectedId, locale);
  return (
    <div className={styles.subscriptionChoices}>
      <label className="field">
        <span>{t("customer.billing.offer")}</span>
        <select
          className="select"
          value={selected?.id ?? ""}
          disabled={busy || !offers.length}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="" disabled>
            {t("customer.billing.choose")}
          </option>
          {offers.map((offer) => {
            const price = formatPersonalOfferPrice(offer, locale);
            return (
              <option key={offer.id} value={offer.id} disabled={!price}>
                {offer.name}
                {" · "}
                {price && offer.interval
                  ? t("customer.billing.priceInterval", {
                      price,
                      interval: t(`customer.billing.interval.${offer.interval}`),
                    })
                  : t("customer.billing.priceUnavailable")}
              </option>
            );
          })}
        </select>
      </label>
      {!offers.length ? <p className="notice">{t("customer.billing.empty")}</p> : null}
      {!catalog.checkoutEnabled ? (
        <p className="notice">{t("customer.billing.unavailable")}</p>
      ) : null}
      <button
        className="button"
        type="button"
        disabled={busy || !checkoutOfferId}
        onClick={() => checkoutOfferId && onCheckout(checkoutOfferId)}
      >
        {busy ? t("account.subscription.openingPortal") : t("workspace.explorePro")}
      </button>
    </div>
  );
}

export function PersonalSubscriptionOptions({
  busy,
  onCheckout,
}: Pick<ChoicesProps, "busy" | "onCheckout">) {
  const { t } = useLocale();
  const [catalog, setCatalog] = useState<PersonalSubscriptionCatalog | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void apiFetch<PersonalSubscriptionCatalog>("/v1/billing/catalog")
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((caught) => {
        if (active) setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (error)
    return (
      <div>
        <p className="notice" role="alert">
          {error}
        </p>
        <button
          className="button-quiet"
          type="button"
          onClick={() => {
            setError("");
            setCatalog(null);
            setAttempt((current) => current + 1);
          }}
        >
          {t("customer.billing.retry")}
        </button>
      </div>
    );
  if (!catalog) return <p role="status">{t("customer.billing.loading")}</p>;
  return (
    <PersonalSubscriptionChoices
      catalog={catalog}
      selectedId={selectedId}
      busy={busy}
      onSelect={setSelectedId}
      onCheckout={onCheckout}
    />
  );
}
