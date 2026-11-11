"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RecoveryPackExportReport, SupportedLocale } from "@openround/contracts";
import {
  createPackExportReview,
  type PackExportFormat,
  type PackExportReviewState,
  type PackExportSource,
} from "../lib/recovery-pack-export";

import {
  packExportCopy,
  packExportFeedback,
  packExportDisposition,
  packExportFindingReason,
} from "../lib/i18n/pack-export-copy";

export function PackExportReportView({
  report,
  locale = "en-CA",
}: {
  report: RecoveryPackExportReport;
  locale?: SupportedLocale;
}) {
  const t = packExportCopy(locale);
  return (
    <div lang={locale} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <p lang="">{report.source.title}</p>
      <dl>
        <dt>{t("Frozen published version")}</dt>
        <dd lang="">
          {report.source.packVersion} · {report.source.packVersionId}
        </dd>
        <dt>{t("Content hash (SHA-256)")}</dt>
        <dd>
          <code lang="">{report.source.contentHash}</code>
        </dd>
        <dt>{t("Checkpoint projection")}</dt>
        <dd>
          {t("{exported} of {total} checkpoints exportable", {
            exported: report.exportedCheckpointCount,
            total: report.checkpointCount,
          })}{" "}
          · {report.format === "csv" ? "CSV" : "QTI 3"}
        </dd>
      </dl>
      <h4>{t("Export findings")}</h4>
      {report.findings.length ? (
        <ul aria-label={t("Export findings")}>
          {report.findings.map((finding, index) => (
            <li key={index}>
              <strong>
                {t(finding.severity === "error" ? "Error" : "Warning")}:{" "}
                <code lang="">{finding.code}</code>
              </strong>
              <p>
                <code lang="">{finding.fieldPath}</code> ·{" "}
                {packExportDisposition(locale, finding.disposition)} ·{" "}
                {t(
                  finding.affectedItems === 1 ? "{count} affected item" : "{count} affected items",
                  { count: finding.affectedItems },
                )}
              </p>
              <p lang={packExportFindingReason(locale, finding).lang}>
                {packExportFindingReason(locale, finding).text}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("No findings for this checkpoint projection.")}</p>
      )}
      {!report.canExport ? (
        <p className="notice">
          {t(
            "This format cannot export all checkpoints. Review the errors; the artifact download is unavailable. You can still download this report.",
          )}
        </p>
      ) : null}
    </div>
  );
}

export function RecoveryPackExportPanel({
  source,
  disabled = false,
  locale = "en-CA",
}: {
  source: PackExportSource;
  disabled?: boolean;
  locale?: SupportedLocale;
}) {
  const t = packExportCopy(locale);
  const formatId = useId();
  const headingId = useId();
  const [state, setState] = useState<PackExportReviewState>({
    format: "csv",
    report: null,
    busy: null,
    error: "",
    status: "",
  });
  const alive = useRef(true);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const errorParagraph = useRef<HTMLParagraphElement>(null);
  const manager = useRef<ReturnType<typeof createPackExportReview> | null>(null);
  if (!manager.current) {
    manager.current = createPackExportReview({
      source,
      onState: (next) => {
        if (alive.current) setState(next);
      },
    });
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      manager.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (state.error) errorParagraph.current?.focus();
    else if (state.report) reportHeading.current?.focus();
  }, [state.error, state.report]);
  return (
    <section
      lang={locale}
      aria-labelledby={headingId}
      style={{ minWidth: 0, overflowWrap: "anywhere", marginTop: 24 }}
    >
      <h3 id={headingId}>{t("Checkpoint portability")}</h3>
      <p>
        {t(
          "CSV and QTI 3 export checkpoint projections, not the whole Recovery Pack workflow. Review each format’s structured losses first. Polling Pops JSON keeps the complete Pack content; media references are included, not the private media files.",
        )}
      </p>
      <label className="field" htmlFor={formatId}>
        <span>{t("Published Pack export format")}</span>
        <select
          id={formatId}
          className="select"
          style={{ minWidth: 0, maxWidth: "100%" }}
          value={state.format}
          disabled={disabled || state.busy === "artifact"}
          onChange={(event) =>
            manager.current!.selectFormat(event.target.value as PackExportFormat)
          }
        >
          <option value="csv">{t("CSV checkpoints")}</option>
          <option value="qti3">{t("QTI 3 checkpoint package")}</option>
        </select>
      </label>
      <button
        className="button-quiet"
        style={{ minWidth: 0, maxWidth: "100%", whiteSpace: "normal" }}
        type="button"
        disabled={disabled || Boolean(state.busy)}
        onClick={() => void manager.current!.preview()}
      >
        {t("Review export losses")}
      </button>
      <p role="status" aria-live="polite" lang={packExportFeedback(locale, state.status).lang}>
        {packExportFeedback(locale, state.status).text}
      </p>
      {state.error ? (
        <p
          className="error"
          role="alert"
          tabIndex={-1}
          ref={errorParagraph}
          lang={packExportFeedback(locale, state.error).lang}
        >
          {packExportFeedback(locale, state.error).text}
        </p>
      ) : null}
      {state.report ? (
        <>
          <h4 tabIndex={-1} ref={reportHeading}>
            {t("Reviewed {format} export", { format: state.format === "csv" ? "CSV" : "QTI 3" })}
          </h4>
          <PackExportReportView report={state.report} locale={locale} />
        </>
      ) : null}
      <div className="button-row">
        <button
          className="button"
          style={{ minWidth: 0, maxWidth: "100%", whiteSpace: "normal" }}
          type="button"
          disabled={disabled || Boolean(state.busy) || !state.report?.canExport}
          onClick={() => void manager.current!.artifact()}
        >
          {t(state.format === "csv" ? "Download CSV checkpoints" : "Download QTI 3 package")}
        </button>
        <button
          className="button-quiet"
          style={{ minWidth: 0, maxWidth: "100%", whiteSpace: "normal" }}
          type="button"
          disabled={disabled || Boolean(state.busy) || !state.report}
          onClick={() => manager.current!.report()}
        >
          {t("Download export report JSON")}
        </button>
      </div>
    </section>
  );
}
