"use client";

import { useId, useState } from "react";
import type { IdeaBoardView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { formatDateTime, formatNumber, pluralCategory } from "../../lib/i18n/format";
import { guidedWorkshopCopy } from "../../lib/i18n/guided-workshop-messages";
import { boardAnalyticsRounds } from "./board-analytics-model";
import boardStyles from "./boards.module.css";
import styles from "./board-analytics.module.css";

const percentOptions = { style: "percent", maximumFractionDigits: 2 } as const;

export function BoardAnalytics({ board }: { board: IdeaBoardView }) {
  const { locale } = useLocale();
  const copy = guidedWorkshopCopy(locale);
  const headingId = useId();
  const shareNoteId = useId();
  const [selection, setSelection] = useState<number | null>(null);
  const rounds = boardAnalyticsRounds(board);
  const current = rounds[0]!;
  const round = rounds.find(({ roundNumber }) => roundNumber === selection) ?? current;
  const roundLabel = (number: number) =>
    copy.roundLabel.replace("{round}", formatNumber(locale, number));

  return (
    <section className={`${boardStyles.panel} ${styles.panel}`} aria-labelledby={headingId}>
      <header className={styles.heading}>
        <div>
          <h2 id={headingId}>{copy.analyticsTitle}</h2>
          {rounds.length === 1 ? (
            <p className={styles.meta}>{roundLabel(round.roundNumber)}</p>
          ) : null}
        </div>
        {rounds.length > 1 ? (
          <label className={`${boardStyles.field} ${styles.picker}`}>
            {copy.analyticsRound}
            <select
              value={round.roundNumber}
              onChange={(event) => {
                const number = Number(event.target.value);
                setSelection(number === current.roundNumber ? null : number);
              }}
            >
              {rounds.map(({ roundNumber }) => (
                <option key={roundNumber} value={roundNumber}>
                  {roundLabel(roundNumber)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      {round.status === "available" ? (
        <>
          {round.ballotCount !== null || round.closedAt ? (
            <p className={styles.meta}>
              {round.ballotCount !== null ? (
                <span>
                  {(pluralCategory(locale, round.ballotCount) === "one"
                    ? copy.ballotCountOne
                    : copy.ballotCount
                  ).replace("{count}", formatNumber(locale, round.ballotCount))}
                </span>
              ) : null}
              {round.closedAt ? (
                <time dateTime={round.closedAt}>
                  {copy.closedAt.replace("{date}", formatDateTime(locale, round.closedAt))}
                </time>
              ) : null}
            </p>
          ) : null}
          <dl className={styles.metrics}>
            <div>
              <dt>{copy.analyticsVotes}</dt>
              <dd>{formatNumber(locale, round.totalVotes)}</dd>
            </div>
            <div>
              <dt>{copy.analyticsIdeasWithVotes}</dt>
              <dd>{formatNumber(locale, round.ideasWithVotes)}</dd>
            </div>
          </dl>
          {round.totalVotes === 0 ? <p className={styles.notice}>{copy.analyticsEmpty}</p> : null}
          {round.ideas.length > 0 ? (
            <>
              {round.totalVotes > 0 ? (
                <p className={styles.note} id={shareNoteId}>
                  {copy.analyticsShareNote}
                </p>
              ) : null}
              <div
                className={styles.tableScroll}
                role="region"
                aria-label={copy.votingResults}
                tabIndex={0}
              >
                <table
                  className={styles.table}
                  aria-describedby={round.totalVotes > 0 ? shareNoteId : undefined}
                >
                  <caption>{copy.votingResults}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{copy.analyticsIdea}</th>
                      <th scope="col">{copy.analyticsVotes}</th>
                      <th scope="col">{copy.analyticsShare}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {round.ideas.map(({ id, body, position, voteCount, share }) => (
                      <tr key={id}>
                        <th scope="row">
                          {body ? (
                            <span lang="" dir="auto">
                              {body}
                            </span>
                          ) : (
                            <>
                              {copy.analyticsIdeaNumber.replace(
                                "{number}",
                                formatNumber(locale, position),
                              )}
                              <small className={styles.note}>{copy.analyticsIdeaUnavailable}</small>
                            </>
                          )}
                        </th>
                        <td>{formatNumber(locale, voteCount)}</td>
                        <td>
                          {share === null ? "—" : formatNumber(locale, share / 100, percentOptions)}
                          {share === null ? null : (
                            <span className={styles.track} aria-hidden="true">
                              <span style={{ width: `${share}%` }} />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <p className={styles.notice} role="status">
          {round.status === "open" ? copy.analyticsOpen : copy.analyticsWithheld}
        </p>
      )}
    </section>
  );
}
