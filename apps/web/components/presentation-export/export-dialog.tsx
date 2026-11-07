"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { PresentationStaticExportSource } from "@openround/contracts";
import { humanError } from "../../lib/api";
import {
  downloadPresentationStaticExport,
  fetchPresentationStaticExport,
  fetchPresentationStaticExportSource,
  type PresentationStaticExportFormat,
} from "../../lib/presentation-static-export-client";
import styles from "./export.module.css";

export function PresentationExportButton({
  presentationId,
  versionId,
  disabled = false,
  className,
}: {
  presentationId: string;
  versionId: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label="Export presentation"
        aria-haspopup="dialog"
        aria-expanded={openVersionId !== null}
        disabled={disabled || !versionId}
        onClick={() => {
          if (versionId) setOpenVersionId(versionId);
        }}
      >
        Export
      </button>
      {openVersionId && !disabled ? (
        <PresentationExportDialog
          presentationId={presentationId}
          versionId={openVersionId}
          onClose={() => setOpenVersionId(null)}
          returnFocusRef={trigger}
        />
      ) : null}
    </>
  );
}

export function PresentationExportDialog({
  presentationId,
  versionId,
  onClose,
  returnFocusRef,
}: {
  presentationId: string;
  versionId: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const downloadController = useRef<AbortController | null>(null);
  const releaseDownload = useRef<(() => void) | null>(null);
  const [source, setSource] = useState<PresentationStaticExportSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [format, setFormat] = useState<PresentationStaticExportFormat>("pdf");
  const [blockId, setBlockId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const trigger = returnFocusRef.current;
    const modal = dialog.current;
    modal?.showModal();
    closeButton.current?.focus();
    return () => {
      downloadController.current?.abort();
      downloadController.current = null;
      releaseDownload.current?.();
      modal?.close();
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    };
  }, [returnFocusRef, presentationId, versionId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSource(null);
    setLoadError("");
    setBlockId("");
    void fetchPresentationStaticExportSource(presentationId, versionId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setSource(value);
        setBlockId(value.pages[0]?.blockId ?? "");
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setLoadError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [presentationId, versionId, loadAttempt]);

  function cancelExport() {
    downloadController.current?.abort();
    downloadController.current = null;
    setBusy(false);
    setStatus("Export canceled. No download started.");
  }
  async function download() {
    if (!source || busy || downloadController.current || (format === "png" && !blockId)) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setBusy(true);
    setError("");
    setStatus("Preparing your export…");
    try {
      const result = await fetchPresentationStaticExport(
        presentationId,
        { versionId, format, ...(format === "png" ? { blockId } : {}) },
        controller.signal,
      );
      if (controller.signal.aborted || downloadController.current !== controller) return;
      releaseDownload.current?.();
      releaseDownload.current = downloadPresentationStaticExport(result);
      setStatus("Download started. Check your browser’s downloads.");
    } catch (caught) {
      if (!controller.signal.aborted) {
        setStatus("");
        setError(humanError(caught));
      }
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      lang="en-CA"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.controls}>
        <h2 id={titleId}>Export presentation</h2>
        <button ref={closeButton} type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p>
        {source
          ? `Exports published version ${source.version}. `
          : "Exports the published version. "}
        Draft changes are excluded.
      </p>
      <p>
        PDF and PNG flatten interactive controls and motion, and may clip overflowing text. Choose
        accessible HTML for full readable text and panel details. Live answers and results are
        excluded from every format.
      </p>
      <p>Downloaded copies cannot be revoked. PDF is not tagged for screen readers.</p>
      <label>
        Format
        <select
          value={format}
          disabled={busy}
          onChange={(event) => {
            setFormat(event.target.value as PresentationStaticExportFormat);
            setError("");
            setStatus("");
          }}
        >
          <option value="pdf">PDF — whole presentation</option>
          <option value="png">PNG — one published page</option>
          <option value="html">Accessible HTML — whole presentation</option>
          <option value="offline_html">Offline interactive HTML — whole presentation</option>
        </select>
      </label>
      {format === "offline_html" ? (
        <section aria-label="Offline interactive HTML details">
          <h3>Offline interactive HTML</h3>
          <p>
            One downloadable .html file contains the published slides, readable content and images.
            Open it offline in a browser. All public details are included, even when a panel is
            closed.
          </p>
          <p>
            Open and close detail panels and use page, section, previous and next links inside the
            file. External links leave the offline file and may require internet.
          </p>
          <p>
            Questions are for reading only. No submissions, scoring, completion tracking or live
            results are available. Viewing progress is not saved.
          </p>
        </section>
      ) : null}
      {loading ? <p role="status">Loading published pages…</p> : null}
      {loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>
            Retry published pages
          </button>
        </div>
      ) : null}
      {format === "png" && source ? (
        <label>
          Published page
          <select
            value={blockId}
            disabled={busy}
            onChange={(event) => setBlockId(event.target.value)}
          >
            {source.pages.map((page, index) => (
              <option key={page.blockId} value={page.blockId}>
                {index + 1}. {page.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className={styles.controls}>
        <button
          type="button"
          disabled={loading || !source || busy || (format === "png" && !blockId)}
          onClick={() => void download()}
        >
          Download export
        </button>
        {busy ? (
          <button type="button" onClick={cancelExport}>
            Cancel export
          </button>
        ) : null}
      </div>
      {status ? <p role="status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </dialog>
  );
}
