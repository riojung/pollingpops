"use client";

import { useState, type ReactNode } from "react";
import {
  isSafePresentationLink,
  type PresentationScene,
  type PresentationSceneNode,
  type SupportedLocale,
} from "@openround/contracts";
import { updateNativeNode, createNativeHotspotNode } from "../../lib/presentation-native-scene";
import styles from "./native-scene.module.css";
import { nativeInteractionCopy, type NativeInteractionCopyKey } from "./native-interaction-copy";
import { NativeInteractionSummary } from "./native-interaction-summary";

type InteractionNode = Extract<
  PresentationSceneNode,
  { type: "reveal" | "link" | "hotspot" | "dialog" | "navigation" }
>;
type LinkEntry = { source: string; value: string; error: NativeInteractionCopyKey };

/** Unsafe or rejected URL entries stay local and never enter draft history or autosave. */
export function NativeSceneInteractionEditor({
  scene,
  disabled = false,
  node,
  onChange,
  navigationTargets = [],
  onPreview,
  previewUnavailableReason,
  locale = "en-CA",
}: {
  scene: PresentationScene;
  locale?: SupportedLocale;
  disabled?: boolean;
  node: InteractionNode | null;
  onChange: (scene: PresentationScene, historyField?: string) => boolean | void;
  navigationTargets?: readonly { id: string; title: string }[];
  onPreview?: () => void;
  previewUnavailableReason?: string;
}) {
  const copy = nativeInteractionCopy(locale);
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
          locale={locale}
          node={node!}
          navigationTargets={navigationTargets}
          onPreview={onPreview}
          previewUnavailableReason={
            Object.keys(currentEntries).length
              ? "Correct the unsaved link entries on this slide before previewing."
              : previewUnavailableReason
          }
        />
        {disabled ? (
          <fieldset disabled className={styles.permissionControls}>
            {fields}
          </fieldset>
        ) : (
          fields
        )}
      </>
    );
  }

  function update(next: InteractionNode, field: string) {
    if (disabled) return false;
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
      <div role="group" aria-label={copy("Slide link editor")} lang={locale}>
        <label>
          {copy("Slide link label")}
          <input
            aria-label={copy("Slide link label")}
            maxLength={120}
            lang=""
            value={node.label}
            onChange={(event) => update({ ...node, label: event.target.value }, "label")}
          />
        </label>
        <label>
          {copy("Target slide or activity")}
          <select
            aria-label={copy("Target slide or activity")}
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
            <option value="">{copy("Choose target")}</option>
            {node.targetBlockId &&
            !navigationTargets.some(
              (target) => target.id.toLowerCase() === node.targetBlockId?.toLowerCase(),
            ) ? (
              <option value={node.targetBlockId}>
                {copy("Unavailable target — select another")}
              </option>
            ) : null}
            {navigationTargets.map((target) => (
              <option key={target.id} value={target.id} lang="">
                {target.title}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.help}>
          {copy(
            "The facilitator follows this link for everyone during a live session. Shared readers navigate only their own copy. Hidden slides, rechecks and this slide cannot be targets.",
          )}
        </p>
      </div>,
    );

  if (node.type === "hotspot" || node.type === "dialog")
    return withOverview(
      <div
        role="group"
        aria-label={copy(node.type === "hotspot" ? "Image hotspot editor" : "Detail dialog editor")}
        lang={locale}
      >
        <label>
          {copy("Detail button label")}
          <input
            aria-label={copy("Detail button label")}
            maxLength={120}
            lang=""
            value={node.label}
            onChange={(event) => update({ ...node, label: event.target.value }, "label")}
          />
        </label>
        <label>
          {copy("Detail title")}
          <input
            aria-label={copy("Detail title")}
            maxLength={160}
            lang=""
            value={node.detailTitle}
            onChange={(event) =>
              update({ ...node, detailTitle: event.target.value }, "detailTitle")
            }
          />
        </label>
        <label>
          {copy("Detail audience content")}
          <textarea
            aria-label={copy("Detail audience content")}
            data-native-text-input="true"
            maxLength={4000}
            rows={5}
            lang=""
            value={node.body}
            onChange={(event) => update({ ...node, body: event.target.value }, "body")}
          />
        </label>
        {node.type === "hotspot" ? (
          <label>
            {copy("Hotspot image")}
            <select
              aria-label={copy("Hotspot image")}
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
              <option value="">{copy("Choose image")}</option>
              {scene.nodes.flatMap((candidate) =>
                candidate.type === "image"
                  ? [
                      <option
                        key={candidate.id}
                        value={candidate.id}
                        lang={candidate.altText ? "" : locale}
                      >
                        {candidate.altText || copy("Image")}
                        {candidate.rotation ? copy(" · rotate to 0° before publishing") : ""}
                      </option>,
                    ]
                  : [],
              )}
            </select>
          </label>
        ) : null}
        <p className={styles.help}>
          {copy("Details open only on the viewer’s screen. This is audience content.")}{" "}
          {copy(
            node.type === "hotspot"
              ? "Keep the hotspot inside its unrotated image; moving or resizing the image carries its hotspots."
              : "The dialog supports keyboard opening, Escape and focus return.",
          )}
        </p>
      </div>,
    );

  if (node.type === "reveal")
    return withOverview(
      <div role="group" aria-label={copy("Reveal panel editor")} lang={locale}>
        <label>
          {copy("Reveal audience")}
          <select
            aria-label={copy("Reveal audience")}
            value={node.scope}
            onChange={(event) =>
              update({ ...node, scope: event.target.value as "local" | "broadcast" }, "scope")
            }
          >
            <option value="local">{copy("This screen only")}</option>
            <option value="broadcast">{copy("Facilitator reveals for everyone")}</option>
          </select>
        </label>
        <label>
          {copy("Reveal panel label")}
          <input
            aria-label={copy("Reveal panel label")}
            maxLength={120}
            lang=""
            value={node.label}
            onChange={(event) => update({ ...node, label: event.target.value }, "label")}
          />
        </label>
        <label>
          {copy("Revealed audience content")}
          <textarea
            aria-label={copy("Revealed audience content")}
            aria-describedby={`native-reveal-${node.id}-help`}
            data-native-text-input="true"
            maxLength={4000}
            rows={5}
            lang=""
            value={node.body}
            onChange={(event) => update({ ...node, body: event.target.value }, "body")}
          />
        </label>
        <p className={styles.help} id={`native-reveal-${node.id}-help`}>
          {copy(
            node.scope === "broadcast"
              ? "During live delivery, only the facilitator changes this reveal for everyone. Its content is withheld from audience snapshots while closed. Shared readers open it locally."
              : "This content is available to every viewer. Each viewer opens and closes their own panel.",
          )}{" "}
          {copy("Add a label and audience content before publishing.")}
        </p>
      </div>,
    );

  const entry = currentEntries[node.id];
  const errorId = `native-link-${node.id}-error`;
  function editUrl(value: string) {
    if (disabled || !node || node.type !== "link") return;
    let error: NativeInteractionCopyKey | "" = "";
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
    <div role="group" aria-label={copy("Link editor")} lang={locale}>
      <label>
        {copy("Link label")}
        <input
          aria-label={copy("Link label")}
          maxLength={120}
          lang=""
          value={node.label}
          onChange={(event) => update({ ...node, label: event.target.value }, "label")}
        />
      </label>
      <label>
        {copy("Link URL")}
        <input
          aria-label={copy("Link URL")}
          type="url"
          maxLength={2048}
          lang=""
          value={entry?.value ?? node.href}
          aria-invalid={Boolean(entry?.error)}
          aria-describedby={entry?.error ? errorId : undefined}
          onChange={(event) => editUrl(event.target.value)}
        />
      </label>
      <p className={styles.help}>
        {copy(
          "Add a label and a complete HTTP or HTTPS URL before publishing. The link opens an external website when a viewer chooses it.",
        )}
      </p>
      {entry?.error ? (
        <p id={errorId} className={styles.formatError} role="alert">
          {copy(entry.error)}
        </p>
      ) : null}
    </div>,
  );
}
