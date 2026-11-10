"use client";

import { type KeyboardEvent, type PointerEvent } from "react";
import { type PresentationScene } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { nativeControlNodeLabel, nativeControlsCopy } from "./native-controls-copy";
import styles from "./native-scene-selection-controls.module.css";

/** Normal-flow controls stay outside every authored frame, including rotated groups. */
export function NativeSceneSelectionControls({
  scene,
  disabled = false,
  selectedNodeIds,
  onSelect,
  onPointerDown,
  onGeometryKey,
}: {
  scene: PresentationScene;
  disabled?: boolean;
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
  const { locale } = useLocale();
  const copy = nativeControlsCopy(locale);
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const selected = nodes.get(selectedNodeIds.at(-1) ?? "");
  const framed = selected && selected.type !== "connector" ? selected : null;
  const groupIndex = framed
    ? (scene.groups?.findIndex((group) => group.nodeIds.includes(framed.id)) ?? -1)
    : -1;
  function key(event: KeyboardEvent<HTMLButtonElement>, resize: boolean) {
    if (disabled || !framed) return;
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
      lang={locale}
      aria-label={copy("Selected object controls")}
      data-native-selection-controls="true"
    >
      <label className={styles.selection}>
        <span>{copy("Canvas object")}</span>
        <select value={selected?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
          {!selected ? <option value="">{copy("Choose an object")}</option> : null}
          {scene.readingOrder.map((id, index) => {
            const node = nodes.get(id);
            const label = node ? nativeControlNodeLabel(locale, node) : null;
            return node && label ? (
              <option key={id} value={id} lang={label.language}>
                {index + 1}. {label.text}
              </option>
            ) : null;
          })}
        </select>
      </label>
      {framed ? (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={disabled}
            aria-label={copy("Move {name}. Use arrow keys to nudge.", {
              name: nativeControlNodeLabel(locale, framed).text,
            })}
            onKeyDown={(event) => key(event, false)}
            onPointerDown={(event) => onPointerDown(event, framed.id, false, true)}
          >
            {copy("Move")}
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-label={
              groupIndex >= 0
                ? copy("Resize group {number}. Use arrow keys to change size.", {
                    number: groupIndex + 1,
                  })
                : copy("Resize {name}. Use arrow keys to change size.", {
                    name: nativeControlNodeLabel(locale, framed).text,
                  })
            }
            onKeyDown={(event) => key(event, true)}
            onPointerDown={(event) => onPointerDown(event, framed.id, true, true)}
          >
            {copy(groupIndex >= 0 ? "Resize group" : "Resize")}
          </button>
        </div>
      ) : null}
      <p className={styles.help}>
        {disabled
          ? copy("Read-only. You can select objects and preview the slide.")
          : framed
            ? `${selectedNodeIds.length > 1 ? `${copy("Move affects all selected objects.")} ` : ""}${copy("Use arrow keys; hold Shift for larger steps. Drag controls on wide slides, or arrange in the inspector.")}`
            : selected
              ? copy("Connections follow their objects. Use the inspector to edit this connection.")
              : copy("Choose an object to move or resize it.")}
      </p>
    </div>
  );
}
