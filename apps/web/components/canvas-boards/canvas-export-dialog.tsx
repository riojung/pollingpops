"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CanvasExportRegion, CanvasObject } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasExportMessages } from "../../lib/i18n/canvas-export-messages";
import {
  canvasExportPng,
  downloadCanvasExport,
  fetchCanvasExport,
  selectedCanvasExportFrameRegion,
} from "./canvas-export-client";
import styles from "./canvas-export.module.css";

export interface CanvasExportDialogProps {
  boardId: string;
  objects: readonly CanvasObject[];
  selectedIds: readonly string[];
  viewportRegion: CanvasExportRegion | null;
  disabled?: boolean;
  title?: string;
  onClose: () => void;
}
export function CanvasExportDialog({
  boardId,
  objects,
  selectedIds,
  viewportRegion,
  disabled = false,
  title,
  onClose,
}: CanvasExportDialogProps) {
  const { locale } = useLocale();
  const messages = canvasExportMessages(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  const titleId = useId(),
    helpId = useId();
  const [scope, setScope] = useState<"whole" | "viewport" | "frame">("whole");
  const [format, setFormat] = useState<"svg" | "png">("png");
  const [background, setBackground] = useState<"white" | "transparent">("white");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const frameRegion = selectedCanvasExportFrameRegion(objects, selectedIds);
  const unavailable =
    (scope === "viewport" && !viewportRegion) || (scope === "frame" && !frameRegion);
  useEffect(() => {
    active.current = true;
    const previous = window.document.activeElement;
    const node = dialog.current;
    node?.showModal();
    first.current?.focus();
    return () => {
      active.current = false;
      request.current?.abort();
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
        requestAnimationFrame(() => {
          if (previous.isConnected) previous.focus();
        });
      }
    };
  }, []);
  useEffect(() => {
    if (disabled) request.current?.abort();
  }, [disabled]);
  function close() {
    request.current?.abort();
    onClose();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.current || disabled || unavailable) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(false);
    try {
      const region = scope === "whole" ? null : scope === "viewport" ? viewportRegion : frameRegion;
      const document = await fetchCanvasExport(boardId, region, background, controller.signal);
      const blob =
        format === "png" ? await canvasExportPng(document, controller.signal) : document.blob;
      if (active.current && !controller.signal.aborted) downloadCanvasExport(blob, format);
    } catch {
      if (active.current && !controller.signal.aborted) setError(true);
    } finally {
      request.current = null;
      if (active.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className={styles.header}>
        <h2 id={titleId}>{messages["canvas.export.title"]}</h2>
        <button type="button" className="button-quiet" onClick={close}>
          {messages["canvas.export.cancel"]}
        </button>
      </header>
      {title ? (
        <p className={styles.boardTitle} dir="auto" lang="">
          {title}
        </p>
      ) : null}
      <p id={helpId}>{messages["canvas.export.help"]}</p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset className={styles.options} disabled={busy || disabled}>
          <label>
            {messages["canvas.export.scope"]}
            <select
              ref={first}
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="whole">{messages["canvas.export.whole"]}</option>
              <option value="viewport" disabled={!viewportRegion}>
                {messages["canvas.export.viewport"]}
              </option>
              <option value="frame" disabled={!frameRegion}>
                {messages["canvas.export.frame"]}
              </option>
            </select>
          </label>
          <label>
            {messages["canvas.export.format"]}
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as typeof format)}
            >
              <option value="png">PNG</option>
              <option value="svg">SVG</option>
            </select>
          </label>
          <label>
            {messages["canvas.export.background"]}
            <select
              value={background}
              onChange={(event) => setBackground(event.target.value as typeof background)}
            >
              <option value="white">{messages["canvas.export.white"]}</option>
              <option value="transparent">{messages["canvas.export.transparent"]}</option>
            </select>
          </label>
        </fieldset>
        {unavailable ? <p role="status">{messages["canvas.export.unavailable"]}</p> : null}
        {error ? (
          <p role="alert" className="error">
            {messages["canvas.export.failed"]}
          </p>
        ) : null}
        <footer className={styles.footer}>
          <button type="submit" className="button" disabled={busy || disabled || unavailable}>
            {busy ? messages["canvas.export.working"] : messages["canvas.export.download"]}
          </button>
        </footer>
        {busy ? (
          <p role="status" className={styles.status}>
            {messages["canvas.export.working"]}
          </p>
        ) : null}
      </form>
    </dialog>
  );
}
