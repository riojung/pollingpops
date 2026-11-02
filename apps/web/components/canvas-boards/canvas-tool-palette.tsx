"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CANVAS_FILL_COLORS, CANVAS_STROKE_COLORS } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import { CanvasToolIcon, type CanvasToolIconName } from "./canvas-tool-icon";
import type { CanvasTool } from "./canvas-surface";
import {
  boundedStickyStackCount,
  canvasToolColors,
  filterCanvasShapes,
  type CanvasConnectorPreset,
  type CanvasDrawSettings,
  type CanvasPaletteObjectType,
  type CanvasPaletteShapeVariant,
  type CanvasShapeCatalogEntry,
  type CanvasShapeCategory,
  type CanvasToolColor,
} from "./canvas-tool-catalog";
import styles from "./canvas-tool-palette.module.css";

export type CanvasToolPaletteProps = {
  activeTool: CanvasTool;
  disabled: boolean;
  readOnly?: boolean;
  creationFull?: boolean;
  drawSettings: CanvasDrawSettings;
  selectedStickyColor: CanvasToolColor;
  stickyStackLimit?: number;
  svgUploadDisabled?: boolean;
  templatesDisabled?: boolean;
  onAdd: (
    type: CanvasPaletteObjectType,
    options?: { color?: CanvasToolColor; shapeVariant?: CanvasPaletteShapeVariant },
  ) => void;
  onTool: (tool: CanvasTool) => void;
  onConnector: (preset: CanvasConnectorPreset) => void;
  onDrawSettings: (settings: CanvasDrawSettings) => void;
  onUploadSvg: () => void;
  onTemplates: () => void;
  onStickyStack: (count: number, color: CanvasToolColor) => void;
};
type Panel = "sticky" | "shapes" | "drawing";

/** SVG previews are original code paths, with no external assets or arbitrary SVG markup. */
export function CanvasShapePreview({ entry }: { entry: CanvasShapeCatalogEntry }) {
  return (
    <svg
      viewBox="0 0 64 48"
      width="64"
      height="48"
      aria-hidden="true"
      focusable="false"
      fill={entry.preset || entry.type === "frame" ? "none" : "var(--ui-accent-soft)"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={entry.path} />
    </svg>
  );
}

export function CanvasToolPalette({
  activeTool,
  disabled,
  readOnly = false,
  creationFull = false,
  drawSettings,
  selectedStickyColor,
  stickyStackLimit = 20,
  svgUploadDisabled = false,
  templatesDisabled = false,
  onAdd,
  onTool,
  onConnector,
  onDrawSettings,
  onUploadSvg,
  onTemplates,
  onStickyStack,
}: CanvasToolPaletteProps) {
  const { locale } = useLocale();
  const copy = canvasToolCopy(locale);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const flyout = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CanvasShapeCategory | "all">("all");
  const [stackCount, setStackCount] = useState(5);
  const editDisabled = disabled || readOnly;
  const createDisabled = editDisabled || creationFull;
  const stackLimit = Math.max(0, Math.min(20, Math.floor(stickyStackLimit)));
  const count = boundedStickyStackCount(stackCount, stackLimit);
  const entries = filterCanvasShapes(query, category, copy);

  function close(restoreFocus = true) {
    setPanel(null);
    if (restoreFocus) trigger.current?.focus();
  }
  function toggle(next: Panel, button: HTMLButtonElement) {
    if (disabled) return;
    trigger.current = button;
    setPanel((previous) => (previous === next ? null : next));
  }
  useEffect(() => {
    if (!panel) return;
    const container = root.current;
    function outside(event: Event) {
      if (event.target instanceof Node && !container?.contains(event.target)) setPanel(null);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPanel(null);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    const initial =
      flyout.current?.querySelector<HTMLElement>("[data-initial-focus]") ??
      flyout.current?.querySelector<HTMLElement>("button:not(:disabled),input:not(:disabled)");
    initial?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [panel]);

  function add(
    type: CanvasPaletteObjectType,
    options?: { color?: CanvasToolColor; shapeVariant?: CanvasPaletteShapeVariant },
  ) {
    if (createDisabled) return;
    onAdd(type, options);
    close();
  }
  function setDrawing(next: CanvasDrawSettings) {
    if (next.mode === "eraser" ? editDisabled : createDisabled) return;
    onDrawSettings(next);
    onTool(next.mode === "eraser" ? "eraser" : "pen");
  }
  function toolButton(
    label: string,
    icon: CanvasToolIconName,
    action: () => void,
    pressed?: boolean,
    blocked = disabled,
    extra?: ReactNode,
  ) {
    return (
      <button
        type="button"
        className={styles.tool}
        aria-label={label}
        title={label}
        aria-pressed={pressed}
        disabled={blocked}
        onClick={() => {
          if (!blocked) {
            trigger.current = null;
            action();
            close(false);
          }
        }}
      >
        <CanvasToolIcon name={icon} />
        {extra}
      </button>
    );
  }
  function panelButton(kind: Panel, label: string, icon: CanvasToolIconName) {
    return (
      <button
        type="button"
        className={styles.tool}
        aria-label={label}
        title={label}
        aria-expanded={panel === kind}
        aria-haspopup="dialog"
        aria-controls={panel === kind ? `${id}-panel` : undefined}
        disabled={disabled}
        onClick={(event) => toggle(kind, event.currentTarget)}
      >
        <CanvasToolIcon name={icon} />
        <span className={styles.groupDot} aria-hidden="true" />
      </button>
    );
  }
  function swatches(kind: "sticky" | "drawing") {
    const value = kind === "sticky" ? selectedStickyColor : drawSettings.color;
    const blocked = createDisabled || (kind === "drawing" && drawSettings.mode === "eraser");
    return (
      <div
        className={styles.swatches}
        role="group"
        aria-label={kind === "sticky" ? copy.stickyColor : copy.drawingColor}
      >
        {canvasToolColors.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.swatch}
            aria-label={kind === "sticky" ? `${copy.sticky}: ${copy[color]}` : copy[color]}
            title={copy[color]}
            aria-pressed={value === color}
            disabled={blocked}
            onClick={() => {
              if (blocked) return;
              if (kind === "sticky") add("sticky", { color });
              else setDrawing({ ...drawSettings, color });
            }}
            style={
              {
                "--swatch": (kind === "sticky" ? CANVAS_FILL_COLORS : CANVAS_STROKE_COLORS)[color],
              } as CSSProperties
            }
          >
            <span className={styles.swatchInk} aria-hidden="true">
              {value === color ? (
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke={
                    color === "black" ||
                    (kind === "drawing" &&
                      !["white", "yellow", "lime", "mint", "sky", "lavender"].includes(color))
                      ? "white"
                      : "#16251f"
                  }
                  strokeWidth="2.5"
                >
                  <path d="m5 10 3 3 7-7" />
                </svg>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    );
  }

  const title =
    panel === "sticky" ? copy.stickyColors : panel === "shapes" ? copy.shapes : copy.drawing;
  return (
    <div ref={root} className={styles.paletteRoot} data-canvas-tool-palette>
      <div className={styles.rail} role="group" aria-label={copy.toolbar}>
        {toolButton(copy.select, "select", () => onTool("select"), activeTool === "select")}
        {toolButton(copy.pan, "hand", () => onTool("hand"), activeTool === "hand")}
        {toolButton(
          copy.areaSelection,
          "marquee",
          () => onTool("marquee"),
          activeTool === "marquee",
        )}
        {toolButton(copy.text, "text", () => add("text"), undefined, createDisabled)}
        <span className={styles.divider} aria-hidden="true" />
        {toolButton(
          copy.sticky,
          "sticky",
          () => add("sticky", { color: selectedStickyColor }),
          undefined,
          createDisabled,
          <span
            className={styles.colorDot}
            style={{ backgroundColor: CANVAS_FILL_COLORS[selectedStickyColor] }}
            aria-hidden="true"
          />,
        )}
        {panelButton("sticky", copy.stickyColors, "palette")}
        {toolButton(
          copy.rectangle,
          "rect",
          () => add("rect", { shapeVariant: "rectangle" }),
          undefined,
          createDisabled,
        )}
        {toolButton(copy.oval, "ellipse", () => add("ellipse"), undefined, createDisabled)}
        {toolButton(copy.frame, "frame", () => add("frame"), undefined, createDisabled)}
        {toolButton(
          copy.connector,
          "connector",
          () => onConnector("arrow"),
          activeTool === "connector",
          createDisabled,
        )}
        {panelButton("shapes", copy.shapes, "shapes")}
        {toolButton(
          copy.pen,
          "pen",
          () => setDrawing({ ...drawSettings, mode: "pen" }),
          activeTool === "pen" && drawSettings.mode === "pen",
          createDisabled,
        )}
        {panelButton("drawing", copy.drawing, "sliders")}
        <span className={styles.divider} aria-hidden="true" />
        {toolButton(
          copy.templates,
          "templates",
          onTemplates,
          undefined,
          createDisabled || templatesDisabled,
        )}
        {toolButton(
          copy.uploadSvg,
          "upload-svg",
          onUploadSvg,
          undefined,
          createDisabled || svgUploadDisabled,
        )}
      </div>
      {panel ? (
        <section
          ref={flyout}
          className={styles.panel}
          id={`${id}-panel`}
          role="dialog"
          aria-labelledby={`${id}-title`}
        >
          <div className={styles.panelHeader}>
            <h2 id={`${id}-title`}>{title}</h2>
            <button
              type="button"
              className={styles.close}
              aria-label={copy.close}
              title={copy.close}
              onClick={() => close()}
            >
              <CanvasToolIcon name="close" />
            </button>
          </div>
          <div className={styles.panelBody}>
            {panel === "sticky" ? (
              <>
                <p className={styles.help}>{copy.stickyHelp}</p>
                {swatches("sticky")}
                <div className={styles.stack}>
                  <h3>{copy.stickyStack}</h3>
                  <p className={styles.help} id={`${id}-stack-help`}>
                    {copy.stackHelp}
                  </p>
                  <label className={styles.field} htmlFor={`${id}-count`}>
                    <span>{copy.stackCount}</span>
                    <input
                      id={`${id}-count`}
                      type="number"
                      min="1"
                      max={Math.max(1, stackLimit)}
                      step="1"
                      value={count}
                      disabled={createDisabled || stackLimit < 1}
                      aria-describedby={`${id}-stack-help`}
                      onChange={(event) =>
                        setStackCount(
                          boundedStickyStackCount(Number(event.target.value), stackLimit),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.primaryAction}
                    disabled={createDisabled || stackLimit < 1}
                    onClick={() => {
                      if (!createDisabled && stackLimit > 0) {
                        onStickyStack(count, selectedStickyColor);
                        close();
                      }
                    }}
                  >
                    <CanvasToolIcon name="sticky" />
                    {copy.addStack}
                    <span className={styles.countBadge}>{count}</span>
                  </button>
                </div>
              </>
            ) : null}
            {panel === "shapes" ? (
              <>
                <label className={styles.search} htmlFor={`${id}-search`}>
                  <span className={styles.srOnly}>{copy.searchShapes}</span>
                  <input
                    id={`${id}-search`}
                    data-initial-focus
                    type="search"
                    value={query}
                    placeholder={copy.searchShapes}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <div className={styles.categories} role="group" aria-label={copy.shapes}>
                  {(["all", "basics", "flowchart", "connectors"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={category === value}
                      onClick={() => setCategory(value)}
                    >
                      {copy[value]}
                    </button>
                  ))}
                </div>
                <p className={styles.help}>{copy.shapeHelp}</p>
                {entries.length ? (
                  <div className={styles.shapeGrid}>
                    {entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={styles.shape}
                        disabled={createDisabled}
                        onClick={() => {
                          if (createDisabled) return;
                          if (entry.preset) {
                            onConnector(entry.preset);
                            close();
                          } else
                            add(
                              entry.type,
                              entry.shapeVariant ? { shapeVariant: entry.shapeVariant } : undefined,
                            );
                        }}
                      >
                        <CanvasShapePreview entry={entry} />
                        <span>{copy[entry.label]}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty} role="status">
                    {copy.noShapes}
                  </p>
                )}
              </>
            ) : null}
            {panel === "drawing" ? (
              <>
                <fieldset className={styles.drawingModes} disabled={editDisabled}>
                  <legend>{copy.drawingMode}</legend>
                  <div>
                    {(["pen", "highlighter", "eraser"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={drawSettings.mode === mode}
                        disabled={mode === "eraser" ? editDisabled : createDisabled}
                        onClick={() =>
                          setDrawing({
                            ...drawSettings,
                            mode,
                            width:
                              mode === "highlighter" && drawSettings.mode !== "highlighter"
                                ? Math.max(12, drawSettings.width)
                                : drawSettings.width,
                          })
                        }
                      >
                        <CanvasToolIcon name={mode} />
                        <span>{copy[mode]}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                {drawSettings.mode === "eraser" ? (
                  <p className={styles.help}>{copy.eraserHelp}</p>
                ) : (
                  <>
                    <p className={styles.fieldTitle}>{copy.drawingColor}</p>
                    {swatches("drawing")}
                    <label className={styles.widthField} htmlFor={`${id}-width`}>
                      <span>{copy.strokeWidth}</span>
                      <output htmlFor={`${id}-width`}>{drawSettings.width}</output>
                      <input
                        id={`${id}-width`}
                        type="range"
                        min="1"
                        max="24"
                        step="1"
                        value={drawSettings.width}
                        disabled={createDisabled}
                        onChange={(event) =>
                          setDrawing({
                            ...drawSettings,
                            width: Math.max(1, Math.min(24, Number(event.target.value))),
                          })
                        }
                      />
                    </label>
                    <svg
                      className={styles.strokePreview}
                      viewBox="0 0 280 52"
                      role="img"
                      aria-label={copy.drawPreview}
                    >
                      <path
                        d="M22 32c35-40 56 28 91-4s59-16 84 0 35-10 61-9"
                        fill="none"
                        stroke={CANVAS_STROKE_COLORS[drawSettings.color]}
                        strokeWidth={drawSettings.width}
                        opacity={drawSettings.mode === "highlighter" ? 0.35 : 1}
                        strokeLinecap="round"
                      />
                    </svg>
                  </>
                )}
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
