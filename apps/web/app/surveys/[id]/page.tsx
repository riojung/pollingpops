"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SurveyContentSchema, type SurveyDraft } from "@openround/contracts/surveys";
import {
  newSurveyQuestion,
  SurveyQuestionEditor,
  SurveyResponseControl,
} from "../../../components/survey-controls";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { apiFetch, humanError, ApiClientError } from "../../../lib/api";
import {
  surveyMutationKey,
  type SurveyRecordView as SurveyRecord,
} from "../../../lib/survey-client";
import { SurveyAutosave, type SurveyAutosaveSnapshot } from "../../../lib/survey-autosave";
import { isRetryableSaveError } from "../../../lib/retry";
import styles from "../../../components/workspace/workspace-content.module.css";

type Action = "publish" | "duplicate" | "archive" | "share";
function Editor({ id }: { id: string }) {
  const router = useRouter();
  const { canEdit, productFeatures } = useWorkspace();
  const [model, setModel] = useState<SurveyAutosaveSnapshot | null>(null);
  const autosave = useRef<SurveyAutosave | null>(null);
  const editPermission = useRef(canEdit);
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
  const record = model?.record;
  const draft = model?.draft;
  const dirty = model?.dirty ?? false;
  const savePaused = Boolean(model && ["retry", "error", "conflict"].includes(model.phase));
  useEffect(() => {
    editPermission.current = canEdit;
    autosave.current?.setEnabled(canEdit);
  }, [canEdit, model?.record.id]);
  useEffect(() => {
    let active = true;
    autosave.current?.dispose();
    autosave.current = null;
    setModel(null);
    setError("");
    void apiFetch<{ survey: SurveyRecord }>(`/v1/surveys/${id}`)
      .then((response) => {
        if (!active) return;
        const controller = new SurveyAutosave(response.survey, {
          enabled: editPermission.current,
          changed: (snapshot) => {
            if (active) setModel(snapshot);
          },
          save: async (body) => {
            if (!editPermission.current)
              throw new ApiClientError("Your role is read-only", "UNAUTHORIZED", 403);
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
  }, [id, loadAttempt]);
  function setDraft(value: SurveyDraft) {
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
  const unsettled = Boolean(model?.unsettled || pending.current);
  useEffect(() => {
    if (!unsettled) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsettled]);
  async function saveNow() {
    setNotice("");
    await autosave.current?.retry().catch(() => undefined);
  }
  async function write(action: Action) {
    if (!canEdit || working.current || !autosave.current) return;
    const controller = autosave.current;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let operation = pending.current;
      if (!operation) {
        const saved = await controller.flush();
        if (autosave.current !== controller) return;
        if (action === "publish") {
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
              ? { expectedRevision: saved.revision, windowDays: days }
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
      const result = await apiFetch<{ survey?: SurveyRecord; room?: { id: string } }>(
        operation.path,
        { method: operation.method, body: operation.body },
      );
      if (autosave.current !== controller) return;
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
      if (autosave.current !== controller) return;
      if (caught instanceof ApiClientError && !isRetryableSaveError(caught)) pending.current = null;
      if (!controller.snapshot().error) setError(humanError(caught));
    } finally {
      setBusy(false);
      working.current = false;
    }
  }
  const operationBlocked = !canEdit || busy || Boolean(pending.current) || savePaused;
  const blocked = !canEdit || busy || Boolean(pending.current) || record?.status === "archived";
  return (
    <WorkspaceShell
      title={draft?.title || "Survey editor"}
      description="Self-paced, unscored feedback. Draft changes autosave; preview, publish, then create a sharing link."
      eyebrow="Survey"
      actions={
        <Link
          className="button-quiet"
          href="/surveys"
          onClick={(event) => {
            if (
              unsettled &&
              !window.confirm("Changes are not fully saved. Leave this editor anyway?")
            )
              event.preventDefault();
          }}
        >
          All Surveys
        </Link>
      }
    >
      {error ? (
        <p className="error" role="alert">
          {error}{" "}
          {pending.current ? (
            <button type="button" disabled={busy} onClick={() => void write("publish")}>
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
            <button type="button" disabled={busy || !canEdit} onClick={() => void saveNow()}>
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
      {draft && record ? (
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
            <button className="button-quiet" type="button" onClick={() => setPreview(!preview)}>
              {preview ? "Edit questions" : "Preview Survey"}
            </button>
          </section>
          {draft.items.map((item, index) => (
            <section className={styles.panel} key={item.question.id}>
              <h2>Question {index + 1}</h2>
              {preview ? (
                <SurveyResponseControl question={item.question} required={item.required} disabled />
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
                  <div className={styles.surveyActions}>
                    {(
                      [
                        [-1, "Move up"],
                        [1, "Move down"],
                      ] as const
                    ).map(([direction, label]) => (
                      <button
                        className="button-quiet small-button"
                        key={direction}
                        type="button"
                        disabled={
                          blocked ||
                          index + direction < 0 ||
                          index + direction >= draft.items.length
                        }
                        onClick={() => {
                          const items = [...draft.items];
                          [items[index], items[index + direction]] = [
                            items[index + direction]!,
                            items[index]!,
                          ];
                          setDraft({ ...draft, items });
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      className="button-quiet small-button"
                      type="button"
                      disabled={blocked}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: draft.items.filter((_, offset) => offset !== index),
                        })
                      }
                    >
                      Remove question {index + 1}
                    </button>
                  </div>
                </>
              )}
            </section>
          ))}
          <section className={styles.panel}>
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
                        { required: true, question: newSurveyQuestion(type) },
                      ],
                    })
                  }
                >
                  Add {type}
                </button>
              ))}
            </div>
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
              Free workspaces share five published items across Rounds and Surveys. Sharing freezes
              the published version; later edits do not alter a shared survey.
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
      ) : null}
    </WorkspaceShell>
  );
}
export default function SurveyEditorPage() {
  const id = useParams<{ id: string }>().id;
  return (
    <WorkspaceProvider>
      <Editor key={id} id={id} />
    </WorkspaceProvider>
  );
}
