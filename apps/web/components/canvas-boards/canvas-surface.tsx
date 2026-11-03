"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import {
  canvasConnectorGeometry,
  canvasConnectorLabel,
  canvasDiagramShapePath,
  canvasDiagramPort,
  canvasShapeVariantPath,
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  type CanvasObject,
  type CanvasObjectPatchSchema,
  type IdeaBoardView,
} from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import { IdeaContent } from "../idea-boards/idea-content";
import { CanvasImage } from "./canvas-image";
import type { CanvasArtifactImageContext } from "./canvas-assets-client";
import {
  fitViewport,
  INITIAL_VIEWPORT,
  worldPoint,
  zoomAt,
  type CanvasPoint,
  type CanvasViewport,
  type CanvasBounds,
} from "./canvas-geometry";
import styles from "./canvas.module.css";
import readOnlyStyles from "./canvas-read-only.module.css";
import { guidedWorkshopCopy } from "../../lib/i18n/guided-workshop-messages";
import { CanvasToolIcon } from "./canvas-tool-icon";
import { readOnlyKeyViewport } from "./canvas-read-only-navigation";
import { formatNumber } from "../../lib/i18n/format";
import {
  canvasDragRect,
  canvasPenHits,
  canvasObjectsInRect,
  canvasTransformPatches,
  sampleCanvasStroke,
  type CanvasTransform,
} from "./canvas-productivity";
import { canvasModelBounds, canvasObjectBounds, canvasSelectionBounds } from "./canvas-hierarchy";
import { followCanvasRegion } from "./canvas-presentation";

export type CanvasPatch = ReturnType<typeof CanvasObjectPatchSchema.parse>;
export type CanvasTool = "select" | "hand" | "connector" | "marquee" | "pen" | "eraser";
export function editableCanvasObject(object: CanvasObject, edit: boolean, facilitate: boolean) {
  return edit && !object.locked && (object.type !== "idea_ref" || facilitate);
}
const colorValues = CANVAS_FILL_COLORS;
// Display ink belongs to the surface theme. Saved colors and export ink stay canonical.
function displayLineColor(color: CanvasObject["color"]) {
  return `var(--canvas-line-${color})`;
}
const displayLineColors = Object.fromEntries(
  Object.keys(CANVAS_STROKE_COLORS).map((color) => [
    color,
    displayLineColor(color as CanvasObject["color"]),
  ]),
) as Record<CanvasObject["color"], string>;
const lineColors = {
  ...displayLineColors,
  neutral: "var(--canvas-line-neutral)",
  selected: "var(--ui-accent-ink)",
};
const fontFamilies = { sans: "Arial, sans-serif", serif: "Georgia, serif", mono: "monospace" };
const objectTextLineHeight = 1.45;
export type CanvasEndpoint = Extract<CanvasObject, { type: "connector" }>["from"];
const ports = ["top", "right", "bottom", "left"] as const;
function textEditable(object: CanvasObject) {
  return ["sticky", "text", "rect", "ellipse", "diamond", "parallelogram", "frame"].includes(
    object.type,
  );
}
function visibleCanvasObjects(objects: CanvasObject[], source?: IdeaBoardView) {
  let visible = objects.filter(
    (object) =>
      object.type !== "idea_ref" ||
      (object.idea ?? source?.ideas.find((idea) => idea.id === object.ideaId))?.status ===
        "approved",
  );
  for (let pass = 0; pass < objects.length; pass++) {
    const ids = new Set(visible.map((object) => object.id));
    const next = visible.filter(
      (object) =>
        object.type !== "connector" ||
        ((!object.from.objectId || ids.has(object.from.objectId)) &&
          (!object.to.objectId || ids.has(object.to.objectId))),
    );
    if (next.length === visible.length) return visible;
    visible = next;
  }
  return visible;
}

export function CanvasSurface({
  objects,
  viewport,
  onViewport,
  onInteract,
  selectedId,
  selectedIds,
  onSelect,
  onSelectMany,
  onTransform,
  onCreatePen,
  onCreateConnector,
  onErasePen,
  penColor = "black",
  penWidth = 3,
  penOpacity = 1,
  onCommitText,
  onTextEditingChange,
  editTextRequest,
  onGestureActive,
  tool = "hand",
  canEdit = false,
  canCreate = canEdit,
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
  versionId,
  artifactLink,
}: {
  objects: CanvasObject[];
  viewport: CanvasViewport;
  onViewport: (viewport: CanvasViewport) => void;
  onInteract?: () => void;
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
  onCreateConnector?: (from: CanvasEndpoint, to: CanvasEndpoint) => Promise<boolean>;
  onErasePen?: (objects: Extract<CanvasObject, { type: "pen" }>[]) => Promise<boolean>;
  penColor?: CanvasObject["color"];
  penWidth?: number;
  penOpacity?: number;
  onCommitText?: (originalObject: CanvasObject, text: string) => Promise<boolean>;
  onTextEditingChange?: (active: boolean) => void;
  editTextRequest?: { id: string; nonce: number };
  onGestureActive?: (active: boolean) => void;
  tool?: CanvasTool;
  canEdit?: boolean;
  canCreate?: boolean;
  canFacilitate?: boolean;
  isObjectEditable?: (object: CanvasObject) => boolean;
  onPatch?: (object: CanvasObject, patch: CanvasPatch) => Promise<boolean>;
  onConnect?: (id: string) => void;
  sourceBoardId?: string;
  sourceBoard?: IdeaBoardView;
  guestToken?: string;
  canvasId?: string;
  versionId?: string;
  artifactLink?: CanvasArtifactImageContext;
  onCursor?: (point: CanvasPoint) => void;
  members?: Array<{ userId: string; name: string; cursor: CanvasPoint | null }>;
}) {
  const { t, locale } = useLocale();
  const copy = canvasToolCopy(locale ?? "en-CA");
  const surface = useRef<SVGSVGElement>(null);
  const patternId = useId();
  const arrowId = useId();
  const gestureObserver = useRef(onGestureActive);
  gestureObserver.current = onGestureActive;
  const textObserver = useRef(onTextEditingChange);
  textObserver.current = onTextEditingChange;
  useEffect(
    () => () => {
      gestureObserver.current?.(false);
      textObserver.current?.(false);
    },
    [],
  );
  const pointers = useRef(new Map<number, CanvasPoint>());
  const gesture = useRef<{
    kind: "pan" | "move" | "resize" | "marquee" | "pen" | "connect" | "erase";
    start: CanvasPoint;
    viewport: CanvasViewport;
    ids: string[];
    objects: CanvasObject[];
    additive: boolean;
    bounds?: CanvasBounds;
    from?: CanvasEndpoint;
    last?: CanvasPoint;
    erased?: Set<string>;
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
  const [connectorPreview, setConnectorPreview] = useState<{
    from: CanvasEndpoint;
    to: CanvasEndpoint;
  } | null>(null);
  const [erasedIds, setErasedIds] = useState<Set<string>>(new Set());
  type TextEdit = {
    original: CanvasObject;
    text: string;
    busy: boolean;
    failed: boolean;
    changed: boolean;
  };
  const [editing, updateEditing] = useState<TextEdit | null>(null);
  const editingRef = useRef<TextEdit | null>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  function setEditing(value: TextEdit | null) {
    editingRef.current = value;
    updateEditing(value);
  }
  function allowed(object: CanvasObject) {
    return (
      editableCanvasObject(object, canEdit, canFacilitate) &&
      (!isObjectEditable || isObjectEditable(object))
    );
  }
  function beginTextEdit(object: CanvasObject) {
    if (
      editingRef.current ||
      gesture.current ||
      pinch.current ||
      !onCommitText ||
      !textEditable(object) ||
      !allowed(object)
    )
      return;
    onSelect?.(object.id);
    setEditing({ original: object, text: object.text, busy: false, failed: false, changed: false });
    onTextEditingChange?.(true);
  }
  function closeTextEdit() {
    setEditing(null);
    onTextEditingChange?.(false);
    surface.current?.focus();
  }
  async function saveTextEdit() {
    const active = editingRef.current;
    if (!active || active.busy || !onCommitText) return;
    if (active.text === active.original.text) {
      closeTextEdit();
      return;
    }
    const latest = objects.find((object) => object.id === active.original.id);
    if (!latest || latest.version !== active.original.version || !allowed(latest)) {
      setEditing({ ...active, changed: true, failed: true });
      return;
    }
    setEditing({ ...active, busy: true, failed: false });
    try {
      const saved = await onCommitText(active.original, active.text);
      if (editingRef.current?.original === active.original) {
        if (saved) closeTextEdit();
        else setEditing({ ...active, busy: false, failed: true });
      }
    } catch {
      if (editingRef.current?.original === active.original)
        setEditing({ ...active, busy: false, failed: true });
    }
  }
  useEffect(() => {
    if (editing) textInput.current?.focus();
  }, [editing?.original.id]);
  useEffect(() => {
    if (!editTextRequest) return;
    const object = objects.find((entry) => entry.id === editTextRequest.id);
    if (object) beginTextEdit(object);
    // A request is consumed once, even when subsequent board state changes.
  }, [editTextRequest?.nonce]);
  function setPreview(value: Map<string, CanvasPatch>) {
    previewRef.current = value;
    updatePreview(value);
  }
  const selection = selectedIds ?? (selectedId ? [selectedId] : []);
  const renderObjects = visibleCanvasObjects(
    [
      ...objects,
      ...(editing && !objects.some((object) => object.id === editing.original.id)
        ? [editing.original]
        : []),
    ].map((object) =>
      preview.has(object.id) ? ({ ...object, ...preview.get(object.id) } as CanvasObject) : object,
    ),
    sourceBoard,
  ).sort(
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
    setConnectorPreview(null);
    setErasedIds(new Set());
    onGestureActive?.(false);
  }
  function endpoint(
    position: CanvasPoint,
    candidates: CanvasObject[],
    sourceId?: string,
  ): CanvasEndpoint {
    const available = candidates.filter(
      (object) =>
        object.type !== "connector" &&
        object.type !== "pen" &&
        object.id !== sourceId &&
        allowed(object),
    );
    for (const object of [...available].reverse()) {
      const points = ports.map((anchor) => ({
        anchor,
        ...canvasDiagramPort({ objectId: object.id, anchor, x: object.x, y: object.y }, candidates),
      }));
      const nearest = points.sort(
        (a, b) =>
          Math.hypot(position.x - a.x, position.y - a.y) -
          Math.hypot(position.x - b.x, position.y - b.y),
      )[0]!;
      const bounds = canvasObjectBounds(object, candidates);
      if (
        Math.hypot(position.x - nearest.x, position.y - nearest.y) <= 24 / viewport.zoom ||
        (position.x >= bounds.x &&
          position.x <= bounds.x + bounds.width &&
          position.y >= bounds.y &&
          position.y <= bounds.y + bounds.height)
      )
        return { objectId: object.id, anchor: nearest.anchor, x: nearest.x, y: nearest.y };
    }
    return {
      objectId: null,
      anchor: "center",
      x: Math.max(-100_000, Math.min(100_000, position.x)),
      y: Math.max(-100_000, Math.min(100_000, position.y)),
    };
  }
  function eraseSegment(active: NonNullable<typeof gesture.current>, end: CanvasPoint) {
    const hits = active.erased ?? new Set<string>();
    for (const object of active.objects)
      if (
        object.type === "pen" &&
        allowed(object) &&
        canvasPenHits(object, active.last ?? end, end, 10 / active.viewport.zoom)
      )
        hits.add(object.id);
    active.erased = hits;
    active.last = end;
    setErasedIds(new Set(hits));
  }
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (editingRef.current) {
      if (!(event.target instanceof Element && event.target.closest("textarea,button")))
        event.preventDefault();
      return;
    }
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button,a,input,textarea,select"))
    )
      return;
    onInteract?.();
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
    if ((tool === "pen" || tool === "connector") && !canCreate) return;
    if (tool === "eraser" && (!canEdit || !onErasePen)) return;
    const port =
      event.target instanceof Element ? event.target.getAttribute("data-canvas-port") : null;
    if (
      onCreateConnector &&
      canEdit &&
      canCreate &&
      ((port && object && allowed(object)) || (tool === "connector" && !object))
    ) {
      const world = worldPoint(position, viewport);
      const from =
        object && port
          ? {
              objectId: object.id,
              anchor: port as (typeof ports)[number],
              ...canvasDiagramPort(
                {
                  objectId: object.id,
                  anchor: port as (typeof ports)[number],
                  x: world.x,
                  y: world.y,
                },
                objects,
              ),
            }
          : endpoint(world, objects);
      gesture.current = { ...common, kind: "connect", from };
      setConnectorPreview({ from, to: { objectId: null, anchor: "center", ...world } });
      onGestureActive?.(true);
    } else if (tool === "eraser" && canEdit && onErasePen) {
      gesture.current = { ...common, kind: "erase", erased: new Set() };
      eraseSegment(gesture.current, worldPoint(position, viewport));
      onGestureActive?.(true);
    } else if (tool === "pen" && canEdit && canCreate && onCreatePen) {
      const world = worldPoint(position, viewport);
      strokeRef.current = [[world.x, world.y]];
      setStroke(strokeRef.current);
      gesture.current = { ...common, kind: "pen" };
      onGestureActive?.(true);
    } else if (tool === "connector" && canCreate && object && allowed(object)) {
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
          bounds: resize ? canvasModelBounds(object) : undefined,
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
    if (active.kind === "connect" && active.from) {
      setConnectorPreview({
        from: active.from,
        to: endpoint(world, active.objects, active.from.objectId ?? undefined),
      });
      return;
    }
    if (active.kind === "erase") {
      eraseSegment(active, world);
      return;
    }
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
      if (active.kind === "connect" && active.from) {
        const world = worldPoint(point(event), active.viewport);
        const fromPoint = canvasDiagramPort(active.from, active.objects);
        if (
          canCreate &&
          Math.hypot(world.x - fromPoint.x, world.y - fromPoint.y) >= 5 / active.viewport.zoom
        )
          await onCreateConnector?.(
            active.from,
            endpoint(world, active.objects, active.from.objectId ?? undefined),
          );
      } else if (active.kind === "erase") {
        eraseSegment(active, worldPoint(point(event), active.viewport));
        const erased = active.objects.filter(
          (object): object is Extract<CanvasObject, { type: "pen" }> =>
            object.type === "pen" && Boolean(active.erased?.has(object.id)) && allowed(object),
        );
        if (erased.length) await onErasePen?.(erased);
      } else if (active.kind === "pen") {
        const last = strokeRef.current.at(-1),
          end = worldPoint(point(event), active.viewport);
        if (last && Math.hypot(last[0] - end.x, last[1] - end.y) > 0.5)
          strokeRef.current = sampleCanvasStroke([...strokeRef.current, [end.x, end.y]]);
        if (canCreate && strokeRef.current.length >= 2) await onCreatePen?.(strokeRef.current);
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
    if (event.ctrlKey || event.metaKey || gesture.current || pinch.current || editingRef.current)
      return;
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
      onDoubleClick={(event) => {
        const element =
          event.target instanceof Element ? event.target.closest("[data-canvas-object]") : null;
        const object = objects.find(
          (entry) => entry.id === element?.getAttribute("data-canvas-object"),
        );
        if (object) beginTextEdit(object);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || editingRef.current) return;
        if (event.key === "F2" || event.key === "Enter") {
          const object =
            selection.length === 1 ? objects.find((entry) => entry.id === selection[0]) : undefined;
          if (object && textEditable(object) && allowed(object) && onCommitText) {
            event.preventDefault();
            beginTextEdit(object);
          }
        } else if (event.key === "Escape") cancel();
      }}
      onWheel={wheel}
      onWheelCapture={() => onInteract?.()}
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
        {Object.entries(lineColors).map(([color, fill]) => (
          <marker
            key={color}
            id={`${arrowId}-${color}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" fill={fill} />
          </marker>
        ))}
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {renderObjects.map((object) => {
          const selected = selection.includes(object.id);
          const outline = selected
            ? lineColors.selected
            : object.type === "frame"
              ? displayLineColor(object.color)
              : object.type === "text" || object.type === "idea_ref"
                ? "var(--canvas-panel-border)"
                : object.color === "black"
                  ? "var(--canvas-black-border)"
                  : CANVAS_STROKE_COLORS[object.color];
          if (object.type === "connector") {
            const geometry = canvasConnectorGeometry(object, renderObjects);
            const label = canvasConnectorLabel(object.text, geometry.label, object.fontSize);
            const color = selected ? "selected" : object.lineColor;
            return (
              <g
                key={object.id}
                data-testid={`canvas-object-${object.id}`}
                data-canvas-object={object.id}
                opacity={object.opacity}
              >
                <title>{object.text}</title>
                <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={18} />
                <path
                  d={geometry.path}
                  fill="none"
                  stroke={lineColors[color]}
                  strokeWidth={object.strokeWidth}
                  strokeDasharray={object.lineStyle === "dashed" ? "8 5" : undefined}
                  markerStart={
                    object.startMarker === "arrow" ? `url(#${arrowId}-${color})` : undefined
                  }
                  markerEnd={object.endMarker === "arrow" ? `url(#${arrowId}-${color})` : undefined}
                />
                {label ? (
                  <g className={styles.connectorLabel}>
                    <rect
                      x={label.x}
                      y={label.y}
                      width={label.width}
                      height={label.height}
                      rx={4}
                      fill="var(--ui-surface-raised)"
                      stroke="var(--canvas-panel-border)"
                    />
                    <text
                      fontSize={object.fontSize}
                      fontFamily={fontFamilies[object.fontFamily]}
                      fontWeight={object.fontWeight}
                      fontStyle={object.fontStyle}
                      textDecoration={object.textDecoration}
                      fill="var(--ui-text-strong)"
                      pointerEvents="none"
                      aria-label={object.text}
                    >
                      {label.lines.map((line, index) => (
                        <tspan
                          key={index}
                          x={
                            object.textAlign === "center"
                              ? label.x + label.width / 2
                              : object.textAlign === "right"
                                ? label.x + label.width - 8
                                : label.x + 8
                          }
                          textAnchor={
                            object.textAlign === "center"
                              ? "middle"
                              : object.textAlign === "right"
                                ? "end"
                                : "start"
                          }
                          y={label.y + 6 + object.fontSize + (index * 18 * object.fontSize) / 13}
                        >
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          }
          if (object.type === "pen")
            return (
              <g
                key={object.id}
                data-testid={`canvas-object-${object.id}`}
                data-canvas-object={object.id}
                opacity={erasedIds.has(object.id) ? object.opacity * 0.2 : object.opacity}
              >
                <polyline
                  points={object.points.map((pair) => pair.join(",")).join(" ")}
                  fill="none"
                  stroke={displayLineColor(object.color)}
                  strokeWidth={object.strokeWidth}
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
                    stroke="var(--ui-surface)"
                    strokeWidth={2}
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
              opacity={object.opacity}
              transform={`translate(${object.x} ${object.y}) rotate(${object.rotation} ${object.width / 2} ${object.height / 2})`}
            >
              {object.type === "diamond" ||
              object.type === "parallelogram" ||
              (object.type === "rect" && object.shapeVariant !== "rectangle") ? (
                <path
                  d={
                    object.type === "rect"
                      ? canvasShapeVariantPath(object.shapeVariant, object.width, object.height)
                      : canvasDiagramShapePath(object.type, object.width, object.height)
                  }
                  fill={colorValues[object.color]}
                  stroke={outline}
                  strokeWidth={object.strokeWidth}
                />
              ) : object.type === "ellipse" ? (
                <ellipse
                  cx={object.width / 2}
                  cy={object.height / 2}
                  rx={object.width / 2}
                  ry={object.height / 2}
                  fill={colorValues[object.color]}
                  stroke={outline}
                  strokeWidth={object.strokeWidth}
                />
              ) : (
                <rect
                  width={object.width}
                  height={object.height}
                  rx={object.type === "sticky" ? 3 : object.type === "rect" ? 0 : 10}
                  fill={
                    object.type === "text" || object.type === "idea_ref"
                      ? "var(--ui-surface-raised)"
                      : object.type === "frame"
                        ? "transparent"
                        : colorValues[object.color]
                  }
                  stroke={outline}
                  strokeWidth={object.strokeWidth}
                  strokeDasharray={object.type === "frame" ? "7 5" : undefined}
                />
              )}
              {editing?.original.id === object.id ? (
                <foreignObject
                  x={6}
                  y={6}
                  width={Math.max(260, object.width - 12)}
                  height={Math.max(200, object.height - 12)}
                  overflow="visible"
                >
                  <div
                    data-canvas-inline-editor="true"
                    className={styles.inlineEditor}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !editingRef.current?.busy) {
                        event.preventDefault();
                        event.stopPropagation();
                        closeTextEdit();
                      }
                    }}
                  >
                    <textarea
                      ref={textInput}
                      aria-label={copy.editText}
                      value={editing.text}
                      maxLength={2000}
                      disabled={editing.busy}
                      style={{
                        fontSize: object.fontSize,
                        fontFamily: fontFamilies[object.fontFamily],
                        fontWeight: object.fontWeight,
                        fontStyle: object.fontStyle,
                        textDecoration: object.textDecoration,
                        textAlign: object.textAlign,
                      }}
                      onChange={(event) =>
                        setEditing({ ...editing, text: event.target.value, failed: false })
                      }
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape" && !editing.busy) {
                          event.preventDefault();
                          closeTextEdit();
                        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          void saveTextEdit();
                        }
                      }}
                      onBlur={(event) => {
                        if (
                          event.relatedTarget instanceof Element &&
                          event.relatedTarget.closest("[data-canvas-inline-editor]")
                        )
                          return;
                        if (!editingRef.current?.busy) void saveTextEdit();
                      }}
                    />
                    {editing.failed ? (
                      <p role="alert">{editing.changed ? copy.textChanged : copy.textSaveFailed}</p>
                    ) : null}
                    <div className={styles.inlineEditorActions}>
                      <button
                        type="button"
                        disabled={editing.busy}
                        onClick={() => void saveTextEdit()}
                      >
                        {copy.saveText}
                      </button>
                      <button type="button" disabled={editing.busy} onClick={closeTextEdit}>
                        {copy.cancelText}
                      </button>
                    </div>
                  </div>
                </foreignObject>
              ) : object.type === "image" && canvasId ? (
                <CanvasImage
                  canvasId={canvasId}
                  versionId={versionId}
                  artifactLink={artifactLink}
                  mediaId={object.mediaId}
                  altText={object.altText}
                  width={object.width}
                  height={object.height}
                  sourceBoardId={sourceBoardId}
                  guestToken={guestToken}
                />
              ) : (
                <foreignObject
                  x={
                    object.type === "diamond"
                      ? object.width * 0.25
                      : object.type === "parallelogram"
                        ? object.width * 0.2
                        : 10
                  }
                  y={object.type === "diamond" ? object.height * 0.25 : 10}
                  width={Math.max(
                    1,
                    object.type === "diamond"
                      ? object.width * 0.5
                      : object.type === "parallelogram"
                        ? object.width * 0.6
                        : object.width - 20,
                  )}
                  height={
                    object.type === "frame"
                      ? Math.min(
                          Math.max(1, object.height - 20),
                          Math.max(28, Math.ceil(object.fontSize * objectTextLineHeight)),
                        )
                      : Math.max(
                          1,
                          object.type === "diamond" ? object.height * 0.5 : object.height - 20,
                        )
                  }
                >
                  <div
                    className={styles.objectContent}
                    data-type={object.type}
                    style={{
                      fontSize: object.fontSize,
                      fontFamily: fontFamilies[object.fontFamily],
                      fontWeight: object.fontWeight,
                      fontStyle: object.fontStyle,
                      textDecoration: object.textDecoration,
                      textAlign: object.textAlign,
                      lineHeight: objectTextLineHeight,
                      ...(object.type === "text"
                        ? { color: `var(--canvas-text-${object.color})` }
                        : object.color === "black" &&
                            object.type !== "frame" &&
                            object.type !== "idea_ref"
                          ? { color: "#ffffff" }
                          : {}),
                    }}
                  >
                    {idea && (sourceBoardId || artifactLink) ? (
                      <>
                        <small>{t("canvas.protected")}</small>
                        <IdeaContent
                          boardId={sourceBoardId ?? canvasId ?? ""}
                          canvasId={guestToken ? undefined : canvasId}
                          artifactLink={artifactLink}
                          versionId={versionId}
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
              !editing &&
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
                  strokeWidth={2}
                  className={styles.resizeHandle}
                />
              ) : null}
            </g>
          );
        })}
        {!editing &&
        canEdit &&
        canCreate &&
        onCreateConnector &&
        (tool === "select" || tool === "connector")
          ? renderObjects
              .filter(
                (object) =>
                  selection.includes(object.id) &&
                  object.type !== "pen" &&
                  object.type !== "connector" &&
                  allowed(object),
              )
              .flatMap((object) =>
                ports.map((anchor) => {
                  const position = canvasDiagramPort(
                    { objectId: object.id, anchor, x: object.x, y: object.y },
                    renderObjects,
                  );
                  return (
                    <circle
                      key={`${object.id}-${anchor}`}
                      data-canvas-object={object.id}
                      data-canvas-port={anchor}
                      cx={position.x}
                      cy={position.y}
                      r={6 / viewport.zoom}
                      fill="var(--ui-surface)"
                      stroke="var(--ui-accent-ink)"
                      strokeWidth={2 / viewport.zoom}
                      className={styles.connectorPort}
                    />
                  );
                }),
              )
          : null}
        {connectorPreview ? (
          <path
            d={canvasConnectorGeometry(connectorPreview, renderObjects).path}
            fill="none"
            stroke="var(--ui-accent-ink)"
            strokeWidth={2}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        ) : null}
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
            stroke={displayLineColor(penColor)}
            strokeWidth={penWidth}
            opacity={penOpacity}
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
  versionId,
  artifactLink,
  label,
  followRegion,
  onInteract,
  fill = false,
}: {
  objects: CanvasObject[];
  sourceBoardId?: string;
  sourceBoard?: IdeaBoardView;
  guestToken?: string;
  canvasId?: string;
  versionId?: string;
  artifactLink?: CanvasArtifactImageContext;
  label?: string;
  followRegion?: CanvasBounds | null;
  onInteract?: () => void;
  fill?: boolean;
}) {
  const { t, locale = "en-CA" } = useLocale();
  const copy = guidedWorkshopCopy(locale);
  const toolCopy = canvasToolCopy(locale);
  const root = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const outlineTrigger = useRef<HTMLButtonElement>(null);
  const focusTrigger = useRef<HTMLButtonElement>(null);
  const outlineHeading = useRef<HTMLHeadingElement>(null);
  const outlineId = useId();
  const helpId = useId();
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [list, setList] = useState(false);
  const percentage = formatNumber(locale, viewport.zoom, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const [focusMode, setFocusMode] = useState(false);
  const [tool, setTool] = useState<"hand" | "select">("hand");
  const [selected, setSelected] = useState<string | null>(null);
  // Guests receive a published projection. Keep the outline and local selection inside
  // that boundary as well, including when a referenced idea or connector disappears.
  const visible = visibleCanvasObjects(
    guestToken ? objects.filter((object) => object.visibility === "published") : objects,
    sourceBoard,
  );
  const selectedObject = visible.find((object) => object.id === selected);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const following = useRef(followRegion);
  following.current = followRegion;
  const initialized = useRef(false);
  const size = useRef({ width: 0, height: 0 });
  const dimensions = () => ({
    width: container.current?.clientWidth || 800,
    height: container.current?.clientHeight || 500,
  });
  const fit = (object?: CanvasObject) => {
    const { width, height } = dimensions();
    setViewport(
      fitViewport(
        (object ? [object] : visible).map((item) => canvasObjectBounds(item, visible)),
        width,
        height,
      ),
    );
  };
  function zoom(next: number) {
    onInteract?.();
    const { width, height } = dimensions();
    setViewport((previous) => zoomAt(previous, { x: width / 2, y: height / 2 }, next));
  }
  function closeOutline() {
    setList(false);
    outlineTrigger.current?.focus();
  }
  function closeFocusMode() {
    setFocusMode(false);
    focusTrigger.current?.focus();
  }
  useEffect(() => {
    if (list) outlineHeading.current?.focus();
  }, [list]);
  useEffect(() => {
    if (!focusMode) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (document.body.style.overflow === "hidden") document.body.style.overflow = previous;
    };
  }, [focusMode]);
  useEffect(() => {
    if (initialized.current || !visible.length || followRegion) return;
    const element = container.current;
    if (!element?.clientWidth || !element.clientHeight) return;
    initialized.current = true;
    setViewport(
      fitViewport(
        visible.map((object) => canvasObjectBounds(object, visible)),
        element.clientWidth,
        element.clientHeight,
      ),
    );
  }, [objects, sourceBoard, followRegion]);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth,
        height = element.clientHeight;
      const previous = size.current;
      size.current = { width, height };
      if (!width || !height || following.current) return;
      if (!initialized.current && visibleRef.current.length) {
        initialized.current = true;
        setViewport(
          fitViewport(
            visibleRef.current.map((object) => canvasObjectBounds(object, visibleRef.current)),
            width,
            height,
          ),
        );
      } else if (previous.width && previous.height) {
        setViewport((value) => ({
          ...value,
          x: value.x + (width - previous.width) / 2,
          y: value.y + (height - previous.height) / 2,
        }));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element || !followRegion) return;
    const update = () => {
      const next = followCanvasRegion(followRegion, element.clientWidth, element.clientHeight);
      if (next)
        setViewport((previous) =>
          previous.x === next.x && previous.y === next.y && previous.zoom === next.zoom
            ? previous
            : next,
        );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [followRegion]);
  function objectLabel(object: CanvasObject, index: number) {
    return (
      (object.type === "image"
        ? object.altText
        : object.type === "idea_ref"
          ? object.idea?.body
          : object.text
      )
        ?.trim()
        .slice(0, 120) ||
      `${object.type === "frame" ? copy.frame : copy.object} ${formatNumber(locale, index + 1)}`
    );
  }
  return (
    <section
      ref={root}
      className={`${readOnlyStyles.readOnly} ${fill ? readOnlyStyles.fill : ""} ${focusMode ? readOnlyStyles.focusMode : ""}`}
      aria-label={label ?? t("canvas.team")}
      aria-describedby={helpId}
      role={focusMode ? "dialog" : undefined}
      aria-modal={focusMode || undefined}
      data-focus-mode={focusMode}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("dialog,[contenteditable='true']")) return;
        if (typeof document !== "undefined" && document.querySelector("dialog[open]")) return;
        if (event.key === "Escape") {
          onInteract?.();
          if (list) {
            event.preventDefault();
            closeOutline();
          } else if (focusMode) {
            event.preventDefault();
            closeFocusMode();
          }
          return;
        }
        if (event.key === "Tab" && focusMode) {
          const controls = Array.from(
            root.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']",
            ) ?? [],
          ).filter(
            (element) => element.getClientRects().length && !element.closest("[hidden],[inert]"),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (!root.current?.contains(document.activeElement)) {
            const target = event.shiftKey ? last : first;
            if (target) {
              event.preventDefault();
              target.focus();
            }
          } else if (event.shiftKey && document.activeElement === first && last) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last && first) {
            event.preventDefault();
            first.focus();
          }
          return;
        }
        if (target?.closest("button,a,input,textarea,select")) return;
        const { width, height } = dimensions();
        if (event.key.toLowerCase() === "f" || event.key === "0") {
          event.preventDefault();
          onInteract?.();
          fit();
          return;
        }
        const next = readOnlyKeyViewport(viewport, event.key, width, height, event.shiftKey);
        if (next) {
          event.preventDefault();
          onInteract?.();
          setViewport(next);
        }
      }}
    >
      <p id={helpId} className={readOnlyStyles.srOnly}>
        {copy.panHelp}
      </p>
      <div ref={container} className={readOnlyStyles.stage}>
        <CanvasSurface
          objects={visible}
          viewport={viewport}
          onViewport={setViewport}
          onInteract={onInteract}
          tool={tool}
          selectedId={selectedObject?.id ?? null}
          onSelect={(id) => setSelected(id)}
          onSelectMany={(ids) => setSelected(ids[0] ?? null)}
          sourceBoardId={sourceBoardId}
          sourceBoard={sourceBoard}
          guestToken={guestToken}
          canvasId={canvasId}
          versionId={versionId}
          artifactLink={artifactLink}
        />
      </div>
      <div className={readOnlyStyles.tools} role="toolbar" aria-label={copy.navigation}>
        <div className={readOnlyStyles.toolGroup}>
          <button
            aria-label={toolCopy.pan}
            title={toolCopy.pan}
            aria-pressed={tool === "hand"}
            onClick={() => {
              onInteract?.();
              setTool("hand");
            }}
            type="button"
          >
            <CanvasToolIcon name="hand" />
          </button>
          <button
            aria-label={toolCopy.select}
            title={toolCopy.select}
            aria-pressed={tool === "select"}
            onClick={() => {
              onInteract?.();
              setTool("select");
            }}
            type="button"
          >
            <CanvasToolIcon name="select" />
          </button>
        </div>
        <div className={readOnlyStyles.toolGroup}>
          <button
            aria-label={copy.zoomOut}
            title={copy.zoomOut}
            disabled={viewport.zoom <= 0.15}
            onClick={() => zoom(viewport.zoom / 1.2)}
            type="button"
          >
            <CanvasToolIcon name="minus" />
          </button>
          <button
            aria-label={`${percentage} — ${copy.resetZoom}`}
            title={copy.resetZoom}
            className={readOnlyStyles.percentage}
            onClick={() => zoom(1)}
            type="button"
          >
            {percentage}
          </button>
          <button
            aria-label={copy.zoomIn}
            title={copy.zoomIn}
            disabled={viewport.zoom >= 3}
            onClick={() => zoom(viewport.zoom * 1.2)}
            type="button"
          >
            <CanvasToolIcon name="plus" />
          </button>
        </div>
        <div className={readOnlyStyles.toolGroup}>
          <button
            aria-label={t("canvas.fit")}
            title={t("canvas.fit")}
            onClick={() => {
              onInteract?.();
              fit();
            }}
            type="button"
          >
            <CanvasToolIcon name="fit" />
          </button>
          <button
            aria-label={copy.fitSelection}
            title={copy.fitSelection}
            disabled={!selectedObject}
            onClick={() => {
              if (!selectedObject) return;
              onInteract?.();
              fit(selectedObject);
              if (list) closeOutline();
            }}
            type="button"
          >
            <CanvasToolIcon name="fit-selection" />
          </button>
          <button
            ref={outlineTrigger}
            aria-label={t("canvas.objects")}
            title={t("canvas.objects")}
            aria-controls={outlineId}
            aria-expanded={list}
            onClick={() => {
              onInteract?.();
              setList(!list);
            }}
            type="button"
          >
            <CanvasToolIcon name="objects" />
          </button>
          <button
            ref={focusTrigger}
            aria-label={focusMode ? copy.exitFocusMode : copy.focusMode}
            title={focusMode ? copy.exitFocusMode : copy.focusMode}
            aria-pressed={focusMode}
            onClick={() => {
              onInteract?.();
              if (focusMode) closeFocusMode();
              else {
                focusTrigger.current?.focus();
                setFocusMode(true);
              }
            }}
            type="button"
          >
            <CanvasToolIcon name={focusMode ? "close" : "frame"} />
          </button>
        </div>
      </div>
      <aside
        id={outlineId}
        className={readOnlyStyles.outline}
        hidden={!list}
        aria-label={t("canvas.objects")}
      >
        <div className={readOnlyStyles.outlineHeader}>
          <h3 ref={outlineHeading} tabIndex={-1}>
            {t("canvas.objects")}
          </h3>
          <button
            aria-label={toolCopy.close}
            title={toolCopy.close}
            onClick={closeOutline}
            type="button"
          >
            <CanvasToolIcon name="close" />
          </button>
        </div>
        <ol className={readOnlyStyles.outlineList}>
          {visible.map((object, index) => (
            <li key={object.id}>
              <button
                className={readOnlyStyles.selectObject}
                aria-label={copy.selectObject.replace("{object}", objectLabel(object, index))}
                aria-pressed={selectedObject?.id === object.id}
                onClick={() => {
                  onInteract?.();
                  setSelected(object.id);
                }}
                type="button"
              >
                <CanvasToolIcon name={object.type === "frame" ? "frame" : "select"} />
                <span dir="auto" lang="">
                  {objectLabel(object, index)}
                </span>
              </button>
              {object.type === "idea_ref" && (sourceBoardId || artifactLink) ? (
                <IdeaContent
                  boardId={sourceBoardId ?? canvasId ?? ""}
                  canvasId={guestToken ? undefined : canvasId}
                  artifactLink={artifactLink}
                  versionId={versionId}
                  guestToken={guestToken}
                  idea={
                    object.idea ?? sourceBoard!.ideas.find((idea) => idea.id === object.ideaId)!
                  }
                />
              ) : object.type === "link" ? (
                <p dir="auto" lang="">
                  <a
                    href={object.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {object.text || new URL(object.url).hostname}
                  </a>
                  {object.text ? <small> ({new URL(object.url).hostname})</small> : null}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}
