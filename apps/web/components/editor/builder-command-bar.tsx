import Link from "next/link";
import type { WorkspaceProductFeatures } from "@openround/contracts";
import { CreatorBrand } from "../brand";
import { useLocale } from "../locale-provider";
import styles from "./round-builder.module.css";

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
  questionMapOpen,
  inspectorOpen,
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
  questionMapOpen: boolean;
  inspectorOpen: boolean;
  onTitleChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onToggleQuestionMap: () => void;
  onToggleInspector: () => void;
}) {
  const { t } = useLocale();
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
  return (
    <header className={styles.commandBar}>
      <CreatorBrand productFeatures={productFeatures} />
      <div className={styles.titleGroup}>
        <label className="sr-only" htmlFor="quiz-title">
          {t("create.round.blank.titleLabel")}
        </label>
        <input
          aria-invalid={!title.trim()}
          className={styles.titleInput}
          id="quiz-title"
          maxLength={160}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={t("delivery.builder.titlePlaceholder")}
          value={title}
        />
        {status ? <span className="status-pill">{status}</span> : null}
      </div>
      <div className={styles.commandActions}>
        <div className={styles.viewActions}>
          <button
            aria-expanded={questionMapOpen}
            className={styles.viewButton}
            onClick={onToggleQuestionMap}
            type="button"
          >
            {t("delivery.builder.questions")}
          </button>
          <button
            aria-expanded={inspectorOpen}
            className={styles.viewButton}
            onClick={onToggleInspector}
            type="button"
          >
            {t("delivery.builder.inspector")}
          </button>
        </div>
        <span className={styles.saveState} data-state={saveState} role="status">
          <span className={styles.saveDot} aria-hidden="true" />
          {saveStateLabel}
        </span>
        <div className={styles.historyActions}>
          <Link
            className={styles.iconButton}
            href={productFeatures?.workspaceShell ? "/library?type=rounds" : "/dashboard"}
          >
            {productFeatures?.workspaceShell
              ? t("workspace.nav.library")
              : t("delivery.builder.dashboard")}
          </Link>
          <button
            aria-label={t("delivery.builder.undoLastEdit")}
            className={styles.iconButton}
            disabled={!canUndo}
            onClick={onUndo}
            title={t("delivery.builder.undo")}
            type="button"
          >
            ↶
          </button>
          <button
            aria-label={t("delivery.builder.redoLastEdit")}
            className={styles.iconButton}
            disabled={!canRedo}
            onClick={onRedo}
            title={t("delivery.builder.redo")}
            type="button"
          >
            ↷
          </button>
        </div>
        <button
          className="button-quiet small-button"
          disabled={previewDisabled}
          onClick={onPreview}
          type="button"
        >
          {t("delivery.common.preview")}
        </button>
        {assignHref ? (
          <Link className="button-quiet small-button" href={assignHref}>
            {t("delivery.builder.assignPractice")}
          </Link>
        ) : null}
        <button
          className="button small-button"
          disabled={publishDisabled}
          onClick={onPublish}
          type="button"
        >
          {publishLabel}
        </button>
      </div>
    </header>
  );
}
