import type { QuestionDraft } from "@openround/contracts";
import type { QuestionUpdater } from "./types";
import { useLocale } from "../locale-provider";
import { authoringWorkflowCopy } from "./authoring-workflow-copy";
import { creatorWorkflowCopy } from "./creator-workflow-copy";
import { roundToolsCopy } from "../../lib/i18n/round-tools-copy";
import styles from "./media-editor.module.css";

export type MediaEditorState = "idle" | "uploading" | "scanning";

export function MediaEditor({
  question,
  uxBeta,
  mediaUploadsEnabled,
  mediaState,
  uploadBlocked = false,
  mediaPreviewUrl,
  onRemoveImage,
  onUpdateQuestion,
  onUploadImage,
}: {
  question: QuestionDraft;
  uxBeta: boolean;
  mediaUploadsEnabled: boolean;
  mediaState: MediaEditorState;
  uploadBlocked?: boolean;
  mediaPreviewUrl: string;
  onRemoveImage: () => void;
  onUpdateQuestion: QuestionUpdater;
  onUploadImage: (file: File | null) => void;
}) {
  const { t, locale } = useLocale();
  const copy = creatorWorkflowCopy(locale);
  const authoring = authoringWorkflowCopy(locale);
  const toolsCopy = roundToolsCopy(locale);
  const attached = Boolean(question.mediaId || mediaPreviewUrl);
  return (
    <details
      className={styles.container}
      open={
        Boolean(question.mediaId || mediaPreviewUrl || mediaState !== "idle" || uploadBlocked) ||
        undefined
      }
    >
      <summary className={styles.summary}>
        <span>{attached ? copy.imageSettings : copy.addImage}</span>
        {uxBeta && attached ? (
          <span
            className={styles.altStatus}
            data-complete={Boolean(question.mediaAlt?.trim())}
            lang={locale}
          >
            {toolsCopy(question.mediaAlt?.trim() ? "Alt text added" : "Alt text needed")}
          </span>
        ) : null}
      </summary>
      <div className={`media-editor ${styles.editor}`} data-has-preview={Boolean(mediaPreviewUrl)}>
        <div className={`field ${styles.fields}`}>
          <label htmlFor="media-alt">
            {uxBeta ? toolsCopy("Alternative text") : t("delivery.builder.media")}
          </label>
          <input
            aria-describedby={uxBeta ? "media-alt-help" : undefined}
            className="input"
            id="media-alt"
            lang={question.mediaAlt ? "" : locale}
            maxLength={300}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                mediaAlt: event.target.value || null,
              }))
            }
            placeholder={authoring.imageAlt}
            value={question.mediaAlt ?? ""}
          />
          {uxBeta ? (
            <small className={styles.help} id="media-alt-help" lang={locale}>
              {toolsCopy("Describe the image information needed to answer the question.")}
            </small>
          ) : null}
          <label className={uxBeta ? undefined : "sr-only"} htmlFor="media-upload" lang={locale}>
            {authoring.chooseImage}
          </label>
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="media-help"
            className={styles.upload}
            disabled={!mediaUploadsEnabled || mediaState !== "idle" || uploadBlocked}
            id="media-upload"
            onChange={(event) => {
              onUploadImage(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
            type="file"
          />
          <small className="muted" id="media-help" lang={locale}>
            {uploadBlocked
              ? authoring.imagePending
              : mediaUploadsEnabled
                ? authoring.imageHelp
                : authoring.imageDisabled}
          </small>
          {mediaState !== "idle" ? (
            <span className="notice" lang={locale} role="status">
              {mediaState === "uploading" ? authoring.imageUploading : authoring.imageChecking}
            </span>
          ) : null}
        </div>
        {mediaPreviewUrl ? (
          <div className={styles.preview}>
            <img
              alt={question.mediaAlt ?? ""}
              className={`question-media ${styles.image}`}
              height={360}
              lang=""
              src={mediaPreviewUrl}
              width={640}
            />
          </div>
        ) : null}
        {attached ? (
          <div className={styles.imageActions}>
            {!mediaPreviewUrl ? (
              <span className={styles.help} lang={locale}>
                {toolsCopy("Image attached. Preview unavailable.")}
              </span>
            ) : null}
            <button
              className={`danger-link ${styles.remove}`}
              onClick={onRemoveImage}
              type="button"
            >
              {t("delivery.builder.removeImage")}
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
