"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ApplyRecoveryPackUpdate,
  QuestionDraft,
  QuizDraft,
  RecoveryPackContent,
  RecoveryPackUpdatePreview,
} from "@openround/contracts";
import { humanError } from "../../lib/api";
import {
  recoveryPackChangedFields,
  recoveryPackDefaultSelections,
  recoveryPackReviewIsCurrent,
  recoveryPackSelectedChoices,
  recoveryPackSelectedLinkIssue,
  recoveryPackUpdateAvailable,
  recoveryPackUndoIsCurrent,
  type RecoveryPackSelections,
} from "../../lib/recovery-pack-update-ui";
import { clientUuid } from "../../lib/uuid";
import styles from "./recovery-pack-update-panel.module.css";

export interface RecoveryPackUpdateApplied<TDraft = QuizDraft> {
  quiz: { id: string; draft: TDraft; draftRevision: number };
  undo: { sourceRevision: number; appliedRevision: number };
}
export interface RecoveryPackUpdateUndo {
  sourceRevision: number;
  expectedRevision: number;
  mutationId: string;
}

const statusLabels = {
  unchanged: "No checkpoint change required",
  source_changed: "Pack changed; local copy unchanged",
  local_changed: "Local copy changed; Pack unchanged",
  conflict: "Local copy and Pack both changed — choose explicitly",
};

export function RecoveryPackUpdatePanel<TDraft = QuizDraft>({
  quizId,
  artifactLabel = "Round",
  allowDisabledReceiptRetry = false,
  insertionId,
  title,
  canEdit,
  featureEnabled,
  currentDraftRevision,
  draftSignature,
  draftSaved,
  mutationBusy,
  receiptRetryable,
  referenceContent,
  onReview,
  onApply,
  onUndo,
}: {
  quizId: string;
  artifactLabel?: "Round" | "Presentation";
  allowDisabledReceiptRetry?: boolean;
  insertionId: string;
  title: string;
  referenceContent?: RecoveryPackContent;
  canEdit: boolean;
  featureEnabled: boolean;
  currentDraftRevision: number;
  draftSignature: string;
  draftSaved: boolean;
  mutationBusy: boolean;
  receiptRetryable: boolean;
  onReview: (insertionId: string) => Promise<RecoveryPackUpdatePreview>;
  onApply: (input: ApplyRecoveryPackUpdate) => Promise<RecoveryPackUpdateApplied<TDraft>>;
  onUndo: (input: RecoveryPackUpdateUndo) => Promise<void>;
}) {
  const [review, setReview] = useState<RecoveryPackUpdatePreview | null>(null);
  const [selections, setSelections] = useState<RecoveryPackSelections>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [retryOperation, setRetryOperation] = useState<"apply" | "undo" | null>(null);
  const [undo, setUndo] = useState<
    (RecoveryPackUpdateApplied<TDraft>["undo"] & { draftSignature: string }) | null
  >(null);
  const reviewedDraft = useRef("");
  const currentDraft = useRef(draftSignature);
  currentDraft.current = draftSignature;
  const alive = useRef(true);
  const running = useRef(false);
  const requestGeneration = useRef(0);
  const applyAttempt = useRef<{ signature: string; input: ApplyRecoveryPackUpdate } | null>(null);
  const undoAttempt = useRef<RecoveryPackUpdateUndo | null>(null);
  const current = Boolean(
    review &&
    recoveryPackReviewIsCurrent(
      review,
      currentDraftRevision,
      reviewedDraft.current,
      draftSignature,
    ),
  );
  const choices = review ? recoveryPackSelectedChoices(review, selections) : null;
  const linkIssue = review
    ? (recoveryPackSelectedLinkIssue(review, choices)?.replaceAll("Round", artifactLabel) ?? null)
    : null;
  const updateAvailable = Boolean(review && recoveryPackUpdateAvailable(review));
  const canUndo = recoveryPackUndoIsCurrent(undo, currentDraftRevision, draftSignature);
  const blocked = busy || mutationBusy;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (
      !review ||
      recoveryPackReviewIsCurrent(
        review,
        currentDraftRevision,
        reviewedDraft.current,
        draftSignature,
      )
    )
      return;
    requestGeneration.current += 1;
    setReview(null);
    setSelections({});
    applyAttempt.current = null;
    setRetryOperation(null);
    setAnnouncement("The draft changed. Review the Pack update again before applying it.");
  }, [currentDraftRevision, draftSignature, review]);

  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setAnnouncement("");
    try {
      await action();
    } catch (caught) {
      if (alive.current) setError(humanError(caught));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function preview() {
    if (blocked) return;
    const generation = ++requestGeneration.current;
    const capturedDraft = currentDraft.current;
    setReview(null);
    applyAttempt.current = null;
    setRetryOperation(null);
    const next = await onReview(insertionId);
    if (!alive.current || generation !== requestGeneration.current) return;
    if (
      capturedDraft !== currentDraft.current ||
      next.quizId !== quizId ||
      next.insertionId !== insertionId
    ) {
      throw new Error("The local draft changed during review. Review the Pack again.");
    }
    reviewedDraft.current = capturedDraft;
    setSelections(recoveryPackDefaultSelections(next));
    setReview(next);
  }

  async function apply(retry = false) {
    if (
      !review ||
      !updateAvailable ||
      !choices ||
      !current ||
      !canEdit ||
      (!featureEnabled && !(retry && allowDisabledReceiptRetry)) ||
      blocked ||
      (!draftSaved && !(retry && receiptRetryable)) ||
      (!retry && linkIssue)
    )
      return;
    const signature = JSON.stringify({
      quizId,
      insertionId,
      packVersionId: review.latestVersionId,
      expectedRevision: review.draftRevision,
      choices,
    });
    if (retry) {
      if (!applyAttempt.current || applyAttempt.current.signature !== signature) return;
    } else if (applyAttempt.current?.signature !== signature) {
      applyAttempt.current = {
        signature,
        input: {
          quizId,
          insertionId,
          packVersionId: review.latestVersionId,
          expectedRevision: review.draftRevision,
          mutationId: clientUuid(),
          choices,
        },
      };
    }
    try {
      const result = await onApply(applyAttempt.current!.input);
      if (!alive.current) return;
      applyAttempt.current = null;
      setRetryOperation(null);
      setReview(null);
      setUndo({ ...result.undo, draftSignature: JSON.stringify(result.quiz.draft) });
      setAnnouncement(
        `Pack update saved as one draft revision. Published ${artifactLabel === "Round" ? "Rounds" : "Presentations"} and the original inserted baseline are unchanged.`,
      );
    } catch (caught) {
      if (alive.current) setRetryOperation("apply");
      throw caught;
    }
  }

  async function undoUpdate(retry = false) {
    if (!undo || !canUndo || !canEdit || blocked || (!draftSaved && !(retry && receiptRetryable)))
      return;
    if (!undoAttempt.current || undoAttempt.current.expectedRevision !== undo.appliedRevision) {
      undoAttempt.current = {
        sourceRevision: undo.sourceRevision,
        expectedRevision: undo.appliedRevision,
        mutationId: clientUuid(),
      };
    }
    try {
      await onUndo(undoAttempt.current);
      if (!alive.current) return;
      undoAttempt.current = null;
      setUndo(null);
      setRetryOperation(null);
      setReview(null);
      setAnnouncement("Pack update undone as a new draft revision.");
    } catch (caught) {
      if (alive.current) setRetryOperation("undo");
      throw caught;
    }
  }

  return (
    <details className={styles.panel} lang="en-CA">
      <summary>Review Pack updates · {title}</summary>
      <h2 className="sr-only">Recovery Pack update review</h2>
      <p>
        Compare the accepted source baseline (initially the inserted Pack), your local checkpoints,
        and the latest published Pack. Only unchanged local copies receive source changes by
        default. Conflicts and deleted checkpoints require an explicit choice.
      </p>
      {!featureEnabled ? (
        <p className="notice">
          Pack update authoring is disabled. Existing references and update comparisons remain
          readable.
        </p>
      ) : null}
      {referenceContent ? (
        <details className={styles.references}>
          <summary>Accepted facilitator references</summary>
          <p className="muted">
            These copied references change only when you accept a Pack update. Live explanation or
            worked-example playback is available in eligible new {artifactLabel} sessions when
            enabled for the workspace. The facilitator explicitly selects a card after revealing the
            Pack diagnostic.
          </p>
          {referenceContent.interventions.map((card) => (
            <section key={card.id}>
              <h3>{card.title}</h3>
              <p className={styles.prompt}>{card.body}</p>
              {card.citations.length ? (
                <p>
                  {card.citations
                    .map((citation) => `${citation.sourceName}, ${citation.locator}`)
                    .join("; ")}
                </p>
              ) : null}
            </section>
          ))}
        </details>
      ) : null}
      <p className={styles.status} role="status" aria-live="polite">
        {blocked ? `Saving or reviewing the ${artifactLabel} draft…` : announcement}
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="button-quiet"
        type="button"
        disabled={blocked || receiptRetryable}
        onClick={() => void run(preview)}
      >
        Review latest Pack version
      </button>
      <p className="muted">
        Review first saves pending {artifactLabel} edits. Applying affects only this draft; existing
        published content never changes.
      </p>
      {review ? (
        <>
          <p>
            Compared baseline version {review.baselineVersion} with published version{" "}
            {review.latestVersion} at {artifactLabel} revision {review.draftRevision}.
          </p>
          {!updateAvailable ? (
            <p className="notice">
              This insertion is already up to date with the latest published Pack. You can compare
              its contents, but this published version is already the accepted source baseline.
            </p>
          ) : null}
          {updateAvailable && review.latestVersion < review.baselineVersion ? (
            <p className="notice">
              The source currently republishes an earlier immutable Pack version. Applying this
              review accepts that published version; it does not rewrite either source version.
            </p>
          ) : null}
          {review.contextChanged ? (
            <p className="notice">
              The Pack context changed. Compare its exact contents below. Accepting the update
              refreshes these references even when both local checkpoints are kept. Existing
              references remain unchanged until you apply.
            </p>
          ) : null}
          <details className={styles.references}>
            <summary>Pack context comparison: baseline and latest</summary>
            <div className={styles.contextComparison}>
              <PackContext title="Accepted baseline context" content={review.baselineContent} />
              <PackContext title="Latest published context" content={review.latestContent} />
            </div>
          </details>
          {review.items.map((item) => (
            <section className={styles.item} key={item.role}>
              <h3>{item.role === "diagnostic" ? "Diagnostic" : "Linked recheck"}</h3>
              <p className={item.status === "conflict" ? "notice" : "muted"}>
                {statusLabels[item.status]}
              </p>
              <p className="muted">
                Local differences:{" "}
                {recoveryPackChangedFields(
                  item.baseline,
                  item.local,
                  {
                    diagnostic: review.baselineContent.diagnostic.id,
                    recheck: review.baselineContent.recheck.id,
                  },
                  {
                    diagnostic: review.items.find((candidate) => candidate.role === "diagnostic")!
                      .questionId,
                    recheck: review.items.find((candidate) => candidate.role === "recheck")!
                      .questionId,
                  },
                ).join(", ") || "none"}
                . Pack differences:{" "}
                {recoveryPackChangedFields(
                  item.baseline,
                  item.latest,
                  {
                    diagnostic: review.baselineContent.diagnostic.id,
                    recheck: review.baselineContent.recheck.id,
                  },
                  {
                    diagnostic: review.latestContent.diagnostic.id,
                    recheck: review.latestContent.recheck.id,
                  },
                ).join(", ") || "none"}
                .
              </p>
              <div className={styles.comparison}>
                <QuestionComparison title="Accepted source baseline" question={item.baseline} />
                <QuestionComparison title="Local draft" question={item.local} />
                <QuestionComparison title="Latest published Pack" question={item.latest} />
              </div>
              <label className="field">
                <span>{item.role === "diagnostic" ? "Diagnostic" : "Recheck"} update choice</span>
                <select
                  className="select"
                  value={selections[item.role] ?? ""}
                  disabled={
                    !canEdit ||
                    !featureEnabled ||
                    blocked ||
                    !current ||
                    !updateAvailable ||
                    receiptRetryable
                  }
                  onChange={(event) => {
                    setSelections((value) => ({
                      ...value,
                      [item.role]: event.target.value as "keep_local" | "use_latest",
                    }));
                    applyAttempt.current = null;
                  }}
                >
                  <option value="">Choose explicitly</option>
                  <option value="keep_local">
                    {item.local ? "Keep my local checkpoint" : "Keep this checkpoint deleted"}
                  </option>
                  <option value="use_latest">
                    {item.local
                      ? "Use latest published checkpoint"
                      : "Restore from latest published checkpoint"}
                  </option>
                </select>
              </label>
            </section>
          ))}
          <button
            className="button"
            type="button"
            disabled={
              !canEdit ||
              !featureEnabled ||
              blocked ||
              !current ||
              !updateAvailable ||
              !choices ||
              Boolean(linkIssue) ||
              !draftSaved ||
              receiptRetryable
            }
            onClick={() => void run(() => apply())}
          >
            Apply reviewed Pack update
          </button>
          <RecoveryPackLinkIssue issue={linkIssue} />
        </>
      ) : null}
      {retryOperation && receiptRetryable ? (
        <button
          className="button"
          type="button"
          disabled={
            blocked ||
            !canEdit ||
            (retryOperation === "apply" && !featureEnabled && !allowDisabledReceiptRetry) ||
            (retryOperation === "apply" ? !current : !canUndo)
          }
          onClick={() =>
            void run(() => (retryOperation === "apply" ? apply(true) : undoUpdate(true)))
          }
        >
          Retry {retryOperation === "apply" ? "Pack update" : "undo"} acknowledgement
        </button>
      ) : null}
      {undo ? (
        <div className={styles.undo}>
          <button
            className="button-quiet"
            type="button"
            disabled={!canEdit || blocked || !canUndo || !draftSaved || receiptRetryable}
            onClick={() => void run(() => undoUpdate())}
          >
            Undo this Pack update
          </button>
          {!canUndo ? (
            <p className="muted">
              Undo is unavailable after later draft changes; your newer work will not be
              overwritten.
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function RecoveryPackLinkIssue({ issue }: { issue: string | null }) {
  return issue ? (
    <p className="notice" role="alert" aria-label="Linked checkpoint choices">
      {issue}
    </p>
  ) : null;
}

function PackContext({ title, content }: { title: string; content: RecoveryPackContent }) {
  return (
    <section className={styles.question}>
      <h3>{title}</h3>
      <dl>
        <dt>Pack title</dt>
        <dd>{content.title}</dd>
        <dt>Description</dt>
        <dd>{content.description || "None"}</dd>
        <dt>Concepts</dt>
        <dd>{content.conceptKeys.join(", ")}</dd>
        <dt>Misconceptions</dt>
        <dd>{content.misconceptionKeys.join(", ") || "None"}</dd>
      </dl>
      <h4>Facilitator intervention cards</h4>
      {content.interventions.map((card) => (
        <section key={card.id}>
          <h4>{card.title}</h4>
          <p className={styles.prompt}>{card.body}</p>
          {card.citations.length ? (
            <ul>
              {card.citations.map((citation, index) => (
                <li key={index}>
                  <strong>
                    {citation.sourceName} · {citation.locator}
                  </strong>
                  <p>{citation.excerpt}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No card citations</p>
          )}
        </section>
      ))}
      <h4>Pack citations</h4>
      {content.citations.length ? (
        <ul>
          {content.citations.map((citation, index) => (
            <li key={index}>
              <strong>
                {citation.sourceName} · {citation.locator}
              </strong>
              <p>{citation.excerpt}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None</p>
      )}
      {content.delayedProbe ? (
        <QuestionComparison title="Delayed probe" question={content.delayedProbe} />
      ) : (
        <p>No delayed probe.</p>
      )}
      <details>
        <summary>All Pack context fields</summary>
        <pre>
          {JSON.stringify({ ...content, diagnostic: undefined, recheck: undefined }, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function QuestionComparison({
  title,
  question,
}: {
  title: string;
  question: QuestionDraft | null;
}) {
  return (
    <section className={styles.question}>
      <h4>{title}</h4>
      {!question ? (
        <p>Checkpoint deleted locally.</p>
      ) : (
        <>
          <p className={styles.prompt}>{question.prompt || "Empty prompt"}</p>
          <dl>
            <dt>Type / delivery / purpose</dt>
            <dd>
              {question.type} · {question.delivery ?? "main"} · {question.purpose ?? "unspecified"}
            </dd>
            <dt>Timing / scoring / confidence</dt>
            <dd>
              {question.timeLimitSeconds}s · {question.basePoints} points ·{" "}
              {question.confidence ?? "off"}
            </dd>
            <dt>Concepts</dt>
            <dd>{question.conceptKeys?.join(", ") || "None"}</dd>
            <dt>Explanation</dt>
            <dd>{question.explanation || "None"}</dd>
          </dl>
          {"choices" in question ? (
            <ul>
              {question.choices.map((choice) => (
                <li key={choice.id}>
                  {choice.label || "Empty choice"}
                  {choice.isCorrect ? " (correct)" : ""}
                  {choice.feedback ? ` — ${choice.feedback}` : ""}
                </li>
              ))}
            </ul>
          ) : question.type === "numeric" ? (
            <p>
              Accepted value {question.correctValue} · tolerance {question.tolerance}
              {question.unit ? ` ${question.unit}` : ""}
            </p>
          ) : question.type === "rating" ? (
            <p>
              Rating {question.min}–{question.max}
            </p>
          ) : (
            <p>This response format is available in live Rounds only.</p>
          )}
          <details>
            <summary>All checkpoint fields</summary>
            <pre>{JSON.stringify(question, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
