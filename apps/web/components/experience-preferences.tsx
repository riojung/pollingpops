"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EXPERIENCE_PREFERENCES_KEY } from "../lib/experience-motion";
import { getSoundCuesStatus, subscribeSoundCues, unlockSoundCues } from "../lib/sound";
import { useLocale } from "./locale-provider";
import styles from "./experience-preferences.module.css";

type Preferences = { highContrast: boolean; reducedMotion: boolean; muted: boolean };

const defaults: Preferences = { highContrast: false, reducedMotion: false, muted: true };

const soundUnavailable = () => "unavailable" as const;

function PresenterSoundActivation({
  onActivate,
}: {
  onActivate: (button: HTMLButtonElement) => void;
}) {
  const { t } = useLocale();
  const status = useSyncExternalStore(subscribeSoundCues, getSoundCuesStatus, soundUnavailable);
  if (status !== "needs-activation") return null;
  return (
    <button
      className="button-quiet small-button"
      onClick={(event) => onActivate(event.currentTarget)}
      type="button"
    >
      {t("live.preferences.enableSound")}
    </button>
  );
}

export function ExperiencePreferences({
  presenterSound = false,
}: { presenterSound?: boolean } = {}) {
  const { t } = useLocale();
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const trigger = useRef<HTMLElement>(null);

  useEffect(() => {
    function load() {
      try {
        const saved = JSON.parse(localStorage.getItem(EXPERIENCE_PREFERENCES_KEY) ?? "null");
        setPreferences({
          highContrast: saved?.highContrast === true,
          reducedMotion: saved?.reducedMotion === true,
          muted: saved?.muted !== false,
        });
      } catch {
        setPreferences(defaults);
      }
      setReady(true);
    }

    function onStorage(event: StorageEvent) {
      if (
        event.storageArea === window.localStorage &&
        (event.key === null || event.key === EXPERIENCE_PREFERENCES_KEY)
      )
        load();
    }

    window.addEventListener("storage", onStorage);
    load();
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    // Mount effects can replay before their state updates commit in Strict Mode.
    // Keep the saved and pre-hydration DOM choices intact until the read finishes.
    if (!ready) return;
    document.documentElement.dataset.openroundContrast = preferences.highContrast
      ? "high"
      : "theme";
    document.documentElement.dataset.openroundMotion = preferences.reducedMotion
      ? "reduced"
      : "theme";
    document.documentElement.dataset.openroundMuted = preferences.muted ? "true" : "false";
  }, [preferences, ready]);

  function update(update: Partial<Preferences>) {
    const next = { ...preferences, ...update };
    setPreferences(next);
    try {
      localStorage.setItem(EXPERIENCE_PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // Accessibility choices still apply when browser storage is unavailable.
    }
  }

  return (
    <>
      {presenterSound && ready && !preferences.muted ? (
        <PresenterSoundActivation
          onActivate={async (button) => {
            await unlockSoundCues();
            if (
              getSoundCuesStatus() === "ready" &&
              (document.activeElement === button || document.activeElement === document.body)
            )
              trigger.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
      <details className={`experience-preferences ${styles.preferences}`}>
        <summary className={styles.trigger} ref={trigger}>
          <svg
            aria-hidden="true"
            className={styles.icon}
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.7"
            viewBox="0 0 20 20"
          >
            <path d="M3 6h14M3 14h14" />
            <path d="M7 3v6M13 11v6" />
          </svg>
          <span className={styles.label}>{t("live.preferences.summary")}</span>
        </summary>
        <div className={styles.panel}>
          <label className="checkbox-field">
            <input
              checked={preferences.highContrast}
              onChange={(event) => update({ highContrast: event.target.checked })}
              type="checkbox"
            />
            <span>{t("live.preferences.highContrast")}</span>
          </label>
          <label className="checkbox-field">
            <input
              checked={preferences.reducedMotion}
              onChange={(event) => update({ reducedMotion: event.target.checked })}
              type="checkbox"
            />
            <span>{t("live.preferences.reduceMotion")}</span>
          </label>
          <label className="checkbox-field">
            <input
              checked={preferences.muted}
              onChange={(event) => {
                update({ muted: event.target.checked });
                if (!event.target.checked) void unlockSoundCues();
              }}
              type="checkbox"
            />
            <span>{t("live.preferences.muteSound")}</span>
          </label>
        </div>
      </details>
    </>
  );
}
