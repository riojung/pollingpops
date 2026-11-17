import {
  normalizeDecimalString,
  textResponseCharacterLimit,
  type QuestionDraft,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import { BetaDisclosure } from "./beta-disclosure";
import {
  isChoiceQuestion,
  removeQuestionChoice,
  type ChoiceQuestionDraft,
  type ChoiceQuestionUpdater,
  type QuestionStructuralChange,
  type QuestionUpdater,
} from "./types";
import { useLocale } from "../locale-provider";
import { isTextQuestion } from "../../lib/text-response";
import styles from "./response-editor.module.css";
import { authoringWorkflowCopy } from "./authoring-workflow-copy";
import { roundToolsCopy } from "../../lib/i18n/round-tools-copy";
import { liveWordCloudCopy } from "../../lib/i18n/live-word-cloud-copy";

function invalidDecimal(value: string, nonnegative = false) {
  try {
    const normalized = normalizeDecimalString(value);
    return nonnegative && normalized.startsWith("-");
  } catch {
    return true;
  }
}

function ChoiceResponseEditor({
  question,
  uxBeta,
  multiSelectPollsEnabled,
  rankingPollsEnabled,
  onStructuralChange,
  onUpdateChoiceQuestion,
}: {
  question: ChoiceQuestionDraft;
  uxBeta: boolean;
  multiSelectPollsEnabled: boolean;
  rankingPollsEnabled: boolean;
  onStructuralChange: QuestionStructuralChange;
  onUpdateChoiceQuestion: ChoiceQuestionUpdater;
}) {
  const { locale, t } = useLocale();
  const authoring = authoringWorkflowCopy(locale);
  const copy = roundToolsCopy(locale);
  const opinion = question.type === "poll" || question.type === "ranking";
  const guideId = `response-guide-${question.id}`;
  const guidance = copy(
    question.type === "ranking"
      ? "Participants order their priorities. The order here does not define a correct answer."
      : question.type === "poll"
        ? "Collect opinions. There is no correct answer."
        : question.type === "true_false"
          ? "Choose whether the statement is true or false."
          : question.type === "multi_select"
            ? "Mark every correct answer."
            : "Choose one correct answer.",
  );
  return (
    <div className={styles.response} data-compact={uxBeta}>
      <p className={styles.guidance} id={guideId} lang={locale}>
        {guidance}
      </p>
      {question.type === "ranking" ? (
        <div className={styles.selectionSettings}>
          <label className={`field ${styles.selectionField}`}>
            <span>{t("delivery.builder.rankingCount")}</span>
            <select
              className="select"
              disabled={!rankingPollsEnabled}
              value={question.rankCount ?? question.choices.length}
              onChange={(event) => {
                if (!rankingPollsEnabled) return;
                onUpdateChoiceQuestion((item) =>
                  item.type === "ranking"
                    ? { ...item, rankCount: Number(event.target.value) }
                    : item,
                );
              }}
            >
              {question.choices.map((_, index) => (
                <option key={index + 1} value={index + 1}>
                  {new Intl.NumberFormat(locale).format(index + 1)}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.selectionHelp}>{t("delivery.builder.rankingHelp")}</p>
        </div>
      ) : null}
      {question.type === "poll" &&
      (multiSelectPollsEnabled || (question.maxSelections ?? 1) > 1) ? (
        <div className={styles.selectionSettings}>
          <label className={`field ${styles.selectionField}`}>
            <span>{t("delivery.builder.pollMaximumSelections")}</span>
            <select
              className="select"
              disabled={!multiSelectPollsEnabled}
              value={question.maxSelections ?? 1}
              onChange={(event) => {
                if (!multiSelectPollsEnabled) return;
                onUpdateChoiceQuestion((item) =>
                  item.type === "poll"
                    ? { ...item, maxSelections: Number(event.target.value) }
                    : item,
                );
              }}
            >
              {question.choices.map((_, index) => (
                <option key={index + 1} value={index + 1}>
                  {new Intl.NumberFormat(locale).format(index + 1)}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.selectionHelp}>
            {t(
              multiSelectPollsEnabled
                ? "delivery.builder.pollMultipleHelp"
                : "delivery.builder.pollMultipleUnavailable",
            )}
          </p>
        </div>
      ) : null}
      <fieldset aria-describedby={guideId} className={styles.choiceList}>
        <legend className={styles.legend} lang={locale}>
          {opinion
            ? t(`questionType.${question.type}.label`)
            : t("delivery.builder.choicesAndCorrect")}
        </legend>
        <div className={styles.choiceGrid} data-true-false={question.type === "true_false"}>
          {question.choices.map((choice, index) => (
            <div
              aria-labelledby={`answer-label-${choice.id}`}
              className={styles.choiceRow}
              data-correct={!opinion && choice.isCorrect}
              data-opinion={opinion}
              key={choice.id}
              role="group"
            >
              <div className={styles.choiceHeader}>
                <span aria-hidden="true" className={styles.choiceLetter}>
                  {String.fromCharCode(65 + index)}
                </span>
                {!opinion ? (
                  <label className={styles.correctControl}>
                    <input
                      aria-label={authoring.markCorrect.replace(
                        "{number}",
                        new Intl.NumberFormat(locale).format(index + 1),
                      )}
                      checked={choice.isCorrect}
                      className="choice-correct"
                      name={
                        question.type === "multi_select"
                          ? `correct-choice-${choice.id}`
                          : `correct-choice-${question.id}`
                      }
                      onChange={() =>
                        onUpdateChoiceQuestion((item) => ({
                          ...item,
                          choices: item.choices.map((candidate) => ({
                            ...candidate,
                            isCorrect:
                              item.type === "multi_select"
                                ? candidate.id === choice.id
                                  ? !candidate.isCorrect
                                  : candidate.isCorrect
                                : candidate.id === choice.id,
                          })),
                        }))
                      }
                      lang={locale}
                      type={question.type === "multi_select" ? "checkbox" : "radio"}
                    />
                    <span lang={locale}>
                      {copy(choice.isCorrect ? "Correct answer" : "Mark correct")}
                    </span>
                  </label>
                ) : null}
                {question.type !== "true_false" && question.choices.length > 2 ? (
                  <button
                    aria-labelledby={`delete-label-${choice.id} answer-label-${choice.id}`}
                    className={styles.removeButton}
                    lang={locale}
                    onClick={() =>
                      onStructuralChange(
                        removeQuestionChoice(question, choice.id),
                        "Choice removed.",
                      )
                    }
                    title={`${t("delivery.common.delete")}: ${t("delivery.builder.answer", { number: index + 1 })}`}
                    type="button"
                  >
                    <span className="sr-only" id={`delete-label-${choice.id}`}>
                      {t("delivery.common.delete")}
                    </span>
                    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" width="16" height="16">
                      <path
                        d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7m4-7v7"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </button>
                ) : null}
              </div>
              <div className={styles.choiceContent}>
                <span className="sr-only" id={`answer-label-${choice.id}`} lang={locale}>
                  {t("delivery.builder.answer", { number: index + 1 })}
                </span>
                <textarea
                  aria-labelledby={`answer-label-${choice.id}`}
                  aria-invalid={!choice.label.trim()}
                  className={`input ${styles.choiceInput}`}
                  disabled={question.type === "true_false"}
                  lang=""
                  maxLength={180}
                  rows={2}
                  onChange={(event) =>
                    onUpdateChoiceQuestion((item) => ({
                      ...item,
                      choices: item.choices.map((candidate) =>
                        candidate.id === choice.id
                          ? { ...candidate, label: event.target.value }
                          : candidate,
                      ),
                    }))
                  }
                  value={choice.label}
                />
                {!opinion ? (
                  <div lang={locale}>
                    <BetaDisclosure
                      className={styles.diagnostics}
                      enabled={uxBeta}
                      summary={authoring.diagnosticFeedback}
                    >
                      <div className={styles.diagnosticFields}>
                        <label className={styles.detailField}>
                          <span id={`misconception-label-${choice.id}`}>
                            {authoring.misconceptionLabel.replace(
                              "{number}",
                              new Intl.NumberFormat(locale).format(index + 1),
                            )}
                          </span>
                          <input
                            aria-labelledby={`misconception-label-${choice.id}`}
                            className="input"
                            lang={choice.misconceptionKey ? "" : locale}
                            maxLength={64}
                            onChange={(event) =>
                              onUpdateChoiceQuestion((item) => ({
                                ...item,
                                choices: item.choices.map((candidate) =>
                                  candidate.id === choice.id
                                    ? { ...candidate, misconceptionKey: event.target.value || null }
                                    : candidate,
                                ),
                              }))
                            }
                            placeholder={authoring.misconceptionPlaceholder}
                            value={choice.misconceptionKey ?? ""}
                          />
                        </label>
                        <label className={styles.detailField}>
                          <span id={`feedback-label-${choice.id}`}>
                            {authoring.choiceReasonLabel.replace(
                              "{number}",
                              new Intl.NumberFormat(locale).format(index + 1),
                            )}
                          </span>
                          <input
                            aria-labelledby={`feedback-label-${choice.id}`}
                            className="input"
                            lang={choice.feedback ? "" : locale}
                            maxLength={500}
                            onChange={(event) =>
                              onUpdateChoiceQuestion((item) => ({
                                ...item,
                                choices: item.choices.map((candidate) =>
                                  candidate.id === choice.id
                                    ? { ...candidate, feedback: event.target.value }
                                    : candidate,
                                ),
                              }))
                            }
                            placeholder={authoring.choiceReasonPlaceholder}
                            value={choice.feedback ?? ""}
                          />
                        </label>
                      </div>
                    </BetaDisclosure>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      {question.type !== "true_false" ? (
        <div className={styles.answerActions} lang={locale}>
          {question.choices.length < 6 ? (
            <button
              className={`button-quiet small-button ${styles.addButton}`}
              onClick={() =>
                onUpdateChoiceQuestion((item) => ({
                  ...item,
                  choices: [...item.choices, { id: clientUuid(), label: "", isCorrect: false }],
                }))
              }
              type="button"
            >
              <span aria-hidden="true">+</span> {t("delivery.builder.addAnswer")}
            </button>
          ) : (
            <span className={styles.answerCount}>{copy("Maximum of 6 answers")}</span>
          )}
          <span className={styles.answerCount}>
            {copy("{count} of 6 answers", {
              count: new Intl.NumberFormat(locale).format(question.choices.length),
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function ResponseEditor({
  question,
  uxBeta,
  multiSelectPollsEnabled = false,
  rankingPollsEnabled = false,
  wordCloudLiveSupported = false,
  onStructuralChange,
  onUpdateChoiceQuestion,
  onUpdateQuestion,
}: {
  question: QuestionDraft;
  uxBeta: boolean;
  multiSelectPollsEnabled?: boolean;
  rankingPollsEnabled?: boolean;
  wordCloudLiveSupported?: boolean;
  onStructuralChange: QuestionStructuralChange;
  onUpdateChoiceQuestion: ChoiceQuestionUpdater;
  onUpdateQuestion: QuestionUpdater;
}) {
  const { locale, t } = useLocale();
  const authoring = authoringWorkflowCopy(locale);
  const copy = roundToolsCopy(locale);
  if (isTextQuestion(question.type)) {
    if (!uxBeta)
      return (
        <p className="muted">
          {question.type === "word_cloud" && wordCloudLiveSupported
            ? liveWordCloudCopy(locale, "editorHelp")
            : t("delivery.builder.textResponseHelp", {
                limit: textResponseCharacterLimit(question.type),
              })}
        </p>
      );
    return (
      <div className={styles.response} data-compact={uxBeta}>
        <div className={styles.textGuide}>
          <span aria-hidden="true" className={styles.responseGlyph}>
            {question.type === "word_cloud" ? "Aa" : "¶"}
          </span>
          <div>
            <h3 className={styles.guideTitle} lang={locale}>
              {copy("Participant response")}
            </h3>
            <p className={styles.guidance} lang={locale}>
              {question.type === "word_cloud"
                ? wordCloudLiveSupported
                  ? liveWordCloudCopy(locale, "editorHelp")
                  : copy(
                      "Ask for a word or short phrase. Repeated approved responses appear larger in the cloud.",
                    )
                : copy(
                    "Participants write their own response. Ask a focused question that invites reflection.",
                  )}
            </p>
            <span className={styles.responseLimit} lang={locale}>
              {copy("Up to {limit} characters per response", {
                limit: new Intl.NumberFormat(locale).format(
                  textResponseCharacterLimit(question.type),
                ),
              })}
            </span>
          </div>
        </div>
        <p className={styles.moderationNote} lang={locale}>
          {question.type === "word_cloud" && wordCloudLiveSupported
            ? liveWordCloudCopy(locale, "editorPolicy")
            : copy("Responses need moderator approval before appearing to the audience.")}
        </p>
      </div>
    );
  }
  if (isChoiceQuestion(question))
    return (
      <ChoiceResponseEditor
        onStructuralChange={onStructuralChange}
        onUpdateChoiceQuestion={onUpdateChoiceQuestion}
        question={question}
        uxBeta={uxBeta}
        multiSelectPollsEnabled={multiSelectPollsEnabled}
        rankingPollsEnabled={rankingPollsEnabled}
      />
    );
  if (question.type === "numeric") {
    return (
      <div className={styles.response} data-compact={uxBeta}>
        {uxBeta ? (
          <p className={styles.guidance} id={`numeric-help-${question.id}`} lang={locale}>
            {copy(
              "Use 0 for an exact answer. Otherwise, accept the tolerance above or below the correct value.",
            )}
          </p>
        ) : null}
        <div className={styles.numericFields}>
          <label className={styles.field}>
            <span>{t("delivery.builder.correctValue")}</span>
            <input
              aria-invalid={invalidDecimal(question.correctValue)}
              className="input"
              inputMode="decimal"
              lang=""
              maxLength={64}
              onChange={(event) =>
                onUpdateQuestion((item) =>
                  item.type === "numeric" ? { ...item, correctValue: event.target.value } : item,
                )
              }
              value={question.correctValue}
            />
          </label>
          <label className={styles.field}>
            <span lang={locale}>{authoring.absoluteTolerance}</span>
            <input
              aria-describedby={uxBeta ? `numeric-help-${question.id}` : undefined}
              aria-invalid={invalidDecimal(question.tolerance, true)}
              className="input"
              inputMode="decimal"
              lang=""
              maxLength={64}
              onChange={(event) =>
                onUpdateQuestion((item) =>
                  item.type === "numeric" ? { ...item, tolerance: event.target.value } : item,
                )
              }
              value={question.tolerance}
            />
          </label>
          <label className={`${styles.field} ${styles.unitField}`}>
            <span lang={locale}>{authoring.optionalUnit}</span>
            <input
              className="input"
              lang=""
              maxLength={32}
              onChange={(event) =>
                onUpdateQuestion((item) =>
                  item.type === "numeric" ? { ...item, unit: event.target.value || null } : item,
                )
              }
              value={question.unit ?? ""}
            />
            {uxBeta ? (
              <small className={styles.fieldHelp} lang={locale}>
                {copy("Participants enter a number; the unit is a display label.")}
              </small>
            ) : null}
          </label>
        </div>
      </div>
    );
  }
  if (question.type !== "rating") return null;
  return (
    <div className={styles.response} data-compact={uxBeta}>
      {uxBeta ? (
        <p className={styles.guidance} lang={locale}>
          {copy("Set the range and describe its endpoints. Ratings have no correct answer.")}
        </p>
      ) : null}
      <div className={styles.ratingFields}>
        <label className={styles.field}>
          <span lang={locale}>{authoring.minimum}</span>
          <select
            className="select"
            onChange={(event) =>
              onUpdateQuestion((item) =>
                item.type === "rating"
                  ? {
                      ...item,
                      min: Number(event.target.value),
                      max: Math.max(item.max, Number(event.target.value) + 1),
                    }
                  : item,
              )
            }
            value={question.min}
          >
            {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {new Intl.NumberFormat(locale).format(value)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span lang={locale}>{authoring.maximum}</span>
          <select
            className="select"
            onChange={(event) =>
              onUpdateQuestion((item) =>
                item.type === "rating"
                  ? {
                      ...item,
                      max: Number(event.target.value),
                      min: Math.min(item.min, Number(event.target.value) - 1),
                    }
                  : item,
              )
            }
            value={question.max}
          >
            {Array.from({ length: 9 }, (_, index) => index + 2).map((value) => (
              <option key={value} value={value}>
                {new Intl.NumberFormat(locale).format(value)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span lang={locale}>{authoring.minimumLabel}</span>
          <input
            className="input"
            lang=""
            maxLength={80}
            onChange={(event) =>
              onUpdateQuestion((item) =>
                item.type === "rating" ? { ...item, minLabel: event.target.value } : item,
              )
            }
            value={question.minLabel}
          />
        </label>
        <label className={styles.field}>
          <span lang={locale}>{authoring.maximumLabel}</span>
          <input
            className="input"
            lang=""
            maxLength={80}
            onChange={(event) =>
              onUpdateQuestion((item) =>
                item.type === "rating" ? { ...item, maxLabel: event.target.value } : item,
              )
            }
            value={question.maxLabel}
          />
        </label>
      </div>
      {uxBeta ? (
        <div
          aria-label={copy("Scale preview")}
          className={styles.scalePreview}
          lang={locale}
          role="group"
        >
          <div className={styles.scaleValues}>
            {Array.from(
              { length: Math.max(0, question.max - question.min + 1) },
              (_, index) => question.min + index,
            ).map((value) => (
              <span key={value}>{new Intl.NumberFormat(locale).format(value)}</span>
            ))}
          </div>
          <div className={styles.scaleLabels}>
            <span lang="">{question.minLabel}</span>
            <span lang="">{question.maxLabel}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
