import { questionTypeDefinition } from "@openround/contracts";
import type { QuestionDraft } from "@openround/contracts";
import { BetaDisclosure } from "./beta-disclosure";
import { responseTypeLabel } from "./question-labels";
import type { QuestionUpdater } from "./types";
import { useLocale } from "../locale-provider";

export function DiagnosticDetails({
  question,
  questions,
  uxBeta,
  onUpdateQuestion,
}: {
  question: QuestionDraft;
  questions: QuestionDraft[];
  uxBeta: boolean;
  onUpdateQuestion: QuestionUpdater;
}) {
  const { t } = useLocale();
  return (
    <BetaDisclosure
      className="editor-disclosure"
      enabled={uxBeta}
      id="question-diagnostic-details"
      summary={t("delivery.builder.diagnosticDetailsAndRecheck")}
    >
      <div className="toolbar">
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span lang="en-CA">Purpose</span>
          <select
            className="select"
            disabled={!questionTypeDefinition(question.type).scored}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                purpose: event.target.value as "diagnostic" | "practice" | "opinion",
              }))
            }
            value={
              question.purpose ??
              (!questionTypeDefinition(question.type).scored ? "opinion" : "diagnostic")
            }
          >
            <option lang="en-CA" value="diagnostic">
              Diagnostic
            </option>
            <option lang="en-CA" value="practice">
              Practice
            </option>
            <option lang="en-CA" value="opinion">
              Opinion
            </option>
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span>{t("delivery.builder.confidence")}</span>
          <select
            className="select"
            disabled={!questionTypeDefinition(question.type).scored}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                confidence: event.target.value as "off" | "optional" | "required",
              }))
            }
            value={question.confidence ?? "off"}
          >
            <option lang="en-CA" value="off">
              Off
            </option>
            <option lang="en-CA" value="optional">
              Optional
            </option>
            <option lang="en-CA" value="required">
              Required
            </option>
          </select>
        </label>
        <label className="field" style={{ flex: "2 1 280px" }}>
          <span>{t("delivery.builder.concepts")}</span>
          <input
            className="input"
            lang={(question.conceptKeys ?? []).length > 0 ? "" : "en-CA"}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                conceptKeys: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="fractions, rate-vs-total"
            value={(question.conceptKeys ?? []).join(", ")}
          />
          <small className="muted" lang="en-CA">
            Comma-separated keys using letters, numbers, dots, dashes, or underscores.
          </small>
        </label>
      </div>
      {(question.delivery ?? "main") === "main" &&
      question.type !== "poll" &&
      question.type !== "rating" &&
      question.type !== "ranking" &&
      questionTypeDefinition(question.type).supportsRecovery ? (
        <label className="field">
          <span>
            {uxBeta
              ? t("delivery.builder.pairedRecheckQuestion")
              : t("delivery.builder.linkedRecheck")}
          </span>
          <select
            className="select"
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                linkedRecheckQuestionId: event.target.value || null,
              }))
            }
            value={question.linkedRecheckQuestionId ?? ""}
          >
            <option lang="en-CA" value="">
              {uxBeta ? "No paired recheck" : "No linked recheck"}
            </option>
            {questions
              .filter(
                (candidate) =>
                  candidate.id !== question.id && (candidate.delivery ?? "main") === "recheck",
              )
              .map((candidate) =>
                candidate.prompt ? (
                  <option key={candidate.id} lang="" value={candidate.id}>
                    {candidate.prompt}
                  </option>
                ) : (
                  <option key={candidate.id} lang="en-CA" value={candidate.id}>
                    Untitled {responseTypeLabel(candidate.type)}
                  </option>
                ),
              )}
          </select>
        </label>
      ) : null}
    </BetaDisclosure>
  );
}
