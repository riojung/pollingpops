"use client";

import type { PresentationScene } from "@openround/contracts";
import {
  describeNativeInteraction,
  type NativeInteractionNode,
} from "../../lib/presentation-native-interaction-map";
import styles from "./native-interaction-summary.module.css";

export { describeNativeInteraction } from "../../lib/presentation-native-interaction-map";

export function NativeInteractionSummary({
  scene,
  node,
  navigationTargets = [],
  onPreview,
  previewUnavailableReason,
}: {
  scene: PresentationScene;
  node: NativeInteractionNode;
  navigationTargets?: readonly { id: string; title: string }[];
  onPreview?: () => void;
  previewUnavailableReason?: string;
}) {
  const summary = describeNativeInteraction(scene, node, navigationTargets);
  const issues = [
    ...summary.issues,
    ...(previewUnavailableReason ? [previewUnavailableReason] : []),
  ];
  return (
    <section className={styles.summary} aria-label="Interaction overview">
      <details>
        <summary>How this interaction works</summary>
        <dl>
          <div>
            <dt>Trigger</dt>
            <dd>{summary.trigger}</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>{summary.result}</dd>
          </div>
          <div>
            <dt>Audience</dt>
            <dd>{summary.audience}</dd>
          </div>
        </dl>
      </details>
      {issues.length ? (
        <div className={styles.guidance}>
          <strong>Before you try it</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.ready}>Ready to try on this slide.</p>
      )}
      {onPreview ? (
        <>
          <button
            type="button"
            disabled={issues.length > 0}
            onClick={(event) => {
              if (issues.length) return;
              // Safari pointer activation does not always focus a button. The preview's
              // focus return must remember this actual invoking control.
              event.currentTarget.focus({ preventScroll: true });
              onPreview();
            }}
          >
            Preview this slide
          </button>
          <p className={styles.help}>
            Try the actions on your screen. Preview does not start a live session or publish
            changes.
          </p>
        </>
      ) : null}
    </section>
  );
}
