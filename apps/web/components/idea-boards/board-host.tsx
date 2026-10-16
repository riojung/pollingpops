"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { IdeaBoardHostCommand, IdeaBoardView } from "@openround/contracts";
import { apiFetch, ApiClientError } from "../../lib/api";
import {
  commandIdeaBoard,
  fetchIdeaBoard,
  ideaBoardCommandIntent,
  ideaBoardPath,
} from "../../lib/idea-board-client";
import { clientUuid } from "../../lib/uuid";
import { formatDateTime } from "../../lib/i18n/format";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "../workspace/workspace-provider";
import { WorkspaceShell } from "../workspace/workspace-shell";
import { IdeaBoardIdeas } from "./idea-list";
import styles from "./boards.module.css";

function BoardDeletionDialog({
  busy,
  onCancel,
  onDelete,
}: {
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      role="alertdialog"
      aria-label={t("boards.delete")}
      aria-describedby="board-delete-prompt"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <p id="board-delete-prompt">{t("boards.deleteConfirm")}</p>
      <div className={styles.actions}>
        <button
          ref={cancel}
          type="button"
          className="button-quiet"
          disabled={busy}
          onClick={onCancel}
        >
          {t("boards.cancel")}
        </button>
        <button type="button" className="button" disabled={busy} onClick={onDelete}>
          {t("boards.delete")}
        </button>
      </div>
    </dialog>
  );
}

export function BoardHost({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const { creator, canEdit } = useWorkspace();
  const router = useRouter();
  const workspaceId = creator?.workspaceId;
  const [loaded, setLoaded] = useState<{ workspaceId: string; board: IdeaBoardView } | null>(null);
  const [error, setError] = useState<false | "boards.error" | "boards.unavailable">(false);
  const [notice, setNotice] = useState<
    "boards.saved" | "boards.copied" | "boards.copyFailed" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [link, setLink] = useState("");
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<ReturnType<typeof ideaBoardCommandIntent> | null>(null);
  const needsRebase = useRef(false);
  const inFlight = useRef(false);
  const scope = useRef(workspaceId);
  scope.current = workspaceId;
  const board = loaded && loaded.workspaceId === workspaceId ? loaded.board : null;

  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLink(`${window.location.origin}/board/${id}`);
    pending.current = null;
    needsRebase.current = false;
    setBusy(false);
    setError(false);
    async function poll() {
      if (!workspaceId || active.signal.aborted) return;
      try {
        const value = await fetchIdeaBoard(id, active.signal);
        if (active.signal.aborted) return;
        setLoaded((previous) =>
          previous?.workspaceId === workspaceId && previous.board.revision > value.revision
            ? previous
            : { workspaceId, board: value },
        );
        timer = setTimeout(() => void poll(), 5_000);
      } catch (caught) {
        if (!active.signal.aborted) {
          if (caught instanceof ApiClientError && [404, 410].includes(caught.status))
            setLoaded(null);
          setError("boards.error");
          timer = setTimeout(() => void poll(), 5_000);
        }
      }
    }
    void poll();
    return () => {
      active.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, workspaceId]);

  async function refresh() {
    try {
      const value = await fetchIdeaBoard(id, controller.current?.signal);
      if (workspaceId && scope.current === workspaceId && !controller.current?.signal.aborted) {
        setLoaded((previous) =>
          previous?.workspaceId === workspaceId && previous.board.revision > value.revision
            ? previous
            : { workspaceId, board: value },
        );
        setError(false);
      }
    } catch (caught) {
      if (!controller.current?.signal.aborted) {
        const unavailable = caught instanceof ApiClientError && [404, 410].includes(caught.status);
        if (unavailable) setLoaded(null);
        setError(unavailable ? "boards.unavailable" : "boards.error");
      }
    }
  }
  async function command(value?: IdeaBoardHostCommand) {
    if (!board || !canEdit || !workspaceId || inFlight.current) return;
    try {
      if (pending.current && needsRebase.current) {
        pending.current = ideaBoardCommandIntent(board.revision, pending.current.command);
        needsRebase.current = false;
      }
      if (!pending.current && value)
        pending.current = ideaBoardCommandIntent(board.revision, value);
    } catch {
      setError("boards.error");
      return;
    }
    if (!pending.current) return;
    const operation = pending.current;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    setNotice(null);
    try {
      const result = await commandIdeaBoard(id, operation, controller.current?.signal);
      if (scope.current !== workspaceId || controller.current?.signal.aborted) return;
      pending.current = null;
      needsRebase.current = false;
      setLoaded((previous) =>
        previous?.workspaceId === workspaceId && previous.board.revision > result.revision
          ? previous
          : { workspaceId, board: result },
      );
      setGroupName("");
      setNotice("boards.saved");
    } catch (caught) {
      if (scope.current !== workspaceId || controller.current?.signal.aborted) return;
      if (caught instanceof ApiClientError && caught.code === "STALE_DRAFT")
        needsRebase.current = true;
      else if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pending.current = null;
      await refresh();
      setError("boards.error");
    } finally {
      inFlight.current = false;
      if (scope.current === workspaceId) setBusy(false);
    }
  }
  async function removeBoard() {
    if (creator?.role !== "owner" || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      await apiFetch(ideaBoardPath(id), { method: "DELETE", signal: controller.current?.signal });
      if (!controller.current?.signal.aborted && scope.current === workspaceId)
        router.push("/boards");
    } catch {
      if (!controller.current?.signal.aborted) setError("boards.error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setNotice("boards.copied");
    } catch {
      setNotice("boards.copyFailed");
    }
  }
  function createGroup(event: FormEvent) {
    event.preventDefault();
    try {
      void command({ type: "group.create", id: clientUuid(), name: groupName.trim() });
    } catch {
      setError("boards.error");
    }
  }
  const collecting = board?.status === "collecting";
  const locked = busy || pending.current !== null;
  return (
    <WorkspaceShell
      title={board?.title ?? t("boards.title")}
      titleLanguage={board ? "" : undefined}
      description={board?.description}
      requireBeta={false}
      translationLevel="full"
      actions={
        <Link className="button-quiet" href="/boards">
          {t("boards.back")}
        </Link>
      }
    >
      {error ? (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => (pending.current ? void command() : void refresh())}
          >
            {t("boards.retry")}
          </button>
        </p>
      ) : null}
      <p role="status" aria-live="polite">
        {notice ? t(notice) : ""}
      </p>
      {!board && !error ? <p role="status">{t("boards.loading")}</p> : null}
      {board ? (
        <>
          <section className={styles.panel}>
            <p className={styles.status}>{t(`boards.${board.status}`)}</p>
            <p>{t("boards.expiry", { date: formatDateTime(locale, board.closesAt) })}</p>
            <p>{t("boards.disclosure")}</p>
            <label className={styles.field}>
              {t("boards.link")}
              <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className={styles.actions}>
              <button type="button" className="button-quiet" onClick={() => void copy()}>
                {t("boards.copy")}
              </button>
              <button
                type="button"
                className="button-quiet"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {t("boards.refresh")}
              </button>
              {canEdit && board.status === "draft" ? (
                <button
                  type="button"
                  className="button"
                  disabled={locked}
                  onClick={() => void command({ type: "collect" })}
                >
                  {t("boards.collect")}
                </button>
              ) : null}
              {canEdit && collecting ? (
                <button
                  type="button"
                  className="button"
                  disabled={locked || !board.ideas.some((idea) => idea.status === "approved")}
                  onClick={() => void command({ type: "start_voting" })}
                >
                  {t("boards.startVoting")}
                </button>
              ) : null}
              {canEdit && board.status !== "closed" ? (
                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked}
                  onClick={() => void command({ type: "close" })}
                >
                  {t("boards.close")}
                </button>
              ) : null}
            </div>
            {collecting ? <p>{t("boards.freezeNote")}</p> : null}
            {canEdit && collecting ? (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={board.ideasVisible}
                  disabled={locked}
                  onChange={(event) =>
                    void command({ type: "visibility", visible: event.target.checked })
                  }
                />
                {t("boards.visible")}
              </label>
            ) : null}
            {!board.countsVisible ? (
              <p className={styles.muted}>{t("boards.countsHidden")}</p>
            ) : null}
          </section>
          {canEdit && collecting ? (
            <div className={styles.layout}>
              <section className={styles.panel}>
                <h2>{t("boards.pending")}</h2>
                <p className={styles.muted}>{t("boards.removeNote")}</p>
                <ul className={styles.list}>
                  {board.ideas
                    .filter((idea) => idea.status === "pending")
                    .map((idea) => (
                      <li className={styles.idea} key={idea.id}>
                        <p className={styles.body} dir="auto" lang="">
                          {idea.body}
                        </p>
                        {idea.alias ? (
                          <p dir="auto" lang="">
                            {idea.alias}
                          </p>
                        ) : null}
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className="button"
                            disabled={locked}
                            onClick={() =>
                              void command({
                                type: "moderate",
                                ideaId: idea.id,
                                status: "approved",
                              })
                            }
                          >
                            {t("boards.approve")}
                          </button>
                          <button
                            type="button"
                            className="button-quiet"
                            disabled={locked}
                            onClick={() =>
                              void command({ type: "moderate", ideaId: idea.id, status: "removed" })
                            }
                          >
                            {t("boards.remove")}
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
                {!board.ideas.some((idea) => idea.status === "pending") ? (
                  <p>{t("boards.noIdeas")}</p>
                ) : null}
              </section>
              <section className={styles.panel}>
                <h2>{t("boards.groups")}</h2>
                <form className={styles.form} onSubmit={createGroup}>
                  <label>
                    {t("boards.groupName")}
                    <input
                      maxLength={80}
                      required
                      disabled={locked || board.groups.length >= 20}
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className="button-quiet"
                    disabled={locked || !groupName.trim() || board.groups.length >= 20}
                  >
                    {t("boards.addGroup")}
                  </button>
                </form>
                <ul className={styles.list}>
                  {board.groups.map((group) => (
                    <li key={group.id}>
                      <span lang="" dir="auto">
                        {group.name}
                      </span>{" "}
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={locked}
                        aria-label={`${t("boards.deleteGroup")}: ${group.name}`}
                        onClick={() => void command({ type: "group.delete", groupId: group.id })}
                      >
                        {t("boards.deleteGroup")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}
          <section className={styles.panel}>
            <h2>{t("boards.approved")}</h2>
            {canEdit && collecting ? (
              <ul className={styles.list}>
                {board.ideas
                  .filter((idea) => idea.status === "approved")
                  .map((idea, index) => (
                    <li className={styles.idea} key={idea.id}>
                      <p className={styles.body} lang="" dir="auto">
                        {idea.body}
                      </p>
                      {idea.alias ? (
                        <p className={styles.muted} lang="" dir="auto">
                          {idea.alias}
                        </p>
                      ) : null}
                      <div className={styles.field}>
                        <label htmlFor={`board-group-${idea.id}`}>
                          {t("boards.assignGroup", { number: index + 1 })}
                        </label>
                        <select
                          id={`board-group-${idea.id}`}
                          value={idea.groupId ?? ""}
                          disabled={locked}
                          onChange={(event) =>
                            void command({
                              type: "idea.group",
                              ideaId: idea.id,
                              groupId: event.target.value || null,
                            })
                          }
                        >
                          <option value="">{t("boards.ungrouped")}</option>
                          {board.groups.map((group) => (
                            <option value={group.id} key={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={locked}
                        onClick={() =>
                          void command({ type: "moderate", ideaId: idea.id, status: "removed" })
                        }
                      >
                        {t("boards.remove")}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <IdeaBoardIdeas board={board} />
            )}
          </section>
          {creator?.role === "owner" ? (
            <section className={styles.panel}>
              {deleting ? (
                <BoardDeletionDialog
                  busy={busy}
                  onCancel={() => setDeleting(false)}
                  onDelete={() => void removeBoard()}
                />
              ) : (
                <button
                  type="button"
                  className="button-quiet"
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  {t("boards.delete")}
                </button>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </WorkspaceShell>
  );
}
