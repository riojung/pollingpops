"use client";

import { useId, useState } from "react";
import styles from "./public-product-demo.module.css";

export type PublicProductDemoKind =
  | "poll"
  | "word-cloud"
  | "quiz"
  | "qa"
  | "presentation"
  | "survey"
  | "board"
  | "report"
  | "practice"
  | "collaboration";

const pollChoices = ["Clearer priorities", "More time to focus", "Better handovers"];
const cloudPhrases = [
  ["Clear priorities", 5],
  ["Team spirit", 4],
  ["Time to focus", 3],
  ["Better handovers", 3],
  ["Curiosity", 2],
  ["Fresh ideas", 2],
] as const;

/** Local, explicitly fictional product examples. Never submits or records responses. */
export function PublicProductDemo({
  kind = "poll",
  label = "Interactive product example",
}: {
  kind?: PublicProductDemoKind;
  label?: string;
}) {
  const id = useId();
  const [choice, setChoice] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [cloudAdded, setCloudAdded] = useState(false);
  const [voted, setVoted] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <section className={styles.demo} aria-label={label} lang="en-CA" dir="ltr">
      <div className={styles.topline}>
        <span className={styles.brand}>
          <span aria-hidden="true">●</span> Polling Pops
        </span>
        <span className={styles.sample}>Sample</span>
      </div>
      <div className={styles.stage}>
        {kind === "poll" && (
          <>
            <p className={styles.kicker}>Live poll · team check-in</p>
            <h2>What would help us do our best work?</h2>
            <div className={styles.options}>
              {pollChoices.map((text, index) => {
                const percent = [50, 32, 18][index];
                return (
                  <button
                    type="button"
                    key={text}
                    aria-pressed={choice === index}
                    className={styles.pollOption}
                    onClick={() => setChoice(index)}
                  >
                    <span
                      className={styles.bar}
                      style={{ width: `${choice === null ? 0 : percent}%` }}
                    />
                    <span>{text}</span>
                    <strong>
                      {choice === null ? String.fromCharCode(65 + index) : `${percent}%`}
                    </strong>
                  </button>
                );
              })}
            </div>
            <p className={styles.feedback} role="status">
              {choice === null
                ? "Choose an option to explore sample results."
                : "Sample results shown. Your choice stays on this device."}
            </p>
          </>
        )}
        {kind === "word-cloud" && (
          <>
            <p className={styles.kicker}>Word cloud · short phrases welcome</p>
            <h2>What helps a great team thrive?</h2>
            <div className={styles.cloud} aria-label="Sample phrase counts">
              {cloudPhrases.map(([phrase, count], index) => (
                <span
                  key={phrase}
                  className={cloudAdded && index === 0 ? styles.growing : undefined}
                  style={{
                    fontSize: `${index === 0 && cloudAdded ? 2.05 : 0.95 + count * 0.17}rem`,
                  }}
                >
                  {phrase}
                  <small> {count + (index === 0 && cloudAdded ? 1 : 0)}</small>
                </span>
              ))}
            </div>
            <button
              type="button"
              className={styles.action}
              onClick={() => setCloudAdded(!cloudAdded)}
            >
              {cloudAdded ? "Reset example" : "Add “Clear priorities”"}
            </button>
            <p className={styles.feedback} role="status">
              {cloudAdded
                ? "The shared phrase grows as its sample count increases."
                : "Try adding a phrase. Repeated phrases grow together."}
            </p>
          </>
        )}
        {kind === "quiz" && (
          <>
            <p className={styles.kicker}>Quiz · answer, reveal, celebrate</p>
            <h2>A price of $80 falls by 25%. The new price is…</h2>
            <div className={styles.quizChoices}>
              {["$55", "$60", "$75"].map((answer, index) => (
                <button
                  type="button"
                  key={answer}
                  className={styles.quizOption}
                  aria-pressed={choice === index}
                  onClick={() => {
                    setChoice(index);
                    setRevealed(false);
                  }}
                >
                  {String.fromCharCode(65 + index)} <strong>{answer}</strong>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.action}
              disabled={choice === null}
              onClick={() => setRevealed(true)}
            >
              Reveal sample answer
            </button>
            <p className={styles.feedback} role="status">
              {revealed
                ? "$60. One quarter of $80 is $20. A linked recheck can explore the same concept next."
                : "Choose an answer, then reveal the explanation."}
            </p>
          </>
        )}
        {kind === "qa" && (
          <>
            <p className={styles.kicker}>Round Q&A · listen to the room</p>
            <h2>Make space for the questions that matter.</h2>
            <div className={styles.question}>
              <button
                type="button"
                aria-pressed={voted}
                aria-label={voted ? "Remove sample upvote" : "Upvote sample question"}
                onClick={() => setVoted(!voted)}
              >
                ↑<strong>{12 + Number(voted)}</strong>
              </button>
              <div>
                <strong>What does success look like for our first month?</strong>
                <p>Visible to the room</p>
              </div>
            </div>
            <div className={styles.reply}>
              <span className={styles.tag}>Facilitator reply</span>
              <p>Let’s agree on one clear outcome together.</p>
            </div>
            <p className={styles.feedback} role="status">
              {voted ? "Sample upvote added on this device." : "Try upvoting the sample question."}
            </p>
          </>
        )}
        {kind === "presentation" && (
          <>
            <p className={styles.kicker}>Interactive presentation · {step + 1} of 2</p>
            <div className={styles.slide}>
              <span className={styles.tag}>{step ? "Audience checkpoint" : "Team meeting"}</span>
              <h2>
                {step ? "What should we focus on next?" : "Good work starts with a conversation."}
              </h2>
              {step ? (
                <div className={styles.chips}>
                  <span>Priorities</span>
                  <span>People</span>
                  <span>Progress</span>
                </div>
              ) : (
                <div className={styles.slideArt} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
            <button type="button" className={styles.action} onClick={() => setStep(step ? 0 : 1)}>
              {step ? "Previous sample slide" : "Next sample slide →"}
            </button>
          </>
        )}
        {kind === "survey" && (
          <>
            <p className={styles.kicker}>Self-paced survey · team feedback</p>
            <h2>
              {step ? "Thanks for exploring the example." : "How clear are this week’s priorities?"}
            </h2>
            {step ? (
              <div className={styles.completion}>
                <span aria-hidden="true">✓</span>
                <p>Give people time to reflect and contribute.</p>
              </div>
            ) : (
              <>
                <div className={styles.rating} role="group" aria-label="Sample clarity rating">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={choice === value}
                      onClick={() => setChoice(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div className={styles.scale}>
                  <span>Not clear yet</span>
                  <span>Very clear</span>
                </div>
              </>
            )}
            <button
              type="button"
              className={styles.action}
              disabled={!step && choice === null}
              onClick={() => setStep(step ? 0 : 1)}
            >
              {step ? "Restart example" : "Finish sample response"}
            </button>
            <p className={styles.feedback} role="status">
              {step
                ? "This sample was not submitted or saved."
                : "Choose a rating to try the example."}
            </p>
          </>
        )}
        {kind === "board" && (
          <>
            <p className={styles.kicker}>Idea board · gather, group, prioritize</p>
            <h2>What should we try next?</h2>
            <div className={styles.stickies}>
              {["A quieter focus hour", "Clearer weekly goals", "Share small wins"].map(
                (idea, index) => (
                  <button
                    type="button"
                    key={idea}
                    aria-pressed={choice === index}
                    onClick={() => setChoice(index)}
                  >
                    {idea}
                    <span>{choice === index ? "✓ Your sample priority" : "+ Prioritize"}</span>
                  </button>
                ),
              )}
            </div>
            <p className={styles.feedback} role="status">
              {choice === null
                ? "Choose an idea to explore priority voting."
                : "Sample priority selected on this device."}
            </p>
          </>
        )}
        {kind === "report" && (
          <>
            <p className={styles.kicker}>Round report · illustrative evidence</p>
            <h2>See the response. Understand the next step.</h2>
            <div className={styles.metrics}>
              <div>
                <strong>18/20</strong>
                <span>Responded</span>
              </div>
              <div>
                <strong>12</strong>
                <span>Paired responses</span>
              </div>
            </div>
            <div className={styles.reportRow}>
              <span>Initially correct</span>
              <div>
                <span style={{ width: "50%" }} />
              </div>
              <strong>6/12</strong>
            </div>
            <div className={styles.reportRow}>
              <span>Correct on recheck</span>
              <div>
                <span style={{ width: "75%" }} />
              </div>
              <strong>9/12</strong>
            </div>
            <p className={styles.note}>
              A linked recheck shows evidence from this session. It does not establish lasting
              learning or what caused a change.
            </p>
          </>
        )}
        {kind === "practice" && (
          <>
            <p className={styles.kicker}>Practice assignment · your own pace</p>
            <h2>{step ? "What makes a helpful next step?" : "Keep the conversation going."}</h2>
            {step ? (
              <div className={styles.options}>
                {["One clear action", "Everything at once"].map((answer, index) => (
                  <button
                    type="button"
                    key={answer}
                    className={styles.quizOption}
                    aria-pressed={choice === index}
                    onClick={() => setChoice(index)}
                  >
                    {answer}
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.practiceInfo}>
                <span>Published Round</span>
                <strong>Personal practice link</strong>
                <span>No participant account needed</span>
              </div>
            )}
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                setStep(step ? 0 : 1);
                setChoice(null);
              }}
            >
              {step ? "Restart example" : "Try a sample question →"}
            </button>
            <p className={styles.feedback} role="status">
              {choice !== null
                ? choice === 0
                  ? "One clear action gives the team a place to start."
                  : "A smaller next step can be easier to act on."
                : "Local example. No practice attempt is created."}
            </p>
          </>
        )}
        {kind === "collaboration" && (
          <>
            <p className={styles.kicker}>Shared library · independent drafts</p>
            <h2>Share a starting point. Make it your own.</h2>
            <ol className={styles.libraryFlow}>
              <li>
                <span className={styles.tag}>Published source</span>
                <strong>Team check-in</strong>
                <span>Stable version for your group</span>
              </li>
              <li>
                <span className={styles.tag}>Your new draft</span>
                <strong>{step ? "Our Monday check-in" : "Team check-in (copy)"}</strong>
                <span>Edit your own questions</span>
              </li>
            </ol>
            <button type="button" className={styles.action} onClick={() => setStep(step ? 0 : 1)}>
              {step ? "Reset example" : "Personalize sample title"}
            </button>
            <p className={styles.feedback} role="status">
              {step ? "The shared source stays the same." : "Try changing the sample draft title."}
            </p>
          </>
        )}
      </div>
      <p className={styles.caption} id={`${id}-caption`}>
        Illustrative example · sample data · nothing is sent or saved
      </p>
    </section>
  );
}
