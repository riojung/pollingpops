"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { IDEA_BOARD_MAX_ROUNDS, type IdeaBoardView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { formatDateTime, pluralCategory } from "../../lib/i18n/format";
import { guidedWorkshopCopy } from "../../lib/i18n/guided-workshop-messages";
import styles from "./workshop-lifecycle.module.css";

export function WorkshopLifecycleControls({
  board,
  canReopen = false,
  disabled = false,
  retentionDeadline,
  onReopen,
  onRetryReopen,
}: {
  board: IdeaBoardView;
  canReopen?: boolean;
  disabled?: boolean;
  retentionDeadline?: string;
  onReopen: (windowDays: number) => Promise<boolean>;
  onRetryReopen?: () => Promise<boolean>;
}) {
  const { locale, t } = useLocale();
  const copy = guidedWorkshopCopy(locale);
  const roundNumber = board.roundNumber ?? 1;
  const [openingRound, setOpeningRound] = useState<number | null>(null);
  const [windowDays, setWindowDays] = useState(7);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const roundStatus = useRef<HTMLParagraphElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const limitId = useId();
  const atLimit = roundNumber >= IDEA_BOARD_MAX_ROUNDS;

  useEffect(() => {
    if (openingRound === null) return;
    const node = dialog.current;
    node?.showModal();
    heading.current?.focus();
    return () => {
      node?.close();
      // On success the closed-only trigger disappears; the new round label remains.
      requestAnimationFrame(() => {
        const target =
          trigger.current?.isConnected && !trigger.current.disabled
            ? trigger.current
            : roundStatus.current;
        if (target?.isConnected) target.focus();
      });
    };
  }, [openingRound]);
  useEffect(() => {
    if (openingRound !== null && (openingRound !== roundNumber || board.status !== "closed"))
      setOpeningRound(null);
  }, [openingRound, roundNumber, board.status]);

  async function reopen(event: FormEvent) {
    event.preventDefault();
    if (
      working ||
      (disabled && !onRetryReopen) ||
      board.status !== "closed" ||
      openingRound !== roundNumber
    )
      return;
    setWorking(true);
    setFailed(false);
    try {
      if (await (onRetryReopen ? onRetryReopen() : onReopen(windowDays))) setOpeningRound(null);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className={styles.lifecycle}>
      <p ref={roundStatus} tabIndex={-1} className={styles.round}>
        {copy.roundLabel.replace("{round}", new Intl.NumberFormat(locale).format(roundNumber))}
      </p>
      {canReopen && board.status === "closed" ? (
        <>
          <button
            ref={trigger}
            type="button"
            className="button"
            disabled={disabled || atLimit}
            aria-describedby={atLimit ? limitId : undefined}
            onClick={(event) => {
              event.currentTarget.focus();
              setFailed(false);
              setWindowDays(7);
              setOpeningRound(roundNumber);
            }}
          >
            {copy.reopenCollection}
          </button>
          {atLimit ? <p id={limitId}>{copy.roundLimit}</p> : null}
        </>
      ) : null}
      {openingRound !== null ? (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          lang={locale}
          onCancel={(event) => {
            event.preventDefault();
            if (!working) setOpeningRound(null);
          }}
        >
          <form onSubmit={(event) => void reopen(event)}>
            <h2 ref={heading} id={titleId} tabIndex={-1}>
              {copy.reopenTitle}
            </h2>
            <p id={descriptionId}>{copy.reopenDescription}</p>
            <label className={styles.field}>
              <span>{copy.reopenWindow}</span>
              <select
                value={windowDays}
                disabled={working || disabled || Boolean(onRetryReopen)}
                onChange={(event) => setWindowDays(Number(event.target.value))}
              >
                <option value={1}>{copy.oneDay}</option>
                <option value={7}>{copy.sevenDays}</option>
                <option value={14}>{copy.fourteenDays}</option>
                <option value={30}>{copy.thirtyDays}</option>
              </select>
            </label>
            <p className={styles.hint}>
              {t("boards.expiry", {
                date: formatDateTime(
                  locale,
                  new Date(
                    Math.min(
                      Date.now() + windowDays * 86_400_000,
                      Date.parse(board.expiresAt),
                      retentionDeadline ? Date.parse(retentionDeadline) : Infinity,
                    ),
                  ).toISOString(),
                ),
              })}
            </p>
            <p className={styles.hint}>{copy.reopenRetention}</p>
            {failed ? (
              <p className="error" role="alert">
                {copy.reopenError}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button
                className="button-quiet"
                type="button"
                disabled={working}
                onClick={() => setOpeningRound(null)}
              >
                {t("boards.cancel")}
              </button>
              <button
                className="button"
                type="submit"
                disabled={working || (disabled && !onRetryReopen)}
              >
                {working ? copy.reopening : onRetryReopen ? t("boards.retry") : copy.confirmReopen}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}

export function WorkshopRoundHistory({ board }: { board: IdeaBoardView }) {
  const { locale, t } = useLocale();
  const copy = guidedWorkshopCopy(locale);
  const history = board.roundHistory ?? [];
  if (!history.length) return null;
  const ideas = new Map((board.roundHistoryIdeas ?? []).map((idea) => [idea.ideaId, idea.body]));
  const number = new Intl.NumberFormat(locale);
  return (
    <details className={styles.history}>
      <summary>
        {copy.votingHistory} <span>{number.format(history.length)}</span>
      </summary>
      <div className={styles.rounds}>
        {[...history].reverse().map((round) => (
          <article className={styles.previousRound} key={round.roundNumber}>
            <h3>{copy.roundLabel.replace("{round}", number.format(round.roundNumber))}</h3>
            <p className={styles.hint}>
              {(pluralCategory(locale, round.ballotCount) === "one"
                ? copy.ballotCountOne
                : copy.ballotCount
              ).replace("{count}", number.format(round.ballotCount))}
              {round.closedAt ? (
                <>
                  {" "}
                  ·{" "}
                  <time dateTime={round.closedAt}>
                    {copy.closedAt.replace("{date}", formatDateTime(locale, round.closedAt))}
                  </time>
                </>
              ) : null}
            </p>
            <ul className={styles.results} aria-label={copy.votingResults}>
              {round.results.map((result) => (
                <li key={result.ideaId}>
                  <span lang="">{ideas.get(result.ideaId) ?? t("boards.removed")}</span>
                  <strong>
                    {(pluralCategory(locale, result.voteCount) === "one"
                      ? copy.voteCountOne
                      : copy.voteCount
                    ).replace("{count}", number.format(result.voteCount))}
                  </strong>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </details>
  );
}
