"use client";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type {
  CanvasBoardView,
  CanvasCommentThread,
  CanvasFacilitationCommand,
} from "@openround/contracts";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { useNavigationBlocker } from "../navigation-guard";
import { formatDateTime } from "../../lib/i18n/format";
import { canvasFacilitationCopy } from "../../lib/i18n/canvas-facilitation-messages";
import { canvasFacilitationUiCopy } from "../../lib/i18n/canvas-facilitation-ui-messages";
import { canvasObjectLabel } from "./canvas-model";
import { useCanvasFacilitation } from "./use-canvas-facilitation";
import { facilitationCommandAllowed, reviewFacilitationCommand } from "./canvas-facilitation-model";
import { CanvasTimerControls, FacilitationIcon } from "./canvas-timer-controls";
import { CanvasQuickTimer } from "./canvas-quick-timer";
import { CanvasHistoryPreview } from "./canvas-history-preview";
import type { CanvasPlan } from "./canvas-productivity";
import styles from "./canvas-facilitation.module.css";

interface Props {
  board: CanvasBoardView;
  selectedIds: string[];
  disabled?: boolean;
  onPlan: (plan: CanvasPlan) => Promise<boolean>;
  onRefresh?: () => void;
  onSelectObject?: (id: string) => void;
  quickTimerOpen?: boolean;
  onCloseQuickTimer?: () => void;
  onOpenQuickTimer?: () => void;
  quickTimerReturnFocusRef?: RefObject<HTMLElement | null>;
}
interface Draft {
  kind: "create" | "reply" | "edit";
  text: string;
  objectId: string;
  threadId: string;
  messageId: string;
  expectedVersion: number;
  original: string;
}
export function CanvasFacilitationPanel(props: Props) {
  return <PanelContent key={props.board.id} {...props} />;
}
function PanelContent({
  board,
  selectedIds,
  disabled = false,
  onPlan,
  onRefresh,
  onSelectObject,
  quickTimerOpen = false,
  onCloseQuickTimer,
  onOpenQuickTimer,
  quickTimerReturnFocusRef,
}: Props) {
  const { locale } = useLocale();
  const copy = canvasFacilitationCopy(locale);
  const ui = canvasFacilitationUiCopy(locale);
  const state = useCanvasFacilitation(board.id, board.canvasSeq);
  const view = state.view;
  const observed = useRef({
    serverNow: view?.serverNow,
    revision: view?.timer.revision,
    time: performance.now(),
  });
  if (
    observed.current.serverNow !== view?.serverNow ||
    observed.current.revision !== view?.timer.revision
  )
    observed.current = {
      serverNow: view?.serverNow,
      revision: view?.timer.revision,
      time: performance.now(),
    };
  const [tab, setTab] = useState<"comments" | "timer" | "versions">("comments");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [minutes, setMinutes] = useState(5);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const blocked = disabled || state.saving || Boolean(state.failure) || !view;
  useNavigationBlocker(
    () =>
      Boolean(draft && draft.text !== draft.original) ||
      Boolean(name.trim()) ||
      state.saving ||
      Boolean(state.failure),
  );
  useEffect(() => {
    const changed = () => {
      setDraft(null);
      setName("");
      setPreview(null);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, changed);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, changed);
  }, []);
  useEffect(() => {
    if (preview && view && !view.versions.some((entry) => entry.id === preview)) setPreview(null);
  }, [preview, view]);
  async function commit(command?: CanvasFacilitationCommand) {
    const sent = command ?? state.failure?.operation.command;
    const ok = await state.execute(command);
    if (ok) {
      if (sent?.type.startsWith("comment_")) setDraft(null);
      if (sent?.type === "version_create") setName("");
      onRefresh?.();
    }
    return ok;
  }
  function draftCommand(): CanvasFacilitationCommand | null {
    if (
      !draft ||
      !draft.text.trim() ||
      !view?.capabilities.comment ||
      !board.objects.some((object) => object.id === draft.objectId)
    )
      return null;
    if (draft.kind === "create")
      return {
        type: "comment_thread_create",
        threadId: draft.threadId,
        messageId: draft.messageId,
        objectId: draft.objectId,
        text: draft.text,
      };
    const thread = view.threads.find((entry) => entry.id === draft.threadId);
    if (!thread || (draft.kind === "reply" && thread.resolved)) return null;
    if (
      draft.kind === "edit" &&
      !thread.messages.some(
        (message) =>
          message.id === draft.messageId && !message.deleted && message.authorId === view.actorId,
      )
    )
      return null;
    return {
      type: draft.kind === "edit" ? "comment_edit" : "comment_reply",
      threadId: draft.threadId,
      expectedVersion: draft.expectedVersion,
      messageId: draft.messageId,
      text: draft.text,
    };
  }
  function compose(thread?: CanvasCommentThread, messageId?: string) {
    if (draft || !view?.capabilities.comment) return;
    const objectId = thread?.objectId ?? selectedIds[0];
    if (!objectId || !board.objects.some((object) => object.id === objectId)) return;
    const text = messageId ? thread!.messages.find((entry) => entry.id === messageId)!.text : "";
    setDraft({
      kind: messageId ? "edit" : thread ? "reply" : "create",
      text,
      original: text,
      objectId,
      threadId: thread?.id ?? clientUuid(),
      messageId: messageId ?? clientUuid(),
      expectedVersion: thread?.version ?? 0,
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const command = draftCommand();
    if (!blocked && command) await commit(command);
  }
  async function review() {
    if (!view || !state.failure || disabled || state.saving) return;
    const command = reviewFacilitationCommand(state.failure.operation.command, view);
    if (
      !command ||
      (command.type === "comment_thread_create" &&
        !board.objects.some((object) => object.id === command.objectId))
    )
      return;
    state.discard();
    await commit(command);
  }
  const pendingCommand = state.failure?.operation.command;
  const canReview = Boolean(
    view &&
    pendingCommand &&
    reviewFacilitationCommand(pendingCommand, view) &&
    (pendingCommand.type !== "comment_thread_create" ||
      board.objects.some((object) => object.id === pendingCommand.objectId)),
  );
  const currentAnchor = draft && board.objects.find((object) => object.id === draft.objectId);
  const notices = (
    <>
      {state.loading && !view ? <p role="status">{copy.loading}</p> : null}
      {state.error ? (
        <div className={styles.notice} role="alert">
          <p>{state.error === "save" ? copy.unsent : copy.unavailable}</p>
          <button type="button" className="button-quiet" onClick={() => void state.refresh()}>
            {copy.refresh}
          </button>
        </div>
      ) : null}
      {state.failure ? (
        <div className={styles.notice} role="alert">
          <p>{state.failure.conflict ? copy.conflict : copy.unsent}</p>
          <div className={styles.actions}>
            {state.failure.conflict ? (
              <button
                type="button"
                className="button-quiet"
                disabled={disabled || state.saving || !canReview}
                onClick={() => void review()}
              >
                {copy.review}
              </button>
            ) : (
              <button
                type="button"
                className="button-quiet"
                disabled={
                  disabled ||
                  state.saving ||
                  !view ||
                  !pendingCommand ||
                  !facilitationCommandAllowed(pendingCommand, view)
                }
                onClick={() => void commit()}
              >
                {copy.retry}
              </button>
            )}
            <button
              type="button"
              className="button-quiet"
              disabled={state.saving}
              onClick={() => {
                state.discard();
                setDraft(null);
                setName("");
              }}
            >
              {copy.discard}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
  const timerControls = view ? (
    <CanvasTimerControls
      timer={view.timer}
      serverNow={view.serverNow}
      observedAt={observed.current.time}
      minutes={minutes}
      onMinutes={setMinutes}
      canControl={view.capabilities.controlTimer}
      disabled={blocked}
      onCommand={(command) => void commit(command)}
      onFloat={!quickTimerOpen ? onOpenQuickTimer : undefined}
    />
  ) : null;
  return (
    <>
      <section className={styles.panel} aria-label={copy.title}>
        <h2 className={styles.panelTitle}>{copy.title}</h2>
        <div className={styles.tabs} role="group" aria-label={copy.title}>
          {(["comments", "timer", "versions"] as const).map((value) => (
            <button
              type="button"
              className={styles.tab}
              key={value}
              aria-label={copy[value]}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              <FacilitationIcon name={value} />
              <span>{copy[value]}</span>
            </button>
          ))}
        </div>
        {!quickTimerOpen ? notices : null}
        {tab === "comments" && view ? (
          <>
            {!view.capabilities.comment ? (
              <p>{copy.readonly}</p>
            ) : (
              <>
                <button
                  type="button"
                  className="button-quiet"
                  disabled={
                    blocked || Boolean(draft) || !selectedIds.length || view.threads.length >= 100
                  }
                  onClick={() => compose()}
                >
                  {copy.newThread}
                </button>
                {!selectedIds.length ? <p className={styles.muted}>{copy.choose}</p> : null}
              </>
            )}
            {!view.threads.length ? (
              <div className={styles.emptyState}>
                <FacilitationIcon name="comments" />
                <h3>{ui.commentsEmpty}</h3>
                <p>{copy.empty}</p>
              </div>
            ) : (
              <ol className={styles.list}>
                {view.threads.map((thread) => {
                  const anchor = board.objects.find((object) => object.id === thread.objectId);
                  return (
                    <li key={thread.id}>
                      <article className={styles.thread} aria-labelledby={`thread-${thread.id}`}>
                        <h3 id={`thread-${thread.id}`}>
                          {anchor ? canvasObjectLabel(anchor, copy.comments) : copy.anchorGone}
                        </h3>
                        {anchor && onSelectObject ? (
                          <button
                            type="button"
                            className="button-quiet"
                            onClick={() => onSelectObject(anchor.id)}
                          >
                            {copy.preview}
                          </button>
                        ) : null}
                        {thread.resolved ? (
                          <p className={styles.resolved}>{copy.resolved}</p>
                        ) : null}
                        {thread.messages.map((message) => (
                          <div key={message.id} className={styles.message}>
                            <p className={styles.muted}>
                              {message.authorId === view.actorId ? copy.you : copy.member} ·{" "}
                              {formatDateTime(locale, message.updatedAt)}
                            </p>
                            <p dir="auto" lang="">
                              {message.deleted ? copy.deleted : message.text}
                            </p>
                            {!message.deleted ? (
                              <div className={styles.actions}>
                                {view.capabilities.comment && message.authorId === view.actorId ? (
                                  <button
                                    type="button"
                                    className="button-quiet"
                                    disabled={blocked || Boolean(draft)}
                                    onClick={() => compose(thread, message.id)}
                                  >
                                    {copy.edit}
                                  </button>
                                ) : null}
                                {(view.capabilities.comment && message.authorId === view.actorId) ||
                                view.capabilities.moderateComments ? (
                                  <button
                                    type="button"
                                    className="button-quiet"
                                    disabled={blocked || Boolean(draft)}
                                    onClick={() =>
                                      void commit({
                                        type: "comment_delete",
                                        threadId: thread.id,
                                        expectedVersion: thread.version,
                                        messageId: message.id,
                                      })
                                    }
                                  >
                                    {copy.delete}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                        <div className={styles.actions}>
                          {view.capabilities.comment && !thread.resolved ? (
                            <button
                              type="button"
                              className="button-quiet"
                              disabled={blocked || Boolean(draft) || thread.messages.length >= 20}
                              onClick={() => compose(thread)}
                            >
                              {copy.reply}
                            </button>
                          ) : null}
                          {view.capabilities.moderateComments ? (
                            <button
                              type="button"
                              className="button-quiet"
                              disabled={blocked || Boolean(draft)}
                              onClick={() =>
                                void commit({
                                  type: "comment_resolve",
                                  threadId: thread.id,
                                  expectedVersion: thread.version,
                                  resolved: !thread.resolved,
                                })
                              }
                            >
                              {thread.resolved ? copy.reopen : copy.resolve}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        ) : null}
        {draft ? (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <h3>
              {draft.kind === "edit"
                ? copy.edit
                : draft.kind === "reply"
                  ? copy.reply
                  : copy.newThread}
            </h3>
            {!currentAnchor ? (
              <p role="status">{copy.anchorGone}</p>
            ) : (
              <p className={styles.muted}>{canvasObjectLabel(currentAnchor, copy.comments)}</p>
            )}
            <label>
              {copy.draft}
              <textarea
                autoFocus
                value={draft.text}
                maxLength={2000}
                readOnly={blocked || !view?.capabilities.comment || !currentAnchor}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              />
            </label>
            <div className={styles.actions}>
              <button
                type="submit"
                className="button-quiet"
                disabled={blocked || !draftCommand() || draft.text === draft.original}
              >
                {draft.kind === "edit" ? copy.save : copy.post}
              </button>
              <button
                type="button"
                className="button-quiet"
                disabled={state.saving}
                onClick={() => {
                  state.discard();
                  setDraft(null);
                }}
              >
                {copy.discard}
              </button>
            </div>
          </form>
        ) : null}
        {tab === "timer" && !quickTimerOpen ? timerControls : null}
        {tab === "versions" && view ? (
          <>
            {view.capabilities.saveVersion ? (
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!blocked && name.trim())
                    void commit({ type: "version_create", versionId: clientUuid(), name });
                }}
              >
                <label>
                  {copy.versionName}
                  <input
                    value={name}
                    maxLength={120}
                    required
                    disabled={blocked}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="button-quiet"
                  disabled={blocked || !name.trim() || view.versions.length >= 10}
                >
                  {copy.saveVersion}
                </button>
              </form>
            ) : null}
            {!view.versions.length ? (
              <div className={styles.emptyState}>
                <FacilitationIcon name="versions" />
                <h3>{ui.versionsEmpty}</h3>
                <p>{copy.emptyVersions}</p>
              </div>
            ) : (
              <ol className={styles.list}>
                {view.versions.map((version) => (
                  <li className={styles.version} key={version.id}>
                    <h3>{version.name}</h3>
                    <p className={styles.muted}>{formatDateTime(locale, version.createdAt)}</p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={() => setPreview(version.id)}
                      >
                        {copy.preview}
                      </button>
                      {view.capabilities.deleteVersion ? (
                        <button
                          type="button"
                          className="button-quiet"
                          disabled={blocked}
                          onClick={() => {
                            if (window.confirm(copy.confirmDelete))
                              void commit({
                                type: "version_delete",
                                versionId: version.id,
                                expectedVersion: version.version,
                              });
                          }}
                        >
                          {copy.deleteVersion}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {preview ? (
              <CanvasHistoryPreview
                board={board}
                versionId={preview}
                disabled={blocked || Boolean(draft) || Boolean(name.trim())}
                onPlan={onPlan}
                onClose={() => setPreview(null)}
              />
            ) : null}
          </>
        ) : null}
      </section>
      <CanvasQuickTimer
        open={quickTimerOpen}
        onClose={() => onCloseQuickTimer?.()}
        returnFocusRef={quickTimerReturnFocusRef}
      >
        {notices}
        {timerControls}
      </CanvasQuickTimer>
    </>
  );
}
