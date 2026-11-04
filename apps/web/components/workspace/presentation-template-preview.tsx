"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PresentationDraft } from "@openround/contracts";
import {
  nativePresentationTemplateThumbnail,
  type NativePresentationTemplateId,
} from "../../lib/presentation-native-templates";
import { ContentSlideView } from "../presentation/content-slide-view";
import styles from "./presentation-template-preview.module.css";

/** A real shared-renderer first slide, scaled to a stable thumbnail size. */
export function NativePresentationTemplateThumbnail({
  templateId,
}: {
  templateId: NativePresentationTemplateId;
}) {
  const block = useMemo(() => nativePresentationTemplateThumbnail(templateId), [templateId]);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={container}
      className={styles.thumbnail}
      aria-hidden="true"
      data-native-template-thumbnail={templateId}
    >
      <div className={styles.thumbnailScene} style={{ transform: `scale(${width / 960})` }}>
        <ContentSlideView block={block} variant="preview" />
      </div>
    </div>
  );
}

export function PresentationTemplateSlide({
  block,
}: {
  block: PresentationDraft["blocks"][number];
}) {
  if (block.kind === "content") return <ContentSlideView block={block} variant="preview" />;
  return (
    <article className={styles.activity}>
      <p>Audience activity</p>
      <h1>{block.question.prompt}</h1>
      {"choices" in block.question ? (
        <ul>
          {block.question.choices.map((choice) => (
            <li key={choice.id}>{choice.label}</li>
          ))}
        </ul>
      ) : block.question.type === "rating" ? (
        <p>
          {block.question.minLabel} ({block.question.min}) — {block.question.maxLabel} (
          {block.question.max})
        </p>
      ) : null}
    </article>
  );
}

export function PresentationTemplatePreview({
  draft,
  onClose,
}: {
  draft: PresentationDraft;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const block = draft.blocks[index];
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Presentation template preview"
      lang="en-CA"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("a,input,textarea,select,summary,[contenteditable='true']")) return;
        const next =
          event.key === "ArrowRight"
            ? Math.min(draft.blocks.length - 1, index + 1)
            : event.key === "ArrowLeft"
              ? Math.max(0, index - 1)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? draft.blocks.length - 1
                  : null;
        if (next === null) return;
        event.preventDefault();
        setIndex(next);
      }}
    >
      <header className={styles.header}>
        <div>
          <h2>{draft.title}</h2>
          <p>Read-only template preview. Example information is illustrative.</p>
        </div>
        <button type="button" className="button-quiet" onClick={onClose}>
          Close preview
        </button>
      </header>
      <div className={styles.controls}>
        <button
          type="button"
          className="button-quiet"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          Previous slide
        </button>
        <p role="status">
          Slide {index + 1} of {draft.blocks.length}
        </p>
        <button
          type="button"
          className="button-quiet"
          disabled={index >= draft.blocks.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          Next slide
        </button>
      </div>
      <div className={styles.stage} data-template-preview-slide={index + 1}>
        {block ? <PresentationTemplateSlide block={block} /> : null}
      </div>
      <p className={styles.keyboard}>
        Use Left and Right arrow keys, Home or End to navigate. Escape closes the preview. When a
        table or chart has focus, these keys scroll its data; use the slide buttons to navigate.
      </p>
    </dialog>
  );
}
