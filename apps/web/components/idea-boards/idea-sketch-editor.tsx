"use client";

import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  IdeaBoardSketchSchema,
  type IdeaBoardSketch,
  type IdeaBoardSketchElement,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import {
  emptySketch,
  moveSketchElement,
  newSketchElement,
  sketchElementBounds,
  sketchHistory,
  sketchHistoryReducer,
  sketchPoint,
  sketchPointCount,
  updateDrawnElement,
  type SketchPoint,
  type SketchTool,
} from "./sketch-model";
import { SketchPreview, sketchColors } from "./sketch-preview";
import styles from "./boards.module.css";

const tools = ["select", "freehand", "rect", "ellipse", "line", "arrow", "text"] as const;
const toolKeys = {
  select: "boards.selectTool",
  freehand: "boards.penTool",
  rect: "boards.rectangleTool",
  ellipse: "boards.ellipseTool",
  line: "boards.lineTool",
  arrow: "boards.arrowTool",
  text: "boards.textTool",
} as const;
const colorKeys = {
  ink: "boards.colorInk",
  blue: "boards.colorBlue",
  green: "boards.colorGreen",
  orange: "boards.colorOrange",
  red: "boards.colorRed",
  purple: "boards.colorPurple",
} as const;

type Gesture = {
  pointerId: number;
  start: SketchPoint;
  original: IdeaBoardSketchElement;
  element: IdeaBoardSketchElement;
  adding: boolean;
};

export function IdeaSketchEditor({
  value,
  disabled = false,
  onSave,
  onCancel,
}: {
  value: IdeaBoardSketch | null;
  disabled?: boolean;
  onSave: (value: IdeaBoardSketch) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [history, dispatch] = useReducer(
    sketchHistoryReducer,
    value ?? emptySketch(),
    sketchHistory,
  );
  const [tool, setTool] = useState<SketchTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transient, setTransient] = useState<IdeaBoardSketchElement | null>(null);
  const [error, setError] = useState<"boards.invalidDrawing" | "boards.sketchEmpty" | null>(null);
  const document = history.present;
  const selected = document.elements.find((element) => element.id === selectedId);
  const rendered = transient
    ? {
        ...document,
        elements: gesture.current?.adding
          ? [...document.elements, transient]
          : document.elements.map((element) => (element.id === transient.id ? transient : element)),
      }
    : document;

  useEffect(() => {
    const previous = window.document.activeElement;
    const element = dialog.current;
    element?.showModal();
    saveButton.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      gesture.current = null;
      setTransient(null);
    }
  }, [disabled]);

  function commit(next: IdeaBoardSketch) {
    if (disabled) return;
    setError(null);
    dispatch({ type: "commit", sketch: next });
  }

  function changeElement(next: IdeaBoardSketchElement) {
    const parsed = IdeaBoardSketchSchema.safeParse({
      ...document,
      elements: document.elements.map((element) => (element.id === next.id ? next : element)),
    });
    if (parsed.success)
      commit({
        ...document,
        elements: document.elements.map((element) => (element.id === next.id ? next : element)),
      });
  }

  function addElement(nextTool: Exclude<SketchTool, "select">) {
    if (
      disabled ||
      document.elements.length >= 32 ||
      (nextTool === "freehand" && sketchPointCount(document) >= 1023)
    )
      return;
    try {
      const element = newSketchElement(nextTool, clientUuid(), t("boards.newText"));
      commit({ ...document, elements: [...document.elements, element] });
      setSelectedId(element.id);
    } catch {
      setError("boards.invalidDrawing");
    }
  }

  function removeSelected() {
    if (!selectedId) return;
    commit({
      ...document,
      elements: document.elements.filter((element) => element.id !== selectedId),
    });
    setSelectedId(null);
  }

  function cancelGesture() {
    const current = gesture.current;
    gesture.current = null;
    setTransient(null);
    if (current && canvas.current?.hasPointerCapture(current.pointerId))
      canvas.current.releasePointerCapture(current.pointerId);
  }

  function point(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return sketchPoint(
      ((event.clientX - bounds.left) / bounds.width) * 1000,
      ((event.clientY - bounds.top) / bounds.height) * 600,
    );
  }

  function startGesture(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0 || gesture.current) return;
    const start = point(event);
    let element: IdeaBoardSketchElement;
    let adding = false;
    if (tool === "select") {
      const target =
        event.target instanceof Element ? event.target.closest("[data-sketch-element]") : null;
      const found = document.elements.find(
        (item) => item.id === target?.getAttribute("data-sketch-element"),
      );
      setSelectedId(found?.id ?? null);
      if (!found) return;
      element = found;
    } else {
      if (
        document.elements.length >= 32 ||
        (tool === "freehand" && sketchPointCount(document) >= 1023)
      )
        return;
      try {
        element = newSketchElement(tool, clientUuid(), t("boards.newText"), start);
      } catch {
        setError("boards.invalidDrawing");
        return;
      }
      if (element.type === "text") {
        commit({
          ...document,
          elements: [...document.elements, { ...element, x: start[0], y: start[1] }],
        });
        setSelectedId(element.id);
        setTool("select");
        return;
      }
      if (element.type === "freehand") element = { ...element, points: [start, start] };
      else if (element.type === "line" || element.type === "arrow")
        element = { ...element, x1: start[0], y1: start[1], x2: start[0], y2: start[1] };
      else element = updateDrawnElement(element, start, start);
      adding = true;
      setSelectedId(element.id);
    }
    gesture.current = { pointerId: event.pointerId, start, original: element, element, adding };
    setTransient(element);
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      cancelGesture();
    }
  }

  function moveGesture(event: ReactPointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || disabled) return;
    const end = point(event);
    current.element = current.adding
      ? updateDrawnElement(
          current.element,
          current.start,
          end,
          Math.min(128, 1024 - sketchPointCount(document)),
        )
      : moveSketchElement(current.original, end[0] - current.start[0], end[1] - current.start[1]);
    setTransient(current.element);
  }

  function finishGesture(event: ReactPointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    moveGesture(event);
    const next = {
      ...document,
      elements: current.adding
        ? [...document.elements, current.element]
        : document.elements.map((element) =>
            element.id === current.element.id ? current.element : element,
          ),
    };
    cancelGesture();
    const parsed = IdeaBoardSketchSchema.safeParse(next);
    if (parsed.success) commit(parsed.data);
    else setError("boards.invalidDrawing");
  }

  function keyboard(event: KeyboardEvent<HTMLDialogElement>) {
    const target = event.target;
    if (
      disabled ||
      (target instanceof HTMLElement &&
        (target.matches("input,textarea,select") || target.isContentEditable))
    )
      return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      cancelGesture();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    } else if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      cancelGesture();
    } else if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault();
      removeSelected();
    } else if (
      selected &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      changeElement(
        moveSketchElement(
          selected,
          event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
        ),
      );
    }
  }

  function numericField(
    label:
      | "boards.positionX"
      | "boards.positionY"
      | "boards.shapeWidth"
      | "boards.shapeHeight"
      | "boards.endX"
      | "boards.endY",
    field: "x" | "y" | "width" | "height" | "x1" | "y1" | "x2" | "y2",
    value: number,
    max: number,
    min = 0,
  ) {
    return (
      <label>
        {t(label)}
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            if (selected && Number.isFinite(event.target.valueAsNumber))
              changeElement({
                ...selected,
                [field]: Math.round(Math.max(min, Math.min(max, event.target.valueAsNumber))),
              } as IdeaBoardSketchElement);
          }}
        />
      </label>
    );
  }

  function save() {
    if (!document.elements.length) {
      setError("boards.sketchEmpty");
      return;
    }
    const parsed = IdeaBoardSketchSchema.safeParse(document);
    if (!parsed.success) {
      setError("boards.invalidDrawing");
      return;
    }
    onSave(parsed.data);
  }

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.sketchDialog}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      onKeyDown={keyboard}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className={styles.heading}>
        <h2 id={`${id}-title`}>{t("boards.sketchTitle")}</h2>
        <div className={styles.actions}>
          <button type="button" className="button-quiet" onClick={onCancel}>
            {t("boards.cancel")}
          </button>
          <button
            ref={saveButton}
            type="button"
            className="button"
            disabled={disabled || Boolean(transient)}
            onClick={save}
          >
            {t("boards.saveDrawing")}
          </button>
        </div>
      </div>
      <p id={`${id}-help`} className={styles.muted}>
        {t("boards.sketchHelp")}
      </p>
      <div className={styles.sketchToolbar} role="group" aria-label={t("boards.sketchCanvas")}>
        {tools.map((item) => (
          <button
            key={item}
            type="button"
            className="button-quiet"
            aria-pressed={tool === item}
            disabled={disabled || (item !== "select" && document.elements.length >= 32)}
            onClick={() => {
              cancelGesture();
              setTool(item);
            }}
          >
            {t(toolKeys[item])}
          </button>
        ))}
        {tool !== "select" && tool !== "freehand" ? (
          <button
            type="button"
            className="button-quiet"
            disabled={disabled || document.elements.length >= 32}
            onClick={() => addElement(tool)}
          >
            {t("boards.addElement", { type: t(toolKeys[tool]) })}
          </button>
        ) : null}
        <span className={styles.toolbarDivider} aria-hidden="true" />
        <button
          type="button"
          className="button-quiet"
          disabled={disabled || !history.past.length}
          onClick={() => {
            cancelGesture();
            dispatch({ type: "undo" });
          }}
        >
          {t("boards.undo")}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={disabled || !history.future.length}
          onClick={() => {
            cancelGesture();
            dispatch({ type: "redo" });
          }}
        >
          {t("boards.redo")}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={disabled || !document.elements.length}
          onClick={() => {
            cancelGesture();
            commit(emptySketch());
            setSelectedId(null);
          }}
        >
          {t("boards.clearDrawing")}
        </button>
      </div>
      <div className={styles.sketchLayout}>
        <div className={styles.sketchStage}>
          <SketchPreview
            ref={canvas}
            sketch={rendered}
            label={t("boards.sketchCanvas")}
            role="group"
            tabIndex={0}
            selectedId={selectedId}
            aria-describedby={`${id}-keyboard`}
            data-tool={tool}
            onPointerDown={startGesture}
            onPointerMove={moveGesture}
            onPointerUp={finishGesture}
            onPointerCancel={cancelGesture}
            onLostPointerCapture={cancelGesture}
          />
        </div>
        <aside className={`${styles.sketchInspector} ${styles.form}`}>
          <h3>{t("boards.elementSettings")}</h3>
          {selected ? (
            <>
              <div className={styles.inspectorGrid}>
                {selected.type === "rect" || selected.type === "ellipse" ? (
                  <>
                    {numericField("boards.positionX", "x", selected.x, 1000 - selected.width)}
                    {numericField("boards.positionY", "y", selected.y, 600 - selected.height)}
                    {numericField(
                      "boards.shapeWidth",
                      "width",
                      selected.width,
                      1000 - selected.x,
                      1,
                    )}
                    {numericField(
                      "boards.shapeHeight",
                      "height",
                      selected.height,
                      600 - selected.y,
                      1,
                    )}
                  </>
                ) : null}
                {selected.type === "line" || selected.type === "arrow" ? (
                  <>
                    {numericField("boards.positionX", "x1", selected.x1, 1000)}
                    {numericField("boards.positionY", "y1", selected.y1, 600)}
                    {numericField("boards.endX", "x2", selected.x2, 1000)}
                    {numericField("boards.endY", "y2", selected.y2, 600)}
                  </>
                ) : null}
                {selected.type === "text" ? (
                  <>
                    {numericField("boards.positionX", "x", selected.x, 1000)}
                    {numericField("boards.positionY", "y", selected.y, 600)}
                  </>
                ) : null}
              </div>
              {selected.type === "freehand" ? (
                <div className={styles.inspectorGrid}>
                  {["x", "y"].map((axis) => {
                    const bounds = sketchElementBounds(selected);
                    return (
                      <label key={axis}>
                        {t(axis === "x" ? "boards.positionX" : "boards.positionY")}
                        <input
                          type="number"
                          min={0}
                          max={axis === "x" ? 1000 - bounds.width : 600 - bounds.height}
                          value={bounds[axis as "x" | "y"]}
                          disabled={disabled}
                          onChange={(event) => {
                            const value = event.target.valueAsNumber;
                            if (Number.isFinite(value))
                              changeElement(
                                moveSketchElement(
                                  selected,
                                  axis === "x" ? value - bounds.x : 0,
                                  axis === "y" ? value - bounds.y : 0,
                                ),
                              );
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {selected.type === "text" ? (
                <>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-drawing-text`}>{t("boards.sketchText")}</label>
                    <textarea
                      id={`${id}-drawing-text`}
                      maxLength={300}
                      value={selected.text}
                      disabled={disabled}
                      lang=""
                      dir="auto"
                      onChange={(event) =>
                        commit({
                          ...document,
                          elements: document.elements.map((element) =>
                            element.id === selected.id
                              ? { ...selected, text: event.target.value.normalize("NFC") }
                              : element,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-text-size`}>{t("boards.textSize")}</label>
                    <select
                      id={`${id}-text-size`}
                      value={selected.fontSize}
                      disabled={disabled}
                      onChange={(event) =>
                        changeElement({
                          ...selected,
                          fontSize: Number(event.target.value) as 16 | 24 | 32 | 48,
                        })
                      }
                    >
                      {[16, 24, 32, 48].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
              <div className={styles.inspectorGrid}>
                <div className={styles.field}>
                  <label htmlFor={`${id}-stroke-color`}>{t("boards.strokeColor")}</label>
                  <select
                    id={`${id}-stroke-color`}
                    value={selected.color}
                    disabled={disabled}
                    onChange={(event) =>
                      changeElement({
                        ...selected,
                        color: event.target.value as IdeaBoardSketchElement["color"],
                      })
                    }
                  >
                    {Object.keys(sketchColors).map((color) => (
                      <option key={color} value={color}>
                        {t(colorKeys[color as keyof typeof colorKeys])}
                      </option>
                    ))}
                  </select>
                </div>
                {selected.type !== "text" ? (
                  <div className={styles.field}>
                    <label htmlFor={`${id}-stroke-width`}>{t("boards.strokeWidth")}</label>
                    <select
                      id={`${id}-stroke-width`}
                      value={selected.strokeWidth}
                      disabled={disabled}
                      onChange={(event) =>
                        changeElement({
                          ...selected,
                          strokeWidth: Number(event.target.value) as 1 | 2 | 4 | 8,
                        })
                      }
                    >
                      {[1, 2, 4, 8].map((width) => (
                        <option key={width} value={width}>
                          {width}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="button-quiet"
                disabled={disabled}
                onClick={removeSelected}
              >
                {t("boards.deleteElement")}
              </button>
            </>
          ) : (
            <p className={styles.muted}>{t("boards.noElements")}</p>
          )}
        </aside>
      </div>
      <p id={`${id}-keyboard`} className={styles.muted}>
        {t("boards.keyboardDrawing")}
      </p>
      <div className={styles.elementList} role="group" aria-label={t("boards.sketchElements")}>
        {document.elements.map((element, index) => (
          <button
            type="button"
            className="button-quiet"
            key={element.id}
            aria-pressed={selectedId === element.id}
            disabled={disabled}
            onClick={() => {
              setSelectedId(element.id);
              setTool("select");
            }}
          >
            {t("boards.elementNumber", { type: t(toolKeys[element.type]), number: index + 1 })}
          </button>
        ))}
      </div>
      <p className={styles.muted}>{t("boards.sketchLimit")}</p>
      {error ? (
        <p className="error" role="alert">
          {t(error)}
        </p>
      ) : null}
    </dialog>
  );
}
