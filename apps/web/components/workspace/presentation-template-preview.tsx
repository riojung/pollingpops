"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentSlideDraft, PresentationDraft, SupportedLocale } from "@openround/contracts";
import {
  isNativePresentationTemplateId,
  nativePresentationTemplateThumbnail,
} from "../../lib/presentation-native-templates";
import {
  allPresentationTemplates,
  presentationTemplateForLocale,
  type PresentationTemplateId,
} from "../../lib/presentation-templates";
import { useLocale } from "../locale-provider";
import { presentationTemplateCopy } from "../../lib/i18n/presentation-template-copy";
import { formatNumber } from "../../lib/i18n/format";
import { ContentSlideView } from "../presentation/content-slide-view";
import styles from "./presentation-template-preview.module.css";

function templateThumbnail(
  templateId: PresentationTemplateId,
  locale: SupportedLocale,
): ContentSlideDraft | undefined {
  if (isNativePresentationTemplateId(templateId))
    return nativePresentationTemplateThumbnail(templateId, locale);
  const template = presentationTemplateForLocale(templateId, locale);
  const templateIndex = allPresentationTemplates.findIndex((entry) => entry.id === templateId);
  const opening = template.blocks.find((block) => block.kind === "content");
  if (!opening || opening.kind !== "content") return undefined;
  // Thumbnail IDs are stable across server rendering and hydration. The first
  // content slide uses the same title/body layout as the instantiated template.
  const id = (offset: number) =>
    `00000000-0000-4000-8000-${((templateIndex + 1) * 100 + offset).toString(16).padStart(12, "0")}`;
  return {
    id: id(0),
    kind: "content",
    layout: "title_body",
    textElements: [
      { id: id(1), role: "title", text: opening.title, region: "middle_center", order: 0 },
      { id: id(2), role: "body", text: opening.body, region: "middle_center", order: 1 },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: opening.notes,
  };
}

/** A real shared-renderer first slide, scaled to a stable thumbnail size. */
export function PresentationTemplateThumbnail({
  templateId,
  locale = "en-CA",
}: {
  templateId: PresentationTemplateId;
  locale?: SupportedLocale;
}) {
  const block = useMemo(() => templateThumbnail(templateId, locale), [templateId, locale]);
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
      inert
      data-template-thumbnail={templateId}
      data-native-template-thumbnail={
        isNativePresentationTemplateId(templateId) ? templateId : undefined
      }
    >
      <div className={styles.thumbnailScene} style={{ transform: `scale(${width / 960})` }}>
        {block ? (
          <ContentSlideView
            block={block}
            contentLocale={locale}
            variant="preview"
            staticThumbnail
          />
        ) : null}
      </div>
    </div>
  );
}

export function PresentationTemplateSlide({
  block,
  contentLocale = "en-CA",
}: {
  block: PresentationDraft["blocks"][number];
  contentLocale?: SupportedLocale;
}) {
  const { locale } = useLocale();
  const copy = presentationTemplateCopy(locale);
  if (block.kind === "content")
    return <ContentSlideView block={block} contentLocale={contentLocale} variant="preview" />;
  return (
    <article className={styles.activity} lang={contentLocale}>
      <p lang={locale}>{copy("Audience activity")}</p>
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
  contentLocale = "en-CA",
  onClose,
}: {
  draft: PresentationDraft;
  contentLocale?: SupportedLocale;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const copy = presentationTemplateCopy(locale);
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
      aria-label={copy("Presentation template preview")}
      lang={locale}
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
          <h2 lang={contentLocale}>{draft.title}</h2>
          <p>{copy("Read-only template preview. Example information is illustrative.")}</p>
        </div>
        <button type="button" className="button-quiet" onClick={onClose}>
          {copy("Close preview")}
        </button>
      </header>
      <div className={styles.controls}>
        <button
          type="button"
          className="button-quiet"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          {copy("Previous slide")}
        </button>
        <p role="status">
          {copy("Slide {number} of {count}", {
            number: formatNumber(locale, index + 1),
            count: formatNumber(locale, draft.blocks.length),
          })}
        </p>
        <button
          type="button"
          className="button-quiet"
          disabled={index >= draft.blocks.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          {copy("Next slide")}
        </button>
      </div>
      <div className={styles.stage} data-template-preview-slide={index + 1} lang={contentLocale}>
        {block ? <PresentationTemplateSlide block={block} contentLocale={contentLocale} /> : null}
      </div>
      <p className={styles.keyboard}>
        {copy(
          "Use Left and Right arrow keys, Home or End to navigate. Escape closes the preview. When a table or chart has focus, these keys scroll its data; use the slide buttons to navigate.",
        )}
      </p>
    </dialog>
  );
}
