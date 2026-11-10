"use client";

import type { PresentationScene, SupportedLocale } from "@openround/contracts";
import { nativeInteractionMapItems } from "../../lib/presentation-native-interaction-map";
import { containNativeInteractionKey } from "./native-scene-interaction-view";
import { nativeInteractionCopy } from "./native-interaction-copy";
import {
  nativeInteractionDisplay,
  nativeInteractionImageAssociation,
} from "./native-interaction-summary";
import { EditorIcon } from "./presentation-editor-chrome";
import styles from "./native-scene-interaction-map.module.css";

/** Editor-only selection cues; no action in this map runs an authored interaction. */
export function NativeSceneInteractionMap({
  scene,
  selectedNodeIds,
  navigationTargets = [],
  expanded,
  onExpandedChange,
  onSelect,
  onEdit,
  locale = "en-CA",
}: {
  scene: PresentationScene;
  locale?: SupportedLocale;
  selectedNodeIds: readonly string[];
  navigationTargets?: readonly { id: string; title: string }[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (id: string) => void;
  onEdit?: (id: string) => void;
}) {
  const copy = nativeInteractionCopy(locale);
  const items = nativeInteractionMapItems(scene, navigationTargets).map((item) => ({
    ...item,
    display: nativeInteractionDisplay(scene, item.node, navigationTargets, locale),
  }));
  if (!items.length) return null;
  const selected = items.find((item) => item.node.id === selectedNodeIds.at(-1));
  return (
    <section
      className={styles.map}
      aria-label={copy("Interaction map")}
      lang={locale}
      data-native-interaction-map="true"
      onKeyDown={containNativeInteractionKey}
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          <EditorIcon name="interaction" />
          <span>{copy(expanded ? "Hide interaction map" : "Show interaction map")}</span>
          <EditorIcon name="chevron-down" />
        </button>
        <span className={styles.count}>
          {copy(items.length === 1 ? "{count} interaction" : "{count} interactions", {
            count: items.length,
          })}
        </span>
      </div>
      {expanded ? (
        <div className={styles.content}>
          <p className={styles.help}>
            {copy(
              "Select an action to see its trigger and outcome. Use Content tools to configure and test it.",
            )}
          </p>
          <div className={styles.body}>
            <ol className={styles.actions} role="list" aria-label={copy("Slide interactions")}>
              {items.map((item) => (
                <li key={item.node.id}>
                  <button
                    type="button"
                    className={styles.action}
                    aria-pressed={item.node.id === selectedNodeIds.at(-1)}
                    onClick={() => onSelect(item.node.id)}
                  >
                    <span className={styles.ordinal}>{item.ordinal}</span>{" "}
                    <EditorIcon name={item.node.type} />{" "}
                    <span className={styles.actionText}>
                      <span className={styles.kind}>{item.display.kind}</span>{" "}
                      <strong>{item.display.label}</strong>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {selected ? (
              <section
                key={selected.node.id}
                className={styles.connection}
                aria-label={copy("Selected interaction connection")}
                data-native-interaction-connection="true"
                tabIndex={0}
              >
                <div className={styles.route}>
                  <dl>
                    <dt>{copy("Trigger")}</dt>
                    <dd>
                      <strong>
                        {selected.ordinal}. {selected.display.label}
                      </strong>
                      <p>{selected.display.trigger}</p>
                    </dd>
                  </dl>
                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                  <dl>
                    <dt>{copy("Outcome")}</dt>
                    <dd>
                      <strong>{selected.display.targetLabel}</strong>
                      <p>{selected.display.result}</p>
                    </dd>
                  </dl>
                </div>
                {selected.imageTarget ? (
                  <p className={styles.association}>
                    <EditorIcon name="image" />
                    <span>
                      {nativeInteractionImageAssociation(selected.imageTarget.altText, locale)}
                    </span>
                  </p>
                ) : null}
                <p className={styles.audience}>{selected.display.audience}</p>
                {selected.display.issues.length ? (
                  <div className={styles.guidance}>
                    <strong>{copy("Check in Content tools")}</strong>
                    <ul>
                      {selected.display.issues.map((issue) => (
                        <li key={issue.text} lang={issue.language}>
                          {issue.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {onEdit ? (
                  <button
                    type="button"
                    className={styles.edit}
                    onClick={(event) => {
                      // Safari pointer activation must record the actual drawer opener.
                      event.currentTarget.focus({ preventScroll: true });
                      onEdit(selected.node.id);
                    }}
                  >
                    <EditorIcon name="content" />
                    <span>{copy("Edit interaction")}</span>
                  </button>
                ) : null}
              </section>
            ) : (
              <p className={styles.help}>
                {copy("Choose an interaction to see its trigger and outcome.")}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
