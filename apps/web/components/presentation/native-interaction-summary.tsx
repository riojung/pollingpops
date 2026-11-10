"use client";

import { Fragment, type ReactNode } from "react";
import {
  isSafePresentationLink,
  type PresentationScene,
  type SupportedLocale,
} from "@openround/contracts";
import {
  describeNativeInteraction,
  type NativeInteractionNode,
} from "../../lib/presentation-native-interaction-map";
import {
  nativeInteractionCopy,
  nativeInteractionIssueCopy,
  nativeInteractionKindKeys,
  type NativeInteractionCopyKey,
} from "./native-interaction-copy";
import styles from "./native-interaction-summary.module.css";

export { describeNativeInteraction } from "../../lib/presentation-native-interaction-map";

/** Authored content has no language metadata in these node contracts. */
function authored(value: string) {
  return <span lang="">{value}</span>;
}
function phrase(
  copy: ReturnType<typeof nativeInteractionCopy>,
  key: NativeInteractionCopyKey,
  values: Record<string, ReactNode>,
) {
  return copy(key)
    .split(/(\{\w+\})/g)
    .map((part, index) => (
      <Fragment key={index}>
        {/^\{\w+\}$/.test(part) ? (values[part.slice(1, -1)] ?? part) : part}
      </Fragment>
    ));
}

export function nativeInteractionImageAssociation(
  altText: string | null | undefined,
  locale: SupportedLocale = "en-CA",
) {
  const copy = nativeInteractionCopy(locale);
  return phrase(copy, "On image: {image}", {
    image: altText?.trim() ? authored(altText.trim()) : copy("Image description needed"),
  });
}

/** Display adapter: source structure distinguishes generated UI from authored English collisions. */
export function nativeInteractionDisplay(
  scene: PresentationScene,
  node: NativeInteractionNode,
  navigationTargets: readonly { id: string; title: string }[],
  locale: SupportedLocale = "en-CA",
) {
  const copy = nativeInteractionCopy(locale);
  const summary = describeNativeInteraction(scene, node, navigationTargets);
  const label = node.label.trim() ? authored(node.label.trim()) : copy("the interaction");
  const kind = copy(nativeInteractionKindKeys[node.type]);
  let trigger: ReactNode = phrase(copy, "Choose “{label}”.", { label });
  let result: ReactNode;
  let targetLabel: ReactNode;
  let audience = copy("Each viewer opens this on their own screen.");
  if (node.type === "reveal") {
    result = copy("Show or hide the panel’s audience content.");
    targetLabel = copy("Audience content in this panel");
    if (node.scope === "broadcast") {
      trigger = phrase(copy, "The facilitator chooses “{label}” during a live session.", { label });
      audience = copy("Live: reveal for everyone. Preview and shared links: this screen only.");
    }
  } else if (node.type === "link") {
    result = isSafePresentationLink(node.href)
      ? phrase(copy, "Open {url} in a new tab.", { url: authored(node.href) })
      : copy("Open the linked website in a new tab.");
    targetLabel = copy("External website");
    audience = copy("The person following the link leaves for an external website in a new tab.");
  } else if (node.type === "navigation") {
    const target = navigationTargets.find(
      (candidate) => candidate.id.toLowerCase() === node.targetBlockId?.toLowerCase(),
    );
    result = target
      ? phrase(copy, "Go to “{title}”.", { title: authored(target.title) })
      : copy("Go to the chosen slide or activity.");
    targetLabel = target ? authored(target.title) : copy("Choose a slide or activity");
    trigger = phrase(
      copy,
      "The facilitator chooses “{label}” live; readers choose it in their shared copy.",
      { label },
    );
    audience = copy("Live: move everyone. Preview and shared links: move this reader only.");
  } else {
    result = node.detailTitle.trim()
      ? phrase(copy, "Open the detail dialog “{title}”.", { title: authored(node.detailTitle) })
      : copy("Open the detail dialog.");
    targetLabel = node.detailTitle.trim()
      ? authored(node.detailTitle.trim())
      : copy("Detail dialog");
    if (node.type === "hotspot") {
      const image = scene.nodes.find((candidate) => candidate.id === node.imageNodeId);
      if (image?.type === "image") {
        trigger = phrase(copy, "Choose “{label}” on {image}.", {
          label,
          image: image.altText?.trim() ? authored(image.altText.trim()) : copy("the linked image"),
        });
      }
    }
  }
  return {
    label: node.label.trim() ? authored(node.label.trim()) : kind,
    kind,
    trigger,
    result,
    targetLabel,
    audience,
    issues: summary.issues.map((issue) => nativeInteractionIssueCopy(locale, issue)),
  };
}

export function NativeInteractionSummary({
  scene,
  node,
  navigationTargets = [],
  onPreview,
  previewUnavailableReason,
  locale = "en-CA",
}: {
  scene: PresentationScene;
  node: NativeInteractionNode;
  navigationTargets?: readonly { id: string; title: string }[];
  onPreview?: () => void;
  previewUnavailableReason?: string;
  locale?: SupportedLocale;
}) {
  const copy = nativeInteractionCopy(locale);
  const summary = nativeInteractionDisplay(scene, node, navigationTargets, locale);
  const issues = [
    ...summary.issues,
    ...(previewUnavailableReason
      ? [nativeInteractionIssueCopy(locale, previewUnavailableReason)]
      : []),
  ];
  return (
    <section className={styles.summary} aria-label={copy("Interaction overview")} lang={locale}>
      <details>
        <summary>{copy("How this interaction works")}</summary>
        <dl>
          <div>
            <dt>{copy("Trigger")}</dt>
            <dd>{summary.trigger}</dd>
          </div>
          <div>
            <dt>{copy("Result")}</dt>
            <dd>{summary.result}</dd>
          </div>
          <div>
            <dt>{copy("Audience")}</dt>
            <dd>{summary.audience}</dd>
          </div>
        </dl>
      </details>
      {issues.length ? (
        <div className={styles.guidance}>
          <strong>{copy("Before you try it")}</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue.text} lang={issue.language}>
                {issue.text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.ready}>{copy("Ready to try on this slide.")}</p>
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
            {copy("Preview this slide")}
          </button>
          <p className={styles.help}>
            {copy(
              "Try the actions on your screen. Preview does not start a live session or publish changes.",
            )}
          </p>
        </>
      ) : null}
    </section>
  );
}
