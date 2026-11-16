"use client";

import { useEffect, useState, type RefObject } from "react";
import {
  type PresentationScene,
  type PresentationSceneNode,
  type SupportedLocale,
} from "@openround/contracts";
import { useLocale } from "../locale-provider";
import {
  nativeControlNodeLabel,
  nativeControlsCopy,
  type NativeControlsCopyKey,
} from "./native-controls-copy";
import styles from "./native-scene.module.css";

const INITIAL_FEEDBACK =
  "Check text fit after changing a layout or design. Text that exceeds a wide slide frame remains scrollable. Narrow screens show full text and uncropped images in reading order.";
const WAITING_FOR_FONTS =
  "Fit check is waiting for slide fonts. Review the complete content while the preview loads.";
const READING_FEEDBACK =
  "Reading view shows complete content in reading order. Wide slide fit cannot be checked in this stacked view; use a wide layout preview to check frames.";

export type NativeFitFeedback =
  NativeControlsCopyKey | { nodes: (PresentationSceneNode | null)[]; data: boolean };

/** Feedback stays language-neutral so changing locale never remeasures or changes the draft. */
export function nativeFitFeedbackText(locale: SupportedLocale, feedback: NativeFitFeedback) {
  const copy = nativeControlsCopy(locale);
  if (typeof feedback === "string") return copy(feedback);
  const names = feedback.nodes
    .map((node) => (node ? nativeControlNodeLabel(locale, node).text : copy("Text object")))
    .join(", ");
  return copy("Fit check: {message}", {
    message:
      copy(
        feedback.nodes.length === 1 ? "{names} exceeds its frame." : "{names} exceed their frames.",
        { names },
      ) +
      " " +
      copy(
        feedback.data
          ? "Enlarge object frames, change the layout or reduce content. Full text remains scrollable; data tables remain scrollable too; narrow screens show all content."
          : "Enlarge text frames, change the layout or reduce text. Full text remains scrollable; narrow screens show all content.",
      ),
  });
}

function Feedback({ locale, feedback }: { locale: SupportedLocale; feedback: NativeFitFeedback }) {
  const copy = nativeControlsCopy(locale);
  if (typeof feedback === "string") return copy(feedback);
  const marker = "__NATIVE_NAMES__";
  // Keep authored labels outside the application language boundary without altering them.
  const namesTemplate = copy("Fit check: {message}", {
    message: copy(
      feedback.nodes.length === 1 ? "{names} exceeds its frame." : "{names} exceed their frames.",
      { names: marker },
    ),
  });
  const [before, after] = namesTemplate.split(marker);
  return (
    <>
      {before}
      {feedback.nodes.map((node, index) => {
        const label = node
          ? nativeControlNodeLabel(locale, node)
          : { text: copy("Text object"), language: locale };
        return (
          <span key={node?.id ?? index} lang={label.language}>
            {index ? ", " : ""}
            {label.text}
          </span>
        );
      })}
      {after}{" "}
      {copy(
        feedback.data
          ? "Enlarge object frames, change the layout or reduce content. Full text remains scrollable; data tables remain scrollable too; narrow screens show all content."
          : "Enlarge text frames, change the layout or reduce text. Full text remains scrollable; narrow screens show all content.",
      )}
    </>
  );
}

/** Measure the wide rendered plane after fonts load; semantic reading views cannot prove fit. */
export function NativeSceneFitFeedback({
  root,
  scene,
  locale: selectedLocale,
}: {
  root: RefObject<HTMLDivElement | null>;
  scene: PresentationScene;
  locale?: SupportedLocale;
}) {
  const { locale: contextLocale } = useLocale();
  const locale = selectedLocale ?? contextLocale;
  const [feedback, setFeedback] = useState<NativeFitFeedback>(INITIAL_FEEDBACK);
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
        stage.dataset?.nativeOutline === "true" ||
        (stage.dataset?.nativeFixedLayout !== "true" &&
          ownerWindow?.matchMedia?.("(max-width: 700px)").matches)
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
      setFeedback(
        overflowing.length
          ? {
              nodes: overflowing.map(
                (node) => scene.nodes.find((item) => item.id === node.dataset.nodeId) ?? null,
              ),
              data,
            }
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
      lang={locale}
      className={`${styles.help} ${styles.fitFeedback}`}
      data-native-fit-feedback="true"
    >
      <Feedback locale={locale} feedback={feedback} />
    </p>
  );
}
