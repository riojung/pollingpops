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
  const [replay, setReplay] = useState(0);
  const [view, setView] = useState<"race" | "table">("race");
  const motion = preference !== "reduced" && (motionOverride ?? preference === "on");
  const text = (key: CompetitionCopyKey, values?: Record<string, string | number>) =>
    competitionText(locale, key, values);
  const number = (value: number) => formatNumber(locale, value);
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  const isFinal = finished || standings.status === "final";
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
      : text(released ? "liveTitle" : "waitingTitle");
  const personal = released
    ? standings.entries.find((entry) => entry.id === participantId)
    : undefined;
  const topThree = released ? standings.entries.filter((entry) => entry.rank <= 3) : [];
  const status = unscored ? "unscored" : isFinal ? "final" : released ? "live" : "waiting";
  // Presence/answer acknowledgements do not change this key or restart the celebration.
  const releaseKey = `${status}:${standings.completedScoredQuestions}`;
  const leader = released ? standings.entries[0] : undefined;
  const podiumAvailable = (leader?.score ?? 0) > 0;
  const celebrationAvailable = isFinal && podiumAvailable;
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

  const dashboardOptions = (
    <>
      <div className={styles.effectsControls}>
        <button
          type="button"
          aria-pressed={motion}
          disabled={preference === "reduced"}
          onClick={toggleMotion}
          data-testid="competition-motion-toggle"
        >
          <span aria-hidden="true">✧</span> {text("motion")}
        </button>
        {celebrationAvailable ? (
          <button
            type="button"
            disabled={!motion}
            onClick={() => setReplay((current) => current + 1)}
            data-testid="competition-replay"
          >
            <span aria-hidden="true">↻</span> {text("replay")}
          </button>
        ) : null}
        <small>{text(preference === "reduced" ? "reducedMotion" : "motionHelp")}</small>
      </div>
      <footer className={styles.policy}>
        <strong>{text(standings.scoringMode === "speed" ? "speed" : "accuracy")}</strong>
        <p>
          {text(policy)} {standings.entries.some((entry) => entry.tied) ? text("tieNote") : ""}
        </p>
        <p>{text("releasedOnly")}</p>
      </footer>
    </>
  );

  const releasedContent = released ? (
    <>
      {personal ? (
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
          </dl>
          {personal.lastScoreDelta !== undefined || (personal.correctStreak ?? 0) >= 2 ? (
            <div className={styles.personalHighlights}>
              {personal.lastScoreDelta !== undefined ? (
                <span className={styles.questionGain} data-testid="competition-question-gain">
                  <span>{text("questionGain")}</span>
                  <strong>
                    {text("pointsEarned", { count: number(personal.lastScoreDelta) })}
                  </strong>
                </span>
              ) : null}
              {streakBadge(personal)}
            </div>
          ) : null}
          {variant === "participant" ? (
            <ScoredResponseReceipt responseSummary={responseSummary} />
          ) : null}
        </section>
      ) : null}
      {!podiumAvailable ? (
        <p className={styles.empty} data-testid="competition-zero-points" role="status">
          {scoredResponseCopy[locale].zeroPoints}
        </p>
      ) : null}
      {(isFinal ? celebrationAvailable : climbers.length > 0) ? (
        <aside
          className={styles.spotlight}
          data-testid="competition-spotlight"
          aria-label={text(isFinal ? "finishTitle" : "biggestClimb")}
        >
          <span className={styles.spotlightIcon} aria-hidden="true">
            {isFinal ? "✧" : "↗"}
          </span>
          <div>
            <strong>
              {text(isFinal ? (leader?.tied ? "sharedFinish" : "finishTitle") : "biggestClimb")}
            </strong>
            <p>
              {isFinal ? (
                <>
                  <span>
                    {leader && !leader.tied && leader.score > 0 ? `${text("topFinisher")} · ` : ""}
                  </span>
                  <span lang="">
                    {leader && !leader.tied && leader.score > 0 ? leader.nickname : text("podium")}
                  </span>
                </>
              ) : (
                <>
                  <span lang="">
                    {text("climbStory", { names: climberNames, count: number(biggestGain) })}
                  </span>
                  {climbers.length > 3
                    ? ` · ${text("moreClimbers", { count: number(climbers.length - 3) })}`
                    : ""}
                </>
              )}
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
            key={`podium:${releaseKey}`}
          >
            {topThree.map((entry) => (
              <article
                className={styles.podiumCard}
                key={entry.id}
                data-rank={entry.rank}
                data-self={entry.id === participantId || undefined}
              >
                <div className={styles.podiumPerson}>
                  <Medal rank={entry.rank} />
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
          aria-label={text("race")}
          style={podiumAvailable ? undefined : { gridColumn: "1 / -1" }}
        >
          <div className={styles.scoreboardHeading}>
            <div>
              <strong>{text("race")}</strong>
              <p>{text("raceHelp")}</p>
            </div>
            <div className={styles.viewControls} role="group" aria-label={text("scoreboardView")}>
              <button type="button" aria-pressed={view === "race"} onClick={() => setView("race")}>
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
          </div>
          {view === "race" ? (
            <ol
              className={styles.race}
              data-testid="competition-race"
              aria-label={text("standings")}
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
                      />
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
      {variant === "host" || variant === "presenter" ? (
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
      className={`${styles.dashboard}${compact ? ` ${styles.compact}` : ""}${summary ? ` ${styles.summary}` : ""}`}
      aria-labelledby={`${id}-title`}
      data-testid="competition-dashboard"
      data-status={status}
      data-motion={motion && (!isFinal || celebrationAvailable) ? "on" : "off"}
      data-variant={variant}
      data-summary={summary || undefined}
      lang={locale}
    >
      {celebrationAvailable ? (
        <div
          key={`${releaseKey}:${replay}`}
          className={styles.celebration}
          data-testid="competition-celebration"
          data-replay={replay}
          aria-hidden="true"
        >
          {Array.from({ length: 22 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  "--piece": index,
                  "--x": `${(index * 37 + 7) % 100}%`,
                  "--delay": `${(index % 5) * 0.07}s`,
                  "--spin": `${index % 2 ? -340 : 360}deg`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
      <header className={styles.header}>
        <div>
          {!summary ? (
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
          {!summary ? (
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
