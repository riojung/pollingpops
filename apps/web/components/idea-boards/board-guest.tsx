"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { IdeaBoardGuestView, IdeaBoardPublicInfo } from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import {
  fetchGuestIdeaBoard,
  fetchPublicIdeaBoard,
  ideaBoardCredential,
  joinIdeaBoard,
  submitBoardIdea,
  submitBoardVotes,
} from "../../lib/idea-board-client";
import { clientUuid } from "../../lib/uuid";
import { formatDateTime } from "../../lib/i18n/format";
import { Brand } from "../brand";
import { useLocale } from "../locale-provider";
import { IdeaBoardIdeas } from "./idea-list";
import { emptyIdeaDraft, IdeaComposer, type IdeaDraft } from "./idea-composer";
import { IdeaContent } from "./idea-content";
import styles from "./boards.module.css";

type IdeaIntent = {
  kind: "idea";
  input: Parameters<typeof submitBoardIdea>[2];
};
type VoteIntent = {
  kind: "votes";
  input: { schemaVersion: 1; idempotencyKey: string; expectedRevision: number; ideaIds: string[] };
};

export function BoardGuest({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const [info, setInfo] = useState<IdeaBoardPublicInfo | null>(null);
  const [guest, setGuest] = useState<IdeaBoardGuestView | null>(null);
  const [alias, setAlias] = useState("");
  const [draft, setDraft] = useState<IdeaDraft>(emptyIdeaDraft);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<
    "boards.error" | "boards.unavailable" | "boards.storageError" | null
  >(null);
  const [notice, setNotice] = useState<"boards.submitted" | null>(null);
  const controller = useRef<AbortController | null>(null);
  const token = useRef<string | null>(null);
  const pending = useRef<IdeaIntent | VoteIntent | null>(null);
  const inFlight = useRef(false);

  function accept(value: IdeaBoardGuestView) {
    setGuest((previous) =>
      previous &&
      (previous.revision > value.revision || previous.board.revision > value.board.revision)
        ? previous
        : value,
    );
    if (value.revision > 0) setSelected(value.votedIdeaIds);
  }

  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      token.current = ideaBoardCredential(id);
    } catch {
      setError("boards.storageError");
    }
    async function poll() {
      try {
        const publicInfo = await fetchPublicIdeaBoard(id, active.signal);
        if (active.signal.aborted) return;
        setInfo(publicInfo);
        if (token.current) {
          try {
            const value = await fetchGuestIdeaBoard(id, token.current, active.signal);
            if (!active.signal.aborted) accept(value);
          } catch (caught) {
            if (!(caught instanceof ApiClientError && [401, 404].includes(caught.status)))
              throw caught;
            if (!active.signal.aborted) setGuest(null);
          }
        }
        if (!active.signal.aborted) timer = setTimeout(() => void poll(), 5_000);
      } catch (caught) {
        if (active.signal.aborted) return;
        const unavailable = caught instanceof ApiClientError && [404, 410].includes(caught.status);
        setError(unavailable ? "boards.unavailable" : "boards.error");
        if (unavailable) {
          setInfo(null);
          setGuest(null);
          setDraft(emptyIdeaDraft());
          setUploading(false);
          pending.current = null;
        } else timer = setTimeout(() => void poll(), 5_000);
      } finally {
        if (!active.signal.aborted) setLoading(false);
      }
    }
    void poll();
    return () => {
      active.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!info || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      try {
        token.current = ideaBoardCredential(id, true);
      } catch {
        setError("boards.storageError");
        return;
      }
      const value = await joinIdeaBoard(
        id,
        token.current!,
        info.identityMode === "alias" ? alias.trim() : undefined,
        controller.current?.signal,
      );
      if (!controller.current?.signal.aborted) accept(value);
    } catch (caught) {
      if (!controller.current?.signal.aborted) {
        const unavailable = caught instanceof ApiClientError && [404, 410].includes(caught.status);
        if (unavailable) {
          setInfo(null);
          setGuest(null);
          setDraft(emptyIdeaDraft());
          setUploading(false);
          pending.current = null;
        }
        setError(unavailable ? "boards.unavailable" : "boards.error");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function execute() {
    if (!pending.current || !token.current || inFlight.current) return;
    const operation = pending.current;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const value =
        operation.kind === "idea"
          ? await submitBoardIdea(id, token.current, operation.input, controller.current?.signal)
          : await submitBoardVotes(id, token.current, operation.input, controller.current?.signal);
      if (controller.current?.signal.aborted) return;
      accept(value);
      pending.current = null;
      if (operation.kind === "idea") {
        setDraft(emptyIdeaDraft());
        setNotice("boards.submitted");
      }
    } catch (caught) {
      if (controller.current?.signal.aborted) return;
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pending.current = null;
      setError("boards.error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function submitIdea() {
    if (!guest || guest.board.status !== "collecting" || uploading || !draft.body.trim()) return;
    try {
      if (!pending.current)
        pending.current = {
          kind: "idea",
          input: {
            schemaVersion: 1,
            idempotencyKey: clientUuid(),
            body: draft.body.trim(),
            ...(draft.attachments.length
              ? { attachments: draft.attachments.map((item) => ({ ...item })) }
              : {}),
            ...(draft.links.length ? { links: draft.links.map((item) => ({ ...item })) } : {}),
            ...(draft.sketch ? { sketch: structuredClone(draft.sketch) } : {}),
          },
        };
    } catch {
      setError("boards.error");
      return;
    }
    void execute();
  }
  function submitVotes(event: FormEvent) {
    event.preventDefault();
    if (!guest || !selected.length) return;
    try {
      if (!pending.current)
        pending.current = {
          kind: "votes",
          input: {
            schemaVersion: 1,
            idempotencyKey: clientUuid(),
            expectedRevision: guest.revision,
            ideaIds: [...selected],
          },
        };
    } catch {
      setError("boards.error");
      return;
    }
    void execute();
  }
  async function refresh() {
    if (pending.current) return execute();
    setError(null);
    setLoading(true);
    try {
      const value = await fetchPublicIdeaBoard(id, controller.current?.signal);
      if (controller.current?.signal.aborted) return;
      setInfo(value);
      if (token.current) {
        const current = await fetchGuestIdeaBoard(id, token.current, controller.current?.signal);
        if (!controller.current?.signal.aborted) accept(current);
      }
    } catch (caught) {
      if (!controller.current?.signal.aborted) {
        const unavailable = caught instanceof ApiClientError && [404, 410].includes(caught.status);
        if (unavailable) {
          setInfo(null);
          setGuest(null);
          setDraft(emptyIdeaDraft());
          setUploading(false);
          pending.current = null;
        }
        setError(unavailable ? "boards.unavailable" : "boards.error");
      }
    } finally {
      setLoading(false);
    }
  }
  const board = guest?.board ?? info;
  const locked = busy || uploading || pending.current !== null;
  return (
    <main className={styles.page} lang={locale}>
      <Brand />
      <div className={styles.heading}>
        <h1 lang={board ? "" : undefined} dir="auto">
          {board?.title ?? t("boards.title")}
        </h1>
        <button
          type="button"
          className="button-quiet"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {t("boards.refresh")}
        </button>
      </div>
      {board?.description ? (
        <p className={styles.body} lang="" dir="auto">
          {board.description}
        </p>
      ) : null}
      <p>{t("boards.disclosure")}</p>
      {loading ? <p role="status">{t("boards.loading")}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button
            type="button"
            className="button-quiet"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {t("boards.retry")}
          </button>
        </p>
      ) : null}
      <p role="status" aria-live="polite">
        {notice ? t(notice) : ""}
      </p>
      {board ? (
        <>
          <p className={styles.status}>{t(`boards.${board.status}`)}</p>
          <p>{t("boards.expiry", { date: formatDateTime(locale, board.closesAt) })}</p>
        </>
      ) : null}
      {!guest && info && info.status !== "draft" ? (
        <section className={styles.panel}>
          <form className={styles.form} onSubmit={(event) => void join(event)}>
            {info.identityMode === "alias" ? (
              <>
                <label>
                  {t("boards.nickname")}
                  <input
                    required
                    maxLength={40}
                    value={alias}
                    disabled={busy}
                    onChange={(event) => setAlias(event.target.value)}
                  />
                </label>
                <p>{t("boards.nicknameNote")}</p>
              </>
            ) : (
              <p>{t("boards.anonymousNote")}</p>
            )}
            <button
              className="button"
              type="submit"
              disabled={busy || (info.identityMode === "alias" && !alias.trim())}
            >
              {t("boards.join")}
            </button>
          </form>
        </section>
      ) : null}
      {board?.status === "draft" ? <p>{t("boards.notOpen")}</p> : null}
      {guest ? (
        <>
          {guest.board.status === "collecting" ? (
            <section className={styles.panel}>
              <h2>{t("boards.submitIdea")}</h2>
              <p>{t("boards.ideaLimit")}</p>
              <IdeaComposer
                boardId={id}
                guestToken={token.current!}
                value={draft}
                disabled={locked || guest.ownIdeas.length >= 10 || guest.board.totalIdeas >= 200}
                imagesAvailable={guest.imageUploadsAvailable}
                onChange={setDraft}
                onSubmit={submitIdea}
                onUploading={setUploading}
              />
            </section>
          ) : null}
          {guest.ownIdeas.length ? (
            <section className={styles.panel}>
              <h2>{t("boards.own")}</h2>
              <ul className={styles.list}>
                {guest.ownIdeas.map((idea) => (
                  <li className={styles.idea} key={idea.id}>
                    <IdeaContent boardId={id} idea={idea} guestToken={token.current ?? undefined} />
                    <p>
                      {t(
                        idea.status === "pending"
                          ? "boards.pending"
                          : idea.status === "removed"
                            ? "boards.removed"
                            : "boards.approved",
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className={styles.panel}>
            <h2>{t("boards.approved")}</h2>
            {guest.board.status === "collecting" && !guest.board.ideasVisible ? (
              <p>{t("boards.hidden")}</p>
            ) : null}
            {!guest.board.countsVisible ? <p>{t("boards.countsHidden")}</p> : null}
            {guest.revision > 0 ? (
              <p className={styles.receipt} role="status">
                {t("boards.voteReceipt")}
              </p>
            ) : null}
            {guest.board.status === "voting" && guest.revision === 0 ? (
              <form className={styles.form} onSubmit={submitVotes}>
                <p>{t("boards.select", { budget: guest.board.voteBudget })}</p>
                <IdeaBoardIdeas
                  board={guest.board}
                  guestToken={token.current ?? undefined}
                  selected={selected}
                  disabled={locked}
                  onSelect={(ideaId, checked) =>
                    setSelected((current) =>
                      checked ? [...current, ideaId] : current.filter((value) => value !== ideaId),
                    )
                  }
                />
                <p role="status">
                  {t("boards.selection", {
                    count: selected.length,
                    budget: guest.board.voteBudget,
                  })}
                </p>
                <button className="button" type="submit" disabled={locked || !selected.length}>
                  {t("boards.submitVotes")}
                </button>
              </form>
            ) : (
              <IdeaBoardIdeas board={guest.board} guestToken={token.current ?? undefined} />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
