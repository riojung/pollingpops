"use client";

import {
  useId,
  useState,
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
  type SupportedLocale,
} from "@openround/contracts";
import { boundNativeSceneFrame } from "../../lib/presentation-native-scene";
import { nativeControlNodeLabel, nativeControlsCopy } from "./native-controls-copy";
import { nativeAudienceCopy } from "./native-audience-copy";
import styles from "./native-scene.module.css";
import { NATIVE_DESIGN_FONTS, NATIVE_DESIGN_THEMES } from "../../lib/presentation-native-design";
import { useNativeTextOverflow } from "./use-native-text-overflow";
import { NativeRichTextView } from "./native-rich-text-view";
import { NativeSceneDataView } from "./native-scene-data-view";
import {
  NativeSceneInteractionView,
  containNativeInteractionKey,
  isNativeInteractionNode,
  type NativeSceneInteractionRuntime,
} from "./native-scene-interaction-view";
import { selectedNativeSceneBounds } from "../../lib/presentation-native-geometry";
import {
  PresentationMotionBackground,
  PresentationMotionControls,
} from "./presentation-motion-background";

type FramedNode = Exclude<PresentationSceneNode, { type: "connector" }>;
type Connector = Extract<PresentationSceneNode, { type: "connector" }>;
export type SceneImageRenderer = (mediaId: string, altText: string | null) => ReactNode;

function endpoint(scene: PresentationScene, endpoint: Connector["from"]) {
  const target = scene.nodes.find((node) => node.id === endpoint.nodeId);
  if (!target || target.type === "connector") return null;
  const { x, y, width, height } = target.frame;
  if (!target.rotation)
    return {
      x: x + (endpoint.anchor === "left" ? 0 : endpoint.anchor === "right" ? width : width / 2),
      y: y + (endpoint.anchor === "top" ? 0 : endpoint.anchor === "bottom" ? height : height / 2),
    };
  const angle = ((target.rotation ?? 0) * Math.PI) / 180;
  const dx =
    (endpoint.anchor === "left" ? -width / 2 : endpoint.anchor === "right" ? width / 2 : 0) * 16;
  const dy =
    (endpoint.anchor === "top" ? -height / 2 : endpoint.anchor === "bottom" ? height / 2 : 0) * 9;
  return {
    x: x + width / 2 + (dx * Math.cos(angle) - dy * Math.sin(angle)) / 16,
    y: y + height / 2 + (dx * Math.sin(angle) + dy * Math.cos(angle)) / 9,
  };
}

function Shape({
  node,
  locale,
  contentLocale,
}: {
  node: Extract<FramedNode, { type: "shape" }>;
  locale: SupportedLocale;
  contentLocale?: SupportedLocale;
}) {
  const path =
    node.shape === "ellipse"
      ? null
      : node.shape === "diamond" || node.shape === "parallelogram"
        ? canvasDiagramShapePath(node.shape, 160, 90)
        : canvasShapeVariantPath(node.shape, 160, 90);
  return (
    <div
      className={styles.shape}
      role="img"
      aria-label={node.label || nativeControlNodeLabel(locale, node).text}
      lang={node.label ? (contentLocale ?? "") : locale}
    >
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

function NativePlainText({
  text,
  title,
  layoutKey,
  lang,
}: {
  text: string;
  title: boolean;
  layoutKey: string;
  lang?: string;
}) {
  const scroll = useNativeTextOverflow(JSON.stringify([text, title, layoutKey, lang]));
  return title ? (
    <h1 lang={lang} {...scroll}>
      {text}
    </h1>
  ) : (
    <p lang={lang} {...scroll}>
      {text}
    </p>
  );
}

interface NativeSceneViewProps {
  scene: PresentationScene;
  locale?: SupportedLocale;
  /** Display-only fallback; an authored text node language always takes precedence. */
  contentLocale?: SupportedLocale;
  /** Scaled previews retain the authored coordinate plane even on phone viewports. */
  fixedLayout?: boolean;
  renderImage?: SceneImageRenderer;
  /** Session/credential/connection identity, excluding ordinary snapshot revisions. */
  interactionSourceKey?: string;
  interactionEditing?: boolean;
  /** Inert fixed-layout artwork for a creator's filmstrip, including on phones. */
  staticThumbnail?: boolean;
  /** Freeze decorative backgrounds in inert layout comparisons. */
  motionStatic?: boolean;
  /** Canvas supplies normal-flow selection controls outside the authored slide. */
  hideGeometryControls?: boolean;
  /** Creator-only passive annotations, never rendered by delivery or thumbnail callers. */
  editorOverlay?: ReactNode;
  interactionRuntime?: NativeSceneInteractionRuntime;
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
}

/** Replaced delivery sources start closed without a stale expanded render. */
export function NativeSceneView(props: NativeSceneViewProps) {
  const identityScene =
    props.interactionRuntime?.mode === "live_audience"
      ? {
          ...props.scene,
          nodes: props.scene.nodes.map((node) =>
            node.type === "reveal" && node.scope === "broadcast" ? { ...node, body: "" } : node,
          ),
        }
      : props.scene;
  return (
    <NativeSceneSurface
      key={
        props.staticThumbnail
          ? "thumbnail"
          : props.onSelect
            ? "editor"
            : JSON.stringify([props.interactionSourceKey, identityScene])
      }
      {...props}
    />
  );
}

/** Closed geometry and structured text; image authority belongs to the calling surface. */
function NativeSceneSurface({
  scene,
  locale = "en-CA",
  contentLocale,
  renderImage,
  fixedLayout = false,
  selectedNodeId,
  selectedNodeIds,
  onSelect,
  onFrameChange,
  onGeometryKey,
  onNodePointerDown,
  interactionEditing = false,
  interactionRuntime,
  staticThumbnail = false,
  motionStatic = false,
  hideGeometryControls = false,
  editorOverlay,
}: NativeSceneViewProps) {
  const copy = nativeAudienceCopy(locale);
  const controlCopy = nativeControlsCopy(locale);
  const markerId = useId();
  const [outline, setOutline] = useState(false);
  const hasInteractions = scene.nodes.some(isNativeInteractionNode);
  const sharedReveals =
    interactionRuntime &&
    interactionRuntime.mode !== "review" &&
    scene.nodes.some((node) => node.type === "reveal" && node.scope === "broadcast");
  const sceneId = useId();
  const design = scene.design;
  const palette = design ? NATIVE_DESIGN_THEMES[design.theme] : undefined;
  const designStyle =
    design && palette
      ? ({
          "--native-background": palette.background,
          "--native-text": palette.text,
          "--native-link": palette.link,
          "--native-border": palette.border,
          "--native-font": NATIVE_DESIGN_FONTS[design.font],
          "--native-padding": design.spacing === "compact" ? "0.390625cqw" : "0.78125cqw",
          "--native-reading-padding": design.spacing === "compact" ? "5px" : "10px",
          "--native-body-leading": design.spacing === "compact" ? 1.2 : 1.45,
          "--native-title-leading": design.spacing === "compact" ? 1.04 : 1.12,
          "--native-paragraph-gap": design.spacing === "compact" ? "0.25em" : "0.55em",
        } as CSSProperties)
      : undefined;
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const editing = !staticThumbnail && Boolean(onSelect);
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
    <div
      className={styles.sceneDelivery}
      style={designStyle}
      inert={staticThumbnail || undefined}
      aria-hidden={staticThumbnail || undefined}
    >
      {hasInteractions && !editing && !interactionEditing && !staticThumbnail ? (
        <div
          lang={locale}
          className={styles.interactionToolbar}
          onKeyDown={containNativeInteractionKey}
        >
          <p>
            {sharedReveals
              ? copy("Local details open on this screen. Broadcast reveals follow the facilitator.")
              : copy(
                  "Panels open only on this screen. They do not change other screens, responses or scores.",
                )}
          </p>
          <button
            type="button"
            aria-pressed={outline}
            aria-controls={sceneId}
            onClick={() => setOutline((current) => !current)}
          >
            {copy(outline ? "Show slide layout" : "Show accessible outline")}
          </button>
        </div>
      ) : null}
      <article
        lang={locale}
        id={sceneId}
        className={`${styles.stage}${outline ? ` ${styles.outline}` : ""}${staticThumbnail ? ` ${styles.staticThumbnail}` : ""}`}
        data-native-outline={
          hasInteractions && !editing && !interactionEditing && !staticThumbnail
            ? outline
            : undefined
        }
        aria-label={copy("{title} native slide", {
          title: presentationSceneTitle(scene) || copy("Untitled"),
        })}
        data-native-scene={staticThumbnail ? undefined : "true"}
        data-native-fixed-layout={fixedLayout ? "true" : undefined}
        data-thumbnail-scene={staticThumbnail ? "true" : undefined}
        data-static-thumbnail={staticThumbnail || undefined}
        data-native-theme={design?.theme}
        data-native-font={design?.font}
        data-native-spacing={design?.spacing}
        style={designStyle}
      >
        <PresentationMotionBackground
          preset={design?.motionBackground}
          theme={design?.theme ?? "paper"}
          static={staticThumbnail || motionStatic || outline}
        />
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
                <span lang={node.label ? "" : locale}>{node.label || copy("Connection")}</span>:{" "}
                <span lang={nativeControlNodeLabel(locale, nodes.get(node.from.nodeId)!).language}>
                  {nativeControlNodeLabel(locale, nodes.get(node.from.nodeId)!).text}
                </span>{" "}
                →{" "}
                <span lang={nativeControlNodeLabel(locale, nodes.get(node.to.nodeId)!).language}>
                  {nativeControlNodeLabel(locale, nodes.get(node.to.nodeId)!).text}
                </span>
              </p>
            );
          const style: CSSProperties = {
            left: `${node.frame.x}%`,
            top: `${node.frame.y}%`,
            width: `${node.frame.width}%`,
            height: `${node.frame.height}%`,
            zIndex: scene.nodes.indexOf(node) + 1,
            transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
          };
          return (
            <div
              key={id}
              className={`${styles.node} ${editing ? styles.editableNode : ""} ${!staticThumbnail && (selectedNodeIds?.includes(id) ?? selectedNodeId === id) ? styles.selected : ""}`}
              style={style}
              data-node-id={id}
              data-node-type={node.type}
              data-frame={JSON.stringify(node.frame)}
              data-rotation={node.rotation}
              onClick={
                editing && !onNodePointerDown
                  ? (event) => onSelect?.(id, event.shiftKey)
                  : undefined
              }
              onPointerDown={
                editing && onNodePointerDown
                  ? (event) => onNodePointerDown(event, id, false, false)
                  : undefined
              }
            >
              {node.type === "text" ? (
                node.richText ? (
                  <NativeRichTextView
                    richText={node.richText}
                    title={node.role === "title"}
                    editing={editing}
                    lang={node.lang ?? contentLocale ?? ""}
                    layoutKey={JSON.stringify([node.frame, design])}
                  />
                ) : (
                  <NativePlainText
                    text={
                      node.text ||
                      (editing ? copy(node.role === "title" ? "Slide title" : "Body text") : "")
                    }
                    title={node.role === "title"}
                    layoutKey={JSON.stringify([node.frame, design])}
                    lang={
                      node.text
                        ? (node.lang ?? contentLocale ?? "")
                        : editing
                          ? locale
                          : (node.lang ?? contentLocale ?? "")
                    }
                  />
                )
              ) : null}
              {node.type === "shape" ? (
                <Shape node={node} locale={locale} contentLocale={contentLocale} />
              ) : null}
              {isNativeInteractionNode(node) ? (
                <NativeSceneInteractionView
                  node={node}
                  editing={editing || interactionEditing || staticThumbnail}
                  runtime={interactionRuntime}
                  locale={locale}
                />
              ) : null}
              {node.type === "table" || node.type === "chart" ? (
                <NativeSceneDataView
                  node={node}
                  fixedLayout={fixedLayout}
                  locale={locale}
                  contentLocale={contentLocale}
                />
              ) : null}
              {node.type === "image" ? (
                <div
                  lang=""
                  className={styles.image}
                  data-image-fit={node.fit ?? "contain"}
                  style={
                    {
                      "--native-image-fit": node.fit ?? "contain",
                      "--native-image-position": `${node.focalPoint?.x ?? 50}% ${node.focalPoint?.y ?? 50}%`,
                    } as CSSProperties
                  }
                >
                  {renderImage ? (
                    renderImage(node.mediaId, node.altText)
                  ) : (
                    <span
                      lang={node.altText ? "" : locale}
                      role="img"
                      aria-label={node.altText || copy("Image description needed")}
                    >
                      <span lang={locale}>{copy("Image unavailable")}</span>
                    </span>
                  )}
                </div>
              ) : null}
              {editing && !hideGeometryControls ? (
                <div className={styles.handles}>
                  <button
                    type="button"
                    lang={locale}
                    aria-label={controlCopy("Move {name}. Use arrow keys to nudge.", {
                      name: nativeControlNodeLabel(locale, node).text,
                    })}
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
                    hidden={scene.groups?.some((group) => group.nodeIds.includes(id))}
                    lang={locale}
                    aria-label={controlCopy("Resize {name}. Use arrow keys to change size.", {
                      name: nativeControlNodeLabel(locale, node).text,
                    })}
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
        {editing
          ? scene.groups?.map((group, index) => {
              if (!group.nodeIds.every((id) => selectedNodeIds?.includes(id))) return null;
              const bounds = selectedNativeSceneBounds(scene, group.nodeIds)!;
              const member = nodes.get(group.nodeIds[0]!) as FramedNode;
              return (
                <div
                  key={group.id}
                  className={styles.groupOutline}
                  data-native-group={group.id}
                  style={{
                    left: `${bounds.x}%`,
                    top: `${bounds.y}%`,
                    width: `${bounds.width}%`,
                    height: `${bounds.height}%`,
                    zIndex: scene.nodes.length + 1,
                  }}
                >
                  {!hideGeometryControls ? (
                    <button
                      type="button"
                      lang={locale}
                      aria-label={controlCopy(
                        "Resize group {number}. Use arrow keys to change size.",
                        { number: index + 1 },
                      )}
                      onKeyDown={(event) => frameKey(event, member, true)}
                      onPointerDown={
                        onNodePointerDown
                          ? (event) => {
                              event.stopPropagation();
                              onNodePointerDown(event, member.id, true, true);
                            }
                          : undefined
                      }
                    >
                      ↘
                    </button>
                  ) : null}
                </div>
              );
            })
          : null}
        {editing ? editorOverlay : null}
      </article>
      {!staticThumbnail && !motionStatic && !outline ? (
        <PresentationMotionControls preset={design?.motionBackground} locale={locale} />
      ) : null}
    </div>
  );
}
