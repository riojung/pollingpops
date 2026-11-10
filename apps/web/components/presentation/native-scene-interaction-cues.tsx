"use client";

import type { PresentationScene, PresentationSceneFrame } from "@openround/contracts";
import { nativeInteractionMapItems } from "../../lib/presentation-native-interaction-map";
import styles from "./native-scene-interaction-cues.module.css";

function outline(frame: PresentationSceneFrame, rotation = 0) {
  const x = frame.x * 16;
  const y = frame.y * 9;
  const width = frame.width * 16;
  const height = frame.height * 9;
  return {
    x,
    y,
    width,
    height,
    transform: rotation ? `rotate(${rotation} ${x + width / 2} ${y + height / 2})` : undefined,
  };
}

function connectionPath(trigger: PresentationSceneFrame, image: PresentationSceneFrame) {
  const center = { x: trigger.x + trigger.width / 2, y: trigger.y + trigger.height / 2 };
  const target = { x: image.x + image.width, y: image.y };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  // Start on the trigger boundary, keeping the connection clear of its label and content.
  const scale = Math.min(trigger.width / 2 / Math.abs(dx), trigger.height / 2 / Math.abs(dy));
  const source = { x: center.x + dx * scale, y: center.y + dy * scale };
  return `M${source.x * 16} ${source.y * 9} L${target.x * 16} ${target.y * 9}`;
}

/** Passive editor annotations. All controls and equivalent descriptions live outside the slide. */
export function NativeSceneInteractionCues({
  scene,
  selectedNodeIds,
}: {
  scene: PresentationScene;
  selectedNodeIds: readonly string[];
}) {
  const items = nativeInteractionMapItems(scene);
  if (!items.length) return null;
  const selected = items.find(({ node }) => node.id === selectedNodeIds.at(-1));
  const image = selected?.imageTarget;
  return (
    <svg
      className={styles.overlay}
      viewBox="0 0 1600 900"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-native-interaction-cues="true"
      style={{ zIndex: scene.nodes.length + 2 }}
    >
      {image ? (
        <>
          <rect
            {...outline(image.frame, image.rotation)}
            className={styles.image}
            data-interaction-cue-image={image.id}
          />
          <path
            className={styles.connection}
            d={connectionPath(selected!.node.frame, image.frame)}
            data-interaction-cue-connection="true"
          />
        </>
      ) : null}
      {items.map(({ node }) => (
        <rect
          key={node.id}
          {...outline(node.frame, node.rotation)}
          className={styles.action}
          data-interaction-cue-node={node.id}
          data-selected={node.id === selected?.node.id ? "true" : undefined}
        />
      ))}
    </svg>
  );
}
