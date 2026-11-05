"use client";

import type { PresentationHostSnapshot } from "@openround/contracts";
import styles from "./presentation-branches.module.css";

export function PresentationBranches({
  branches,
  disabled,
  onFollow,
}: {
  branches: NonNullable<PresentationHostSnapshot["branches"]>;
  disabled: boolean;
  onFollow: (branchId: string) => void;
}) {
  if (!branches.length) return null;
  return (
    <section className={styles.branches} aria-label="Answer branches" lang="en-CA">
      <h2>Answer branches</h2>
      <p>Choose an eligible branch after reveal. Next block keeps the numbered path.</p>
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
              <p id={`branch-reason-${branch.id}`}>{branch.blockedReason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
