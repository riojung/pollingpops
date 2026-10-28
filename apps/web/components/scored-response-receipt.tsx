"use client";

import type { SessionSnapshot } from "@openround/contracts";
import { formatNumber } from "../lib/i18n/format";
import { scoredResponseCopy } from "../lib/i18n/scored-response-copy";
import { useLocale } from "./locale-provider";
import styles from "./scored-response-receipt.module.css";

export function ScoredResponseReceipt({
  responseSummary,
}: {
  responseSummary?: SessionSnapshot["myScoredResponseSummary"];
}) {
  const { locale } = useLocale();
  if (!responseSummary || responseSummary.revealedScoredQuestions === 0) return null;
  const copy = scoredResponseCopy[locale];
  const { answeredScoredQuestions, correctScoredQuestions, revealedScoredQuestions } =
    responseSummary;
  const result =
    answeredScoredQuestions === 0
      ? copy.unanswered
      : correctScoredQuestions === 0
        ? copy.noneCorrect
        : null;

  return (
    <div
      className={styles.receipt}
      aria-label={copy.title}
      data-testid="scored-response-receipt"
      lang={locale}
      role="status"
    >
      <strong>{copy.title}</strong>
      <p className={styles.scope}>{copy.scope}</p>
      <dl className={styles.metrics}>
        <div>
          <dt>{copy.saved}</dt>
          <dd>
            {formatNumber(locale, answeredScoredQuestions)} /{" "}
            {formatNumber(locale, revealedScoredQuestions)}
          </dd>
        </div>
        <div>
          <dt>{copy.correct}</dt>
          <dd>{formatNumber(locale, correctScoredQuestions)}</dd>
        </div>
      </dl>
      {result ? <p className={styles.result}>{result}</p> : null}
    </div>
  );
}
