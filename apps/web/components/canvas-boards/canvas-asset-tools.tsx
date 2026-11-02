"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CanvasObjectCreateSchema,
  type CanvasBoardView,
  type CanvasObjectCreate,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import { rasterizeCanvasSvg } from "./canvas-svg-import";
import { useLocale } from "../locale-provider";
import { useNavigationBlocker } from "../navigation-guard";
import { uploadCanvasImage } from "./canvas-assets-client";
import styles from "./canvas.module.css";

export function CanvasAssetTools({
  board,
  disabled = false,
  onCreate,
  openRequest,
  hideButtons = false,
}: {
  board: CanvasBoardView;
  disabled?: boolean;
  openRequest?: { kind: "image" | "link" | "svg"; id: number };
  hideButtons?: boolean;
  onCreate: (object: CanvasObjectCreate) => Promise<boolean>;
}) {
  const { t, locale } = useLocale();
  const copy = canvasToolCopy(locale ?? "en-CA");
  const [kind, setKind] = useState<"image" | "link" | "svg" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const active = useRef(true);
  useNavigationBlocker(() => busy);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!kind) return;
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [kind]);
  useEffect(() => {
    if (openRequest) open(openRequest.kind);
    // Each palette request is consumed once.
  }, [openRequest?.id]);
  function open(value: "image" | "link" | "svg") {
    if (
      disabled ||
      busy ||
      !board.capabilities.edit ||
      (value !== "link" && !board.imageUploadsAvailable)
    )
      return;
    setFile(null);
    setDescription("");
    setUrl("");
    setLabel("");
    setFailed(false);
    setKind(value);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || disabled || !board.capabilities.edit || !kind) return;
    if (kind !== "link" && (!file || !board.imageUploadsAvailable)) return;
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setFailed(false);
    try {
      const imageFile = kind === "svg" ? await rasterizeCanvasSvg(file!, abort.signal) : file;
      const media =
        kind !== "link"
          ? await uploadCanvasImage(board.id, imageFile!, description, abort.signal)
          : null;
      if (!active.current || abort.signal.aborted) return;
      const object = CanvasObjectCreateSchema.parse({
        id: clientUuid(),
        type: kind === "svg" ? "image" : kind,
        x: 0,
        y: 0,
        width: kind !== "link" ? 320 : 280,
        height: kind !== "link" ? 220 : 120,
        color: "white",
        text: kind === "link" ? label.trim() : "",
        ...(media ? { mediaId: media.mediaId, altText: media.altText } : { url: url.trim() }),
      });
      // Once handed off, the editor owns success or the retained mutation's exact retry.
      // Close the modal in both cases so its recovery controls stay reachable.
      await onCreate(object);
      if (active.current) {
        setKind(null);
        setFile(null);
        setDescription("");
        setUrl("");
        setLabel("");
        setFailed(false);
      }
    } catch {
      if (active.current && !abort.signal.aborted) setFailed(true);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (!board.capabilities.edit) return null;
  return (
    <>
      {!hideButtons ? (
        <>
          <button
            type="button"
            className="button-quiet"
            disabled={disabled || busy || !board.imageUploadsAvailable}
            title={!board.imageUploadsAvailable ? t("canvas.assets.unavailable") : undefined}
            onClick={() => open("image")}
          >
            {t("canvas.assets.image")}
          </button>
          <button
            type="button"
            className="button-quiet"
            disabled={disabled || busy}
            onClick={() => open("link")}
          >
            {t("canvas.assets.link")}
          </button>
          <button
            type="button"
            className="button-quiet"
            disabled={disabled || busy || !board.imageUploadsAvailable}
            onClick={() => open("svg")}
          >
            {copy.uploadSvg}
          </button>
        </>
      ) : null}
      {kind ? (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby="canvas-asset-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setKind(null);
          }}
        >
          <header className={styles.dialogHeader}>
            <h2 id="canvas-asset-title">
              {kind === "svg"
                ? copy.uploadSvg
                : t(kind === "image" ? "canvas.assets.addImage" : "canvas.assets.addLink")}
            </h2>
            <button
              type="button"
              className="button-quiet"
              disabled={busy}
              onClick={() => setKind(null)}
            >
              {t("boards.cancel")}
            </button>
          </header>
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            {kind !== "link" ? (
              <>
                <label>
                  {t("canvas.assets.file")}
                  <input
                    type="file"
                    accept={
                      kind === "svg" ? ".svg,image/svg+xml" : "image/jpeg,image/png,image/webp"
                    }
                    required
                    disabled={busy}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <p className={styles.muted}>
                  {kind === "svg" ? copy.svgHelp : t("canvas.assets.imageHelp")}
                </p>
                <label>
                  {t("canvas.assets.altText")}
                  <textarea
                    value={description}
                    maxLength={300}
                    required
                    disabled={busy}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <p className={styles.muted}>{t("canvas.assets.altHelp")}</p>
              </>
            ) : (
              <>
                <label>
                  {t("canvas.assets.url")}
                  <input
                    type="url"
                    value={url}
                    maxLength={2048}
                    required
                    disabled={busy}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </label>
                <label>
                  {t("canvas.assets.label")}
                  <input
                    value={label}
                    maxLength={2000}
                    required
                    disabled={busy}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
              </>
            )}
            {failed ? (
              <p className="error" role="alert">
                {t("canvas.assets.failed")}
              </p>
            ) : null}
            <button
              type="submit"
              className="button"
              disabled={disabled || busy || (kind !== "link" && !file)}
            >
              {t(
                busy
                  ? "canvas.assets.working"
                  : kind !== "link"
                    ? "canvas.assets.upload"
                    : "canvas.assets.addLink",
              )}
            </button>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
