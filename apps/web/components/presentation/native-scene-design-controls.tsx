"use client";

import { useState } from "react";
import {
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneNode,
} from "@openround/contracts";
import {
  INITIAL_NATIVE_DESIGN,
  NATIVE_DESIGN_FONTS,
  NATIVE_DESIGN_THEMES,
  NATIVE_LAYOUT_PRESETS,
  alignNativeSceneNodes,
  applyNativeLayout,
  canApplyNativeLayout,
  canAlignNativeSceneNodes,
  canDistributeNativeSceneNodes,
  canLayerNativeSceneNode,
  distributeNativeSceneNodes,
  layerNativeSceneNode,
} from "../../lib/presentation-native-design";
import { updateNativeNode } from "../../lib/presentation-native-scene";
import { nativeSceneSelectionUnits } from "../../lib/presentation-native-geometry";
import styles from "./native-scene.module.css";

type SceneChange = (scene: PresentationScene, historyField?: string) => void;

export function NativeSceneDesignControls({
  scene,
  onChange,
  onApplyDesignToDeck,
}: {
  scene: PresentationScene;
  onChange: SceneChange;
  onApplyDesignToDeck?: (design: PresentationSceneDesign) => void;
}) {
  const [failure, setFailure] = useState<{ scene: PresentationScene; message: string } | null>(
    null,
  );
  const design = scene.design;
  function update(next: PresentationSceneDesign) {
    const result = PresentationSceneDraftSchema.safeParse({
      ...scene,
      schemaVersion: scene.schemaVersion >= 4 ? scene.schemaVersion : 3,
      design: next,
    });
    if (!result.success) {
      setFailure({
        scene,
        message:
          "This design change exceeds the slide’s limits. Shorten some text or remove an object, then try again.",
      });
      return;
    }
    setFailure(null);
    onChange(result.data);
  }
  return (
    <fieldset className={styles.designControls}>
      <legend>Design</legend>
      {design ? (
        <>
          <div className={styles.designFields}>
            <label>
              Slide theme
              <select
                value={design.theme}
                onChange={(event) =>
                  update({
                    ...design,
                    theme: event.target.value as PresentationSceneDesign["theme"],
                  })
                }
              >
                {Object.keys(NATIVE_DESIGN_THEMES).map((theme) => (
                  <option key={theme} value={theme}>
                    {theme}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Slide font
              <select
                value={design.font}
                onChange={(event) =>
                  update({
                    ...design,
                    font: event.target.value as PresentationSceneDesign["font"],
                  })
                }
              >
                {Object.keys(NATIVE_DESIGN_FONTS).map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Slide spacing
              <select
                value={design.spacing}
                onChange={(event) =>
                  update({
                    ...design,
                    spacing: event.target.value as PresentationSceneDesign["spacing"],
                  })
                }
              >
                <option value="relaxed">relaxed</option>
                <option value="compact">compact</option>
              </select>
            </label>
          </div>
          {onApplyDesignToDeck ? (
            <div className={styles.actions}>
              <button type="button" onClick={() => onApplyDesignToDeck(design)}>
                Apply design to all native slides
              </button>
            </div>
          ) : null}
          <p className={styles.help}>
            Themes use fixed contrast palettes and fonts installed on your device. Applying a design
            to the deck changes native slides; ordinary slides and activities keep their design.
          </p>
        </>
      ) : (
        <>
          <div className={styles.actions}>
            <button type="button" onClick={() => update(INITIAL_NATIVE_DESIGN)}>
              Enable slide design
            </button>
          </div>
          <p className={styles.help}>
            Choose a theme, font and spacing for this native slide. Enable design to start with
            paper, sans and relaxed spacing.
          </p>
        </>
      )}
      {failure?.scene === scene ? (
        <p role="alert" className={styles.formatError}>
          {failure.message}
        </p>
      ) : null}
    </fieldset>
  );
}

export function NativeSceneLayoutControls({
  scene,
  onChange,
}: {
  scene: PresentationScene;
  onChange: SceneChange;
}) {
  return (
    <fieldset className={styles.designControls}>
      <legend>Native layouts</legend>
      <div className={styles.layoutOptions}>
        {NATIVE_LAYOUT_PRESETS.map((preset) => {
          const enabled = canApplyNativeLayout(scene, preset.id);
          return (
            <div key={preset.id} className={styles.layoutOption}>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    if (enabled) onChange(applyNativeLayout(scene, preset.id));
                  }}
                >
                  {preset.label}
                </button>
              </div>
              <p className={styles.help}>{enabled ? "Fits the current objects." : preset.help}</p>
            </div>
          );
        })}
      </div>
      <p className={styles.help}>
        Layouts reposition existing objects without removing content. Connectors follow their
        objects. Add or remove objects to match a layout; unsupported combinations keep their
        current positions. Check text fit after changing a layout or design.
      </p>
    </fieldset>
  );
}

export function NativeSceneArrangementControls({
  scene,
  selectedIds,
  selectedId,
  onChange,
}: {
  scene: PresentationScene;
  selectedIds: readonly string[];
  selectedId: string;
  onChange: SceneChange;
}) {
  const framedCount = nativeSceneSelectionUnits(scene, selectedIds).length;
  return (
    <fieldset className={styles.designControls}>
      <legend>Arrange objects</legend>
      <div className={styles.actions} aria-label="Align selected objects">
        {(["left", "center", "right", "top", "middle", "bottom"] as const).map((alignment) => (
          <button
            key={alignment}
            type="button"
            disabled={framedCount < 2 || !canAlignNativeSceneNodes(scene, selectedIds, alignment)}
            onClick={() => {
              if (canAlignNativeSceneNodes(scene, selectedIds, alignment))
                onChange(alignNativeSceneNodes(scene, selectedIds, alignment));
            }}
          >
            Align {alignment}
          </button>
        ))}
      </div>
      <div className={styles.actions} aria-label="Distribute selected objects">
        {(["horizontal", "vertical"] as const).map((axis) => {
          const enabled = canDistributeNativeSceneNodes(scene, selectedIds, axis);
          return (
            <button
              key={axis}
              type="button"
              disabled={!enabled}
              onClick={() => {
                if (enabled) onChange(distributeNativeSceneNodes(scene, selectedIds, axis));
              }}
            >
              Distribute {axis === "horizontal" ? "horizontally" : "vertically"}
            </button>
          );
        })}
      </div>
      <p className={styles.help}>
        Align at least two selected objects within their combined bounds. Stored groups count as one
        object. Distribute at least three with equal gaps, keeping the outer objects fixed.
        Distribution is unavailable when the objects cannot fit without overlap. Arrangement is
        unavailable when rotated objects cannot reach the target while keeping their frames inside
        the slide.
      </p>
      <div className={styles.actions} aria-label="Last selected object layer">
        {(
          [
            ["back", "Send object to back"],
            ["backward", "Move object backward"],
            ["forward", "Move object forward"],
            ["front", "Bring object to front"],
          ] as const
        ).map(([action, label]) => (
          <button
            key={action}
            type="button"
            disabled={!canLayerNativeSceneNode(scene, selectedId, action)}
            onClick={() => {
              if (canLayerNativeSceneNode(scene, selectedId, action))
                onChange(layerNativeSceneNode(scene, selectedId, action));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className={styles.help}>
        Layer controls change the last selected object or its stored group on wide slides. Reading
        order stays the same, including on narrow screens. Connectors follow objects and stay behind
        them.
      </p>
    </fieldset>
  );
}

export function NativeSceneImageDesignControls({
  scene,
  node,
  onChange,
}: {
  scene: PresentationScene;
  node: Extract<PresentationSceneNode, { type: "image" }>;
  onChange: SceneChange;
}) {
  const [failure, setFailure] = useState<{ scene: PresentationScene; message: string } | null>(
    null,
  );
  function update(next: typeof node, historyField?: string) {
    const result = PresentationSceneDraftSchema.safeParse({
      ...updateNativeNode(scene, node.id, () => next),
      schemaVersion: scene.schemaVersion >= 4 ? scene.schemaVersion : 3,
    });
    if (!result.success) {
      setFailure({
        scene,
        message:
          "This image change exceeds the slide’s limits. Shorten some text or remove an object, then try again.",
      });
      return;
    }
    setFailure(null);
    onChange(result.data, historyField);
  }
  return (
    <>
      <label>
        Image fit
        <select
          value={node.fit ?? "contain"}
          onChange={(event) => {
            const { focalPoint: _focalPoint, ...rest } = node;
            void _focalPoint;
            update(
              event.target.value === "cover"
                ? {
                    ...node,
                    fit: "cover",
                    focalPoint: node.focalPoint ?? { x: 50, y: 50 },
                  }
                : { ...rest, fit: "contain" },
            );
          }}
        >
          <option value="contain">Contain · show the whole image</option>
          <option value="cover">Cover · crop to fill the frame</option>
        </select>
      </label>
      {node.fit === "cover" ? (
        <div className={styles.frameFields}>
          {(["x", "y"] as const).map((axis) => (
            <label key={axis}>
              Image focal {axis.toUpperCase()} (%)
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={node.focalPoint?.[axis] ?? 50}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (!Number.isFinite(value)) return;
                  update(
                    {
                      ...node,
                      focalPoint: {
                        x: node.focalPoint?.x ?? 50,
                        y: node.focalPoint?.y ?? 50,
                        [axis]: Math.min(100, Math.max(0, value)),
                      },
                    },
                    `native:${node.id}:focal:${axis}`,
                  );
                }}
              />
            </label>
          ))}
        </div>
      ) : null}
      {failure?.scene === scene ? (
        <p role="alert" className={styles.formatError}>
          {failure.message}
        </p>
      ) : null}
      <p className={styles.help}>
        Contain shows the complete image. Cover crops the image on wide slides; adjust its focal
        point to keep the subject visible. Narrow screens always show the complete image and its
        alternative text stays available.
      </p>
    </>
  );
}
