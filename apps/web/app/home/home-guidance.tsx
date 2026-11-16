"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
import { workspaceFlowMessages } from "../../lib/i18n/workspace-flow-messages";
import { creationGoalMessages } from "../../lib/i18n/creation-goal-messages";
import type { WorkspaceCreationGoal } from "../../components/workspace/workspace-creation-model";
import { homeMilestones, type HomeSummary } from "./home-model";
import styles from "./home.module.css";

export function HomeGuidance({
  summary,
  contextKey,
  guideAvailable,
  creationGoals = [],
}: {
  summary: HomeSummary;
  contextKey: string;
  guideAvailable: boolean;
  creationGoals?: WorkspaceCreationGoal[];
}) {
  const { locale, t } = useLocale();
  const copy = workspaceFlowMessages(locale);
  const goals = creationGoalMessages(locale);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const key = `pollingpops:home-guidance:v1:${contextKey}`;
  useEffect(() => {
    try {
      setDismissedKey(window.localStorage.getItem(key) === "dismissed" ? key : null);
    } catch {
      setDismissedKey(null);
    }
  }, [key]);
  const milestones = homeMilestones(summary);
  if (milestones.delivered || dismissedKey === key) return null;
  const latestDraft = summary.recentArtifacts.find((item) => item.status !== "archived");
  return (
    <section className={styles.onboarding} aria-labelledby="home-guidance-title" lang={locale}>
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="home-guidance-title">{copy.guidance}</h2>
          <p>{copy.intro}</p>
        </div>
        <button
          className="button-quiet small-button"
          aria-label={copy.dismiss}
          onClick={() => {
            setDismissedKey(key);
            try {
              window.localStorage.setItem(key, "dismissed");
            } catch {
              /* Dismissal still works in this tab. */
            }
          }}
          type="button"
        >
          ×
        </button>
      </div>
      {!milestones.created && creationGoals.length ? (
        <nav className={styles.goalActions} aria-label={goals.title}>
          {creationGoals.map((goal) => (
            <Link className={styles.goalAction} key={goal.kind} href={goal.href}>
              {goal.kind === "round" ? t("common.round") : goals[goal.kind]}{" "}
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </nav>
      ) : null}
      <ol className={styles.onboardingSteps}>
        {[
          { label: copy.create, done: milestones.created },
          { label: copy.publish, done: milestones.published },
          { label: copy.invite, done: milestones.delivered },
        ].map((step, index) => (
          <li key={step.label} data-complete={step.done}>
            <span aria-hidden="true">{step.done ? "✓" : index + 1}</span>
            <strong>
              {step.label}
              {step.done ? <span className="sr-only"> · {copy.complete}</span> : null}
            </strong>
          </li>
        ))}
      </ol>
      <div className={styles.onboardingActions}>
        <Link
          className="button-quiet small-button"
          href={milestones.published ? "/library" : (latestDraft?.editHref ?? "/create")}
        >
          {milestones.published
            ? t("pages.common.viewLibrary")
            : latestDraft
              ? t("pages.home.authoring.continueEditing")
              : t("pages.home.firstRun.create")}
        </Link>
        {guideAvailable ? (
          <Link href="/help#quick-start">{t("pages.home.firstRun.watch")}</Link>
        ) : null}
      </div>
    </section>
  );
}
