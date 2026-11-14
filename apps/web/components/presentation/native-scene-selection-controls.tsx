"use client";

import { type PresentationScene } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { nativeControlNodeLabel, nativeControlsCopy } from "./native-controls-copy";
import { nativeSelectionCopy } from "./native-selection-copy";
import { EditorIcon } from "./presentation-editor-chrome";
import styles from "./native-scene-selection-controls.module.css";

/** Selection stays available outside authored frames, including in read-only slides. */
export function NativeSceneSelectionControls({
  scene,
  disabled = false,
  selectedNodeIds,
  onSelect,
  onArrange,
}: {
  scene: PresentationScene;
  disabled?: boolean;
  selectedNodeIds: readonly string[];
  onSelect: (id: string) => void;
  onArrange?: () => void;
}) {
  const { locale } = useLocale();
  const copy = nativeControlsCopy(locale);
  const selectionCopy = nativeSelectionCopy(locale);
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const selected = nodes.get(selectedNodeIds.at(-1) ?? "");
  const framed = selected && selected.type !== "connector" ? selected : null;
  const selection = new Set(selectedNodeIds.filter((id) => nodes.has(id)));
  const groupIndex = framed
    ? (scene.groups?.findIndex(
        (group) =>
          group.nodeIds.includes(framed.id) &&
          [...selection].every((id) => group.nodeIds.includes(id)),
      ) ?? -1)
    : -1;
  const group = groupIndex >= 0 ? scene.groups?.[groupIndex] : undefined;
  return (
    <div
      className={styles.controls}
      role="group"
      lang={locale}
      aria-label={copy("Selected object controls")}
      data-native-selection-controls="true"
    >
      <label className={styles.selection}>
        <span className={styles.srOnly}>{copy("Canvas object")}</span>
        <EditorIcon name={selected?.type ?? "outline"} />
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
      {selected && (group || selection.size > 1) ? (
        <span className={styles.context} data-native-selection-context="true">
          {group ? (
            <>
              <span aria-hidden="true">
                {selectionCopy("Group {number} · {count}", {
                  number: groupIndex + 1,
                  count: group.nodeIds.length,
                })}
              </span>
              <span className={styles.srOnly}>
                {selectionCopy("Group {number}, {count} objects", {
                  number: groupIndex + 1,
                  count: group.nodeIds.length,
                })}
              </span>
            </>
          ) : (
            copy("{count} selected", { count: selection.size })
          )}
        </span>
      ) : null}
      {framed && onArrange ? (
        <button
          className={styles.arrange}
          type="button"
          disabled={disabled}
          aria-label={copy("Arrange objects")}
          title={copy("Arrange objects")}
          onClick={onArrange}
        >
          <EditorIcon name="inspector" />
        </button>
      ) : null}
      <details className={styles.help} data-native-selection-help="true">
        <summary
          aria-label={selectionCopy("Object shortcuts")}
          title={selectionCopy("Object shortcuts")}
        >
          <span aria-hidden="true">?</span>
        </summary>
        <div className={styles.guidance}>
          <p>
            {disabled
              ? copy("Read-only. You can select objects and preview the slide.")
              : framed
                ? selectionCopy(
                    "On wide slides, drag objects to move them or corner handles to resize. Focus the canvas and use arrow keys; hold Shift for larger steps. Use Arrange for exact position and size.",
                  )
                : selected
                  ? copy(
                      "Connections follow their objects. Use the inspector to edit this connection.",
                    )
                  : copy("Choose an object")}
          </p>
          {!disabled && framed && selection.size > 1 ? (
            <p>{copy("Move affects all selected objects.")}</p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
