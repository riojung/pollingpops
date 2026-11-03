"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CanvasObjectSchema,
  IDEA_BOARD_MAX_CANVAS_OBJECTS,
  type CanvasObject,
  type IdeaBoardCanvas,
} from "@openround/contracts";
import { CanvasReadOnlySurface, CanvasSurface } from "../canvas-boards/canvas-surface";
import type { CanvasArtifactImageContext } from "../canvas-boards/canvas-assets-client";
import { useLocale } from "../locale-provider";
import { participantCanvasCopy } from "../../lib/i18n/participant-canvas-messages";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import { formatNumber } from "../../lib/i18n/format";
import styles from "./idea-canvas-preview.module.css";

type ImageAccess = {
  boardId: string;
  guestToken?: string;
  canvasId?: string;
  versionId?: string;
  artifactLink?: CanvasArtifactImageContext;
};

/** Rendering identifiers never share the surrounding workshop's object namespace. */
export function ideaCanvasObjects(canvas: IdeaBoardCanvas, ideaId: string): CanvasObject[] {
  const scoped = (id: string) => `idea:${ideaId}:${id}`;
  return canvas.objects.slice(0, IDEA_BOARD_MAX_CANVAS_OBJECTS).flatMap((input) => {
    // Keep recursion bounded even if an unvalidated caller supplies a protected reference.
    if ((input as { type: string }).type === "idea_ref") return [];
    const parsed = CanvasObjectSchema.safeParse({ ...input, visibility: "published", version: 1 });
    if (!parsed.success) return [];
    const object = parsed.data;
    return [
      {
        ...object,
        id: scoped(object.id),
        parentId: object.parentId ? scoped(object.parentId) : null,
        geometricGroupId: object.geometricGroupId ? scoped(object.geometricGroupId) : null,
        ...(object.type === "connector"
          ? {
              from: {
                ...object.from,
                objectId: object.from.objectId ? scoped(object.from.objectId) : null,
              },
              to: {
                ...object.to,
                objectId: object.to.objectId ? scoped(object.to.objectId) : null,
              },
            }
          : {}),
      } as CanvasObject,
    ];
  });
}

const ideaImage = (object: CanvasObject) => object.type === "image";
const keepViewport = () => {};

/** A fitted native scene with no interaction or object mutation authority. */
export function IdeaCanvasScene({
  canvas,
  ideaId,
  width,
  height,
  boardId,
  guestToken,
  canvasId,
  versionId,
  artifactLink,
}: ImageAccess & { canvas: IdeaBoardCanvas; ideaId: string; width: number; height: number }) {
  const zoom = Math.min(width / canvas.width, height / canvas.height);
  return (
    <div className={styles.scene} inert aria-hidden="true">
      <CanvasSurface
        objects={ideaCanvasObjects(canvas, ideaId)}
        viewport={{
          x: (width - canvas.width * zoom) / 2,
          y: (height - canvas.height * zoom) / 2,
          zoom,
        }}
        onViewport={keepViewport}
        sourceBoardId={boardId}
        guestToken={guestToken}
        canvasId={canvasId}
        versionId={versionId}
        artifactLink={artifactLink}
        isIdeaImage={ideaImage}
      />
    </div>
  );
}

function IdeaCanvasDialog({
  canvas,
  ideaId,
  title,
  onClose,
  boardId,
  guestToken,
  canvasId,
  versionId,
  artifactLink,
}: ImageAccess & {
  canvas: IdeaBoardCanvas;
  ideaId: string;
  title?: string | null;
  onClose: () => void;
}) {
  const { locale = "en-CA" } = useLocale();
  const copy = participantCanvasCopy(locale);
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
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.heading}>
        <h2 id={`${id}-title`}>{copy.previewTitle}</h2>
        <button ref={close} className="button-quiet" type="button" onClick={onClose}>
          {canvasToolCopy(locale).close}
        </button>
      </div>
      {title ? (
        <p className={styles.caption} lang="" dir="auto">
          {title}
        </p>
      ) : null}
      <CanvasReadOnlySurface
        fill
        objects={ideaCanvasObjects(canvas, ideaId)}
        sourceBoardId={boardId}
        guestToken={guestToken}
        canvasId={canvasId}
        versionId={versionId}
        artifactLink={artifactLink}
        isIdeaImage={ideaImage}
        label={copy.previewTitle}
        insideDialog
      />
    </dialog>
  );
}

export function IdeaCanvasPreview({
  canvas,
  ideaId,
  title,
  ...access
}: ImageAccess & { canvas: IdeaBoardCanvas; ideaId?: string; title?: string | null }) {
  const { locale = "en-CA" } = useLocale();
  const copy = participantCanvasCopy(locale);
  const localId = useId();
  const scope = ideaId ?? localId;
  const [expanded, setExpanded] = useState(false);
  const height = Math.max(120, Math.min(300, (480 * canvas.height) / canvas.width));
  return (
    <div className={styles.preview}>
      <svg
        className={styles.thumbnail}
        viewBox={`0 0 480 ${height}`}
        role="img"
        aria-label={copy.canvasSummary.replace(
          "{count}",
          formatNumber(locale, canvas.objects.length),
        )}
      >
        <foreignObject x={0} y={0} width={480} height={height}>
          <IdeaCanvasScene canvas={canvas} ideaId={scope} width={480} height={height} {...access} />
        </foreignObject>
      </svg>
      <button className="button-quiet" type="button" onClick={() => setExpanded(true)}>
        {copy.openPreview}
      </button>
      {expanded ? (
        <IdeaCanvasDialog
          canvas={canvas}
          ideaId={scope}
          title={title}
          onClose={() => setExpanded(false)}
          {...access}
        />
      ) : null}
    </div>
  );
}
