"use client";

import { type KeyboardEvent, type PointerEvent } from "react";
import { type PresentationScene } from "@openround/contracts";
import { nativeNodeLabel } from "../../lib/presentation-native-scene";
import styles from "./native-scene-selection-controls.module.css";

/** Normal-flow controls stay outside every authored frame, including rotated groups. */
export function NativeSceneSelectionControls({
  scene,
  selectedNodeIds,
  onSelect,
  onPointerDown,
  onGeometryKey,
}: {
  scene: PresentationScene;
  selectedNodeIds: readonly string[];
  onSelect: (id: string) => void;
  onPointerDown: (
    event: PointerEvent<HTMLElement>,
    id: string,
    resize: boolean,
    handle: boolean,
  ) => void;
  onGeometryKey: (id: string, dx: number, dy: number, resize: boolean) => void;
}) {
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const selected = nodes.get(selectedNodeIds.at(-1) ?? "");
  const framed = selected && selected.type !== "connector" ? selected : null;
  const groupIndex = framed
    ? (scene.groups?.findIndex((group) => group.nodeIds.includes(framed.id)) ?? -1)
    : -1;
  function key(event: KeyboardEvent<HTMLButtonElement>, resize: boolean) {
    if (!framed) return;
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    event.stopPropagation();
    onGeometryKey(framed.id, dx, dy, resize);
  }
  return (
    <div
      className={styles.controls}
      role="group"
      aria-label="Selected object controls"
      data-native-selection-controls="true"
    >
      <label className={styles.selection}>
        <span>Canvas object</span>
        <select value={selected?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
          {!selected ? <option value="">Choose an object</option> : null}
          {scene.readingOrder.map((id, index) => {
            const node = nodes.get(id);
            return node ? (
              <option key={id} value={id}>
                {index + 1}. {nativeNodeLabel(node)}
              </option>
            ) : null;
          })}
        </select>
      </label>
      {framed ? (
        <div className={styles.actions}>
          <button
            type="button"
            aria-label={`Move ${nativeNodeLabel(framed)}. Use arrow keys to nudge.`}
            onKeyDown={(event) => key(event, false)}
            onPointerDown={(event) => onPointerDown(event, framed.id, false, true)}
          >
            Move
          </button>
          <button
            type="button"
            aria-label={`Resize ${groupIndex >= 0 ? `group ${groupIndex + 1}` : nativeNodeLabel(framed)}. Use arrow keys to change size.`}
            onKeyDown={(event) => key(event, true)}
            onPointerDown={(event) => onPointerDown(event, framed.id, true, true)}
          >
            {groupIndex >= 0 ? "Resize group" : "Resize"}
          </button>
        </div>
      ) : null}
      <p className={styles.help}>
        {framed
          ? `${selectedNodeIds.length > 1 ? "Move affects all selected objects. " : ""}Use arrow keys; hold Shift for larger steps. Drag controls on wide slides, or arrange in the inspector.`
          : selected
            ? "Connections follow their objects. Use the inspector to edit this connection."
            : "Choose an object to move or resize it."}
      </p>
    </div>
  );
}
