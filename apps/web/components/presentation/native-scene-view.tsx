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
  presentationDesignPalette,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
  type SupportedLocale,
} from "@openround/contracts";
import { boundNativeSceneFrame } from "../../lib/presentation-native-scene";
import { nativeControlNodeLabel, nativeControlsCopy } from "./native-controls-copy";
import { nativeAudienceCopy } from "./native-audience-copy";
import styles from "./native-scene.module.css";
import { NATIVE_DESIGN_FONTS } from "../../lib/presentation-native-design";
import { useNativeTextOverflow } from "./use-native-text-overflow";
import { NativeRichTextView } from "./native-rich-text-view";
import { NativeSceneDataView } from "./native-scene-data-view";
import {
  NativeSceneInteractionView,
  containNativeInteractionKey,
  isNativeInteractionNode,
  type NativeSceneInteractionRuntime,
} from "./native-scene-interaction-view";
import {
  expandNativeSceneSelection,
  selectedNativeSceneBounds,
  type NativeSceneResizeHandle,
} from "../../lib/presentation-native-geometry";
import { nativeResizeDirectionLabel } from "./native-scene-resize-copy";
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
  palette,
}: {
  palette: ReturnType<typeof presentationDesignPalette>;
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
  const paint = (token: keyof typeof palette | "none" | undefined, fallback: string) =>
    token === "none" ? "none" : token ? palette[token] : fallback;
  const fill = paint(node.appearance?.fill, CANVAS_FILL_COLORS[node.color]);
  const stroke = paint(node.appearance?.stroke, CANVAS_STROKE_COLORS[node.color]);
  return (
    <div
      className={styles.shape}
      aria-hidden={node.decorative || undefined}
      role="img"
      aria-label={node.label || nativeControlNodeLabel(locale, node).text}
      lang={node.label ? (contentLocale ?? "") : locale}
    >
      <svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
        {path ? (
          <path
            d={path}
            fill={fill}
            stroke={stroke}
            strokeWidth={node.appearance?.strokeWidth ?? 2}
          />
        ) : (
          <ellipse
            cx="80"
            cy="45"
            rx="78"
            ry="43"
            fill={fill}
            stroke={stroke}
            strokeWidth={node.appearance?.strokeWidth ?? 2}
          />
        )}
      </svg>
      <span
        aria-hidden="true"
        style={{
          color:
            node.appearance?.fill === "accent"
              ? palette.accentText
              : node.appearance?.fill !== undefined
                ? palette.text
                : node.color === "black"
                  ? "#ffffff"
                  : "#102a43",
        }}
      >
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
  /** Opt-in creator canvas handles; previews and delivery never enable this. */
  showSelectionHandles?: boolean;
  /** Creator-only passive annotations, never rendered by delivery or thumbnail callers. */
  editorOverlay?: ReactNode;
  interactionRuntime?: NativeSceneInteractionRuntime;
  selectedNodeId?: string;
  selectedNodeIds?: readonly string[];
  onSelect?: (id: string, additive?: boolean) => void;
  onFrameChange?: (id: string, frame: PresentationSceneFrame) => void;
  onGeometryKey?: (
    id: string,
    dx: number,
    dy: number,
    resize: boolean,
    resizeHandle?: NativeSceneResizeHandle,
  ) => void;
  onNodePointerDown?: (
    event: PointerEvent<HTMLElement>,
    id: string,
    resize: boolean,
    handle: boolean,
    resizeHandle?: NativeSceneResizeHandle,
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
  showSelectionHandles = false,
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
  const palette = presentationDesignPalette(design);
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
  const selectionIds = expandNativeSceneSelection(
    scene,
    selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []),
  );
  const selection = scene.nodes.filter(
    (node): node is FramedNode => node.type !== "connector" && selectionIds.includes(node.id),
  );
  const selectionFrame =
    selection.length === 1 ? selection[0]!.frame : selectedNativeSceneBounds(scene, selectionIds);
  const selectionRotation = selection.length === 1 ? (selection[0]!.rotation ?? 0) : 0;
  const selectionMember =
    selection.find((node) => node.id === selectedNodeIds?.at(-1)) ?? selection[0];
  function frameKey(
    event: KeyboardEvent<HTMLButtonElement>,
    node: FramedNode,
    resize: boolean,
    resizeHandle?: NativeSceneResizeHandle,
  ) {
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    if (onGeometryKey) {
      onGeometryKey(node.id, dx, dy, resize, resizeHandle);
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
        data-native-palette={design?.palette}
        data-native-font={design?.font}
        data-native-spacing={design?.spacing}
        data-native-direct-selection={editing && showSelectionHandles ? "true" : undefined}
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
          const typography = node.type === "text" ? node.typography : undefined;
          const style = {
            ...(typography
              ? {
                  "--native-node-size":
                    typography.size === undefined ? undefined : `${typography.size / 12.8}cqw`,
                  "--native-node-weight": typography.weight,
                  "--native-node-align": typography.align,
                  "--native-node-font": typography.font
                    ? NATIVE_DESIGN_FONTS[typography.font]
                    : undefined,
                  "--native-node-color": typography.color ? palette[typography.color] : undefined,
                  "--native-node-leading": typography.leading,
                }
              : {}),
            left: `${node.frame.x}%`,
            top: `${node.frame.y}%`,
            width: `${node.frame.width}%`,
            height: `${node.frame.height}%`,
            zIndex: scene.nodes.indexOf(node) + 1,
            transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
          } as CSSProperties;
          return (
            <div
              key={id}
              className={`${styles.node} ${editing ? styles.editableNode : ""} ${!staticThumbnail && (selectedNodeIds?.includes(id) ?? selectedNodeId === id) ? styles.selected : ""}`}
              style={style}
              data-node-id={id}
              data-node-type={node.type}
              data-native-typography={typography ? "true" : undefined}
              data-decorative={
                node.type === "shape" && node.decorative && !editing ? "true" : undefined
              }
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
                    layoutKey={JSON.stringify([node.frame, design, node.typography])}
                  />
                ) : (
                  <NativePlainText
                    text={
                      node.text ||
                      (editing ? copy(node.role === "title" ? "Slide title" : "Body text") : "")
                    }
                    title={node.role === "title"}
                    layoutKey={JSON.stringify([node.frame, design, node.typography])}
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
                <Shape
                  node={node}
                  locale={locale}
                  contentLocale={contentLocale}
                  palette={palette}
                />
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
        {editing && !showSelectionHandles
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
        {editing &&
        showSelectionHandles &&
        onNodePointerDown &&
        selectionFrame &&
        selection.length ? (
          <div
            className={styles.selectionOverlay}
            data-native-selection-handles="true"
            style={{ zIndex: scene.nodes.length + 2 }}
          >
            <div
              className={styles.selectionOutline}
              data-native-selection-outline="true"
              data-native-group={
                scene.groups?.find(
                  (group) =>
                    group.nodeIds.length === selection.length &&
                    group.nodeIds.every((id) => selection.some((node) => node.id === id)),
                )?.id
              }
              style={{
                left: `${selectionFrame.x}%`,
                top: `${selectionFrame.y}%`,
                width: `${selectionFrame.width}%`,
                height: `${selectionFrame.height}%`,
                transform: selectionRotation ? `rotate(${selectionRotation}deg)` : undefined,
              }}
            >
              {(["n", "e", "s", "w"] as const).map((edge) => (
                <span
                  key={edge}
                  className={styles.selectionDragBorder}
                  data-native-move-border={edge}
                  aria-hidden="true"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onNodePointerDown(event, selectionMember!.id, false, true);
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
              ))}
            </div>
            {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((handle) => {
              const dx =
                (handle.includes("w") ? -0.5 : handle.includes("e") ? 0.5 : 0) *
                selectionFrame.width *
                16;
              const dy =
                (handle.includes("n") ? -0.5 : handle.includes("s") ? 0.5 : 0) *
                selectionFrame.height *
                9;
              const angle = (selectionRotation * Math.PI) / 180;
              const x =
                selectionFrame.x +
                selectionFrame.width / 2 +
                (dx * Math.cos(angle) - dy * Math.sin(angle)) / 16;
              const y =
                selectionFrame.y +
                selectionFrame.height / 2 +
                (dx * Math.sin(angle) + dy * Math.cos(angle)) / 9;
              const member = selectionMember!;
              const label = `${controlCopy("Resize {name}. Use arrow keys to change size.", { name: nativeControlNodeLabel(locale, member).text })} ${nativeResizeDirectionLabel(locale, handle)}`;
              return (
                <button
                  key={handle}
                  type="button"
                  lang={locale}
                  className={styles.directResizeHandle}
                  data-native-resize-handle={handle}
                  data-native-resize-corner={handle.length === 2 || undefined}
                  aria-label={label}
                  title={label}
                  style={
                    {
                      left: `clamp(16px, ${x}%, calc(100% - 16px))`,
                      top: `clamp(16px, ${y}%, calc(100% - 16px))`,
                      "--native-handle-angle": `${selectionRotation}deg`,
                    } as CSSProperties
                  }
                  onKeyDown={(event) => frameKey(event, member, true, handle)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onNodePointerDown(event, member.id, true, true, handle);
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
              );
            })}
          </div>
        ) : null}
        {editing ? editorOverlay : null}
      </article>
      {!staticThumbnail && !motionStatic && !outline ? (
        <PresentationMotionControls preset={design?.motionBackground} locale={locale} />
      ) : null}
    </div>
  );
}
