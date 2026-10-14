import { useLocale } from "./locale-provider";

/** Native checkboxes preserve keyboard selection and expose saved selections on reconnect. */
export function LivePollChoices({
  question,
  selectedChoiceIds = [],
  disabled = false,
  onChoose,
}: {
  question: { id: string; choices: Array<{ id: string; label: string }>; maxSelections?: number };
  selectedChoiceIds?: string[];
  disabled?: boolean;
  onChoose?: (choiceId: string) => void;
}) {
  const { t } = useLocale();
  const limit = question.maxSelections ?? 1;
  return (
    <fieldset disabled={disabled} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="field-label">{t("live.roundPlay.answerChoices")}</legend>
      <p className="muted" role="status" aria-live="polite">
        {t("live.roundPlay.pollSelectionLimit", { limit, selected: selectedChoiceIds.length })}
      </p>
      <div className="answer-grid">
        {question.choices.map((choice, index) => {
          const selected = selectedChoiceIds.includes(choice.id);
          return (
            <label
              className="answer-button poll-choice"
              data-selected={selected || undefined}
              key={choice.id}
            >
              <input
                type="checkbox"
                name={question.id}
                value={choice.id}
                checked={selected}
                disabled={!selected && selectedChoiceIds.length >= limit}
                onChange={() => onChoose?.(choice.id)}
              />
              <span>
                <span aria-hidden="true">{String.fromCharCode(65 + index)}. </span>
                <span lang="">{choice.label}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
