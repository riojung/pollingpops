"use client";

import type { PresentationHostSnapshot, SupportedLocale } from "@openround/contracts";
import {
  branchNavigationCopy,
  localizeBranchNavigationFeedback,
} from "../presentation/branch-navigation-copy";
import styles from "./presentation-branches.module.css";

export function PresentationBranches({
  branches,
  disabled,
  onFollow,
  locale = "en-CA",
}: {
  branches: NonNullable<PresentationHostSnapshot["branches"]>;
  disabled: boolean;
  onFollow: (branchId: string) => void;
  locale?: SupportedLocale;
}) {
  const copy = branchNavigationCopy(locale);
  if (!branches.length) return null;
  return (
    <section className={styles.branches} aria-label={copy("Answer branches")} lang={locale}>
      <h2>{copy("Answer branches")}</h2>
      <p>{copy("Choose an eligible branch after reveal. Next block keeps the numbered path.")}</p>
      <ul role="list">
        {branches.map((branch) => (
          <li key={branch.id}>
            <button
              type="button"
              className="button-quiet full-width"
              disabled={disabled || !branch.available}
              aria-describedby={branch.blockedReason ? `branch-reason-${branch.id}` : undefined}
              onClick={() => {
                if (branch.available && !disabled) onFollow(branch.id);
              }}
            >
              <span lang="">{branch.label}</span> · <span lang="">{branch.targetTitle}</span>
            </button>
            {branch.blockedReason ? (
              <p
                id={`branch-reason-${branch.id}`}
                lang={localizeBranchNavigationFeedback(locale, branch.blockedReason).lang}
              >
                {localizeBranchNavigationFeedback(locale, branch.blockedReason).text}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
