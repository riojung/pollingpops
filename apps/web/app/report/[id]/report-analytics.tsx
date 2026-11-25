import { useState, type ReactNode } from "react";
import type { Report } from "@openround/contracts";
import { useLocale } from "../../../components/locale-provider";
import { formatNumber } from "../../../lib/i18n/format";
import { roundReportAnalyticsCopy } from "../../../lib/i18n/round-report-analytics-copy";
import { roundReportWorkspaceCopy } from "../../../lib/i18n/round-report-workspace-copy";
import { roundReportAnalytics } from "../../../lib/round-report-analytics";
import styles from "./report-analytics.module.css";

type AnalyticsDestination = "questions" | "evidence" | "interactions";
type QuestionFilter = "all" | "assessment" | "opinion";
type QuestionOrder = "round" | "responses";

function Metric({
  label,
  value,
  detail,
  sampleNote,
}: {
  label: string;
  value: string;
  detail?: string;
  sampleNote?: string;
}) {
  return (
    <div className={styles.metric}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <dd className={styles.metricDetail}>{detail}</dd> : null}
      {sampleNote ? <dd className={styles.sampleNote}>{sampleNote}</dd> : null}
    </div>
  );
}

function Breakdown({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.breakdownRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ReportAnalytics({
  report,
  active,
  onSelectTab,
}: {
  report: Report;
  active: boolean;
  onSelectTab: (tab: AnalyticsDestination) => void;
}) {
  const { locale } = useLocale();
  const [filter, setFilter] = useState<QuestionFilter>("all");
  const [order, setOrder] = useState<QuestionOrder>("round");
  if (!active) return null;

  const copy = roundReportAnalyticsCopy(locale);
  const workspaceCopy = roundReportWorkspaceCopy(locale);
  const analytics = roundReportAnalytics(report);
  const { participation, questionSummary, qna, conversation, accuracy, recovery } = analytics;
  const count = (value: number) => formatNumber(locale, value);
  const percent = (value: number) =>
    formatNumber(locale, value / 100, { style: "percent", maximumFractionDigits: 1 });
  const unavailable = copy("unavailable");
  const respondents = participation ? count(participation.respondents) : unavailable;
  const respondentCoverage = participation?.participants
    ? copy("respondentCoverage", {
        respondents: participation.respondents,
        participants: participation.participants,
      })
    : respondents;
  const questions = analytics.questions.filter(
    (question) => filter === "all" || filter === question.kind,
  );
  if (order === "responses") {
    questions.sort((a, b) => b.responses - a.responses || a.number - b.number);
  }

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <h2>{copy("title")}</h2>
        <button
          className="button-quiet small-button"
          type="button"
          onClick={() => onSelectTab("questions")}
        >
          {workspaceCopy("allQuestions")} <span aria-hidden="true">↗</span>
        </button>
      </header>

      <dl className={styles.metrics}>
        <Metric label={copy("joined")} value={count(analytics.joined)} />
        <Metric
          label={copy("responded")}
          value={respondentCoverage}
          detail={
            participation?.percent != null
              ? copy("responseRate", { percent: percent(participation.percent) })
              : copy("responseRateUnavailable")
          }
        />
        <Metric
          label={copy("submissions")}
          value={count(analytics.submissions)}
          detail={copy("includesRechecks")}
        />
        <Metric
          label={copy("questionsWithResponses")}
          value={
            analytics.questions.length
              ? copy("questionCoverage", {
                  answered: questionSummary.answered,
                  total: analytics.questions.length,
                })
              : unavailable
          }
        />
      </dl>

      <div className={styles.evidenceGrid}>
        <section className={styles.card} aria-labelledby="round-analytics-questions">
          <div className={styles.cardHeading}>
            <h3 id="round-analytics-questions">{copy("questionActivity")}</h3>
            <p>{copy("questionActivityHelp")}</p>
          </div>
          {analytics.questions.length ? (
            <>
              <dl className={styles.responseTotals}>
                <Breakdown
                  label={copy("assessmentResponses")}
                  value={count(questionSummary.assessmentSubmissions)}
                />
                <Breakdown
                  label={copy("opinionResponses")}
                  value={count(questionSummary.opinionSubmissions)}
                />
              </dl>
              <div className={styles.controls}>
                <label>
                  {copy("questionFilter")}
                  <select
                    className="select"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as QuestionFilter)}
                  >
                    <option value="all">{copy("allQuestions")}</option>
                    <option value="assessment">{copy("assessments")}</option>
                    <option value="opinion">{copy("opinions")}</option>
                  </select>
                </label>
                <label>
                  {copy("questionOrder")}
                  <select
                    className="select"
                    value={order}
                    onChange={(event) => setOrder(event.target.value as QuestionOrder)}
                  >
                    <option value="round">{copy("roundOrder")}</option>
                    <option value="responses">{copy("mostResponses")}</option>
                  </select>
                </label>
              </div>
              {questions.length ? (
                <ul className={styles.questionList} role="list">
                  {questions.map((question) => (
                    <li key={question.id} className={styles.question}>
                      <div className={styles.questionHeader}>
                        <div className={styles.questionLabels}>
                          <span>{copy("questionNumber", { number: question.number })}</span>
                          <span className={styles.questionKind} data-kind={question.kind}>
                            {copy(question.kind)}
                          </span>
                        </div>
                        <strong>{copy("responseCount", { count: question.responses })}</strong>
                      </div>
                      <p lang="">{question.prompt}</p>
                      <div className={styles.bar} aria-hidden="true" data-kind={question.kind}>
                        <span
                          style={{
                            width: `${questionSummary.maximumResponses ? (question.responses / questionSummary.maximumResponses) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty} role="status">
                  {copy("noFilterMatches")}
                </p>
              )}
            </>
          ) : (
            <p className={styles.empty}>{workspaceCopy("noQuestionsBody")}</p>
          )}
        </section>

        <div className={styles.sidebar}>
          <section className={styles.card} aria-labelledby="round-analytics-interactions">
            <div className={styles.cardHeading}>
              <h3 id="round-analytics-interactions">{copy("engagement")}</h3>
            </div>
            <div className={styles.breakdown}>
              <h4>{copy("qna")}</h4>
              {qna ? (
                <dl>
                  <Breakdown label={copy("questionsRaised")} value={count(qna.questions)} />
                  <Breakdown label={copy("answered")} value={count(qna.answered)} />
                  <Breakdown label={copy("unresolved")} value={count(qna.unresolved)} />
                </dl>
              ) : (
                <p>{copy("qnaUnavailable")}</p>
              )}
            </div>
            {conversation ? (
              <>
                <div className={styles.breakdown}>
                  <h4>{copy("pulse")}</h4>
                  <dl>
                    <Breakdown
                      label={copy("peopleSignaled")}
                      value={count(conversation.pulseParticipants)}
                    />
                    <Breakdown
                      label={copy("pulseChanges")}
                      value={count(conversation.pulseEvents)}
                    />
                  </dl>
                </div>
                <div className={styles.breakdown}>
                  <h4>{copy("chat")}</h4>
                  <dl>
                    <Breakdown label={copy("chatMessages")} value={count(conversation.messages)} />
                    <Breakdown label={copy("reactions")} value={count(conversation.reactions)} />
                  </dl>
                </div>
                <button
                  className={styles.detailLink}
                  type="button"
                  onClick={() => onSelectTab("interactions")}
                >
                  {copy("viewConversation")} <span aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <p className={styles.empty}>{copy("conversationUnavailable")}</p>
            )}
          </section>

          <section
            className={`${styles.card} ${styles.learning}`}
            aria-labelledby="round-analytics-learning"
          >
            <div className={styles.cardHeading}>
              <h3 id="round-analytics-learning">{copy("learning")}</h3>
            </div>
            <dl className={styles.learningMetrics}>
              <Metric
                label={copy("initialAccuracy")}
                value={accuracy ? percent(accuracy.percent) : unavailable}
                sampleNote={accuracy && accuracy.responses < 5 ? copy("smallSample") : undefined}
                detail={
                  accuracy
                    ? copy("correctOutOf", { correct: accuracy.correct, total: accuracy.responses })
                    : undefined
                }
              />
              <Metric
                label={copy("pairedRecovery")}
                value={recovery ? percent(recovery.percent) : unavailable}
                sampleNote={recovery?.smallSample ? copy("smallSample") : undefined}
                detail={
                  recovery
                    ? copy("recoveryOutOf", {
                        recovered: recovery.recovered,
                        total: recovery.denominator,
                      })
                    : undefined
                }
              />
            </dl>
            {"initialAccuracy" in report ? (
              <button
                className={styles.detailLink}
                type="button"
                onClick={() => onSelectTab("evidence")}
              >
                {copy("viewEvidence")} <span aria-hidden="true">→</span>
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
