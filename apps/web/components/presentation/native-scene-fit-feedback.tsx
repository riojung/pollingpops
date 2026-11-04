"use client";

import { useEffect, useState, type RefObject } from "react";
import { type PresentationScene } from "@openround/contracts";
import { nativeNodeLabel } from "../../lib/presentation-native-scene";
import styles from "./native-scene.module.css";

const INITIAL_FEEDBACK =
  "Check text fit after changing a layout or design. Text that exceeds a wide slide frame remains scrollable. Narrow screens show full text and uncropped images in reading order.";

/** Measure actual rendered fonts and available space rather than estimating from character counts. */
export function NativeSceneFitFeedback({
  root,
  scene,
}: {
  root: RefObject<HTMLDivElement | null>;
  scene: PresentationScene;
}) {
  const [feedback, setFeedback] = useState(INITIAL_FEEDBACK);
  useEffect(() => {
    const stage = root.current?.querySelector<HTMLElement>("[data-native-scene]");
    if (!stage) return;
    function check() {
      if (!stage || stage.clientWidth === 0) return;
      const overflowing = Array.from(
        stage.querySelectorAll<HTMLElement>('[data-node-type="text"]'),
      ).filter((node) => {
        const content = node.firstElementChild as HTMLElement | null;
        return (
          content &&
          (content.scrollHeight > content.clientHeight + 1 ||
            content.scrollWidth > content.clientWidth + 1)
        );
      });
      const labels = overflowing.map((node) => {
        const model = scene.nodes.find((item) => item.id === node.dataset.nodeId);
        return model ? nativeNodeLabel(model) : "Text object";
      });
      setFeedback(
        labels.length
          ? `Fit check: ${labels.join(", ")} ${labels.length === 1 ? "exceeds its frame" : "exceed their frames"}. Enlarge text frames, change the layout or reduce text. Full text remains scrollable; narrow screens show all content.`
          : "Fit check: All text fits the current preview. Check again after changing text, fonts or layout. Narrow screens show full text and uncropped images in reading order.",
      );
    }
    check();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(stage);
    stage.querySelectorAll('[data-node-type="text"]').forEach((node) => observer?.observe(node));
    return () => observer?.disconnect();
  }, [root, scene]);
  return (
    <p
      role="status"
      className={`${styles.help} ${styles.fitFeedback}`}
      data-native-fit-feedback="true"
    >
      {feedback}
    </p>
  );
}
