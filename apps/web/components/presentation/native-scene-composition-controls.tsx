"use client";

import { useState } from "react";
import { useLocale } from "../locale-provider";
import { nativeControlsCopy, type NativeControlsCopyKey } from "./native-controls-copy";
import { PresentationSceneDraftSchema, type PresentationScene } from "@openround/contracts";
import {
  groupNativeSceneNodes,
  nativeSceneSelectionUnits,
  rotateNativeSceneNodes,
  resizeNativeSceneGroup,
  selectedNativeSceneBounds,
  ungroupNativeSceneNodes,
} from "../../lib/presentation-native-geometry";
import { NativeInspectorSection } from "./native-inspector-section";
import { EditorIcon } from "./presentation-editor-chrome";
import styles from "./native-scene-design-controls.module.css";

export function NativeSceneCompositionControls({
  scene,
  selectedIds,
  selectedId,
  onChange,
}: {
  scene: PresentationScene;
  selectedIds: readonly string[];
  selectedId: string;
  onChange: (scene: PresentationScene) => void;
}) {
  const { locale } = useLocale();
  const copy = nativeControlsCopy(locale);
  const [failure, setFailure] = useState<{
    scene: PresentationScene;
    message: NativeControlsCopyKey;
  } | null>(null);
  const units = nativeSceneSelectionUnits(scene, selectedIds);
  const selected = scene.nodes.find((node) => node.id === selectedId);
  const grouped =
    scene.groups?.some((group) => group.nodeIds.some((id) => selectedIds.includes(id))) ?? false;
  const bounds = selectedNativeSceneBounds(scene, selectedIds);
  const helpId = `native-composition-help-${selectedId}`;
  function apply(next: PresentationScene) {
    if (next === scene) return;
    const parsed = PresentationSceneDraftSchema.safeParse(next);
    if (!parsed.success) {
      setFailure({
        scene,
        message:
          "This change exceeds the slide’s limits. Shorten some content or remove an object, then try again.",
      });
      return;
    }
    setFailure(null);
    onChange(parsed.data);
  }
  function rotate(degrees: number) {
    const next = rotateNativeSceneNodes(scene, selectedIds, degrees);
    if (next === scene && degrees % 360 !== 0) {
      setFailure({
        scene,
        message:
          "The rotated selection would leave the slide. Move it away from an edge or reduce its size, then try again.",
      });
      return;
    }
    apply(next);
  }
  return (
    <NativeInspectorSection title={copy("Group and rotate")} icon="shape" name="composition">
      <fieldset lang={locale} className={styles.section}>
        <legend>{copy("Group and rotate")}</legend>
        <div
          className={styles.compositionActions}
          role="group"
          aria-label={copy("Group and rotate")}
        >
          <button
            type="button"
            className={styles.compositionButton}
            aria-label={copy("Group selected objects")}
            aria-describedby={helpId}
            title={copy("Group selected objects")}
            disabled={units.length < 2}
            onClick={() => apply(groupNativeSceneNodes(scene, selectedIds))}
          >
            <EditorIcon name="duplicate" />
            <span className={styles.screenReaderOnly}>{copy("Group selected objects")}</span>
          </button>
          <button
            type="button"
            className={styles.compositionButton}
            aria-label={copy("Ungroup selected objects")}
            aria-describedby={helpId}
            title={copy("Ungroup selected objects")}
            disabled={!grouped}
            onClick={() => apply(ungroupNativeSceneNodes(scene, selectedIds))}
          >
            <EditorIcon name="shape" />
            <span className={styles.screenReaderOnly}>{copy("Ungroup selected objects")}</span>
          </button>
          <button
            type="button"
            className={styles.compositionButton}
            aria-label={copy("Rotate selection left 15°")}
            aria-describedby={helpId}
            title={copy("Rotate selection left 15°")}
            disabled={!units.length}
            onClick={() => rotate(-15)}
          >
            <EditorIcon name="undo" />
            <span aria-hidden="true">−15°</span>
            <span className={styles.screenReaderOnly}>{copy("Rotate selection left 15°")}</span>
          </button>
          <button
            type="button"
            className={styles.compositionButton}
            aria-label={copy("Rotate selection right 15°")}
            aria-describedby={helpId}
            title={copy("Rotate selection right 15°")}
            disabled={!units.length}
            onClick={() => rotate(15)}
          >
            <EditorIcon name="redo" />
            <span aria-hidden="true">+15°</span>
            <span className={styles.screenReaderOnly}>{copy("Rotate selection right 15°")}</span>
          </button>
          <button
            type="button"
            className={styles.compositionButton}
            aria-label={copy("Grow selection 5%")}
            aria-describedby={helpId}
            title={copy("Grow selection 5%")}
            disabled={!bounds}
            onClick={() => {
              if (bounds)
                apply(
                  resizeNativeSceneGroup(
                    scene,
                    selectedIds,
                    bounds.width * 0.05,
                    bounds.height * 0.05,
                  ),
                );
            }}
          >
            <EditorIcon name="plus" />
            <span aria-hidden="true">+5%</span>
            <span className={styles.screenReaderOnly}>{copy("Grow selection 5%")}</span>
          </button>
          <button
            type="button"
            className={styles.compositionButton}
            aria-label={copy("Shrink selection 5%")}
            aria-describedby={helpId}
            title={copy("Shrink selection 5%")}
            disabled={!bounds}
            onClick={() => {
              if (bounds)
                apply(
                  resizeNativeSceneGroup(
                    scene,
                    selectedIds,
                    -bounds.width * 0.05,
                    -bounds.height * 0.05,
                  ),
                );
            }}
          >
            <EditorIcon name="spacing" />
            <span aria-hidden="true">−5%</span>
            <span className={styles.screenReaderOnly}>{copy("Shrink selection 5%")}</span>
          </button>
        </div>
        {selected && selected.type !== "connector" ? (
          <label className={styles.field}>
            {copy("Last selected angle (degrees)")}
            <input
              type="number"
              min={-180}
              max={180}
              step={1}
              value={Math.round((selected.rotation ?? 0) * 100) / 100}
              onChange={(event) => {
                const angle = event.target.valueAsNumber;
                if (Number.isFinite(angle) && angle >= -180 && angle <= 180)
                  rotate(angle - (selected.rotation ?? 0));
              }}
            />
          </label>
        ) : null}
        <p id={helpId} className={styles.help}>
          {copy(
            "Groups stay together when selected, moved, proportionally resized, aligned or layered. Grouping preserves reading order and connectors. Rotation turns the whole selection around its center; the angle field sets the last selected object’s angle and keeps relative angles. Narrow screens show readable, unrotated content.",
          )}
        </p>
        {failure?.scene === scene ? (
          <p role="alert" className={styles.formatError}>
            {copy(failure.message)}
          </p>
        ) : null}
      </fieldset>
    </NativeInspectorSection>
  );
}
