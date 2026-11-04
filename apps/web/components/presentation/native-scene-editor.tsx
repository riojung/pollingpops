"use client";

import { useState } from "react";
import {
  CanvasColorSchema,
  CanvasShapeVariantSchema,
  PRESENTATION_SCENE_MAX_NODES,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import {
  boundNativeSceneFrame,
  nativeNodeLabel,
  reorderNativeNode,
  updateNativeNode,
} from "../../lib/presentation-native-scene";
import { type SceneImageRenderer } from "./native-scene-view";
import { NativeSceneCanvas } from "./native-scene-canvas";
import {
  moveNativeSceneNodes,
  removeNativeSceneNodes,
} from "../../lib/presentation-native-geometry";
import styles from "./native-scene.module.css";

const shapes = [
  ...CanvasShapeVariantSchema.options,
  "ellipse",
  "diamond",
  "parallelogram",
] as const;
const anchors = ["center", "top", "right", "bottom", "left"] as const;

export function NativeSceneEditor({
  scene,
  onChange,
  renderImage,
  uploadsEnabled,
  mediaState,
  attachmentPending = false,
  onUploadImage,
}: {
  scene: PresentationScene;
  onChange: (scene: PresentationScene, historyField?: string) => void;
  renderImage: SceneImageRenderer;
  uploadsEnabled: boolean;
  mediaState: "idle" | "uploading" | "scanning";
  attachmentPending?: boolean;
  onUploadImage: (file: File, altText: string) => void;
}) {
  const [selection, setSelection] = useState<string[]>([scene.nodes[0]!.id]);
  const [imageAlt, setImageAlt] = useState("");
  const validSelection = selection.filter((id) => scene.nodes.some((node) => node.id === id));
  const selectedIds = validSelection.length ? validSelection : [scene.nodes[0]!.id];
  const selected = scene.nodes.find((node) => node.id === selectedIds.at(-1))!;
  const multiple = selectedIds.length > 1;
  const canMoveSelection = scene.nodes.some(
    (node) => selectedIds.includes(node.id) && node.type !== "connector",
  );
  function select(id: string, additive = false) {
    setSelection((current) => {
      if (!additive) return [id];
      const valid = current.filter((candidate) =>
        scene.nodes.some((node) => node.id === candidate),
      );
      if (!valid.includes(id)) return [...valid, id];
      return valid.length > 1 ? valid.filter((candidate) => candidate !== id) : valid;
    });
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
    onChange({
      ...scene,
      nodes: [...scene.nodes, node],
      readingOrder: [...scene.readingOrder, node.id],
    });
    setSelection([node.id]);
  }
  return (
    <div className={styles.editor}>
      <NativeSceneCanvas
        scene={scene}
        renderImage={renderImage}
        selectedNodeIds={selectedIds}
        onSelect={select}
        onChange={onChange}
      />
      <div className={styles.controls} aria-label="Native slide editor" lang="en-CA">
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
          <div className={styles.actions}>
            <button
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
              Add native text
            </button>
            <button
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
              Add native shape
            </button>
            <button
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
              Add native connector
            </button>
          </div>
          <p className={styles.help}>
            Up to {PRESENTATION_SCENE_MAX_NODES} objects. Reading order is independent of visual
            position. On narrow screens objects appear in this order.
          </p>
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
        <fieldset>
          <legend>{multiple ? "Last selected object" : "Selected object"}</legend>
          {selected.type === "text" ? (
            <label>
              {selected.role === "title" ? "Native slide title" : "Node text"}
              <textarea
                aria-label={selected.role === "title" ? "Native slide title" : "Node text"}
                maxLength={selected.role === "title" ? 160 : 4000}
                value={selected.text}
                onChange={(event) =>
                  update(
                    (node) => (node.type === "text" ? { ...node, text: event.target.value } : node),
                    "text",
                  )
                }
              />
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
            <button
              type="button"
              disabled={selected.type === "text" && selected.role === "title"}
              onClick={() => onChange(removeNativeSceneNodes(scene, [selected.id]))}
            >
              Delete object
            </button>
          </div>
          <p className={styles.help}>
            On wide screens, drag an object or its move button; drag its resize button to change
            size. Press Escape to cancel a drag. Shift-click objects or use the selection checkboxes
            to move several together. Arrow keys on a move button nudge the selection by 1%, or 5%
            with Shift. Resize keys change the focused object; numeric fields change the last
            selected object. Narrow screens use the reading-order view with keyboard and numeric
            controls. Deleting objects also removes their connectors. The title stays on the slide.
          </p>
        </fieldset>
      </div>
    </div>
  );
}
