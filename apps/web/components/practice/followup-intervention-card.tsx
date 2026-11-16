import type { FollowupSnapshot, SupportedLocale } from "@openround/contracts";
import { followupCopy } from "../../lib/i18n/followup-copy";
import { formatNumber } from "../../lib/i18n/format";

export function FollowupInterventionCard({
  intervention,
  busy,
  onContinue,
  locale = "en-CA",
}: {
  intervention: NonNullable<FollowupSnapshot["intervention"]>;
  busy: boolean;
  onContinue: () => void;
  locale?: SupportedLocale;
}) {
  const { card } = intervention;
  const copy = followupCopy(locale);
  return (
    <section
      className="live-card"
      aria-labelledby="followup-intervention-heading"
      lang={locale}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <p className="eyebrow">
        {copy("Recovery guidance · card {current} of {total}", {
          current: formatNumber(locale, intervention.index + 1),
          total: formatNumber(locale, intervention.count),
        })}
      </p>
      <h1 id="followup-intervention-heading" tabIndex={-1} lang="">
        {card.title}
      </h1>
      <p lang="" style={{ whiteSpace: "pre-wrap" }}>
        {card.body}
      </p>
      {card.citations.length ? (
        <ul aria-label={copy("Card citations")}>
          {card.citations.map((citation, index) => (
            <li key={index} lang="">
              {citation.sourceName}, {citation.locator}
              {citation.excerpt ? ` — ${citation.excerpt}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p>{copy("No countdown while you review this guidance. Continue when you are ready.")}</p>
      <button className="button" disabled={busy} onClick={onContinue} type="button">
        {copy(
          intervention.index + 1 < intervention.count
            ? "Next guidance card"
            : "Continue to recheck",
        )}
      </button>
    </section>
  );
}
