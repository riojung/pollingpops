"use client";

import type { ReactNode } from "react";
import type { SessionSnapshot } from "@openround/contracts";
import type { HostPhaseCommand, HostPhaseView } from "../lib/host-phase";
import { useLocale } from "./locale-provider";

const phaseKeys = {
  Lobby: "live.host.phase.lobby",
  "Question open": "live.host.phase.questionOpen",
  "Recheck open": "live.host.phase.recheckOpen",
  Paused: "live.host.phase.paused",
  Diagnose: "live.host.phase.diagnose",
  "Recheck locked": "live.host.phase.recheckLocked",
  "Recheck evidence": "live.host.phase.recheckEvidence",
  "Verify recovery": "live.host.phase.verifyRecovery",
  "Choose the next step": "live.host.phase.chooseNext",
  "Intervention in progress": "live.host.phase.intervention",
  Standings: "live.host.phase.standings",
  Complete: "live.host.phase.complete",
} as const;

const commandKeys = {
  "Start round": "live.host.command.startRound",
  "Lock answers": "live.host.command.lockAnswers",
  Pause: "live.host.command.pause",
  Resume: "live.host.command.resume",
  "Reveal answer": "live.host.command.revealAnswer",
  "Start peer discussion": "live.host.command.startDiscussion",
  "Continue after recheck": "live.host.command.continueAfterRecheck",
  "Finish round": "live.host.command.finishRound",
  "Next question": "live.host.command.nextQuestion",
  "Open linked recheck": "live.host.command.openLinkedRecheck",
  "Recheck by revote": "live.host.command.recheckByRevote",
  "Explain or reinforce": "live.host.command.explain",
  "Work an example": "live.host.command.example",
  "Show standings": "live.host.command.showStandings",
  "Finish intervention": "live.host.command.finishIntervention",
  "Reinforce the reasoning": "live.host.command.reinforceReasoning",
  "Address the misconception": "live.host.command.addressMisconception",
} as const;

export function HostStage({
  children,
  className = "",
  enhanced = true,
}: {
  children: ReactNode;
  className?: string;
  enhanced?: boolean;
}) {
  return (
    <section
      className={`live-card ${enhanced ? "host-stage" : ""} ${className}`.trim()}
      data-testid="host-stage"
    >
      {children}
    </section>
  );
}

export function RecoveryCompass({
  snapshot,
  phaseView,
  displayPhaseLabel,
  showSteps = true,
  synthetic = false,
  collapsible = false,
  children,
}: {
  snapshot: SessionSnapshot;
  phaseView: HostPhaseView;
  displayPhaseLabel?: string;
  showSteps?: boolean;
  synthetic?: boolean;
  collapsible?: boolean;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const guidance = phaseView.suggestionKind === "none" ? null : snapshot.insight;
  const phaseKey = phaseKeys[phaseView.phaseLabel as keyof typeof phaseKeys];
  const phaseLabel = displayPhaseLabel ?? (phaseKey ? t(phaseKey) : phaseView.phaseLabel);

  if (!showSteps) {
    return (
      <aside className="panel">
        <h2 style={{ fontSize: "1.35rem" }}>{t("live.host.controls")}</h2>
        <div className="metric-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 18 }}>
          <div className="metric">
            <strong>{snapshot.participants.length}</strong>
            <span>{t("live.host.joined")}</span>
          </div>
          <div className="metric">
            <strong>{snapshot.answerCount}</strong>
            <span>{t("live.host.answered")}</span>
          </div>
        </div>
        {guidance ? (
          <div className="notice" aria-live="polite" style={{ marginBottom: 18 }}>
            <p className="eyebrow">{t("live.host.facilitatorGuidance")}</p>
            <strong>{guidance.recommendation.title}</strong>
            <p>{guidance.recommendation.reason}</p>
            <small>
              {t("live.host.guidanceBasis", {
                responses: guidance.sampleSize,
                participation: guidance.participationPercent,
              })}
              {guidance.correctnessPercent === null
                ? t("live.host.unscoredSuffix")
                : t("live.host.correctSuffix", { percent: guidance.correctnessPercent })}
              {t("live.host.guidanceDisclaimer")}
            </small>
          </div>
        ) : null}
        {children}
      </aside>
    );
  }

  const Container = collapsible ? "details" : "aside";
  const steps = (
    <ol className="recovery-steps" aria-label={t("live.host.recoveryProcess")}>
      {[
        [t("live.host.step.ask"), snapshot.phase !== "lobby"],
        [t("live.host.step.diagnose"), Boolean(snapshot.insight)],
        [t("live.host.step.act"), Boolean(snapshot.intervention)],
        [t("live.host.step.recheck"), snapshot.roundKind !== "main"],
        [t("live.host.step.prove"), snapshot.phase === "finished"],
      ].map(([label, complete]) => (
        <li data-complete={complete || undefined} key={String(label)}>
          {label}
        </li>
      ))}
    </ol>
  );

  return (
    <Container
      aria-label={synthetic ? t("live.host.syntheticCompassAria") : t("live.host.compassAria")}
      className={`panel recovery-rail${collapsible ? " recovery-rail-collapsible" : ""}`}
      data-synthetic={synthetic || undefined}
      data-testid="recovery-rail"
    >
      {collapsible ? <summary>{t("live.host.compass")}</summary> : null}
      <p className="eyebrow">{t("live.host.compass")}</p>
      <h2 style={{ fontSize: "1.35rem" }}>{phaseLabel}</h2>
      {synthetic ? <p className="synthetic-label">{t("live.host.syntheticEvidence")}</p> : null}
      {synthetic ? (
        steps
      ) : (
        <details className="recovery-process">
          <summary>{t("live.host.recoveryProcess")}</summary>
          {steps}
        </details>
      )}
      <div className="metric-grid recovery-compass-metrics">
        <div className="metric">
          <strong>{snapshot.participants.length}</strong>
          <span>{synthetic ? t("live.host.syntheticLearners") : t("live.host.joined")}</span>
        </div>
        <div className="metric">
          <strong>{snapshot.answerCount}</strong>
          <span>{t("live.host.answered")}</span>
        </div>
      </div>
      {guidance ? (
        <div className="notice recovery-guidance" aria-live="polite">
          <p className="eyebrow">
            {phaseView.suggestionKind === "guidance"
              ? t("live.host.guidanceOnly")
              : t("live.host.facilitatorGuidance")}
          </p>
          <strong>{guidance.recommendation.title}</strong>
          <p>{guidance.recommendation.reason}</p>
          <small>
            {t("live.host.guidanceBasis", {
              responses: guidance.sampleSize,
              participation: guidance.participationPercent,
            })}
            {guidance.correctnessPercent === null
              ? t("live.host.unscoredSuffix")
              : t("live.host.correctSuffix", { percent: guidance.correctnessPercent })}
            {t("live.host.guidanceDisclaimer")}
          </small>
        </div>
      ) : null}
      {children}
    </Container>
  );
}

export function HostCommandBar({
  phaseView,
  busy,
  onCommand,
  getCommandLabel,
  primary = phaseView.primary,
  secondary = phaseView.secondary,
  primaryDisabled = false,
  leading,
  trailing,
  fallback,
  synthetic = false,
  inert = false,
}: {
  phaseView: HostPhaseView;
  busy: boolean;
  onCommand: (command: HostPhaseCommand) => void;
  getCommandLabel?: (command: HostPhaseCommand) => string;
  primary?: HostPhaseCommand | null;
  secondary?: HostPhaseCommand[];
  primaryDisabled?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  fallback?: ReactNode;
  synthetic?: boolean;
  inert?: boolean;
}) {
  const { t } = useLocale();
  const commandLabel = (command: HostPhaseCommand | null | undefined) => {
    if (!command) return "";
    const commandKey = commandKeys[command.label as keyof typeof commandKeys];
    return getCommandLabel?.(command) ?? (commandKey ? t(commandKey) : command.label);
  };
  return (
    <nav
      aria-label={synthetic ? t("live.host.syntheticCommandsAria") : t("live.host.commandsAria")}
      className="host-command-bar"
      data-synthetic={synthetic || undefined}
      data-testid="host-command-bar"
      inert={inert}
    >
      <div>
        <span className="eyebrow">
          {synthetic ? t("live.host.guidedNextAction") : t("live.host.nextAction")}
        </span>
        <strong>{primary ? commandLabel(primary) : t("live.host.reviewResults")}</strong>
      </div>
      <div className="button-row">
        <div className="host-command-primary">
          {primary ? (
            <button
              className="button"
              disabled={busy || primaryDisabled}
              onClick={() => onCommand(primary)}
              type="button"
            >
              {busy ? t("live.host.applying") : commandLabel(primary)}
            </button>
          ) : (
            fallback
          )}
        </div>
        <div className="host-command-overflow">
          {leading}
          {secondary.map((item) => (
            <button
              className="button-quiet"
              disabled={busy}
              key={`${item.action}:${item.interventionType ?? item.recheckMode ?? ""}`}
              onClick={() => onCommand(item)}
              type="button"
            >
              {commandLabel(item)}
            </button>
          ))}
          {trailing}
        </div>
      </div>
    </nav>
  );
}
