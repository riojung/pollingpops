"use client";

import { useRef, useState, type FormEvent } from "react";
import type {
  CanvasBoardMutation,
  CanvasBoardView,
  IdeaBoardHostCommand,
} from "@openround/contracts";
import { apiFetch, ApiClientError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { IdeaContent } from "../idea-boards/idea-content";
import { canvasIntent, writeCanvas } from "./canvas-client";
import styles from "./workshop-controls.module.css";

export function CanvasWorkshopControls({
  board,
  onRefresh,
  disabled = false,
}: {
  board: CanvasBoardView;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const source = board.sourceBoard;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  const pending = useRef<{ boardId: string; operation: CanvasBoardMutation } | null>(null);
  const inFlight = useRef(false);
  if (!source || !board.capabilities.facilitate) return null;
  const collecting = source.status === "collecting";
  const locked = busy || disabled || pending.current !== null;

  async function openOriginal() {
    if (!source || locked || board.role !== "owner") return;
    setBusy(true);
    setProblem(false);
    setConflict(false);
    try {
      await apiFetch(`/v1/workspaces/${board.workspaceId}/select`, { method: "POST", body: "{}" });
      window.location.assign(`/boards/${source.id}`);
    } catch {
      setProblem(true);
      setBusy(false);
    }
  }

  async function perform(command?: IdeaBoardHostCommand) {
    if (!source || disabled || inFlight.current) return;
    if (pending.current?.boardId !== board.id) pending.current = null;
    if (!pending.current && command)
      pending.current = {
        boardId: board.id,
        operation: canvasIntent({ type: "workshop", expectedRevision: source.revision, command }),
      };
    const attempt = pending.current;
    if (!attempt) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(false);
    setConflict(false);
    try {
      await writeCanvas(board.id, attempt.operation);
      pending.current = null;
      setGroupName("");
      await onRefresh();
    } catch (error) {
      setProblem(true);
      const stale = error instanceof ApiClientError && error.status === 409;
      setConflict(stale);
      if (error instanceof ApiClientError && error.status < 500 && error.status !== 429)
        pending.current = null;
      await onRefresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function addGroup(event: FormEvent) {
    event.preventDefault();
    if (groupName.trim())
      void perform({ type: "group.create", id: clientUuid(), name: groupName.trim() });
  }
  return (
    <section className={styles.controls} aria-label={t("canvas.workshop.controls")}>
      <h2>{t("canvas.workshop.controls")}</h2>
      {board.role === "owner" ? (
        <p>
          <button
            type="button"
            className="button-quiet"
            disabled={locked}
            onClick={() => void openOriginal()}
          >
            {t("canvas.workshop.switchOriginal")}
          </button>
        </p>
      ) : null}
      <p className={styles.status}>{t(`boards.${source.status}`)}</p>
      {problem ? (
        <div className="error" role="alert">
          <p>{t(conflict ? "canvas.conflictHelp" : "boards.error")}</p>
          {pending.current ? (
            <button
              className="button-quiet"
              disabled={busy || disabled}
              type="button"
              onClick={() => void perform()}
            >
              {t("boards.retry")}
            </button>
          ) : null}
          <button
            className="button-quiet"
            disabled={busy}
            type="button"
            onClick={() => {
              pending.current = null;
              setProblem(false);
              setConflict(false);
              onRefresh();
            }}
          >
            {t("boards.refresh")}
          </button>
        </div>
      ) : null}
      <div className={styles.actions}>
        {source.status === "draft" ? (
          <button
            className="button"
            type="button"
            disabled={locked}
            onClick={() => void perform({ type: "collect" })}
          >
            {t("boards.collect")}
          </button>
        ) : null}
        {collecting ? (
          <button
            className="button"
            type="button"
            disabled={locked}
            onClick={() => void perform({ type: "start_voting" })}
          >
            {t("boards.startVoting")}
          </button>
        ) : null}
        {source.status !== "closed" ? (
          <button
            className="button-quiet"
            type="button"
            disabled={locked}
            onClick={() => void perform({ type: "close" })}
          >
            {t("boards.close")}
          </button>
        ) : null}
      </div>
      {collecting ? (
        <>
          <p>{t("boards.freezeNote")}</p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={source.ideasVisible}
              disabled={locked}
              onChange={(event) =>
                void perform({ type: "visibility", visible: event.target.checked })
              }
            />
            {t("boards.visible")}
          </label>
          <section>
            <h3>{t("boards.pending")}</h3>
            {source.ideas.filter((idea) => idea.status === "pending").length === 0 ? (
              <p>{t("boards.noIdeas")}</p>
            ) : null}
            <ul className={styles.list}>
              {source.ideas
                .filter((idea) => idea.status === "pending")
                .map((idea) => (
                  <li key={idea.id}>
                    <IdeaContent boardId={source.id} canvasId={board.id} idea={idea} />
                    {idea.alias ? (
                      <p lang="" dir="auto">
                        {idea.alias}
                      </p>
                    ) : null}
                    <div className={styles.actions}>
                      <button
                        className="button"
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          void perform({ type: "moderate", ideaId: idea.id, status: "approved" })
                        }
                      >
                        {t("boards.approve")}
                      </button>
                      <button
                        className="button-quiet"
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          void perform({ type: "moderate", ideaId: idea.id, status: "removed" })
                        }
                      >
                        {t("boards.remove")}
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
            <p>{t("boards.removeNote")}</p>
          </section>
          <section>
            <h3>{t("boards.groups")}</h3>
            <form className={styles.form} onSubmit={addGroup}>
              <label>
                {t("boards.groupName")}
                <input
                  className="input"
                  required
                  maxLength={80}
                  value={groupName}
                  disabled={locked || source.groups.length >= 20}
                  onChange={(event) => setGroupName(event.target.value)}
                />
              </label>
              <button
                className="button-quiet"
                type="submit"
                disabled={locked || !groupName.trim() || source.groups.length >= 20}
              >
                {t("boards.addGroup")}
              </button>
            </form>
            <ul className={styles.list}>
              {source.groups.map((group) => (
                <li key={group.id}>
                  <label>
                    {t("boards.groupName")}
                    <input
                      className="input"
                      maxLength={80}
                      disabled={locked}
                      value={renames[group.id] ?? group.name}
                      onChange={(event) =>
                        setRenames((current) => ({ ...current, [group.id]: event.target.value }))
                      }
                    />
                  </label>
                  <div className={styles.actions}>
                    <button
                      className="button-quiet"
                      type="button"
                      disabled={
                        locked ||
                        !renames[group.id]?.trim() ||
                        renames[group.id]?.trim() === group.name
                      }
                      onClick={() =>
                        void perform({
                          type: "group.rename",
                          groupId: group.id,
                          name: renames[group.id]!.trim(),
                        })
                      }
                    >
                      {t("canvas.workshop.rename")}
                    </button>
                    <button
                      className="button-quiet"
                      type="button"
                      disabled={locked}
                      aria-label={`${t("boards.deleteGroup")}: ${group.name}`}
                      onClick={() => void perform({ type: "group.delete", groupId: group.id })}
                    >
                      {t("boards.deleteGroup")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      <section>
        <h3>{t("boards.approved")}</h3>
        <ul className={styles.list}>
          {source.ideas
            .filter((idea) => idea.status === "approved")
            .map((idea, index) => (
              <li key={idea.id}>
                <IdeaContent boardId={source.id} canvasId={board.id} idea={idea} />
                {collecting ? (
                  <>
                    <label>
                      {t("boards.assignGroup", { number: index + 1 })}
                      <select
                        className="input"
                        disabled={locked}
                        value={idea.groupId ?? ""}
                        onChange={(event) =>
                          void perform({
                            type: "idea.group",
                            ideaId: idea.id,
                            groupId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">{t("boards.ungrouped")}</option>
                        {source.groups.map((group) => (
                          <option value={group.id} key={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button-quiet"
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        void perform({ type: "moderate", ideaId: idea.id, status: "removed" })
                      }
                    >
                      {t("boards.remove")}
                    </button>
                  </>
                ) : null}
                {source.countsVisible && idea.voteCount !== null ? (
                  <p>{t("boards.voteCount", { count: idea.voteCount })}</p>
                ) : null}
              </li>
            ))}
        </ul>
        {!source.countsVisible ? <p>{t("boards.countsHidden")}</p> : null}
      </section>
    </section>
  );
}
