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
import { formatDateTime, formatNumber } from "../../lib/i18n/format";
import { Brand } from "../brand";
import { useLocale } from "../locale-provider";
import { IdeaBoardIdeas } from "./idea-list";
import { emptyIdeaDraft, IdeaComposer, type IdeaDraft } from "./idea-composer";
import { IdeaContent } from "./idea-content";
import styles from "./boards.module.css";
import { PublishedWorkshopCanvas } from "../canvas-boards/workshop-canvas-bridge";
import { CanvasToolIcon } from "../canvas-boards/canvas-tool-icon";
import { guidedWorkshopCopy } from "../../lib/i18n/guided-workshop-messages";
import guestStyles from "./board-guest.module.css";
import { WorkshopRoundHistory } from "./workshop-lifecycle";

type IdeaIntent = {
  kind: "idea";
  input: Parameters<typeof submitBoardIdea>[2];
};
type VoteIntent = {
  kind: "votes";
  input: Parameters<typeof submitBoardVotes>[2];
};

export function BoardGuest({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const copy = guidedWorkshopCopy(locale);
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
  const latestGuest = useRef<IdeaBoardGuestView | null>(null);
  const [hasCanvas, setHasCanvas] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const participation = useRef<HTMLElement>(null);
  const panelPreference = useRef<boolean | null>(null);
  const canvasAvailability = useRef(false);
  const focusPanelOnOpen = useRef(false);
  const panelId = `workshop-participation-${id}`;
  const canvasVisible = Boolean(guest && hasCanvas);

  function closePanel() {
    panelPreference.current = false;
    focusPanelOnOpen.current = false;
    setPanelOpen(false);
    panelTrigger.current?.focus();
  }
  function acceptCanvasAvailability(available: boolean) {
    const appeared = available && !canvasAvailability.current;
    canvasAvailability.current = available;
    if (appeared) {
      const focusedParticipation =
        typeof document !== "undefined" && participation.current?.contains(document.activeElement);
      const desktop =
        typeof window !== "undefined" &&
        (typeof window.matchMedia === "function"
          ? window.matchMedia("(min-width: 761px)").matches
          : window.innerWidth > 760);
      // Preserve ongoing intake when the first published snapshot arrives. Automatic
      // desktop expansion is a default only; an explicit collapse remains authoritative.
      if (focusedParticipation || (panelPreference.current === null && desktop)) setPanelOpen(true);
    }
    setHasCanvas(available);
  }
  useEffect(() => {
    if (!panelOpen || !canvasVisible || !focusPanelOnOpen.current) return;
    focusPanelOnOpen.current = false;
    if (!document.querySelector("dialog[open]")) panelHeading.current?.focus();
  }, [panelOpen, canvasVisible]);

  function accept(value: IdeaBoardGuestView) {
    const previous = latestGuest.current;
    if (
      previous &&
      (previous.board.roundNumber > value.board.roundNumber ||
        previous.revision > value.revision ||
        previous.board.revision > value.board.revision)
    )
      return false;
    const changedRound = previous && previous.board.roundNumber !== value.board.roundNumber;
    if (changedRound) {
      // Old receipts are fenced by round, while the private composer draft stays available
      // for a deliberate submission in the reopened collection.
      pending.current = null;
      setSelected([]);
      setError(null);
      setNotice(null);
    }
    latestGuest.current = value;
    setGuest(value);
    if (value.hasVoted) setSelected(value.votedIdeaIds);
    return true;
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
            if (!active.signal.aborted) {
              latestGuest.current = null;
              setGuest(null);
            }
          }
        }
        if (!active.signal.aborted) timer = setTimeout(() => void poll(), 5_000);
      } catch (caught) {
        if (active.signal.aborted) return;
        const unavailable = caught instanceof ApiClientError && [404, 410].includes(caught.status);
        setError(unavailable ? "boards.unavailable" : "boards.error");
        if (unavailable) {
          setInfo(null);
          latestGuest.current = null;
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
          latestGuest.current = null;
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
      const accepted = accept(value);
      const roundNumber = latestGuest.current?.board.roundNumber;
      if (
        pending.current !== operation ||
        value.board.roundNumber !== roundNumber ||
        (operation.input.roundNumber ?? 1) !== roundNumber
      )
        return;
      pending.current = null;
      if (operation.kind === "idea") {
        setDraft(emptyIdeaDraft());
        setNotice("boards.submitted");
      }
      // A newer poll can overtake a successful same-round receipt. Acknowledge that
      // exact intent without reapplying its stale snapshot, then reconcile the view.
      if (!accepted) await refresh();
    } catch (caught) {
      if (controller.current?.signal.aborted || pending.current !== operation) return;
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
            roundNumber: guest.board.roundNumber,
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
    if (!guest || guest.board.status !== "voting" || guest.hasVoted || !selected.length) return;
    try {
      if (!pending.current)
        pending.current = {
          kind: "votes",
          input: {
            schemaVersion: 1,
            idempotencyKey: clientUuid(),
            expectedRevision: guest.revision,
            roundNumber: guest.board.roundNumber,
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
          latestGuest.current = null;
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
  const participationPhase = t(
    guest?.board.status === "collecting"
      ? "boards.submitIdea"
      : guest?.board.status === "voting"
        ? "boards.voting"
        : "boards.approved",
  );
  const locked = busy || uploading || pending.current !== null;
  return (
    <main
      className={guestStyles.page}
      data-canvas={canvasVisible}
      lang={locale}
      aria-label={copy.participantWorkspace}
    >
      <header className={guestStyles.header}>
        <div className={guestStyles.brand}>
          <Brand />
        </div>
        <div className={guestStyles.identity}>
          <h1 lang={board ? "" : undefined} dir="auto">
            {board?.title ?? t("boards.title")}
          </h1>
          {board ? (
            <p>
              <span>{t(`boards.${board.status}`)}</span>
              <span>
                {copy.roundLabel.replace("{round}", formatNumber(locale, board.roundNumber))}
              </span>
            </p>
          ) : null}
        </div>
        <button
          className={guestStyles.iconButton}
          type="button"
          disabled={busy}
          aria-label={t("boards.refresh")}
          title={t("boards.refresh")}
          onClick={() => void refresh()}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M20 10a8 8 0 1 0-1 8M20 4v6h-6" />
          </svg>
        </button>
        {canvasVisible ? (
          <button
            ref={panelTrigger}
            className={guestStyles.panelTrigger}
            type="button"
            aria-label={`${copy.participantPanel} ${participationPhase} — ${panelOpen ? copy.closeParticipantPanel : copy.openParticipantPanel}`}
            aria-controls={panelId}
            aria-expanded={panelOpen}
            onClick={() => {
              if (panelOpen) closePanel();
              else {
                panelPreference.current = true;
                focusPanelOnOpen.current = true;
                setPanelOpen(true);
              }
            }}
          >
            <CanvasToolIcon name="facilitation" />
            <span>
              {copy.participantPanel}{" "}
              <small className={guestStyles.phaseLabel}>{participationPhase}</small>
            </span>
          </button>
        ) : null}
      </header>
      {loading ? (
        <p className={guestStyles.message} role="status">
          {t("boards.loading")}
        </p>
      ) : null}
      {error ? (
        <div className={guestStyles.error} role="alert">
          {t(error)}{" "}
          <button
            type="button"
            className="button-quiet"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {t("boards.retry")}
          </button>
        </div>
      ) : null}
      <p
        className={notice ? guestStyles.message : guestStyles.srOnly}
        role="status"
        aria-live="polite"
      >
        {notice ? t(notice) : ""}
      </p>
      <div className={guestStyles.workspace}>
        <div className={guestStyles.canvas} aria-label={copy.sharedCanvas}>
          {guest && token.current ? (
            <PublishedWorkshopCanvas
              sourceBoardId={id}
              token={token.current}
              onAvailabilityChange={acceptCanvasAvailability}
            />
          ) : null}
        </div>
        <aside
          ref={participation}
          id={panelId}
          className={guestStyles.participation}
          hidden={canvasVisible && !panelOpen}
          inert={canvasVisible && !panelOpen}
          aria-label={copy.participantPanel}
          onKeyDown={(event) => {
            if (
              event.key !== "Escape" ||
              event.nativeEvent.isComposing ||
              !canvasVisible ||
              !panelOpen
            )
              return;
            const target = event.target instanceof Element ? event.target : null;
            if (
              target?.closest("dialog,[contenteditable='true']") ||
              document.querySelector("dialog[open]")
            )
              return;
            event.preventDefault();
            closePanel();
          }}
        >
          <div className={guestStyles.panelHeader}>
            <h2 ref={panelHeading} tabIndex={-1}>
              {copy.participantPanel}
            </h2>
            {canvasVisible ? (
              <button
                className={guestStyles.iconButton}
                type="button"
                aria-label={copy.closeParticipantPanel}
                title={copy.closeParticipantPanel}
                onClick={closePanel}
              >
                <CanvasToolIcon name="close" />
              </button>
            ) : null}
          </div>
          <section className={guestStyles.prompt}>
            <h3>{t("boards.prompt")}</h3>
            {board?.description ? (
              <p className={styles.body} lang="" dir="auto">
                {board.description}
              </p>
            ) : null}
            {board ? (
              <p className={guestStyles.deadline}>
                {t("boards.expiry", { date: formatDateTime(locale, board.closesAt) })}
              </p>
            ) : null}
            <details className={guestStyles.disclosure}>
              <summary>{t("boards.identity")}</summary>
              <p>{t("boards.disclosure")}</p>
            </details>
          </section>
          {!guest && info && info.status !== "draft" ? (
            <section className={guestStyles.card}>
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
          {board?.status === "draft" ? (
            <p className={guestStyles.card}>{t("boards.notOpen")}</p>
          ) : null}
          {guest ? (
            <>
              {guest.board.status === "collecting" ? (
                <section className={guestStyles.card}>
                  <h3>{t("boards.submitIdea")}</h3>
                  <p className={guestStyles.hint}>{t("boards.ideaLimit")}</p>
                  <IdeaComposer
                    boardId={id}
                    guestToken={token.current!}
                    value={draft}
                    disabled={
                      locked || guest.ownIdeas.length >= 10 || guest.board.totalIdeas >= 200
                    }
                    imagesAvailable={guest.imageUploadsAvailable}
                    onChange={setDraft}
                    onSubmit={submitIdea}
                    onUploading={setUploading}
                  />
                </section>
              ) : null}
              {guest.ownIdeas.length ? (
                <details className={guestStyles.card} open>
                  <summary>
                    {t("boards.own")} <span>{guest.ownIdeas.length}</span>
                  </summary>
                  <ul className={styles.list}>
                    {guest.ownIdeas.map((idea) => (
                      <li className={guestStyles.ownIdea} key={idea.id}>
                        <IdeaContent
                          boardId={id}
                          idea={idea}
                          guestToken={token.current ?? undefined}
                        />
                        <p className={guestStyles.hint}>
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
                </details>
              ) : null}
              <section className={guestStyles.card}>
                <h3>
                  {guest.board.status === "voting" ? t("boards.voting") : t("boards.approved")}
                </h3>
                {guest.board.status === "collecting" && !guest.board.ideasVisible ? (
                  <p>{t("boards.hidden")}</p>
                ) : null}
                {!guest.board.countsVisible ? (
                  <p className={guestStyles.hint}>{t("boards.countsHidden")}</p>
                ) : null}
                {guest.hasVoted ? (
                  <p className={styles.receipt} role="status">
                    {t("boards.voteReceipt")}
                  </p>
                ) : null}
                {guest.board.status === "voting" && !guest.hasVoted ? (
                  <form className={styles.form} onSubmit={submitVotes}>
                    <p>{t("boards.select", { budget: guest.board.voteBudget })}</p>
                    <IdeaBoardIdeas
                      board={guest.board}
                      guestToken={token.current ?? undefined}
                      selected={selected}
                      disabled={locked}
                      onSelect={(ideaId, checked) =>
                        setSelected((current) =>
                          checked
                            ? [...current, ideaId]
                            : current.filter((value) => value !== ideaId),
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
              {guest.board.roundHistory.length ? (
                <WorkshopRoundHistory board={guest.board} />
              ) : null}
            </>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
