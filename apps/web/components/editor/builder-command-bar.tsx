"use client";

import Link from "next/link";
import { useRef } from "react";
import type { WorkspaceProductFeatures } from "@openround/contracts";
import { CreatorBrand } from "../brand";
import { useLocale } from "../locale-provider";
import { roundNavigationCopy } from "../../lib/i18n/round-navigation-copy";
import { authoringWorkflowCopy } from "./authoring-workflow-copy";
import { RoundNavigationIcon } from "./round-navigation-icon";
import styles from "./round-navigation.module.css";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export function BuilderCommandBar({
  title,
  status,
  saveState,
  canUndo,
  canRedo,
  previewDisabled,
  publishDisabled,
  publishLabel,
  productFeatures,
  assignHref,
  hostHref,
  hasUnpublishedChanges = false,
  questionMapOpen,
  inspectorOpen,
  disabled = false,
  readOnly = false,
  retrySaveDisabled = false,
  onRetrySave,
  onTitleChange,
  onUndo,
  onRedo,
  onPreview,
  onPublish,
  onToggleQuestionMap,
  onToggleInspector,
}: {
  title: string;
  status?: string;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  previewDisabled: boolean;
  publishDisabled: boolean;
  publishLabel: string;
  productFeatures?: Pick<WorkspaceProductFeatures, "workspaceShell"> | null;
  assignHref?: string;
  hostHref?: string;
  hasUnpublishedChanges?: boolean;
  questionMapOpen: boolean;
  inspectorOpen: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  retrySaveDisabled?: boolean;
  onRetrySave?: () => void;
  onTitleChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onToggleQuestionMap: () => void;
  onToggleInspector: () => void;
}) {
  const { t, locale } = useLocale();
  const copy = authoringWorkflowCopy(locale);
  const navigation = roundNavigationCopy(locale);
  const menu = useRef<HTMLDetailsElement>(null);
  const saveStateLabel =
    saveState === "saving"
      ? t("delivery.common.saving")
      : saveState === "saved"
        ? t("delivery.common.saved")
        : saveState === "error"
          ? t("delivery.builder.saveFailed")
          : saveState === "conflict"
            ? t("delivery.builder.editConflict")
            : t("delivery.builder.ready");
  const mutationDisabled = disabled || readOnly;
  return (
    <header className={styles.commandBar} lang={locale}>
      <div className={styles.commandStart}>
        <span className={styles.brandWrap}>
          <CreatorBrand productFeatures={productFeatures} />
        </span>
        <Link
          className={styles.libraryLink}
          href={productFeatures?.workspaceShell ? "/library?type=rounds" : "/dashboard"}
          aria-label={
            productFeatures?.workspaceShell
              ? t("workspace.nav.library")
              : t("delivery.builder.dashboard")
          }
          title={
            productFeatures?.workspaceShell
              ? t("workspace.nav.library")
              : t("delivery.builder.dashboard")
          }
        >
          <RoundNavigationIcon name="back" />
          <span className={styles.libraryLabel}>
            {productFeatures?.workspaceShell
              ? t("workspace.nav.library")
              : t("delivery.builder.dashboard")}
          </span>
        </Link>
        <button
          id="round-toggle-navigation"
          aria-label={t("delivery.builder.questions")}
          title={t("delivery.builder.questions")}
          className={styles.iconButton}
          disabled={disabled}
          aria-controls="round-question-navigator"
          aria-expanded={questionMapOpen}
          onClick={() => {
            onToggleQuestionMap();
            if (menu.current) menu.current.open = false;
          }}
          type="button"
        >
          <RoundNavigationIcon name="outline" />
        </button>
        <button
          id="round-toggle-tools"
          aria-label={t("delivery.builder.inspector")}
          title={t("delivery.builder.inspector")}
          className={styles.iconButton}
          disabled={disabled}
          aria-expanded={inspectorOpen}
          onClick={() => {
            onToggleInspector();
            if (menu.current) menu.current.open = false;
          }}
          type="button"
        >
          <RoundNavigationIcon name="inspector" />
        </button>
      </div>
      <div className={styles.documentIdentity}>
        <label className="sr-only" htmlFor="quiz-title">
          {t("create.round.blank.titleLabel")}
        </label>
        <input
          aria-invalid={!title.trim()}
          className={styles.titleInput}
          disabled={mutationDisabled}
          id="quiz-title"
          lang={title.trim() ? "" : locale}
          maxLength={160}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={t("delivery.builder.titlePlaceholder")}
          value={title}
        />
        <div className={styles.documentState}>
          <span className={styles.publicationState}>
            {navigation("Round")}
            {status
              ? ` · ${status === "draft" ? copy.draft : status === "published" ? t("delivery.presentationBuilder.published") : status === "archived" ? copy.archived : status}`
              : ""}
          </span>
          {hasUnpublishedChanges ? (
            <span className={styles.unpublished}>{navigation("Unpublished changes")}</span>
          ) : null}
          <span className={styles.saveState} data-state={saveState} role="status">
            <span className={styles.saveDot} aria-hidden="true" />
            {saveStateLabel}
          </span>
          {saveState === "error" && onRetrySave ? (
            <button
              className={styles.textButton}
              disabled={mutationDisabled || retrySaveDisabled}
              onClick={onRetrySave}
              type="button"
            >
              {t("delivery.builder.retrySave")}
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.commandActions}>
        <div className={styles.historyActions}>
          <button
            aria-label={t("delivery.builder.undoLastEdit")}
            className={styles.iconButton}
            disabled={mutationDisabled || !canUndo}
            onClick={onUndo}
            title={t("delivery.builder.undo")}
            type="button"
          >
            ↶
          </button>
          <button
            aria-label={t("delivery.builder.redoLastEdit")}
            className={styles.iconButton}
            disabled={mutationDisabled || !canRedo}
            onClick={onRedo}
            title={t("delivery.builder.redo")}
            type="button"
          >
            ↷
          </button>
        </div>
        <button
          className={styles.previewButton}
          disabled={disabled || previewDisabled}
          onClick={onPreview}
          type="button"
        >
          {t("delivery.common.preview")}
        </button>
        <button
          className={hostHref ? styles.previewButton : styles.publishButton}
          disabled={mutationDisabled || publishDisabled}
          onClick={onPublish}
          type="button"
        >
          {publishLabel}
        </button>
        {hostHref && !readOnly ? (
          <Link
            className={styles.publishButton}
            href={hostHref}
            title={navigation("Uses the published version. Draft changes are excluded.")}
            aria-disabled={disabled || saveState !== "saved"}
            tabIndex={disabled || saveState !== "saved" ? -1 : undefined}
            onClick={(event) => {
              if (disabled || saveState !== "saved") event.preventDefault();
            }}
          >
            {navigation("Host live")}
          </Link>
        ) : null}
        {assignHref ? (
          <details className={styles.moreActions} ref={menu}>
            <summary
              className={styles.iconButton}
              aria-label={navigation("More actions")}
              title={navigation("More actions")}
            >
              <RoundNavigationIcon name="more" />
            </summary>
            <div className={styles.moreMenu}>
              {assignHref ? (
                <Link href={assignHref}>{t("delivery.builder.assignPractice")}</Link>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </header>
  );
}
