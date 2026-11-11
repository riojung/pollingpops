"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@openround/contracts";
import { recordPracticeAssignmentShared } from "../workspace/product-events";
import { practiceLinksCsv, type CreatedPractice } from "../../lib/practice-assignment";
import { packPracticeDetailCopy } from "../../lib/i18n/pack-practice-detail-copy";
import styles from "./practice.module.css";

type ReceiptStatus =
  | { kind: "generic_copied" }
  | { kind: "personal_copied"; label: string }
  | { kind: "downloaded" }
  | { kind: "copy_failed" };

export function PracticeLinkReceipt({
  created,
  locale = "en-CA",
}: {
  created: CreatedPractice;
  locale?: SupportedLocale;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState<ReceiptStatus | null>(null);
  const copyText = packPracticeDetailCopy(locale);
  useEffect(() => heading.current?.focus(), []);

  async function copy(
    url: string,
    result: Extract<ReceiptStatus, { kind: "generic_copied" | "personal_copied" }>,
  ) {
    setStatus(null);
    try {
      await navigator.clipboard.writeText(url);
      recordPracticeAssignmentShared();
      setStatus(result);
    } catch {
      setStatus({ kind: "copy_failed" });
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([practiceLinksCsv(created)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `polling-pops-practice-${created.followup.id}-links.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    recordPracticeAssignmentShared();
    setStatus({ kind: "downloaded" });
  }

  // Keep the authored name in its own language span, outside the translated template.
  const [personalStatusBefore, personalStatusAfter] = copyText("{label} copied.", {
    label: "{label}",
  }).split("{label}");
  const success =
    status?.kind === "generic_copied" ? (
      copyText("Generic link copied.")
    ) : status?.kind === "personal_copied" ? (
      <>
        {personalStatusBefore}
        <span lang="">{status.label}</span>
        {personalStatusAfter}
      </>
    ) : status?.kind === "downloaded" ? (
      copyText("Private practice links downloaded.")
    ) : null;

  return (
    <section
      className={`${styles.receipt} ${styles.packPracticeReceipt}`}
      aria-labelledby="pack-practice-receipt-heading"
      lang={locale}
    >
      <p className="eyebrow">{copyText("Practice assignment created")}</p>
      <h2 id="pack-practice-receipt-heading" ref={heading} tabIndex={-1}>
        {copyText("Save your private links")}
      </h2>
      <p>
        {created.followup.recoveryPackSource?.role === "full_sequence"
          ? copyText(
              "This assignment contains the frozen diagnostic, intervention cards, and linked recheck, not the optional delayed probe or a delayed recovery trail.",
            )
          : copyText(
              "This assignment contains one frozen delayed probe, not the full Recovery Pack or a delayed recovery trail.",
            )}{" "}
        {copyText("Existing assignments do not change when the source Pack changes or is deleted.")}
      </p>
      <p>
        {copyText(
          "Save or download these links now. Polling Pops stores only token hashes; these exact links are not displayed again in practice management. Keep them private.",
        )}
      </p>
      <div className={styles.linkBox}>
        <div className={styles.linkRow}>
          <label className="field" htmlFor="pack-practice-generic-link">
            <span>{copyText("Generic anonymous practice link")}</span>
            <input
              className="input"
              id="pack-practice-generic-link"
              lang=""
              readOnly
              value={created.genericUrl}
            />
          </label>
          <button
            className="button-quiet"
            onClick={() => void copy(created.genericUrl, { kind: "generic_copied" })}
            type="button"
          >
            {copyText("Copy")}
          </button>
        </div>
        {created.personalAccess.length ? <h3>{copyText("One-attempt personal links")}</h3> : null}
        <ul className={styles.personalLinks}>
          {created.personalAccess.map((access) => (
            <li className={styles.linkRow} key={access.id}>
              <label className="field" htmlFor={`pack-practice-link-${access.id}`}>
                <span lang="">{access.nickname ?? access.label}</span>
                <input
                  className="input"
                  id={`pack-practice-link-${access.id}`}
                  lang=""
                  readOnly
                  value={access.url ?? ""}
                />
              </label>
              <button
                className="button-quiet"
                disabled={!access.url}
                onClick={() =>
                  access.url &&
                  void copy(access.url, {
                    kind: "personal_copied",
                    label: access.nickname ?? access.label,
                  })
                }
                type="button"
              >
                {copyText("Copy")}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {status?.kind === "copy_failed" ? (
        <p className="error" role="alert">
          {copyText("Copy was blocked. Select and copy the link instead.")}
        </p>
      ) : null}
      <p aria-live="polite" className={success ? "success" : "sr-only"} role="status">
        {success}
      </p>
      <div className={styles.receiptActions}>
        <button className="button" onClick={download} type="button">
          {copyText("Download links CSV")}
        </button>
        <Link className="button-quiet" href={`/practice/${created.followup.id}`}>
          {copyText("Manage practice")}
        </Link>
        <Link className="button-quiet" href="/recovery-packs">
          {copyText("Done")}
        </Link>
      </div>
    </section>
  );
}
