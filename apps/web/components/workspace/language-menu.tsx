"use client";

import type { SupportedLocale } from "@openround/contracts";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { apiFetch } from "../../lib/api";
import { localeOptions } from "../../lib/i18n/config";
import { useLocale } from "../locale-provider";
import styles from "./language-menu.module.css";

function LanguageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}

export function LanguageMenu() {
  const { locale, changing, loadError, setLocale, t } = useLocale();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = localeOptions.find((option) => option.value === locale) ?? localeOptions[0]!;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  async function select(nextLocale: SupportedLocale, close = false) {
    if ((nextLocale === locale && !loadError) || savingRef.current) {
      if (close && detailsRef.current) detailsRef.current.open = false;
      if (close) triggerRef.current?.focus();
      return;
    }
    const previousLocale = locale;
    setError("");
    savingRef.current = true;
    setSaving(true);
    let localeApplied = false;
    try {
      await setLocale(nextLocale);
      localeApplied = true;
      await apiFetch("/v1/account/locale", {
        method: "PUT",
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (close && detailsRef.current) detailsRef.current.open = false;
    } catch {
      if (localeApplied) {
        try {
          await setLocale(previousLocale);
        } catch {
          // The provider caches every active catalog, so this is defensive only. Keep the
          // persistence error visible even if restoring the catalog unexpectedly fails.
        }
        setError(t("locale.saveError"));
      } else {
        setError(t("locale.loadError"));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (close) triggerRef.current?.focus();
    }
  }

  function moveSelection(event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (savingRef.current) {
      if (["ArrowDown", "ArrowRight", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
      }
      return;
    }
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % localeOptions.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + localeOptions.length) % localeOptions.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = localeOptions.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = localeOptions[nextIndex];
    if (!next) return;
    void select(next.value);
    optionRefs.current[nextIndex]?.focus();
  }

  function closeOnEscape(event: ReactKeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !detailsRef.current?.open) return;
    event.preventDefault();
    detailsRef.current.open = false;
    triggerRef.current?.focus();
  }

  return (
    <>
      <details className={styles.menu} onKeyDown={closeOnEscape} ref={detailsRef}>
        <summary
          aria-label={`${selected.shortLabel}: ${t("locale.trigger", { language: selected.nativeLabel })}`}
          className={styles.trigger}
          ref={triggerRef}
          role="button"
          title={t("locale.trigger", { language: selected.nativeLabel })}
        >
          <LanguageIcon />
          <span aria-hidden="true">{selected.shortLabel}</span>
        </summary>
        <div className={styles.panel}>
          <p className={styles.label}>{t("locale.label")}</p>
          <div aria-label={t("locale.selectLabel")} className={styles.options} role="radiogroup">
            {localeOptions.map((option, index) => (
              <button
                aria-checked={locale === option.value}
                className={styles.option}
                disabled={saving || changing}
                key={option.value}
                lang={option.value}
                onClick={() => void select(option.value, true)}
                onKeyDown={(event) => moveSelection(event, index)}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="radio"
                tabIndex={locale === option.value ? 0 : -1}
                type="button"
              >
                <span className={styles.code}>{option.shortLabel}</span>
                <span className={styles.optionLabel}>
                  <span>{option.nativeLabel}</span>
                  {option.previewLabel ? <small>{option.previewLabel}</small> : null}
                </span>
                <span aria-hidden="true" className={styles.check}>
                  {locale === option.value ? "✓" : ""}
                </span>
              </button>
            ))}
          </div>
          {saving || changing ? (
            <p aria-live="polite" className={styles.status}>
              {t("locale.saving")}
            </p>
          ) : null}
          {loadError ? (
            <p aria-live="polite" className={styles.status}>
              {t("locale.loadError")}
            </p>
          ) : null}
          {error ? (
            <p className={styles.status} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </details>
    </>
  );
}
