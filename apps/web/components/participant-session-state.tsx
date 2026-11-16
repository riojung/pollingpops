"use client";

import type { SessionSnapshot } from "@openround/contracts";
import { participantProgressStage } from "../lib/participant-response";
import { liveWorkflowCopy } from "../lib/i18n/live-workflow-copy";
import { formatNumber } from "../lib/i18n/format";
import { useLocale } from "./locale-provider";
import styles from "./participant-session-state.module.css";

export function ParticipantSessionState({
  snapshot,
  saved,
}: {
  snapshot: SessionSnapshot;
  saved: boolean;
}) {
  const { locale, t } = useLocale();
  const copy = liveWorkflowCopy(locale);
  const stage = participantProgressStage(snapshot, saved);
  const acceptedCurrentAnswer =
    saved && ["question_open", "question_locked"].includes(snapshot.phase);
  const label =
    stage === "saved" || acceptedCurrentAnswer
      ? copy.answerReceived
      : stage === "complete"
        ? t("live.common.complete")
        : copy[stage];
  return (
    <p className={styles.state} role="status">
      <span aria-hidden="true" className={styles.dot} />
      <strong>{label}</strong>
    </p>
  );
}

export function ParticipantCompletion({
  snapshot,
  score,
}: {
  snapshot: SessionSnapshot;
  score?: number;
}) {
  const { locale } = useLocale();
  const copy = liveWorkflowCopy(locale);
  // Missing summaries in old rooms are not evidence of an assessed activity.
  const scored =
    (snapshot.myScoredResponseSummary?.revealedScoredQuestions ?? 0) > 0 || (score ?? 0) > 0;
  return (
    <p className="lead" lang={locale}>
      {scored && score !== undefined
        ? copy.finalScore.replace("{score}", formatNumber(locale, score))
        : copy.participationComplete}
    </p>
  );
}
