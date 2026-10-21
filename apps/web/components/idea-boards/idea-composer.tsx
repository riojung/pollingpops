"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  IdeaBoardLinkSchema,
  type IdeaBoardIdea,
  type IdeaBoardSketch,
} from "@openround/contracts";
import { uploadIdeaBoardImage } from "../../lib/idea-board-client";
import { useLocale } from "../locale-provider";
import { BoardIdeaImage } from "./idea-content";
import { IdeaSketchEditor } from "./idea-sketch-editor";
import { SketchPreview } from "./sketch-preview";
import styles from "./boards.module.css";

export type IdeaDraft = {
  body: string;
  attachments: NonNullable<IdeaBoardIdea["attachments"]>;
  links: NonNullable<IdeaBoardIdea["links"]>;
  sketch: IdeaBoardSketch | null;
};
export function emptyIdeaDraft(): IdeaDraft {
  return { body: "", attachments: [], links: [], sketch: null };
}

export function removeDraftImage(value: IdeaDraft, mediaId: string): IdeaDraft {
  return {
    ...value,
    attachments: value.attachments.filter((item) => item.mediaId !== mediaId),
    links: value.links.map((link) => {
      if (link.imageMediaId !== mediaId) return link;
      const rest = { ...link };
      delete rest.imageMediaId;
      return rest;
    }),
  };
}

export function addDraftLink(
  value: IdeaDraft,
  url: string,
  label: string,
  imageMediaId = "",
): IdeaDraft {
  const link = IdeaBoardLinkSchema.parse({
    url: url.trim(),
    ...(label.trim() ? { label: label.trim() } : {}),
    ...(imageMediaId ? { imageMediaId } : {}),
  });
  if (
    value.links.length >= 3 ||
    value.links.some((item) => item.url === link.url) ||
    (imageMediaId && !value.attachments.some((item) => item.mediaId === imageMediaId))
  )
    throw new Error("Invalid link");
  return { ...value, links: [...value.links, link] };
}

export function IdeaComposer({
  boardId,
  guestToken,
  value,
  disabled,
  imagesAvailable,
  onChange,
  onSubmit,
  onUploading,
}: {
  boardId: string;
  guestToken: string;
  value: IdeaDraft;
  disabled: boolean;
  imagesAvailable?: boolean;
  onChange: (value: IdeaDraft) => void;
  onSubmit: () => void;
  onUploading: (value: boolean) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const body = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const current = useRef(value);
  current.current = value;
  const [panel, setPanel] = useState<"image" | "link" | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [alt, setAlt] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [linkImage, setLinkImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<"boards.uploadFailed" | "boards.invalidLink" | null>(null);
  const locked = disabled || uploading;
  const enabled = useRef(!disabled);
  enabled.current = !disabled;
  useEffect(
    () => () => {
      controller.current?.abort();
      onUploading(false);
    },
    [onUploading],
  );

  async function upload(file: File | undefined) {
    if (
      !file ||
      locked ||
      !alt.trim() ||
      current.current.attachments.length >= 3 ||
      imagesAvailable === false
    )
      return;
    setError(null);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError("boards.uploadFailed");
      return;
    }
    const active = new AbortController();
    controller.current?.abort();
    controller.current = active;
    setUploading(true);
    onUploading(true);
    try {
      const media = await uploadIdeaBoardImage(
        boardId,
        guestToken,
        file,
        alt.trim(),
        active.signal,
      );
      if (!active.signal.aborted) {
        onChange({
          ...current.current,
          attachments: [
            ...current.current.attachments,
            { mediaId: media.mediaId, alt: media.altText },
          ],
        });
        setAlt("");
        setPanel(null);
      }
    } catch {
      if (!active.signal.aborted) setError("boards.uploadFailed");
    } finally {
      if (!active.signal.aborted) {
        setUploading(false);
        onUploading(false);
      }
    }
  }

  function addLink() {
    if (locked || value.links.length >= 3) return;
    try {
      onChange(addDraftLink(value, url, label, linkImage));
      setUrl("");
      setLabel("");
      setLinkImage("");
      setPanel(null);
      setError(null);
    } catch {
      setError("boards.invalidLink");
    }
  }

  return (
    <form
      className={`${styles.form} ${styles.composer}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!drawing && !locked && value.body.trim()) onSubmit();
      }}
    >
      <p className={styles.muted}>{t("boards.composerHelp")}</p>
      <label htmlFor={`${id}-body`}>{t("boards.idea")}</label>
      <textarea
        ref={body}
        id={`${id}-body`}
        required
        maxLength={1000}
        disabled={locked}
        value={value.body}
        lang=""
        dir="auto"
        onChange={(event) => onChange({ ...value, body: event.target.value })}
      />
      <div className={styles.composerTools} role="group" aria-label={t("boards.richTypes")}>
        <button
          type="button"
          className="button-quiet"
          disabled={locked}
          onClick={() => {
            setPanel(null);
            body.current?.focus();
          }}
        >
          <span aria-hidden="true">T</span>
          {t("boards.textAction")}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={locked || imagesAvailable === false || value.attachments.length >= 3}
          aria-expanded={panel === "image"}
          aria-controls={`${id}-image`}
          onClick={() => {
            setPanel(panel === "image" ? null : "image");
            setError(null);
          }}
        >
          <span aria-hidden="true">▧</span>
          {t("boards.addImage")}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={locked}
          onClick={() => setDrawing(true)}
        >
          <span aria-hidden="true">✎</span>
          {t("boards.addDrawing")}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={locked || value.links.length >= 3}
          aria-expanded={panel === "link"}
          aria-controls={`${id}-link`}
          onClick={() => {
            setPanel(panel === "link" ? null : "link");
            setError(null);
          }}
        >
          <span aria-hidden="true">↗</span>
          {t("boards.addLink")}
        </button>
      </div>
      {imagesAvailable === false ? (
        <p className={styles.muted}>{t("boards.imagesUnavailable")}</p>
      ) : null}
      {panel === "image" ? (
        <div className={`${styles.attachmentPanel} ${styles.form}`} id={`${id}-image`}>
          <label htmlFor={`${id}-alt`}>{t("boards.imageDescription")}</label>
          <input
            id={`${id}-alt`}
            type="text"
            maxLength={300}
            value={alt}
            disabled={locked}
            aria-describedby={`${id}-alt-help`}
            lang=""
            dir="auto"
            onChange={(event) => setAlt(event.target.value)}
          />
          <small id={`${id}-alt-help`} className={styles.muted}>
            {t("boards.imageDescriptionHelp")}
          </small>
          <label htmlFor={`${id}-file`}>{t("boards.chooseImage")}</label>
          <input
            id={`${id}-file`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={locked || !alt.trim()}
            aria-describedby={`${id}-image-help`}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <small id={`${id}-image-help`} className={styles.muted}>
            {t("boards.imageHelp")}
          </small>
        </div>
      ) : null}
      {uploading ? (
        <p role="status" aria-live="polite">
          {t("boards.uploading")}
        </p>
      ) : null}
      {panel === "link" ? (
        <div className={`${styles.attachmentPanel} ${styles.form}`} id={`${id}-link`}>
          <label htmlFor={`${id}-url`}>{t("boards.linkUrl")}</label>
          <input
            id={`${id}-url`}
            type="url"
            maxLength={2048}
            value={url}
            disabled={locked}
            aria-describedby={`${id}-link-help`}
            onChange={(event) => setUrl(event.target.value)}
          />
          <label htmlFor={`${id}-label`}>{t("boards.linkLabel")}</label>
          <input
            id={`${id}-label`}
            maxLength={160}
            value={label}
            disabled={locked}
            lang=""
            dir="auto"
            onChange={(event) => setLabel(event.target.value)}
          />
          <small id={`${id}-link-help`} className={styles.muted}>
            {t("boards.linkHelp")}
          </small>
          <label htmlFor={`${id}-link-image`}>{t("boards.linkImage")}</label>
          <select
            id={`${id}-link-image`}
            disabled={locked}
            value={linkImage}
            onChange={(event) => setLinkImage(event.target.value)}
          >
            <option value="">{t("boards.noLinkImage")}</option>
            {value.attachments.map((attachment) => (
              <option key={attachment.mediaId} value={attachment.mediaId} lang="">
                {attachment.alt}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button-quiet"
            disabled={locked || !url.trim()}
            onClick={addLink}
          >
            {t("boards.saveLink")}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {t(error)}
        </p>
      ) : null}
      {value.attachments.length ? (
        <div className={styles.draftAttachments}>
          <p className={styles.muted}>
            {t("boards.attachmentCount", { count: value.attachments.length })}
          </p>
          <ul className={styles.draftImageGrid}>
            {value.attachments.map((attachment) => (
              <li key={attachment.mediaId}>
                <BoardIdeaImage
                  boardId={boardId}
                  guestToken={guestToken}
                  mediaId={attachment.mediaId}
                  alt={attachment.alt}
                />
                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked}
                  onClick={() => {
                    onChange(removeDraftImage(value, attachment.mediaId));
                    if (linkImage === attachment.mediaId) setLinkImage("");
                  }}
                >
                  {t("boards.removeImage")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {value.sketch ? (
        <div className={styles.drawingPreview}>
          <SketchPreview sketch={value.sketch} label={t("boards.drawingDescription")} />
          <div className={styles.actions}>
            <button
              type="button"
              className="button-quiet"
              disabled={locked}
              onClick={() => setDrawing(true)}
            >
              {t("boards.editDrawing")}
            </button>
            <button
              type="button"
              className="button-quiet"
              disabled={locked}
              onClick={() => onChange({ ...value, sketch: null })}
            >
              {t("boards.removeDrawing")}
            </button>
          </div>
        </div>
      ) : null}
      {value.links.length ? (
        <div>
          <p className={styles.muted}>{t("boards.linkCount", { count: value.links.length })}</p>
          <ul className={styles.draftLinkList}>
            {value.links.map((link) => (
              <li key={link.url}>
                <span lang="" dir="auto">
                  <strong>{link.label}</strong>
                  {link.label ? " · " : ""}
                  {link.url}
                </span>
                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked}
                  onClick={() =>
                    onChange({
                      ...value,
                      links: value.links.filter((item) => item.url !== link.url),
                    })
                  }
                >
                  {t("boards.removeLink")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={styles.composerFooter}>
        <span className={styles.muted} aria-live="off">
          {value.body.length}/1,000
        </span>
        <button className="button" type="submit" disabled={locked || !value.body.trim()}>
          {t("boards.submitIdea")}
        </button>
      </div>
      {drawing ? (
        <IdeaSketchEditor
          value={value.sketch}
          disabled={locked}
          onCancel={() => setDrawing(false)}
          onSave={(sketch) => {
            if (enabled.current) onChange({ ...current.current, sketch });
            setDrawing(false);
          }}
        />
      ) : null}
    </form>
  );
}
