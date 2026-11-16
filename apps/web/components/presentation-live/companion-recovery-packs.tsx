"use client";

import { useId, useState } from "react";
import type { RecoveryPackCardReference, RecoveryPackCardSelection } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import type { CompanionRecoveryPackCatalog } from "../../lib/presentation-companion-recovery-packs";
import { localizeCompanionError } from "../../lib/i18n/domains/live-delivery/companion-translations";
import { formatNumber } from "../../lib/i18n/format";
import styles from "./companion.module.css";

export function CompanionRecoveryPackPicker({
  catalog,
  loading,
  error,
  disabled,
  onReload,
  onInsert,
}: {
  catalog: CompanionRecoveryPackCatalog | null;
  loading: boolean;
  error: string;
  disabled: boolean;
  onReload: () => void;
  onInsert: (packVersionId: string) => void;
}) {
  const { locale, t } = useLocale();
  const displayError = localizeCompanionError(locale, error);
  const labelId = useId();
  const [selectedId, setSelectedId] = useState("");
  const selected = catalog?.packs.find((pack) => pack.packVersionId === selectedId);
  return (
    <section
      className={styles.packPicker}
      lang={locale}
      aria-label={t("live.companion.packs.pickerTitle")}
    >
      <p className="muted">{t("live.companion.packs.textOnly")}</p>
      {loading ? <p role="status">{t("live.companion.packs.loading")}</p> : null}
      {error ? (
        <p className="error" role="alert" lang={displayError.language}>
          {displayError.text}
        </p>
      ) : null}
      {!loading && catalog?.packs.length === 0 ? (
        <p role="status">{t("live.companion.packs.empty")}</p>
      ) : null}
      <label className="field">
        <span id={labelId}>{t("live.companion.packs.publishedPack")}</span>
        <select
          aria-labelledby={labelId}
          className="select"
          disabled={disabled || loading || !catalog?.packs.length}
          onChange={(event) => setSelectedId(event.target.value)}
          value={selected?.packVersionId ?? ""}
        >
          <option value="">{t("live.companion.packs.choosePack")}</option>
          {catalog?.packs.map((pack) => (
            <option key={pack.packVersionId} value={pack.packVersionId} lang="">
              {pack.title} ·{" "}
              {t("live.companion.packs.version", {
                version: formatNumber(locale, pack.packVersion),
              })}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button full-width"
        disabled={disabled || loading || !selected}
        onClick={() => {
          if (selected && !disabled && !loading) onInsert(selected.packVersionId);
        }}
        type="button"
      >
        {t("live.companion.packs.insert")}
      </button>
      {disabled ? (
        <p className="muted" role="status">
          {t("live.companion.packs.boundary")}
        </p>
      ) : null}
      {!loading && error ? (
        <button
          className="button-quiet full-width"
          disabled={disabled}
          onClick={onReload}
          type="button"
        >
          {t("live.companion.packs.reload")}
        </button>
      ) : null}
    </section>
  );
}

/** A companion chooses by title; unpublished bodies and citations never enter this picker. */
export function CompanionRecoveryCardPicker({
  cards,
  disabled,
  onStart,
}: {
  cards: Array<{ reference: RecoveryPackCardReference; title: string }>;
  disabled: boolean;
  onStart: (selection: RecoveryPackCardSelection, interventionType: "explain" | "example") => void;
}) {
  const { locale, t } = useLocale();
  const labelId = useId();
  const [selectedKey, setSelectedKey] = useState("");
  const cardKey = (card: (typeof cards)[number]) =>
    `${card.reference.insertionId}:${card.reference.cardId}`;
  const selected = cards.find((card) => cardKey(card) === selectedKey);
  if (!cards.length) return null;
  const start = (interventionType: "explain" | "example") => {
    if (!selected || disabled) return;
    onStart(
      { insertionId: selected.reference.insertionId, cardId: selected.reference.cardId },
      interventionType,
    );
  };
  return (
    <section
      className={styles.packPicker}
      lang={locale}
      aria-label={t("live.companion.packs.cardActions")}
    >
      <h3>{t("live.companion.packs.useCard")}</h3>
      <p className="muted">{t("live.companion.packs.cardDescription")}</p>
      <label className="field">
        <span id={labelId}>{t("live.companion.packs.card")}</span>
        <select
          aria-labelledby={labelId}
          className="select"
          disabled={disabled}
          onChange={(event) => setSelectedKey(event.target.value)}
          value={selected ? selectedKey : ""}
        >
          <option value="">{t("live.companion.packs.chooseCard")}</option>
          {cards.map((card, index) => (
            <option key={cardKey(card)} value={cardKey(card)} lang="">
              {formatNumber(locale, index + 1)}. {card.title} ·{" "}
              {t("live.companion.packs.version", {
                version: formatNumber(locale, card.reference.packVersion),
              })}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.secondary}>
        <button
          className="button-quiet"
          disabled={disabled || !selected}
          onClick={() => start("explain")}
          type="button"
        >
          {t("live.companion.packs.explain")}
        </button>
        <button
          className="button-quiet"
          disabled={disabled || !selected}
          onClick={() => start("example")}
          type="button"
        >
          {t("live.companion.packs.example")}
        </button>
      </div>
    </section>
  );
}
