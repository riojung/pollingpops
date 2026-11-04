"use client";

import {
  useId,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  canvasDiagramShapePath,
  canvasShapeVariantPath,
  presentationSceneTitle,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { boundNativeSceneFrame, nativeNodeLabel } from "../../lib/presentation-native-scene";
import styles from "./native-scene.module.css";

type FramedNode = Exclude<PresentationSceneNode, { type: "connector" }>;
type Connector = Extract<PresentationSceneNode, { type: "connector" }>;
export type SceneImageRenderer = (mediaId: string, altText: string | null) => ReactNode;

function endpoint(scene: PresentationScene, endpoint: Connector["from"]) {
  const target = scene.nodes.find((node) => node.id === endpoint.nodeId);
  if (!target || target.type === "connector") return null;
  const { x, y, width, height } = target.frame;
  return {
    x: x + (endpoint.anchor === "left" ? 0 : endpoint.anchor === "right" ? width : width / 2),
    y: y + (endpoint.anchor === "top" ? 0 : endpoint.anchor === "bottom" ? height : height / 2),
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
    <div className={styles.shape} role="img" aria-label={node.label || nativeNodeLabel(node)}>
      <svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
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
      <span aria-hidden="true" style={{ color: node.color === "black" ? "#ffffff" : "#102a43" }}>
        {node.label}
      </span>
    </div>
  );
}

/** Closed geometry and plain text only; image authority belongs to the calling surface. */
export function NativeSceneView({
  scene,
  renderImage,
  selectedNodeId,
  selectedNodeIds,
  onSelect,
  onFrameChange,
  onGeometryKey,
  onNodePointerDown,
}: {
  scene: PresentationScene;
  renderImage?: SceneImageRenderer;
  selectedNodeId?: string;
  selectedNodeIds?: readonly string[];
  onSelect?: (id: string, additive?: boolean) => void;
  onFrameChange?: (id: string, frame: PresentationSceneFrame) => void;
  onGeometryKey?: (id: string, dx: number, dy: number, resize: boolean) => void;
  onNodePointerDown?: (
    event: PointerEvent<HTMLElement>,
    id: string,
    resize: boolean,
    handle: boolean,
  ) => void;
}) {
  const markerId = useId();
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const editing = Boolean(onSelect);
  function frameKey(event: KeyboardEvent<HTMLButtonElement>, node: FramedNode, resize: boolean) {
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    if (onGeometryKey) {
      onGeometryKey(node.id, dx, dy, resize);
      return;
    }
    onSelect?.(node.id);
    onFrameChange?.(
      node.id,
      boundNativeSceneFrame(
        resize
          ? {
              ...node.frame,
              width: Math.min(100 - node.frame.x, node.frame.width + dx),
              height: Math.min(100 - node.frame.y, node.frame.height + dy),
            }
          : { ...node.frame, x: node.frame.x + dx, y: node.frame.y + dy },
      ),
    );
  }
  return (
    <article
      className={styles.stage}
      aria-label={`${presentationSceneTitle(scene) || "Untitled"} native slide`}
      data-native-scene="true"
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
        const node = nodes.get(id);
        if (!node) return null;
        if (node.type === "connector")
          return (
            <p key={id} className={styles.connectorSummary} data-node-id={id}>
              {node.label || "Connection"}: {nativeNodeLabel(nodes.get(node.from.nodeId)!)} →{" "}
              {nativeNodeLabel(nodes.get(node.to.nodeId)!)}
            </p>
          );
        const style: CSSProperties = {
          left: `${node.frame.x}%`,
          top: `${node.frame.y}%`,
          width: `${node.frame.width}%`,
          height: `${node.frame.height}%`,
          zIndex: scene.nodes.indexOf(node) + 1,
        };
        return (
          <div
            key={id}
            className={`${styles.node} ${editing ? styles.editableNode : ""} ${(selectedNodeIds?.includes(id) ?? selectedNodeId === id) ? styles.selected : ""}`}
            style={style}
            data-node-id={id}
            data-frame={JSON.stringify(node.frame)}
            onClick={
              editing && !onNodePointerDown ? (event) => onSelect?.(id, event.shiftKey) : undefined
            }
            onPointerDown={
              onNodePointerDown ? (event) => onNodePointerDown(event, id, false, false) : undefined
            }
          >
            {node.type === "text" ? (
              node.role === "title" ? (
                <h1>{node.text || (editing ? "Slide title" : "")}</h1>
              ) : (
                <p>{node.text || (editing ? "Body text" : "")}</p>
              )
            ) : null}
            {node.type === "shape" ? <Shape node={node} /> : null}
            {node.type === "image" ? (
              <div className={styles.image}>
                {renderImage ? (
                  renderImage(node.mediaId, node.altText)
                ) : (
                  <span role="img" aria-label={node.altText || "Image description needed"}>
                    Image unavailable
                  </span>
                )}
              </div>
            ) : null}
            {editing ? (
              <div className={styles.handles}>
                <button
                  type="button"
                  aria-label={`Move ${nativeNodeLabel(node)}. Use arrow keys to nudge.`}
                  onFocus={() => {
                    if (!selectedNodeIds?.includes(id)) onSelect?.(id);
                  }}
                  onKeyDown={(event) => frameKey(event, node, false)}
                  onPointerDown={
                    onNodePointerDown
                      ? (event) => {
                          event.stopPropagation();
                          onNodePointerDown(event, id, false, true);
                        }
                      : undefined
                  }
                  onClick={(event) => event.stopPropagation()}
                >
                  ↔
                </button>
                <button
                  type="button"
                  aria-label={`Resize ${nativeNodeLabel(node)}. Use arrow keys to change size.`}
                  onFocus={() => {
                    if (!selectedNodeIds?.includes(id)) onSelect?.(id);
                  }}
                  onKeyDown={(event) => frameKey(event, node, true)}
                  className={styles.resizeHandle}
                  onPointerDown={
                    onNodePointerDown
                      ? (event) => {
                          event.stopPropagation();
                          onNodePointerDown(event, id, true, true);
                        }
                      : undefined
                  }
                  onClick={(event) => event.stopPropagation()}
                >
                  ↗
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </article>
  );
}
