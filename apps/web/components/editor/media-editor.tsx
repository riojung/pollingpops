import type { QuestionDraft } from "@openround/contracts";
import type { QuestionUpdater } from "./types";
import { useLocale } from "../locale-provider";
import { creatorWorkflowCopy } from "./creator-workflow-copy";
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
  return (
    <details
      className={styles.container}
      open={
        Boolean(question.mediaId || mediaPreviewUrl || mediaState !== "idle" || uploadBlocked) ||
        undefined
      }
    >
      <summary className={styles.summary}>
        {question.mediaId || mediaPreviewUrl ? copy.imageSettings : copy.addImage}
      </summary>
      <div className={`media-editor ${styles.editor}`} data-has-preview={Boolean(mediaPreviewUrl)}>
        <div className={`field ${styles.fields}`}>
          <label htmlFor="media-alt">{t("delivery.builder.media")}</label>
          <input
            className="input"
            id="media-alt"
            lang={question.mediaAlt ? "" : "en-CA"}
            maxLength={300}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                mediaAlt: event.target.value || null,
              }))
            }
            placeholder="Describe what the image teaches"
            value={question.mediaAlt ?? ""}
          />
          <label className={uxBeta ? undefined : "sr-only"} htmlFor="media-upload" lang="en-CA">
            Choose instructional image
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
          <small className="muted" id="media-help" lang="en-CA">
            {uploadBlocked
              ? "Finish or discard the uploaded image attachment before choosing another image."
              : mediaUploadsEnabled
                ? "JPEG, PNG, or WebP up to 10 MB. Images are quarantined and scanned before use."
                : "New image uploads are disabled until this operator configures malware scanning."}
          </small>
          {mediaState !== "idle" ? (
            <span className="notice" lang="en-CA" role="status">
              {mediaState === "uploading" ? "Uploading to quarantine…" : "Checking image safety…"}
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
            <button className="danger-link" onClick={onRemoveImage} type="button">
              {t("delivery.builder.removeImage")}
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
