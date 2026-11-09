"use client";

import { isSafePresentationLink, type PresentationScene } from "@openround/contracts";
import type { NativeInteractionNode } from "./native-scene-interaction-view";
import styles from "./native-interaction-summary.module.css";

export function describeNativeInteraction(
  scene: PresentationScene,
  node: NativeInteractionNode,
  navigationTargets: readonly { id: string; title: string }[],
) {
  const issues: string[] = [];
  if (!node.label.trim()) issues.push("Add a clear button or link label.");
  const label = node.label.trim() || "the interaction";
  let trigger = `Choose “${label}”.`;
  let result: string;
  let audience = "Each viewer opens this on their own screen.";
  if (node.type === "reveal") {
    result = "Show or hide the panel’s audience content.";
    if (!node.body.trim()) issues.push("Add the audience content to reveal.");
    if (node.scope === "broadcast") {
      trigger = `The facilitator chooses “${label}” during a live session.`;
      audience = "Live: reveal for everyone. Preview and shared links: this screen only.";
    }
  } else if (node.type === "link") {
    result = isSafePresentationLink(node.href)
      ? `Open ${node.href} in a new tab.`
      : "Open the linked website in a new tab.";
    audience = "The person following the link leaves for an external website in a new tab.";
    if (!isSafePresentationLink(node.href)) issues.push("Add a complete, safe HTTP or HTTPS URL.");
  } else if (node.type === "navigation") {
    const target = navigationTargets.find(
      (candidate) => candidate.id.toLowerCase() === node.targetBlockId?.toLowerCase(),
    );
    result = target ? `Go to “${target.title}”.` : "Go to the chosen slide or activity.";
    trigger = `The facilitator chooses “${label}” live; readers choose it in their shared copy.`;
    audience = "Live: move everyone. Preview and shared links: move this reader only.";
    if (!target) issues.push("Choose an available target slide or activity.");
  } else {
    result = `Open the detail dialog${node.detailTitle.trim() ? ` “${node.detailTitle}”` : ""}.`;
    if (!node.detailTitle.trim()) issues.push("Add a detail title.");
    if (!node.body.trim()) issues.push("Add the audience content for the dialog.");
    if (node.type === "hotspot") {
      const image = scene.nodes.find((candidate) => candidate.id === node.imageNodeId);
      if (image?.type === "image") {
        trigger = `Choose “${label}” on ${image.altText?.trim() || "the linked image"}.`;
        if (
          (image.rotation ?? 0) !== 0 ||
          (node.rotation ?? 0) !== 0 ||
          node.frame.x < image.frame.x ||
          node.frame.y < image.frame.y ||
          node.frame.x + node.frame.width > image.frame.x + image.frame.width ||
          node.frame.y + node.frame.height > image.frame.y + image.frame.height
        )
          issues.push("Keep the hotspot inside its unrotated image.");
      } else issues.push("Choose the image for this hotspot.");
    }
  }
  return { trigger, result, audience, issues };
}

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
