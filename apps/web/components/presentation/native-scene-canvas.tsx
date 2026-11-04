"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { type PresentationScene } from "@openround/contracts";
import {
  moveNativeSceneNodes,
  resizeNativeSceneNode,
} from "../../lib/presentation-native-geometry";
import { NativeSceneView, type SceneImageRenderer } from "./native-scene-view";
import styles from "./native-scene.module.css";
import { NativeSceneFitFeedback } from "./native-scene-fit-feedback";

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
  preview: PresentationScene;
};

/** Pointer previews are local; only a completed gesture enters draft history and autosave. */
export function NativeSceneCanvas({
  scene,
  renderImage,
  selectedNodeIds,
  onSelect,
  onChange,
}: {
  scene: PresentationScene;
  renderImage: SceneImageRenderer;
  selectedNodeIds: readonly string[];
  onSelect: (id: string, additive?: boolean) => void;
  onChange: (scene: PresentationScene) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{
    base: PresentationScene;
    scene: PresentationScene;
  } | null>(null);

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
    if (active && active.base !== scene) {
      gesture.current = null;
      setPreview(null);
      if (root.current?.hasPointerCapture(active.pointerId)) {
        root.current.releasePointerCapture(active.pointerId);
      }
    }
  }, [scene]);
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

  function start(event: PointerEvent<HTMLElement>, id: string, resize: boolean, handle: boolean) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    if (event.shiftKey) {
      event.preventDefault();
      onSelect(id, true);
      return;
    }
    const ids = selectedNodeIds.includes(id) ? selectedNodeIds : [id];
    if (!selectedNodeIds.includes(id)) onSelect(id);
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
      preview: scene,
    };
    root.current.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId || active.base !== scene) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) < 2 && active.preview === active.base) return;
    active.preview = active.resize
      ? resizeNativeSceneNode(
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
        );
    setPreview({ base: active.base, scene: active.preview });
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    // Include the release position even when the browser coalesces the final move event.
    move(event);
    gesture.current = null;
    setPreview(null);
    release(active);
    if (active.base === scene && active.preview !== scene) onChange(active.preview);
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
      <NativeSceneView
        scene={preview?.base === scene ? preview.scene : scene}
        renderImage={renderImage}
        selectedNodeIds={selectedNodeIds}
        onSelect={onSelect}
        onNodePointerDown={start}
        onGeometryKey={(id, dx, dy, resize) => {
          cancel();
          const ids = selectedNodeIds.includes(id) ? selectedNodeIds : [id];
          if (!selectedNodeIds.includes(id)) onSelect(id);
          const next = resize
            ? resizeNativeSceneNode(scene, id, dx, dy)
            : moveNativeSceneNodes(scene, ids, dx, dy);
          if (next !== scene) onChange(next);
        }}
      />
      <NativeSceneFitFeedback root={root} scene={preview?.base === scene ? preview.scene : scene} />
    </div>
  );
}
