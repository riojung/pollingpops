"use client";

import { useId, useState } from "react";
import type { RecoveryPackCardSelection, RecoveryPackLiveCard } from "@openround/contracts";
import styles from "./recovery-pack-live-card.module.css";

export function recoveryPackCardKey(card: RecoveryPackLiveCard) {
  return `${card.reference.insertionId}:${card.reference.cardId}`;
}

export function RecoveryPackLiveCardView({
  card,
  preview = false,
  labels,
}: {
  card: RecoveryPackLiveCard;
  preview?: boolean;
  /** Optional delivery chrome; authored card material remains unchanged. */
  labels?: { language: string; regionName: string; attribution: string; sources: string };
}) {
  const Heading = preview ? "h4" : "h2";
  return (
    <section
      aria-label={
        labels?.regionName ??
        (preview ? "Recovery Pack card preview (host only)" : "Active Recovery Pack card")
      }
      className={styles.card}
    >
      <p className="eyebrow" lang={labels?.language ?? "en-CA"}>
        {labels?.attribution ?? (
          <>
            {preview ? "Host-only preview" : "Recovery Pack card"} · version{" "}
            {card.reference.packVersion}
          </>
        )}
      </p>
      <Heading lang="">{card.title}</Heading>
      <p className={styles.body} lang="">
        {card.body}
      </p>
      {card.citations.length ? (
        <div className={styles.citations}>
          <strong lang={labels?.language ?? "en-CA"}>{labels?.sources ?? "Sources"}</strong>
          <ul>
            {card.citations.map((citation, index) => (
              <li key={index}>
                <span lang="">
                  {citation.sourceName} · {citation.locator}
                </span>
                {citation.excerpt ? <blockquote lang="">{citation.excerpt}</blockquote> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function RecoveryPackCardPicker({
  cards,
  disabled,
  onStart,
}: {
  cards: RecoveryPackLiveCard[];
  disabled: boolean;
  onStart: (selection: RecoveryPackCardSelection, interventionType: "explain" | "example") => void;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const labelId = useId();
  const selected = cards.find((card) => recoveryPackCardKey(card) === selectedKey);
  if (!cards.length) return null;
  const start = (interventionType: "explain" | "example") => {
    if (disabled || !selected) return;
    onStart(
      { insertionId: selected.reference.insertionId, cardId: selected.reference.cardId },
      interventionType,
    );
  };
  return (
    <section className={styles.picker} aria-label="Recovery Pack card actions" lang="en-CA">
      <h3>Use a Recovery Pack card</h3>
      <p className="muted">
        Preview a card for this diagnostic, then choose how to use it. Participants and the
        presenter see only the active card after the server confirms your action.
      </p>
      <label className="field">
        <span id={labelId}>Recovery Pack card</span>
        <select
          aria-labelledby={labelId}
          className="select"
          disabled={disabled}
          onChange={(event) => setSelectedKey(event.target.value)}
          value={selected ? selectedKey : ""}
        >
          <option value="">Choose a card to preview</option>
          {cards.map((card, index) => (
            <option key={recoveryPackCardKey(card)} value={recoveryPackCardKey(card)}>
              {index + 1}. {card.title} · version {card.reference.packVersion}
            </option>
          ))}
        </select>
      </label>
      {selected ? <RecoveryPackLiveCardView card={selected} preview /> : null}
      <div className={styles.actions}>
        <button
          className="button-quiet"
          disabled={disabled || !selected}
          onClick={() => start("explain")}
          type="button"
        >
          Explain with selected card
        </button>
        <button
          className="button-quiet"
          disabled={disabled || !selected}
          onClick={() => start("example")}
          type="button"
        >
          Work an example with selected card
        </button>
      </div>
    </section>
  );
}
