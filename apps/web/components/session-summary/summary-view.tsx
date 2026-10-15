"use client";

import type { AggregateSessionSummary, SummaryQuestion } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { formatDateTime, formatNumber } from "../../lib/i18n/format";
import styles from "./summary.module.css";

function QuestionResults({
  question,
  headingLevel,
}: {
  question: SummaryQuestion;
  headingLevel: 3 | 5;
}) {
  const { locale, t } = useLocale();
  const Heading = headingLevel === 3 ? "h3" : "h5";
  return (
    <section className={styles.question}>
      <Heading dir="auto" lang="">
        {question.prompt}
      </Heading>
      {question.purpose === "content" ? (
        <p>{t("summary.notAssessed")}</p>
      ) : (
        <>
          {question.respondents !== null ? (
            <p>{t("summary.sample", { count: formatNumber(locale, question.respondents) })}</p>
          ) : null}
          {question.suppression !== "none" ? (
            <p className="notice">{t(`summary.suppression.${question.suppression}`)}</p>
          ) : (
            <>
              {question.accuracy ? (
                <p>
                  {t("summary.accuracyValue", {
                    percent: formatNumber(locale, question.accuracy.percent),
                    correct: formatNumber(locale, question.accuracy.correct),
                    responses: formatNumber(locale, question.accuracy.responses),
                  })}
                </p>
              ) : question.purpose === "opinion" ? (
                <p>{t("summary.notScored")}</p>
              ) : null}
              {(question.maxSelections ?? 1) > 1 ? <p>{t("summary.multiSelect")}</p> : null}
              {question.results.length ? (
                <div
                  className={styles.tableWrap}
                  tabIndex={0}
                  role="region"
                  aria-label={t("summary.questionRegion", {
                    number: formatNumber(locale, question.index + 1),
                    prompt: question.prompt,
                  })}
                >
                  <table className="report-table">
                    <caption>{t(`summary.measure.${question.measure}`)}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("summary.response")}</th>
                        <th scope="col">{t("summary.value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {question.results.map((row, index) => (
                        <tr key={index}>
                          <th scope="row" dir="auto" lang="">
                            {row.label}
                          </th>
                          <td>{formatNumber(locale, row.value, { maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}

/** This component accepts only the strict public allowlist, never a private source report. */
export function SessionSummaryView({
  summary,
  headingLevel = 1,
}: {
  summary: AggregateSessionSummary;
  headingLevel?: 1 | 3;
}) {
  const { locale, t } = useLocale();
  const Heading = headingLevel === 1 ? "h1" : "h3";
  const SectionHeading = headingLevel === 1 ? "h2" : "h4";
  return (
    <article className={styles.summary} lang={locale}>
      <p className="eyebrow">{t("summary.title")}</p>
      <Heading dir="auto" lang="">
        {summary.title}
      </Heading>
      <p className="muted">{formatDateTime(locale, summary.finishedAt)}</p>
      <dl className={styles.metrics}>
        <div>
          <dt>{t("summary.participants")}</dt>
          <dd>{formatNumber(locale, summary.participantCount)}</dd>
        </div>
        <div>
          <dt>{t("summary.responses")}</dt>
          <dd>{formatNumber(locale, summary.responseCount)}</dd>
        </div>
        <div>
          <dt>{t("summary.questions")}</dt>
          <dd>{formatNumber(locale, summary.questionCount)}</dd>
        </div>
      </dl>
      <ul className={styles.notes}>
        {summary.noteCodes.map((code) => (
          <li key={code}>{t(`summary.note.${code}`)}</li>
        ))}
      </ul>
      {summary.initialAccuracy ? (
        <p>
          {t("summary.initialAccuracy", {
            percent: formatNumber(locale, summary.initialAccuracy.percent),
            correct: formatNumber(locale, summary.initialAccuracy.correct),
            responses: formatNumber(locale, summary.initialAccuracy.responses),
          })}
        </p>
      ) : null}
      {summary.recovery.length ? (
        <section>
          <SectionHeading>{t("summary.recovery")}</SectionHeading>
          <ul>
            {summary.recovery.map((item, index) => (
              <li key={index}>
                <span>{t(`summary.recovery.${item.kind}`)}</span>
                {" · "}
                <span dir="auto" lang="">
                  {item.label}
                </span>
                {" · "}
                {t("summary.recoveryValue", {
                  recovered: formatNumber(locale, item.recovered),
                  eligible: formatNumber(locale, item.eligible),
                  percent: formatNumber(locale, item.percent),
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {summary.questions.length ? (
        <section>
          <SectionHeading>{t("summary.results")}</SectionHeading>
          {summary.questions.map((question) => (
            <QuestionResults
              question={question}
              headingLevel={headingLevel === 1 ? 3 : 5}
              key={question.index}
            />
          ))}
        </section>
      ) : null}
      {summary.nextSteps ? (
        <section>
          <SectionHeading>{t("summary.nextSteps")}</SectionHeading>
          <p className={styles.authored} dir="auto" lang="">
            {summary.nextSteps}
          </p>
        </section>
      ) : null}
    </article>
  );
}
