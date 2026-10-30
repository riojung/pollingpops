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
import {
  connectorPoint,
  fitViewport,
  INITIAL_VIEWPORT,
  worldPoint,
  zoomAt,
  type CanvasPoint,
  type CanvasViewport,
} from "./canvas-geometry";
import styles from "./canvas.module.css";
import { moveCanvasPatch } from "./canvas-model";

export type CanvasPatch = ReturnType<typeof CanvasObjectPatchSchema.parse>;
export type CanvasTool = "select" | "hand" | "connector";
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
  onSelect,
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
  onSelect?: (id: string | null) => void;
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
  const pointers = useRef(new Map<number, CanvasPoint>());
  const gesture = useRef<{
    kind: "pan" | "move" | "resize";
    start: CanvasPoint;
    viewport: CanvasViewport;
    object?: CanvasObject;
  } | null>(null);
  const pinch = useRef<{
    distance: number;
    midpoint: CanvasPoint;
    viewport: CanvasViewport;
  } | null>(null);
  const [preview, updatePreview] = useState<{ id: string; patch: CanvasPatch } | null>(null);
  const previewRef = useRef(preview);
  function setPreview(value: typeof preview) {
    previewRef.current = value;
    updatePreview(value);
  }
  const renderObjects = objects
    .map((object) =>
      preview?.id === object.id ? ({ ...object, ...preview.patch } as CanvasObject) : object,
    )
    .filter(
      (object) =>
        object.type !== "idea_ref" ||
        (object.idea ?? sourceBoard?.ideas.find((idea) => idea.id === object.ideaId))?.status ===
          "approved",
    )
    .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id));

  function point(event: { clientX: number; clientY: number }): CanvasPoint {
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
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button,a,input,textarea,select"))
    )
      return;
    const start = point(event);
    pointers.current.set(event.pointerId, start);
    event.currentTarget.setPointerCapture(event.pointerId);
    const two = pair();
    if (two) {
      pinch.current = { ...two, viewport };
      gesture.current = null;
      setPreview(null);
      event.preventDefault();
      return;
    }
    const target =
      event.target instanceof Element ? event.target.closest("[data-canvas-object]") : null;
    const object = objects.find((item) => item.id === target?.getAttribute("data-canvas-object"));
    if (tool === "connector" && object && canEdit) {
      onConnect?.(object.id);
      return;
    }
    if (tool === "hand" || !object) {
      gesture.current = { kind: "pan", start, viewport };
      if (tool !== "hand") onSelect?.(null);
    } else {
      onSelect?.(object.id);
      if (
        editableCanvasObject(object, canEdit, canFacilitate) &&
        (!isObjectEditable || isObjectEditable(object)) &&
        object.type !== "connector"
      )
        gesture.current = {
          kind:
            event.target instanceof Element && event.target.hasAttribute("data-canvas-resize")
              ? "resize"
              : "move",
          start,
          viewport,
          object,
        };
    }
    event.preventDefault();
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    onCursor?.(worldPoint(point(event), viewport));
    if (!pointers.current.has(event.pointerId)) return;
    const current = point(event);
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
    if (active.kind === "pan")
      onViewport({
        ...active.viewport,
        x: active.viewport.x + current.x - active.start.x,
        y: active.viewport.y + current.y - active.start.y,
      });
    else if (active.object) {
      const dx = (current.x - active.start.x) / active.viewport.zoom;
      const dy = (current.y - active.start.y) / active.viewport.zoom;
      setPreview({
        id: active.object.id,
        patch:
          active.kind === "resize"
            ? {
                width: Math.max(40, Math.min(10000, Math.round(active.object.width + dx))),
                height: Math.max(30, Math.min(10000, Math.round(active.object.height + dy))),
              }
            : moveCanvasPatch(active.object, dx, dy),
      });
    }
  }
  async function end(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    if (pinch.current) {
      pinch.current = null;
      setPreview(null);
      return;
    }
    const finalPreview = previewRef.current;
    if (active?.object && finalPreview?.id === active.object.id && onPatch) {
      try {
        await onPatch(active.object, finalPreview.patch);
      } finally {
        setPreview(null);
      }
    } else setPreview(null);
  }
  function cancel() {
    pointers.current.clear();
    gesture.current = null;
    pinch.current = null;
    setPreview(null);
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
          const selected = object.id === selectedId;
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
                  stroke={selected ? "var(--ui-accent-ink)" : "var(--ui-text)"}
                  strokeWidth={3}
                />
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
                    object.type === "text" || object.type === "frame" || object.type === "idea_ref"
                      ? "var(--ui-surface-raised)"
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
              <foreignObject
                x={10}
                y={10}
                width={Math.max(1, object.width - 20)}
                height={Math.max(1, object.height - 20)}
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
                    </a>
                  ) : (
                    <span dir="auto" lang="">
                      {object.text}
                    </span>
                  )}
                </div>
              </foreignObject>
              {selected &&
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
                  {object.text}
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
