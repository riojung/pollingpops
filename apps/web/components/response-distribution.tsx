import type { SessionSnapshot } from "@openround/contracts";
import { useLocale } from "./locale-provider";
import { RankingDistribution } from "./ranking-distribution";

export function ResponseDistributionView({
  distribution,
}: {
  distribution: NonNullable<SessionSnapshot["responseDistribution"]>;
}) {
  const { t } = useLocale();
  if (distribution.kind === "ranking")
    return (
      <section aria-label={t("live.distribution.ariaLabel")} className="distribution-card">
        <strong>{t("live.distribution.title")}</strong>
        <RankingDistribution distribution={distribution} />
      </section>
    );
  if (distribution.kind === "numeric") {
    const correctPercent = Math.round((distribution.correct / distribution.respondents) * 100);
    return (
      <section aria-label={t("live.distribution.ariaLabel")} className="distribution-card">
        <strong>{t("live.distribution.title")}</strong>
        <p>
          {t("live.distribution.numericSummary", {
            correct: distribution.correct,
            incorrect: distribution.incorrect,
            percent: correctPercent,
          })}
        </p>
      </section>
    );
  }

  return (
    <section aria-label={t("live.distribution.ariaLabel")} className="distribution-card">
      <strong>{t("live.distribution.title")}</strong>
      <p className="muted">
        {t("live.distribution.respondents", { count: distribution.respondents })}
        {distribution.kind === "choice" && distribution.percentBasis === "respondents"
          ? t("live.distribution.multipleChoiceNote")
          : ""}
      </p>
      <ul className="distribution-list">
        {distribution.buckets.map((bucket) => (
          <li key={bucket.value}>
            <span lang="">{bucket.label}</span>
            <span aria-hidden="true" className="distribution-track">
              <span style={{ width: `${bucket.percent}%` }} />
            </span>
            <strong>
              {bucket.count} · {bucket.percent}%
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
