import type { ResponseDistribution } from "@openround/contracts";
import { useLocale } from "./locale-provider";
import { formatNumber } from "../lib/i18n/format";

export function RankingDistribution({
  distribution,
}: {
  distribution: Extract<ResponseDistribution, { kind: "ranking" }>;
}) {
  const { locale, t } = useLocale();
  return (
    <div>
      <p className="muted">
        {t("live.ranking.summary", {
          respondents: distribution.respondents,
          count: distribution.rankCount,
        })}
      </p>
      <p className="muted">
        {t("live.ranking.weights", { firstPoints: distribution.buckets.length })}
      </p>
      <div
        role="region"
        aria-label={t("live.ranking.results")}
        style={{ overflowX: "auto" }}
        tabIndex={0}
      >
        <table className="report-table ranking-results-table">
          <caption className="sr-only">{t("live.ranking.results")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("live.ranking.option")}</th>
              <th scope="col">{t("live.ranking.score")}</th>
              <th scope="col">{t("live.ranking.rankedBy")}</th>
              <th scope="col">{t("live.ranking.averageRank")}</th>
            </tr>
          </thead>
          <tbody>
            {distribution.buckets.map((bucket) => (
              <tr key={bucket.value}>
                <th scope="row" lang="">
                  {bucket.label}
                </th>
                <td>{formatNumber(locale, bucket.weightedScore)}</td>
                <td>{formatNumber(locale, bucket.rankedRespondents)}</td>
                <td>
                  {bucket.averageRank === null
                    ? "—"
                    : formatNumber(locale, bucket.averageRank, { maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
