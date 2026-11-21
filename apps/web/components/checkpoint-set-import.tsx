"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  CheckpointSetImportCreationContextSchema,
  CheckpointSetImportUnavailableReasonSchema,
  ImportValidationReportSchema,
  QuizDraftSchema,
  type CheckpointSetImportUnavailableReason,
  type ImportValidationReport,
  type QuestionDraft,
} from "@openround/contracts";
import { API_URL, AUTH_CHANGE_EVENT } from "../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../lib/idle-session";
import { formatNumber } from "../lib/i18n/format";
import { importPreviewCopy } from "../lib/i18n/import-preview-copy";
import type { MessageKey } from "../lib/i18n/catalog";
import {
  createStructuredImportSession,
  initialStructuredImportState,
  StructuredImportRequestError,
  type StructuredImportFormat,
  type StructuredImportPreview,
  type StructuredImportState,
} from "../lib/structured-import-session";
import { useLocale } from "./locale-provider";
import { recordAuthoringEvent, recordCreationEvent } from "./workspace/product-events";
import styles from "./checkpoint-set-import.module.css";

interface ImportAuthority {
  actorId: string;
  workspaceId: string;
  role: string;
  canEdit: boolean;
  featureKey: string;
}

interface CheckpointSetImportProps {
  enabled: boolean;
  unavailableReason?: CheckpointSetImportUnavailableReason | null;
  authority: ImportAuthority;
  onImported: (quiz: { id: string; title: string }) => Promise<void>;
  plain?: boolean;
  trackCreation?: boolean;
  terminology?: "legacy" | "round";
}

const formatAccept: Record<StructuredImportFormat, string> = {
  openround_json: ".json,application/json",
  csv: ".csv,text/csv",
  bulk: ".txt,text/plain",
  qti3: ".zip,application/zip,application/x-zip-compressed",
};
const questionTypeLabels: Record<QuestionDraft["type"], MessageKey> = {
  single_select: "questionType.single_select.label",
  true_false: "questionType.true_false.label",
  multi_select: "questionType.multi_select.label",
  numeric: "questionType.numeric.label",
  rating: "questionType.rating.label",
  poll: "questionType.poll.label",
  ranking: "questionType.ranking.label",
  open_text: "questionType.open_text.label",
  word_cloud: "questionType.word_cloud.label",
};

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("File encoding failed"));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function importRequest(
  path: string,
  body: string,
  signal: AbortSignal,
  creationContext: StructuredImportPreview["creationContext"],
) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body,
    signal,
  });
  const result = (await response.json().catch(() => null)) as {
    error?: {
      message?: string;
      code?: string;
      details?: { unavailableReason?: unknown; creationContext?: unknown };
    };
    validation?: ImportValidationReport;
    [key: string]: unknown;
  } | null;
  if (!response.ok) {
    if (response.status === 401 && result?.error?.code === "SESSION_EXPIRED")
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const validation = ImportValidationReportSchema.safeParse(result?.validation);
    const details = result?.error?.details;
    const context = CheckpointSetImportCreationContextSchema.safeParse(details?.creationContext);
    const reason =
      context.success &&
      context.data.actorId === creationContext.actorId &&
      context.data.workspaceId === creationContext.workspaceId
        ? CheckpointSetImportUnavailableReasonSchema.safeParse(details?.unavailableReason).data
        : undefined;
    throw new StructuredImportRequestError(
      response.status,
      typeof result?.error?.message === "string" ? result.error.message : "",
      validation.success ? validation.data : undefined,
      result?.error?.code,
      reason,
    );
  }
  if (!result) throw new Error("Invalid import response");
  return result;
}

export function CheckpointSetImport({
  enabled,
  unavailableReason,
  authority,
  onImported,
  plain = false,
  trackCreation = false,
  terminology = "legacy",
}: CheckpointSetImportProps) {
  const { locale, t } = useLocale();
  const copy = importPreviewCopy(locale);
  const id = useId();
  const scope = JSON.stringify([
    authority.actorId,
    authority.workspaceId,
    authority.role,
    authority.canEdit,
    authority.featureKey,
    enabled,
  ]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const callbacks = useRef({ onImported, trackCreation });
  callbacks.current = { onImported, trackCreation };
  const sessionRef = useRef<ReturnType<typeof createStructuredImportSession> | null>(null);
  const [stored, setStored] = useState({ scope, state: initialStructuredImportState() });
  const [invalidAuthority, setInvalidAuthority] = useState<"" | "auth" | "workspace">("");
  const invalidRef = useRef(false);
  const allowed = Boolean(
    enabled && authority.canEdit && authority.actorId && authority.workspaceId && !invalidAuthority,
  );
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const state =
    stored.scope === scope && !invalidAuthority ? stored.state : initialStructuredImportState();

  useEffect(() => {
    const actor = { actorId: authority.actorId, workspaceId: authority.workspaceId };
    const session = createStructuredImportSession({
      actor,
      storage: {
        getItem: (key) => window.sessionStorage.getItem(key),
        setItem: (key, value) => window.sessionStorage.setItem(key, value),
        removeItem: (key) => window.sessionStorage.removeItem(key),
      },
      allowed: () => scopeRef.current === scope && allowedRef.current && !invalidRef.current,
      preview: async (body, signal) => {
        const result = await importRequest("/v1/quizzes/import/preview", body, signal, actor);
        const context = result.creationContext as StructuredImportPreview["creationContext"];
        if (
          typeof result.previewFingerprint !== "string" ||
          typeof result.sourceDigest !== "string" ||
          !context ||
          typeof context.actorId !== "string" ||
          typeof context.workspaceId !== "string"
        )
          throw new Error("Invalid import preview");
        return {
          draft: result.draft === null ? null : QuizDraftSchema.parse(result.draft),
          validation: ImportValidationReportSchema.parse(result.validation),
          previewFingerprint: result.previewFingerprint,
          sourceDigest: result.sourceDigest,
          creationContext: context,
        };
      },
      confirmationBody: (sourceBody, preview, idempotencyKey) =>
        JSON.stringify({
          ...JSON.parse(sourceBody),
          previewFingerprint: preview.previewFingerprint,
          creationContext: preview.creationContext,
          idempotencyKey,
        }),
      confirm: async (body, signal) => {
        const result = await importRequest("/v1/quizzes/import/confirm", body, signal, actor);
        const quiz = result.quiz as { id?: unknown; title?: unknown } | undefined;
        if (typeof quiz?.id !== "string" || typeof quiz.title !== "string")
          throw new Error("Invalid import confirmation");
        return { quiz: { id: quiz.id, title: quiz.title } };
      },
      onState: (next) => setStored({ scope, state: next }),
      onCreated: (quiz) => callbacks.current.onImported(quiz),
      onCreationStarted: () => {
        if (callbacks.current.trackCreation)
          recordCreationEvent("creation_started", "import", "round");
      },
      onCreationCompleted: (count) => {
        if (callbacks.current.trackCreation) {
          recordCreationEvent("creation_completed", "import", "round");
          if (count > 0) recordAuthoringEvent("first_block_created", "round");
        }
      },
    });
    sessionRef.current = session;
    setStored({ scope, state: initialStructuredImportState() });
    session.restore();
    const revoke = (reason: "auth" | "workspace") => {
      invalidRef.current = true;
      allowedRef.current = false;
      session.dispose();
      setInvalidAuthority(reason);
      setStored({ scope, state: initialStructuredImportState() });
    };
    const authChanged = () => revoke("auth");
    const workspaceChanged = () => revoke("workspace");
    const authEvents = [AUTH_CHANGE_EVENT, SESSION_LOGOUT_EVENT, SESSION_EXPIRED_EVENT];
    authEvents.forEach((event) => window.addEventListener(event, authChanged));
    window.addEventListener("polling-pops:workspace-updated", workspaceChanged);
    return () => {
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
      authEvents.forEach((event) => window.removeEventListener(event, authChanged));
      window.removeEventListener("polling-pops:workspace-updated", workspaceChanged);
    };
  }, [scope, authority.actorId, authority.workspaceId]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const format = state.format;
    void sessionRef.current?.readFile(file, () =>
      format === "qti3" ? fileAsBase64(file) : file.text(),
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void sessionRef.current?.preview();
  }
  const locked = ["creating", "retry", "created", "opening"].includes(state.phase);
  const controlsDisabled = !allowed || locked;
  const number = (value: number) => formatNumber(locale, value);
  const fill = (text: string, values: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
  const feedback: Record<StructuredImportState["feedback"], string> = {
    "": "",
    fileRead: t("reportRound.import.fileReadError"),
    fileTooLarge: t("reportRound.import.fileTooLarge", {
      limit: state.format === "qti3" ? "6" : "2",
    }),
    preview: copy.previewError,
    invalid: copy.previewInvalid,
    creation: copy.creationError,
    expired: copy.previewExpired,
    unavailable: t("reportRound.import.unavailable"),
    plan_limit: t("reportRound.import.planLimit"),
    operator_policy: t("reportRound.import.operatorPolicy"),
    opening: copy.openingError,
    recovery: copy.recoveryError,
  };
  const confirmationActions = state.preview ? (
    <>
      <button
        className="button"
        disabled={!allowed || !state.recoveryReady || state.phase === "creating"}
        type="button"
        onClick={() => void sessionRef.current?.create()}
      >
        {state.phase === "creating"
          ? copy.creating
          : state.phase === "retry" || state.reusesIntent
            ? copy.retryCreation
            : copy.create}
      </button>
      {state.knownTargetUnavailable ? (
        <button
          className="button-quiet"
          disabled={!allowed || state.phase === "creating"}
          type="button"
          onClick={() => sessionRef.current?.startAnother()}
        >
          {copy.importAnother}
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <section
      className={plain ? "portability-panel" : "panel portability-panel"}
      aria-labelledby={`${id}-heading`}
      lang={locale}
    >
      <div className="portability-heading">
        <div>
          <p className="eyebrow">{t("reportRound.import.eyebrow")}</p>
          <h2 id={`${id}-heading`}>
            {terminology === "round"
              ? t("reportRound.import.roundTitle")
              : t("reportRound.import.legacyTitle")}
          </h2>
        </div>
        <span className="status-pill">{t("reportRound.import.draftOnly")}</span>
      </div>
      <p className="muted">{copy.description}</p>
      {invalidAuthority ? (
        <p className="error" role="alert">
          {invalidAuthority === "auth" ? copy.authChanged : copy.authorityUnavailable}
        </p>
      ) : !enabled ? (
        <p className="notice" role="status">
          {feedback[unavailableReason ?? "unavailable"]}
        </p>
      ) : !allowed ? (
        <p className="notice" role="status">
          {copy.authorityUnavailable}
        </p>
      ) : (
        <>
          {!state.recoveryReady ? (
            <div className="notice" role="status">
              <p>{state.recoveryFailed ? copy.recoveryError : copy.recovering}</p>
              {state.recoveryFailed ? (
                <button
                  className="button-quiet small-button"
                  type="button"
                  onClick={() => sessionRef.current?.restore()}
                >
                  {copy.retryRecovery}
                </button>
              ) : null}
            </div>
          ) : state.recoveryCount > 0 && !state.created ? (
            <p className="notice">{copy.pendingRecovery}</p>
          ) : null}
          <form onSubmit={submit}>
            <div className="portability-fields">
              <label className="field">
                <span>{t("reportRound.import.format")}</span>
                <select
                  className="select"
                  disabled={controlsDisabled}
                  onChange={(event) =>
                    sessionRef.current?.updateInput({
                      format: event.target.value as StructuredImportFormat,
                    })
                  }
                  value={state.format}
                >
                  <option value="openround_json">Polling Pops JSON</option>
                  <option value="csv">Polling Pops CSV</option>
                  <option value="bulk">{t("reportRound.import.bulkPaste")}</option>
                  <option value="qti3">{t("reportRound.import.qtiPackage")}</option>
                </select>
              </label>
              <label className="field">
                <span>
                  {terminology === "round"
                    ? t("reportRound.import.newRoundTitle")
                    : t("reportRound.import.newTitle")}
                </span>
                <input
                  className="input"
                  disabled={controlsDisabled}
                  lang=""
                  maxLength={160}
                  onChange={(event) =>
                    sessionRef.current?.updateInput({ title: event.target.value })
                  }
                  placeholder={t("reportRound.import.keepSourceTitle")}
                  value={state.title}
                />
              </label>
              <label className="field">
                <span>
                  {state.format === "qti3"
                    ? t("reportRound.import.chooseQti")
                    : t("reportRound.import.chooseTextFile")}
                </span>
                <input
                  accept={formatAccept[state.format]}
                  disabled={controlsDisabled}
                  onChange={chooseFile}
                  type="file"
                />
              </label>
            </div>
            {state.phase === "reading" ? <p role="status">{copy.readingFile}</p> : null}
            {state.fileName ? (
              <p className="muted" lang="">
                {state.fileName}
              </p>
            ) : null}
            {state.format === "qti3" ? (
              <p className="notice" role="status">
                {state.data ? t("reportRound.import.qtiReady") : t("reportRound.import.selectZip")}
              </p>
            ) : (
              <label className="field">
                <span>{t("reportRound.import.content")}</span>
                <textarea
                  aria-describedby={`${id}-format-help`}
                  className="textarea portability-source"
                  disabled={controlsDisabled}
                  lang=""
                  maxLength={2_000_000}
                  onChange={(event) =>
                    sessionRef.current?.updateInput({ data: event.target.value })
                  }
                  placeholder={
                    state.format === "bulk"
                      ? t("reportRound.import.bulkExample")
                      : t("reportRound.import.pasteContent", {
                          format: state.format === "csv" ? "CSV" : "JSON",
                        })
                  }
                  required
                  value={state.data}
                />
              </label>
            )}
            <p className="muted" id={`${id}-format-help`}>
              {state.format === "openround_json"
                ? terminology === "round"
                  ? t("reportRound.import.jsonHelpRound")
                  : t("reportRound.import.jsonHelpLegacy")
                : state.format === "csv"
                  ? t("reportRound.import.csvHelp")
                  : state.format === "bulk"
                    ? terminology === "round"
                      ? t("reportRound.import.bulkHelpRound")
                      : t("reportRound.import.bulkHelpLegacy")
                    : t("reportRound.import.qtiHelp")}
            </p>
            {!locked ? (
              <button
                className="button"
                disabled={
                  controlsDisabled ||
                  state.phase === "reading" ||
                  state.phase === "previewing" ||
                  !state.data.trim()
                }
                type="submit"
              >
                {state.phase === "previewing" ? copy.previewing : copy.preview}
              </button>
            ) : null}
          </form>
          {state.feedback && state.feedback !== "recovery" ? (
            <div className="error" role="alert">
              <p>{feedback[state.feedback]}</p>
              {state.diagnostic ? <p lang="en-CA">{state.diagnostic}</p> : null}
            </div>
          ) : null}
          {state.validation &&
          (state.validation.errors.length > 0 || state.validation.warnings.length > 0) ? (
            <div className="import-validation" aria-live="polite">
              <h3>{t("reportRound.import.validationDetails")}</h3>
              <ul>
                {[...state.validation.errors, ...state.validation.warnings].map((item, index) => (
                  <li key={`${item.code}-${item.row ?? "set"}-${item.field ?? "content"}-${index}`}>
                    <strong>
                      {item.severity === "error"
                        ? t("reportRound.import.error")
                        : t("reportRound.import.warning")}
                      :
                    </strong>{" "}
                    {item.row ? `${t("reportRound.import.row", { row: number(item.row) })}, ` : ""}
                    {item.field ? <span lang="en-CA">{item.field}: </span> : null}
                    <span lang="en-CA">{item.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.preview?.draft ? (
            <section
              className={styles.preview}
              aria-labelledby={`${id}-preview-title`}
              data-import-preview
            >
              <h3 id={`${id}-preview-title`}>{copy.previewTitle}</h3>
              {state.phase === "ready" && !state.reusesIntent ? (
                <p className="notice" role="status">
                  {copy.previewOnly}
                </p>
              ) : state.phase === "creating" ? (
                <p role="status">{copy.creating}</p>
              ) : null}
              <h4 className={styles.sourceText} lang="">
                {state.preview.draft.title}
              </h4>
              {state.preview.draft.description ? (
                <p className={styles.sourceText} lang="">
                  {state.preview.draft.description}
                </p>
              ) : null}
              <p>
                {fill(copy.questionCount, { count: number(state.preview.draft.questions.length) })}{" "}
                ·{" "}
                {fill(copy.warningCount, {
                  count: number(state.preview.validation.warnings.length),
                })}
              </p>
              <ol className={styles.questions}>
                {state.preview.draft.questions.map((question, index) => (
                  <li
                    className={styles.question}
                    key={question.id}
                    data-import-question-index={index}
                  >
                    <p className="eyebrow">
                      {number(index + 1)} · {t(questionTypeLabels[question.type])}
                    </p>
                    <h4 className={styles.sourceText} lang="">
                      {question.prompt}
                    </h4>
                    <p>
                      {fill(copy.points, { count: number(question.basePoints) })} ·{" "}
                      {fill(copy.timeLimit, { seconds: number(question.timeLimitSeconds) })}
                    </p>
                    {["poll", "rating", "ranking", "open_text", "word_cloud"].includes(
                      question.type,
                    ) ? (
                      <p>{copy.noCorrectAnswer}</p>
                    ) : null}
                    {"choices" in question ? (
                      <>
                        <h5>{copy.options}</h5>
                        <ol className={styles.choices}>
                          {question.choices.map((choice) => (
                            <li key={choice.id}>
                              <span className={styles.sourceText} lang="">
                                {choice.label}
                              </span>
                              {choice.isCorrect ? (
                                <>
                                  {" "}
                                  — <strong>{copy.correctAnswer}</strong>
                                </>
                              ) : null}
                              {choice.feedback ? (
                                <p className={styles.sourceText} lang="">
                                  {choice.feedback}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </>
                    ) : null}
                    {question.type === "numeric" ? (
                      <>
                        <p>
                          {copy.correctAnswer}:{" "}
                          <span lang="">
                            {question.correctValue}
                            {question.unit ? ` ${question.unit}` : ""}
                          </span>
                        </p>
                        <p>{fill(copy.numericTolerance, { value: question.tolerance })}</p>
                      </>
                    ) : null}
                    {question.type === "rating" ? (
                      <>
                        <p>
                          {fill(copy.ratingScale, {
                            min: number(question.min),
                            max: number(question.max),
                          })}
                        </p>
                        <p lang="">
                          {question.minLabel} · {question.maxLabel}
                        </p>
                      </>
                    ) : null}
                    {question.type === "poll" && question.maxSelections !== undefined ? (
                      <p>{fill(copy.selectionLimit, { count: number(question.maxSelections) })}</p>
                    ) : null}
                    {question.type === "ranking" && question.rankCount !== undefined ? (
                      <p>{fill(copy.selectionLimit, { count: number(question.rankCount) })}</p>
                    ) : null}
                    <h5>{copy.explanation}</h5>
                    {question.explanation ? (
                      <p className={styles.sourceText} lang="">
                        {question.explanation}
                      </p>
                    ) : (
                      <p className="muted">{copy.noExplanation}</p>
                    )}
                  </li>
                ))}
              </ol>
              {confirmationActions}
            </section>
          ) : null}
          {state.preview && !state.preview.draft && state.reusesIntent ? (
            <div className={styles.preview} data-import-recovery>
              {confirmationActions}
            </div>
          ) : null}
          {state.created ? (
            <div className={styles.preview}>
              <p className="success" role="status">
                {copy.created}
              </p>
              <h3 className={styles.sourceText} lang="">
                {state.created.title}
              </h3>
              <button
                className="button"
                disabled={!allowed || state.phase === "opening"}
                type="button"
                onClick={() => void sessionRef.current?.openCreated()}
              >
                {copy.openCreated}
              </button>
              <button
                className="button-quiet"
                disabled={!allowed || state.phase === "opening"}
                type="button"
                onClick={() => sessionRef.current?.startAnother()}
              >
                {copy.importAnother}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
