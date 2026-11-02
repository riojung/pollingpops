"use client";

import { useEffect, useRef } from "react";
import {
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  CanvasColorSchema,
  type CanvasObject,
  type CanvasObjectPatchSchema,
} from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import { formatNumber } from "../../lib/i18n/format";
import { CanvasToolIcon, type CanvasToolIconName } from "./canvas-tool-icon";
import styles from "./canvas-context-toolbar.module.css";

export type CanvasConvertibleType =
  "sticky" | "text" | "rect" | "ellipse" | "diamond" | "parallelogram";
type Patch = ReturnType<typeof CanvasObjectPatchSchema.parse>;
const convertible: CanvasConvertibleType[] = [
  "sticky",
  "text",
  "rect",
  "ellipse",
  "diamond",
  "parallelogram",
];
const textTypes = new Set([
  "sticky",
  "text",
  "rect",
  "ellipse",
  "diamond",
  "parallelogram",
  "frame",
  "link",
]);

function shared<T>(values: T[]): T | "" {
  return values.length && values.every((value) => value === values[0]) ? values[0]! : "";
}

export function CanvasContextToolbar({
  objects,
  disabled,
  editable,
  canLock,
  canDuplicate,
  canDelete,
  onPatch,
  onConvert,
  onLock,
  onDuplicate,
  onDelete,
  onEditText,
  onMore,
}: {
  objects: CanvasObject[];
  disabled: boolean;
  editable: boolean;
  canLock: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  onPatch: (patch: Patch) => void;
  onConvert: (type: CanvasConvertibleType) => void;
  onLock: (locked: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEditText: () => void;
  onMore: () => void;
}) {
  const { t, locale } = useLocale();
  const copy = canvasToolCopy(locale);
  const toolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!(event.target instanceof Node) || toolbar.current?.contains(event.target)) return;
      toolbar.current
        ?.querySelectorAll("details[open]")
        .forEach((node) => node.removeAttribute("open"));
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  if (!objects.length) return null;
  const protectedSelection = objects.some((object) => object.type === "idea_ref");
  const canStyle = editable && !disabled && !protectedSelection;
  const text = objects.every((object) => textTypes.has(object.type));
  const colors = objects.every((object) => object.type !== "image" && object.type !== "idea_ref");
  const canConvert = objects.every((object) =>
    convertible.includes(object.type as CanvasConvertibleType),
  );
  const color = shared(
    objects.map((object) =>
      object.type === "connector"
        ? object.lineColor === "neutral"
          ? ""
          : object.lineColor
        : object.color,
    ),
  );
  const ink = objects.every((object) => object.type === "connector" || object.type === "pen");
  const colorLabel = ink ? copy.drawingColor : copy.fillColor;
  const colorValues = ink ? CANVAS_STROKE_COLORS : CANVAS_FILL_COLORS;
  const locked = objects.every((object) => object.locked);
  const fontSize = shared(objects.map((object) => object.fontSize));
  const strokeWidth = shared(objects.map((object) => object.strokeWidth));
  const opacity = shared(objects.map((object) => object.opacity));
  function iconButton(
    name: CanvasToolIconName,
    label: string,
    action: () => void,
    pressed?: boolean,
    available = canStyle,
  ) {
    return (
      <button
        type="button"
        className={styles.icon}
        aria-label={label}
        title={label}
        disabled={!available}
        aria-pressed={pressed}
        onClick={action}
      >
        <CanvasToolIcon name={name} />
      </button>
    );
  }
  return (
    <div
      ref={toolbar}
      className={styles.toolbar}
      role="toolbar"
      aria-label={copy.selectionToolbar}
      aria-orientation="horizontal"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          const open = toolbar.current?.querySelector<HTMLDetailsElement>("details[open]");
          if (open) {
            event.preventDefault();
            event.stopPropagation();
            open.removeAttribute("open");
            open.querySelector<HTMLElement>("summary")?.focus();
          }
        }
        if (
          !(event.target instanceof HTMLElement) ||
          !["BUTTON", "SUMMARY"].includes(event.target.tagName) ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          return;
        const controls = Array.from(
          toolbar.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), select:not(:disabled), summary",
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        const index = controls.indexOf(event.target);
        if (index < 0) return;
        const rtl = getComputedStyle(toolbar.current!).direction === "rtl";
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? controls.length - 1
              : (index + ((event.key === "ArrowRight") !== rtl ? 1 : -1) + controls.length) %
                controls.length;
        event.preventDefault();
        event.stopPropagation();
        controls[next]?.focus();
      }}
    >
      {objects.length > 1 ? (
        <span className={styles.count}>{formatNumber(locale, objects.length)}</span>
      ) : null}
      {canConvert ? (
        <label className={styles.selectLabel}>
          <span className={styles.srOnly}>{copy.convert}</span>
          <select
            aria-label={copy.convert}
            value={shared(objects.map((object) => object.type))}
            disabled={!canStyle}
            onChange={(event) => onConvert(event.target.value as CanvasConvertibleType)}
          >
            <option value="" disabled>
              {copy.mixed}
            </option>
            {convertible.map((type) => (
              <option key={type} value={type}>
                {type === "diamond"
                  ? copy.diamond
                  : type === "parallelogram"
                    ? copy.parallelogram
                    : t(
                        type === "sticky"
                          ? "canvas.sticky"
                          : type === "text"
                            ? "boards.textTool"
                            : type === "rect"
                              ? "boards.rectangleTool"
                              : "boards.ellipseTool",
                      )}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {text ? (
        <>
          <label className={styles.selectLabel}>
            <span className={styles.srOnly}>{copy.fontFamily}</span>
            <select
              aria-label={copy.fontFamily}
              value={shared(objects.map((object) => object.fontFamily))}
              disabled={!canStyle}
              onChange={(event) =>
                onPatch({ fontFamily: event.target.value as CanvasObject["fontFamily"] })
              }
            >
              <option value="" disabled>
                {copy.mixed}
              </option>
              <option value="sans">{copy.sans}</option>
              <option value="serif">{copy.serif}</option>
              <option value="mono">{copy.monospace}</option>
            </select>
          </label>
          <label className={`${styles.selectLabel} ${styles.number}`}>
            <span className={styles.srOnly}>{copy.fontSize}</span>
            <select
              aria-label={copy.fontSize}
              value={fontSize}
              disabled={!canStyle}
              onChange={(event) => onPatch({ fontSize: Number(event.target.value) })}
            >
              <option value="" disabled>
                {copy.mixed}
              </option>
              {[
                ...new Set([
                  10,
                  12,
                  14,
                  16,
                  18,
                  20,
                  24,
                  28,
                  32,
                  40,
                  48,
                  64,
                  72,
                  96,
                  ...(fontSize === "" ? [] : [fontSize]),
                ]),
              ]
                .sort((a, b) => a - b)
                .map((size) => (
                  <option key={size} value={size}>
                    {formatNumber(locale, size)}
                  </option>
                ))}
            </select>
          </label>
          {iconButton(
            "bold",
            copy.bold,
            () =>
              onPatch({
                fontWeight: objects.every((object) => object.fontWeight === "bold")
                  ? "normal"
                  : "bold",
              }),
            objects.every((object) => object.fontWeight === "bold"),
          )}
          {iconButton(
            "italic",
            copy.italic,
            () =>
              onPatch({
                fontStyle: objects.every((object) => object.fontStyle === "italic")
                  ? "normal"
                  : "italic",
              }),
            objects.every((object) => object.fontStyle === "italic"),
          )}
          {iconButton(
            "underline",
            copy.underline,
            () =>
              onPatch({
                textDecoration: objects.every((object) => object.textDecoration === "underline")
                  ? "none"
                  : "underline",
              }),
            objects.every((object) => object.textDecoration === "underline"),
          )}
          <span className={styles.divider} aria-hidden="true" />
          {(["left", "center", "right"] as const).map((align) => (
            <span key={align}>
              {iconButton(
                `align-${align}`,
                copy[
                  align === "left" ? "alignLeft" : align === "center" ? "alignCenter" : "alignRight"
                ],
                () => onPatch({ textAlign: align }),
                objects.every((object) => object.textAlign === align),
              )}
            </span>
          ))}
        </>
      ) : null}
      {colors ? (
        <details className={styles.colorMenu}>
          <summary
            aria-label={colorLabel}
            title={colorLabel}
            aria-disabled={!canStyle}
            onClick={(event) => {
              if (!canStyle) event.preventDefault();
            }}
          >
            <span
              className={styles.colorDot}
              style={{
                background: color ? colorValues[color] : "linear-gradient(135deg,#f9d9e4,#cde7ff)",
              }}
            />
          </summary>
          <div className={styles.palette} role="group" aria-label={colorLabel}>
            {CanvasColorSchema.options.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={copy.colors[value]}
                title={copy.colors[value]}
                aria-pressed={color === value}
                disabled={!canStyle}
                style={{ background: colorValues[value] }}
                onClick={(event) => {
                  onPatch(
                    objects.every((object) => object.type === "connector")
                      ? { lineColor: value }
                      : { color: value },
                  );
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                <span>{color === value ? "✓" : ""}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}
      {objects.every(
        (object) =>
          object.type !== "image" &&
          object.type !== "idea_ref" &&
          object.type !== "text" &&
          object.type !== "sticky",
      ) ? (
        <label className={`${styles.selectLabel} ${styles.number}`}>
          <span className={styles.srOnly}>{copy.strokeWidth}</span>
          <select
            aria-label={copy.strokeWidth}
            disabled={!canStyle}
            value={strokeWidth}
            onChange={(event) => onPatch({ strokeWidth: Number(event.target.value) })}
          >
            <option value="" disabled>
              {copy.mixed}
            </option>
            {[
              ...new Set([
                1,
                2,
                3,
                4,
                6,
                8,
                12,
                16,
                24,
                ...(strokeWidth === "" ? [] : [strokeWidth]),
              ]),
            ]
              .sort((a, b) => a - b)
              .map((width) => (
                <option key={width} value={width}>
                  {formatNumber(locale, width)}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {!protectedSelection ? (
        <label className={`${styles.selectLabel} ${styles.number}`}>
          <span className={styles.srOnly}>{copy.opacity}</span>
          <select
            aria-label={copy.opacity}
            disabled={!canStyle}
            value={opacity}
            onChange={(event) => onPatch({ opacity: Number(event.target.value) })}
          >
            <option value="" disabled>
              {copy.mixed}
            </option>
            {[...new Set([1, 0.75, 0.5, 0.35, 0.25, 0.1, ...(opacity === "" ? [] : [opacity])])]
              .sort((a, b) => b - a)
              .map((opacity) => (
                <option key={opacity} value={opacity}>
                  {formatNumber(locale, opacity, { style: "percent" })}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <span className={styles.divider} aria-hidden="true" />
      {objects.length === 1 && text && objects[0]?.type !== "link"
        ? iconButton("text", copy.editText, onEditText)
        : null}
      {iconButton(
        locked ? "unlock" : "lock",
        locked ? copy.unlock : copy.lock,
        () => onLock(!locked),
        locked,
        !disabled && canLock,
      )}
      {iconButton("copy", copy.duplicate, onDuplicate, undefined, !disabled && canDuplicate)}
      {iconButton("trash", copy.delete, onDelete, undefined, !disabled && canDelete)}
      {iconButton("more", copy.more, onMore, undefined, !disabled)}
    </div>
  );
}
