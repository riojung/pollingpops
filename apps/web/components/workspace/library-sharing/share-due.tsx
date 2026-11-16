"use client";

import type { LibraryShareSummary } from "@openround/contracts";
import { useLocale } from "../../locale-provider";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import styles from "./library-sharing.module.css";

export function LibraryShareDue({
  dueAt,
  progress,
}: Pick<LibraryShareSummary, "dueAt" | "progress">) {
  const { locale } = useLocale();
  const copy = librarySharingMessages(locale);
  if (!dueAt) return null;
  const overdue = progress !== "done" && Date.parse(dueAt) < Date.now();
  return (
    <p className={styles.help}>
      {copy.reviewBy}:{" "}
      <time dateTime={dueAt}>
        {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(dueAt),
        )}
      </time>
      {overdue ? (
        <>
          {" "}
          · <strong>{copy.overdue}</strong>
        </>
      ) : null}
    </p>
  );
}
