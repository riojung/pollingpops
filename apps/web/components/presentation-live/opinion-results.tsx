import type { PresentationOpinionResultSummary } from "@openround/contracts";
import styles from "./opinion-results.module.css";

export function PresentationOpinionResults({
  summary,
  compact = false,
}: {
  summary: PresentationOpinionResultSummary;
  compact?: boolean;
}) {
  return (
    <section
      aria-label="Opinion results"
      className={`${styles.results}${compact ? ` ${styles.compact}` : ""}`}
      lang="en-CA"
    >
      <h2>{summary.kind === "ranking" ? "Ranking results" : "Poll results"}</h2>
      <p>
        {summary.responseCount} {summary.responseCount === 1 ? "respondent" : "respondents"}. These
        opinions are unscored.
      </p>
      {summary.kind === "poll" ? (
        <p>
          Percentages count respondents who selected each choice. Multiple selections can total more
          than 100%.
        </p>
      ) : compact ? (
        <p>
          Rank weights start at {summary.choices.length} and decrease by one per position. Unranked
          choices receive zero.
        </p>
      ) : (
        <p>
          Each respondent ranked {summary.rankCount} of {summary.choices.length} choices. First
          place receives {summary.choices.length} weighted points, decreasing by one per position.
          Unranked choices receive zero; these are result weights, not participant scores.
        </p>
      )}
      {!summary.responseCount ? <p>No responses were recorded.</p> : null}
      <div
        role="group"
        aria-label="Opinion result table"
        tabIndex={0}
        className={styles.scroll}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.target !== event.currentTarget ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.nativeEvent.isComposing ||
            !["ArrowLeft", "ArrowRight"].includes(event.key) ||
            event.currentTarget.scrollWidth <= event.currentTarget.clientWidth
          )
            return;
          event.preventDefault();
          event.currentTarget.scrollBy({ left: event.key === "ArrowRight" ? 80 : -80 });
        }}
      >
        <table className={summary.kind === "ranking" ? styles.rankingTable : undefined}>
          <caption>
            {summary.kind === "ranking" ? "Ranking results by choice" : "Poll selections by choice"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Choice</th>
              {summary.kind === "poll" ? (
                <>
                  <th scope="col">Selections</th>
                  <th scope="col">Respondents (%)</th>
                </>
              ) : (
                <>
                  <th scope="col">Weighted points</th>
                  <th scope="col">Ranked by</th>
                  <th scope="col">Average rank</th>
                  {Array.from({ length: summary.rankCount }, (_, index) => (
                    <th scope="col" key={index}>
                      Rank {index + 1}
                    </th>
                  ))}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.kind === "poll"
              ? summary.choices.map((choice) => (
                  <tr key={choice.choiceId}>
                    <th scope="row" lang="">
                      {choice.label}
                    </th>
                    <td>{choice.count}</td>
                    <td>{Number(choice.percentOfRespondents.toFixed(2))}%</td>
                  </tr>
                ))
              : summary.choices.map((choice) => (
                  <tr key={choice.choiceId}>
                    <th scope="row" lang="">
                      {choice.label}
                    </th>
                    <td>{choice.weightedScore}</td>
                    <td>{choice.rankedRespondents}</td>
                    <td>
                      {choice.averageRank === null ? "—" : Number(choice.averageRank.toFixed(2))}
                    </td>
                    {choice.rankCounts.map((count, index) => (
                      <td key={index}>{count}</td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
