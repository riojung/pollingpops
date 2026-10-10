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
import styles from "../../../components/workspace/workspace-content.module.css";

function Editor() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const { canEdit, productFeatures } = useWorkspace();
  const [record, setRecord] = useState<SurveyRecord | null>(null);
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [days, setDays] = useState(7);
  const pending = useRef<{ path: string; body: string } | null>(null);
  async function load() {
    setError("");
    try {
      const response = await apiFetch<{ survey: SurveyRecord }>(`/v1/surveys/${id}`);
      setRecord(response.survey);
      setDraft(response.survey.draft);
    } catch (caught) {
      setError(humanError(caught));
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  const dirty = Boolean(record && draft && JSON.stringify(record.draft) !== JSON.stringify(draft));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function write(path: string, input: object, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    const operation = pending.current ?? {
      path,
      body: JSON.stringify({ ...input, idempotencyKey: surveyMutationKey() }),
    };
    pending.current = operation;
    try {
      const result = await apiFetch<{ survey?: SurveyRecord; room?: { id: string } }>(
        operation.path,
        { method, body: operation.body },
      );
      pending.current = null;
      if (result.survey && result.survey.id !== id) {
        router.push(`/surveys/${result.survey.id}`);
        return;
      }
      if (result.survey) {
        setRecord(result.survey);
        setDraft(result.survey.draft);
      }
      if (result.room) router.push(`/surveys/rooms/${result.room.id}`);
      setNotice("Saved.");
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pending.current = null;
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }
  const operationBlocked = !canEdit || busy || Boolean(pending.current);
  const blocked = operationBlocked || record?.status === "archived";
  return (
    <WorkspaceShell
      title={draft?.title || "Survey editor"}
      description="Self-paced, unscored feedback. Save, preview, publish, then create a sharing link."
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
              disabled={busy}
              onClick={() =>
                void write(
                  pending.current!.path,
                  {},
                  pending.current!.path === `/v1/surveys/${id}` ? "PUT" : "POST",
                )
              }
            >
              Retry same operation
            </button>
          ) : (
            <button type="button" onClick={() => void load()}>
              Reload
            </button>
          )}
        </p>
      ) : null}
      <p role="status">
        {notice ||
          (dirty
            ? "Unsaved changes — save before leaving."
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
                disabled={blocked || !dirty}
                onClick={() =>
                  void write(
                    `/v1/surveys/${id}`,
                    { expectedRevision: record.revision, draft },
                    "PUT",
                  )
                }
              >
                Save draft
              </button>
              <button
                className="button"
                type="button"
                disabled={blocked || dirty || !productFeatures?.surveys}
                onClick={() => {
                  const validated = SurveyContentSchema.safeParse(draft);
                  if (!validated.success) {
                    setError(
                      validated.error.issues
                        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                        .join(". "),
                    );
                    return;
                  }
                  void write(`/v1/surveys/${id}/publish`, { expectedRevision: record.revision });
                }}
              >
                Publish Survey
              </button>
              <button
                className="button-quiet"
                type="button"
                disabled={operationBlocked || !productFeatures?.surveys}
                onClick={() => void write("/v1/surveys", { sourceId: id })}
              >
                Duplicate
              </button>
              <button
                className="button-quiet"
                type="button"
                disabled={blocked || dirty}
                onClick={() =>
                  void write(`/v1/surveys/${id}/archive`, { expectedRevision: record.revision })
                }
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
                blocked ||
                dirty ||
                record.publishedRevision !== record.revision ||
                record.status !== "published" ||
                !productFeatures?.surveys ||
                !Number.isInteger(days) ||
                days < 1 ||
                days > 30
              }
              onClick={() =>
                void write(`/v1/surveys/${id}/rooms`, {
                  expectedRevision: record.revision,
                  windowDays: days,
                })
              }
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
  return (
    <WorkspaceProvider>
      <Editor />
    </WorkspaceProvider>
  );
}
