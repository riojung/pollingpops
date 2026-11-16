"use client";

import { useEffect, useState } from "react";
import type { PresentationPracticeAnswer, PresentationReviewBlock } from "@openround/contracts";
import { fetchPracticeImage } from "../../lib/presentation-practice-client";
import { Brand } from "../brand";
import {
  AssignmentContentPage,
  AssignmentImage,
} from "../presentation-assignments/assignment-content-page";
import { presentationReviewBlockTitle } from "../presentation-sharing/review-page";
import { usePracticeReader } from "./use-practice-reader";
import styles from "../presentation-sharing/sharing.module.css";
import readerStyles from "../presentation-assignments/assignment.module.css";
import practiceStyles from "./practice.module.css";

export function PracticeQuestion({
  block,
  answer,
  active,
  disabled,
  onSubmit,
}: {
  block: Extract<PresentationReviewBlock, { kind: "question" }>;
  answer: PresentationPracticeAnswer | undefined;
  active: boolean;
  disabled: boolean;
  onSubmit: (choiceId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const correctLabel = answer
    ? block.question.choices?.find(
        (choice) => choice.id.toLowerCase() === answer.feedback.correctChoiceId.toLowerCase(),
      )?.label
    : null;
  return (
    <article className={styles.question}>
      <h2>{block.question.prompt}</h2>
      {active && !answer ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (selected && !disabled) onSubmit(selected);
          }}
        >
          <fieldset disabled={disabled} className={practiceStyles.choices}>
            <legend>Choose your answer</legend>
            {block.question.choices?.map((choice) => (
              <label key={choice.id}>
                <input
                  type="radio"
                  name={`practice-${block.id}`}
                  value={choice.id}
                  checked={selected === choice.id}
                  onChange={() => setSelected(choice.id)}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </fieldset>
          <p>Your submitted answer is final. Feedback appears after it is accepted.</p>
          <button type="submit" disabled={disabled || !selected}>
            Submit answer
          </button>
        </form>
      ) : (
        <ol>
          {block.question.choices?.map((choice) => (
            <li key={choice.id}>{choice.label}</li>
          ))}
        </ol>
      )}
      {answer ? (
        <section className={practiceStyles.feedback} aria-label="Your accepted answer">
          <p role="status">
            <strong>{answer.correct ? "Correct" : "Incorrect"}</strong> · Answer accepted
          </p>
          <p>
            Your answer:{" "}
            {
              block.question.choices?.find(
                (choice) => choice.id.toLowerCase() === answer.choiceId.toLowerCase(),
              )?.label
            }
          </p>
          <p>Correct answer: {correctLabel}</p>
          {answer.feedback.explanation ? <p>{answer.feedback.explanation}</p> : null}
          {answer.feedback.selectedFeedback ? <p>{answer.feedback.selectedFeedback}</p> : null}
          <p>This question page was marked read when your answer was accepted.</p>
        </section>
      ) : !active ? (
        <p>Preview only. Start practice to submit an answer.</p>
      ) : null}
    </article>
  );
}

export function PresentationPracticePage({ assignmentId }: { assignmentId: string }) {
  const reader = usePracticeReader(assignmentId);
  const [pastedLink, setPastedLink] = useState("");
  useEffect(() => {
    setPastedLink("");
  }, [reader.token]);
  const review = reader.preview?.review,
    block = review?.blocks[reader.index];
  const readIds = new Set(reader.attempt?.readBlockIds.map((id) => id.toLowerCase()));
  const questionCount = review?.blocks.filter((page) => page.kind === "question").length ?? 0;
  const allDone =
    !!review &&
    readIds.size === review.blocks.length &&
    reader.attempt?.answers.length === questionCount;
  const answer = reader.attempt?.answers.find(
    (value) => value.blockId.toLowerCase() === block?.id.toLowerCase(),
  );
  return (
    <div className={styles.review} lang="en-CA">
      <header className="shell topbar">
        <Brand />
      </header>
      <main className="shell page-main" id="main">
        {review && block && reader.preview && reader.token ? (
          <>
            <h1>{review.title}</h1>
            <p>
              Practice assignment · Published version {review.version} · Deadline{" "}
              {new Date(reader.preview.assignment.expiresAt).toLocaleString("en-CA")}
            </p>
            <p>
              Read the content pages and answer each check once. Practice has no timer or points.
              Identity is not verified; results do not establish mastery.
            </p>
            <section className={readerStyles.reader} aria-label="Your practice attempt">
              {reader.attempt ? (
                <>
                  <p role="status">
                    {reader.attempt.readBlockIds.length} of {review.blocks.length} pages read ·{" "}
                    {reader.attempt.answers.length} of {questionCount} checks answered
                  </p>
                  {reader.attempt.completedAt ? (
                    <>
                      <p role="status">
                        <strong>Practice complete</strong> — you acknowledged every page, answered
                        every check and finished this attempt.
                      </p>
                      <p>
                        Your results:{" "}
                        {reader.attempt.answers.filter((value) => value.correct).length} correct of{" "}
                        {reader.attempt.answers.length} answered checks.
                      </p>
                    </>
                  ) : (
                    <p>
                      Mark content pages read, submit each answer, then finish when you are ready.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>Previewing does not start an attempt or record any progress.</p>
                  {reader.hasResume ? (
                    <button
                      type="button"
                      disabled={reader.busy}
                      onClick={() => void reader.resume()}
                    >
                      Resume practice
                    </button>
                  ) : null}
                  {!reader.pending ? (
                    <button
                      type="button"
                      disabled={reader.busy}
                      onClick={() => void reader.start(true)}
                    >
                      {reader.hasResume ? "Start a new practice attempt" : "Start practice"}
                    </button>
                  ) : null}
                </>
              )}
              {reader.resumeUrl ? (
                <div className={readerStyles.resume}>
                  <p>
                    Keep your personal resume link to continue after refreshing or on another
                    device. Anyone with this link can access your answers and progress.
                  </p>
                  <label>
                    Your private resume link
                    <textarea
                      readOnly
                      rows={3}
                      value={reader.resumeUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!navigator.clipboard?.writeText) {
                        reader.setError("Select and copy your private resume link.");
                        return;
                      }
                      void navigator.clipboard
                        .writeText(reader.resumeUrl)
                        .catch(() => reader.setError("Select and copy your private resume link."));
                    }}
                  >
                    Copy private resume link
                  </button>
                </div>
              ) : null}
              {reader.attempt || reader.hasResume || reader.pending === "start" ? (
                <>
                  <p>
                    Clear reader before someone else uses this browser. Keep your private resume
                    link first.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPastedLink("");
                      reader.resetReader();
                    }}
                  >
                    Clear reader
                  </button>
                </>
              ) : null}
              {reader.pending === "start" ? (
                <button
                  type="button"
                  disabled={reader.busy}
                  onClick={() => void reader.start(false)}
                >
                  Retry starting practice
                </button>
              ) : null}
              {reader.pending === "progress" ? (
                <button type="button" disabled={reader.busy} onClick={() => void reader.progress()}>
                  Retry saving progress
                </button>
              ) : null}
            </section>
            <div className={styles.reviewLayout}>
              <nav aria-label="Presentation pages" className={styles.pageMap}>
                <ol>
                  {review.blocks.map((page, index) => (
                    <li key={page.id}>
                      <button
                        type="button"
                        aria-current={reader.index === index ? "page" : undefined}
                        disabled={reader.busy || !!reader.pending}
                        onClick={() => void reader.changePage(index)}
                      >
                        {index + 1}. {presentationReviewBlockTitle(page, index)}
                        {readIds.has(page.id.toLowerCase()) ? " · Read" : ""}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              <section
                className={styles.viewer}
                aria-label="Current presentation page"
                key={`${reader.attempt?.id ?? "preview"}:${block.id}`}
              >
                <p role="status">
                  Page {reader.index + 1} of {review.blocks.length}
                </p>
                {block.kind === "content" ? (
                  <AssignmentContentPage
                    block={block}
                    review={review}
                    sourceId={assignmentId}
                    token={reader.token}
                    fetchImage={fetchPracticeImage}
                    onNavigate={(index) => void reader.changePage(index)}
                  />
                ) : (
                  <>
                    {block.question.mediaId ? (
                      <AssignmentImage
                        sourceId={assignmentId}
                        token={reader.token}
                        mediaId={block.question.mediaId}
                        alt={block.question.mediaAlt}
                        fetchImage={fetchPracticeImage}
                      />
                    ) : null}
                    <PracticeQuestion
                      key={block.id}
                      block={block}
                      answer={answer}
                      active={!!reader.attempt}
                      disabled={reader.busy || !!reader.pending || !!reader.attempt?.completedAt}
                      onSubmit={(choiceId) => void reader.progress("answer", block.id, choiceId)}
                    />
                  </>
                )}
                <div className={styles.controls}>
                  <button
                    type="button"
                    disabled={reader.busy || !!reader.pending || reader.index === 0}
                    onClick={() => void reader.changePage(reader.index - 1)}
                  >
                    Previous page
                  </button>
                  <button
                    type="button"
                    disabled={
                      reader.busy || !!reader.pending || reader.index === review.blocks.length - 1
                    }
                    onClick={() => void reader.changePage(reader.index + 1)}
                  >
                    Next page
                  </button>
                </div>
                {reader.attempt && !reader.attempt.completedAt ? (
                  <div className={styles.controls}>
                    {block.kind === "content" ? (
                      <button
                        type="button"
                        disabled={
                          reader.busy || !!reader.pending || readIds.has(block.id.toLowerCase())
                        }
                        onClick={() => void reader.progress("read", block.id)}
                      >
                        {readIds.has(block.id.toLowerCase())
                          ? "Page marked read"
                          : "Mark page as read"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={reader.busy || !!reader.pending || !allDone}
                      onClick={() => void reader.progress("complete")}
                    >
                      Finish practice
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <>
            <h1>Private practice assignment</h1>
            <p role={reader.loading ? "status" : "alert"}>
              {reader.loading
                ? "Opening practice assignment…"
                : "This practice assignment is unavailable or has expired."}
            </p>
            {reader.token ? (
              <button
                type="button"
                disabled={reader.busy}
                onClick={() => void reader.loadPreview()}
              >
                Retry opening assignment
              </button>
            ) : null}
          </>
        )}
        {reader.busy ? <p role="status">Checking and saving…</p> : null}
        {reader.error ? <p role="alert">{reader.error}</p> : null}
        <details className={readerStyles.resume}>
          <summary>Use a personal resume link</summary>
          <label>
            Personal resume link
            <textarea
              value={pastedLink}
              rows={3}
              onChange={(event) => setPastedLink(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={reader.busy}
            onClick={() => {
              if (reader.openResume(pastedLink)) setPastedLink("");
            }}
          >
            Open resume link
          </button>
        </details>
      </main>
    </div>
  );
}
