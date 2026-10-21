import { useLocale } from "./locale-provider";
import {
  moveRankedChoice,
  rankingCount,
  toggleRankedChoice,
  type RankingQuestion,
} from "../lib/ranking-response";

export function RankingChoices({
  question,
  selectedChoiceIds,
  disabled = false,
  onChange,
}: {
  question: RankingQuestion;
  selectedChoiceIds: string[];
  disabled?: boolean;
  onChange?: (selected: string[]) => void;
}) {
  const { t } = useLocale();
  const count = rankingCount(question);
  const partial = count < question.choices.length;
  return (
    <fieldset disabled={disabled} className="ranking-response">
      <legend className="field-label">{t("live.ranking.yourRanking")}</legend>
      <p className="muted">
        {t("live.ranking.instructions", { count, total: question.choices.length })}
      </p>
      <p role="status" aria-live="polite">
        {t("live.ranking.selected", { selected: selectedChoiceIds.length, count })}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {t("live.ranking.currentOrder", {
          choices: selectedChoiceIds
            .map((id) => question.choices.find((choice) => choice.id === id)?.label ?? "")
            .join(", "),
        })}
      </p>
      <ol className="ranking-list">
        {selectedChoiceIds.map((id, index) => {
          const choice = question.choices.find((candidate) => candidate.id === id);
          if (!choice) return null;
          return (
            <li key={id}>
              <strong lang="">{choice.label}</strong>
              <div className="button-row">
                <button
                  className="button-quiet small-button"
                  type="button"
                  aria-label={`${t("live.ranking.up")}: ${choice.label}`}
                  disabled={index === 0}
                  onClick={() => onChange?.(moveRankedChoice(selectedChoiceIds, id, -1))}
                >
                  {t("live.ranking.up")}
                </button>
                <button
                  className="button-quiet small-button"
                  type="button"
                  aria-label={`${t("live.ranking.down")}: ${choice.label}`}
                  disabled={index === selectedChoiceIds.length - 1}
                  onClick={() => onChange?.(moveRankedChoice(selectedChoiceIds, id, 1))}
                >
                  {t("live.ranking.down")}
                </button>
                {partial ? (
                  <button
                    className="button-quiet small-button"
                    type="button"
                    aria-label={t("live.ranking.removeChoice", { choice: choice.label })}
                    onClick={() => onChange?.(toggleRankedChoice(selectedChoiceIds, id, count))}
                  >
                    {t("live.ranking.remove")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {partial ? (
        <div className="button-row">
          {question.choices
            .filter((choice) => !selectedChoiceIds.includes(choice.id))
            .map((choice) => (
              <button
                className="button-quiet"
                key={choice.id}
                type="button"
                disabled={selectedChoiceIds.length >= count}
                aria-label={t("live.ranking.addChoice", { choice: choice.label })}
                onClick={() => onChange?.(toggleRankedChoice(selectedChoiceIds, choice.id, count))}
              >
                <span lang="">{choice.label}</span>
              </button>
            ))}
        </div>
      ) : null}
    </fieldset>
  );
}
