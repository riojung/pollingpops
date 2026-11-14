"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { type PresentationScene, type SupportedLocale } from "@openround/contracts";
import {
  moveNativeSceneNodes,
  resizeNativeSceneNode,
  resizeNativeSceneSelection,
  snapNativeSceneMove,
  type NativeSceneResizeHandle,
  type NativeSnapGuide,
} from "../../lib/presentation-native-geometry";
import { NativeSceneView, type SceneImageRenderer } from "./native-scene-view";
import styles from "./native-scene.module.css";
import { NativeSceneFitFeedback } from "./native-scene-fit-feedback";
import { NativeSceneSelectionControls } from "./native-scene-selection-controls";
import { NativeSceneInteractionMap } from "./native-scene-interaction-map";
import { NativeSceneInteractionCues } from "./native-scene-interaction-cues";

type Gesture = {
  base: PresentationScene;
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  id: string;
  ids: readonly string[];
  resize: boolean;
  resizeHandle?: NativeSceneResizeHandle;
  preview: PresentationScene;
};

/** Pointer previews are local; only a completed gesture enters draft history and autosave. */
export function NativeSceneCanvas({
  scene,
  locale = "en-CA",
  canEdit = true,
  renderImage,
  selectedNodeIds,
  onSelect,
  onChange,
  navigationTargets,
  onEditInteraction,
}: {
  scene: PresentationScene;
  locale?: SupportedLocale;
  canEdit?: boolean;
  renderImage: SceneImageRenderer;
  selectedNodeIds: readonly string[];
  onSelect: (id: string, additive?: boolean) => void;
  onChange: (scene: PresentationScene) => void;
  navigationTargets?: readonly { id: string; title: string }[];
  onEditInteraction?: (id: string) => void;
}) {
  const permission = useRef(canEdit);
  permission.current = canEdit;
  const source = useRef(scene);
  source.current = scene;
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [interactionMapOpen, setInteractionMapOpen] = useState(false);
  const [preview, setPreview] = useState<{
    base: PresentationScene;
    scene: PresentationScene;
    guides: NativeSnapGuide[];
  } | null>(null);
  const displayedScene = canEdit && preview?.base === scene ? preview.scene : scene;

  function release(active: Gesture) {
    if (root.current?.hasPointerCapture(active.pointerId)) {
      root.current.releasePointerCapture(active.pointerId);
    }
  }
  function cancel() {
    const active = gesture.current;
    gesture.current = null;
    setPreview(null);
    if (active) release(active);
  }
  useEffect(() => {
    // Undo, another edit, recovered drafts and remote updates invalidate the snapshot.
    const active = gesture.current;
    if (active && (!canEdit || active.base !== scene)) {
      gesture.current = null;
      setPreview(null);
      if (root.current?.hasPointerCapture(active.pointerId)) {
        root.current.releasePointerCapture(active.pointerId);
      }
    }
  }, [canEdit, scene]);
  useEffect(
    () => () => {
      const active = gesture.current;
      gesture.current = null;
      if (active && root.current?.hasPointerCapture(active.pointerId)) {
        root.current.releasePointerCapture(active.pointerId);
      }
    },
    [],
  );

  function start(
    event: PointerEvent<HTMLElement>,
    id: string,
    resize: boolean,
    handle: boolean,
    resizeHandle?: NativeSceneResizeHandle,
  ) {
    if (!event.isPrimary || event.button !== 0 || gesture.current || scene !== source.current)
      return;
    if (event.shiftKey) {
      event.preventDefault();
      onSelect(id, true);
      return;
    }
    const ids = selectedNodeIds.includes(id) ? selectedNodeIds : [id];
    if (!selectedNodeIds.includes(id)) onSelect(id);
    if (!permission.current) return;
    if (!handle && typeof Element !== "undefined" && event.target instanceof Element) {
      // Object chrome can move, while links, form controls and scrollbars
      // retain their native behavior. Resize handles are siblings above this content.
      if (event.target.closest("a, button, input, textarea, select, [contenteditable='true']"))
        return;
      let target: Element | null = event.target;
      while (target && target !== event.currentTarget) {
        if (
          target instanceof HTMLElement &&
          (target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth) &&
          /(auto|scroll)/.test(
            `${window.getComputedStyle(target).overflowX} ${window.getComputedStyle(target).overflowY}`,
          )
        )
          return;
        target = target.parentElement;
      }
    }
    // The narrow layout is a semantic list, not a scaled coordinate plane. Touch can scroll
    // content normally; only explicit handles opt into a touch gesture on the wide stage.
    if (
      window.matchMedia("(max-width: 700px)").matches ||
      (event.pointerType === "touch" && !handle)
    )
      return;
    const stage = root.current?.querySelector<HTMLElement>("[data-native-scene]");
    const bounds = stage?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !root.current) return;
    event.preventDefault();
    if (event.currentTarget instanceof HTMLButtonElement) {
      event.currentTarget.focus({ preventScroll: true });
    } else {
      root.current.focus({ preventScroll: true });
    }
    gesture.current = {
      base: scene,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
      id,
      ids,
      resize,
      resizeHandle,
      preview: scene,
    };
    root.current.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (
      !permission.current ||
      !active ||
      event.pointerId !== active.pointerId ||
      active.base !== source.current
    )
      return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) < 2 && active.preview === active.base) return;
    const snapped =
      !active.resize && !event.altKey
        ? snapNativeSceneMove(
            active.base,
            active.ids,
            (dx / active.width) * 100,
            (dy / active.height) * 100,
            active.width,
            active.height,
          )
        : null;
    active.preview =
      snapped?.scene ??
      (active.resize
        ? active.resizeHandle
          ? resizeNativeSceneSelection(
              active.base,
              active.ids,
              active.resizeHandle,
              (dx / active.width) * 100,
              (dy / active.height) * 100,
            )
          : resizeNativeSceneNode(
              active.base,
              active.id,
              (dx / active.width) * 100,
              (dy / active.height) * 100,
            )
        : moveNativeSceneNodes(
            active.base,
            active.ids,
            (dx / active.width) * 100,
            (dy / active.height) * 100,
          ));
    setPreview({ base: active.base, scene: active.preview, guides: snapped?.guides ?? [] });
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!permission.current) {
      cancel();
      return;
    }
    // Include the release position even when the browser coalesces the final move event.
    move(event);
    gesture.current = null;
    setPreview(null);
    release(active);
    if (active.base === source.current && active.preview !== source.current)
      onChange(active.preview);
  }
  function geometryKey(
    id: string,
    dx: number,
    dy: number,
    resize: boolean,
    resizeHandle?: NativeSceneResizeHandle,
  ) {
    cancel();
    if (!permission.current || scene !== source.current) return;
    const ids = selectedNodeIds.includes(id) ? selectedNodeIds : [id];
    if (!selectedNodeIds.includes(id)) onSelect(id);
    const next = resize
      ? resizeHandle
        ? resizeNativeSceneSelection(scene, ids, resizeHandle, dx, dy)
        : resizeNativeSceneNode(scene, id, dx, dy)
      : moveNativeSceneNodes(scene, ids, dx, dy);
    if (next !== scene) onChange(next);
  }
  return (
    <div
      ref={root}
      tabIndex={-1}
      className={styles.canvas}
      data-native-scene-canvas="true"
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={(event) => {
        if (event.pointerId === gesture.current?.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === gesture.current?.pointerId) cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && gesture.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <NativeSceneSelectionControls
        disabled={!canEdit}
        scene={scene}
        selectedNodeIds={selectedNodeIds}
        onSelect={(id) => {
          cancel();
          onSelect(id);
        }}
        onPointerDown={start}
        onGeometryKey={geometryKey}
      />
      <NativeSceneInteractionMap
        locale={locale}
        scene={displayedScene}
        navigationTargets={navigationTargets}
        selectedNodeIds={selectedNodeIds}
        expanded={interactionMapOpen}
        onExpandedChange={(expanded) => {
          cancel();
          setInteractionMapOpen(expanded);
        }}
        onSelect={(id) => {
          cancel();
          onSelect(id);
        }}
        onEdit={
          onEditInteraction
            ? (id) => {
                cancel();
                onEditInteraction(id);
              }
            : undefined
        }
      />
      <div className={styles.canvasSurface}>
        <NativeSceneView
          locale={locale}
          scene={displayedScene}
          renderImage={renderImage}
          selectedNodeIds={selectedNodeIds}
          hideGeometryControls
          showSelectionHandles={canEdit}
          onSelect={onSelect}
          onNodePointerDown={start}
          onGeometryKey={geometryKey}
          editorOverlay={
            interactionMapOpen ? (
              <NativeSceneInteractionCues
                scene={displayedScene}
                selectedNodeIds={selectedNodeIds}
              />
            ) : undefined
          }
        />
        {canEdit && preview?.base === scene && preview.guides.length ? (
          <svg
            className={styles.snapGuides}
            viewBox="0 0 1600 900"
            preserveAspectRatio="none"
            aria-hidden="true"
            data-native-snap-guides="true"
          >
            {preview.guides.map((guide) => (
              <line
                key={guide.axis}
                x1={guide.axis === "x" ? guide.position * 16 : 0}
                x2={guide.axis === "x" ? guide.position * 16 : 1600}
                y1={guide.axis === "y" ? guide.position * 9 : 0}
                y2={guide.axis === "y" ? guide.position * 9 : 900}
              />
            ))}
          </svg>
        ) : null}
      </div>
      <NativeSceneFitFeedback root={root} scene={displayedScene} />
    </div>
  );
}
