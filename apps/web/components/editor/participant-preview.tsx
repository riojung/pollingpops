import type { QuestionDraft } from "@openround/contracts";
import { isChoiceQuestion } from "./types";
import { useLocale } from "../locale-provider";
import { LivePollChoices } from "../live-poll-choices";
import { RankingChoices } from "../ranking-choices";
import { initialRanking } from "../../lib/ranking-response";
import { TextResponseControl } from "../text-response-control";
import { isTextQuestion } from "../../lib/text-response";

export function ParticipantPreview({ question }: { question: QuestionDraft }) {
  const { t } = useLocale();
  return (
    <div className="participant-preview" aria-label={t("delivery.builder.previewParticipant")}>
      <p className="eyebrow">{t("delivery.builder.participantView")}</p>
      <h3>
        {question.prompt ? (
          <span lang="">{question.prompt}</span>
        ) : (
          t("delivery.builder.questionPrompt")
        )}
      </h3>
      {isTextQuestion(question.type) ? (
        <TextResponseControl type={question.type} disabled />
      ) : question.type === "ranking" ? (
        <RankingChoices question={question} selectedChoiceIds={initialRanking(question)} disabled />
      ) : question.type === "poll" && (question.maxSelections ?? 1) > 1 ? (
        <LivePollChoices question={question} disabled />
      ) : isChoiceQuestion(question) ? (
        <div className="preview-options">
          {question.choices.map((choice, index) => (
            <span className="preview-option" key={choice.id}>
              {choice.label ? (
                <span lang="">{choice.label}</span>
              ) : (
                t("delivery.builder.answer", { number: index + 1 })
              )}
            </span>
          ))}
        </div>
      ) : question.type === "numeric" ? (
        <input
          className="input"
          disabled
          placeholder={t("delivery.builder.answer", { number: 1 })}
        />
      ) : question.type === "rating" ? (
        <div className="preview-options">
          {Array.from({ length: question.max - question.min + 1 }, (_, index) => (
            <span className="preview-rating" key={question.min + index}>
              {question.min + index}
            </span>
          ))}
        </div>
      ) : null}
      {question.confidence !== "off" &&
      question.type !== "poll" &&
      question.type !== "rating" &&
      question.type !== "ranking" ? (
        <p className="muted" lang="en-CA">
          Confidence will be requested before Submit.
        </p>
      ) : null}
      <button className="button" disabled type="button">
        {t("delivery.builder.submitAnswer")}
      </button>
    </div>
  );
}
