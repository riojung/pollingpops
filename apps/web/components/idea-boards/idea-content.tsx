"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { IdeaBoardIdea, IdeaBoardSketch } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { readBoardIdeaImage } from "./idea-image-resource";
import { SketchPreview } from "./sketch-preview";
import styles from "./boards.module.css";

export function BoardIdeaImage({
  boardId,
  mediaId,
  alt,
  guestToken,
  showCaption = true,
}: {
  boardId: string;
  mediaId: string;
  alt: string;
  guestToken?: string;
  showCaption?: boolean;
}) {
  const { t } = useLocale();
  const figure = useRef<HTMLElement>(null);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sourceKey = JSON.stringify([boardId, mediaId, guestToken ?? null]);
  const key = `${sourceKey}:${attempt}`;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !figure.current) {
      setVisibleKey(sourceKey);
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          setVisibleKey(sourceKey);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(figure.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [sourceKey]);
  useEffect(() => {
    if (visibleKey !== sourceKey) return;
    let active = true;
    let url: string | undefined;
    const read = readBoardIdeaImage(boardId, mediaId, guestToken);
    void read.promise
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setImage({ key, url });
      })
      .catch(() => {
        if (active) setFailed(key);
      });
    return () => {
      active = false;
      read.release();
      if (url) URL.revokeObjectURL(url);
    };
  }, [boardId, mediaId, guestToken, key, sourceKey, visibleKey]);
  return (
    <figure ref={figure} className={styles.ideaImage}>
      {image?.key === key && failed !== key ? (
        <img src={image.url} alt={alt} lang="" loading="lazy" onError={() => setFailed(key)} />
      ) : (
        <p role="status">
          {t(failed === key ? "boards.imageUnavailable" : "boards.loadingImage")}
          {failed === key && showCaption ? (
            <>
              {" "}
              <button
                type="button"
                className="button-quiet"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t("boards.retry")}
              </button>
            </>
          ) : null}
        </p>
      )}
      {showCaption ? (
        <figcaption lang="" dir="auto">
          {alt}
        </figcaption>
      ) : null}
    </figure>
  );
}

function DrawingDialog({ sketch, onClose }: { sketch: IdeaBoardSketch; onClose: () => void }) {
  const { t } = useLocale();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    close.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      className={`${styles.dialog} ${styles.drawingDialog}`}
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.heading}>
        <h2 id={`${id}-title`}>{t("boards.drawing")}</h2>
        <button ref={close} type="button" className="button-quiet" onClick={onClose}>
          {t("boards.closeDrawing")}
        </button>
      </div>
      <SketchPreview sketch={sketch} label={t("boards.drawingDescription")} />
    </dialog>
  );
}

export function IdeaContent({
  boardId,
  idea,
  guestToken,
  showBody = true,
}: {
  boardId: string;
  idea: Pick<IdeaBoardIdea, "body" | "status" | "attachments" | "links" | "sketch">;
  guestToken?: string;
  showBody?: boolean;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  if (idea.status === "removed") return null;
  const links = (idea.links ?? []).flatMap((link) => {
    try {
      const url = new URL(link.url);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
        ? [{ link, url }]
        : [];
    } catch {
      return [];
    }
  });
  const linkedImages = new Set(links.map(({ link }) => link.imageMediaId));
  const attachments = (idea.attachments ?? []).filter(
    (attachment) => !linkedImages.has(attachment.mediaId),
  );
  return (
    <div className={styles.ideaContent}>
      {showBody && idea.body ? (
        <p className={styles.body} lang="" dir="auto">
          {idea.body}
        </p>
      ) : null}
      {attachments.length ? (
        <div className={styles.imageGrid}>
          {attachments.map((attachment) => (
            <BoardIdeaImage
              key={attachment.mediaId}
              boardId={boardId}
              mediaId={attachment.mediaId}
              alt={attachment.alt}
              guestToken={guestToken}
            />
          ))}
        </div>
      ) : null}
      {idea.sketch ? (
        <div className={styles.drawingPreview}>
          <SketchPreview sketch={idea.sketch} label={t("boards.drawingDescription")} />
          <button type="button" className="button-quiet" onClick={() => setExpanded(true)}>
            {t("boards.expandDrawing")}
          </button>
          {expanded ? (
            <DrawingDialog sketch={idea.sketch} onClose={() => setExpanded(false)} />
          ) : null}
        </div>
      ) : null}
      {links.length ? (
        <ul className={styles.linkCards}>
          {links.map(({ link, url }) => {
            const domain = url.hostname.replace(/^www\./, "");
            const image = idea.attachments?.find(
              (attachment) => attachment.mediaId === link.imageMediaId,
            );
            return (
              <li key={link.url}>
                <a
                  href={url.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className={styles.linkCard}
                >
                  {image ? (
                    <div className={styles.linkThumbnail}>
                      <BoardIdeaImage
                        boardId={boardId}
                        mediaId={image.mediaId}
                        alt={image.alt}
                        guestToken={guestToken}
                        showCaption={false}
                      />
                    </div>
                  ) : (
                    <span className={styles.linkIcon} aria-hidden="true">
                      ↗
                    </span>
                  )}
                  <span>
                    <strong lang={link.label ? "" : undefined} dir="auto">
                      {link.label || domain}
                    </strong>
                    <span className={styles.linkDomain}>{domain}</span>
                    <span className="sr-only">{t("boards.openLink", { domain })}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
