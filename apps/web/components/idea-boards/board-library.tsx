"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  IdeaBoardViewSchema,
  type IdeaBoardCreate,
  type IdeaBoardView,
} from "@openround/contracts";
import { apiFetch, ApiClientError } from "../../lib/api";
import { createIdeaBoard, ideaBoardCreateIntent } from "../../lib/idea-board-client";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "../workspace/workspace-provider";
import { WorkspaceShell } from "../workspace/workspace-shell";
import styles from "./boards.module.css";

export function BoardLibrary() {
  const { t } = useLocale();
  const router = useRouter();
  const { creator, canEdit, productFeatures } = useWorkspace();
  const workspaceId = creator?.workspaceId;
  const [loaded, setLoaded] = useState<{
    workspaceId: string;
    boards: IdeaBoardView[];
    nextCursor: string | null;
  } | null>(null);
  const [input, setInput] = useState<IdeaBoardCreate>({
    schemaVersion: 1,
    title: "",
    description: "",
    identityMode: "anonymous",
    moderationEnabled: true,
    voteBudget: 3,
    windowDays: 7,
    ideasVisible: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<ReturnType<typeof ideaBoardCreateIntent> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const scope = useRef(workspaceId);
  scope.current = workspaceId;
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    setBusy(false);
    setError(false);
    if (workspaceId) {
      void apiFetch<{ boards: unknown[]; nextCursor: string | null }>("/v1/idea-boards?limit=50", {
        signal: active.signal,
        cache: "no-store",
      })
        .then((result) => {
          if (!active.signal.aborted)
            setLoaded({
              workspaceId,
              boards: result.boards.map((board) => IdeaBoardViewSchema.parse(board)),
              nextCursor: result.nextCursor,
            });
        })
        .catch(() => {
          if (!active.signal.aborted) setError(true);
        });
    }
    return () => active.abort();
  }, [workspaceId, refresh]);
  useEffect(() => {
    pending.current = null;
  }, [workspaceId]);
  const current = loaded?.workspaceId === workspaceId ? loaded : null;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !workspaceId || !canEdit || !productFeatures?.ideaBoards) return;
    try {
      pending.current ??= ideaBoardCreateIntent(input);
    } catch {
      setError(true);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const board = await createIdeaBoard(pending.current, controller.current?.signal);
      if (scope.current === workspaceId && !controller.current?.signal.aborted) {
        pending.current = null;
        router.push(`/boards/${board.id}`);
      }
    } catch (caught) {
      if (!controller.current?.signal.aborted && scope.current === workspaceId) {
        if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
          pending.current = null;
        setError(true);
      }
    } finally {
      inFlight.current = false;
      if (scope.current === workspaceId) setBusy(false);
    }
  }
  async function more() {
    if (!current?.nextCursor || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await apiFetch<{ boards: unknown[]; nextCursor: string | null }>(
        `/v1/idea-boards?limit=50&cursor=${encodeURIComponent(current.nextCursor)}`,
        { signal: controller.current?.signal, cache: "no-store" },
      );
      if (scope.current === workspaceId && !controller.current?.signal.aborted)
        setLoaded({
          workspaceId: workspaceId!,
          boards: [
            ...current.boards,
            ...result.boards.map((board) => IdeaBoardViewSchema.parse(board)),
          ],
          nextCursor: result.nextCursor,
        });
    } catch {
      if (!controller.current?.signal.aborted) setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <WorkspaceShell
      title={t("boards.title")}
      description={t("boards.description")}
      requireBeta={false}
      translationLevel="full"
    >
      {error ? (
        <p className="error" role="alert">
          {t("boards.error")}{" "}
          <button
            type="button"
            className="button-quiet"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("boards.refresh")}
          </button>
        </p>
      ) : null}
      <div className={styles.layout}>
        <section className={styles.panel}>
          <h2>{t("boards.title")}</h2>
          {!current && !error ? <p role="status">{t("boards.loading")}</p> : null}
          {current?.boards.length === 0 ? <p>{t("boards.empty")}</p> : null}
          <ul className={styles.list}>
            {current?.boards.map((board) => (
              <li className={styles.idea} key={board.id}>
                <Link href={`/boards/${board.id}`}>
                  <strong lang="" dir="auto">
                    {board.title}
                  </strong>
                </Link>
                <p>{t(`boards.${board.status}`)}</p>
                <p className={styles.muted}>{t("boards.richTypes")}</p>
              </li>
            ))}
          </ul>
          {current?.nextCursor ? (
            <button
              type="button"
              className="button-quiet"
              disabled={busy}
              onClick={() => void more()}
            >
              {t("boards.more")}
            </button>
          ) : null}
        </section>
        <section className={styles.panel}>
          <h2>{t("boards.create")}</h2>
          {!productFeatures?.ideaBoards ? <p>{t("boards.paused")}</p> : null}
          {canEdit && productFeatures?.ideaBoards ? (
            <form className={styles.form} onSubmit={(event) => void create(event)}>
              <fieldset disabled={busy || pending.current !== null} className={styles.form}>
                <label>
                  {t("boards.boardTitle")}
                  <input
                    required
                    maxLength={160}
                    value={input.title}
                    onChange={(event) => setInput({ ...input, title: event.target.value })}
                  />
                </label>
                <label>
                  {t("boards.prompt")}
                  <textarea
                    maxLength={2000}
                    value={input.description}
                    onChange={(event) => setInput({ ...input, description: event.target.value })}
                  />
                </label>
                <div className={styles.field}>
                  <label htmlFor="board-identity-mode">{t("boards.identity")}</label>
                  <select
                    id="board-identity-mode"
                    value={input.identityMode}
                    onChange={(event) =>
                      setInput({
                        ...input,
                        identityMode: event.target.value as "anonymous" | "alias",
                      })
                    }
                  >
                    <option value="anonymous">{t("boards.anonymous")}</option>
                    <option value="alias">{t("boards.alias")}</option>
                  </select>
                </div>
                <p className={styles.muted}>{t("boards.identityNote")}</p>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={input.moderationEnabled}
                    onChange={(event) =>
                      setInput({ ...input, moderationEnabled: event.target.checked })
                    }
                  />
                  {t("boards.moderation")}
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={input.ideasVisible}
                    onChange={(event) => setInput({ ...input, ideasVisible: event.target.checked })}
                  />
                  {t("boards.visible")}
                </label>
                <label>
                  {t("boards.budget")}
                  <input
                    type="number"
                    required
                    min={1}
                    max={10}
                    value={input.voteBudget}
                    onChange={(event) =>
                      setInput({ ...input, voteBudget: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  {t("boards.days")}
                  <input
                    type="number"
                    required
                    min={1}
                    max={30}
                    value={input.windowDays}
                    onChange={(event) =>
                      setInput({ ...input, windowDays: Number(event.target.value) })
                    }
                  />
                </label>
              </fieldset>
              <button className="button" type="submit" disabled={busy || !input.title.trim()}>
                {t(pending.current ? "boards.retry" : "boards.create")}
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </WorkspaceShell>
  );
}
