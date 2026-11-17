import { questionTypeDefinition, type QuestionDraft } from "@openround/contracts";
import type { QuestionUpdater } from "./types";
import { useLocale } from "../locale-provider";
import { authoringWorkflowCopy } from "./authoring-workflow-copy";
import { roundToolsCopy } from "../../lib/i18n/round-tools-copy";
import { RoundToolSection } from "./round-tool-section";
import styles from "./round-tools.module.css";

export function DeliveryScoring({
  question,
  onUpdateQuestion,
  uxBeta = true,
}: {
  question: QuestionDraft;
  onUpdateQuestion: QuestionUpdater;
  uxBeta?: boolean;
}) {
  const { t, locale } = useLocale();
  const authoring = authoringWorkflowCopy(locale);
  const copy = roundToolsCopy(locale);
  const scored = questionTypeDefinition(question.type).scored;
  // Imported content may use an allowed value outside the shortcuts offered by the editor.
  const secondsOptions = [
    ...new Set([5, 10, 20, 30, 60, 90, 120, 300, question.timeLimitSeconds]),
  ].sort((a, b) => a - b);
  const pointsOptions = [...new Set([0, 500, 1000, 2000, question.basePoints])].sort(
    (a, b) => a - b,
  );
  const timing = (
    <>
      <div
        className={uxBeta ? styles.fields : "toolbar"}
        style={uxBeta ? undefined : { marginTop: 22 }}
      >
        <label
          className={uxBeta ? styles.field : "field"}
          style={uxBeta ? undefined : { flex: "1 1 180px", marginBottom: 0 }}
        >
          <span>{t("delivery.builder.timeLimit")}</span>
          <select
            className="select"
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                timeLimitSeconds: Number(event.target.value),
              }))
            }
            value={question.timeLimitSeconds}
          >
            {secondsOptions.map((seconds) => (
              <option key={seconds} value={seconds}>
                {authoring.seconds.replace(
                  "{count}",
                  new Intl.NumberFormat(locale).format(seconds),
                )}
              </option>
            ))}
          </select>
        </label>
        <label
          className={uxBeta ? styles.field : "field"}
          style={uxBeta ? undefined : { flex: "1 1 180px", marginBottom: 0 }}
        >
          <span>{t("delivery.builder.basePoints")}</span>
          <select
            aria-describedby={!scored && uxBeta ? `opinion-scoring-${question.id}` : undefined}
            className="select"
            disabled={!scored}
            onChange={(event) => {
              if (!scored) return;
              onUpdateQuestion((item) =>
                questionTypeDefinition(item.type).scored
                  ? { ...item, basePoints: Number(event.target.value) }
                  : item,
              );
            }}
            value={question.basePoints}
          >
            {pointsOptions.map((points) => (
              <option key={points} value={points}>
                {new Intl.NumberFormat(locale).format(points)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!scored && uxBeta ? (
        <p className={styles.notice} id={`opinion-scoring-${question.id}`} lang={locale}>
          {copy("This question collects opinions and does not award points.")}
        </p>
      ) : null}
    </>
  );
  const explanation = (
    <div className={uxBeta ? styles.field : "field"} style={uxBeta ? undefined : { marginTop: 22 }}>
      <label htmlFor="explanation">{t("delivery.builder.explanationAfterReveal")}</label>
      <textarea
        className="textarea"
        id="explanation"
        lang=""
        maxLength={1000}
        rows={4}
        onChange={(event) =>
          onUpdateQuestion((item) => ({ ...item, explanation: event.target.value }))
        }
        value={question.explanation}
      />
      {uxBeta ? (
        <span aria-hidden="true" className={styles.count} lang={locale}>
          {new Intl.NumberFormat(locale).format(question.explanation.length)} /{" "}
          {new Intl.NumberFormat(locale).format(1000)}
        </span>
      ) : null}
    </div>
  );
  if (!uxBeta)
    return (
      <>
        {timing}
        {explanation}
      </>
    );
  return (
    <div lang={locale}>
      <RoundToolSection defaultOpen title={copy("Timing and scoring")}>
        {timing}
      </RoundToolSection>
      <RoundToolSection
        description={copy(
          "Explain the reasoning participants should take away after the answer is revealed.",
        )}
        title={copy("Answer explanation")}
      >
        {explanation}
      </RoundToolSection>
    </div>
  );
}
