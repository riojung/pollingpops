import type { FollowupSnapshot, SupportedLocale } from "@openround/contracts";
import { followupCopy } from "./i18n/followup-copy";
import { formatNumber } from "./i18n/format";

export function followupStatusAnnouncement(
  snapshot: FollowupSnapshot | null,
  locale: SupportedLocale = "en-CA",
) {
  const copy = followupCopy(locale);
  if (!snapshot) return copy("Opening your private practice.");
  if (snapshot.status === "completed" || snapshot.phase === "completed") {
    return copy(snapshot.purpose === "assignment" ? "Practice complete." : "Follow-up complete.");
  }
  if (snapshot.phase === "intervention" && snapshot.intervention) {
    return copy("Recovery guidance card {current} of {total}: {title}. No countdown.", {
      current: formatNumber(locale, snapshot.intervention.index + 1),
      total: formatNumber(locale, snapshot.intervention.count),
      title: snapshot.intervention.card.title,
    });
  }

  const position = (snapshot.questionIndex ?? 0) + 1;
  return copy(
    snapshot.phase === "answer_reveal"
      ? "Question {current} of {total}: feedback available."
      : "Question {current} of {total}: ready for your response.",
    {
      current: formatNumber(locale, position),
      total: formatNumber(locale, snapshot.questionCount),
    },
  );
}
