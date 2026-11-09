"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  CanvasColorSchema,
  CanvasShapeVariantSchema,
  PRESENTATION_SCENE_MAX_NODES,
  PRESENTATION_TEXT_LANGUAGES,
  PresentationTextLanguageSchema,
  PresentationSceneDraftSchema,
  plainTextToPresentationRichText,
  presentationRichTextToPlainText,
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneNode,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import { setNativeTextLanguage } from "../../lib/presentation-native-text-language";
import {
  boundNativeSceneFrame,
  createNativeLinkNode,
  createNativeRevealNode,
  createNativeDialogNode,
  createNativeHotspotNode,
  createNativeNavigationNode,
  nativeNodeLabel,
  reorderNativeNode,
  updateNativeNode,
} from "../../lib/presentation-native-scene";
import { type SceneImageRenderer } from "./native-scene-view";
import { NativeSceneCanvas } from "./native-scene-canvas";
import { NativeRichTextEditor } from "./native-rich-text-editor";
import { NativeSceneCompositionControls } from "./native-scene-composition-controls";
import { NativeSceneVideoControls } from "./native-scene-video-controls";
import { NativeSceneDataEditor } from "./native-scene-data-editor";
import { NativeSceneInteractionEditor } from "./native-scene-interaction-editor";
import { createNativeChartNode, createNativeTableNode } from "../../lib/presentation-native-data";
import {
  NativeSceneArrangementControls,
  NativeSceneDesignControls,
  NativeSceneImageDesignControls,
  NativeSceneLayoutControls,
} from "./native-scene-design-controls";
import {
  moveNativeSceneNodes,
  removeNativeSceneNodes,
  expandNativeSceneSelection,
  synchronizeNativeHotspots,
} from "../../lib/presentation-native-geometry";
import styles from "./native-scene.module.css";
import { isNativeInteractionNode } from "./native-scene-interaction-view";

const shapes = [
  ...CanvasShapeVariantSchema.options,
  "ellipse",
  "diamond",
  "parallelogram",
] as const;
const anchors = ["center", "top", "right", "bottom", "left"] as const;

export function NativeSceneEditor({
  scene,
  onChange: onSceneChange,
  renderImage,
  uploadsEnabled,
  mediaState,
  attachmentPending = false,
  onUploadImage,
  onUndo,
  onRedo,
  onApplyDesignToDeck,
  navigationTargets,
  onTextAssistance,
  textAssistanceDisabled = false,
  inspectorTarget,
  inspectorSection = "content",
  onInspectSelection,
}: {
  scene: PresentationScene;
  onChange: (scene: PresentationScene, historyField?: string) => boolean | void;
  renderImage: SceneImageRenderer;
  uploadsEnabled: boolean;
  mediaState: "idle" | "uploading" | "scanning";
  attachmentPending?: boolean;
  onUploadImage: (file: File, altText: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onApplyDesignToDeck?: (design: PresentationSceneDesign) => void;
  navigationTargets?: readonly { id: string; title: string }[];
  onTextAssistance?: (nodeId: string, operation: "rewrite" | "shorten" | "translate") => void;
  textAssistanceDisabled?: boolean;
  /** Undefined keeps standalone controls inline; null waits for the shell's inspector. */
  inspectorTarget?: HTMLElement | null;
  inspectorSection?: "content" | "layout" | "media" | "accessibility";
  onInspectSelection?: () => void;
}) {
  const [selection, setSelection] = useState<string[]>([scene.nodes[0]!.id]);
  const [imageAlt, setImageAlt] = useState("");
  const [formatError, setFormatError] = useState("");
  const [changeFailure, setChangeFailure] = useState<{
    scene: PresentationScene;
    message: string;
  } | null>(null);
  const validSelection = selection.filter((id) => scene.nodes.some((node) => node.id === id));
  const selectedIds = expandNativeSceneSelection(
    scene,
    validSelection.length ? validSelection : [scene.nodes[0]!.id],
  );
  const selected = scene.nodes.find((node) => node.id === selectedIds.at(-1))!;
  const multiple = selectedIds.length > 1;
  const canMoveSelection = scene.nodes.some(
    (node) => selectedIds.includes(node.id) && node.type !== "connector",
  );
  function select(id: string, additive = false) {
    setSelection((current) => {
      const members = expandNativeSceneSelection(scene, [id]);
      if (!additive) return members;
      const valid = expandNativeSceneSelection(
        scene,
        current.filter((candidate) => scene.nodes.some((node) => node.id === candidate)),
      );
      if (!members.every((id) => valid.includes(id)))
        return [...valid.filter((id) => !members.includes(id)), ...members];
      const remaining = valid.filter((id) => !members.includes(id));
      return remaining.length ? remaining : valid;
    });
  }
  function onChange(next: PresentationScene, historyField?: string) {
    if (next === scene) return false;
    next = synchronizeNativeHotspots(scene, next);
    const parsed = PresentationSceneDraftSchema.safeParse(next);
    if (!parsed.success) {
      setChangeFailure({
        scene,
        message:
          "This change cannot fit within the slide’s limits. Keep rotated objects inside the slide; shorten content or remove an object, then try again.",
      });
      return false;
    }
    setChangeFailure(null);
    if (onSceneChange(parsed.data, historyField) === false) {
      setChangeFailure({
        scene,
        message:
          "The Presentation could not accept this change. Reduce content and try again; the current slide is retained.",
      });
      return false;
    }
    return true;
  }
  const canAdd =
    mediaState === "idle" &&
    !attachmentPending &&
    scene.nodes.length < PRESENTATION_SCENE_MAX_NODES;
  const framed = scene.nodes.filter((node) => node.type !== "connector");
  const readingIndex = scene.readingOrder.indexOf(selected.id);
  function update(updater: (node: PresentationSceneNode) => PresentationSceneNode, field?: string) {
    onChange(
      updateNativeNode(scene, selected.id, updater),
      field ? `native:${selected.id}:${field}` : undefined,
    );
  }
  function add(node: PresentationSceneNode) {
    if (!canAdd) return;
    const minimumVersion =
      node.type === "hotspot" ||
      node.type === "dialog" ||
      node.type === "navigation" ||
      (node.type === "reveal" && node.scope === "broadcast")
        ? 6
        : node.type === "reveal" || node.type === "link"
          ? 5
          : node.type === "table" || node.type === "chart"
            ? 4
            : 1;
    const added = onChange({
      ...scene,
      schemaVersion: scene.schemaVersion >= minimumVersion ? scene.schemaVersion : minimumVersion,
      nodes: [...scene.nodes, node],
      readingOrder: [...scene.readingOrder, node.id],
    });
    if (added) {
      setSelection([node.id]);
      onInspectSelection?.();
    }
  }
  function requestTextAssistance(operation: "rewrite" | "shorten" | "translate") {
    if (
      textAssistanceDisabled ||
      multiple ||
      selected.type !== "text" ||
      selected.richText ||
      !selected.text.trim()
    )
      return;
    onTextAssistance?.(selected.id, operation);
  }
  function restoreHistory(action: () => void) {
    const active = document.activeElement;
    const textInput =
      active instanceof HTMLTextAreaElement && active.hasAttribute("data-native-text-input")
        ? active
        : null;
    const fields = textInput?.closest<HTMLElement>("[data-native-text-fields]");
    const start = textInput?.selectionStart ?? 0;
    const end = textInput?.selectionEnd ?? 0;
    action();
    if (!textInput || !fields) return;
    requestAnimationFrame(() => {
      // Undoing the first formatting action replaces the rich textarea with its plain sibling.
      // Keep keyboard history usable without taking focus from another control or a new slide.
      if (textInput.isConnected || !fields.isConnected || document.activeElement !== document.body)
        return;
      const replacement = fields.querySelector<HTMLTextAreaElement>("[data-native-text-input]");
      replacement?.focus({ preventScroll: true });
      replacement?.setSelectionRange(start, end);
    });
  }
  const inlineInspector = inspectorTarget === undefined;
  const sectionHidden = (section: typeof inspectorSection) =>
    !inlineInspector && inspectorSection !== section;
  // Keep every section mounted in one stable portal. Switching inspector tabs must not
  // reset object selection, rich-text formatting, or a partially entered media link.
  const inspector = (
    <div
      className={`${styles.controls} ${styles.contextInspector}`}
      aria-label="Native slide editor"
      lang="en-CA"
    >
      <div className={styles.selectionSummary}>
        <label>
          Selected object
          <select
            aria-label="Selected object"
            value={selected.id}
            onChange={(event) => select(event.target.value)}
          >
            {scene.readingOrder.map((id) => {
              const node = scene.nodes.find((item) => item.id === id)!;
              return (
                <option key={id} value={id}>
                  {nativeNodeLabel(node)}
                </option>
              );
            })}
          </select>
        </label>
        <p role="status" className={styles.help}>
          {selectedIds.length} {multiple ? "objects selected" : "object selected"}
        </p>
      </div>
      <div hidden={sectionHidden("content")} data-native-inspector-section="content">
        <fieldset
          data-native-text-fields="true"
          onKeyDown={(event) => {
            if (
              !(event.target instanceof HTMLTextAreaElement) ||
              !event.target.hasAttribute("data-native-text-input") ||
              event.altKey ||
              (!event.metaKey && !event.ctrlKey)
            )
              return;
            const key = event.key.toLowerCase();
            if (key !== "z" && !(event.ctrlKey && key === "y")) return;
            const action = key === "y" || event.shiftKey ? onRedo : onUndo;
            if (!action) return;
            event.preventDefault();
            event.stopPropagation();
            restoreHistory(action);
          }}
        >
          <legend>{multiple ? "Last selected object" : "Selected object"}</legend>
          <NativeSceneInteractionEditor
            scene={scene}
            node={isNativeInteractionNode(selected) ? selected : null}
            onChange={onChange}
            navigationTargets={navigationTargets}
          />
          {selected.type === "text" && onTextAssistance ? (
            <>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={
                    textAssistanceDisabled ||
                    multiple ||
                    Boolean(selected.richText) ||
                    !selected.text.trim()
                  }
                  onClick={() => requestTextAssistance("rewrite")}
                >
                  Rewrite text
                </button>
                <button
                  type="button"
                  disabled={
                    textAssistanceDisabled ||
                    multiple ||
                    Boolean(selected.richText) ||
                    !selected.text.trim()
                  }
                  onClick={() => requestTextAssistance("shorten")}
                >
                  Shorten text
                </button>
                <button
                  type="button"
                  disabled={
                    textAssistanceDisabled ||
                    multiple ||
                    Boolean(selected.richText) ||
                    !selected.text.trim()
                  }
                  onClick={() => requestTextAssistance("translate")}
                >
                  Translate text
                </button>
              </div>
              {selected.richText ? (
                <p>
                  Text assistance supports plain text only. Formatted text cannot be rewritten or
                  shortened. Translation also requires plain text.
                </p>
              ) : multiple ? (
                <p>Select one plain text object to use text assistance.</p>
              ) : !selected.text.trim() ? (
                <p>Enter some text before using text assistance.</p>
              ) : null}
            </>
          ) : null}
          {selected.type === "text" && selected.richText ? (
            <NativeRichTextEditor
              key={selected.id}
              node={selected}
              onUndo={onUndo ? () => restoreHistory(onUndo) : undefined}
              onRedo={onRedo ? () => restoreHistory(onRedo) : undefined}
              onChange={(node, field) => {
                const next = updateNativeNode(scene, selected.id, () => node);
                onChange(
                  { ...next, schemaVersion: scene.schemaVersion >= 2 ? scene.schemaVersion : 2 },
                  field ? `native:${selected.id}:${field}` : undefined,
                );
              }}
            />
          ) : selected.type === "text" ? (
            <>
              <label>
                {selected.role === "title" ? "Native slide title" : "Node text"}
                <textarea
                  data-native-text-input="true"
                  aria-label={selected.role === "title" ? "Native slide title" : "Node text"}
                  lang={selected.lang}
                  maxLength={selected.role === "title" ? 160 : 4000}
                  value={selected.text}
                  onChange={(event) =>
                    update(
                      (node) =>
                        node.type === "text" ? { ...node, text: event.target.value } : node,
                      "text",
                    )
                  }
                />
              </label>
              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={() => {
                    let richText;
                    try {
                      richText = plainTextToPresentationRichText(selected.text);
                    } catch {
                      setFormatError(
                        "This text cannot be formatted within the slide's limits. Use at most 100 paragraphs, remove unsupported control characters, or reduce the slide's content.",
                      );
                      return;
                    }
                    setFormatError("");
                    onChange({
                      ...updateNativeNode(scene, selected.id, () => ({
                        ...selected,
                        text: presentationRichTextToPlainText(richText),
                        richText,
                      })),
                      schemaVersion: scene.schemaVersion >= 2 ? scene.schemaVersion : 2,
                    });
                  }}
                >
                  Format text
                </button>
              </div>
              {formatError ? (
                <p role="alert" className={styles.formatError}>
                  {formatError}
                </p>
              ) : null}
            </>
          ) : null}
          {selected.type === "table" || selected.type === "chart" ? (
            <NativeSceneDataEditor
              key={selected.id}
              scene={scene}
              node={selected}
              onChange={onChange}
            />
          ) : null}
          {selected.type === "shape" ? (
            <>
              <label>
                Shape label
                <input
                  maxLength={200}
                  value={selected.label}
                  onChange={(event) =>
                    update(
                      (node) =>
                        node.type === "shape" ? { ...node, label: event.target.value } : node,
                      "label",
                    )
                  }
                />
              </label>
              <label>
                Shape
                <select
                  value={selected.shape}
                  onChange={(event) =>
                    update((node) =>
                      node.type === "shape"
                        ? { ...node, shape: event.target.value as typeof node.shape }
                        : node,
                    )
                  }
                >
                  {shapes.map((shape) => (
                    <option key={shape} value={shape}>
                      {shape.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {selected.type === "connector" ? (
            <>
              <label>
                Connector label
                <input
                  maxLength={200}
                  value={selected.label}
                  onChange={(event) =>
                    update(
                      (node) =>
                        node.type === "connector" ? { ...node, label: event.target.value } : node,
                      "label",
                    )
                  }
                />
              </label>
              {(["from", "to"] as const).map((side) => (
                <div key={side}>
                  <label>
                    {side === "from" ? "Connect from" : "Connect to"}
                    <select
                      value={selected[side].nodeId}
                      onChange={(event) =>
                        update((node) =>
                          node.type === "connector"
                            ? { ...node, [side]: { ...node[side], nodeId: event.target.value } }
                            : node,
                        )
                      }
                    >
                      {framed
                        .filter(
                          (node) => node.id !== selected[side === "from" ? "to" : "from"].nodeId,
                        )
                        .map((node) => (
                          <option key={node.id} value={node.id}>
                            {nativeNodeLabel(node)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {side === "from" ? "From anchor" : "To anchor"}
                    <select
                      value={selected[side].anchor}
                      onChange={(event) =>
                        update((node) =>
                          node.type === "connector"
                            ? {
                                ...node,
                                [side]: {
                                  ...node[side],
                                  anchor: event.target.value as typeof node.from.anchor,
                                },
                              }
                            : node,
                        )
                      }
                    >
                      {anchors.map((anchor) => (
                        <option key={anchor} value={anchor}>
                          {anchor}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </>
          ) : null}
          {selected.type === "shape" || selected.type === "connector" ? (
            <label>
              Object color
              <select
                value={selected.color}
                onChange={(event) =>
                  update((node) =>
                    node.type === "shape" || node.type === "connector"
                      ? { ...node, color: event.target.value as typeof node.color }
                      : node,
                  )
                }
              >
                {CanvasColorSchema.options.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selected.type === "image" ? (
            <p className={styles.help}>
              Use Media to adjust this image and Access to edit its description.
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={selected.type === "text" && selected.role === "title"}
              onClick={() => onChange(removeNativeSceneNodes(scene, [selected.id]))}
            >
              Delete object
            </button>
          </div>
        </fieldset>
      </div>
      <div hidden={sectionHidden("layout")} data-native-inspector-section="layout">
        <NativeSceneDesignControls
          scene={scene}
          onChange={onChange}
          onApplyDesignToDeck={onApplyDesignToDeck}
        />
        <NativeSceneLayoutControls scene={scene} onChange={onChange} />
        <NativeSceneArrangementControls
          scene={scene}
          selectedIds={selectedIds}
          selectedId={selected.id}
          onChange={onChange}
        />
        <NativeSceneCompositionControls
          scene={scene}
          selectedIds={selectedIds}
          selectedId={selected.id}
          onChange={onChange}
        />
        <fieldset>
          <legend>Position and size</legend>
          {selected.type !== "connector" ? (
            <div className={styles.frameFields}>
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label key={field}>
                  {`Object ${field} (%)`}
                  <input
                    aria-label={`Object ${field} (%)`}
                    type="number"
                    min={field === "x" || field === "y" ? 0 : 1}
                    max={100}
                    step={1}
                    value={Math.round(selected.frame[field] * 100) / 100}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (!Number.isFinite(value)) return;
                      update(
                        (node) =>
                          node.type === "connector"
                            ? node
                            : {
                                ...node,
                                frame: boundNativeSceneFrame({ ...node.frame, [field]: value }),
                              },
                        `frame:${field}`,
                      );
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
          {multiple ? (
            <div className={styles.actions} aria-label="Selection actions">
              {(
                [
                  ["left", -1, 0],
                  ["right", 1, 0],
                  ["up", 0, -1],
                  ["down", 0, 1],
                ] as const
              ).map(([direction, dx, dy]) => (
                <button
                  key={direction}
                  type="button"
                  disabled={!canMoveSelection}
                  onClick={() => onChange(moveNativeSceneNodes(scene, selectedIds, dx, dy))}
                >
                  Move selection {direction}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange(removeNativeSceneNodes(scene, selectedIds))}
              >
                Delete selected objects
              </button>
            </div>
          ) : null}
        </fieldset>
        <details className={styles.editorDisclosure}>
          <summary>Moving and resizing objects</summary>
          <p className={styles.help}>
            On wide screens, drag an object or its move button; drag its resize button to change
            size. Dragging near an object or slide edge/center shows snap guides; hold Alt to move
            freely. Press Escape to cancel a drag. Shift-click objects or use the selection
            checkboxes to move several together. Arrow keys on a move button nudge the selection by
            1%, or 5% with Shift. Resize keys proportionally resize a stored group or change the
            focused object; numeric fields change the last selected object. Narrow screens use the
            reading-order view with keyboard and numeric controls. Deleting objects also removes
            their connectors. The title stays on the slide.
          </p>
        </details>
      </div>
      <div hidden={sectionHidden("media")} data-native-inspector-section="media">
        {selected.type === "image" ? (
          <NativeSceneImageDesignControls scene={scene} node={selected} onChange={onChange} />
        ) : null}
        <fieldset>
          <legend>Add an image</legend>
          <label>
            New image description
            <input
              aria-label="New image description"
              maxLength={300}
              value={imageAlt}
              onChange={(event) => setImageAlt(event.target.value)}
            />
          </label>
          <label>
            Add native image
            <input
              aria-label="Add native image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!uploadsEnabled || mediaState !== "idle" || !canAdd || !imageAlt.trim()}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUploadImage(file, imageAlt.trim());
                event.currentTarget.value = "";
              }}
            />
          </label>
          <p className={styles.help}>
            {attachmentPending
              ? "Finish or discard the uploaded image attachment before choosing another image."
              : mediaState === "uploading"
                ? "Uploading to quarantine…"
                : mediaState === "scanning"
                  ? "Checking image safety…"
                  : uploadsEnabled
                    ? "JPEG, PNG or WebP up to 10 MB. Describe each image before uploading; clean scanned images are added to this slide."
                    : "Uploads are unavailable until malware scanning is configured."}
          </p>
        </fieldset>
        <NativeSceneVideoControls
          scene={scene}
          canAdd={canAdd}
          onChange={onChange}
          // The accepted node is absent from this render's scene until the parent updates.
          onSelect={(id) => setSelection([id])}
        />
      </div>
      <div hidden={sectionHidden("accessibility")} data-native-inspector-section="accessibility">
        <fieldset>
          <legend>Slide objects · reading order</legend>
          <ol className={styles.nodeList}>
            {scene.readingOrder.map((id, index) => {
              const node = scene.nodes.find((item) => item.id === id)!;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={selectedIds.includes(id)}
                    onClick={(event) => select(id, event.shiftKey)}
                  >
                    {index + 1}. {nativeNodeLabel(node)}
                  </button>
                  <label className={styles.selectionToggle}>
                    <input
                      type="checkbox"
                      aria-label={`Include ${nativeNodeLabel(node)} in selection`}
                      checked={selectedIds.includes(id)}
                      onChange={() => select(id, true)}
                    />
                    Include in selection
                  </label>
                </li>
              );
            })}
          </ol>
          <p role="status" className={styles.help}>
            {selectedIds.length} {multiple ? "objects selected" : "object selected"}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={readingIndex <= 0}
              onClick={() => onChange(reorderNativeNode(scene, selected.id, -1))}
            >
              Read object earlier
            </button>
            <button
              type="button"
              disabled={readingIndex >= scene.readingOrder.length - 1}
              onClick={() => onChange(reorderNativeNode(scene, selected.id, 1))}
            >
              Read object later
            </button>
          </div>
          <p className={styles.help}>
            Reading order is independent of visual position. On narrow screens objects appear in
            this order.
          </p>
        </fieldset>
        <fieldset>
          <legend>Selected object accessibility</legend>
          {selected.type === "text" ? (
            <label>
              Text language
              <select
                aria-label="Text language"
                value={selected.lang ?? ""}
                disabled={multiple}
                onChange={(event) => {
                  const value = event.target.value;
                  const parsed = PresentationTextLanguageSchema.safeParse(value);
                  if (value && !parsed.success) return;
                  try {
                    onChange(
                      setNativeTextLanguage(
                        scene,
                        selected.id,
                        parsed.success ? parsed.data : null,
                      ),
                    );
                  } catch {
                    setChangeFailure({
                      scene,
                      message:
                        "The language change cannot fit within the slide’s limits. Reduce content and try again; the current slide is retained.",
                    });
                  }
                }}
              >
                <option value="">Unspecified</option>
                {PRESENTATION_TEXT_LANGUAGES.map(({ code, label }) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selected.type === "image" ? (
            <label>
              Image alternative text
              <textarea
                maxLength={300}
                value={selected.altText ?? ""}
                onChange={(event) =>
                  update(
                    (node) =>
                      node.type === "image"
                        ? { ...node, altText: event.target.value || null }
                        : node,
                    "altText",
                  )
                }
              />
            </label>
          ) : null}
          {selected.type !== "text" && selected.type !== "image" ? (
            <p className={styles.help}>
              Edit this object’s visible label in Content. Its label also identifies it to readers.
            </p>
          ) : null}
        </fieldset>
      </div>
    </div>
  );
  return (
    <div className={styles.editor}>
      <div className={styles.objectToolbar} aria-label="Insert slide objects" lang="en-CA">
        <div className={styles.actions}>
          <button
            aria-label="Add native text"
            type="button"
            disabled={!canAdd}
            onClick={() =>
              add({
                id: clientUuid(),
                type: "text",
                role: "body",
                text: "",
                frame: { x: 8, y: 35, width: 55, height: 25 },
              })
            }
          >
            {inspectorTarget === undefined ? "Add native text" : "Text"}
          </button>
          <button
            aria-label="Add native shape"
            type="button"
            disabled={!canAdd}
            onClick={() =>
              add({
                id: clientUuid(),
                type: "shape",
                shape: "rounded_rectangle",
                color: "blue",
                label: "",
                frame: { x: 65, y: 35, width: 25, height: 25 },
              })
            }
          >
            {inspectorTarget === undefined ? "Add native shape" : "Shape"}
          </button>
          <button
            aria-label="Add native connector"
            type="button"
            disabled={!canAdd || framed.length < 2}
            onClick={() =>
              add({
                id: clientUuid(),
                type: "connector",
                from: { nodeId: framed[0]!.id, anchor: "bottom" },
                to: { nodeId: framed[1]!.id, anchor: "top" },
                label: "",
                color: "blue",
              })
            }
          >
            {inspectorTarget === undefined ? "Add native connector" : "Connector"}
          </button>
        </div>
        <details className={styles.insertDisclosure}>
          <summary>Insert more</summary>
          <div className={styles.insertPanel}>
            <fieldset className={styles.designControls}>
              <legend>Audience interactions</legend>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => add(createNativeRevealNode())}
                >
                  Add reveal panel
                </button>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => add(createNativeLinkNode())}
                >
                  Add link
                </button>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => add(createNativeDialogNode())}
                >
                  Add detail dialog
                </button>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => {
                    const image =
                      selected.type === "image"
                        ? selected
                        : scene.nodes.find((node) => node.type === "image" && !node.rotation);
                    add(createNativeHotspotNode(image?.type === "image" ? image : undefined));
                  }}
                >
                  Add image hotspot
                </button>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => add(createNativeNavigationNode())}
                >
                  Add slide link
                </button>
              </div>
              <p className={styles.help}>
                Local panels and detail dialogs open on each viewer’s screen. Broadcast reveals are
                controlled by the facilitator during live delivery. Interactions do not submit
                answers. Keep confidential notes in speaker notes.
              </p>
            </fieldset>
            <fieldset className={styles.designControls}>
              <legend>Tables and charts</legend>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => add(createNativeTableNode())}
                >
                  Add table
                </button>
                {(["bar", "line", "pie"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={!canAdd}
                    onClick={() => add(createNativeChartNode(kind))}
                  >
                    Add {kind} chart
                  </button>
                ))}
              </div>
            </fieldset>
            <p className={styles.help}>Up to {PRESENTATION_SCENE_MAX_NODES} objects per slide.</p>
          </div>
        </details>
      </div>
      {changeFailure?.scene === scene ? (
        <p className={styles.formatError} role="alert">
          {changeFailure.message}
        </p>
      ) : null}
      <NativeSceneCanvas
        scene={scene}
        renderImage={renderImage}
        selectedNodeIds={selectedIds}
        onSelect={(id, additive) => {
          select(id, additive);
          onInspectSelection?.();
        }}
        onChange={onChange}
      />
      {inlineInspector
        ? inspector
        : inspectorTarget
          ? createPortal(inspector, inspectorTarget)
          : null}
    </div>
  );
}
