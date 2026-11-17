"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { QuizDraft } from "@openround/contracts";
import styles from "./assignment-setup.module.css";
import { PracticeLinkReceipt } from "../../../../components/practice/practice-link-receipt";
import {
  assignmentScheduleError,
  duplicatePersonalLabelCount,
} from "../../../../lib/assignment-setup";
import { assignmentSetupCopy } from "../../../../lib/i18n/assignment-setup-copy";
import { useLocale } from "../../../../components/locale-provider";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../../../lib/api";
import { formatDateTime, formatNumber } from "../../../../lib/i18n/format";
import {
  defaultPracticeWindow,
  localDateTimeValue,
  parsePersonalLabels,
  personalLabelsError,
  practicePersonalLinkLimit,
  type CreatedPractice,
  type PracticeTimeMode,
} from "../../../../lib/practice-assignment";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  title: string;
  draft: QuizDraft;
  currentVersionId: string | null;
}

interface PublishedVersion {
  id: string;
  version: number;
  content: QuizDraft;
  publishedAt: string;
}

function AssignPracticeController({ id }: { id: string }) {
  const { locale, t } = useLocale();
  const tRef = useRef(t);
  const {
    creator,
    loading: accountLoading,
    entitlements,
    productFeatures,
    canEdit,
    startUpgrade,
  } = useWorkspace();
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [currentVersion, setCurrentVersion] = useState<PublishedVersion | null>(null);
  const [title, setTitle] = useState("");
  const [timeMode, setTimeMode] = useState<PracticeTimeMode>("flex");
  const [opensLater, setOpensLater] = useState(false);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [maxClosesAt, setMaxClosesAt] = useState("");
  const [personalLabelsText, setPersonalLabelsText] = useState("");
  const [created, setCreated] = useState<CreatedPractice | null>(null);
  const [timezone, setTimezone] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [rawError, setRawError] = useState("");
  const windowInitialized = useRef(false);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const copy = assignmentSetupCopy(locale);
  const actorAvailable = Boolean(creator);
  const accountReady = Boolean(creator && !accountLoading);
  // Loading an unchanged account temporarily hides the controller without losing a form or
  // one-time receipt. Changes to authority invalidate pending mutation callbacks immediately.
  const authorityKey = JSON.stringify([
    id,
    creator?.userId,
    creator?.workspaceId,
    creator?.role,
    canEdit,
    productFeatures?.practiceAssignments,
    entitlements?.followups,
    entitlements?.maxPracticePersonalLinks,
    entitlements?.reportRetentionDays,
  ]);
  const authorityRef = useRef({ key: authorityKey });
  if (authorityRef.current.key !== authorityKey) authorityRef.current = { key: authorityKey };
  const authority = authorityRef.current;
  const accountReadyRef = useRef(accountReady);
  accountReadyRef.current = accountReady;
  const current = () => mounted.current && authorityRef.current === authority;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    busyRef.current = false;
    setBusy(false);
    setError("");
    setRawError("");
  }, [authority]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!actorAvailable) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void apiFetch<{ quiz: QuizRecord; currentVersion: PublishedVersion | null }>(
      `/v1/quizzes/${id}`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (cancelled || !mounted.current) return;
        setQuiz(response.quiz);
        setCurrentVersion(response.currentVersion);
        const publishedTitle = response.currentVersion?.content.title ?? response.quiz.title;
        setTitle(
          tRef.current("reportRound.assign.defaultTitle", { title: publishedTitle }).slice(0, 160),
        );
      })
      .catch((caught) => {
        if (!cancelled && mounted.current) setLoadError(humanError(caught));
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, loadAttempt, actorAvailable, creator?.userId, creator?.workspaceId, creator?.role]);

  useEffect(() => {
    if (!entitlements || windowInitialized.current) return;
    const now = new Date();
    const window = defaultPracticeWindow(now, entitlements.reportRetentionDays);
    setClosesAt(window.closesAt);
    setMaxClosesAt(window.maxClosesAt);
    setOpensAt(localDateTimeValue(new Date(now.getTime() + 60 * 60_000)));
    windowInitialized.current = true;
  }, [entitlements]);

  const personalLabels = parsePersonalLabels(personalLabelsText);
  const duplicateLabels = duplicatePersonalLabelCount(personalLabelsText, personalLabels.length);
  const personalLabelLimit = practicePersonalLinkLimit(entitlements);
  const rawLabelError = personalLabelsError(personalLabels, personalLabelLimit);
  const labelError = rawLabelError
    ? personalLabels.length > personalLabelLimit
      ? t("reportRound.assign.tooManyLabels", {
          maximum: formatNumber(locale, personalLabelLimit),
        })
      : t("reportRound.assign.labelTooLong")
    : null;
  const mainQuestionCount =
    currentVersion?.content.questions.filter((question) => (question.delivery ?? "main") === "main")
      .length ?? 0;
  const hasUnpublishedChanges = Boolean(
    quiz && currentVersion && JSON.stringify(quiz.draft) !== JSON.stringify(currentVersion.content),
  );
  const featureAvailable = productFeatures?.practiceAssignments === true;
  const entitlementAvailable = entitlements?.followups === true;
  const published = quiz?.status === "published" && Boolean(currentVersion);
  const pageLoading = loading || !accountReady;

  const scheduleError = assignmentScheduleError({ opensLater, opensAt, closesAt, maxClosesAt });
  const scheduleErrorText =
    scheduleError === "retention"
      ? copy("Close by {date} on your plan.", {
          date: maxClosesAt ? formatDateTime(locale, maxClosesAt) : "",
        })
      : scheduleError === "order"
        ? t("reportRound.assign.closeAfterOpen")
        : scheduleError === "past"
          ? copy("Choose a future close time.")
          : scheduleError === "invalid"
            ? copy("Choose valid opening and closing times.")
            : "";
  const displayDate = (value: string) =>
    value && Number.isFinite(new Date(value).getTime()) ? formatDateTime(locale, value) : "—";

  async function createPractice(event: FormEvent) {
    event.preventDefault();
    if (
      !current() ||
      !accountReadyRef.current ||
      busyRef.current ||
      !published ||
      !canEdit ||
      !featureAvailable ||
      !entitlementAvailable ||
      labelError
    )
      return;
    const opening = opensLater ? new Date(opensAt) : new Date();
    const closing = new Date(closesAt);
    if (assignmentScheduleError({ opensLater, opensAt, closesAt, maxClosesAt })) {
      setError(scheduleErrorText);
      setRawError("");
      window.requestAnimationFrame(() => {
        if (current()) errorRef.current?.focus();
      });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setRawError("");
    try {
      const response = await apiFetch<CreatedPractice>(`/v1/quizzes/${id}/practice-assignments`, {
        method: "POST",
        body: JSON.stringify({
          sourceQuizVersionId: currentVersion!.id,
          ...(title.trim() ? { title: title.trim() } : {}),
          timeMode,
          ...(opensLater ? { opensAt: opening.toISOString() } : {}),
          closesAt: closing.toISOString(),
          personalLabels,
        }),
      });
      if (current()) setCreated(response);
    } catch (caught) {
      if (!current()) return;
      setRawError(humanError(caught));
      window.requestAnimationFrame(() => {
        if (current()) errorRef.current?.focus();
      });
    } finally {
      if (current()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/dashboard">
          {t("reportRound.rehearsal.backToRounds")}
        </Link>
      }
      description={t("reportRound.assign.description")}
      eyebrow={t("delivery.practice.title")}
      requireBeta={false}
      title={t("reportRound.assign.title")}
      translationLevel="full"
    >
      {accountReady && (loadError || rawError || error) ? (
        <p
          className="error"
          lang={loadError || rawError ? "en-CA" : undefined}
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {loadError || rawError || error}
        </p>
      ) : null}
      {accountReady && loadError ? (
        <button
          className="button-quiet"
          onClick={() => setLoadAttempt((value) => value + 1)}
          type="button"
        >
          {t("delivery.common.retry")}
        </button>
      ) : null}
      {pageLoading ? (
        <div className={styles.loading} role="status">
          <span className={styles.loadingBar} aria-hidden="true" />
          <p>{t("reportRound.assign.loading")}</p>
        </div>
      ) : null}
      {!pageLoading && !loadError && !featureAvailable ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.notEnabledTitle")}</h2>
          <p>{t("reportRound.assign.notEnabledDescription")}</p>
          <Link className="button" href="/dashboard">
            {t("reportRound.assign.returnToRounds")}
          </Link>
        </section>
      ) : null}
      {!pageLoading && !loadError && featureAvailable && !canEdit ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.editorRequiredTitle")}</h2>
          <p>{t("reportRound.assign.editorRequiredDescription")}</p>
          <Link className="button" href={`/quiz/${id}/preview`}>
            {t("reportRound.assign.viewRound")}
          </Link>
        </section>
      ) : null}
      {!pageLoading && !loadError && featureAvailable && canEdit && quiz && !published ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.publishFirstTitle")}</h2>
          <p>{t("reportRound.assign.publishFirstDescription")}</p>
          <Link className="button" href={`/quiz/${id}`}>
            {t("reportRound.assign.openEditor")}
          </Link>
        </section>
      ) : null}
      {!pageLoading &&
      !loadError &&
      featureAvailable &&
      canEdit &&
      published &&
      !entitlementAvailable ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.requiresProTitle")}</h2>
          <p>{t("reportRound.assign.requiresProDescription")}</p>
          <div className={styles.formActions} style={{ justifyContent: "center" }}>
            <button
              className="button"
              onClick={() => {
                if (!current() || !accountReadyRef.current) return;
                setError("");
                setRawError("");
                void startUpgrade().catch((caught) => {
                  if (!current()) return;
                  setRawError(humanError(caught));
                  window.requestAnimationFrame(() => {
                    if (current()) errorRef.current?.focus();
                  });
                });
              }}
              type="button"
            >
              {t("workspace.explorePro")}
            </button>
            <Link className="button-quiet" href="/pricing">
              {t("account.subscription.comparePlans")}
            </Link>
          </div>
        </section>
      ) : null}
      {!pageLoading &&
      !loadError &&
      featureAvailable &&
      canEdit &&
      published &&
      entitlementAvailable &&
      mainQuestionCount === 0 ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.addMainTitle")}</h2>
          <p>{t("reportRound.assign.addMainDescription")}</p>
          <Link className="button" href={`/quiz/${id}`}>
            {t("reportRound.assign.openEditor")}
          </Link>
        </section>
      ) : null}
      {!pageLoading &&
      !loadError &&
      featureAvailable &&
      canEdit &&
      published &&
      entitlementAvailable &&
      mainQuestionCount > 0 &&
      quiz ? (
        created ? (
          <PracticeLinkReceipt created={created} locale={locale} doneHref="/assignments" />
        ) : (
          <div className={styles.setup}>
            <section className={styles.sourceCard} aria-labelledby="practice-source-heading">
              <div className={styles.sourceHeader}>
                <div className={styles.sourceIdentity}>
                  <p className="eyebrow">{t("reportRound.assign.publishedSource")}</p>
                  <h2 id="practice-source-heading" lang="">
                    {currentVersion?.content.title ?? quiz.title}
                  </h2>
                </div>
                <div className={styles.sourceBadges}>
                  <span className={styles.badge}>
                    {t("reportRound.assign.publishedVersion", {
                      version: currentVersion?.version ?? "",
                    })}
                  </span>
                  <span className={styles.badge}>
                    {formatNumber(locale, mainQuestionCount)}{" "}
                    {t("reportRound.assign.mainQuestions", {
                      count: formatNumber(locale, mainQuestionCount),
                    })}
                  </span>
                  <Link className={styles.sourceLink} href={`/quiz/${id}/preview`}>
                    {t("reportRound.assign.viewRound")} <span aria-hidden="true">↗</span>
                  </Link>
                </div>
              </div>
              <p className={styles.muted}>{t("reportRound.assign.immutableDescription")}</p>
              {hasUnpublishedChanges ? (
                <p className={styles.driftNotice}>{t("reportRound.assign.unpublishedNotice")}</p>
              ) : null}
            </section>

            <form className={styles.layout} onSubmit={createPractice} aria-busy={busy}>
              <div className={styles.sections}>
                <section className={styles.card} aria-labelledby="practice-settings-heading">
                  <div className={styles.sectionHeading}>
                    <span aria-hidden="true" className={styles.step}>
                      1
                    </span>
                    <h2 id="practice-settings-heading">{t("reportRound.assign.settings")}</h2>
                  </div>
                  <label className="field" htmlFor="practice-title">
                    <span>{t("reportRound.assign.titleField")}</span>
                    <input
                      className="input"
                      disabled={busy}
                      id="practice-title"
                      lang=""
                      maxLength={160}
                      onChange={(event) => setTitle(event.target.value)}
                      value={title}
                    />
                  </label>
                  <fieldset className={styles.fieldset} disabled={busy}>
                    <legend>{t("reportRound.assign.timing")}</legend>
                    <div className={styles.optionGrid}>
                      <label
                        className={`${styles.option} ${timeMode === "flex" ? styles.selected : ""}`}
                      >
                        <input
                          checked={timeMode === "flex"}
                          name="time-mode"
                          onChange={() => setTimeMode("flex")}
                          type="radio"
                          value="flex"
                        />
                        <span>
                          <strong>{t("reportRound.assign.timeFlex")}</strong>
                          <span>{t("reportRound.assign.timeFlexDescription")}</span>
                        </span>
                      </label>
                      <label
                        className={`${styles.option} ${timeMode === "timed" ? styles.selected : ""}`}
                      >
                        <input
                          checked={timeMode === "timed"}
                          name="time-mode"
                          onChange={() => setTimeMode("timed")}
                          type="radio"
                          value="timed"
                        />
                        <span>
                          <strong>{t("reportRound.assign.useTimers")}</strong>
                          <span>{t("reportRound.assign.useTimersDescription")}</span>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                </section>
                <section className={styles.card} aria-labelledby="practice-availability-heading">
                  <div className={styles.sectionHeading}>
                    <span aria-hidden="true" className={styles.step}>
                      2
                    </span>
                    <h2 id="practice-availability-heading">{copy("Availability")}</h2>
                  </div>
                  <fieldset className={styles.fieldset} disabled={busy}>
                    <legend>{t("reportRound.assign.openPractice")}</legend>
                    <div className={styles.optionGrid}>
                      <label className={`${styles.option} ${!opensLater ? styles.selected : ""}`}>
                        <input
                          checked={!opensLater}
                          name="open-time"
                          onChange={() => setOpensLater(false)}
                          type="radio"
                          value="now"
                        />
                        <span>
                          <strong>{t("reportRound.assign.now")}</strong>
                          <span>{t("reportRound.assign.nowDescription")}</span>
                        </span>
                      </label>
                      <label className={`${styles.option} ${opensLater ? styles.selected : ""}`}>
                        <input
                          checked={opensLater}
                          name="open-time"
                          onChange={() => setOpensLater(true)}
                          type="radio"
                          value="later"
                        />
                        <span>
                          <strong>{t("reportRound.assign.scheduleLater")}</strong>
                          <span>{t("reportRound.assign.scheduleLaterDescription")}</span>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                  <div className={styles.dateGrid}>
                    {opensLater ? (
                      <label className="field" htmlFor="practice-opens-at">
                        <span>{t("reportRound.assign.openDate")}</span>
                        <input
                          aria-describedby="practice-timezone practice-schedule-error"
                          className="input"
                          disabled={busy}
                          id="practice-opens-at"
                          max={closesAt || maxClosesAt || undefined}
                          min={localDateTimeValue(new Date())}
                          onChange={(event) => setOpensAt(event.target.value)}
                          required
                          type="datetime-local"
                          value={opensAt}
                        />
                      </label>
                    ) : null}
                    <label className="field" htmlFor="practice-closes-at">
                      <span>{t("reportRound.assign.closeDate")}</span>
                      <input
                        aria-describedby="practice-timezone practice-retention practice-schedule-error"
                        aria-invalid={Boolean(scheduleError)}
                        className="input"
                        disabled={busy}
                        id="practice-closes-at"
                        max={maxClosesAt || undefined}
                        min={opensLater ? opensAt : localDateTimeValue(new Date())}
                        onChange={(event) => setClosesAt(event.target.value)}
                        required
                        type="datetime-local"
                        value={closesAt}
                      />
                    </label>
                  </div>
                  <div className={styles.dateHelp}>
                    <p id="practice-timezone">
                      {timezone ? copy("Times shown in {timezone}.", { timezone }) : null}
                    </p>
                    <p id="practice-retention">
                      {maxClosesAt
                        ? copy("Close by {date} on your plan.", { date: displayDate(maxClosesAt) })
                        : null}
                    </p>
                  </div>
                  <p
                    className={scheduleErrorText ? styles.fieldError : "sr-only"}
                    id="practice-schedule-error"
                    aria-live="polite"
                  >
                    {scheduleErrorText}
                  </p>
                </section>
                <section className={styles.card} aria-labelledby="practice-personal-heading">
                  <div className={styles.sectionHeading}>
                    <span aria-hidden="true" className={styles.step}>
                      3
                    </span>
                    <h2 id="practice-personal-heading">{copy("Personal links")}</h2>
                  </div>
                  <p className={styles.muted}>
                    {copy("One anonymous link is always included.")}{" "}
                    {copy("Share links yourself. No emails are sent.")}
                  </p>
                  <details className={styles.personalDisclosure}>
                    <summary>
                      {t("reportRound.assign.createPersonalLinks")}
                      <span className={styles.count}>
                        {formatNumber(locale, personalLabels.length)}
                      </span>
                    </summary>
                    <div className={styles.personalFields}>
                      <label className="field" htmlFor="practice-personal-labels">
                        <span>{t("reportRound.assign.oneLabelPerLine")}</span>
                        <textarea
                          aria-describedby="practice-personal-labels-help practice-personal-count practice-personal-error"
                          aria-invalid={Boolean(labelError)}
                          className="textarea"
                          disabled={busy || personalLabelLimit === 0}
                          id="practice-personal-labels"
                          lang=""
                          onChange={(event) => setPersonalLabelsText(event.target.value)}
                          placeholder={t("reportRound.assign.labelsPlaceholder")}
                          rows={5}
                          value={personalLabelsText}
                        />
                      </label>
                      <p className={styles.muted} id="practice-personal-labels-help">
                        {copy(
                          "Use a name or private label, up to 80 characters. Duplicate lines create one link.",
                        )}
                      </p>
                      <p
                        className={labelError ? styles.fieldError : styles.labelCount}
                        id="practice-personal-count"
                        aria-live="polite"
                      >
                        {copy("{count} of {maximum} personal links", {
                          count: formatNumber(locale, personalLabels.length),
                          maximum: formatNumber(locale, personalLabelLimit),
                        })}
                        {duplicateLabels > 0 ? (
                          <>
                            {" "}
                            ·{" "}
                            {copy("Duplicate labels combined: {count}.", {
                              count: formatNumber(locale, duplicateLabels),
                            })}
                          </>
                        ) : null}
                      </p>
                    </div>
                  </details>
                  <p
                    className={labelError ? styles.fieldError : "sr-only"}
                    id="practice-personal-error"
                    role={labelError ? "alert" : undefined}
                  >
                    {labelError}
                  </p>
                </section>
              </div>
              <aside className={styles.review} aria-labelledby="practice-review-heading">
                <div className={styles.reviewHeader}>
                  <p className="eyebrow">{t("reportRound.assign.title")}</p>
                  <h2 id="practice-review-heading">{copy("Review assignment")}</h2>
                </div>
                <p className={styles.reviewTitle} lang="">
                  {title || currentVersion?.content.title || quiz.title}
                </p>
                <dl className={styles.reviewFacts}>
                  <div>
                    <dt>{t("reportRound.assign.timing")}</dt>
                    <dd>
                      {timeMode === "flex"
                        ? t("reportRound.assign.flexible")
                        : t("reportRound.assign.timed")}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy("Opens")}</dt>
                    <dd>{opensLater ? displayDate(opensAt) : t("reportRound.assign.now")}</dd>
                  </div>
                  <div>
                    <dt>{copy("Closes")}</dt>
                    <dd>{displayDate(closesAt)}</dd>
                  </div>
                  <div>
                    <dt>{copy("Personal links")}</dt>
                    <dd>
                      {formatNumber(locale, personalLabels.length)}
                      <small>
                        {t("reportRound.assign.oneAttempt")} ·{" "}
                        {t("reportRound.assign.perPersonalLink")}
                      </small>
                    </dd>
                  </div>
                </dl>
                <p className={styles.muted}>{copy("One anonymous link is always included.")}</p>
                <div className={styles.formActions}>
                  <button
                    className="button"
                    disabled={busy || Boolean(labelError) || Boolean(scheduleError)}
                    type="submit"
                  >
                    {busy ? t("reportRound.assign.creating") : t("reportRound.assign.create")}
                  </button>
                  <Link className="button-quiet" href="/assignments">
                    {t("delivery.common.cancel")}
                  </Link>
                </div>
                <p className={styles.actionHelp}>
                  {copy("Share links yourself. No emails are sent.")}
                </p>
              </aside>
            </form>
          </div>
        )
      ) : null}
    </WorkspaceShell>
  );
}

function AssignPracticeContent() {
  const { id } = useParams<{ id: string }>();
  const { creator } = useWorkspace();
  // Actor and route changes discard source data, labels and private bearer receipts together.
  // Locale and an in-progress refresh of the same account preserve the current controller.
  const actorKey = JSON.stringify([id, creator?.userId, creator?.workspaceId, creator?.role]);
  return <AssignPracticeController id={id} key={actorKey} />;
}

export default function AssignPracticePage() {
  return (
    <WorkspaceProvider>
      <AssignPracticeContent />
    </WorkspaceProvider>
  );
}
