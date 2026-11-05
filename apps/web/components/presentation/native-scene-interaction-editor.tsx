"use client";

import { useState } from "react";
import {
  isSafePresentationLink,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { updateNativeNode } from "../../lib/presentation-native-scene";
import styles from "./native-scene.module.css";

type InteractionNode = Extract<PresentationSceneNode, { type: "reveal" | "link" }>;
type LinkEntry = { source: string; value: string; error: string };

/** Unsafe or rejected URL entries stay local and never enter draft history or autosave. */
export function NativeSceneInteractionEditor({
  scene,
  node,
  onChange,
}: {
  scene: PresentationScene;
  node: InteractionNode | null;
  onChange: (scene: PresentationScene, historyField?: string) => boolean | void;
}) {
  const [entries, setEntries] = useState<Record<string, LinkEntry>>({});
  // Preserve incomplete entries while selecting other objects or moving them, but honor
  // recovered drafts and Undo/Redo whenever the saved destination changes or is removed.
  const currentEntries = Object.fromEntries(
    Object.entries(entries).filter(([id, entry]) =>
      scene.nodes.some(
        (candidate) =>
          candidate.id === id && candidate.type === "link" && candidate.href === entry.source,
      ),
    ),
  );
  if (Object.keys(currentEntries).length !== Object.keys(entries).length)
    setEntries(currentEntries);
  if (!node) return null;

  function update(next: InteractionNode, field: string) {
    return onChange(
      updateNativeNode(scene, next.id, () => next),
      `native:${next.id}:${field}`,
    );
  }

  if (node.type === "reveal")
    return (
      <div role="group" aria-label="Reveal panel editor">
        <label>
          Reveal panel label
          <input
            aria-label="Reveal panel label"
            maxLength={120}
            value={node.label}
            onChange={(event) => update({ ...node, label: event.target.value }, "label")}
          />
        </label>
        <label>
          Revealed audience content
          <textarea
            aria-label="Revealed audience content"
            aria-describedby={`native-reveal-${node.id}-help`}
            data-native-text-input="true"
            maxLength={4000}
            rows={5}
            value={node.body}
            onChange={(event) => update({ ...node, body: event.target.value }, "body")}
          />
        </label>
        <p className={styles.help} id={`native-reveal-${node.id}-help`}>
          This content is available to every viewer. Each viewer opens and closes their own panel.
          Add a label and audience content before publishing.
        </p>
      </div>
    );

  const entry = currentEntries[node.id];
  const errorId = `native-link-${node.id}-error`;
  function editUrl(value: string) {
    if (!node || node.type !== "link") return;
    let error = "";
    if (value && !isSafePresentationLink(value)) {
      error =
        "This URL is not saved. Use a complete HTTP or HTTPS link without spaces or sign-in credentials.";
    } else if (update({ ...node, href: value }, "href") === false) {
      error =
        "This URL could not be saved. Your entry is retained; reduce slide content and try again.";
    }
    setEntries((current) => {
      const next = { ...current };
      if (error) next[node.id] = { source: node.href, value, error };
      else delete next[node.id];
      return next;
    });
  }
  return (
    <div role="group" aria-label="Link editor">
      <label>
        Link label
        <input
          aria-label="Link label"
          maxLength={120}
          value={node.label}
          onChange={(event) => update({ ...node, label: event.target.value }, "label")}
        />
      </label>
      <label>
        Link URL
        <input
          aria-label="Link URL"
          type="url"
          maxLength={2048}
          value={entry?.value ?? node.href}
          aria-invalid={Boolean(entry?.error)}
          aria-describedby={entry?.error ? errorId : undefined}
          onChange={(event) => editUrl(event.target.value)}
        />
      </label>
      <p className={styles.help}>
        Add a label and a complete HTTP or HTTPS URL before publishing. The link opens an external
        website when a viewer chooses it.
      </p>
      {entry?.error ? (
        <p id={errorId} className={styles.formatError} role="alert">
          {entry.error}
        </p>
      ) : null}
    </div>
  );
}
