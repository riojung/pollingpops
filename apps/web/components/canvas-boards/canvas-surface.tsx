"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import type { CanvasObject, CanvasObjectPatchSchema, IdeaBoardView } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { IdeaContent } from "../idea-boards/idea-content";
import { CanvasImage } from "./canvas-image";
import {
  connectorPoint,
  fitViewport,
  INITIAL_VIEWPORT,
  worldPoint,
  zoomAt,
  type CanvasPoint,
  type CanvasViewport,
  type CanvasBounds,
} from "./canvas-geometry";
import styles from "./canvas.module.css";
import {
  canvasDragRect,
  canvasObjectsInRect,
  canvasTransformPatches,
  sampleCanvasStroke,
  type CanvasTransform,
} from "./canvas-productivity";
import { canvasObjectBounds, canvasSelectionBounds } from "./canvas-hierarchy";

export type CanvasPatch = ReturnType<typeof CanvasObjectPatchSchema.parse>;
export type CanvasTool = "select" | "hand" | "connector" | "marquee" | "pen";
export function editableCanvasObject(object: CanvasObject, edit: boolean, facilitate: boolean) {
  return edit && !object.locked && (object.type !== "idea_ref" || facilitate);
}
const colorValues = {
  yellow: "#fff1a8",
  blue: "#cde7ff",
  green: "#ccebdc",
  pink: "#f9d9e4",
  purple: "#e5dcf8",
  white: "#ffffff",
};

export function CanvasSurface({
  objects,
  viewport,
  onViewport,
  selectedId,
  selectedIds,
  onSelect,
  onSelectMany,
  onTransform,
  onCreatePen,
  onGestureActive,
  tool = "hand",
  canEdit = false,
  canFacilitate = false,
  isObjectEditable,
  onPatch,
  onConnect,
  onCursor,
  members = [],
  sourceBoardId,
  sourceBoard,
  guestToken,
  canvasId,
}: {
  objects: CanvasObject[];
  viewport: CanvasViewport;
  onViewport: (viewport: CanvasViewport) => void;
  selectedId?: string | null;
  selectedIds?: string[];
  onSelect?: (id: string | null, additive?: boolean, revealInspector?: boolean) => void;
  onSelectMany?: (ids: string[], additive: boolean) => void;
  onTransform?: (
    ids: string[],
    transform: CanvasTransform,
    originalObjects: CanvasObject[],
  ) => Promise<boolean>;
  onCreatePen?: (points: [number, number][]) => Promise<boolean>;
  onGestureActive?: (active: boolean) => void;
  tool?: CanvasTool;
  canEdit?: boolean;
  canFacilitate?: boolean;
  isObjectEditable?: (object: CanvasObject) => boolean;
  onPatch?: (object: CanvasObject, patch: CanvasPatch) => Promise<boolean>;
  onConnect?: (id: string) => void;
  sourceBoardId?: string;
  sourceBoard?: IdeaBoardView;
  guestToken?: string;
  canvasId?: string;
  onCursor?: (point: CanvasPoint) => void;
  members?: Array<{ userId: string; name: string; cursor: CanvasPoint | null }>;
}) {
  const { t } = useLocale();
  const surface = useRef<SVGSVGElement>(null);
  const patternId = useId();
  const arrowId = useId();
  const gestureObserver = useRef(onGestureActive);
  gestureObserver.current = onGestureActive;
  useEffect(() => () => gestureObserver.current?.(false), []);
  const pointers = useRef(new Map<number, CanvasPoint>());
  const gesture = useRef<{
    kind: "pan" | "move" | "resize" | "marquee" | "pen";
    start: CanvasPoint;
    viewport: CanvasViewport;
    ids: string[];
    objects: CanvasObject[];
    additive: boolean;
    bounds?: CanvasBounds;
  } | null>(null);
  const pinch = useRef<{
    distance: number;
    midpoint: CanvasPoint;
    viewport: CanvasViewport;
  } | null>(null);
  const [preview, updatePreview] = useState<Map<string, CanvasPatch>>(new Map());
  const previewRef = useRef(preview);
  const [area, setArea] = useState<CanvasBounds | null>(null);
  const [stroke, setStroke] = useState<[number, number][]>([]);
  const strokeRef = useRef<[number, number][]>([]);
  const finalTransform = useRef<CanvasTransform | null>(null);
  function setPreview(value: Map<string, CanvasPatch>) {
    previewRef.current = value;
    updatePreview(value);
  }
  const selection = selectedIds ?? (selectedId ? [selectedId] : []);
  const renderObjects = objects
    .map((object) =>
      preview.has(object.id) ? ({ ...object, ...preview.get(object.id) } as CanvasObject) : object,
    )
    .filter(
      (object) =>
        object.type !== "idea_ref" ||
        (object.idea ?? sourceBoard?.ideas.find((idea) => idea.id === object.ideaId))?.status ===
          "approved",
    )
    .sort(
      (a, b) =>
        a.zIndex - b.zIndex ||
        (a.type === "frame" ? -1 : 0) - (b.type === "frame" ? -1 : 0) ||
        a.id.localeCompare(b.id),
    );
  const selectionBounds = canvasSelectionBounds(renderObjects, selection);
  function point(event: { clientX: number; clientY: number }) {
    const box = surface.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  }
  function pair() {
    const [a, b] = [...pointers.current.values()];
    return a && b
      ? {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        }
      : null;
  }
  function clearPreview() {
    gesture.current = null;
    finalTransform.current = null;
    setPreview(new Map());
    setArea(null);
    strokeRef.current = [];
    setStroke([]);
    onGestureActive?.(false);
  }
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button,a,input,textarea,select"))
    )
      return;
    const position = point(event);
    pointers.current.set(event.pointerId, position);
    event.currentTarget.setPointerCapture(event.pointerId);
    const two = pair();
    if (two) {
      clearPreview();
      pinch.current = { ...two, viewport };
      event.preventDefault();
      return;
    }
    const element =
      event.target instanceof Element ? event.target.closest("[data-canvas-object]") : null;
    const object = objects.find((item) => item.id === element?.getAttribute("data-canvas-object"));
    const common = {
      start: position,
      viewport,
      ids: [] as string[],
      objects,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
    };
    if (tool === "pen" && canEdit && onCreatePen) {
      const world = worldPoint(position, viewport);
      strokeRef.current = [[world.x, world.y]];
      setStroke(strokeRef.current);
      gesture.current = { ...common, kind: "pen" };
      onGestureActive?.(true);
    } else if (tool === "connector" && object && canEdit) {
      onConnect?.(object.id);
    } else if (tool === "hand") gesture.current = { ...common, kind: "pan" };
    else if (tool === "marquee" || !object) {
      gesture.current = { ...common, kind: "marquee" };
      setArea(canvasDragRect(worldPoint(position, viewport), worldPoint(position, viewport)));
    } else {
      if (!selection.includes(object.id) || common.additive)
        onSelect?.(object.id, common.additive, event.pointerType !== "touch");
      if (
        !common.additive &&
        editableCanvasObject(object, canEdit, canFacilitate) &&
        (!isObjectEditable || isObjectEditable(object)) &&
        object.type !== "connector"
      ) {
        const ids = selection.includes(object.id) ? selection : [object.id];
        const resize =
          event.target instanceof Element && event.target.hasAttribute("data-canvas-resize");
        gesture.current = {
          ...common,
          ids,
          kind: resize ? "resize" : "move",
          bounds: resize ? canvasObjectBounds(object, objects) : undefined,
        };
        onGestureActive?.(true);
      }
    }
    event.preventDefault();
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const current = point(event);
    onCursor?.(worldPoint(current, viewport));
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, current);
    const two = pair();
    if (pinch.current && two) {
      const original = pinch.current;
      const next = zoomAt(
        original.viewport,
        original.midpoint,
        (original.viewport.zoom * two.distance) / original.distance,
      );
      onViewport({
        ...next,
        x: next.x + two.midpoint.x - original.midpoint.x,
        y: next.y + two.midpoint.y - original.midpoint.y,
      });
      return;
    }
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "pan") {
      onViewport({
        ...active.viewport,
        x: active.viewport.x + current.x - active.start.x,
        y: active.viewport.y + current.y - active.start.y,
      });
      return;
    }
    const world = worldPoint(current, active.viewport);
    if (active.kind === "pen") {
      const last = strokeRef.current.at(-1)!;
      if (Math.hypot(world.x - last[0], world.y - last[1]) < 2) return;
      strokeRef.current = sampleCanvasStroke([...strokeRef.current, [world.x, world.y]]);
      setStroke(strokeRef.current);
      return;
    }
    if (active.kind === "marquee") {
      setArea(canvasDragRect(worldPoint(active.start, active.viewport), world));
      return;
    }
    const dx = (current.x - active.start.x) / active.viewport.zoom,
      dy = (current.y - active.start.y) / active.viewport.zoom;
    const transform: CanvasTransform =
      active.kind === "resize" && active.bounds
        ? {
            type: "resize",
            bounds: {
              ...active.bounds,
              width: Math.max(10, active.bounds.width + dx),
              height: Math.max(10, active.bounds.height + dy),
            },
          }
        : { type: "move", dx, dy };
    finalTransform.current = transform;
    setPreview(canvasTransformPatches(active.objects, active.ids, transform));
  }
  async function end(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    if (pinch.current) {
      pinch.current = null;
      clearPreview();
      return;
    }
    if (!active) return;
    try {
      if (active.kind === "pen") {
        const last = strokeRef.current.at(-1),
          end = worldPoint(point(event), active.viewport);
        if (last && Math.hypot(last[0] - end.x, last[1] - end.y) > 0.5)
          strokeRef.current = sampleCanvasStroke([...strokeRef.current, [end.x, end.y]]);
        if (strokeRef.current.length >= 2) await onCreatePen?.(strokeRef.current);
      } else if (active.kind === "marquee") {
        const rect = canvasDragRect(
          worldPoint(active.start, active.viewport),
          worldPoint(point(event), active.viewport),
        );
        onSelectMany?.(
          rect.width < 3 && rect.height < 3 ? [] : canvasObjectsInRect(active.objects, rect),
          active.additive,
        );
      } else if (active.ids.length && (active.kind === "move" || active.kind === "resize")) {
        const current = point(event),
          dx = (current.x - active.start.x) / active.viewport.zoom,
          dy = (current.y - active.start.y) / active.viewport.zoom;
        if (dx || dy)
          finalTransform.current =
            active.kind === "resize" && active.bounds
              ? {
                  type: "resize",
                  bounds: {
                    ...active.bounds,
                    width: Math.max(10, active.bounds.width + dx),
                    height: Math.max(10, active.bounds.height + dy),
                  },
                }
              : { type: "move", dx, dy };
        if (!finalTransform.current) return;
        setPreview(canvasTransformPatches(active.objects, active.ids, finalTransform.current));
        if (onTransform) await onTransform(active.ids, finalTransform.current, active.objects);
        else if (active.ids.length === 1 && onPatch) {
          const object = active.objects.find((item) => item.id === active.ids[0]);
          const patch = object ? previewRef.current.get(object.id) : null;
          if (object && patch) await onPatch(object, patch);
        }
      }
    } finally {
      clearPreview();
    }
  }
  function cancel() {
    pointers.current.clear();
    pinch.current = null;
    clearPreview();
  }
  function wheel(event: WheelEvent<SVGSVGElement>) {
    if (event.ctrlKey || event.metaKey || gesture.current || pinch.current) return;
    event.preventDefault();
    if (event.shiftKey)
      onViewport({ ...viewport, x: viewport.x - event.deltaY, y: viewport.y - event.deltaX });
    else
      onViewport(
        zoomAt(
          viewport,
          point(event),
          viewport.zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.005),
        ),
      );
  }
  return (
    <svg
      data-testid="canvas-surface"
      ref={surface}
      className={styles.surface}
      role="group"
      aria-label={t("canvas.team")}
      tabIndex={0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={(event) => void end(event)}
      onPointerCancel={cancel}
      onWheel={wheel}
      data-tool={tool}
    >
      <defs>
        <pattern
          id={patternId}
          width={24 * viewport.zoom}
          height={24 * viewport.zoom}
          patternUnits="userSpaceOnUse"
          x={viewport.x}
          y={viewport.y}
        >
          <circle cx="1" cy="1" r="1" fill="var(--ui-border-strong)" opacity="0.22" />
        </pattern>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0L10 5L0 10z" fill="var(--ui-text-subtle)" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {renderObjects.map((object) => {
          const selected = selection.includes(object.id);
          if (object.type === "connector") {
            const from = connectorPoint(object.from, renderObjects),
              to = connectorPoint(object.to, renderObjects);
            return (
              <g
                key={object.id}
                data-testid={`canvas-object-${object.id}`}
                data-canvas-object={object.id}
              >
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="transparent"
                  strokeWidth={18}
                />
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={selected ? "var(--ui-accent-ink)" : "var(--ui-text-subtle)"}
                  strokeWidth={selected ? 4 : 2}
                  markerEnd={`url(#${arrowId})`}
                />
              </g>
            );
          }
          if (object.type === "pen")
            return (
              <g
                key={object.id}
                data-testid={`canvas-object-${object.id}`}
                data-canvas-object={object.id}
              >
                <polyline
                  points={object.points.map((pair) => pair.join(",")).join(" ")}
                  fill="none"
                  stroke={
                    selected
                      ? "var(--ui-accent-ink)"
                      : `var(--canvas-pen-${object.color}, var(--ui-text))`
                  }
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {selected ? (
                  <rect
                    x={object.x}
                    y={object.y}
                    width={object.width}
                    height={object.height}
                    fill="none"
                    stroke="var(--ui-accent-ink)"
                    strokeDasharray="4 4"
                    pointerEvents="none"
                  />
                ) : null}
                {selected &&
                selection.length === 1 &&
                editableCanvasObject(object, canEdit, canFacilitate) &&
                (!isObjectEditable || isObjectEditable(object)) ? (
                  <rect
                    data-canvas-resize="true"
                    x={object.x + object.width - 8}
                    y={object.y + object.height - 8}
                    width={16}
                    height={16}
                    fill="var(--ui-accent-ink)"
                    className={styles.resizeHandle}
                  />
                ) : null}
              </g>
            );
          const idea =
            object.type === "idea_ref"
              ? (object.idea ?? sourceBoard?.ideas.find((item) => item.id === object.ideaId))
              : null;
          return (
            <g
              key={object.id}
              data-testid={`canvas-object-${object.id}`}
              data-canvas-object={object.id}
              transform={`translate(${object.x} ${object.y}) rotate(${object.rotation} ${object.width / 2} ${object.height / 2})`}
            >
              {object.type === "ellipse" ? (
                <ellipse
                  cx={object.width / 2}
                  cy={object.height / 2}
                  rx={object.width / 2}
                  ry={object.height / 2}
                  fill={colorValues[object.color]}
                  stroke={selected ? "var(--ui-accent-ink)" : "#89919d"}
                  strokeWidth={selected ? 3 : 1}
                />
              ) : (
                <rect
                  width={object.width}
                  height={object.height}
                  rx={object.type === "sticky" ? 3 : 10}
                  fill={
                    object.type === "text" || object.type === "idea_ref"
                      ? "var(--ui-surface-raised)"
                      : object.type === "frame"
                        ? "transparent"
                        : colorValues[object.color]
                  }
                  stroke={
                    selected
                      ? "var(--ui-accent-ink)"
                      : object.type === "text"
                        ? "transparent"
                        : "#89919d"
                  }
                  strokeWidth={selected ? 3 : 1}
                  strokeDasharray={object.type === "frame" ? "7 5" : undefined}
                />
              )}
              {object.type === "image" && canvasId ? (
                <CanvasImage
                  canvasId={canvasId}
                  mediaId={object.mediaId}
                  altText={object.altText}
                  width={object.width}
                  height={object.height}
                  sourceBoardId={sourceBoardId}
                  guestToken={guestToken}
                />
              ) : (
                <foreignObject
                  x={10}
                  y={10}
                  width={Math.max(1, object.width - 20)}
                  height={object.type === "frame" ? 28 : Math.max(1, object.height - 20)}
                >
                  <div className={styles.objectContent} data-type={object.type}>
                    {idea && sourceBoardId ? (
                      <>
                        <small>{t("canvas.protected")}</small>
                        <IdeaContent
                          boardId={sourceBoardId}
                          canvasId={guestToken ? undefined : canvasId}
                          guestToken={guestToken}
                          idea={idea}
                        />
                      </>
                    ) : object.type === "link" ? (
                      <a
                        href={object.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                      >
                        {object.text || new URL(object.url).hostname}
                        <small>{new URL(object.url).hostname}</small>
                      </a>
                    ) : (
                      <span dir="auto" lang="">
                        {object.text}
                      </span>
                    )}
                  </div>
                </foreignObject>
              )}
              {selected &&
              selection.length === 1 &&
              editableCanvasObject(object, canEdit, canFacilitate) &&
              (!isObjectEditable || isObjectEditable(object)) ? (
                <rect
                  data-canvas-resize="true"
                  x={object.width - 8}
                  y={object.height - 8}
                  width={16}
                  height={16}
                  fill="var(--ui-accent-ink)"
                  stroke="var(--ui-surface)"
                  className={styles.resizeHandle}
                />
              ) : null}
            </g>
          );
        })}
        {selection.length > 1 && selectionBounds ? (
          <rect
            {...selectionBounds}
            fill="none"
            stroke="var(--ui-accent-ink)"
            strokeWidth={1.5 / viewport.zoom}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        ) : null}
        {area ? (
          <rect
            {...area}
            fill="var(--ui-accent-soft)"
            fillOpacity={0.35}
            stroke="var(--ui-accent-ink)"
            strokeWidth={1 / viewport.zoom}
            pointerEvents="none"
          />
        ) : null}
        {stroke.length > 1 ? (
          <polyline
            points={stroke.map((point) => point.join(",")).join(" ")}
            fill="none"
            stroke="var(--ui-accent-ink)"
            strokeWidth={3}
            strokeLinecap="round"
            pointerEvents="none"
          />
        ) : null}
        {members
          .filter((member) => member.cursor)
          .map((member) => (
            <g
              key={member.userId}
              transform={`translate(${member.cursor!.x} ${member.cursor!.y})`}
              pointerEvents="none"
              aria-hidden="true"
            >
              <path
                d="M0 0L4 18L9 11L17 8Z"
                fill="var(--ui-accent-ink)"
                stroke="var(--ui-surface)"
              />
              <text
                x="16"
                y="24"
                fontSize={13}
                fill="var(--ui-text)"
                stroke="var(--ui-surface)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {member.name}
              </text>
            </g>
          ))}
      </g>
    </svg>
  );
}

export function CanvasReadOnlySurface({
  objects,
  sourceBoardId,
  sourceBoard,
  guestToken,
  canvasId,
  label,
}: {
  objects: CanvasObject[];
  sourceBoardId?: string;
  sourceBoard?: IdeaBoardView;
  guestToken?: string;
  canvasId?: string;
  label?: string;
}) {
  const { t } = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [list, setList] = useState(false);
  const visible = objects.filter(
    (object) =>
      object.type !== "idea_ref" ||
      (object.idea ?? sourceBoard?.ideas.find((idea) => idea.id === object.ideaId))?.status ===
        "approved",
  );
  const fit = () =>
    setViewport(
      fitViewport(
        visible,
        container.current?.clientWidth ?? 800,
        container.current?.clientHeight ?? 500,
      ),
    );
  const initialObjects = useRef(visible);
  useEffect(() => {
    setViewport(
      fitViewport(
        initialObjects.current,
        container.current?.clientWidth ?? 800,
        container.current?.clientHeight ?? 500,
      ),
    );
  }, []);
  return (
    <section className={styles.readOnly} aria-label={label ?? t("canvas.team")}>
      <div className={styles.readOnlyTools}>
        <button className="button-quiet" onClick={fit} type="button">
          {t("canvas.fit")}
        </button>
        <button
          className="button-quiet"
          onClick={() => setList(!list)}
          aria-expanded={list}
          type="button"
        >
          {t("canvas.objects")}
        </button>
      </div>
      {list ? (
        <ol className={styles.readOnlyList}>
          {visible.map((object) => (
            <li key={object.id}>
              {object.type === "idea_ref" && sourceBoardId ? (
                <IdeaContent
                  boardId={sourceBoardId}
                  canvasId={guestToken ? undefined : canvasId}
                  guestToken={guestToken}
                  idea={
                    object.idea ?? sourceBoard!.ideas.find((idea) => idea.id === object.ideaId)!
                  }
                />
              ) : (
                <p dir="auto" lang="">
                  {object.type === "link" ? (
                    <>
                      <a
                        href={object.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                      >
                        {object.text || new URL(object.url).hostname}
                      </a>
                      {object.text ? <small> ({new URL(object.url).hostname})</small> : null}
                    </>
                  ) : object.type === "image" ? (
                    object.altText
                  ) : (
                    object.text
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div ref={container} className={styles.readOnlyStage}>
          <CanvasSurface
            objects={visible}
            viewport={viewport}
            onViewport={setViewport}
            sourceBoardId={sourceBoardId}
            sourceBoard={sourceBoard}
            guestToken={guestToken}
            canvasId={canvasId}
          />
        </div>
      )}
    </section>
  );
}
