import type { SessionSnapshot } from "@openround/contracts";
import { formatNumber } from "../lib/i18n/format";
import { useLocale } from "./locale-provider";
import { RankingDistribution } from "./ranking-distribution";
import styles from "./response-distribution.module.css";

export function ResponseDistributionView({
  animate = false,
  distribution,
  variant = "default",
}: {
  animate?: boolean;
  distribution: NonNullable<SessionSnapshot["responseDistribution"]>;
  variant?: "default" | "presenter";
}) {
  const { locale, t } = useLocale();
  const presenter = variant === "presenter";
  const sectionProps = {
    "aria-label": t("live.distribution.ariaLabel"),
    className: presenter ? `distribution-card ${styles.presenter}` : "distribution-card",
    "data-testid": presenter ? "round-presenter-distribution" : undefined,
  };
  if (distribution.kind === "ranking")
    return (
      <section {...sectionProps}>
        <strong>{t("live.distribution.title")}</strong>
        <RankingDistribution distribution={distribution} />
      </section>
    );
  if (distribution.kind === "numeric") {
    const correctPercent = Math.round((distribution.correct / distribution.respondents) * 100);
    return (
      <section {...sectionProps}>
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
    <section {...sectionProps} data-revealing={presenter && animate ? "true" : undefined}>
      <strong>{t("live.distribution.title")}</strong>
      <p className="muted">
        {t("live.distribution.respondents", { count: distribution.respondents })}
        {distribution.kind === "choice" && distribution.percentBasis === "respondents"
          ? t("live.distribution.multipleChoiceNote")
          : ""}
      </p>
      <ul className={`distribution-list ${styles.list}`}>
        {distribution.buckets.map((bucket) => (
          <li key={bucket.value}>
            <span lang="">{bucket.label}</span>
            <span aria-hidden="true" className={`distribution-track ${styles.track}`}>
              <span style={{ width: `${bucket.percent}%` }} />
            </span>
            <strong>
              {formatNumber(locale, bucket.count)} ·{" "}
              {formatNumber(locale, bucket.percent / 100, {
                style: "percent",
                maximumFractionDigits: 2,
              })}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
