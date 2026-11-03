"use client";

import type { RefObject } from "react";
import { useLocale } from "../locale-provider";
import type { BoardLibraryScope } from "./use-board-library";
import styles from "./board-library-toolbar.module.css";

export interface BoardLibraryToolbarProps {
  scope: BoardLibraryScope;
  search: string;
  onScopeChange: (scope: BoardLibraryScope) => void;
  onSearchChange: (search: string) => void;
  disabled?: boolean;
  canCreate: boolean;
  onCreate: () => void;
  createButtonRef?: RefObject<HTMLButtonElement | null>;
}
export function BoardLibraryToolbar({
  scope,
  search,
  onScopeChange,
  onSearchChange,
  disabled = false,
  canCreate,
  onCreate,
  createButtonRef,
}: BoardLibraryToolbarProps) {
  const { t } = useLocale();
  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t("boards.title")}>
      <div className={styles.scopes} role="group" aria-label={t("boards.title")}>
        {(["all", "owned", "shared", "archived"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={scope === value}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onScopeChange(value);
            }}
          >
            {t(`canvas.${value}`)}
          </button>
        ))}
      </div>
      <form
        className={styles.search}
        role="search"
        aria-label={t("canvas.search")}
        onSubmit={(event) => event.preventDefault()}
      >
        <label className={styles.searchField}>
          <span className={styles.srOnly}>{t("canvas.search")}</span>
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <input
            type="search"
            maxLength={160}
            value={search}
            placeholder={t("canvas.search")}
            disabled={disabled}
            onChange={(event) => {
              if (!disabled) onSearchChange(event.target.value);
            }}
          />
        </label>
      </form>
      {canCreate ? (
        <button
          ref={createButtonRef}
          type="button"
          className={styles.create}
          disabled={disabled}
          onClick={(event) => {
            if (disabled) return;
            // Pointer activation in Safari needs an explicit, stable dialog return target.
            event.currentTarget.focus();
            onCreate();
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{t("canvas.create")}</span>
        </button>
      ) : null}
    </div>
  );
}
