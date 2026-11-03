"use client";

import {
  Fragment,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  canvasDiagramShapePath,
  canvasShapeVariantPath,
  type PresentationScenePrototype,
  type PresentationScenePrototypeNode,
  type PresentationScenePrototypeFrame,
} from "@openround/contracts";
import { boundPrototypeFrame } from "../../lib/presentation-scene-storage";
import styles from "./scene-prototype.module.css";

type FramedNode = Exclude<PresentationScenePrototypeNode, { type: "connector" }>;
type Connector = Extract<PresentationScenePrototypeNode, { type: "connector" }>;

export function prototypeNodeLabel(node: PresentationScenePrototypeNode) {
  if (node.type === "text") return node.role === "title" ? "Title" : "Body text";
  if (node.type === "image") return "Image";
  if (node.type === "shape") return `${node.shape.replaceAll("_", " ")} shape`;
  return node.label || "Connector";
}

export function prototypeSlideTitle(scene: PresentationScenePrototype) {
  const node = scene.nodes.find((item) => item.type === "text" && item.role === "title");
  return node?.type === "text" ? node.text || "Untitled slide" : "Untitled slide";
}

function endpoint(scene: PresentationScenePrototype, value: Connector["from"]) {
  const node = scene.nodes.find((item) => item.id === value.nodeId);
  if (!node || node.type === "connector") return null;
  const { x, y, width, height } = node.frame;
  return {
    x: x + (value.anchor === "left" ? 0 : value.anchor === "right" ? width : width / 2),
    y: y + (value.anchor === "top" ? 0 : value.anchor === "bottom" ? height : height / 2),
  };
}

function Shape({ node }: { node: Extract<FramedNode, { type: "shape" }> }) {
  const path =
    node.shape === "ellipse"
      ? null
      : node.shape === "diamond" || node.shape === "parallelogram"
        ? canvasDiagramShapePath(node.shape, 160, 90)
        : canvasShapeVariantPath(node.shape, 160, 90);
  return (
    <svg
      aria-label={prototypeNodeLabel(node)}
      role="img"
      viewBox="0 0 160 90"
      preserveAspectRatio="none"
    >
      {path ? (
        <path
          d={path}
          fill={CANVAS_FILL_COLORS[node.color]}
          stroke={CANVAS_STROKE_COLORS[node.color]}
          strokeWidth="2"
        />
      ) : (
        <ellipse
          cx="80"
          cy="45"
          rx="78"
          ry="43"
          fill={CANVAS_FILL_COLORS[node.color]}
          stroke={CANVAS_STROKE_COLORS[node.color]}
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

interface SceneViewProps {
  scene: PresentationScenePrototype;
  selectedNodeId?: string;
  onSelect?: (id: string) => void;
  onFrameChange?: (id: string, frame: PresentationScenePrototypeFrame) => void;
  readingView?: boolean;
}

/** Shared visual/reading renderer for the isolated lab; never fetches private asset references. */
export function PresentationSceneView({
  scene,
  selectedNodeId,
  onSelect,
  onFrameChange,
  readingView = false,
}: SceneViewProps) {
  const markerId = useId();
  const stage = useRef<HTMLElement>(null);
  const gesture = useRef<{
    node: FramedNode;
    pointerId: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));

  function nudge(event: KeyboardEvent<HTMLButtonElement>, node: FramedNode) {
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    onSelect?.(node.id);
    onFrameChange?.(
      node.id,
      boundPrototypeFrame({ ...node.frame, x: node.frame.x + dx, y: node.frame.y + dy }),
    );
  }

  function startMove(event: PointerEvent<HTMLButtonElement>, node: FramedNode) {
    if (event.button !== 0 || readingView || !onFrameChange) return;
    const bounds = stage.current?.getBoundingClientRect();
    if (
      !bounds ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      window.matchMedia("(max-width: 700px)").matches
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      node,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
    onSelect?.(node.id);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onFrameChange?.(
      current.node.id,
      boundPrototypeFrame({
        ...current.node.frame,
        x: current.node.frame.x + ((event.clientX - current.x) * 100) / current.width,
        y: current.node.frame.y + ((event.clientY - current.y) * 100) / current.height,
      }),
    );
  }

  return (
    <article
      ref={stage}
      aria-label={`${prototypeSlideTitle(scene)} slide`}
      className={`${styles.stage} ${readingView ? styles.readingView : ""}`}
      data-scene-id={scene.id}
    >
      <svg
        className={styles.connections}
        aria-hidden="true"
        viewBox="0 0 1600 900"
        preserveAspectRatio="none"
      >
        <defs>
          <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="context-stroke" />
          </marker>
        </defs>
        {scene.nodes
          .filter((node): node is Connector => node.type === "connector")
          .map((node) => {
            const from = endpoint(scene, node.from);
            const to = endpoint(scene, node.to);
            return from && to ? (
              <path
                key={node.id}
                d={`M${from.x * 16} ${from.y * 9} L${to.x * 16} ${to.y * 9}`}
                fill="none"
                stroke={CANVAS_STROKE_COLORS[node.color]}
                strokeWidth="3"
                markerEnd={`url(#${markerId})`}
              />
            ) : null;
          })}
      </svg>
      {scene.readingOrder.map((id) => {
        const node = nodes.get(id)!;
        if (node.type === "connector") {
          return (
            <p key={id} className={styles.connectorSummary} data-node-id={id}>
              {node.label || "Connection"}: {prototypeNodeLabel(nodes.get(node.from.nodeId)!)} →{" "}
              {prototypeNodeLabel(nodes.get(node.to.nodeId)!)}
            </p>
          );
        }
        const style: CSSProperties = {
          left: `${node.frame.x}%`,
          top: `${node.frame.y}%`,
          width: `${node.frame.width}%`,
          height: `${node.frame.height}%`,
          // Semantic reordering must not silently change visual stacking.
          zIndex: scene.nodes.indexOf(node) + 1,
        };
        return (
          <Fragment key={id}>
            <div
              role="group"
              aria-label={prototypeNodeLabel(node)}
              className={`${styles.node} ${selectedNodeId === id ? styles.selectedNode : ""}`}
              style={style}
              data-node-id={id}
              data-frame={JSON.stringify(node.frame)}
              onPointerDown={() => {
                if (!readingView) onSelect?.(id);
              }}
            >
              {node.type === "text" ? (
                node.role === "title" ? (
                  <h2>{node.text}</h2>
                ) : (
                  <p>{node.text}</p>
                )
              ) : null}
              {node.type === "image" ? (
                node.asset.kind === "bundled_fixture" ? (
                  // Original bundled SVG only. Native private assets require a future authorized resolver.
                  <img
                    src="/presentation-prototype/workflow-diagram.svg"
                    alt={node.altText ?? "Image description needed"}
                    draggable={false}
                  />
                ) : (
                  <p className={styles.mediaUnavailable}>
                    Private image unavailable in the local prototype
                  </p>
                )
              ) : null}
              {node.type === "shape" ? <Shape node={node} /> : null}
            </div>
            {onSelect && !readingView ? (
              <button
                type="button"
                className={styles.moveHandle}
                style={{
                  left: `clamp(4px, ${node.frame.x}%, calc(100% - 56px))`,
                  top: `clamp(4px, ${node.frame.y}%, calc(100% - 32px))`,
                }}
                data-selected={selectedNodeId === id}
                aria-label={`Select and move ${prototypeNodeLabel(node)}. Use arrow keys; Shift moves five percent.`}
                aria-pressed={selectedNodeId === id}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => nudge(event, node)}
                onPointerDown={(event) => startMove(event, node)}
                onPointerMove={move}
                onPointerUp={() => {
                  gesture.current = null;
                }}
                onPointerCancel={() => {
                  gesture.current = null;
                }}
                onLostPointerCapture={() => {
                  gesture.current = null;
                }}
              >
                Move
              </button>
            ) : null}
          </Fragment>
        );
      })}
    </article>
  );
}
