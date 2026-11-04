"use client";

import { useState } from "react";
import { PresentationSceneDraftSchema, type PresentationScene } from "@openround/contracts";
import {
  groupNativeSceneNodes,
  nativeSceneSelectionUnits,
  rotateNativeSceneNodes,
  resizeNativeSceneGroup,
  selectedNativeSceneBounds,
  ungroupNativeSceneNodes,
} from "../../lib/presentation-native-geometry";
import styles from "./native-scene.module.css";

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
  const [failure, setFailure] = useState<{ scene: PresentationScene; message: string } | null>(
    null,
  );
  const units = nativeSceneSelectionUnits(scene, selectedIds);
  const selected = scene.nodes.find((node) => node.id === selectedId);
  const grouped =
    scene.groups?.some((group) => group.nodeIds.some((id) => selectedIds.includes(id))) ?? false;
  const bounds = selectedNativeSceneBounds(scene, selectedIds);
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
    <fieldset className={styles.designControls}>
      <legend>Group and rotate</legend>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={units.length < 2}
          onClick={() => apply(groupNativeSceneNodes(scene, selectedIds))}
        >
          Group selected objects
        </button>
        <button
          type="button"
          disabled={!grouped}
          onClick={() => apply(ungroupNativeSceneNodes(scene, selectedIds))}
        >
          Ungroup selected objects
        </button>
        <button type="button" disabled={!units.length} onClick={() => rotate(-15)}>
          Rotate selection left 15°
        </button>
        <button type="button" disabled={!units.length} onClick={() => rotate(15)}>
          Rotate selection right 15°
        </button>
        <button
          type="button"
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
          Grow selection 5%
        </button>
        <button
          type="button"
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
          Shrink selection 5%
        </button>
      </div>
      {selected && selected.type !== "connector" ? (
        <label>
          Last selected angle (degrees)
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
      <p className={styles.help}>
        Groups stay together when selected, moved, proportionally resized, aligned or layered.
        Grouping preserves reading order and connectors. Rotation turns the whole selection around
        its center; the angle field sets the last selected object’s angle and keeps relative angles.
        Narrow screens show readable, unrotated content.
      </p>
      {failure?.scene === scene ? (
        <p role="alert" className={styles.formatError}>
          {failure.message}
        </p>
      ) : null}
    </fieldset>
  );
}
