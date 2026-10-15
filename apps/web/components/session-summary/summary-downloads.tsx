"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AggregateSessionSummary, SummaryExportFormat } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import {
  downloadSummaryBlob,
  fetchSummaryExport,
  type SummaryDownloadAccess,
} from "../../lib/session-summary-client";
import styles from "./summary.module.css";

export function SessionSummaryDownloads({
  access,
  summary,
  formats,
  nextSteps = "",
  disabled = false,
}: {
  access: SummaryDownloadAccess;
  summary: AggregateSessionSummary;
  formats: SummaryExportFormat[];
  nextSteps?: string;
  disabled?: boolean;
}) {
  const { locale, t } = useLocale();
  const imageContentId = useId();
  const [busy, setBusy] = useState<SummaryExportFormat | null>(null);
  const [questionIndex, setQuestionIndex] = useState(-1);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download(format: SummaryExportFormat) {
    if (busy || disabled || !formats.includes(format)) return;
    const current = new AbortController();
    controller.current?.abort();
    controller.current = current;
    setBusy(format);
    setError("");
    setStatus("");
    try {
      const blob = await fetchSummaryExport(
        access,
        {
          format,
          locale,
          nextSteps: nextSteps.trim(),
          ...(format === "png" && questionIndex >= 0 ? { questionIndex } : {}),
        },
        AbortSignal.any([current.signal, AbortSignal.timeout(30_000)]),
      );
      if (current.signal.aborted) return;
      downloadSummaryBlob(blob, format);
      setStatus(t("summary.downloaded"));
    } catch {
      if (!current.signal.aborted) setError(t("summary.downloadFailed"));
    } finally {
      if (!current.signal.aborted) setBusy(null);
    }
  }
  return (
    <div>
      {!formats.length ? (
        <p>{t("summary.downloadsUnavailable")}</p>
      ) : (
        <>
          {formats.includes("png") && summary.questions.length ? (
            <div className={styles.field}>
              <label htmlFor={imageContentId}>{t("summary.imageContent")}</label>
              <select
                id={imageContentId}
                className="select"
                value={questionIndex}
                disabled={Boolean(busy) || disabled}
                onChange={(event) => setQuestionIndex(Number(event.target.value))}
              >
                <option value={-1}>{t("summary.wholeSummary")}</option>
                {summary.questions.map((question) => (
                  <option key={question.index} value={question.index}>
                    {question.prompt}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className={styles.actions}>
            {formats.map((format) => (
              <button
                className="button-quiet"
                type="button"
                key={format}
                disabled={Boolean(busy) || disabled}
                onClick={() => void download(format)}
              >
                {t(busy === format ? "summary.working" : `summary.download.${format}`)}
              </button>
            ))}
          </div>
        </>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p className={status ? "success" : "sr-only"} role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
