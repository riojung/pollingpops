import type { QuestionType, QuizDraft } from "@openround/contracts";
import { TEXT_RESPONSE_MAX_QUESTIONS, hasTextOpinionQuestions } from "@openround/contracts";
import { isTextQuestion } from "../../lib/text-response";
import { responseTypeGuidance } from "./question-labels";
import { useLocale } from "../locale-provider";
import styles from "./round-builder.module.css";

const QUESTION_TYPES: QuestionType[] = [
  "single_select",
  "true_false",
  "multi_select",
  "numeric",
  "rating",
  "poll",
  "ranking",
  "open_text",
  "word_cloud",
];

export function QuestionNavigator({
  draft,
  insertType,
  selectedQuestionId,
  uxBeta,
  rankingPollsEnabled = false,
  openTextPollsEnabled = false,
  wordCloudPollsEnabled = false,
  canReuseQuestions,
  collapsed = false,
  issueQuestionIds = new Set<string>(),
  onAddQuestion,
  onDeleteQuestion,
  onDuplicateQuestion,
  onInsertTypeChange,
  onMoveQuestion,
  onOpenQuestionReuse,
  onSelectQuestion,
  onToggleCollapsed,
  questionReuseOpen,
}: {
  draft: QuizDraft;
  insertType: QuestionType;
  selectedQuestionId: string | null;
  uxBeta: boolean;
  rankingPollsEnabled?: boolean;
  openTextPollsEnabled?: boolean;
  wordCloudPollsEnabled?: boolean;
  canReuseQuestions?: boolean;
  collapsed?: boolean;
  issueQuestionIds?: ReadonlySet<string>;
  onAddQuestion: (type: QuestionType) => void;
  onDeleteQuestion?: (questionId: string) => void;
  onDuplicateQuestion?: (questionId: string) => void;
  onInsertTypeChange: (type: QuestionType) => void;
  onMoveQuestion?: (questionId: string, direction: -1 | 1) => void;
  onOpenQuestionReuse?: () => void;
  onSelectQuestion: (questionId: string) => void;
  onToggleCollapsed?: () => void;
  questionReuseOpen?: boolean;
}) {
  const { locale, t } = useLocale();
  const localizedTypeLabels: Record<QuestionType, string> = {
    single_select: t("delivery.builder.type.single_select"),
    true_false: t("delivery.builder.type.true_false"),
    multi_select: t("delivery.builder.type.multi_select"),
    numeric: t("delivery.builder.type.numeric"),
    rating: t("delivery.builder.type.rating"),
    poll: t("delivery.builder.type.poll"),
    ranking: t("delivery.builder.type.ranking"),
    open_text: t("delivery.builder.type.open_text"),
    word_cloud: t("delivery.builder.type.word_cloud"),
  };
  const availableTypes = QUESTION_TYPES.filter(
    (type) =>
      (type !== "ranking" || rankingPollsEnabled) &&
      (type !== "open_text" || openTextPollsEnabled) &&
      (type !== "word_cloud" || wordCloudPollsEnabled),
  );
  const textLimitReached =
    draft.questions.filter((question) => isTextQuestion(question.type)).length >=
    TEXT_RESPONSE_MAX_QUESTIONS;
  if (!uxBeta) {
    return (
      <aside className="panel">
        <h2 style={{ fontSize: "1.4rem" }}>{t("delivery.builder.checkpoints")}</h2>
        <div className="question-list">
          {draft.questions.map((item, index) => (
            <button
              aria-current={item.id === selectedQuestionId}
              className="question-tab"
              key={item.id}
              onClick={() => onSelectQuestion(item.id)}
              type="button"
            >
              <strong>{index + 1}.</strong>{" "}
              {item.prompt ? (
                <span lang="">{item.prompt}</span>
              ) : (
                t("delivery.builder.untitledCheckpoint")
              )}
              {(item.delivery ?? "main") === "recheck" ? ` · ${t("delivery.builder.recheck")}` : ""}
            </button>
          ))}
        </div>
        <div className="button-row" style={{ marginTop: 16 }}>
          {availableTypes.map((type) => (
            <button
              className="button-quiet small-button"
              key={type}
              disabled={isTextQuestion(type) && textLimitReached}
              onClick={() => onAddQuestion(type)}
              type="button"
            >
              {type === "numeric"
                ? t("delivery.builder.type.numericLegacy")
                : localizedTypeLabels[type]}
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={styles.questionMap}
      data-collapsed={collapsed}
      aria-label={t("delivery.builder.questionMap")}
    >
      <div className={styles.mapHeader}>
        <div>
          <h2 className={collapsed ? "sr-only" : undefined}>
            {uxBeta ? t("delivery.builder.questions") : t("delivery.builder.checkpoints")}
          </h2>
          {!collapsed ? (
            <span className={styles.mapCount}>
              {t(
                uxBeta
                  ? draft.questions.length === 1
                    ? "delivery.builder.questionCount.one"
                    : "delivery.builder.questionCount.other"
                  : draft.questions.length === 1
                    ? "delivery.builder.checkpointCount.one"
                    : "delivery.builder.checkpointCount.other",
                { count: draft.questions.length },
              )}
            </span>
          ) : null}
        </div>
        {onToggleCollapsed ? (
          <button
            aria-label={collapsed ? "Expand question map" : "Collapse question map"}
            className={styles.iconButton}
            lang="en-CA"
            onClick={onToggleCollapsed}
            title={collapsed ? "Expand question map" : "Collapse question map"}
            type="button"
          >
            {collapsed ? "›" : "‹"}
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <div className={styles.collapsedList}>
          {draft.questions.map((item, index) => (
            <button
              aria-current={item.id === selectedQuestionId}
              className={styles.collapsedQuestion}
              data-issue={issueQuestionIds.has(item.id)}
              key={item.id}
              onClick={() => onSelectQuestion(item.id)}
              title={
                item.prompt
                  ? undefined
                  : uxBeta
                    ? t("delivery.builder.untitledQuestion")
                    : t("delivery.builder.untitledCheckpoint")
              }
              type="button"
            >
              <span aria-hidden="true">{index + 1}</span>
              <span className="sr-only">
                {t("delivery.builder.question", { number: index + 1 })}
                {item.prompt ? (
                  <>
                    : <span lang="">{item.prompt}</span>
                  </>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.mapList}>
          {draft.questions.map((item, index) => {
            const hasIssue = issueQuestionIds.has(item.id);
            const active = item.id === selectedQuestionId;
            return (
              <article className={styles.mapItem} data-active={active} key={item.id}>
                <button
                  aria-current={active}
                  className={styles.mapSelect}
                  onClick={() => onSelectQuestion(item.id)}
                  type="button"
                >
                  <span className={styles.mapNumber}>{index + 1}</span>
                  <span className={styles.mapCopy}>
                    <strong>
                      {item.prompt ? (
                        <span lang="">{item.prompt}</span>
                      ) : uxBeta ? (
                        t("delivery.builder.untitledQuestion")
                      ) : (
                        t("delivery.builder.untitledCheckpoint")
                      )}
                    </strong>
                    <small>
                      {localizedTypeLabels[item.type]}
                      {(item.delivery ?? "main") === "recheck"
                        ? ` · ${t("delivery.builder.recheck")}`
                        : ""}
                    </small>
                  </span>
                  <span
                    aria-label={
                      hasIssue ? t("delivery.builder.needsAttention") : t("delivery.builder.ready")
                    }
                    className={styles.mapStatus}
                    data-issue={hasIssue}
                    role="img"
                  />
                </button>
                {onMoveQuestion || onDuplicateQuestion || onDeleteQuestion ? (
                  <div
                    className={styles.mapActions}
                    aria-label={`${uxBeta ? "Question" : "Checkpoint"} ${index + 1} actions`}
                    role="group"
                    lang="en-CA"
                  >
                    {onMoveQuestion ? (
                      <>
                        <button
                          aria-label={`Move ${uxBeta ? "question" : "checkpoint"} ${index + 1} up`}
                          className={styles.mapAction}
                          disabled={index === 0}
                          onClick={() => onMoveQuestion(item.id, -1)}
                          title="Move up"
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Move ${uxBeta ? "question" : "checkpoint"} ${index + 1} down`}
                          className={styles.mapAction}
                          disabled={index === draft.questions.length - 1}
                          onClick={() => onMoveQuestion(item.id, 1)}
                          title="Move down"
                          type="button"
                        >
                          ↓
                        </button>
                      </>
                    ) : null}
                    {onDuplicateQuestion ? (
                      <button
                        lang={locale}
                        className={styles.mapAction}
                        onClick={() => onDuplicateQuestion(item.id)}
                        type="button"
                      >
                        {t("delivery.common.duplicate")}
                      </button>
                    ) : null}
                    {onDeleteQuestion ? (
                      <button
                        lang={locale}
                        className={`${styles.mapAction} ${styles.mapActionDanger}`}
                        onClick={() => onDeleteQuestion(item.id)}
                        type="button"
                      >
                        {t("delivery.common.delete")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {!collapsed ? (
        <div className={styles.mapInsert}>
          <label className="field" htmlFor="insert-question-type">
            <span>{t("delivery.builder.addQuestion")}</span>
            <select
              aria-describedby="insert-question-guidance"
              className="select"
              id="insert-question-type"
              onChange={(event) => onInsertTypeChange(event.target.value as QuestionType)}
              value={insertType}
            >
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {localizedTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" id="insert-question-guidance" lang="en-CA">
            {responseTypeGuidance[insertType]}
          </p>
          <button
            className="button small-button"
            disabled={isTextQuestion(insertType) && textLimitReached}
            onClick={() => onAddQuestion(insertType)}
            type="button"
          >
            {t("delivery.builder.addQuestion")}
          </button>
          {hasTextOpinionQuestions(draft) && textLimitReached ? (
            <p className="muted">
              {t("delivery.builder.textQuestionLimit", { limit: TEXT_RESPONSE_MAX_QUESTIONS })}
            </p>
          ) : null}
          {canReuseQuestions && onOpenQuestionReuse ? (
            <button
              aria-controls="private-question-bank"
              aria-expanded={Boolean(questionReuseOpen)}
              className="button-quiet small-button"
              id="open-private-question-bank"
              lang="en-CA"
              onClick={onOpenQuestionReuse}
              type="button"
            >
              Reuse from your workspace
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
