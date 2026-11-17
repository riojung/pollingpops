import { questionTypeDefinition, type QuestionDraft } from "@openround/contracts";
import type { QuestionUpdater } from "./types";
import { useLocale } from "../locale-provider";
import { confidenceControlCopy } from "../../lib/i18n/confidence-control-copy";
import { roundToolsCopy } from "../../lib/i18n/round-tools-copy";
import { RoundToolSection } from "./round-tool-section";
import styles from "./round-tools.module.css";

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
  const { locale, t } = useLocale();
  const confidenceCopy = confidenceControlCopy[locale];
  const copy = roundToolsCopy(locale);
  const definition = questionTypeDefinition(question.type);
  const supportsRecheck = (question.delivery ?? "main") === "main" && definition.supportsRecovery;
  const purpose = (
    <div className={uxBeta ? styles.stack : "toolbar"}>
      <label className={uxBeta ? styles.field : "field"}>
        <span lang={locale}>{copy("Purpose")}</span>
        <select
          className="select"
          disabled={!definition.scored}
          onChange={(event) => {
            if (!definition.scored) return;
            onUpdateQuestion((item) =>
              questionTypeDefinition(item.type).scored
                ? { ...item, purpose: event.target.value as "diagnostic" | "practice" | "opinion" }
                : item,
            );
          }}
          value={question.purpose ?? (!definition.scored ? "opinion" : "diagnostic")}
        >
          <option lang={locale} value="diagnostic">
            {copy("Diagnostic")}
          </option>
          <option lang={locale} value="practice">
            {copy("Practice")}
          </option>
          <option lang={locale} value="opinion">
            {copy("Opinion")}
          </option>
        </select>
      </label>
      <label className={uxBeta ? styles.field : "field"}>
        <span>{t("delivery.builder.confidence")}</span>
        <select
          aria-describedby={`confidence-help-${question.id}`}
          className="select"
          disabled={!definition.supportsConfidence}
          onChange={(event) => {
            if (!definition.supportsConfidence) return;
            onUpdateQuestion((item) =>
              questionTypeDefinition(item.type).supportsConfidence
                ? { ...item, confidence: event.target.value as "off" | "optional" }
                : item,
            );
          }}
          value={question.confidence && question.confidence !== "off" ? "optional" : "off"}
        >
          <option lang={locale} value="off">
            {confidenceCopy.off}
          </option>
          <option lang={locale} value="optional">
            {confidenceCopy.on}
          </option>
        </select>
        <small className={styles.help} id={`confidence-help-${question.id}`} lang={locale}>
          {confidenceCopy.help}
        </small>
      </label>
      {!definition.scored && uxBeta ? (
        <p className={styles.help} lang={locale}>
          {copy("Opinion questions do not use confidence or scored rechecks.")}
        </p>
      ) : null}
    </div>
  );
  const concepts = (
    <label className={uxBeta ? styles.field : "field"}>
      <span>{t("delivery.builder.concepts")}</span>
      <input
        aria-describedby={`concepts-help-${question.id}`}
        className="input"
        lang=""
        onChange={(event) =>
          onUpdateQuestion((item) => ({
            ...item,
            conceptKeys: event.target.value
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          }))
        }
        value={(question.conceptKeys ?? []).join(", ")}
      />
      <small className={styles.help} id={`concepts-help-${question.id}`} lang={locale}>
        {copy(
          "Separate up to 12 tags with commas. Use letters, numbers, dots, dashes, or underscores.",
        )}
      </small>
    </label>
  );
  const recheck = supportsRecheck ? (
    <label className={uxBeta ? styles.field : "field"}>
      <span>
        {uxBeta ? t("delivery.builder.pairedRecheckQuestion") : t("delivery.builder.linkedRecheck")}
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
        <option lang={locale} value="">
          {copy(uxBeta ? "No paired recheck" : "No linked recheck")}
        </option>
        {questions
          .filter(
            (candidate) =>
              candidate.id !== question.id && (candidate.delivery ?? "main") === "recheck",
          )
          .map((candidate) => (
            <option
              key={candidate.id}
              lang={candidate.prompt.trim() ? "" : locale}
              value={candidate.id}
            >
              {candidate.prompt.trim() ||
                `${copy("Untitled question")} · ${t(`questionType.${candidate.type}.label`)}`}
            </option>
          ))}
      </select>
    </label>
  ) : null;
  if (!uxBeta)
    return (
      <>
        {purpose}
        {concepts}
        {recheck}
      </>
    );
  return (
    <div id="question-diagnostic-details" lang={locale}>
      <RoundToolSection defaultOpen title={copy("Purpose and confidence")}>
        {purpose}
      </RoundToolSection>
      <RoundToolSection title={copy("Concept tags")}>{concepts}</RoundToolSection>
      {supportsRecheck ? (
        <RoundToolSection
          description={copy(
            "Choose an existing recheck to check understanding again after support.",
          )}
          title={copy("Paired recheck")}
        >
          {recheck}
        </RoundToolSection>
      ) : null}
    </div>
  );
}
