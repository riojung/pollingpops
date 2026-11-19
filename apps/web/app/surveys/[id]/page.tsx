"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SurveyContentSchema,
  SurveyDraftSchema,
  surveyPageViews,
  type SurveyDraft,
} from "@openround/contracts/surveys";
import {
  SurveyReadableDraftSchema,
  type SurveyBranchingDraft,
} from "@openround/contracts/survey-branching";
import { SurveyPagedReader } from "../../../components/survey-paged-reader";
import { SurveyBranchingPreview } from "../../../components/survey-branching-preview";
import { SurveyPageAuthoring } from "../../../components/survey-page-authoring";
import { surveyPageAuthoringCopy } from "../../../lib/i18n/survey-page-authoring-copy";
import { convertSurveyToPages } from "../../../lib/survey-page-authoring";
import {
  newSurveyQuestion,
  SurveyQuestionActions,
  SurveyQuestionEditor,
  SurveyResponseControl,
} from "../../../components/survey-controls";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import {
  GuardedLink as Link,
  NavigationGuardProvider,
  useNavigationBlocker,
} from "../../../components/navigation-guard";
import { useLocale } from "../../../components/locale-provider";
import { RoomPasswordOption } from "../../../components/room-password";
import { canProtectRoom, roomPasswordFields, validRoomPassword } from "../../../lib/room-password";
import { apiFetch, humanError, ApiClientError, AUTH_CHANGE_EVENT } from "../../../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../../../lib/idle-session";
import {
  surveyMutationKey,
  surveyReaderHeaders,
  type SurveyRecordView as SurveyRecord,
} from "../../../lib/survey-client";
import {
  SurveyAutosave,
  SurveySavePausedError,
  type SurveyAutosaveSnapshot,
} from "../../../lib/survey-autosave";
import { isRetryableSaveError } from "../../../lib/retry";
import styles from "../../../components/workspace/workspace-content.module.css";

type Action = "publish" | "duplicate" | "archive" | "share";
function ReadOnlySurveyPages({ draft, paused }: { draft: SurveyDraft; paused: boolean }) {
  const { locale } = useLocale();
  const copy = surveyPageAuthoringCopy(locale);
  const [pageIndex, setPageIndex] = useState(0);
  return (
    <section className={styles.panel} data-survey-pages-readonly lang={locale}>
      <h2>{paused ? copy.pausedTitle : copy.readonlyTitle}</h2>
      <p className="notice">{paused ? copy.pausedNotice : copy.readonlyNotice}</p>
      <p lang="">{draft.description}</p>
      <SurveyPagedReader
        content={draft}
        pageIndex={pageIndex}
        locale={locale}
        preview
        onBack={() => setPageIndex((index) => Math.max(0, index - 1))}
        onNext={() =>
          setPageIndex((index) => Math.min(surveyPageViews(draft).length - 1, index + 1))
        }
      />
    </section>
  );
}
export function SurveyEditor({ id, scope }: { id: string; scope: string }) {
  const router = useRouter();
  const {
    canEdit,
    productFeatures,
    entitlements,
    creator,
    loading,
    error: workspaceError,
  } = useWorkspace();
  const { locale, t } = useLocale();
  const copy = surveyPageAuthoringCopy(locale);
  const [authRevoked, setAuthRevoked] = useState(false);
  // Missing account data during a failed refresh pauses authority, not the editor lifetime.
  // WorkspaceShell masks the retained local draft until a fresh account result is available.
  const context = creator ? JSON.stringify([creator.userId, creator.workspaceId, id]) : scope;
  const current = useRef({
    scope,
    context,
    valid: true,
    canEdit: false,
    pages: false,
    pageSavePaused: false,
  });
  current.current = {
    scope,
    context,
    valid: !authRevoked && scope === context,
    canEdit:
      Boolean(creator) &&
      canEdit &&
      !loading &&
      !workspaceError &&
      !authRevoked &&
      scope === context,
    pages: Boolean(productFeatures?.surveyPages && productFeatures.surveys),
    pageSavePaused: false,
  };
  const [protectRoom, setProtectRoom] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const [passwordError, setPasswordError] = useState<
    "live.protection.validation" | "live.protection.upgrade" | null
  >(null);
  const passwordAvailable = canProtectRoom(entitlements);
  const [model, setModel] = useState<SurveyAutosaveSnapshot | null>(null);
  const [retainedBranching, setRetainedBranching] = useState<SurveyBranchingDraft | null>(null);
  const autosave = useRef<SurveyAutosave | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [days, setDays] = useState(7);
  const working = useRef(false);
  const pending = useRef<{ path: string; body: string; method: string; action: Action } | null>(
    null,
  );
  // Read the controller at navigation time, including edits in the debounce window
  // and action intents whose state has not reached the next React render yet.
  useNavigationBlocker(
    useCallback(() => Boolean(autosave.current?.snapshot().unsettled || pending.current), []),
  );
  const record = model?.record;
  const draft = model?.draft;
  const dirty = model?.dirty ?? false;
  const savePaused = Boolean(model && ["retry", "error", "conflict"].includes(model.phase));
  current.current.pageSavePaused = model?.pauseReason === "survey-pages";
  const canAuthorPages =
    current.current.canEdit && current.current.pages && !current.current.pageSavePaused;
  const editingAllowed = current.current.canEdit && (draft?.schemaVersion !== 3 || canAuthorPages);
  function allowed(
    schemaVersion: number | undefined = autosave.current?.snapshot().draft.schemaVersion,
    retryPausedSave = false,
  ) {
    const latest = current.current;
    return (
      latest.valid &&
      latest.scope === scope &&
      latest.context === context &&
      latest.canEdit &&
      schemaVersion !== 4 &&
      (schemaVersion !== 3 || (latest.pages && (retryPausedSave || !latest.pageSavePaused)))
    );
  }
  useEffect(() => {
    autosave.current?.setEnabled(editingAllowed);
  }, [editingAllowed, model?.record.id]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const revoke = () => {
      current.current.valid = false;
      current.current.canEdit = false;
      autosave.current?.dispose();
      autosave.current = null;
      setAuthRevoked(true);
      setModel(null);
      setRetainedBranching(null);
      pending.current = null;
    };
    const events = [AUTH_CHANGE_EVENT, SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT];
    events.forEach((name) => window.addEventListener(name, revoke));
    return () => events.forEach((name) => window.removeEventListener(name, revoke));
  }, []);
  useEffect(() => {
    let active = true;
    autosave.current?.dispose();
    autosave.current = null;
    setModel(null);
    setRetainedBranching(null);
    setError("");
    void apiFetch<{ survey: SurveyRecord }>(`/v1/surveys/${id}`, { headers: surveyReaderHeaders() })
      .then((response) => {
        if (
          !active ||
          !current.current.valid ||
          current.current.scope !== scope ||
          current.current.context !== context
        )
          return;
        const readable = SurveyReadableDraftSchema.parse(response.survey.draft);
        if (readable.schemaVersion === 4) {
          setRetainedBranching(readable);
          return;
        }
        SurveyDraftSchema.parse(response.survey.draft);
        const controller = new SurveyAutosave(response.survey, {
          enabled: allowed(response.survey.draft.schemaVersion),
          changed: (snapshot) => {
            if (
              active &&
              current.current.valid &&
              current.current.scope === scope &&
              current.current.context === context
            )
              setModel(snapshot);
          },
          save: async (body) => {
            if (
              !active ||
              !allowed((JSON.parse(body) as { draft: SurveyDraft }).draft.schemaVersion, true)
            )
              throw new SurveySavePausedError();
            return (
              await apiFetch<{ survey: SurveyRecord }>(`/v1/surveys/${id}`, { method: "PUT", body })
            ).survey;
          },
        });
        autosave.current = controller;
        setModel(controller.snapshot());
      })
      .catch((caught) => {
        if (active) setError(humanError(caught));
      });
    return () => {
      active = false;
      autosave.current?.dispose();
      autosave.current = null;
    };
  }, [id, scope, context, loadAttempt]);
  function setDraft(value: SurveyDraft) {
    if (!allowed(value.schemaVersion)) return;
    setNotice("");
    if (!pending.current) setError("");
    autosave.current?.edit(value);
  }
  function reload() {
    if (
      model?.unsettled &&
      !window.confirm(
        "Reload the latest version and discard your local edits? Download a local draft first if you want to keep them.",
      )
    )
      return;
    setNotice("");
    setLoadAttempt((attempt) => attempt + 1);
  }
  function downloadLocalDraft() {
    const local = autosave.current?.snapshot().draft;
    if (!local) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(local, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `polling-pops-survey-${id}-local-draft.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function saveNow() {
    const controller = autosave.current;
    if (!controller || !allowed(controller.snapshot().draft.schemaVersion, true)) return;
    setNotice("");
    // A server-side capability change can precede the cached /me flag. Explicit retry
    // reuses the retained body; controls stay read-only until that save is acknowledged.
    controller.setEnabled(true);
    try {
      await controller.retry();
    } catch {
      // The controller keeps the failed intent and publishes the actionable error.
    } finally {
      if (autosave.current === controller)
        controller.setEnabled(
          allowed(controller.snapshot().draft.schemaVersion, true) &&
            controller.snapshot().pauseReason !== "survey-pages",
        );
    }
  }
  async function write(action: Action) {
    if (!allowed() || working.current || !autosave.current) return;
    if (action === "share" && protectRoom && !passwordAvailable) {
      setPasswordError("live.protection.upgrade");
      return;
    }
    if (
      action === "share" &&
      passwordAvailable &&
      protectRoom &&
      !validRoomPassword(joinPassword)
    ) {
      setPasswordError("live.protection.validation");
      return;
    }
    const controller = autosave.current;
    working.current = true;
    setBusy(true);
    setPasswordError(null);
    setError("");
    setNotice("");
    try {
      let operation = pending.current;
      if (!operation) {
        const saved = await controller.flush();
        if (autosave.current !== controller || !allowed(saved.draft.schemaVersion)) return;
        if (action === "publish") {
          if (
            saved.draft.schemaVersion === 3 &&
            saved.draft.pages.some((page) => !page.questionIds.length)
          )
            throw new Error(copy.publishEmptyPageError);
          const validated = SurveyContentSchema.safeParse(saved.draft);
          if (!validated.success)
            throw new Error(
              validated.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join(". "),
            );
        }
        if (
          action === "share" &&
          (saved.status !== "published" || saved.publishedRevision !== saved.revision)
        )
          throw new Error("Publish the latest saved changes before creating a sharing link");
        const input =
          action === "duplicate"
            ? { sourceId: id }
            : action === "share"
              ? {
                  expectedRevision: saved.revision,
                  windowDays: days,
                  ...roomPasswordFields(passwordAvailable, protectRoom, joinPassword),
                }
              : { expectedRevision: saved.revision };
        operation = {
          path:
            action === "duplicate"
              ? "/v1/surveys"
              : `/v1/surveys/${id}/${action === "share" ? "rooms" : action}`,
          body: JSON.stringify({ ...input, idempotencyKey: surveyMutationKey() }),
          method: "POST",
          action,
        };
        pending.current = operation;
      }
      if (!allowed()) return;
      const result = await apiFetch<{ survey?: SurveyRecord; room?: { id: string } }>(
        operation.path,
        { method: operation.method, body: operation.body },
      );
      if (
        autosave.current !== controller ||
        !current.current.valid ||
        current.current.scope !== scope ||
        current.current.context !== context
      )
        return;
      if (!allowed()) throw new SurveySavePausedError();
      pending.current = null;
      if (result.survey && result.survey.id !== id) {
        router.push(`/surveys/${result.survey.id}`);
        return;
      }
      if (result.survey) {
        controller.acceptRecord(result.survey);
      }
      if (result.room) router.push(`/surveys/rooms/${result.room.id}`);
      setNotice(
        operation.action === "publish"
          ? "Survey published."
          : operation.action === "archive"
            ? "Survey archived."
            : "Saved.",
      );
    } catch (caught) {
      if (
        autosave.current !== controller ||
        !current.current.valid ||
        current.current.scope !== scope ||
        current.current.context !== context
      )
        return;
      if (caught instanceof ApiClientError && !isRetryableSaveError(caught)) pending.current = null;
      if (!controller.snapshot().error) setError(humanError(caught));
    } finally {
      if (autosave.current === controller && current.current.valid) {
        setBusy(false);
        working.current = false;
      }
    }
  }
  const operationBlocked = !editingAllowed || busy || Boolean(pending.current) || savePaused;
  const blocked =
    !editingAllowed || busy || Boolean(pending.current) || record?.status === "archived";
  if (!creator || loading || workspaceError || !current.current.valid)
    return <WorkspaceShell title="Survey editor">{null}</WorkspaceShell>;
  return (
    <WorkspaceShell
      title={retainedBranching?.title || draft?.title || "Survey editor"}
      description={
        retainedBranching
          ? undefined
          : "Self-paced, unscored feedback. Draft changes autosave; preview, publish, then create a sharing link."
      }
      eyebrow="Survey"
      actions={
        <Link className="button-quiet" href="/surveys">
          All Surveys
        </Link>
      }
    >
      {error ? (
        <p className="error" role="alert">
          {error}{" "}
          {pending.current ? (
            <button
              type="button"
              disabled={busy || !editingAllowed}
              title={!editingAllowed ? copy.pausedNotice : undefined}
              onClick={() => void write("publish")}
            >
              Retry same operation
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={reload}>
              Reload
            </button>
          )}
        </p>
      ) : null}
      {model?.error ? (
        <div className="error" role="alert">
          <p>
            {model.phase === "conflict"
              ? "This Survey changed in another tab or editor. Autosave is paused; your local edits are kept in this editor."
              : "Autosave could not finish. Your edits are kept in this editor; save successfully before leaving."}
          </p>
          <p>{model.error}</p>
          {model.phase !== "conflict" ? (
            <button
              type="button"
              disabled={busy || !allowed(draft?.schemaVersion, true)}
              onClick={() => void saveNow()}
            >
              Retry save
            </button>
          ) : null}
          <button type="button" onClick={downloadLocalDraft}>
            Download local draft
          </button>
          {model.phase === "conflict" ? (
            <button type="button" disabled={busy} onClick={reload}>
              Reload latest version
            </button>
          ) : null}
        </div>
      ) : null}
      {retainedBranching ? (
        <SurveyBranchingPreview draft={retainedBranching} locale={locale} />
      ) : (
        <p role="status">
          {notice ||
            (model?.phase === "saving"
              ? "Saving…"
              : model?.phase === "waiting" && canEdit
                ? "Waiting to save…"
                : savePaused || dirty
                  ? "Changes not saved — resolve the save error before leaving."
                  : model?.phase === "saved"
                    ? "Saved."
                    : record
                      ? `Draft revision ${record.revision} · ${record.status}`
                      : "Loading Survey…")}
        </p>
      )}
      {draft && record ? (
        draft.schemaVersion === 3 && !canAuthorPages ? (
          <>
            <ReadOnlySurveyPages draft={draft} paused={model.unsettled || canEdit} />
            {model.unsettled ? (
              <button className="button-quiet" type="button" onClick={downloadLocalDraft}>
                Download local draft
              </button>
            ) : null}
          </>
        ) : (
          <>
            <section className={styles.panel}>
              <fieldset disabled={blocked}>
                <legend>Survey details</legend>
                <label className="field">
                  Title
                  <input
                    className="input"
                    maxLength={160}
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>
                <label className="field">
                  Description
                  <textarea
                    className="input"
                    maxLength={1000}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </label>
              </fieldset>
              <p>
                Organizers see aggregate results after five submissions. Responses are not linked to
                learning identities. Survey question timers are not used.
              </p>
              {draft.schemaVersion !== 3 ? (
                <button className="button-quiet" type="button" onClick={() => setPreview(!preview)}>
                  {preview ? "Edit questions" : "Preview Survey"}
                </button>
              ) : null}
            </section>
            {draft.schemaVersion !== 3 && canAuthorPages ? (
              <section className={styles.panel} lang={locale} data-survey-conversion>
                <h2>{copy.convertTitle}</h2>
                <p>{copy.convertNotice}</p>
                <button
                  className="button-quiet"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    if (allowed(3) && window.confirm(copy.convertConfirm))
                      setDraft(convertSurveyToPages(draft));
                  }}
                >
                  {copy.convertAction}
                </button>
              </section>
            ) : null}
            {draft.schemaVersion === 3 ? (
              <SurveyPageAuthoring
                draft={draft}
                locale={locale}
                disabled={blocked}
                onChange={setDraft}
              />
            ) : (
              draft.items.map((item, index) => (
                <section className={styles.panel} key={item.question.id}>
                  <h2>Question {index + 1}</h2>
                  {preview ? (
                    <SurveyResponseControl
                      question={item.question}
                      required={item.required}
                      disabled
                    />
                  ) : (
                    <>
                      <SurveyQuestionEditor
                        question={item.question}
                        disabled={blocked}
                        onChange={(question) =>
                          setDraft({
                            ...draft,
                            items: draft.items.map((row, offset) =>
                              offset === index ? { ...row, question } : row,
                            ),
                          })
                        }
                      />
                      <label className="field">
                        <input
                          type="checkbox"
                          checked={item.required}
                          disabled={blocked}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              items: draft.items.map((row, offset) =>
                                offset === index ? { ...row, required: event.target.checked } : row,
                              ),
                            })
                          }
                        />
                        Required response
                      </label>
                      <SurveyQuestionActions
                        index={index}
                        count={draft.items.length}
                        disabled={blocked}
                        onMove={(direction) => {
                          const items = [...draft.items];
                          [items[index], items[index + direction]] = [
                            items[index + direction]!,
                            items[index]!,
                          ];
                          setDraft({ ...draft, items });
                        }}
                        onRemove={() =>
                          setDraft({
                            ...draft,
                            items: draft.items.filter((_, offset) => offset !== index),
                          })
                        }
                      />
                    </>
                  )}
                </section>
              ))
            )}
            <section className={styles.panel}>
              {draft.schemaVersion !== 3 ? (
                <div className={styles.surveyActions}>
                  {(["poll", "rating"] as const).map((type) => (
                    <button
                      className="button-quiet"
                      key={type}
                      type="button"
                      disabled={blocked || draft.items.length >= 100}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: [
                            ...draft.items,
                            { required: true, question: newSurveyQuestion(type, locale) },
                          ],
                        })
                      }
                    >
                      Add {type}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className={styles.surveyActions}>
                <button
                  className="button"
                  type="button"
                  disabled={blocked || !dirty || savePaused || model.phase === "saving"}
                  onClick={() => void saveNow()}
                >
                  Save draft
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={
                    operationBlocked || record.status === "archived" || !productFeatures?.surveys
                  }
                  onClick={() => void write("publish")}
                >
                  Publish Survey
                </button>
                <button
                  className="button-quiet"
                  type="button"
                  disabled={operationBlocked || !productFeatures?.surveys}
                  onClick={() => void write("duplicate")}
                >
                  Duplicate
                </button>
                <button
                  className="button-quiet"
                  type="button"
                  disabled={operationBlocked || record.status === "archived"}
                  onClick={() => void write("archive")}
                >
                  Archive
                </button>
              </div>
              <p>
                Free workspaces share five published items across Rounds and Surveys. Sharing
                freezes the published version; later edits do not alter a shared survey.
              </p>
              <label className="field">
                Open for (days)
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={30}
                  value={days}
                  disabled={blocked}
                  onChange={(event) => setDays(Number(event.target.value))}
                />
              </label>
              <RoomPasswordOption
                available={passwordAvailable}
                enabled={protectRoom}
                password={joinPassword}
                disabled={blocked || Boolean(pending.current)}
                onEnabledChange={setProtectRoom}
                onPasswordChange={setJoinPassword}
              />
              {passwordError ? (
                <p className="error" lang={locale} role="alert">
                  {t(passwordError)}
                </p>
              ) : null}
              <button
                className="button"
                type="button"
                disabled={
                  operationBlocked ||
                  model.unsettled ||
                  record.publishedRevision !== record.revision ||
                  record.status !== "published" ||
                  !productFeatures?.surveys ||
                  !Number.isInteger(days) ||
                  days < 1 ||
                  days > 30
                }
                onClick={() => void write("share")}
              >
                Create sharing link
              </button>
            </section>
          </>
        )
      ) : null}
    </WorkspaceShell>
  );
}
export default function SurveyEditorPage() {
  const id = useParams<{ id: string }>().id;
  return (
    <NavigationGuardProvider>
      <WorkspaceProvider>
        <ScopedSurveyEditor id={id} />
      </WorkspaceProvider>
    </NavigationGuardProvider>
  );
}

function ScopedSurveyEditor({ id }: { id: string }) {
  const { creator } = useWorkspace();
  const confirmed = useRef<{ actorId: string; workspaceId: string } | null>(null);
  if (creator) confirmed.current = { actorId: creator.userId, workspaceId: creator.workspaceId };
  if (!confirmed.current) return <WorkspaceShell title="Survey editor">{null}</WorkspaceShell>;
  const scope = JSON.stringify([confirmed.current.actorId, confirmed.current.workspaceId, id]);
  return <SurveyEditor key={scope} id={id} scope={scope} />;
}
