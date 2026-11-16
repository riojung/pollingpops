"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ApplyRecoveryPackUpdate,
  QuestionDraft,
  QuizDraft,
  RecoveryPackContent,
  RecoveryPackUpdatePreview,
  SupportedLocale,
} from "@openround/contracts";
import { packUpdateCopy, packUpdateFeedback } from "../../lib/i18n/pack-update-copy";
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
} as const;

export function RecoveryPackUpdatePanel<TDraft = QuizDraft>({
  quizId,
  locale = "en-CA",
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
  locale?: SupportedLocale;
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
  const copy = packUpdateCopy(locale);
  const artifact = copy(artifactLabel);
  const [review, setReview] = useState<RecoveryPackUpdatePreview | null>(null);
  const [selections, setSelections] = useState<RecoveryPackSelections>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const errorCopy = packUpdateFeedback(locale, error, artifactLabel);
  const announcementCopy = packUpdateFeedback(locale, announcement, artifactLabel);
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
  const linkIssue = review ? recoveryPackSelectedLinkIssue(review, choices) : null;
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
    <details className={styles.panel} lang={locale}>
      <summary>
        {copy("Review Pack updates")} · <span lang="">{title}</span>
      </summary>
      <h2 className="sr-only">{copy("Recovery Pack update review")}</h2>
      <p>
        {copy(
          "Compare the accepted source baseline (initially the inserted Pack), your local checkpoints, and the latest published Pack. Only unchanged local copies receive source changes by default. Conflicts and deleted checkpoints require an explicit choice.",
        )}
      </p>
      {!featureEnabled ? (
        <p className="notice">
          {copy(
            "Pack update authoring is disabled. Existing references and update comparisons remain readable.",
          )}
        </p>
      ) : null}
      {referenceContent ? (
        <details className={styles.references}>
          <summary>{copy("Accepted facilitator references")}</summary>
          <p className="muted">
            {copy("These copied references change only when you accept a Pack update.")}{" "}
            {copy(
              "Live explanation or worked-example playback is available in eligible new {artifact} sessions when enabled for the workspace. The facilitator explicitly selects a card after revealing the Pack diagnostic.",
              { artifact },
            )}
          </p>
          {referenceContent.interventions.map((card) => (
            <section key={card.id}>
              <h3 lang="">{card.title}</h3>
              <p className={styles.prompt} lang="">
                {card.body}
              </p>
              {card.citations.length ? (
                <p lang="">
                  {card.citations
                    .map((citation) => `${citation.sourceName}, ${citation.locator}`)
                    .join("; ")}
                </p>
              ) : null}
            </section>
          ))}
        </details>
      ) : null}
      <p
        className={styles.status}
        role="status"
        aria-live="polite"
        lang={blocked ? locale : announcementCopy.lang}
      >
        {blocked
          ? copy("Saving or reviewing the {artifact} draft…", { artifact })
          : announcementCopy.text}
      </p>
      {error ? (
        <p className="error" role="alert" lang={errorCopy.lang}>
          {errorCopy.text}
        </p>
      ) : null}
      <button
        className="button-quiet"
        type="button"
        disabled={blocked || receiptRetryable}
        onClick={() => void run(preview)}
      >
        {copy("Review latest Pack version")}
      </button>
      <p className="muted">
        {copy(
          "Review first saves pending {artifact} edits. Applying affects only this draft; existing published content never changes.",
          { artifact },
        )}
      </p>
      {review ? (
        <>
          <p>
            {copy(
              "Compared baseline version {baseline} with published version {latest} at {artifact} revision {revision}.",
              {
                baseline: review.baselineVersion,
                latest: review.latestVersion,
                artifact,
                revision: review.draftRevision,
              },
            )}
          </p>
          {!updateAvailable ? (
            <p className="notice">
              {copy(
                "This insertion is already up to date with the latest published Pack. You can compare its contents, but this published version is already the accepted source baseline.",
              )}
            </p>
          ) : null}
          {updateAvailable && review.latestVersion < review.baselineVersion ? (
            <p className="notice">
              {copy(
                "The source currently republishes an earlier immutable Pack version. Applying this review accepts that published version; it does not rewrite either source version.",
              )}
            </p>
          ) : null}
          {review.contextChanged ? (
            <p className="notice">
              {copy(
                "The Pack context changed. Compare its exact contents below. Accepting the update refreshes these references even when both local checkpoints are kept. Existing references remain unchanged until you apply.",
              )}
            </p>
          ) : null}
          <details className={styles.references}>
            <summary>{copy("Pack context comparison: baseline and latest")}</summary>
            <div className={styles.contextComparison}>
              <PackContext
                locale={locale}
                title={copy("Accepted baseline context")}
                content={review.baselineContent}
              />
              <PackContext
                locale={locale}
                title={copy("Latest published context")}
                content={review.latestContent}
              />
            </div>
          </details>
          {review.items.map((item) => (
            <section className={styles.item} key={item.role}>
              <h3>{item.role === "diagnostic" ? copy("Diagnostic") : copy("Linked recheck")}</h3>
              <p className={item.status === "conflict" ? "notice" : "muted"}>
                {copy(statusLabels[item.status])}
              </p>
              <p className="muted">
                {copy("Local differences:")}{" "}
                <span lang="en-CA">
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
                  ).join(", ") || <span lang={locale}>{copy("none")}</span>}
                </span>
                . {copy("Pack differences:")}{" "}
                <span lang="en-CA">
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
                  ).join(", ") || <span lang={locale}>{copy("none")}</span>}
                </span>
                .
              </p>
              <div className={styles.comparison}>
                <QuestionComparison
                  locale={locale}
                  title={copy("Accepted source baseline")}
                  question={item.baseline}
                />
                <QuestionComparison
                  locale={locale}
                  title={copy("Local draft")}
                  question={item.local}
                />
                <QuestionComparison
                  locale={locale}
                  title={copy("Latest published Pack")}
                  question={item.latest}
                />
              </div>
              <label className="field">
                <span>
                  {copy("{role} update choice", {
                    role: copy(item.role === "diagnostic" ? "Diagnostic" : "Recheck"),
                  })}
                </span>
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
                  <option value="">{copy("Choose explicitly")}</option>
                  <option value="keep_local">
                    {copy(item.local ? "Keep my local checkpoint" : "Keep this checkpoint deleted")}
                  </option>
                  <option value="use_latest">
                    {copy(
                      item.local
                        ? "Use latest published checkpoint"
                        : "Restore from latest published checkpoint",
                    )}
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
            {copy("Apply reviewed Pack update")}
          </button>
          <RecoveryPackLinkIssue locale={locale} artifactLabel={artifactLabel} issue={linkIssue} />
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
          {copy(
            retryOperation === "apply"
              ? "Retry Pack update acknowledgement"
              : "Retry undo acknowledgement",
          )}
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
            {copy("Undo this Pack update")}
          </button>
          {!canUndo ? (
            <p className="muted">
              {copy(
                "Undo is unavailable after later draft changes; your newer work will not be overwritten.",
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function RecoveryPackLinkIssue({
  issue,
  locale = "en-CA",
  artifactLabel = "Round",
}: {
  issue: string | null;
  locale?: SupportedLocale;
  artifactLabel?: "Round" | "Presentation";
}) {
  const feedback = packUpdateFeedback(locale, issue ?? "", artifactLabel);
  return issue ? (
    <p
      className="notice"
      role="alert"
      aria-label={packUpdateCopy(locale)("Linked checkpoint choices")}
      lang={feedback.lang}
    >
      {feedback.text}
    </p>
  ) : null;
}

function PackContext({
  title,
  content,
  locale,
}: {
  title: string;
  content: RecoveryPackContent;
  locale: SupportedLocale;
}) {
  const copy = packUpdateCopy(locale);
  return (
    <section className={styles.question}>
      <h3>{title}</h3>
      <dl>
        <dt>{copy("Pack title")}</dt>
        <dd lang="">{content.title}</dd>
        <dt>{copy("Description")}</dt>
        <dd>{content.description ? <span lang="">{content.description}</span> : copy("None")}</dd>
        <dt>{copy("Concepts")}</dt>
        <dd lang="">{content.conceptKeys.join(", ")}</dd>
        <dt>{copy("Misconceptions")}</dt>
        <dd>
          {content.misconceptionKeys.length ? (
            <span lang="">{content.misconceptionKeys.join(", ")}</span>
          ) : (
            copy("None")
          )}
        </dd>
      </dl>
      <h4>{copy("Facilitator intervention cards")}</h4>
      {content.interventions.map((card) => (
        <section key={card.id}>
          <h4 lang="">{card.title}</h4>
          <p className={styles.prompt} lang="">
            {card.body}
          </p>
          {card.citations.length ? (
            <ul>
              {card.citations.map((citation, index) => (
                <li key={index} lang="">
                  <strong>
                    {citation.sourceName} · {citation.locator}
                  </strong>
                  <p>{citation.excerpt}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{copy("No card citations")}</p>
          )}
        </section>
      ))}
      <h4>{copy("Pack citations")}</h4>
      {content.citations.length ? (
        <ul>
          {content.citations.map((citation, index) => (
            <li key={index} lang="">
              <strong>
                {citation.sourceName} · {citation.locator}
              </strong>
              <p>{citation.excerpt}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{copy("None")}</p>
      )}
      {content.delayedProbe ? (
        <QuestionComparison
          locale={locale}
          title={copy("Delayed probe")}
          question={content.delayedProbe}
        />
      ) : (
        <p>{copy("No delayed probe.")}</p>
      )}
      <details>
        <summary>{copy("All Pack context fields")}</summary>
        <pre lang="en-CA">
          {JSON.stringify({ ...content, diagnostic: undefined, recheck: undefined }, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function QuestionComparison({
  title,
  question,
  locale,
}: {
  title: string;
  question: QuestionDraft | null;
  locale: SupportedLocale;
}) {
  const copy = packUpdateCopy(locale);
  return (
    <section className={styles.question}>
      <h4>{title}</h4>
      {!question ? (
        <p>{copy("Checkpoint deleted locally.")}</p>
      ) : (
        <>
          <p className={styles.prompt}>
            {question.prompt ? <span lang="">{question.prompt}</span> : copy("Empty prompt")}
          </p>
          <dl>
            <dt>{copy("Type / delivery / purpose")}</dt>
            <dd lang="en-CA">
              {question.type} · {question.delivery ?? "main"} · {question.purpose ?? "unspecified"}
            </dd>
            <dt>{copy("Timing / scoring / confidence")}</dt>
            <dd>
              {copy("{seconds}s · {points} points", {
                seconds: question.timeLimitSeconds,
                points: question.basePoints,
              })}{" "}
              · <span lang="en-CA">{question.confidence ?? "off"}</span>
            </dd>
            <dt>{copy("Concepts")}</dt>
            <dd>
              {question.conceptKeys?.length ? (
                <span lang="">{question.conceptKeys.join(", ")}</span>
              ) : (
                copy("None")
              )}
            </dd>
            <dt>{copy("Explanation")}</dt>
            <dd>
              {question.explanation ? <span lang="">{question.explanation}</span> : copy("None")}
            </dd>
          </dl>
          {"choices" in question ? (
            <ul>
              {question.choices.map((choice) => (
                <li key={choice.id}>
                  {choice.label ? <span lang="">{choice.label}</span> : copy("Empty choice")}
                  {choice.isCorrect ? <> {copy("(correct)")}</> : null}
                  {choice.feedback ? <span lang=""> — {choice.feedback}</span> : null}
                </li>
              ))}
            </ul>
          ) : question.type === "numeric" ? (
            <p>
              {copy("Accepted value {value} · tolerance {tolerance}", {
                value: question.correctValue,
                tolerance: question.tolerance,
              })}
              {question.unit ? <span lang=""> {question.unit}</span> : null}
            </p>
          ) : question.type === "rating" ? (
            <p>{copy("Rating {min}–{max}", { min: question.min, max: question.max })}</p>
          ) : (
            <p>{copy("This response format is available in live Rounds only.")}</p>
          )}
          <details>
            <summary>{copy("All checkpoint fields")}</summary>
            <pre lang="en-CA">{JSON.stringify(question, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
