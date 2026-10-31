"use client";
import type { CanvasObject } from "@openround/contracts";
import { canvasDiagramCopy } from "../../lib/i18n/canvas-diagram-messages";
import { useLocale } from "../locale-provider";
import type { CanvasObjectDraft } from "./canvas-draft";
import { changeCanvasEndpoint } from "./canvas-diagram-model";
import styles from "./canvas.module.css";

export function CanvasDiagramInspector({
  object,
  objects,
  draft,
  disabled,
  onChange,
  label,
}: {
  object: CanvasObject;
  objects: CanvasObject[];
  draft: CanvasObjectDraft;
  disabled: boolean;
  onChange: (draft: CanvasObjectDraft) => void;
  label: (object: CanvasObject, index: number) => string;
}) {
  const { locale, t } = useLocale();
  const copy = canvasDiagramCopy(locale);
  if (object.type !== "connector")
    return object.type === "idea_ref" || object.type === "pen" ? null : (
      <label>
        {copy.rotation}
        <input
          type="number"
          step="any"
          min={-180}
          max={180}
          value={draft.rotation}
          disabled={disabled}
          onChange={(event) => {
            if (Number.isFinite(event.currentTarget.valueAsNumber))
              onChange({ ...draft, rotation: event.currentTarget.valueAsNumber });
          }}
        />
      </label>
    );
  return (
    <>
      <label>
        {copy.routing}
        <select
          value={draft.routing ?? object.routing}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, routing: event.target.value as "straight" | "elbow" })
          }
        >
          <option value="straight">{copy.straight}</option>
          <option value="elbow">{copy.elbow}</option>
        </select>
      </label>
      <label>
        {copy.lineStyle}
        <select
          value={draft.lineStyle ?? object.lineStyle}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, lineStyle: event.target.value as "solid" | "dashed" })
          }
        >
          <option value="solid">{copy.solid}</option>
          <option value="dashed">{copy.dashed}</option>
        </select>
      </label>
      <label>
        {copy.lineColor}
        <select
          value={draft.lineColor ?? object.lineColor}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, lineColor: event.target.value as CanvasObjectDraft["lineColor"] })
          }
        >
          <option value="neutral">{copy.neutral}</option>
          {(["yellow", "blue", "green", "pink", "purple", "white"] as const).map((color) => (
            <option key={color} value={color}>
              {t(
                color === "yellow" || color === "pink" || color === "white"
                  ? `canvas.color.${color}`
                  : color === "blue"
                    ? "boards.colorBlue"
                    : color === "green"
                      ? "boards.colorGreen"
                      : "boards.colorPurple",
              )}
            </option>
          ))}
        </select>
      </label>
      {(["startMarker", "endMarker"] as const).map((field) => (
        <label key={field}>
          {copy[field]}
          <select
            value={draft[field] ?? object[field]}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...draft, [field]: event.target.value as "none" | "arrow" })
            }
          >
            <option value="none">{copy.none}</option>
            <option value="arrow">{copy.arrow}</option>
          </select>
        </label>
      ))}
      {(["from", "to"] as const).map((side) => (
        <div className={styles.diagramEndpoint} key={side}>
          <label>
            {t(side === "from" ? "canvas.connectorFrom" : "canvas.connectorTo")}
            <select
              value={draft[`${side}Id`] ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onChange(changeCanvasEndpoint(object, draft, side, event.target.value, objects))
              }
            >
              <option value="">{copy.free}</option>
              {objects
                .filter((entry) => entry.id !== object.id && entry.type !== "connector")
                .map((entry, index) => (
                  <option key={entry.id} value={entry.id}>
                    {label(entry, index)}
                  </option>
                ))}
            </select>
          </label>
          {draft[`${side}Id`] ? (
            <label>
              {side === "from" ? copy.fromPort : copy.toPort}
              <select
                value={draft[`${side}Anchor`] ?? object[side].anchor}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, [`${side}Anchor`]: event.target.value })}
              >
                {(["center", "top", "right", "bottom", "left"] as const).map((anchor) => (
                  <option key={anchor} value={anchor}>
                    {copy[anchor]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className={styles.numeric}>
              {(["X", "Y"] as const).map((axis) => (
                <label key={axis}>
                  {copy[`${side}${axis}`]}
                  <input
                    type="number"
                    min={-100000}
                    max={100000}
                    step="any"
                    disabled={disabled}
                    value={draft[`${side}${axis}`] ?? object[side][axis === "X" ? "x" : "y"]}
                    onChange={(event) => {
                      if (Number.isFinite(event.currentTarget.valueAsNumber))
                        onChange({
                          ...draft,
                          [`${side}${axis}`]: event.currentTarget.valueAsNumber,
                        });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
