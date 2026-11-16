"use client";

import { useEffect, useState } from "react";
import { unlockSoundCues } from "../lib/sound";
import { useLocale } from "./locale-provider";
import styles from "./experience-preferences.module.css";

type Preferences = { highContrast: boolean; reducedMotion: boolean; muted: boolean };

const defaults: Preferences = { highContrast: false, reducedMotion: false, muted: true };

export function ExperiencePreferences() {
  const { t } = useLocale();
  const [preferences, setPreferences] = useState(defaults);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("openround:experience-preferences") ?? "null");
      if (saved && typeof saved === "object") setPreferences({ ...defaults, ...saved });
    } catch {
      setPreferences(defaults);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.openroundContrast = preferences.highContrast
      ? "high"
      : "theme";
    document.documentElement.dataset.openroundMotion = preferences.reducedMotion
      ? "reduced"
      : "theme";
    document.documentElement.dataset.openroundMuted = preferences.muted ? "true" : "false";
    localStorage.setItem("openround:experience-preferences", JSON.stringify(preferences));
  }, [preferences]);

  function update(update: Partial<Preferences>) {
    setPreferences((current) => ({ ...current, ...update }));
  }

  return (
    <details className={`experience-preferences ${styles.preferences}`}>
      <summary className={styles.trigger}>
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
  );
}
