"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./learning-sequence.module.css";

const activities = [
  {
    id: "reading",
    name: "Read the handoff brief",
    format: "Presentation reading",
    publication: "brief-v3",
    required: true,
  },
  {
    id: "practice",
    name: "Choose the next step",
    format: "Untimed choice practice",
    publication: "practice-v2",
    required: false,
  },
] as const;

const answers = [
  "Name the open question, who owns it, and when to follow up.",
  "Forward the conversation and let the next person decide what to do.",
] as const;

type Activity = (typeof activities)[number];
type ActivityId = Activity["id"];
type View = "checklist" | "independent";
type Mark = "done" | "skipped";
type Attempt = { answer?: string };
type Attempts = Partial<Record<ActivityId, Attempt>>;

export function LearningSequenceLab() {
  const [view, setView] = useState<View>("checklist");
  const [marks, setMarks] = useState<Partial<Record<ActivityId, Mark>>>({});
  const [attempts, setAttempts] = useState<Record<View, Attempts>>({
    checklist: {},
    independent: {},
  });
  const [readingUnavailable, setReadingUnavailable] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [started, setStarted] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const focusAfterNavigation = useRef<string | null>(null);
  const isChecklist = view === "checklist";
  const ActivityList = isChecklist ? "ol" : "ul";
  const next = activities.find((step) => !marks[step.id]);
  const attempt = activity ? attempts[view][activity.id] : undefined;

  useEffect(() => {
    if (!focusAfterNavigation.current) return;
    document.getElementById(focusAfterNavigation.current)?.focus();
    focusAfterNavigation.current = null;
  }, [activity]);

  function openActivity(step: Activity) {
    if (step.id === "reading" && readingUnavailable) {
      setReadingUnavailable(false);
      setNotice("Reading is available again.");
      return;
    }
    focusAfterNavigation.current = "sequence-activity-title";
    setNotice("");
    setStarted(false);
    setSelectedAnswer(attempts[view][step.id]?.answer ?? null);
    setActivity(step);
  }

  function returnToActivities(step: Activity) {
    focusAfterNavigation.current = `sequence-open-${step.id}`;
    setActivity(null);
  }

  function markStep(step: Activity, mark: Mark) {
    if (marks[step.id] === mark) return;
    setMarks((current) => ({ ...current, [step.id]: mark }));
    setNotice(`${step.name} ${mark === "done" ? "marked done" : "skipped"}.`);
  }

  function saveMockAttempt(step: Activity, updated: Attempt) {
    setAttempts((current) => ({
      ...current,
      [view]: { ...current[view], [step.id]: updated },
    }));
  }

  return (
    <main className={styles.lab} lang="en-CA">
      <header className={styles.intro}>
        <h1>Learning sequence lab</h1>
        <p>Rehearse a short reading and practice activity with synthetic Presentation content.</p>
        <p className={styles.note}>
          This rehearsal stays in this tab. Reloading resets the checklist and mock attempts.
        </p>
      </header>

      {activity ? (
        <section className={styles.panel} aria-labelledby="sequence-activity-title">
          <button type="button" onClick={() => returnToActivities(activity)}>
            {isChecklist ? "Back to checklist" : "Back to independent activities"}
          </button>
          <div>
            <h2 id="sequence-activity-title" tabIndex={-1}>
              {activity.name}
            </h2>
            <p className={styles.note}>
              {activity.format} · Publication <code>{activity.publication}</code>
            </p>
          </div>
          {started ? (
            activity.id === "reading" ? (
              <article className={styles.activityBody}>
                <h3>A brief someone can act on</h3>
                <p>
                  In a support handoff, state the open question, who owns it, and when they should
                  follow up. Give the next person enough context to start without searching the full
                  conversation.
                </p>
              </article>
            ) : (
              <div className={styles.activityBody}>
                <fieldset className={styles.choices}>
                  <legend>What belongs in the handoff?</legend>
                  {answers.map((answer) => (
                    <label key={answer}>
                      <input
                        type="radio"
                        name="practice-answer"
                        checked={selectedAnswer === answer}
                        onChange={() => setSelectedAnswer(answer)}
                      />
                      {answer}
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  disabled={selectedAnswer === null}
                  onClick={() => {
                    if (selectedAnswer !== null) {
                      saveMockAttempt(activity, { answer: selectedAnswer });
                    }
                  }}
                >
                  Check answer
                </button>
                <p role="status" className={styles.feedback}>
                  {attempt?.answer &&
                    (attempt.answer === answers[0]
                      ? "That handoff gives the next person a clear action."
                      : "Try including the open question, its owner, and a follow-up time.")}
                </p>
              </div>
            )
          ) : (
            <div className={styles.activityBody}>
              <p>Preview this activity before starting or resuming its mock attempt.</p>
              <button
                type="button"
                onClick={() => {
                  if (!attempt) saveMockAttempt(activity, {});
                  setStarted(true);
                  document.getElementById("sequence-activity-title")?.focus();
                }}
              >
                {attempt ? "Resume mock attempt" : "Start mock attempt"}
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <fieldset className={styles.views}>
            <legend>Compare ways to share the activities</legend>
            <div className={styles.viewOptions}>
              <label>
                <input
                  type="radio"
                  name="sequence-view"
                  checked={isChecklist}
                  onChange={() => {
                    setView("checklist");
                    setNotice("");
                  }}
                />
                Ordered checklist
              </label>
              <label>
                <input
                  type="radio"
                  name="sequence-view"
                  checked={!isChecklist}
                  onChange={() => {
                    setView("independent");
                    setNotice("");
                  }}
                />
                Independent activities
              </label>
            </div>
          </fieldset>

          <section className={styles.panel} aria-labelledby="sequence-list-title">
            <div>
              <h2 id="sequence-list-title">
                {isChecklist ? "Complete a clear handoff" : "Open an activity"}
              </h2>
              {isChecklist ? (
                <>
                  <p className={styles.note}>
                    Sequence revision <code>handoff-v1</code>. You mark each step yourself. A mark
                    records your checklist choice only.
                  </p>
                  {readingUnavailable ? (
                    <p className={styles.next}>
                      The required reading is unavailable. Retry it below.
                    </p>
                  ) : next ? (
                    <p className={styles.next}>Suggested next step: {next.name}.</p>
                  ) : null}
                  {!readingUnavailable && marks.reading === "done" && (
                    <p className={styles.note}>Required step marked done.</p>
                  )}
                </>
              ) : (
                <p className={styles.note}>
                  Open either activity directly and return to this list.
                </p>
              )}
            </div>

            <ActivityList className={styles.activityList} role="list">
              {activities.map((step) => {
                const unavailable = step.id === "reading" && readingUnavailable;
                const mark = marks[step.id];
                const hasAttempt = Boolean(attempts[view][step.id]);
                const action = unavailable ? "Retry" : hasAttempt ? "Open again" : "Open";
                return (
                  <li key={step.id}>
                    <article className={styles.card} aria-labelledby={`sequence-name-${step.id}`}>
                      <div>
                        <p className={styles.note}>{step.format}</p>
                        <h3 id={`sequence-name-${step.id}`}>{step.name}</h3>
                        <p className={styles.note}>
                          Publication <code>{step.publication}</code>
                          {isChecklist && (step.required ? " · Required" : " · Optional")}
                        </p>
                        {unavailable && (
                          <p className={styles.unavailable}>Temporarily unavailable</p>
                        )}
                        {isChecklist && mark && (
                          <p className={styles.mark}>
                            {mark === "done" ? "Marked done by you" : "Skipped by you"}
                          </p>
                        )}
                      </div>
                      <div className={styles.actions}>
                        <button
                          className={styles.primary}
                          id={`sequence-open-${step.id}`}
                          type="button"
                          aria-label={`${action} ${step.id}`}
                          onClick={() => openActivity(step)}
                        >
                          {action}
                        </button>
                        {isChecklist && (
                          <>
                            <button
                              type="button"
                              disabled={unavailable}
                              aria-disabled={mark === "done" || undefined}
                              aria-label={`Mark done for ${step.id}`}
                              onClick={() => markStep(step, "done")}
                            >
                              Mark done
                            </button>
                            {!step.required && (
                              <button
                                type="button"
                                aria-disabled={mark === "skipped" || undefined}
                                onClick={() => markStep(step, "skipped")}
                              >
                                Skip optional step
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ActivityList>

            {isChecklist && (
              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={() => {
                    setMarks({});
                    setNotice("Checklist cleared. Mock attempts remain available in this tab.");
                  }}
                >
                  Clear this checklist
                </button>
              </div>
            )}
            <p className={styles.feedback} role="status">
              {notice}
            </p>
          </section>
          <fieldset className={styles.views}>
            <legend>Rehearse interrupted access</legend>
            <label className={styles.simulation}>
              <input
                type="checkbox"
                checked={readingUnavailable}
                onChange={(event) => {
                  const unavailable = event.currentTarget.checked;
                  setReadingUnavailable(unavailable);
                  setNotice(
                    unavailable
                      ? "Reading is temporarily unavailable."
                      : "Reading is available again.",
                  );
                }}
              />
              Simulate reading unavailable
            </label>
          </fieldset>
        </>
      )}
    </main>
  );
}
