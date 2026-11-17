"use client";

import type {
  CompetitionStandingEntry,
  CompetitionStandings,
  SessionSnapshot,
} from "@openround/contracts";
import { useId, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  competitionPlace,
  competitionText,
  type CompetitionCopyKey,
} from "../lib/i18n/competition-copy";
import { formatNumber } from "../lib/i18n/format";
import { scoredResponseCopy } from "../lib/i18n/scored-response-copy";
import { useLocale } from "./locale-provider";
import { ParticipantIdentity } from "./participant-avatar";
import { ScoredResponseReceipt } from "./scored-response-receipt";
import { useCompetitionCelebration } from "./use-competition-celebration";
import styles from "./competition-dashboard.module.css";

const MOTION_STORAGE_KEY = "openround:competition-motion";
const MOTION_EVENT = "openround:competition-motion-change";

/** System and saved accessibility choices always take precedence over decorative effects. */
export function getCompetitionMotionPreference(): "reduced" | "on" | "off" {
  if (typeof window === "undefined") return "reduced";
  if (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.openroundMotion === "reduced"
  )
    return "reduced";
  try {
    const preferences = JSON.parse(
      window.localStorage.getItem("openround:experience-preferences") ?? "null",
    );
    if (preferences?.reducedMotion === true) return "reduced";
  } catch {
    // A damaged app preference must not discard a separately saved effects choice.
  }
  try {
    return window.localStorage.getItem(MOTION_STORAGE_KEY) === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener(MOTION_EVENT, onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-openround-motion"],
  });
  return () => {
    media?.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(MOTION_EVENT, onChange);
    observer.disconnect();
  };
}
const serverMotion = () => "reduced" as const;

export interface CompetitionDashboardProps {
  standings: CompetitionStandings;
  participantId?: string;
  compact?: boolean;
  summary?: boolean;
  headingLevel?: 1 | 2 | 3;
  finished?: boolean;
  variant?: "host" | "presenter" | "participant";
  responseSummary?: SessionSnapshot["myScoredResponseSummary"];
}

function Medal({ rank }: { rank: number }) {
  return (
    <svg className={styles.medalArt} viewBox="0 0 48 56" aria-hidden="true" focusable="false">
      <path d="M9 3h12l5 19-12 5zM27 3h12l-5 24-12-5z" fill="currentColor" opacity=".42" />
      <path d="m24 15 8 4 9 2 1 10-2 10-9 4-7 6-7-6-9-4-2-10 1-10 9-2z" fill="currentColor" />
      <path
        d="m24 24 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"
        fill="var(--ui-surface)"
        opacity=".86"
      />
      <circle
        cx="24"
        cy="33"
        r="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity=".7"
      />
      <title>{rank}</title>
    </svg>
  );
}

export function CompetitionDashboard({
  standings,
  participantId,
  compact = false,
  summary = false,
  headingLevel = 2,
  finished = false,
  variant = participantId ? "participant" : "host",
  responseSummary,
}: CompetitionDashboardProps) {
  const { locale } = useLocale();
  const id = useId();
  const preference = useSyncExternalStore(
    subscribeMotion,
    getCompetitionMotionPreference,
    serverMotion,
  );
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const [view, setView] = useState<"race" | "table">("race");
  const motion = preference !== "reduced" && (motionOverride ?? preference === "on");
  const text = (key: CompetitionCopyKey, values?: Record<string, string | number>) =>
    competitionText(locale, key, values);
  const number = (value: number) => formatNumber(locale, value);
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  const isFinal = finished || standings.status === "final";
  const participantFinal = variant === "participant" && isFinal;
  const compactParticipant =
    variant === "participant" &&
    ((!isFinal && compact) || (isFinal && standings.entries.length < 2));
  const condensedPersonal = compactParticipant || participantFinal;
  const unscored = standings.status === "unscored";
  const released =
    !unscored &&
    standings.status !== "waiting" &&
    standings.completedScoredQuestions > 0 &&
    standings.entries.length > 0;
  const title = unscored
    ? text("unscoredTitle")
    : isFinal
      ? text("finalTitle")
      : text(released ? (compactParticipant ? "standings" : "liveTitle") : "waitingTitle");
  const personal = released
    ? standings.entries.find((entry) => entry.id === participantId)
    : undefined;
  const topThree = released ? standings.entries.filter((entry) => entry.rank <= 3) : [];
  const status = unscored ? "unscored" : isFinal ? "final" : released ? "live" : "waiting";
  // Presence/answer acknowledgements do not change this key or restart the celebration.
  const releaseKey = `${status}:${standings.completedScoredQuestions}`;
  const leader = released ? standings.entries[0] : undefined;
  const pointsAvailable = (leader?.score ?? 0) > 0;
  const podiumAvailable = pointsAvailable && standings.entries.length > 1;
  const celebrationAvailable = isFinal && podiumAvailable;
  const celebrationEligible = celebrationAvailable && !compactParticipant && !summary;
  const celebration = useCompetitionCelebration({
    eligible: celebrationEligible,
    enabled: motion,
    releaseKey,
  });
  const raceAvailable = !isFinal || pointsAvailable;
  const compactEntries = released ? standings.entries.slice(0, 3) : [];
  if (personal && !compactEntries.some((entry) => entry.id === personal.id))
    compactEntries.push(personal);
  const biggestGain = released
    ? Math.max(
        0,
        ...standings.entries.map((entry) =>
          entry.previousRank === null || (entry.lastScoreDelta ?? 0) <= 0
            ? 0
            : entry.previousRank - entry.rank,
        ),
      )
    : 0;
  const climbers =
    biggestGain > 0
      ? standings.entries.filter(
          (entry) =>
            entry.previousRank !== null &&
            (entry.lastScoreDelta ?? 0) > 0 &&
            entry.previousRank - entry.rank === biggestGain,
        )
      : [];
  const climberNames = climbers
    .slice(0, 3)
    .map((entry) => entry.nickname)
    .join(" · ");
  const policy: CompetitionCopyKey =
    standings.tieBreak === "score_correct_time"
      ? "scoreCorrectTime"
      : standings.tieBreak === "score_correct"
        ? "scoreCorrect"
        : "scoreJoinOrder";

  function toggleMotion() {
    if (preference === "reduced") return;
    const next = !motion;
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, next ? "on" : "off");
      setMotionOverride(null);
    } catch {
      // Local controls still work when storage is unavailable.
      setMotionOverride(next);
    }
    window.dispatchEvent(new Event(MOTION_EVENT));
  }

  function movement(entry: CompetitionStandingEntry) {
    if (entry.previousRank === null)
      return { label: text("newEntry"), value: "—", direction: "new" };
    const change = entry.previousRank - entry.rank;
    if (change === 0) return { label: text("samePosition"), value: "—", direction: "same" };
    const count = number(Math.abs(change));
    return {
      label: text(change > 0 ? "upPlaces" : "downPlaces", { count }),
      value: `${change > 0 ? "↑" : "↓"} ${count}`,
      direction: change > 0 ? "up" : "down",
    };
  }

  function movementBadge(entry: CompetitionStandingEntry) {
    const change = movement(entry);
    return (
      <span
        className={styles.movement}
        data-direction={change.direction}
        aria-label={change.label}
        role="img"
      >
        <span aria-hidden="true">{change.value}</span>
      </span>
    );
  }

  function streakBadge(entry: CompetitionStandingEntry) {
    return entry.correctStreak !== undefined && entry.correctStreak >= 2 ? (
      <span
        className={styles.streak}
        data-testid="competition-streak"
        aria-label={`${text("streak")}: ${text("streakCount", { count: number(entry.correctStreak) })}`}
      >
        <span aria-hidden="true">✦</span>{" "}
        {text("streakCount", { count: number(entry.correctStreak) })}
      </span>
    ) : null;
  }

  function standingsTable(entries: CompetitionStandingEntry[], caption: string) {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{text("position")}</th>
              <th scope="col">{text("name")}</th>
              <th scope="col">{text("points")}</th>
              <th scope="col">
                <span className="sr-only">{text("movement")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} data-self={entry.id === participantId || undefined}>
                <td className={styles.place}>
                  {competitionPlace(locale, entry.rank)}
                  {entry.tied ? <span className={styles.tie}>{text("tied")}</span> : null}
                </td>
                <th scope="row">
                  <span className={styles.identity}>
                    <ParticipantIdentity nickname={entry.nickname} avatarId={entry.avatarId} />
                    {entry.id === participantId ? (
                      <span className={styles.you}>{text("you")}</span>
                    ) : null}
                  </span>
                  {streakBadge(entry)}
                </th>
                <td className={styles.points}>{number(entry.score)}</td>
                <td>{movementBadge(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const scoringPolicy = (
    <footer className={styles.policy}>
      <strong>{text(standings.scoringMode === "speed" ? "speed" : "accuracy")}</strong>
      <p>
        {text(policy)} {standings.entries.some((entry) => entry.tied) ? text("tieNote") : ""}
      </p>
      <p>{text("releasedOnly")}</p>
    </footer>
  );

  const effectsControls = (
    <div className={styles.effectsControls} data-testid="competition-effects-controls">
      {celebrationEligible ? (
        <button
          type="button"
          className={styles.replayButton}
          disabled={!motion}
          onClick={celebration.replay}
          aria-describedby={`${id}-motion-help`}
          data-testid="competition-replay"
        >
          <span aria-hidden="true">↻</span> {text("replay")}
        </button>
      ) : null}
      <button
        type="button"
        aria-pressed={motion}
        disabled={preference === "reduced"}
        onClick={toggleMotion}
        data-testid="competition-motion-toggle"
      >
        <span aria-hidden="true">✧</span> {text("motion")}
      </button>
      <small id={`${id}-motion-help`}>
        {text(preference === "reduced" ? "reducedMotion" : motion ? "motionHelp" : "motionOff")}
      </small>
    </div>
  );

  const dashboardOptions = (
    <>
      {!celebrationEligible ? effectsControls : null}
      {scoringPolicy}
    </>
  );

  const finale = celebrationEligible ? (
    <aside
      className={styles.finishBanner}
      data-testid="competition-finale"
      aria-label={text("finishTitle")}
    >
      <span className={styles.finishEmblem} key={`emblem:${celebration.run}`} aria-hidden="true">
        <svg viewBox="0 0 64 64" focusable="false">
          <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="m13 23 9 7 10-14 10 14 9-7-5 22H18z" fill="currentColor" />
          <path
            d="M23 50h18"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="m32 27 2.3 4.7 5.2.8-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.6 5.2-.8z"
            fill="var(--ui-surface)"
          />
        </svg>
      </span>
      <div className={styles.finishCopy}>
        <span className={styles.finishEyebrow}>{text("final")}</span>
        <strong>{text(leader?.tied ? "sharedFinish" : "finishTitle")}</strong>
        <p>
          {leader && !leader.tied ? (
            <>
              {text("topFinisher")} <span aria-hidden="true">·</span>{" "}
              <span lang="">{leader.nickname}</span>
            </>
          ) : (
            text("podium")
          )}
        </p>
      </div>
      <span className={styles.finishCheckers} aria-hidden="true" />
      {effectsControls}
    </aside>
  ) : null;

  const personalContent = personal ? (
    <section
      className={styles.personal}
      aria-label={text("personalTitle")}
      data-testid="competition-personal"
    >
      <div className={styles.personalHeading}>
        <span>{text("personalTitle")}</span>
        {movementBadge(personal)}
      </div>
      <dl className={styles.personalStats}>
        <div>
          <dt>{text("position")}</dt>
          <dd>
            {competitionPlace(locale, personal.rank)}
            {personal.tied ? <small>{text("tied")}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{text("points")}</dt>
          <dd>{number(personal.score)}</dd>
        </div>
        {!condensedPersonal ? (
          <>
            <div>
              <dt>{text("leaderGap")}</dt>
              <dd>{number(Math.max(0, personal.pointsToLeader))}</dd>
            </div>
            <div>
              <dt>{text("nextGap")}</dt>
              <dd>
                {personal.pointsToNextRank === null ? (
                  <small>{text("leading")}</small>
                ) : (
                  number(Math.max(0, personal.pointsToNextRank))
                )}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
      {personal.lastScoreDelta !== undefined || (personal.correctStreak ?? 0) >= 2 ? (
        <div className={styles.personalHighlights}>
          {personal.lastScoreDelta !== undefined ? (
            <span className={styles.questionGain} data-testid="competition-question-gain">
              <span>{text("questionGain")}</span>
              <strong>{text("pointsEarned", { count: number(personal.lastScoreDelta) })}</strong>
            </span>
          ) : null}
          {streakBadge(personal)}
        </div>
      ) : null}
      {variant === "participant" ? (
        <ScoredResponseReceipt responseSummary={responseSummary} />
      ) : null}
    </section>
  ) : variant === "participant" ? (
    <ScoredResponseReceipt responseSummary={responseSummary} />
  ) : null;

  const compactContent = released ? (
    <>
      {personalContent}
      {!pointsAvailable ? (
        <p className={styles.empty} data-testid="competition-zero-points" role="status">
          {scoredResponseCopy[locale].zeroPoints}
        </p>
      ) : null}
      {standings.entries.length > 1 || !personal ? (
        <section className={styles.compactStandings} aria-label={text("standings")}>
          {standingsTable(compactEntries, text(isFinal ? "finalTitle" : "standings"))}
          {standings.entries.length > compactEntries.length ? (
            <details className={styles.fullStandings}>
              <summary>
                {text("allStandings")} <span>({number(standings.entries.length)})</span>
              </summary>
              {standingsTable(standings.entries, text("allStandings"))}
            </details>
          ) : null}
        </section>
      ) : null}
      <details className={styles.displayOptions} data-testid="competition-display-options">
        <summary>{text(standings.scoringMode === "speed" ? "speed" : "accuracy")}</summary>
        {scoringPolicy}
      </details>
    </>
  ) : null;

  const releasedContent = released ? (
    <>
      {finale}
      {personalContent}
      {!pointsAvailable ? (
        <p className={styles.empty} data-testid="competition-zero-points" role="status">
          {scoredResponseCopy[locale].zeroPoints}
        </p>
      ) : null}
      {!isFinal && climbers.length > 0 ? (
        <aside
          className={styles.spotlight}
          data-testid="competition-spotlight"
          aria-label={text("biggestClimb")}
        >
          <span className={styles.spotlightIcon} aria-hidden="true">
            ↗
          </span>
          <div>
            <strong>{text("biggestClimb")}</strong>
            <p>
              <span lang="">
                {text("climbStory", { names: climberNames, count: number(biggestGain) })}
              </span>
              {climbers.length > 3
                ? ` · ${text("moreClimbers", { count: number(climbers.length - 3) })}`
                : ""}
            </p>
          </div>
        </aside>
      ) : null}
      <div className={styles.competitionStage} data-testid="competition-stage">
        {podiumAvailable ? (
          <div
            className={styles.podium}
            role="group"
            aria-label={text("podium")}
            data-testid="competition-podium"
            data-count={topThree.length}
            key={`podium:${releaseKey}:${celebration.run}`}
          >
            {topThree.map((entry) => (
              <article
                className={styles.podiumCard}
                key={entry.id}
                data-rank={entry.rank}
                data-self={entry.id === participantId || undefined}
              >
                <div className={styles.podiumPerson}>
                  <span className={styles.medalFrame} data-top={entry.rank === 1 || undefined}>
                    <Medal rank={entry.rank} />
                  </span>
                  <p className={styles.medal}>{competitionPlace(locale, entry.rank)}</p>
                  <span className={styles.identity}>
                    <ParticipantIdentity
                      nickname={entry.nickname}
                      avatarId={entry.avatarId}
                      size="medium"
                    />
                  </span>
                  <div className={styles.podiumMeta}>
                    {entry.id === participantId ? (
                      <span className={styles.you}>{text("you")}</span>
                    ) : null}
                    {entry.tied ? <span className={styles.tie}>{text("tied")}</span> : null}
                  </div>
                  {streakBadge(entry)}
                </div>
                <div className={styles.podiumStep}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {number(entry.rank)}
                  </span>
                  <strong className={styles.podiumScore}>
                    {number(entry.score)} <span>{text("points")}</span>
                  </strong>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        <section
          className={styles.scoreboard}
          aria-label={text(raceAvailable ? "race" : "standings")}
          style={podiumAvailable ? undefined : { gridColumn: "1 / -1" }}
        >
          <div className={styles.scoreboardHeading}>
            <div>
              <strong>{text(raceAvailable ? "race" : "standings")}</strong>
              {raceAvailable ? <p>{text("raceHelp")}</p> : null}
            </div>
            {raceAvailable ? (
              <div className={styles.viewControls} role="group" aria-label={text("scoreboardView")}>
                <button
                  type="button"
                  aria-pressed={view === "race"}
                  onClick={() => setView("race")}
                >
                  {text("raceView")}
                </button>
                <button
                  type="button"
                  aria-pressed={view === "table"}
                  onClick={() => setView("table")}
                >
                  {text("tableView")}
                </button>
              </div>
            ) : null}
          </div>
          {raceAvailable && view === "race" ? (
            <ol
              className={styles.race}
              data-testid="competition-race"
              aria-label={text("standings")}
              key={`race:${releaseKey}:${celebration.run}`}
            >
              {standings.entries.slice(0, 5).map((entry) => {
                const ratio =
                  leader && leader.score > 0
                    ? Math.max(0, Math.min(100, (entry.score / leader.score) * 100))
                    : 0;
                return (
                  <li
                    key={`${entry.id}:${releaseKey}`}
                    data-rank={entry.rank}
                    data-self={entry.id === participantId || undefined}
                  >
                    <div className={styles.raceRow}>
                      <span className={styles.racePlace}>
                        {competitionPlace(locale, entry.rank)}
                      </span>
                      <span className={styles.identity}>
                        <ParticipantIdentity nickname={entry.nickname} avatarId={entry.avatarId} />
                        {entry.id === participantId ? (
                          <span className={styles.you}>{text("you")}</span>
                        ) : null}
                        {entry.tied ? <span className={styles.tie}>{text("tied")}</span> : null}
                      </span>
                      <strong>{number(entry.score)}</strong>
                      {movementBadge(entry)}
                    </div>
                    <div
                      className={styles.raceTrack}
                      role="img"
                      aria-label={text("relativeScore", {
                        name: entry.nickname,
                        score: number(entry.score),
                        percent: number(Math.round(ratio)),
                      })}
                    >
                      <span
                        className={styles.raceFill}
                        data-testid="competition-race-fill"
                        data-score={entry.score}
                        style={{ width: `${ratio}%` }}
                      >
                        {celebrationEligible ? (
                          <span className={styles.runner} aria-hidden="true">
                            <svg viewBox="0 0 28 28" focusable="false">
                              <circle cx="17" cy="5" r="3" fill="currentColor" />
                              <path
                                d="m15 10-4 6 5 4-3 5m1-14 5 5 5-1M11 16l-5 1-3 5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        ) : null}
                      </span>
                      {celebrationEligible ? (
                        <span className={styles.trackFinish} aria-hidden="true" />
                      ) : null}
                    </div>
                    {streakBadge(entry)}
                  </li>
                );
              })}
            </ol>
          ) : (
            standingsTable(
              standings.entries.slice(0, 5),
              text(isFinal ? "finalTitle" : "standings"),
            )
          )}
          {standings.entries.length > 5 ? (
            <details className={styles.fullStandings}>
              <summary>
                {text("allStandings")} <span>({number(standings.entries.length)})</span>
              </summary>
              {standingsTable(standings.entries, text("allStandings"))}
            </details>
          ) : null}
        </section>
      </div>
      {variant === "host" || variant === "presenter" || participantFinal ? (
        <details className={styles.displayOptions} data-testid="competition-display-options">
          <summary>
            {text(standings.scoringMode === "speed" ? "speed" : "accuracy")} · {text("motion")}
          </summary>
          {dashboardOptions}
        </details>
      ) : (
        dashboardOptions
      )}
    </>
  ) : null;

  return (
    <section
      ref={celebration.ref}
      className={`${styles.dashboard}${compact ? ` ${styles.compact}` : ""}${summary ? ` ${styles.summary}` : ""}${compactParticipant ? ` ${styles.compactParticipant}` : ""}${participantFinal ? ` ${styles.participantFinal}` : ""}`}
      aria-labelledby={`${id}-title`}
      data-testid="competition-dashboard"
      data-status={status}
      data-celebrating={celebration.playing ? "true" : undefined}
      data-celebration-run={celebration.run}
      data-finale={celebrationEligible || undefined}
      data-motion={
        !compactParticipant && !summary && motion && (!isFinal || celebrationAvailable)
          ? "on"
          : "off"
      }
      data-compact-participant={compactParticipant || undefined}
      data-variant={variant}
      data-summary={summary || undefined}
      lang={locale}
    >
      {celebrationEligible && motion && celebration.playing ? (
        <div
          key={`celebration:${celebration.run}`}
          className={styles.celebration}
          data-testid="competition-celebration"
          data-replay={celebration.run}
          aria-hidden="true"
        >
          {Array.from({ length: 84 }, (_, index) => {
            const side = index % 2;
            return (
              <i
                key={index}
                data-kind={index % 7 === 0 ? "streamer" : "confetti"}
                data-side={side}
                style={
                  {
                    "--origin": side ? "100%" : "0%",
                    "--travel-x": `${(side ? -1 : 1) * (90 + ((index * 47) % 460))}px`,
                    "--rise": `${-80 - ((index * 31) % 170)}px`,
                    "--fall": `${280 + ((index * 41) % 330)}px`,
                    "--delay": `${(index % 7) * 0.055}s`,
                    "--spin": `${(side ? -1 : 1) * (220 + ((index * 37) % 500))}deg`,
                  } as CSSProperties
                }
              />
            );
          })}
        </div>
      ) : null}
      <header className={styles.header}>
        <div>
          {!summary && !compactParticipant && !participantFinal ? (
            <p className={styles.eyebrow}>
              <span aria-hidden="true">✦</span> {text(status)}
            </p>
          ) : null}
          <Heading id={`${id}-title`} className={styles.title}>
            {title}
          </Heading>
        </div>
        <div className={styles.participantCount}>
          <strong>{number(standings.totalParticipants)}</strong>
          <span>{text("participants")}</span>
        </div>
      </header>
      {!unscored ? (
        <div className={styles.progress}>
          <p role="status" aria-live="polite">
            {text("progress", {
              completed: number(standings.completedScoredQuestions),
              total: number(standings.totalScoredQuestions),
            })}
          </p>
          {!summary && !compactParticipant ? (
            <progress
              aria-label={text("progress", {
                completed: number(standings.completedScoredQuestions),
                total: number(standings.totalScoredQuestions),
              })}
              value={standings.completedScoredQuestions}
              max={Math.max(1, standings.totalScoredQuestions)}
            />
          ) : null}
        </div>
      ) : null}
      {!released ? (
        <p className={styles.empty}>
          {text(unscored ? "unscoredBody" : isFinal ? "noResults" : "waitingBody")}
        </p>
      ) : compactParticipant ? (
        compactContent
      ) : summary ? (
        <>
          <ol className={styles.summaryLeaders} aria-label={text("standings")}>
            {standings.entries.slice(0, 3).map((entry) => (
              <li key={entry.id}>
                <span className={styles.racePlace}>{competitionPlace(locale, entry.rank)}</span>
                <span className={styles.identity}>
                  <ParticipantIdentity nickname={entry.nickname} avatarId={entry.avatarId} />
                  {entry.tied ? <span className={styles.tie}>{text("tied")}</span> : null}
                </span>
                <strong>{number(entry.score)}</strong>
              </li>
            ))}
          </ol>
          <details className={styles.summaryDetails}>
            <summary>
              {text("allStandings")} <span>({number(standings.entries.length)})</span>
            </summary>
            {releasedContent}
          </details>
        </>
      ) : (
        releasedContent
      )}
    </section>
  );
}
