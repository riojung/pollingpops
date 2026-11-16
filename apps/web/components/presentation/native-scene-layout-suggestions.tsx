"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PresentationScene, SupportedLocale } from "@openround/contracts";
import {
  nativeLayoutSuggestionAvailability,
  suggestNativeLayouts,
  type NativeLayoutSuggestion,
} from "../../lib/presentation-layout-suggestions";
import { NativeSceneView } from "./native-scene-view";
import { NativeSceneFitFeedback } from "./native-scene-fit-feedback";
import { NativeRichTextView } from "./native-rich-text-view";
import { NativeSceneDataView } from "./native-scene-data-view";
import {
  isLayoutAssistanceCopyKey,
  layoutAssistanceCopy,
  layoutAssistanceSystemMessage,
} from "./layout-assistance-copy";
import styles from "./native-scene-layout-suggestions.module.css";

interface Props {
  scene: PresentationScene;
  onChange: (scene: PresentationScene, historyField?: string) => boolean | void;
  disabled?: boolean;
  sourceKey?: string;
  locale?: SupportedLocale;
}
interface Review {
  source: PresentationScene;
  fingerprint: string;
  sourceKey: string | undefined;
  snapshot: PresentationScene;
  suggestions: NativeLayoutSuggestion[];
  selectedId: string;
}
const PLANE_WIDTH = 1280;
const PLANE_HEIGHT = 720;

function LayoutPreview({
  scene,
  kind,
  locale,
}: {
  scene: PresentationScene;
  kind: "current" | "selected";
  locale: SupportedLocale;
}) {
  const copy = layoutAssistanceCopy(locale);
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    const measure = () => {
      if (target.clientWidth > 0) setScale(Math.min(1, target.clientWidth / PLANE_WIDTH));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(target);
    const owner = target.ownerDocument.defaultView;
    owner?.addEventListener("resize", measure);
    const frame = owner?.requestAnimationFrame(measure);
    return () => {
      observer?.disconnect();
      owner?.removeEventListener("resize", measure);
      if (frame !== undefined) owner?.cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <section
      aria-label={copy(kind === "current" ? "Current layout preview" : "Selected layout preview")}
      lang={locale}
      className={styles.preview}
      data-layout-preview={kind}
    >
      <h3>{copy(kind === "current" ? "Current layout" : "Selected layout")}</h3>
      <div ref={root}>
        <div ref={viewport} className={styles.viewport} aria-hidden="true" inert>
          <div
            className={styles.plane}
            data-layout-plane="true"
            style={{ width: PLANE_WIDTH, height: PLANE_HEIGHT, transform: `scale(${scale})` }}
          >
            <NativeSceneView scene={scene} fixedLayout motionStatic locale={locale} />
          </div>
        </div>
        <NativeSceneFitFeedback root={root} scene={scene} locale={locale} />
      </div>
    </section>
  );
}

/** A complete, unscaled reading copy accompanies the decorative geometry previews. */
export function NativeLayoutReadingContent({
  scene,
  locale = "en-CA",
}: {
  scene: PresentationScene;
  locale?: SupportedLocale;
}) {
  const copy = layoutAssistanceCopy(locale);
  return (
    <section aria-label={copy("Complete slide content")} lang={locale} className={styles.reading}>
      <h3>{copy("Complete slide content")}</h3>
      <p>{copy("The wording, data and reading order are the same in every alternative.")}</p>
      {scene.readingOrder.map((id) => {
        const node = scene.nodes.find((candidate) => candidate.id === id);
        if (node?.type === "text")
          return (
            <div key={id} className={styles.readingText} data-layout-reading-node={id}>
              <h4>{copy(node.role === "title" ? "Title" : "Body text")}</h4>
              {node.richText ? (
                <NativeRichTextView richText={node.richText} lang={node.lang ?? ""} />
              ) : (
                <p lang={node.text ? (node.lang ?? "") : locale}>
                  {node.text || copy("Empty text object")}
                </p>
              )}
            </div>
          );
        if (node?.type === "table")
          return (
            <div key={id} className={styles.readingTable} data-layout-reading-node={id}>
              <NativeSceneDataView node={node} locale={locale} />
            </div>
          );
        return null;
      })}
    </section>
  );
}

export function NativeSceneLayoutSuggestions(props: Props) {
  const { scene, disabled = false, locale = "en-CA" } = props;
  const copy = layoutAssistanceCopy(locale);
  const systemMessage = (message: string) => layoutAssistanceSystemMessage(locale, message);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const active = useRef<Review | null>(null);
  const mounted = useRef(true);
  const latest = useRef(props);
  latest.current = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const availability = nativeLayoutSuggestionAvailability(scene);
  const matches = (candidate: Review) =>
    !latest.current.disabled &&
    candidate.source === latest.current.scene &&
    candidate.sourceKey === latest.current.sourceKey &&
    candidate.fingerprint === JSON.stringify(latest.current.scene);
  // Invalidate during render as well as in the effect, so even queued old events cannot apply.
  if (active.current && !matches(active.current)) active.current = null;
  const current = Boolean(review && active.current === review && matches(review));
  function close() {
    active.current = null;
    setReview(null);
    setError("");
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = null;
    };
  }, []);
  useEffect(() => {
    if (review && !current) close();
  }, [review, current]);
  const open = Boolean(review);
  useEffect(() => {
    if (!open) return;
    const target = dialog.current;
    if (target && !target.open) target.showModal();
    return () => {
      if (target?.open) target.close();
      if (trigger.current?.isConnected && !trigger.current.disabled)
        trigger.current.focus({ preventScroll: true });
    };
  }, [open]);

  function suggest() {
    if (!mounted.current || latest.current.disabled || active.current) return;
    const snapshot = structuredClone(latest.current.scene);
    const suggestions = suggestNativeLayouts(snapshot);
    if (!suggestions.length) {
      setError(
        nativeLayoutSuggestionAvailability(snapshot).reason ??
          "No layout alternatives are available for this slide.",
      );
      return;
    }
    const next: Review = {
      source: latest.current.scene,
      fingerprint: JSON.stringify(latest.current.scene),
      sourceKey: latest.current.sourceKey,
      snapshot,
      suggestions,
      selectedId: suggestions[0]!.id,
    };
    active.current = next;
    setError("");
    setReview(next);
  }
  function select(expected: Review, id: string) {
    if (
      active.current !== expected ||
      !matches(expected) ||
      !expected.suggestions.some((candidate) => candidate.id === id)
    )
      return;
    const next = { ...expected, selectedId: id };
    active.current = next;
    setReview(next);
    setError("");
  }
  function apply(expected: Review) {
    if (!mounted.current || active.current !== expected || !matches(expected)) return;
    const selected = expected.suggestions.find((candidate) => candidate.id === expected.selectedId);
    if (!selected) return;
    active.current = null;
    try {
      // No coalescing key: the entire reviewed geometry change is one ordinary Undo step.
      const accepted = latest.current.onChange(structuredClone(selected.scene));
      if (accepted === false) {
        active.current = expected;
        setError(
          "This layout could not be applied within the presentation’s limits. Your current slide is retained.",
        );
        return;
      }
      close();
    } catch (failure) {
      active.current = expected;
      setError(
        failure instanceof Error
          ? failure.message
          : "The layout could not be applied. Your current slide is retained.",
      );
    }
  }
  const selected = review?.suggestions.find((candidate) => candidate.id === review.selectedId);
  return (
    <section
      className={styles.controls}
      lang={locale}
      aria-label={copy("Local layout suggestions")}
    >
      <button
        ref={trigger}
        type="button"
        disabled={disabled || !availability.supported}
        onClick={suggest}
      >
        {copy("Suggest layouts")}
      </button>
      <p
        className={styles.help}
        lang={
          availability.reason && !isLayoutAssistanceCopyKey(availability.reason) ? "en-CA" : locale
        }
      >
        {availability.reason
          ? systemMessage(availability.reason)
          : copy("Compare layouts for this slide before applying one. No AI credits needed.")}
      </p>
      {!review && error ? (
        <p role="alert" lang={isLayoutAssistanceCopyKey(error) ? locale : "en-CA"}>
          {systemMessage(error)}
        </p>
      ) : null}
      {review && selected ? (
        <dialog
          ref={dialog}
          className={styles.dialog}
          lang={locale}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClose={close}
        >
          <header className={styles.heading}>
            <h2 id={titleId}>{copy("Review layout suggestions")}</h2>
            <button type="button" aria-label={copy("Close layout review")} onClick={close}>
              {copy("Close")}
            </button>
          </header>
          <p id={descriptionId}>
            {copy(
              "Choose an alternative, compare it with your current layout, then apply it when you are ready. Your text, data and reading order stay the same.",
            )}
          </p>
          <p className={styles.help}>
            {copy(
              "Content counts only guide available space; they do not prove fit. Each preview checks rendered content at 1280 × 720 after its fonts load. Read the complete slide content below at a comfortable size.",
            )}
          </p>
          <fieldset className={styles.choices} disabled={!current}>
            <legend>{copy("Choose a layout")}</legend>
            {review.suggestions.map((suggestion) => (
              <label key={suggestion.id}>
                <input
                  type="radio"
                  name={`${titleId}-layout`}
                  value={suggestion.id}
                  checked={review.selectedId === suggestion.id}
                  onChange={() => select(review, suggestion.id)}
                />
                <span>
                  <strong lang={isLayoutAssistanceCopyKey(suggestion.label) ? locale : "en-CA"}>
                    {systemMessage(suggestion.label)}
                  </strong>
                  <span lang={isLayoutAssistanceCopyKey(suggestion.description) ? locale : "en-CA"}>
                    {systemMessage(suggestion.description)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className={styles.previews}>
            <LayoutPreview scene={review.snapshot} kind="current" locale={locale} />
            <LayoutPreview scene={selected.scene} kind="selected" locale={locale} />
          </div>
          <NativeLayoutReadingContent scene={review.snapshot} locale={locale} />
          {error ? (
            <p
              role="alert"
              className={styles.error}
              lang={isLayoutAssistanceCopyKey(error) ? locale : "en-CA"}
            >
              {systemMessage(error)}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" disabled={!current} onClick={() => apply(review)}>
              {copy("Apply reviewed layout")}
            </button>
            <button type="button" onClick={close}>
              {copy("Cancel")}
            </button>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
