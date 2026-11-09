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
  type NativeLayoutPreset,
} from "../../lib/presentation-native-design";
import { updateNativeNode } from "../../lib/presentation-native-scene";
import { nativeSceneSelectionUnits } from "../../lib/presentation-native-geometry";
import { EditorIcon, type EditorIconName } from "./presentation-editor-chrome";
import styles from "./native-scene-design-controls.module.css";

type SceneChange = (scene: PresentationScene, historyField?: string) => void;

const THEME_NAMES: Record<PresentationSceneDesign["theme"], string> = {
  paper: "Paper",
  midnight: "Midnight",
  ocean: "Ocean",
  sunset: "Sunset",
};
const FONT_NAMES: Record<PresentationSceneDesign["font"], string> = {
  sans: "System sans",
  serif: "Classic serif",
  mono: "Monospace",
};

/** Original schematics describe object positions, without loading any slide media. */
function LayoutPreview({ preset }: { preset: NativeLayoutPreset }) {
  const columns = preset === "three_columns" ? 3 : preset === "split" ? 2 : 1;
  const image = preset === "image_left" || preset === "image_right";
  const imageX = preset === "image_left" ? 10 : 56;
  const bodyX = preset === "image_left" ? 56 : 10;
  return (
    <svg
      className={styles.layoutPreview}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 106 64"
      fill="none"
    >
      <rect x="1" y="1" width="104" height="62" rx="5" className={styles.previewCanvas} />
      <rect x="10" y="10" width="57" height="5" rx="2" className={styles.previewTitle} />
      {image ? (
        <>
          <rect x={imageX} y="24" width="40" height="30" rx="3" className={styles.previewImage} />
          <path d={`m${imageX + 5} 47 9-10 8 7 6-5 7 8`} className={styles.previewImageLine} />
          <circle cx={imageX + 29} cy="32" r="3" className={styles.previewImageLine} />
          {[25, 32, 39, 46].map((y, index) => (
            <rect
              key={y}
              x={bodyX}
              y={y}
              width={index === 3 ? 26 : 40}
              height="3"
              rx="1.5"
              className={styles.previewText}
            />
          ))}
        </>
      ) : preset === "title_data" ? (
        <>
          <path d="M11 25v29h84" className={styles.previewAxis} />
          {[14, 24, 19, 30, 25].map((height, index) => (
            <rect
              key={index}
              x={20 + index * 15}
              y={53 - height}
              width="9"
              height={height}
              rx="2"
              className={styles.previewChart}
            />
          ))}
        </>
      ) : (
        Array.from({ length: columns }, (_, column) => {
          const width = (86 - (columns - 1) * 7) / columns;
          return [25, 32, 39, 46].map((y, index) => (
            <rect
              key={`${column}-${y}`}
              x={10 + column * (width + 7)}
              y={y}
              width={index === 3 ? width * 0.7 : width}
              height="3"
              rx="1.5"
              className={styles.previewText}
            />
          ));
        })
      )}
    </svg>
  );
}

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
    <fieldset className={styles.section}>
      <legend>
        <span className={styles.sectionTitle}>
          <EditorIcon name="palette" /> Design
        </span>
      </legend>
      <div className={styles.sectionBody}>
        {design ? (
          <>
            <div className={styles.themeField}>
              <label className={styles.field}>
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
                  {(Object.keys(NATIVE_DESIGN_THEMES) as PresentationSceneDesign["theme"][]).map(
                    (theme) => (
                      <option key={theme} value={theme}>
                        {THEME_NAMES[theme]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <div className={styles.themeOptions} role="group" aria-label="Theme palettes">
                {(
                  Object.entries(NATIVE_DESIGN_THEMES) as [
                    PresentationSceneDesign["theme"],
                    (typeof NATIVE_DESIGN_THEMES)[PresentationSceneDesign["theme"]],
                  ][]
                ).map(([theme, palette]) => (
                  <button
                    key={theme}
                    type="button"
                    className={styles.themeOption}
                    aria-label={`Use ${THEME_NAMES[theme]} theme`}
                    aria-pressed={design.theme === theme}
                    onClick={() => {
                      if (design.theme !== theme) update({ ...design, theme });
                    }}
                  >
                    <span
                      className={styles.themePreview}
                      aria-hidden="true"
                      style={{
                        background: palette.background,
                        color: palette.text,
                        borderColor: palette.border,
                      }}
                    >
                      <span className={styles.themePreviewType}>Aa</span>
                      <span className={styles.themePreviewLines}>
                        <span />
                        <span />
                      </span>
                      <span
                        className={styles.themePreviewAccent}
                        style={{ background: palette.link }}
                      />
                    </span>
                    <span className={styles.themeOptionName}>
                      {THEME_NAMES[theme]}
                      <span className={styles.themeSelected} aria-hidden="true">
                        {design.theme === theme ? "✓" : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.designFields}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  <EditorIcon name="type" /> Slide font
                </span>
                <select
                  value={design.font}
                  style={{ fontFamily: NATIVE_DESIGN_FONTS[design.font] }}
                  onChange={(event) =>
                    update({
                      ...design,
                      font: event.target.value as PresentationSceneDesign["font"],
                    })
                  }
                >
                  {(Object.keys(NATIVE_DESIGN_FONTS) as PresentationSceneDesign["font"][]).map(
                    (font) => (
                      <option key={font} value={font}>
                        {FONT_NAMES[font]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  <EditorIcon name="spacing" /> Slide spacing
                </span>
                <select
                  value={design.spacing}
                  onChange={(event) =>
                    update({
                      ...design,
                      spacing: event.target.value as PresentationSceneDesign["spacing"],
                    })
                  }
                >
                  <option value="relaxed">Relaxed · more room</option>
                  <option value="compact">Compact · closer spacing</option>
                </select>
              </label>
            </div>
            <p className={styles.help}>
              Fixed palettes keep text readable. Fonts use those installed on your device.
            </p>
            {onApplyDesignToDeck ? (
              <div className={styles.deckAction}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => onApplyDesignToDeck(design)}
                >
                  <EditorIcon name="slides" />
                  Apply design to all native slides
                </button>
                <p className={styles.help}>Ordinary slides and activities keep their own design.</p>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.help}>Give this slide a coordinated palette, font and spacing.</p>
            <div>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => update(INITIAL_NATIVE_DESIGN)}
              >
                <EditorIcon name="palette" />
                Enable slide design
              </button>
            </div>
            <p className={styles.help}>Starts with Paper, System sans and relaxed spacing.</p>
          </>
        )}
        {failure?.scene === scene ? (
          <p role="alert" className={styles.formatError}>
            {failure.message}
          </p>
        ) : null}
      </div>
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
    <fieldset className={styles.section}>
      <legend>
        <span className={styles.sectionTitle}>
          <EditorIcon name="layout" /> Native layouts
        </span>
      </legend>
      <div className={styles.sectionBody}>
        <p className={styles.help}>Choose a structure for the objects already on this slide.</p>
        <div className={styles.layoutOptions}>
          {NATIVE_LAYOUT_PRESETS.map((preset) => {
            const enabled = canApplyNativeLayout(scene, preset.id);
            return (
              <div key={preset.id} className={styles.layoutOption} data-available={enabled}>
                <button
                  type="button"
                  className={styles.layoutButton}
                  aria-label={preset.label}
                  title={enabled ? "Fits the current objects." : preset.help}
                  disabled={!enabled}
                  onClick={() => {
                    if (enabled) onChange(applyNativeLayout(scene, preset.id));
                  }}
                >
                  <LayoutPreview preset={preset.id} />
                  <span className={styles.layoutName}>
                    {preset.label}
                    {enabled ? (
                      <span className={styles.layoutReady} aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </span>
                </button>
                <p className={styles.help}>{enabled ? "Fits the current objects." : preset.help}</p>
              </div>
            );
          })}
        </div>
        <p className={styles.help}>
          Content stays intact and connectors follow their objects. Add or remove objects to match a
          layout. Check text fit after changing layout or design.
        </p>
      </div>
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
    <fieldset className={styles.section}>
      <legend>
        <span className={styles.sectionTitle}>
          <EditorIcon name="align-left" /> Arrange objects
        </span>
      </legend>
      <div className={styles.sectionBody}>
        <div className={styles.subsectionHeading}>
          <span>Alignment</span>
          <span className={styles.selectionCount}>{framedCount} selected</span>
        </div>
        <div className={styles.alignGrid} role="group" aria-label="Align selected objects">
          {(["left", "center", "right", "top", "middle", "bottom"] as const).map((alignment) => (
            <button
              key={alignment}
              type="button"
              className={styles.iconButton}
              aria-label={`Align ${alignment}`}
              title={`Align ${alignment}`}
              disabled={framedCount < 2 || !canAlignNativeSceneNodes(scene, selectedIds, alignment)}
              onClick={() => {
                if (canAlignNativeSceneNodes(scene, selectedIds, alignment))
                  onChange(alignNativeSceneNodes(scene, selectedIds, alignment));
              }}
            >
              <EditorIcon name={`align-${alignment}` as EditorIconName} />
              <span className={styles.shortLabel}>{alignment}</span>
            </button>
          ))}
        </div>
        <div className={styles.twoColumnGrid} role="group" aria-label="Distribute selected objects">
          {(["horizontal", "vertical"] as const).map((axis) => {
            const enabled = canDistributeNativeSceneNodes(scene, selectedIds, axis);
            return (
              <button
                key={axis}
                type="button"
                className={styles.iconButton}
                aria-label={`Distribute ${axis === "horizontal" ? "horizontally" : "vertically"}`}
                title={`Distribute ${axis === "horizontal" ? "horizontally" : "vertically"}`}
                disabled={!enabled}
                onClick={() => {
                  if (enabled) onChange(distributeNativeSceneNodes(scene, selectedIds, axis));
                }}
              >
                <EditorIcon name={`distribute-${axis}`} />
                <span className={styles.shortLabel}>{axis}</span>
              </button>
            );
          })}
        </div>
        <p className={styles.help}>
          Select at least two objects to align within their combined bounds; three to distribute
          with equal gaps. Stored groups count as one object. Distribution needs room without
          overlap, and rotated objects must stay inside the slide. Outer objects stay fixed when
          distributing.
        </p>
        <div className={styles.layerSection}>
          <div className={styles.subsectionHeading}>
            <span>Layer order</span>
            <span className={styles.selectionCount}>Last selected</span>
          </div>
          <div
            className={styles.twoColumnGrid}
            role="group"
            aria-label="Last selected object layer"
          >
            {(
              [
                ["back", "Send object to back", "To back"],
                ["backward", "Move object backward", "Backward"],
                ["forward", "Move object forward", "Forward"],
                ["front", "Bring object to front", "To front"],
              ] as const
            ).map(([action, label, shortLabel]) => (
              <button
                key={action}
                type="button"
                className={styles.iconButton}
                aria-label={label}
                title={label}
                disabled={!canLayerNativeSceneNode(scene, selectedId, action)}
                onClick={() => {
                  if (canLayerNativeSceneNode(scene, selectedId, action))
                    onChange(layerNativeSceneNode(scene, selectedId, action));
                }}
              >
                <EditorIcon name={`layer-${action}`} />
                <span>{shortLabel}</span>
              </button>
            ))}
          </div>
          <p className={styles.help}>
            Moves the last selected object or its group on wide slides. Reading order stays the
            same, including on narrow screens. Connectors follow objects and stay behind them.
          </p>
        </div>
      </div>
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
    <fieldset className={styles.section}>
      <legend>
        <span className={styles.sectionTitle}>
          <EditorIcon name="image" /> Image and crop
        </span>
      </legend>
      <div className={styles.sectionBody}>
        <label className={styles.field}>
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
          <div className={styles.cropSection}>
            <div className={styles.subsectionHeading}>
              <span>Crop focal point</span>
              <span className={styles.selectionCount}>0–100%</span>
            </div>
            <div className={styles.frameFields}>
              {(["x", "y"] as const).map((axis) => (
                <label key={axis} className={styles.field}>
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
          </div>
        ) : null}
        {failure?.scene === scene ? (
          <p role="alert" className={styles.formatError}>
            {failure.message}
          </p>
        ) : null}
        <p className={styles.help}>
          Contain shows the whole image. Cover fills the frame on wide slides; set the focal point
          to keep your subject visible. Narrow screens show the whole image. Alternative text stays
          available.
        </p>
      </div>
    </fieldset>
  );
}
