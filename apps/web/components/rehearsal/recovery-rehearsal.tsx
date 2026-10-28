"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QuizDraft, SessionSnapshot } from "@openround/contracts";
import {
  RECOVERY_REHEARSAL_SCENARIOS,
  createRecoveryRehearsalController,
  getHostPhaseView,
  recoveryRehearsalEligibility,
  type HostPhaseCommand,
  type RecoveryRehearsalController,
  type RecoveryRehearsalEligibility,
  type RecoveryRehearsalScenarioId,
} from "@openround/rehearsal";
import { HostCommandBar, HostStage, RecoveryCompass } from "../host-command-center";
import { useLocale } from "../locale-provider";
import { RecoveryStorySummary } from "../recovery-story";
import { formatNumber } from "../../lib/i18n/format";
import { recordRehearsalProductEvent } from "./product-events";
import { defaultRehearsalContentSource, type RehearsalContentSource } from "./rehearsal-access";
import styles from "./rehearsal.module.css";

export interface RecoveryRehearsalQuiz {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
}

export interface RecoveryRehearsalVersion {
  id: string;
  version: number;
  content: QuizDraft;
}

const insightMessageKeys = {
  insufficient_sample: "reportRound.rehearsal.insight.insufficient_sample",
  low_participation: "reportRound.rehearsal.insight.low_participation",
  high_confidence_error: "reportRound.rehearsal.insight.high_confidence_error",
  dominant_misconception: "reportRound.rehearsal.insight.dominant_misconception",
  low_correctness: "reportRound.rehearsal.insight.low_correctness",
  split_understanding: "reportRound.rehearsal.insight.split_understanding",
  correct_but_uncertain: "reportRound.rehearsal.insight.correct_but_uncertain",
  continue: "reportRound.rehearsal.insight.continue",
  opinion_result: "reportRound.rehearsal.insight.opinion_result",
} as const;

function insightMessageKey(code: string) {
  return Object.hasOwn(insightMessageKeys, code)
    ? insightMessageKeys[code as keyof typeof insightMessageKeys]
    : insightMessageKeys.continue;
}

function ChoicePreview({ snapshot }: { snapshot: SessionSnapshot }) {
  const { t } = useLocale();
  if (!snapshot.question || snapshot.question.choices.length === 0) return null;
  return (
    <ol aria-label={t("reportRound.rehearsal.questionChoices")} className={styles.choiceGrid}>
      {snapshot.question.choices.map((choice, index) => (
        <li className={styles.choice} key={choice.id}>
          <span aria-hidden="true" className={styles.choiceLetter}>
            {String.fromCharCode(65 + index)}
          </span>
          <span lang="">{choice.label}</span>
        </li>
      ))}
    </ol>
  );
}

function PatternGraphic({
  correct,
  wrong,
  missing,
}: {
  correct: number;
  wrong: number;
  missing: number;
}) {
  const { locale, t } = useLocale();
  const number = (value: number) => formatNumber(locale, value);
  const cells = [
    ...Array.from({ length: correct }, () => "correct" as const),
    ...Array.from({ length: wrong }, () => "wrong" as const),
    ...Array.from({ length: missing }, () => "missing" as const),
  ];
  return (
    <div>
      <div
        aria-label={t("reportRound.rehearsal.patternLabel", {
          correct: number(correct),
          wrong: number(wrong),
          missing: number(missing),
        })}
        className={styles.dotPlot}
        role="img"
      >
        {cells.map((kind, index) => (
          <span className={styles.responseDot} data-kind={kind} key={`${kind}-${index}`} />
        ))}
      </div>
      <div className={styles.legend}>
        <span>
          <i data-kind="correct" /> {t("reportRound.rehearsal.correct")} · {number(correct)}
        </span>
        <span>
          <i data-kind="wrong" /> {t("reportRound.rehearsal.leadingWrong")} · {number(wrong)}
        </span>
        {missing > 0 ? (
          <span>
            <i data-kind="missing" /> {t("reportRound.rehearsal.noResponse")} · {number(missing)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Debrief({ controller }: { controller: RecoveryRehearsalController }) {
  const { locale, t } = useLocale();
  const { debrief, insight, intervention, participants, recheck, scenario } = controller.plan;
  return (
    <div className={styles.debrief} data-testid="rehearsal-debrief">
      <RecoveryStorySummary
        model={{
          recovered: debrief.recoveredCount,
          denominator: debrief.initialWrongCount,
          recoveryPercent: debrief.recoveryPercent,
          initialAccuracyPercent: insight.correctnessPercent,
          evidenceLabel:
            recheck.mode === "linked"
              ? t("reportRound.rehearsal.linkedRecovery")
              : t("reportRound.rehearsal.revoteImprovement"),
          unresolvedCount: debrief.unresolvedCount,
          unresolvedNarrative:
            debrief.unresolvedCount > 0
              ? t("reportRound.rehearsal.syntheticUnresolved", {
                  count: formatNumber(locale, debrief.unresolvedCount),
                })
              : t("reportRound.rehearsal.noneUnresolved"),
          interventions: [
            {
              id: "synthetic-intervention",
              label: t(`reportRound.rehearsal.intervention.${intervention.type}`),
              followedByLinkedRecheck: recheck.mode === "linked",
            },
          ],
          nextActionLabel:
            debrief.unresolvedCount > 0
              ? t("reportRound.rehearsal.targetPractice")
              : t("reportRound.rehearsal.reviewEvidence"),
          nextAction:
            debrief.unresolvedCount > 0
              ? t("reportRound.rehearsal.targetPracticeDescription")
              : t("reportRound.rehearsal.reviewEvidenceDescription"),
          highConfidenceWrong: scenario.highConfidenceWrongCount,
          correctButUnsure: 0,
          smallSample: debrief.initialWrongCount < 5,
          evidenceNote: t("reportRound.rehearsal.syntheticEvidenceNote", {
            mode:
              recheck.mode === "linked"
                ? t("reportRound.rehearsal.linkedEvidence")
                : t("reportRound.rehearsal.revoteEvidence"),
          }),
          synthetic: true,
        }}
      />
      <details className={styles.details}>
        <summary>{t("reportRound.rehearsal.reviewOutcomes")}</summary>
        <div className={styles.tableWrap}>
          <table>
            <caption className={styles.visuallyHidden}>
              {t("reportRound.rehearsal.resultsCaption", {
                recheck:
                  recheck.mode === "linked"
                    ? t("reportRound.rehearsal.linkedRecheck")
                    : t("reportRound.rehearsal.revote"),
              })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("reportRound.rehearsal.learner")}</th>
                <th scope="col">{t("reportRound.rehearsal.initial")}</th>
                <th scope="col">{t("reportRound.rehearsal.recheck")}</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant, index) => (
                <tr key={participant.id}>
                  <th scope="row">
                    {t("reportRound.rehearsal.syntheticLearnerNumber", {
                      number: String(index + 1).padStart(2, "0"),
                    })}
                  </th>
                  <td>{t(`reportRound.rehearsal.outcome.${participant.initial}`)}</td>
                  <td>
                    {t(`reportRound.rehearsal.outcome.${participant.recheck}`)}
                    {participant.recovered ? (
                      <span className={styles.recovered}>{t("reportRound.story.recovered")}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function ActiveRehearsal({
  controller,
  onExit,
  startedAtMs,
}: {
  controller: RecoveryRehearsalController;
  onExit: () => void;
  startedAtMs: number;
}) {
  const { locale, t } = useLocale();
  const [stepIndex, setStepIndex] = useState(0);
  const completionRecorded = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const view = controller.view(stepIndex);
  const { plan } = controller;
  const { step } = view;
  const phaseView = getHostPhaseView(step.snapshot);
  const commandLabel = (command: HostPhaseCommand) => {
    if (command.action === "intervention.start") {
      return t(
        `reportRound.rehearsal.command.intervention.${command.interventionType ?? "explain"}`,
      );
    }
    if (command.action === "recheck.open") {
      return command.recheckMode === "linked"
        ? t("reportRound.rehearsal.command.linkedRecheck")
        : t("reportRound.rehearsal.command.revote");
    }
    if (command.action === "response.moderate") return "Moderate response";
    if (command.action === "confidence.set") return t("delivery.builder.confidence");
    return t(`reportRound.rehearsal.command.${command.action}`);
  };
  const displayPhaseLabel = t(`reportRound.rehearsal.phase.${step.id}`);
  const missing = plan.scenario.audienceSize - plan.scenario.responseCount;
  const localizedStepTitle =
    locale === "en-CA"
      ? step.title
      : step.id === "question_open" || step.id === "recheck"
        ? step.title
        : step.id === "briefing"
          ? t("reportRound.rehearsal.briefingTitle", {
              scenario: t(`reportRound.rehearsal.scenario.${plan.scenario.id}.title`),
              pattern: t(`reportRound.rehearsal.scenario.${plan.scenario.id}.short`),
            })
          : step.id === "responses"
            ? t("reportRound.rehearsal.respondedTitle", {
                count: formatNumber(locale, plan.scenario.responseCount),
              })
            : step.id === "diagnosis"
              ? t(insightMessageKey(plan.insight.recommendation.code))
              : step.id === "revealed" || step.id === "intervention"
                ? t(`reportRound.rehearsal.interventionTitle.${plan.intervention.type}`)
                : step.id === "verify"
                  ? t("reportRound.rehearsal.collectEvidence")
                  : t("reportRound.rehearsal.debriefTitle");
  const localizedGuidance =
    locale === "en-CA" ? step.guidance : t(`reportRound.rehearsal.guidance.${step.id}`);
  const localizedEyebrow =
    locale === "en-CA"
      ? step.eyebrow
      : t(`reportRound.rehearsal.stepEyebrow.${step.id}`, {
          number: formatNumber(locale, stepIndex + 1),
        });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function moveTo(nextIndex: number) {
    if (controller.view(nextIndex).step.id === "debrief" && !completionRecorded.current) {
      completionRecorded.current = true;
      recordRehearsalProductEvent({
        name: "rehearsal_completed",
        scenario: plan.scenario.id,
        elapsedMs: Date.now() - startedAtMs,
      });
    }
    setStepIndex(nextIndex);
  }

  function continueRehearsal() {
    moveTo(controller.next(stepIndex));
  }

  function applyCommand(command: HostPhaseCommand) {
    moveTo(controller.apply(stepIndex, command));
  }

  return (
    <section
      className={styles.active}
      data-recheck-mode={plan.recheck.mode}
      data-scenario={plan.scenario.id}
      data-stage={step.id}
      data-testid="rehearsal-step"
    >
      <div className={styles.activeHeader}>
        <div>
          <p className={styles.eyebrow}>
            {t("reportRound.rehearsal.eyebrow")} ·{" "}
            {t(`reportRound.rehearsal.scenario.${plan.scenario.id}.title`)}
          </p>
          <h1 lang="" ref={headingRef} tabIndex={-1}>
            {plan.sourceQuestion.prompt}
          </h1>
        </div>
        <button className={styles.textButton} onClick={onExit} type="button">
          {t("reportRound.rehearsal.exit")}
        </button>
      </div>

      <nav
        aria-label={t("reportRound.rehearsal.progress")}
        className={styles.progressNav}
        tabIndex={0}
      >
        <ol>
          {plan.steps.map((candidate, index) => (
            <li
              aria-current={index === stepIndex ? "step" : undefined}
              data-complete={index < stepIndex}
              key={candidate.id}
            >
              <span>{formatNumber(locale, index + 1)}</span>
              <small>{t(`reportRound.rehearsal.step.${candidate.id}`)}</small>
            </li>
          ))}
        </ol>
      </nav>

      <div className={styles.practiceLayout}>
        <HostStage className={styles.stageCard}>
          <div className={styles.stageMeta}>
            <span>{displayPhaseLabel}</span>
            <span>
              {t("reportRound.rehearsal.responses", {
                count: formatNumber(locale, step.snapshot.answerCount),
              })}
            </span>
          </div>
          <p className={styles.eyebrow}>{localizedEyebrow}</p>
          <h2>{localizedStepTitle}</h2>
          <p className={styles.guidance}>{localizedGuidance}</p>

          {step.id === "question_open" || step.id === "recheck" ? (
            <ChoicePreview snapshot={step.snapshot} />
          ) : null}
          {step.id === "responses" ? (
            <PatternGraphic
              correct={plan.scenario.correctCount}
              missing={missing}
              wrong={plan.scenario.wrongCount}
            />
          ) : null}
          {step.id === "diagnosis" ? (
            <div
              className={styles.insightCard}
              data-insight-code={plan.insight.recommendation.code}
            >
              <span className={styles.insightStrength}>
                {plan.insight.recommendation.strong
                  ? t("reportRound.rehearsal.strongSignal")
                  : t("reportRound.rehearsal.useJudgment")}
              </span>
              <dl>
                <div>
                  <dt>{t("reportRound.rehearsal.participation")}</dt>
                  <dd>
                    {formatNumber(locale, plan.insight.participationPercent / 100, {
                      style: "percent",
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t("reportRound.rehearsal.correct")}</dt>
                  <dd>
                    {plan.insight.correctnessPercent === null
                      ? "—"
                      : formatNumber(locale, plan.insight.correctnessPercent / 100, {
                          style: "percent",
                        })}
                  </dd>
                </div>
                <div>
                  <dt>{t("reportRound.rehearsal.verySureWrong")}</dt>
                  <dd>
                    {plan.insight.highConfidenceWrongPercent === null
                      ? "—"
                      : formatNumber(locale, plan.insight.highConfidenceWrongPercent / 100, {
                          style: "percent",
                        })}
                  </dd>
                </div>
              </dl>
              {plan.scenario.id === "split_room" ? (
                <p className={styles.ruleNote}>{t("reportRound.rehearsal.splitRule")}</p>
              ) : null}
            </div>
          ) : null}
          {step.id === "revealed" || step.id === "intervention" ? (
            <div className={styles.coachScript}>
              <span>{t("reportRound.rehearsal.facilitatorPrompt")}</span>
              <blockquote>{t("reportRound.rehearsal.promptQuote")}</blockquote>
              <p>{t("reportRound.rehearsal.promptGuidance")}</p>
            </div>
          ) : null}
          {step.id === "debrief" ? <Debrief controller={controller} /> : null}

          <div className={styles.stageActions}>
            <button
              className={styles.secondaryButton}
              disabled={!view.canGoBack}
              onClick={() => setStepIndex(controller.previous(stepIndex))}
              type="button"
            >
              {t("delivery.common.back")}
            </button>
            {view.canContinue && !step.command ? (
              <button className={styles.primaryButton} onClick={continueRehearsal} type="button">
                {t(`reportRound.rehearsal.continue.${step.id}`)}
              </button>
            ) : view.complete ? (
              <button className={styles.primaryButton} onClick={onExit} type="button">
                {t("reportRound.rehearsal.anotherPattern")}
              </button>
            ) : null}
          </div>
        </HostStage>

        <RecoveryCompass
          displayPhaseLabel={displayPhaseLabel}
          phaseView={phaseView}
          snapshot={step.snapshot}
          synthetic
        >
          <p>{t("reportRound.rehearsal.productionGuidance")}</p>
          <dl className={styles.snapshotStats}>
            <div>
              <dt>{t("reportRound.rehearsal.syntheticLearners")}</dt>
              <dd>{formatNumber(locale, step.snapshot.participants.length)}</dd>
            </div>
            <div>
              <dt>{t("reportRound.rehearsal.roundEvidence")}</dt>
              <dd>
                {plan.recheck.mode === "linked"
                  ? t("reportRound.rehearsal.linkedRecheck")
                  : t("reportRound.rehearsal.revote")}
              </dd>
            </div>
            <div>
              <dt>{t("reportRound.rehearsal.savedData")}</dt>
              <dd>{t("reportRound.rehearsal.noLearnerRecords")}</dd>
            </div>
          </dl>
          {plan.adaptations.map((adaptation) => (
            <p className={styles.adaptation} key={adaptation}>
              {adaptation}
            </p>
          ))}
        </RecoveryCompass>
      </div>
      {step.command ? (
        <HostCommandBar
          busy={false}
          getCommandLabel={commandLabel}
          onCommand={applyCommand}
          phaseView={phaseView}
          primary={step.command}
          secondary={[]}
          synthetic
        />
      ) : null}
      <p aria-live="polite" className={styles.visuallyHidden}>
        {t("reportRound.rehearsal.stepProgress", {
          current: formatNumber(locale, view.stepIndex + 1),
          total: formatNumber(locale, view.stepCount),
          title: localizedStepTitle,
        })}
      </p>
    </section>
  );
}

export function RecoveryRehearsal({
  canEdit,
  quiz,
  currentVersion,
}: {
  canEdit: boolean;
  quiz: RecoveryRehearsalQuiz;
  currentVersion: RecoveryRehearsalVersion | null;
}) {
  const { locale, t } = useLocale();
  const hasPublishedVersion = Boolean(currentVersion);
  const [source, setSource] = useState<RehearsalContentSource>(
    defaultRehearsalContentSource({ status: quiz.status, hasPublishedVersion }),
  );
  const [scenarioId, setScenarioId] = useState<RecoveryRehearsalScenarioId>("low_participation");
  const [questionId, setQuestionId] = useState("");
  const [activeRun, setActiveRun] = useState<{
    controller: RecoveryRehearsalController;
    startedAtMs: number;
  } | null>(null);
  const [startError, setStartError] = useState("");
  const content: QuizDraft =
    source === "published" && currentVersion ? currentVersion.content : quiz.draft;
  const eligibilityByScenario = useMemo(
    () =>
      Object.fromEntries(
        RECOVERY_REHEARSAL_SCENARIOS.map((scenario) => [
          scenario.id,
          recoveryRehearsalEligibility(content, scenario.id),
        ]),
      ) as Record<RecoveryRehearsalScenarioId, RecoveryRehearsalEligibility>,
    [content],
  );
  const eligibility = eligibilityByScenario[scenarioId];
  const anyScenarioEligible = RECOVERY_REHEARSAL_SCENARIOS.some(
    (scenario) => eligibilityByScenario[scenario.id].eligible,
  );

  useEffect(() => {
    if (eligibility.eligible) return;
    const firstEligible = RECOVERY_REHEARSAL_SCENARIOS.find(
      (scenario) => eligibilityByScenario[scenario.id].eligible,
    );
    if (firstEligible) setScenarioId(firstEligible.id);
  }, [eligibility.eligible, eligibilityByScenario]);

  useEffect(() => {
    const stillEligible = eligibility.questions.some((option) => option.questionId === questionId);
    if (!stillEligible) setQuestionId(eligibility.questions[0]?.questionId ?? "");
    setStartError("");
  }, [eligibility, questionId]);

  if (activeRun) {
    return (
      <ActiveRehearsal
        controller={activeRun.controller}
        onExit={() => setActiveRun(null)}
        startedAtMs={activeRun.startedAtMs}
      />
    );
  }

  const selectedOption = eligibility.questions.find((option) => option.questionId === questionId);

  function start() {
    if (!questionId) return;
    try {
      const nextController = createRecoveryRehearsalController({
        quiz: content,
        scenarioId,
        questionId,
      });
      const startedAtMs = Date.now();
      setActiveRun({ controller: nextController, startedAtMs });
      recordRehearsalProductEvent({ name: "rehearsal_started", scenario: scenarioId });
      setStartError("");
    } catch (error) {
      setStartError(
        locale === "en-CA" && error instanceof Error
          ? error.message
          : t("reportRound.rehearsal.startError"),
      );
    }
  }

  return (
    <section className={styles.setup} data-testid="rehearsal-setup">
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{t("reportRound.rehearsal.betaEyebrow")}</p>
          <h1>{t("reportRound.rehearsal.heroTitle")}</h1>
          <p className={styles.lede}>{t("reportRound.rehearsal.heroDescription")}</p>
        </div>
        <div className={styles.promiseCard}>
          <span aria-hidden="true">◎</span>
          <strong>{t("reportRound.rehearsal.safeTitle")}</strong>
          <p>{t("reportRound.rehearsal.safeDescription")}</p>
        </div>
      </div>

      <div className={styles.setupGrid}>
        <form
          className={styles.setupCard}
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <div className={styles.sectionHeading}>
            <span>01</span>
            <div>
              <h2>{t("reportRound.rehearsal.chooseSource")}</h2>
              <p>{t("reportRound.rehearsal.chooseSourceDescription")}</p>
            </div>
          </div>
          {hasPublishedVersion ? (
            <fieldset className={styles.segmented}>
              <legend className={styles.visuallyHidden}>
                {t("reportRound.rehearsal.version")}
              </legend>
              <label data-selected={source === "published"}>
                <input
                  checked={source === "published"}
                  name="source"
                  onChange={() => {
                    setSource("published");
                    setActiveRun(null);
                  }}
                  type="radio"
                />
                {t("reportRound.assign.publishedVersion", {
                  version: currentVersion?.version ?? "",
                })}
              </label>
              <label data-selected={source === "draft"}>
                <input
                  checked={source === "draft"}
                  name="source"
                  onChange={() => {
                    setSource("draft");
                    setActiveRun(null);
                  }}
                  type="radio"
                />
                {t("reportRound.rehearsal.currentDraft")}
              </label>
            </fieldset>
          ) : (
            <div className={styles.sourceSummary}>
              <span>{t("reportRound.rehearsal.currentDraft")}</span>
              <small>
                {quiz.status === "draft"
                  ? t("reportRound.rehearsal.notPublished")
                  : t(`reportRound.status.${quiz.status}`)}
              </small>
            </div>
          )}

          {eligibility.eligible ? (
            <label className={styles.field}>
              <span>{t("reportRound.common.question")}</span>
              <select
                data-testid="rehearsal-question"
                value={questionId}
                onChange={(event) => setQuestionId(event.target.value)}
              >
                {eligibility.questions.map((option) => (
                  <option key={option.questionId} lang="" value={option.questionId}>
                    {option.questionIndex + 1}. {option.prompt}
                  </option>
                ))}
              </select>
              <small lang={selectedOption?.recheckPrompt ? "" : undefined}>
                {selectedOption?.recheckMode === "linked"
                  ? t("reportRound.rehearsal.usesLinkedRecheck", {
                      prompt: selectedOption.recheckPrompt,
                    })
                  : t("reportRound.rehearsal.usesRevote")}
              </small>
            </label>
          ) : (
            <div className={styles.ineligible} role="status">
              <strong>{t("reportRound.rehearsal.noEligibleQuestion")}</strong>
              <p>{t(`reportRound.rehearsal.ineligible.${scenarioId}`)}</p>
              <ul>
                <li>{t("reportRound.rehearsal.requirement.question")}</li>
                <li>{t("reportRound.rehearsal.requirement.answers")}</li>
                <li>{t(`reportRound.rehearsal.requirement.${scenarioId}`)}</li>
              </ul>
              {!anyScenarioEligible ? (
                canEdit ? (
                  <Link href={`/quiz/${quiz.id}#question-diagnostic-details`}>
                    {t("reportRound.rehearsal.openControls")}
                  </Link>
                ) : (
                  <>
                    <p>{t("reportRound.rehearsal.askEditor")}</p>
                    <Link href={`/quiz/${quiz.id}/preview`}>
                      {t("reportRound.rehearsal.returnToPreview")}
                    </Link>
                  </>
                )
              ) : null}
            </div>
          )}

          <div className={styles.sectionHeading}>
            <span>02</span>
            <div>
              <h2>{t("reportRound.rehearsal.pickPattern")}</h2>
              <p>{t("reportRound.rehearsal.pickPatternDescription")}</p>
            </div>
          </div>
          <fieldset className={styles.scenarioList}>
            <legend className={styles.visuallyHidden}>
              {t("reportRound.rehearsal.practiceScenario")}
            </legend>
            {RECOVERY_REHEARSAL_SCENARIOS.map((scenario) => {
              const scenarioEligibility = eligibilityByScenario[scenario.id];
              return (
                <label
                  data-eligible={scenarioEligibility.eligible}
                  data-selected={scenarioId === scenario.id}
                  data-testid={`rehearsal-scenario-${scenario.id}`}
                  key={scenario.id}
                >
                  <input
                    checked={scenarioId === scenario.id}
                    disabled={!scenarioEligibility.eligible}
                    name="scenario"
                    onChange={() => setScenarioId(scenario.id)}
                    type="radio"
                  />
                  <span className={styles.scenarioCheck} aria-hidden="true" />
                  <span>
                    <strong>{t(`reportRound.rehearsal.scenario.${scenario.id}.title`)}</strong>
                    <small>{t(`reportRound.rehearsal.scenario.${scenario.id}.short`)}</small>
                    <em>{t(`reportRound.rehearsal.scenario.${scenario.id}.description`)}</em>
                    <small className={styles.scenarioEligibility}>
                      {scenarioEligibility.eligible
                        ? t("reportRound.rehearsal.eligibleQuestions", {
                            count: formatNumber(locale, scenarioEligibility.questions.length),
                          })
                        : t(`reportRound.rehearsal.ineligible.${scenario.id}`)}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {startError ? (
            <p className={styles.error} role="alert">
              {startError}
            </p>
          ) : null}
          <button
            className={styles.startButton}
            data-testid="rehearsal-start"
            disabled={!eligibility.eligible || !questionId || !anyScenarioEligible}
            type="submit"
          >
            {t("reportRound.rehearsal.start")} <span aria-hidden="true">→</span>
          </button>
        </form>

        <aside className={styles.explainer}>
          <p className={styles.eyebrow}>{t("reportRound.rehearsal.loopTitle")}</p>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>{t("reportRound.rehearsal.loop.notice")}</strong>
                <p>{t("reportRound.rehearsal.loop.noticeDescription")}</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>{t("reportRound.rehearsal.loop.intervene")}</strong>
                <p>{t("reportRound.rehearsal.loop.interveneDescription")}</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>{t("reportRound.rehearsal.loop.recheck")}</strong>
                <p>{t("reportRound.rehearsal.loop.recheckDescription")}</p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>{t("reportRound.rehearsal.loop.debrief")}</strong>
                <p>{t("reportRound.rehearsal.loop.debriefDescription")}</p>
              </div>
            </li>
          </ol>
          <div className={styles.callout}>
            <strong>{t("reportRound.rehearsal.everyRole")}</strong>
            <p>{t("reportRound.rehearsal.everyRoleDescription")}</p>
            <p className={styles.telemetryNote}>{t("reportRound.rehearsal.telemetry")}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
