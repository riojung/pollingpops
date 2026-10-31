"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CanvasArtifactLink, CanvasArtifactLinkEligibleSchema } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { useNavigationBlocker } from "../navigation-guard";
import { clientUuid } from "../../lib/uuid";
import { canvasArtifactLinkCopy } from "../../lib/i18n/canvas-artifact-link-messages";
import {
  createCanvasArtifactIntent,
  deleteCanvasArtifactIntent,
  eligibleCanvasArtifactLinks,
  type CanvasArtifactTarget,
} from "./client";
import { useCanvasArtifactLinks } from "./use-links";
import { CanvasArtifactPreview } from "./preview";
import styles from "./links.module.css";
type Eligible = ReturnType<typeof CanvasArtifactLinkEligibleSchema.parse>;
export function CanvasArtifactLinks(props: {
  target: CanvasArtifactTarget;
  editable?: boolean;
  disabled?: boolean;
}) {
  return <Links key={`${props.target.kind}:${props.target.targetId}`} {...props} />;
}
function Links({
  target,
  editable = true,
  disabled = false,
}: {
  target: CanvasArtifactTarget;
  editable?: boolean;
  disabled?: boolean;
}) {
  const { locale } = useLocale(),
    copy = canvasArtifactLinkCopy(locale);
  const state = useCanvasArtifactLinks(target);
  const [picker, setPicker] = useState(false),
    [eligible, setEligible] = useState<Eligible | null>(null);
  const [boardId, setBoardId] = useState(""),
    [versionId, setVersionId] = useState("");
  const [pickerError, setPickerError] = useState(false),
    [previewError, setPreviewError] = useState(false);
  const [preview, setPreview] = useState<CanvasArtifactLink | null>(null);
  const [previewEpoch, setPreviewEpoch] = useState(-1);
  const blocked = disabled || state.saving || Boolean(state.failure);
  const canCreate =
    editable && Boolean(state.list?.canCreate) && (state.list?.links.length ?? 20) < 20;
  useNavigationBlocker(() => state.saving || Boolean(state.failure));
  useEffect(() => {
    setPreview(null);
    setPicker(false);
    setEligible(null);
    setBoardId("");
    setVersionId("");
  }, [state.accessEpoch]);
  useEffect(() => {
    if (preview && !state.list?.links.some((link) => link.id === preview.id)) setPreview(null);
  }, [state.list, preview]);
  useEffect(() => {
    if (!picker) return;
    const controller = new AbortController();
    setEligible(null);
    setPickerError(false);
    void eligibleCanvasArtifactLinks(target, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setEligible(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPickerError(true);
          setPreview(null);
        }
      });
    return () => controller.abort();
  }, [picker, target.kind, target.targetId]);
  const unavailable = useCallback(() => {
    setPreview(null);
    setPreviewError(true);
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      blocked ||
      !canCreate ||
      !eligible?.boards.some(
        (board) =>
          board.id === boardId && board.versions.some((version) => version.id === versionId),
      )
    )
      return;
    if (
      await state.execute(
        createCanvasArtifactIntent(boardId, versionId, clientUuid(), clientUuid()),
      )
    )
      setPicker(false);
  }
  async function remove(link: CanvasArtifactLink) {
    if (!blocked && editable && link.canDelete)
      await state.execute(deleteCanvasArtifactIntent(link, clientUuid()));
  }
  return (
    <section className={styles.panel} aria-label={copy.title}>
      <header className={styles.header}>
        <h2>{copy.title}</h2>
        {editable && state.list?.canCreate ? (
          <button
            type="button"
            className="button-quiet"
            disabled={blocked || !canCreate}
            onClick={() => setPicker(true)}
          >
            {copy.add}
          </button>
        ) : null}
      </header>
      <p>{copy.help}</p>
      <p>{copy.limit}</p>
      {!state.list && !state.error ? <p role="status">{copy.loading}</p> : null}
      {state.error || pickerError || previewError ? (
        <div className={styles.notice} role="alert">
          <p>{copy.failed}</p>
          <button
            type="button"
            className="button-quiet"
            disabled={state.saving}
            onClick={() => {
              setPreviewError(false);
              void state.refresh();
            }}
          >
            {copy.refresh}
          </button>
        </div>
      ) : null}
      {state.failure ? (
        <div className={styles.notice} role="alert">
          <p>{state.failure.conflict ? copy.conflict : copy.pending}</p>
          <div className={styles.actions}>
            {state.failure.retryable && !state.failure.conflict ? (
              <button
                type="button"
                className="button-quiet"
                disabled={disabled || !editable || state.saving || !state.list}
                onClick={() => void state.execute()}
              >
                {copy.retry}
              </button>
            ) : null}
            <button
              type="button"
              className="button-quiet"
              disabled={state.saving}
              onClick={() => void state.refresh()}
            >
              {copy.review}
            </button>
            <button
              type="button"
              className="button-quiet"
              disabled={state.saving}
              onClick={state.discard}
            >
              {copy.discard}
            </button>
          </div>
        </div>
      ) : null}
      {picker && canCreate ? (
        <form className={styles.form} onSubmit={(event) => void create(event)}>
          {!eligible && !pickerError ? <p role="status">{copy.loading}</p> : null}
          {eligible && !eligible.boards.length ? <p>{copy.none}</p> : null}
          <label>
            {copy.board}
            <select
              value={boardId}
              disabled={blocked || !eligible}
              required
              onChange={(event) => {
                setBoardId(event.target.value);
                setVersionId("");
              }}
            >
              <option value="">{copy.chooseBoard}</option>
              {eligible?.boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.version}
            <select
              value={versionId}
              disabled={blocked || !boardId}
              required
              onChange={(event) => setVersionId(event.target.value)}
            >
              <option value="">{copy.chooseVersion}</option>
              {eligible?.boards
                .find((board) => board.id === boardId)
                ?.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name}
                  </option>
                ))}
            </select>
          </label>
          <div className={styles.actions}>
            <button type="submit" className="button" disabled={blocked || !boardId || !versionId}>
              {copy.create}
            </button>
            <button
              type="button"
              className="button-quiet"
              disabled={state.saving}
              onClick={() => setPicker(false)}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      ) : null}
      {state.list ? (
        <>
          {!state.list.canCreate ? <p>{copy.readonly}</p> : null}
          {!state.list.links.length ? (
            <p>{copy.empty}</p>
          ) : (
            <ul className={styles.list}>
              {state.list.links.map((link) => (
                <li key={link.id} className={styles.item}>
                  <h3 dir="auto" lang="">
                    {link.name}
                  </h3>
                  <p dir="auto" lang="">
                    {link.boardTitle}
                  </p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() => {
                        setPreviewError(false);
                        setPreviewEpoch(state.accessEpoch);
                        setPreview(link);
                      }}
                    >
                      {copy.preview}
                    </button>
                    {editable && link.canDelete ? (
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={blocked}
                        onClick={() => void remove(link)}
                      >
                        {copy.remove}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {preview &&
      previewEpoch === state.accessEpoch &&
      !state.error &&
      state.list?.links.some((link) => link.id === preview.id) ? (
        <CanvasArtifactPreview
          key={preview.id}
          target={target}
          link={preview}
          onClose={() => setPreview(null)}
          onUnavailable={unavailable}
        />
      ) : null}
    </section>
  );
}
