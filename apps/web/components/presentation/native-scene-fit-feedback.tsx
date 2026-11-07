"use client";

import { useEffect, useState, type RefObject } from "react";
import { type PresentationScene } from "@openround/contracts";
import { nativeNodeLabel } from "../../lib/presentation-native-scene";
import styles from "./native-scene.module.css";

const INITIAL_FEEDBACK =
  "Check text fit after changing a layout or design. Text that exceeds a wide slide frame remains scrollable. Narrow screens show full text and uncropped images in reading order.";
const WAITING_FOR_FONTS =
  "Fit check is waiting for slide fonts. Review the complete content while the preview loads.";
const READING_FEEDBACK =
  "Reading view shows complete content in reading order. Wide slide fit cannot be checked in this stacked view; use a wide layout preview to check frames.";

/** Measure the wide rendered plane after fonts load; semantic reading views cannot prove fit. */
export function NativeSceneFitFeedback({
  root,
  scene,
}: {
  root: RefObject<HTMLDivElement | null>;
  scene: PresentationScene;
}) {
  const [feedback, setFeedback] = useState(INITIAL_FEEDBACK);
  useEffect(() => {
    let active = true;
    setFeedback(INITIAL_FEEDBACK);
    const stage = root.current?.querySelector<HTMLElement>("[data-native-scene]");
    if (!stage) return;
    const ownerWindow = stage.ownerDocument?.defaultView;
    const fonts = stage.ownerDocument?.fonts;
    function check() {
      if (!active || !stage) return;
      if (
        stage.dataset?.nativeFixedLayout !== "true" &&
        ownerWindow?.matchMedia?.("(max-width: 700px)").matches
      ) {
        setFeedback(READING_FEEDBACK);
        return;
      }
      if (stage.clientWidth === 0) {
        setFeedback(INITIAL_FEEDBACK);
        return;
      }
      if (fonts?.status === "loading") {
        setFeedback(WAITING_FOR_FONTS);
        return;
      }
      const data = scene.nodes.some((node) => node.type === "table" || node.type === "chart");
      const selector =
        '[data-node-type="text"], [data-node-type="table"], [data-node-type="chart"]';
      const nodes = Array.from(stage.querySelectorAll<HTMLElement>(selector));
      if (
        !nodes.length ||
        nodes.some((node) => {
          const content = node.firstElementChild as HTMLElement | null;
          return !content || content.clientHeight === 0 || content.clientWidth === 0;
        })
      ) {
        setFeedback(INITIAL_FEEDBACK);
        return;
      }
      const overflowing = nodes.filter((node) => {
        const content = node.firstElementChild as HTMLElement;
        return (
          content.scrollHeight > content.clientHeight + 1 ||
          content.scrollWidth > content.clientWidth + 1
        );
      });
      const labels = overflowing.map((node) => {
        const model = scene.nodes.find((item) => item.id === node.dataset.nodeId);
        return model ? nativeNodeLabel(model) : "Text object";
      });
      setFeedback(
        labels.length
          ? `Fit check: ${labels.join(", ")} ${labels.length === 1 ? "exceeds its frame" : "exceed their frames"}. Enlarge ${data ? "object" : "text"} frames, change the layout or reduce ${data ? "content" : "text"}. Full text remains scrollable${data ? "; data tables remain scrollable too" : ""}; narrow screens show all content.`
          : data
            ? "Fit check: Text and data fit the current preview. Check again after changing content, fonts or layout. Narrow screens show complete data in reading order."
            : "Fit check: All text fits the current preview. Check again after changing text, fonts or layout. Narrow screens show full text and uncropped images in reading order.",
      );
    }
    check();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(stage);
    stage
      .querySelectorAll(
        '[data-node-type="text"], [data-node-type="table"], [data-node-type="chart"]',
      )
      .forEach((node) => observer?.observe(node));
    ownerWindow?.addEventListener("resize", check);
    fonts?.addEventListener("loading", check);
    fonts?.addEventListener("loadingdone", check);
    fonts?.addEventListener("loadingerror", check);
    void fonts?.ready.then(check);
    const frame = ownerWindow?.requestAnimationFrame(check);
    return () => {
      active = false;
      observer?.disconnect();
      ownerWindow?.removeEventListener("resize", check);
      fonts?.removeEventListener("loading", check);
      fonts?.removeEventListener("loadingdone", check);
      fonts?.removeEventListener("loadingerror", check);
      if (frame !== undefined) ownerWindow?.cancelAnimationFrame(frame);
    };
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
