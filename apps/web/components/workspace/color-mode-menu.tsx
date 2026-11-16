"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  applyColorModePreference,
  COLOR_MODE_APPLIED_EVENT,
  getColorModePreference,
  resolveColorMode,
  type ColorModeAppliedDetail,
  type ColorModePreference,
  type ResolvedColorMode,
} from "../../lib/color-mode";
import { appearanceMessages } from "../../lib/i18n/appearance-messages";
import type { MessageKey } from "../../lib/i18n/catalog";
import { useLocale } from "../locale-provider";
import styles from "./color-mode-menu.module.css";

const options: Array<{ value: ColorModePreference; label: MessageKey }> = [
  { value: "system", label: "appearance.system" },
  { value: "light", label: "appearance.light" },
  { value: "dark", label: "appearance.dark" },
];

function ModeIcon({ mode }: { mode: ColorModePreference | ResolvedColorMode }) {
  if (mode === "dark") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M20 15.2A8.6 8.6 0 0 1 8.8 4a8.7 8.7 0 1 0 11.2 11.2Z" />
      </svg>
    );
  }
  if (mode === "light") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="13" rx="2" width="18" x="3" y="4" />
      <path d="M8 20h8M12 17v3" />
    </svg>
  );
}

export function ColorModeMenu() {
  const { locale, t } = useLocale();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLElement>(null);
  const [preference, setPreference] = useState<ColorModePreference>("system");
  const [resolved, setResolved] = useState<ResolvedColorMode>("light");
  const preferenceLabel = t(
    options.find((option) => option.value === preference)?.label ?? "appearance.system",
  );

  useLayoutEffect(() => {
    const current = getColorModePreference();
    setPreference(current);
    setResolved(
      resolveColorMode(current, window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
  }, []);

  useEffect(() => {
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<ColorModeAppliedDetail>).detail;
      if (!detail) return;
      setPreference(detail.preference);
      setResolved(detail.resolved);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    };

    window.addEventListener(COLOR_MODE_APPLIED_EVENT, onApplied);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener(COLOR_MODE_APPLIED_EVENT, onApplied);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  function select(next: ColorModePreference) {
    setPreference(next);
    setResolved(applyColorModePreference(next));
  }

  function choose(next: ColorModePreference) {
    select(next);
    if (detailsRef.current) detailsRef.current.open = false;
    triggerRef.current?.focus();
  }

  function moveSelection(event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % options.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + options.length) % options.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = options.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const next = options[nextIndex];
    if (!next) return;
    select(next.value);
    optionRefs.current[nextIndex]?.focus();
  }

  function closeOnEscape(event: ReactKeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !detailsRef.current?.open) return;
    event.preventDefault();
    detailsRef.current.open = false;
    triggerRef.current?.focus();
  }

  return (
    <details className={styles.menu} onKeyDown={closeOnEscape} ref={detailsRef}>
      <summary
        aria-label={t("appearance.trigger", { mode: preferenceLabel })}
        className={styles.trigger}
        ref={triggerRef}
        role="button"
        title={t("appearance.trigger", { mode: preferenceLabel })}
      >
        <ModeIcon mode={resolved} />
      </summary>
      <div className={styles.panel}>
        <p className={styles.label}>{t("appearance.label")}</p>
        <div aria-label={t("appearance.groupLabel")} className={styles.options} role="radiogroup">
          {options.map((option, index) => (
            <button
              aria-checked={preference === option.value}
              className={styles.option}
              key={option.value}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => moveSelection(event, index)}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="radio"
              tabIndex={preference === option.value ? 0 : -1}
              type="button"
            >
              <ModeIcon mode={option.value} />
              <span>{t(option.label)}</span>
              <span aria-hidden="true" className={styles.check}>
                {preference === option.value ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
        <a className={styles.galleryLink} href="/account#appearance">
          {appearanceMessages(locale).openGallery}
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </details>
  );
}
