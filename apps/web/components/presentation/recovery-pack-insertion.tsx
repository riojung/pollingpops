"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  type RecoveryPackContent,
  type RecoveryPackInsertion,
  type SupportedLocale,
} from "@openround/contracts";
import { packInsertionCopy, packInsertionFeedback } from "../../lib/i18n/pack-insertion-copy";
import { apiFetch, humanError } from "../../lib/api";
import styles from "./recovery-pack-insertion.module.css";

interface PublishedPack {
  id: string;
  title: string;
  currentVersionId: string | null;
}
interface PackVersion {
  id: string;
  version: number;
  content: RecoveryPackContent;
}

export function RecoveryPackPresentationReferences({
  insertions,
  locale = "en-CA",
}: {
  locale?: SupportedLocale;
  insertions: readonly RecoveryPackInsertion[];
}) {
  const copy = packInsertionCopy(locale);
  if (!insertions.length) return null;
  return (
    <section
      aria-label={copy("Recovery Pack facilitator references")}
      className={styles.references}
      lang={locale}
    >
      {insertions.map((insertion) => {
        const content = insertion.updateBaseline?.content ?? insertion.originalContent;
        return (
          <details key={insertion.id}>
            <summary>
              {copy("Recovery Pack references:")} <span lang="">{content.title}</span> ·{" "}
              {copy("version {version}", {
                version: insertion.updateBaseline?.packVersion ?? insertion.packVersion,
              })}
            </summary>
            <p>
              {copy(
                "Frozen facilitator references from the accepted source baseline, initially copied at insertion. Checkpoint edits and source Pack changes do not update these cards until you accept an update.",
              )}{" "}
              {copy(
                "Live explanation or worked-example playback is available in eligible new {artifact} sessions when enabled for the workspace. The facilitator explicitly selects a card after revealing the Pack diagnostic.",
                { artifact: copy("Presentation") },
              )}
            </p>
            {content.interventions.map((card) => (
              <section key={card.id}>
                <h2 lang="">{card.title}</h2>
                <p className={styles.plaintext} lang="">
                  {card.body}
                </p>
                {card.citations.length ? (
                  <ul aria-label={copy("Card citations")}>
                    {card.citations.map((citation, index) => (
                      <li key={index} lang="">
                        {citation.sourceName}, {citation.locator}
                        {citation.excerpt ? ` — ${citation.excerpt}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
            {content.citations.length ? (
              <ul aria-label={copy("Pack citations")}>
                {content.citations.map((citation, index) => (
                  <li key={index} lang="">
                    {citation.sourceName}, {citation.locator}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/recovery-packs">{copy("Open Recovery Pack library")}</Link>
          </details>
        );
      })}
    </section>
  );
}

export function RecoveryPackPresentationPicker({
  busy,
  locale = "en-CA",
  error,
  retryVersionId,
  afterSelectedBlock,
  onInsert,
  onClose,
}: {
  busy: boolean;
  locale?: SupportedLocale;
  error: string;
  retryVersionId: string | null;
  afterSelectedBlock: boolean;
  onInsert: (versionId: string) => void;
  onClose: () => void;
}) {
  const copy = packInsertionCopy(locale);
  const [packs, setPacks] = useState<PublishedPack[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [version, setVersion] = useState<PackVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const feedback = packInsertionFeedback(locale, error || loadError);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    void apiFetch<{ packs: PublishedPack[] }>("/v1/recovery-packs", { signal: abort.signal })
      .then(({ packs: records }) => {
        if (abort.signal.aborted) return;
        const published = records.filter((pack) => pack.currentVersionId);
        setPacks(published);
        setSelectedId(published[0]?.id ?? "");
      })
      .catch((caught) => {
        if (!abort.signal.aborted) setLoadError(humanError(caught));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    setVersion(null);
    const id = packs.find((pack) => pack.id === selectedId)?.currentVersionId;
    if (!id) return;
    const abort = new AbortController();
    setLoadError("");
    void apiFetch<{ version: PackVersion }>(
      `/v1/recovery-packs/versions/${encodeURIComponent(id)}`,
      { signal: abort.signal },
    )
      .then(({ version: published }) => {
        if (!abort.signal.aborted && published.id === id) setVersion(published);
      })
      .catch((caught) => {
        if (!abort.signal.aborted) setLoadError(humanError(caught));
      });
    return () => abort.abort();
  }, [packs, selectedId]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy && !retryVersionId) {
      event.preventDefault();
      onClose();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex="0"]',
      ),
    ).filter((control) => control.offsetParent !== null);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      event.currentTarget.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        aria-labelledby="pack-presentation-insert-title"
        aria-modal="true"
        className={styles.dialog}
        lang={locale}
        onKeyDown={trapFocus}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id="pack-presentation-insert-title">{copy("Insert a published Recovery Pack")}</h2>
        <p>
          {copy(
            "Copy its diagnostic and linked recheck {position}, with frozen facilitator cards and citations. The checkpoints remain editable copies. Cards are not audience slides.",
            { position: copy(afterSelectedBlock ? "after the selected block" : "at the end") },
          )}{" "}
          {copy(
            "Live explanation or worked-example playback is available in eligible new {artifact} sessions when enabled for the workspace. The facilitator explicitly selects a card after revealing the Pack diagnostic.",
            { artifact: copy("Presentation") },
          )}
        </p>
        {loading ? <p role="status">{copy("Loading published Packs…")}</p> : null}
        {!loading && !packs.length && !loadError ? (
          <p>
            {copy(
              "No published Recovery Packs are available. Publish a Pack in the library first.",
            )}
          </p>
        ) : null}
        {packs.length ? (
          <label className={styles.field}>
            <span>{copy("Published Recovery Pack")}</span>
            <select
              disabled={busy || Boolean(retryVersionId)}
              onChange={(event) => setSelectedId(event.target.value)}
              value={selectedId}
            >
              {packs.map((pack) => (
                <option key={pack.id} lang="" value={pack.id}>
                  {pack.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {version ? (
          <section aria-label={copy("Published Pack preview")} className={styles.preview}>
            <h3>
              <span lang="">{version.content.title}</span> ·{" "}
              {copy("version {version}", { version: version.version })}
            </h3>
            <p lang="">{version.content.description}</p>
            <dl>
              <dt>{copy("Diagnostic")}</dt>
              <dd lang="">{version.content.diagnostic.prompt}</dd>
              <dt>{copy("Linked recheck")}</dt>
              <dd lang="">{version.content.recheck.prompt}</dd>
            </dl>
            <p>
              {copy("{count} facilitator cards copied as references.", {
                count: version.content.interventions.length,
              })}
            </p>
          </section>
        ) : null}
        {error || loadError ? (
          <p role="alert" lang={feedback.lang}>
            {feedback.text}
          </p>
        ) : null}
        {retryVersionId ? (
          <p role="status">
            {copy(
              "The insertion was not acknowledged. Retry the same operation to recover its result without creating another copy. Editing stays paused until it is acknowledged.",
            )}
          </p>
        ) : null}
        {busy ? <p role="status">{copy("Saving and inserting…")}</p> : null}
        <div className={styles.actions}>
          <button
            disabled={busy || (!retryVersionId && (!version || Boolean(loadError)))}
            onClick={() => {
              const id = retryVersionId ?? version?.id;
              if (id) onInsert(id);
            }}
            type="button"
          >
            {copy(retryVersionId ? "Retry Pack insertion" : "Insert Pack checkpoints")}
          </button>
          <button disabled={busy || Boolean(retryVersionId)} onClick={onClose} type="button">
            {copy("Cancel")}
          </button>
          {!retryVersionId && !busy ? (
            <Link href="/recovery-packs">{copy("Open Recovery Pack library")}</Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
