"use client";

import { packPracticeTitle } from "../../../../lib/i18n/creation-content";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import { PracticeLinkReceipt } from "../../../../components/practice/practice-link-receipt";
import { PackPracticePreview } from "../../../../components/practice/pack-practice-preview";
import styles from "../../../../components/practice/practice.module.css";
import setupStyles from "./assign.module.css";
import { useLocale } from "../../../../components/locale-provider";
import { packPracticeCopy } from "../../../../lib/i18n/pack-practice-copy";
import { packWorkspaceCopy } from "../../../../lib/i18n/pack-workspace-copy";
import {
  packPracticeSetupCopy,
  packPracticeSetupFeedback,
} from "../../../../lib/i18n/pack-practice-setup-copy";
import { formatDateTime, formatNumber } from "../../../../lib/i18n/format";
import { apiFetch, humanError } from "../../../../lib/api";
import { clientUuid } from "../../../../lib/uuid";
import {
  defaultPracticeWindow,
  localDateTimeValue,
  parsePersonalLabels,
  personalLabelsError,
  practicePersonalLinkLimit,
  type CreatedPractice,
  type PracticeTimeMode,
} from "../../../../lib/practice-assignment";
import {
  createPackPracticeCreation,
  packPracticeAccessSeed,
  packPracticeDates,
  packPracticeUnavailableReason,
  type PackPracticeCreationState,
  type PublishedPracticePack,
  type PackPracticeMode,
} from "../../../../lib/recovery-pack-practice";

function AssignPackPracticeContent({ packId }: { packId: string }) {
  const { locale } = useLocale();
  const copy = packPracticeSetupCopy(locale);
  const practiceCopy = packPracticeCopy(locale);
  const searchParams = useSearchParams();
  const expectedVersionId = searchParams.get("version");
  const [mode, setMode] = useState<PackPracticeMode>(
    searchParams.get("mode") === "full_sequence" ? "full_sequence" : "delayed_probe",
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const { productFeatures, entitlements, canEdit } = useWorkspace();
  const [version, setVersion] = useState<PublishedPracticePack | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceConflict, setSourceConflict] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [title, setTitle] = useState("");
  const generatedTitle = useRef("");
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [timeMode, setTimeMode] = useState<PracticeTimeMode>("flex");
  const [opensLater, setOpensLater] = useState(false);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [maxClosesAt, setMaxClosesAt] = useState("");
  const [minOpensAt, setMinOpensAt] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [error, setError] = useState("");
  const [creation, setCreation] = useState<PackPracticeCreationState>({
    busy: false,
    pending: false,
    created: null,
  });
  const alive = useRef(true);
  const windowInitialized = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const recovery = useRef<ReturnType<typeof createPackPracticeCreation> | null>(null);
  if (!recovery.current) {
    recovery.current = createPackPracticeCreation({
      execute: (body) =>
        apiFetch<CreatedPractice>(
          `/v1/recovery-packs/${encodeURIComponent(packId)}/practice-assignments`,
          { method: "POST", body },
        ),
      onState: (state) => {
        if (alive.current) setCreation(state);
      },
    });
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setVersion(null);
    setError("");
    void apiFetch<{ pack: { id: string; currentVersionId: string | null } }>(
      `/v1/recovery-packs/${encodeURIComponent(packId)}`,
      { signal: abort.signal },
    )
      .then(async ({ pack }) => {
        if (!pack.currentVersionId) return null;
        if (!refresh && expectedVersionId && pack.currentVersionId !== expectedVersionId) {
          throw new Error(
            "The published Pack changed. Refresh the published source and review the selected practice content before creating practice.",
          );
        }
        const response = await apiFetch<{ version: PublishedPracticePack }>(
          `/v1/recovery-packs/versions/${encodeURIComponent(pack.currentVersionId)}`,
          { signal: abort.signal },
        );
        if (response.version.id !== pack.currentVersionId || response.version.packId !== packId)
          throw new Error(
            "The published Pack source does not match. Refresh and review the source again.",
          );
        return response.version;
      })
      .then((published) => {
        if (abort.signal.aborted) return;
        setVersion(published);
        setSourceConflict(false);
        const initialTitle = published
          ? packPracticeTitle(
              localeRef.current,
              modeRef.current === "full_sequence",
              published.content.title,
            )
          : "";
        generatedTitle.current = initialTitle;
        setTitle(initialTitle);
      })
      .catch((caught) => {
        if (abort.signal.aborted) return;
        setSourceConflict(true);
        setError(humanError(caught));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [expectedVersionId, packId, refresh]);

  useEffect(() => {
    if (!entitlements || windowInitialized.current) return;
    const now = new Date();
    const defaults = defaultPracticeWindow(now, entitlements.reportRetentionDays);
    setClosesAt(defaults.closesAt);
    setMaxClosesAt(defaults.maxClosesAt);
    setMinOpensAt(localDateTimeValue(now));
    setOpensAt(localDateTimeValue(new Date(now.getTime() + 60 * 60_000)));
    windowInitialized.current = true;
  }, [entitlements]);

  const unavailable = packPracticeUnavailableReason({
    version,
    recoveryPacksEnabled: productFeatures?.recoveryPacks === true,
    practiceAssignmentsEnabled: productFeatures?.practiceAssignments === true,
    canEdit,
    followups: entitlements?.followups === true,
    mode,
  });
  const personalLabels = parsePersonalLabels(labelsText);
  const labelLimit = practicePersonalLinkLimit(entitlements);
  const labelError = personalLabelsError(personalLabels, labelLimit);
  const locked = creation.busy || creation.pending;
  const feedbackContext = { labelLimit, retentionDays: entitlements?.reportRetentionDays };
  const errorFeedback = packPracticeSetupFeedback(locale, error, feedbackContext);
  const labelFeedback = packPracticeSetupFeedback(locale, labelError ?? "", feedbackContext);
  const unavailableFeedback = packPracticeSetupFeedback(locale, unavailable ?? "");

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!version || unavailable || labelError || sourceConflict || locked || !maxClosesAt) return;
    setError("");
    try {
      const dates = packPracticeDates({ opensLater, opensAt, closesAt, maxClosesAt });
      await recovery.current!.run(() => ({
        mode,
        sourcePackVersionId: version.id,
        mutationId: clientUuid(),
        accessSeed: packPracticeAccessSeed(),
        ...(title.trim() ? { title: title.trim() } : {}),
        timeMode,
        ...dates,
        personalLabels,
      }));
    } catch (caught) {
      reportError(caught);
    }
  }

  function reportError(caught: unknown) {
    if (!alive.current) return;
    if ((caught as { status?: number }).status === 409) setSourceConflict(true);
    setError(humanError(caught));
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function retry() {
    setError("");
    try {
      await recovery.current!.retry();
    } catch (caught) {
      reportError(caught);
    }
  }

  return (
    <WorkspaceShell
      title={
        mode === "full_sequence"
          ? practiceCopy("Assign full-sequence practice")
          : practiceCopy("Assign delayed-probe practice")
      }
      eyebrow={packWorkspaceCopy(locale)("Recovery Packs")}
      translationLevel="full"
      requireBeta={false}
      description={
        mode === "full_sequence"
          ? copy("A frozen diagnostic, intervention cards, and linked recheck.")
          : copy("One standalone delayed probe from a frozen published Recovery Pack version.")
      }
      actions={
        <Link className="button-quiet" href="/recovery-packs">
          {copy("Back to Recovery Packs")}
        </Link>
      }
    >
      <div lang={locale} className={setupStyles.page}>
        {creation.created ? (
          <PracticeLinkReceipt created={creation.created} locale={locale} />
        ) : (
          <>
            <p className="notice">
              {mode === "full_sequence"
                ? copy(
                    "This assignment contains the Pack’s diagnostic, all intervention cards in order, and linked recheck. It does not include the optional delayed probe or a delayed recovery trail. Later source changes do not update this frozen sequence.",
                  )
                : copy(
                    "This assignment contains only the Pack’s delayed probe. It is not full Pack recovery or a delayed recovery trail, and does not include the diagnostic, intervention cards, or recheck.",
                  )}
            </p>
            <fieldset disabled={locked} className={`${styles.formCard} ${setupStyles.modeCard}`}>
              <legend>{copy("Practice mode")}</legend>
              <label className="field" htmlFor="pack-practice-mode">
                <span>{copy("Recovery Pack practice mode")}</span>
                <select
                  className="select"
                  id="pack-practice-mode"
                  value={mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as PackPracticeMode;
                    if (version && title === generatedTitle.current) {
                      const nextTitle = packPracticeTitle(
                        locale,
                        nextMode === "full_sequence",
                        version.content.title,
                      );
                      generatedTitle.current = nextTitle;
                      setTitle(nextTitle);
                    }
                    setMode(nextMode);
                  }}
                >
                  <option value="delayed_probe">{copy("Standalone delayed probe")}</option>
                  <option value="full_sequence">
                    {copy("Full sequence: diagnostic, cards, recheck")}
                  </option>
                </select>
              </label>
            </fieldset>
            {error ? (
              <p
                className="error"
                role="alert"
                ref={errorRef}
                tabIndex={-1}
                lang={errorFeedback.lang}
              >
                {errorFeedback.text}
              </p>
            ) : null}
            <p className={creation.pending ? "notice" : "sr-only"} aria-live="polite" role="status">
              {creation.busy
                ? copy("Creating or recovering the same practice assignment…")
                : creation.pending
                  ? copy(
                      "Creation was not acknowledged. Keep this page open and retry the same private request to recover its result. Settings stay locked; no new assignment is created by changing settings.",
                    )
                  : ""}
            </p>
            {creation.pending ? (
              <button
                className="button"
                disabled={creation.busy}
                onClick={() => void retry()}
                type="button"
              >
                {copy("Retry assignment acknowledgement")}
              </button>
            ) : null}
            {loading ? (
              <p role="status">
                {mode === "full_sequence"
                  ? copy("Loading the frozen published sequence…")
                  : copy("Loading the published delayed probe…")}
              </p>
            ) : null}
            {!loading && unavailable ? (
              <p className="notice" lang={unavailableFeedback.lang}>
                {unavailableFeedback.text}
              </p>
            ) : null}
            {sourceConflict && !locked ? (
              <button
                className="button-quiet"
                onClick={() => setRefresh((value) => value + 1)}
                type="button"
              >
                {copy("Refresh published Pack")}
              </button>
            ) : null}
            {!loading && version ? (
              <div className={styles.stack}>
                <section
                  className={styles.sourceCard}
                  aria-labelledby="pack-practice-source-heading"
                >
                  <p className="eyebrow">
                    {copy("Frozen published Recovery Pack · version {version}", {
                      version: formatNumber(locale, version.version),
                    })}
                  </p>
                  <h2 id="pack-practice-source-heading" lang="">
                    {version.content.title}
                  </h2>
                  <p>
                    {copy("Published {date}.", {
                      date: formatDateTime(locale, version.publishedAt),
                    })}
                  </p>
                  <PackPracticePreview version={version} mode={mode} locale={locale} />
                </section>
                {!unavailable && !sourceConflict ? (
                  <form className={styles.formCard} onSubmit={create}>
                    <fieldset disabled={locked} className={setupStyles.settingsFields}>
                      <legend>
                        <h2>{copy("Practice settings")}</h2>
                      </legend>
                      <div className={styles.fields}>
                        <label
                          className={`field ${styles.fullField}`}
                          htmlFor="pack-practice-title"
                        >
                          <span>{copy("Practice title")}</span>
                          <input
                            className="input"
                            id="pack-practice-title"
                            lang=""
                            maxLength={160}
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                          />
                        </label>
                        <fieldset className={`${styles.fullField} ${setupStyles.settingsFields}`}>
                          <legend className="field-label">{copy("Participant pacing")}</legend>
                          <div className={styles.optionGrid}>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-time"
                                checked={timeMode === "flex"}
                                onChange={() => setTimeMode("flex")}
                                type="radio"
                              />
                              <span>
                                <strong>{copy("Time-flex")}</strong>
                                {copy("No countdown. Participants respond at their own pace.")}
                              </span>
                            </label>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-time"
                                checked={timeMode === "timed"}
                                onChange={() => setTimeMode("timed")}
                                type="radio"
                              />
                              <span>
                                <strong>{copy("Use the published timer")}</strong>
                                {mode === "full_sequence"
                                  ? copy(
                                      "The server enforces each checkpoint’s published time limit when it opens. Intervention cards have no countdown.",
                                    )
                                  : copy(
                                      "The server enforces the delayed probe’s published time limit.",
                                    )}
                              </span>
                            </label>
                          </div>
                        </fieldset>
                        <fieldset className={`${styles.fullField} ${setupStyles.settingsFields}`}>
                          <legend className="field-label">{copy("Open practice")}</legend>
                          <div className={styles.optionGrid}>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-open"
                                checked={!opensLater}
                                onChange={() => setOpensLater(false)}
                                type="radio"
                              />
                              <span>
                                <strong>{copy("Now")}</strong>
                                {copy("Participants can start once creation is acknowledged.")}
                              </span>
                            </label>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-open"
                                checked={opensLater}
                                onChange={() => setOpensLater(true)}
                                type="radio"
                              />
                              <span>
                                <strong>{copy("Schedule later")}</strong>
                                {copy("Choose a future opening time.")}
                              </span>
                            </label>
                          </div>
                        </fieldset>
                        {opensLater ? (
                          <label className="field" htmlFor="pack-practice-opens">
                            <span>{copy("Open date and time")}</span>
                            <input
                              className="input"
                              id="pack-practice-opens"
                              aria-describedby="pack-practice-window-help"
                              type="datetime-local"
                              min={minOpensAt || undefined}
                              max={maxClosesAt || undefined}
                              required
                              value={opensAt}
                              onChange={(event) => setOpensAt(event.target.value)}
                            />
                          </label>
                        ) : null}
                        <label className="field" htmlFor="pack-practice-closes">
                          <span>{copy("Close date and time")}</span>
                          <input
                            className="input"
                            id="pack-practice-closes"
                            aria-describedby="pack-practice-window-help"
                            type="datetime-local"
                            min={(opensLater ? opensAt : minOpensAt) || undefined}
                            max={maxClosesAt || undefined}
                            required
                            value={closesAt}
                            onChange={(event) => setClosesAt(event.target.value)}
                          />
                        </label>
                      </div>
                      {maxClosesAt && entitlements ? (
                        <p className={styles.muted} id="pack-practice-window-help">
                          {copy(
                            "Practice must close by {date}, within the {days}-day retention window. Times use your device’s time zone.",
                            {
                              date: formatDateTime(locale, maxClosesAt),
                              days: formatNumber(locale, entitlements.reportRetentionDays),
                            },
                          )}
                        </p>
                      ) : null}
                      <details className={styles.disclosure}>
                        <summary>{copy("Create one-attempt personal links")}</summary>
                        <label className="field" htmlFor="pack-practice-labels">
                          <span>{copy("One personal link label per line")}</span>
                          <textarea
                            className="textarea"
                            id="pack-practice-labels"
                            lang=""
                            rows={5}
                            aria-describedby="pack-practice-labels-help"
                            aria-invalid={Boolean(labelError)}
                            value={labelsText}
                            onChange={(event) => setLabelsText(event.target.value)}
                          />
                        </label>
                        <p className={styles.muted} id="pack-practice-labels-help">
                          {copy(
                            "Use non-sensitive labels. {count} of {limit} personal links. A generic anonymous link is also created.",
                            {
                              count: formatNumber(locale, personalLabels.length),
                              limit: formatNumber(locale, labelLimit),
                            },
                          )}
                        </p>
                        {labelError ? (
                          <p className="error" role="alert" lang={labelFeedback.lang}>
                            {labelFeedback.text}
                          </p>
                        ) : null}
                      </details>
                      <div className={styles.formActions}>
                        <button
                          className="button"
                          disabled={Boolean(labelError) || !maxClosesAt}
                          type="submit"
                        >
                          {creation.busy
                            ? copy("Creating…")
                            : mode === "full_sequence"
                              ? copy("Create full-sequence practice")
                              : copy("Create delayed-probe practice")}
                        </button>
                      </div>
                    </fieldset>
                  </form>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

export default function AssignPackPracticePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <WorkspaceProvider>
      <AssignPackPracticeContent key={id} packId={id} />
    </WorkspaceProvider>
  );
}
