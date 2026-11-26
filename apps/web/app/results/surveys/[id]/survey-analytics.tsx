import { useLocale } from "../../../../components/locale-provider";
import { formatNumber } from "../../../../lib/i18n/format";
import styles from "../../../../components/workspace/workspace-content.module.css";
import { evidencePercent } from "../../results-overview-model";
import {
  surveyAverageRating,
  type SurveyAggregateQuestion,
  type surveyAnalyticsOverview,
} from "./survey-analytics-model";
import reportStyles from "./survey-results.module.css";

const percentOptions = { style: "percent", maximumFractionDigits: 1 } as const;

export function SurveyAnalytics({
  overview,
  submittedCount,
}: {
  overview: NonNullable<ReturnType<typeof surveyAnalyticsOverview>>;
  submittedCount: number;
}) {
  const { locale, t } = useLocale();
  const submitted = formatNumber(locale, submittedCount);
  return (
    <section
      className={`${styles.panel} ${reportStyles.panel} ${reportStyles.analytics}`}
      aria-labelledby="survey-analytics-heading"
    >
      <h2 id="survey-analytics-heading">{t("pages.results.surveyAnalytics")}</h2>
      <dl className={reportStyles.metrics}>
        <div>
          <dt>{t("pages.results.surveyFinalizedSubmissions")}</dt>
          <dd>{submitted}</dd>
        </div>
        <div>
          <dt>{t("pages.results.surveyQuestionsWithResults")}</dt>
          <dd>
            {t("pages.results.surveyAvailableQuestionCount", {
              available: formatNumber(locale, overview.questions.length),
              total: formatNumber(locale, overview.totalQuestions),
            })}
          </dd>
        </div>
      </dl>
      <h3 className={reportStyles.coverageHeading}>{t("pages.results.surveyQuestionCoverage")}</h3>
      {overview.questions.length ? (
        <>
          <p className={reportStyles.coverageNote}>{t("pages.results.surveyCoverageNote")}</p>
          <ul className={reportStyles.coverage} role="list">
            {overview.questions.map((question) => (
              <li key={question.id}>
                <div>
                  <a href={`#survey-question-${question.id}`}>
                    {t("pages.results.surveyQuestionNumber", {
                      number: formatNumber(locale, question.position),
                    })}
                    {" · "}
                    <span lang="">{question.prompt}</span>
                  </a>
                  <strong>{formatNumber(locale, question.percent / 100, percentOptions)}</strong>
                </div>
                <span className={reportStyles.responseBar} aria-hidden="true">
                  <span style={{ width: `${question.percent}%` }} />
                </span>
                <small>
                  {t("pages.results.surveyCoverageDetail", {
                    answered: formatNumber(locale, question.answeredCount),
                    submitted,
                  })}
                </small>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={reportStyles.coverageNote}>{t("pages.results.surveyNoDistributions")}</p>
      )}
    </section>
  );
}

export function SurveyQuestionResults({
  question,
  position,
  answeredCount,
}: {
  question: SurveyAggregateQuestion;
  position: number;
  answeredCount?: number;
}) {
  const { locale, t } = useLocale();
  const average = answeredCount === undefined ? null : surveyAverageRating(question);
  return (
    <section className={reportStyles.question}>
      <h3 id={`survey-question-${question.id}`} lang="" tabIndex={-1}>
        {question.prompt}
      </h3>
      {answeredCount === undefined ? (
        <p className="notice">{t("pages.results.surveyQuestionSuppressed")}</p>
      ) : (
        <>
          <p>
            {t("pages.results.surveyResponses", { count: formatNumber(locale, answeredCount) })}
          </p>
          {average !== null ? (
            <dl className={reportStyles.ratingSummary}>
              <div>
                <dt>{t("pages.results.surveyAverageRating")}</dt>
                <dd>{formatNumber(locale, average, { maximumFractionDigits: 1 })}</dd>
              </div>
            </dl>
          ) : null}
          {(question.maxSelections ?? 1) > 1 ? (
            <p>{t("pages.results.surveyMultipleSelections")}</p>
          ) : null}
          <div
            className={reportStyles.tableContainer}
            role="region"
            aria-label={t("summary.questionRegion", {
              number: formatNumber(locale, position),
              prompt: question.prompt,
            })}
            tabIndex={0}
          >
            <table className={reportStyles.distribution}>
              <caption id={`survey-counts-${question.id}`}>
                {t("pages.results.surveyResponseCounts")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("pages.results.surveyResponse")}</th>
                  <th scope="col">{t("pages.results.surveyCount")}</th>
                  <th scope="col">{t("pages.results.surveyShareOfResponses")}</th>
                </tr>
              </thead>
              <tbody>
                {question.distribution.map((row, index) => {
                  const percent = evidencePercent(row.count, answeredCount)!;
                  return (
                    <tr key={index}>
                      <th scope="row" lang="">
                        {row.label}
                      </th>
                      <td>{formatNumber(locale, row.count)}</td>
                      <td>
                        {formatNumber(locale, percent / 100, percentOptions)}
                        <span className={reportStyles.responseBar} aria-hidden="true">
                          <span style={{ width: `${percent}%` }} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
