"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import {
  clampContentSlideFrame,
  contentSlideMediaFrame,
  fitContentSlideFrameAroundMedia,
  regionForContentSlideFrame,
  resolveContentSlideFrames,
  type ContentSlideFrame,
  type ContentSlideLayout,
  type ContentSlideRegion,
  type ContentSlideTextElement,
  type PresentationScene,
  type PresentationSceneDesign,
  type SupportedLocale,
} from "@openround/contracts";
import { useLocale } from "../locale-provider";
import styles from "./content-slide-view.module.css";
import { NATIVE_DESIGN_THEMES, NATIVE_DESIGN_FONTS } from "../../lib/presentation-native-design";
import { NativeSceneView, type SceneImageRenderer } from "./native-scene-view";
import type { NativeSceneInteractionRuntime } from "./native-scene-interaction-view";

export const contentSlideRegions: ContentSlideRegion[] = [
  "top_left",
  "top_center",
  "top_right",
  "middle_left",
  "middle_center",
  "middle_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
];

export const contentSlideRegionLabels: Record<ContentSlideRegion, string> = {
  top_left: "Top left",
  top_center: "Top center",
  top_right: "Top right",
  middle_left: "Middle left",
  middle_center: "Center",
  middle_right: "Middle right",
  bottom_left: "Bottom left",
  bottom_center: "Bottom center",
  bottom_right: "Bottom right",
};

type ContentSlideViewBlock = {
  id?: string;
  layout: ContentSlideLayout;
  textElements: ContentSlideTextElement[];
  mediaId?: string | null;
  scene?: PresentationScene;
  design?: PresentationSceneDesign;
};

interface ContentSlideViewProps {
  block: ContentSlideViewBlock;
  locale?: SupportedLocale;
  /** Display-only language for known, otherwise unmarked authored content. */
  contentLocale?: SupportedLocale;
  /** Contextual rendering only; imported source records are never rewritten. */
  designOverride?: PresentationSceneDesign;
  media?: ReactNode;
  renderSceneImage?: SceneImageRenderer;
  interactionSourceKey?: string;
  interactionRuntime?: NativeSceneInteractionRuntime;
  /** Inert fixed-layout artwork; ordinary preview/live retain readable phone flow. */
  staticThumbnail?: boolean;
  variant: "editor" | "preview" | "live";
  selectedElementId?: string | null;
  titlePlaceholder?: string;
  bodyPlaceholder?: string;
  showGuides?: boolean;
  onSelectElement?: (elementId: string) => void;
  onChangeElement?: (elementId: string, text: string) => void;
  onMoveElement?: (elementId: string, region: ContentSlideRegion) => void;
  onChangeFrame?: (elementId: string, frame: ContentSlideFrame) => void;
}

interface AutosizingTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

type GestureKind = "move" | "resize";

interface FrameGesture {
  elementId: string;
  kind: GestureKind;
  pointerId: number;
  startX: number;
  startY: number;
  startFrame: ContentSlideFrame;
  currentFrame: ContentSlideFrame;
  canvas: DOMRect;
  handle: HTMLButtonElement;
}

interface AlignmentGuides {
  x: number | null;
  y: number | null;
}

const gridGuidePath = Array.from({ length: 9 }, (_, index) => (index + 1) * 10)
  .map((position) => `M ${position} 0 V 100 M 0 ${position} H 100`)
  .join(" ");

function AutosizingTextarea(props: AutosizingTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [overflowsFrame, setOverflowsFrame] = useState(false);
  const measureOverflow = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const isStacked = window.matchMedia
      ? window.matchMedia("(max-width: 700px)").matches
      : window.innerWidth <= 700;
    if (isStacked) {
      textarea.style.height = "auto";
      const style = window.getComputedStyle(textarea);
      const borderHeight =
        (Number.parseFloat(style.borderTopWidth) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0);
      textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
      setOverflowsFrame(false);
      return;
    }
    textarea.style.height = "";
    const overflows =
      textarea.scrollHeight > textarea.clientHeight + 1 ||
      textarea.scrollWidth > textarea.clientWidth + 1;
    setOverflowsFrame((current) => (current === overflows ? current : overflows));
  }, []);

  useLayoutEffect(() => {
    measureOverflow();
  }, [props.value, measureOverflow]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureOverflow);
      return () => window.removeEventListener("resize", measureOverflow);
    }
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [measureOverflow]);

  return (
    <>
      <textarea {...props} ref={textareaRef} />
      {overflowsFrame ? (
        <span
          className={styles.fitWarning}
          role="status"
          aria-label="Text overflows frame"
          title="Text overflows this frame. Enlarge the text box to show more text."
        >
          Text fit
        </span>
      ) : null}
    </>
  );
}

function orderedTextElements(elements: ContentSlideTextElement[]) {
  return [...elements].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

function textElementLabel(block: ContentSlideViewBlock, element: ContentSlideTextElement) {
  if (element.role === "title") return "Slide title";
  const index = block.textElements
    .filter((candidate) => candidate.role === "body")
    .findIndex((candidate) => candidate.id === element.id);
  return `Text box ${index + 1}`;
}

function adjacentRegion(region: ContentSlideRegion, key: string): ContentSlideRegion | null {
  const index = contentSlideRegions.indexOf(region);
  const row = Math.floor(index / 3);
  const column = index % 3;
  const nextRow = row + (key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0);
  const nextColumn = column + (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0);
  if (nextRow < 0 || nextRow > 2 || nextColumn < 0 || nextColumn > 2) return null;
  return contentSlideRegions[nextRow * 3 + nextColumn] ?? null;
}

function equalFrames(left: ContentSlideFrame, right: ContentSlideFrame) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function elementFrameStyle(frame: ContentSlideFrame): CSSProperties {
  return {
    left: `${frame.x}%`,
    top: `${frame.y}%`,
    width: `${frame.width}%`,
    height: `${frame.height}%`,
  };
}

function alignMoveFrame(
  elementId: string,
  frame: ContentSlideFrame,
  frames: Record<string, ContentSlideFrame>,
): { frame: ContentSlideFrame; guides: AlignmentGuides } {
  const others = Object.entries(frames)
    .filter(([candidateId]) => candidateId !== elementId)
    .map(([, candidate]) => candidate);
  const snapAxis = (start: number, size: number, otherFrames: number[]) => {
    const landmarks = [start, start + size / 2, start + size];
    const targets = [10, 50, 90, ...otherFrames];
    let closest: { delta: number; target: number } | null = null;
    for (const landmark of landmarks) {
      for (const target of targets) {
        const delta = target - landmark;
        if (Math.abs(delta) > 1.25) continue;
        if (!closest || Math.abs(delta) < Math.abs(closest.delta)) closest = { delta, target };
      }
    }
    return closest;
  };
  const xSnap = snapAxis(
    frame.x,
    frame.width,
    others.flatMap((other) => [other.x, other.x + other.width / 2, other.x + other.width]),
  );
  const ySnap = snapAxis(
    frame.y,
    frame.height,
    others.flatMap((other) => [other.y, other.y + other.height / 2, other.y + other.height]),
  );
  return {
    frame: clampContentSlideFrame({
      ...frame,
      x: frame.x + (xSnap?.delta ?? 0),
      y: frame.y + (ySnap?.delta ?? 0),
    }),
    guides: { x: xSnap?.target ?? null, y: ySnap?.target ?? null },
  };
}

function frameBlockSignature(block: ContentSlideViewBlock, hasMedia: boolean) {
  return `${block.id ?? ""}|${block.layout}|${hasMedia}|${block.textElements
    .map((element) => {
      const frame = element.frame;
      return [
        element.id,
        element.region,
        element.order,
        element.text,
        frame?.x,
        frame?.y,
        frame?.width,
        frame?.height,
      ].join(":");
    })
    .join("|")}`;
}

export function ContentSlideView(props: ContentSlideViewProps) {
  const { locale } = useLocale();
  const design = props.designOverride ?? props.block.design;
  return props.block.scene ? (
    <NativeSceneView
      locale={props.locale ?? locale}
      contentLocale={props.contentLocale}
      scene={
        props.block.scene.design || !design
          ? props.block.scene
          : {
              ...props.block.scene,
              schemaVersion:
                props.block.scene.schemaVersion >= 3 ? props.block.scene.schemaVersion : 3,
              design,
            }
      }
      renderImage={props.renderSceneImage}
      interactionEditing={props.variant === "editor"}
      staticThumbnail={props.staticThumbnail}
      interactionRuntime={props.interactionRuntime}
      interactionSourceKey={JSON.stringify([props.block.id, props.interactionSourceKey])}
    />
  ) : (
    <LegacyContentSlideView {...props} designOverride={design} />
  );
}

function LegacyContentSlideView({
  block,
  contentLocale,
  designOverride,
  media,
  variant,
  staticThumbnail = false,
  selectedElementId = null,
  titlePlaceholder = "Give this moment a clear title",
  bodyPlaceholder = "Add the context your audience needs",
  showGuides: showGuidesProp = true,
  onSelectElement,
  onChangeElement,
  onMoveElement,
  onChangeFrame,
}: ContentSlideViewProps) {
  const editing = !staticThumbnail && variant === "editor";
  const showGuides = editing && showGuidesProp;
  const hasMedia = block.mediaId === undefined ? Boolean(media) : Boolean(block.mediaId);
  const pendingMoveFocusId = useRef<string | null>(null);
  const pendingMoveFocusKind = useRef<GestureKind>("move");
  const moveHandleRefs = useRef(new Map<string, HTMLButtonElement>());
  const resizeHandleRefs = useRef(new Map<string, HTMLButtonElement>());
  const gestureRef = useRef<FrameGesture | null>(null);
  const onChangeFrameRef = useRef(onChangeFrame);
  const regionsRef = useRef<HTMLDivElement>(null);
  const [transientFrames, setTransientFrames] = useState<Record<string, ContentSlideFrame>>({});
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>({ x: null, y: null });
  const frames = resolveContentSlideFrames({ ...block, hasMedia });
  const geometrySignature = frameBlockSignature(block, hasMedia);
  onChangeFrameRef.current = onChangeFrame;

  const elementsByRegion = new Map<ContentSlideRegion, ContentSlideTextElement[]>();
  for (const region of contentSlideRegions) elementsByRegion.set(region, []);
  for (const element of block.textElements) {
    elementsByRegion.get(element.region)?.push(element);
  }

  const currentFrame = (elementId: string) =>
    (Object.hasOwn(transientFrames, elementId)
      ? transientFrames[elementId]
      : frames[elementId]) ?? { x: 8, y: 20, width: 84, height: 22 };

  const fitTextFrame = (frame: ContentSlideFrame) => {
    const bounded = clampContentSlideFrame(frame);
    return hasMedia ? fitContentSlideFrameAroundMedia(bounded) : bounded;
  };

  useLayoutEffect(() => {
    const pendingId = pendingMoveFocusId.current;
    if (!pendingId) return;
    pendingMoveFocusId.current = null;
    const kind = pendingMoveFocusKind.current;
    pendingMoveFocusKind.current = "move";
    const handle =
      kind === "resize"
        ? resizeHandleRefs.current.get(pendingId)
        : moveHandleRefs.current.get(pendingId);
    if (handle) handle.focus({ preventScroll: true });
  }, [block.textElements]);

  useLayoutEffect(() => {
    const gesture = gestureRef.current;
    if (gesture) {
      gestureRef.current = null;
      try {
        if (gesture.handle.hasPointerCapture(gesture.pointerId)) {
          gesture.handle.releasePointerCapture(gesture.pointerId);
        }
      } catch {
        // The handle may already have been removed by the block update.
      }
    }
    setTransientFrames({});
    setAlignmentGuides({ x: null, y: null });
  }, [geometrySignature]);

  useEffect(
    () => () => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) return;
      try {
        if (gesture.handle.hasPointerCapture(gesture.pointerId)) {
          gesture.handle.releasePointerCapture(gesture.pointerId);
        }
      } catch {
        // Unmount can precede pointer-capture cleanup.
      }
    },
    [],
  );

  function setTransientFrame(elementId: string, frame: ContentSlideFrame) {
    setTransientFrames((current) => ({ ...current, [elementId]: frame }));
  }

  function clearTransientFrame(elementId: string) {
    setTransientFrames((current) => {
      if (!Object.hasOwn(current, elementId)) return current;
      const next = { ...current };
      delete next[elementId];
      return next;
    });
  }

  function updateGestureFrame(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = ((event.clientX - gesture.startX) / gesture.canvas.width) * 100;
    const deltaY = ((event.clientY - gesture.startY) / gesture.canvas.height) * 100;
    let next: ContentSlideFrame;
    if (gesture.kind === "move") {
      next = clampContentSlideFrame({
        ...gesture.startFrame,
        x: gesture.startFrame.x + deltaX,
        y: gesture.startFrame.y + deltaY,
      });
      if (showGuides) {
        const aligned = alignMoveFrame(gesture.elementId, next, { ...frames, ...transientFrames });
        next = fitTextFrame(aligned.frame);
        setAlignmentGuides(
          equalFrames(next, aligned.frame) ? aligned.guides : { x: null, y: null },
        );
      } else {
        next = fitTextFrame(next);
        setAlignmentGuides({ x: null, y: null });
      }
    } else {
      next = fitTextFrame({
        ...gesture.startFrame,
        width: Math.min(100 - gesture.startFrame.x, gesture.startFrame.width + deltaX),
        height: Math.min(100 - gesture.startFrame.y, gesture.startFrame.height + deltaY),
      });
      setAlignmentGuides({ x: null, y: null });
    }
    gesture.currentFrame = next;
    setTransientFrame(gesture.elementId, next);
  }

  function finishGesture(event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (commit) updateGestureFrame(event);
    const finalFrame = gesture.currentFrame;
    gestureRef.current = null;
    clearTransientFrame(gesture.elementId);
    setAlignmentGuides({ x: null, y: null });
    try {
      if (gesture.handle.hasPointerCapture(gesture.pointerId)) {
        gesture.handle.releasePointerCapture(gesture.pointerId);
      }
    } catch {
      // Browsers can release capture before dispatching pointerup.
    }
    if (commit && !equalFrames(gesture.startFrame, finalFrame)) {
      pendingMoveFocusId.current = gesture.elementId;
      pendingMoveFocusKind.current = gesture.kind;
      onChangeFrameRef.current?.(gesture.elementId, finalFrame);
    }
  }

  function startGesture(
    event: ReactPointerEvent<HTMLButtonElement>,
    element: ContentSlideTextElement,
    kind: GestureKind,
  ) {
    onSelectElement?.(element.id);
    event.currentTarget.focus({ preventScroll: true });
    if (!onChangeFrameRef.current || event.button !== 0) return;
    const isStacked = window.matchMedia
      ? window.matchMedia("(max-width: 700px)").matches
      : window.innerWidth <= 700;
    if (isStacked) return;
    const canvas = regionsRef.current?.getBoundingClientRect();
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    const startFrame = currentFrame(element.id);
    gestureRef.current = {
      elementId: element.id,
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startFrame,
      currentFrame: startFrame,
      canvas,
      handle: event.currentTarget,
    };
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      gestureRef.current = null;
    }
  }

  function cancelGesture(elementId?: string) {
    const gesture = gestureRef.current;
    if (!gesture || (elementId && gesture.elementId !== elementId)) return;
    gestureRef.current = null;
    clearTransientFrame(gesture.elementId);
    setAlignmentGuides({ x: null, y: null });
    try {
      if (gesture.handle.hasPointerCapture(gesture.pointerId)) {
        gesture.handle.releasePointerCapture(gesture.pointerId);
      }
    } catch {
      // The pointer may already be cancelled by the browser.
    }
  }

  function handleFrameKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    element: ContentSlideTextElement,
    kind: GestureKind,
  ) {
    if (event.key === "Escape") {
      if (!gestureRef.current || gestureRef.current.elementId !== element.id) return;
      event.preventDefault();
      cancelGesture(element.id);
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const frame = currentFrame(element.id);
    let next: ContentSlideFrame;
    if (onChangeFrame) {
      if (kind === "move") {
        const step = event.shiftKey ? 5 : 1;
        next = fitTextFrame({
          ...frame,
          x: frame.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
          y: frame.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
        });
      } else {
        const step = event.shiftKey ? 5 : 1;
        next = fitTextFrame({
          ...frame,
          width: Math.min(
            100 - frame.x,
            frame.width +
              (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
          ),
          height: Math.min(
            100 - frame.y,
            frame.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
          ),
        });
      }
      if (!equalFrames(frame, next)) {
        pendingMoveFocusId.current = element.id;
        pendingMoveFocusKind.current = kind;
        onChangeFrame(element.id, next);
      }
      return;
    }
    if (kind === "move" && onMoveElement) {
      const region = adjacentRegion(element.region, event.key);
      if (!region) return;
      pendingMoveFocusId.current = element.id;
      pendingMoveFocusKind.current = "move";
      onMoveElement(element.id, region);
    }
  }

  const overlapIds = new Set<string>();
  if (editing) {
    for (let leftIndex = 0; leftIndex < block.textElements.length; leftIndex += 1) {
      const left = block.textElements[leftIndex]!;
      const leftFrame = currentFrame(left.id);
      for (const right of block.textElements.slice(leftIndex + 1)) {
        const rightFrame = currentFrame(right.id);
        if (
          leftFrame.x < rightFrame.x + rightFrame.width &&
          leftFrame.x + leftFrame.width > rightFrame.x &&
          leftFrame.y < rightFrame.y + rightFrame.height &&
          leftFrame.y + leftFrame.height > rightFrame.y
        ) {
          overlapIds.add(left.id);
          overlapIds.add(right.id);
        }
      }
    }
  }

  return (
    <article
      className={`${styles.slide} ${styles[`layout_${block.layout}`]} ${styles[`variant_${variant}`]}${staticThumbnail ? ` ${styles.staticThumbnail}` : ""}`}
      data-design-theme={designOverride?.theme}
      style={
        designOverride
          ? ({
              "--content-slide-background": NATIVE_DESIGN_THEMES[designOverride.theme].background,
              "--content-slide-text": NATIVE_DESIGN_THEMES[designOverride.theme].text,
              fontFamily: NATIVE_DESIGN_FONTS[designOverride.font],
            } as CSSProperties)
          : undefined
      }
      data-layout={block.layout}
      data-static-thumbnail={staticThumbnail || undefined}
      inert={staticThumbnail || undefined}
      aria-hidden={staticThumbnail || undefined}
      lang={contentLocale ?? "en-CA"}
    >
      <div className={styles.regions} ref={regionsRef}>
        {showGuides ? (
          <div aria-hidden="true" className={styles.guides}>
            <svg preserveAspectRatio="none" viewBox="0 0 100 100">
              <path className={styles.gridLines} d={gridGuidePath} />
              <rect className={styles.safeMargin} height="80" width="80" x="10" y="10" />
            </svg>
            {alignmentGuides.x !== null ? (
              <span
                className={styles.alignmentGuideVertical}
                style={{ left: `${alignmentGuides.x}%` }}
              />
            ) : null}
            {alignmentGuides.y !== null ? (
              <span
                className={styles.alignmentGuideHorizontal}
                style={{ top: `${alignmentGuides.y}%` }}
              />
            ) : null}
          </div>
        ) : null}
        {contentSlideRegions.map((region) => (
          <div
            aria-label={`${contentSlideRegionLabels[region]} region`}
            className={`${styles.region} ${styles[`region_${region}`]}`}
            data-region={region}
            key={region}
            role="group"
          >
            {orderedTextElements(elementsByRegion.get(region) ?? []).map((element) => {
              const frame = currentFrame(element.id);
              const selected = editing && selectedElementId === element.id;
              const label = textElementLabel(block, element);
              const frameRegion = regionForContentSlideFrame(frame);
              return (
                <div
                  aria-label={`${label}, ${contentSlideRegionLabels[frameRegion]}`}
                  className={`${styles.textElement} ${
                    element.role === "title" ? styles.titleElement : styles.bodyElement
                  } ${selected ? styles.selectedElement : ""}`}
                  data-frame={JSON.stringify(frame)}
                  key={element.id}
                  onClick={editing ? () => onSelectElement?.(element.id) : undefined}
                  role="group"
                  style={elementFrameStyle(frame)}
                >
                  {editing ? (
                    <button
                      aria-label={`Move ${label}. Drag to position or use arrow keys to nudge.`}
                      className={styles.moveHandle}
                      onFocus={() => onSelectElement?.(element.id)}
                      onKeyDown={(event) => handleFrameKeyDown(event, element, "move")}
                      onMouseDown={() => onSelectElement?.(element.id)}
                      onPointerCancel={(event) => finishGesture(event, false)}
                      onPointerDown={(event) => startGesture(event, element, "move")}
                      onPointerMove={updateGestureFrame}
                      onPointerUp={(event) => finishGesture(event, true)}
                      onLostPointerCapture={() => cancelGesture(element.id)}
                      ref={(handle) => {
                        if (handle) moveHandleRefs.current.set(element.id, handle);
                        else moveHandleRefs.current.delete(element.id);
                      }}
                      type="button"
                    >
                      ⠿
                    </button>
                  ) : null}
                  {editing ? (
                    element.role === "title" ? (
                      <AutosizingTextarea
                        aria-label="Slide title"
                        className={styles.titleInput}
                        lang={element.text.trim() ? (contentLocale ?? "") : "en-CA"}
                        maxLength={160}
                        onChange={(event) => onChangeElement?.(element.id, event.target.value)}
                        onFocus={() => onSelectElement?.(element.id)}
                        placeholder={titlePlaceholder}
                        rows={2}
                        value={element.text}
                      />
                    ) : (
                      <AutosizingTextarea
                        aria-label={label}
                        className={styles.bodyInput}
                        lang={element.text.trim() ? (contentLocale ?? "") : "en-CA"}
                        maxLength={4_000}
                        onChange={(event) => onChangeElement?.(element.id, event.target.value)}
                        onFocus={() => onSelectElement?.(element.id)}
                        placeholder={bodyPlaceholder}
                        rows={3}
                        value={element.text}
                      />
                    )
                  ) : element.role === "title" ? (
                    <h1 lang={element.text ? (contentLocale ?? "") : "en-CA"} tabIndex={0}>
                      {element.text || (variant === "preview" ? "Untitled slide" : "")}
                    </h1>
                  ) : element.text ? (
                    <p lang={contentLocale ?? ""} tabIndex={0}>
                      {element.text}
                    </p>
                  ) : null}
                  {editing && overlapIds.has(element.id) ? (
                    <span
                      className={styles.overlapWarning}
                      role="status"
                      aria-label="Frame overlaps another text box"
                      title="This frame overlaps another text box. Move or resize it to separate the text."
                    >
                      Overlap
                    </span>
                  ) : null}
                  {editing && selected && onChangeFrame ? (
                    <button
                      aria-label={`Resize ${label}. Use arrow keys to change width and height.`}
                      className={styles.resizeHandle}
                      onKeyDown={(event) => handleFrameKeyDown(event, element, "resize")}
                      onPointerCancel={(event) => finishGesture(event, false)}
                      onPointerDown={(event) => startGesture(event, element, "resize")}
                      onPointerMove={updateGestureFrame}
                      onPointerUp={(event) => finishGesture(event, true)}
                      onLostPointerCapture={() => cancelGesture(element.id)}
                      ref={(handle) => {
                        if (handle) resizeHandleRefs.current.set(element.id, handle);
                        else resizeHandleRefs.current.delete(element.id);
                      }}
                      type="button"
                    >
                      <span aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {hasMedia && media ? (
        <div
          className={styles.media}
          data-media-frame={JSON.stringify(contentSlideMediaFrame)}
          style={elementFrameStyle(contentSlideMediaFrame)}
        >
          {media}
        </div>
      ) : null}
      {editing && showGuides && hasMedia ? (
        <div
          aria-hidden="true"
          className={styles.mediaBayGuide}
          data-media-bay="true"
          style={elementFrameStyle(contentSlideMediaFrame)}
        >
          <span>Image area</span>
        </div>
      ) : null}
    </article>
  );
}
