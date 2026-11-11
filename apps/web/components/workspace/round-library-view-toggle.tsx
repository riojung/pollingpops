"use client";

import type { RoundLibraryView } from "../../lib/round-library-view";
import { useLocale } from "../locale-provider";
import styles from "./workspace-content.module.css";

export function RoundLibraryViewToggle({
  value,
  onChange,
}: {
  value: RoundLibraryView;
  onChange: (view: RoundLibraryView) => void;
}) {
  const { t } = useLocale();
  return (
    <div aria-label={t("pages.library.roundView")} className={styles.viewToggle} role="group">
      <button
        aria-label={t("pages.library.gridView")}
        aria-pressed={value === "grid"}
        onClick={() => onChange("grid")}
        type="button"
      >
        {t("pages.library.gridView")}
      </button>
      <button
        aria-label={t("pages.library.listView")}
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
        type="button"
      >
        {t("pages.library.listView")}
      </button>
    </div>
  );
}
