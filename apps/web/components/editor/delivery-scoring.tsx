import { questionTypeDefinition } from "@openround/contracts";
import type { QuestionDraft } from "@openround/contracts";
import type { QuestionUpdater } from "./types";
import { useLocale } from "../locale-provider";

export function DeliveryScoring({
  question,
  onUpdateQuestion,
}: {
  question: QuestionDraft;
  onUpdateQuestion: QuestionUpdater;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className="toolbar" style={{ marginTop: 22 }}>
        <label className="field" style={{ flex: "1 1 180px", marginBottom: 0 }}>
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
            {[5, 10, 20, 30, 60, 90, 120, 300].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} seconds
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 180px", marginBottom: 0 }}>
          <span>{t("delivery.builder.basePoints")}</span>
          <select
            className="select"
            disabled={!questionTypeDefinition(question.type).scored}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                basePoints: Number(event.target.value),
              }))
            }
            value={question.basePoints}
          >
            {[0, 500, 1000, 2000].map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field" style={{ marginTop: 22 }}>
        <label htmlFor="explanation">{t("delivery.builder.explanationAfterReveal")}</label>
        <textarea
          className="textarea"
          id="explanation"
          maxLength={1000}
          onChange={(event) =>
            onUpdateQuestion((item) => ({ ...item, explanation: event.target.value }))
          }
          value={question.explanation}
        />
      </div>
    </>
  );
}
