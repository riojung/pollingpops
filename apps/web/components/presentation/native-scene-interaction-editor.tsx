"use client";

import { useState, type ReactNode } from "react";
import {
  isSafePresentationLink,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { updateNativeNode, createNativeHotspotNode } from "../../lib/presentation-native-scene";
import styles from "./native-scene.module.css";
import { NativeInteractionSummary } from "./native-interaction-summary";

type InteractionNode = Extract<
  PresentationSceneNode,
  { type: "reveal" | "link" | "hotspot" | "dialog" | "navigation" }
>;
type LinkEntry = { source: string; value: string; error: string };

/** Unsafe or rejected URL entries stay local and never enter draft history or autosave. */
export function NativeSceneInteractionEditor({
  scene,
  node,
  onChange,
  navigationTargets = [],
  onPreview,
  previewUnavailableReason,
}: {
  scene: PresentationScene;
  node: InteractionNode | null;
  onChange: (scene: PresentationScene, historyField?: string) => boolean | void;
  navigationTargets?: readonly { id: string; title: string }[];
  onPreview?: () => void;
  previewUnavailableReason?: string;
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
  function withOverview(fields: ReactNode) {
    return (
      <>
        <NativeInteractionSummary
          scene={scene}
          node={node!}
          navigationTargets={navigationTargets}
          onPreview={onPreview}
          previewUnavailableReason={
            Object.keys(currentEntries).length
              ? "Correct the unsaved link entries on this slide before previewing."
              : previewUnavailableReason
          }
        />
        {fields}
      </>
    );
  }

  function update(next: InteractionNode, field: string) {
    const sceneVersion =
      next.type === "hotspot" ||
      next.type === "dialog" ||
      next.type === "navigation" ||
      (next.type === "reveal" && next.scope === "broadcast")
        ? 6
        : scene.schemaVersion;
    return onChange(
      {
        ...updateNativeNode(scene, next.id, () => next),
        schemaVersion: Math.max(
          scene.schemaVersion,
          sceneVersion,
        ) as PresentationScene["schemaVersion"],
      },
      `native:${next.id}:${field}`,
    );
  }

  if (node.type === "navigation")
    return withOverview(
      <div role="group" aria-label="Slide link editor">
        <label>
          Slide link label
          <input
            aria-label="Slide link label"
            maxLength={120}
            value={node.label}
            onChange={(event) => update({ ...node, label: event.target.value }, "label")}
          />
        </label>
        <label>
          Target slide or activity
          <select
            aria-label="Target slide or activity"
            value={
              navigationTargets.find(
                (target) => target.id.toLowerCase() === node.targetBlockId?.toLowerCase(),
              )?.id ??
              node.targetBlockId ??
              ""
            }
            onChange={(event) =>
              update({ ...node, targetBlockId: event.target.value || null }, "targetBlockId")
            }
          >
            <option value="">Choose target</option>
            {node.targetBlockId &&
            !navigationTargets.some(
              (target) => target.id.toLowerCase() === node.targetBlockId?.toLowerCase(),
            ) ? (
              <option value={node.targetBlockId}>Unavailable target — select another</option>
            ) : null}
            {navigationTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.title}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.help}>
          The facilitator follows this link for everyone during a live session. Shared readers
          navigate only their own copy. Hidden slides, rechecks and this slide cannot be targets.
        </p>
      </div>,
    );

  if (node.type === "hotspot" || node.type === "dialog")
    return withOverview(
      <div
        role="group"
        aria-label={node.type === "hotspot" ? "Image hotspot editor" : "Detail dialog editor"}
      >
        <label>
          Detail button label
          <input
            aria-label="Detail button label"
            maxLength={120}
            value={node.label}
            onChange={(event) => update({ ...node, label: event.target.value }, "label")}
          />
        </label>
        <label>
          Detail title
          <input
            aria-label="Detail title"
            maxLength={160}
            value={node.detailTitle}
            onChange={(event) =>
              update({ ...node, detailTitle: event.target.value }, "detailTitle")
            }
          />
        </label>
        <label>
          Detail audience content
          <textarea
            aria-label="Detail audience content"
            data-native-text-input="true"
            maxLength={4000}
            rows={5}
            value={node.body}
            onChange={(event) => update({ ...node, body: event.target.value }, "body")}
          />
        </label>
        {node.type === "hotspot" ? (
          <label>
            Hotspot image
            <select
              aria-label="Hotspot image"
              value={node.imageNodeId ?? ""}
              onChange={(event) => {
                const image = scene.nodes.find(
                  (candidate) => candidate.id === event.target.value && candidate.type === "image",
                );
                const positioned = createNativeHotspotNode(
                  image?.type === "image" ? image : undefined,
                );
                update(
                  { ...node, imageNodeId: image?.id ?? null, frame: positioned.frame, rotation: 0 },
                  "imageNodeId",
                );
              }}
            >
              <option value="">Choose image</option>
              {scene.nodes.flatMap((candidate) =>
                candidate.type === "image"
                  ? [
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.altText || "Image"}
                        {candidate.rotation ? " · rotate to 0° before publishing" : ""}
                      </option>,
                    ]
                  : [],
              )}
            </select>
          </label>
        ) : null}
        <p className={styles.help}>
          Details open only on the viewer’s screen. This is audience content.{" "}
          {node.type === "hotspot"
            ? "Keep the hotspot inside its unrotated image; moving or resizing the image carries its hotspots."
            : "The dialog supports keyboard opening, Escape and focus return."}
        </p>
      </div>,
    );

  if (node.type === "reveal")
    return withOverview(
      <div role="group" aria-label="Reveal panel editor">
        <label>
          Reveal audience
          <select
            aria-label="Reveal audience"
            value={node.scope}
            onChange={(event) =>
              update({ ...node, scope: event.target.value as "local" | "broadcast" }, "scope")
            }
          >
            <option value="local">This screen only</option>
            <option value="broadcast">Facilitator reveals for everyone</option>
          </select>
        </label>
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
          {node.scope === "broadcast"
            ? "During live delivery, only the facilitator changes this reveal for everyone. Its content is withheld from audience snapshots while closed. Shared readers open it locally."
            : "This content is available to every viewer. Each viewer opens and closes their own panel."}
          Add a label and audience content before publishing.
        </p>
      </div>,
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
  return withOverview(
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
    </div>,
  );
}
