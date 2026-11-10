"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  resolvePresentationSpatialFrames,
  type PresentationDraft,
  type PresentationBlockDraft,
  type PresentationSpatialFrame,
  type SupportedLocale,
} from "@openround/contracts";
import {
  autoLayoutPresentationSpatial,
  disablePresentationSpatial,
  enablePresentationSpatial,
  presentationSpatialSectionBounds,
  resetPresentationSpatialFrame,
  updatePresentationSpatialFrame,
} from "../../lib/presentation-spatial-authoring";
import {
  fitPresentationSpatialFrames,
  zoomPresentationSpatialAt,
  type PresentationSpatialViewport,
} from "../../lib/presentation-spatial-geometry";
import { startModalInitialFocus } from "../../lib/modal-initial-focus";
import styles from "./presentation-spatial-editor.module.css";
import { useLocale } from "../locale-provider";
import { sectionsSpatialCopy } from "../../lib/i18n/sections-spatial-copy";
import { formatNumber } from "../../lib/i18n/format";
interface Props {
  draft: PresentationDraft;
  selectedBlockId: string | null;
  onSelect: (id: string) => void;
  onChange: (next: SetStateAction<PresentationDraft>, historyKey?: string) => void;
  onClose: () => void;
  onPreviewPath: () => void;
  renderPreview?: (block: PresentationBlockDraft) => ReactNode;
}
interface Gesture {
  base: PresentationDraft;
  pointerId: number;
  startX: number;
  startY: number;
  frame: PresentationSpatialFrame;
  zoom: number;
  preview: PresentationDraft;
}
type NumberField = "x" | "y" | "width";
interface NumberEdit {
  base: PresentationDraft;
  blockId: string;
  field: NumberField;
  value: string;
}
const key = (id: string) => id.toLowerCase();
const focusable =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
function authoredSpatialBlockTitle(block: PresentationBlockDraft) {
  const title =
    block.kind === "question"
      ? block.question.prompt
      : block.scene?.nodes.find((node) => node.type === "text" && node.role === "title")?.type ===
          "text"
        ? (
            block.scene.nodes.find((node) => node.type === "text" && node.role === "title") as {
              text: string;
            }
          ).text
        : block.textElements.find((element) => element.role === "title")?.text;
  return title?.trim();
}
export function presentationSpatialBlockTitle(
  block: PresentationBlockDraft,
  index: number,
  locale: SupportedLocale = "en-CA",
) {
  return (
    authoredSpatialBlockTitle(block) ||
    sectionsSpatialCopy(locale)(
      block.kind === "question" ? "Activity {number}" : "Slide {number}",
      { number: formatNumber(locale, index + 1) },
    )
  );
}
export function PresentationSpatialEditor({
  draft,
  selectedBlockId,
  onSelect,
  onChange,
  onClose,
  onPreviewPath,
  renderPreview,
}: Props) {
  const { locale } = useLocale();
  const copy = sectionsSpatialCopy(locale);
  const dialog = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null),
    gesture = useRef<Gesture | null>(null),
    numberEditRef = useRef<NumberEdit | null>(null);
  const [preview, setPreview] = useState<{
      base: PresentationDraft;
      draft: PresentationDraft;
    } | null>(null),
    [size, setSize] = useState({ width: 900, height: 480 }),
    [viewport, setViewport] = useState<PresentationSpatialViewport | null>(null),
    [numberEdit, setNumberEdit] = useState<NumberEdit | null>(null);
  const current = preview?.base === draft ? preview.draft : draft,
    frames = useMemo(() => resolvePresentationSpatialFrames(current), [current]),
    camera = viewport ?? fitPresentationSpatialFrames(frames, size.width, size.height);
  const selected =
      current.blocks.find((block) => key(block.id) === key(selectedBlockId ?? "")) ??
      current.blocks[0],
    frame = frames.find((frame) => key(frame.blockId) === key(selected?.id ?? "")),
    sections = presentationSpatialSectionBounds(current, frames);
  const activeId = selected?.id ?? null;
  function release(active: Gesture) {
    if (stage.current?.hasPointerCapture(active.pointerId))
      stage.current.releasePointerCapture(active.pointerId);
  }
  function cancel() {
    const active = gesture.current;
    gesture.current = null;
    setPreview(null);
    if (active) release(active);
  }
  function cancelNumber() {
    numberEditRef.current = null;
    setNumberEdit(null);
  }
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stop = startModalInitialFocus({
      dialog: () => dialog.current,
      target: () => closeButton.current,
    });
    return () => {
      stop();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0)
        setSize({ width: bounds.width, height: bounds.height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [draft.spatial !== undefined]);
  useEffect(() => {
    const active = gesture.current;
    if (active && active.base !== draft) cancel();
  }, [draft]);
  useEffect(() => {
    const edit = numberEditRef.current;
    if (edit && (edit.base !== draft || edit.blockId !== activeId)) cancelNumber();
  }, [draft, activeId]);
  useEffect(
    () => () => {
      const active = gesture.current;
      gesture.current = null;
      if (active) release(active);
    },
    [],
  );
  function start(event: PointerEvent<HTMLElement>, id: string, handle = false) {
    if (
      !draft.spatial ||
      gesture.current ||
      event.button !== 0 ||
      !event.isPrimary ||
      window.matchMedia("(max-width: 700px)").matches ||
      (event.pointerType === "touch" && !handle)
    )
      return;
    const frame = frames.find((frame) => key(frame.blockId) === key(id));
    if (!frame || !stage.current) return;
    event.preventDefault();
    onSelect(id);
    event.currentTarget.focus({ preventScroll: true });
    setViewport(camera);
    gesture.current = {
      base: draft,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frame,
      zoom: camera.zoom,
      preview: draft,
    };
    stage.current.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId || active.base !== draft) return;
    const dx = (event.clientX - active.startX) / active.zoom,
      dy = (event.clientY - active.startY) / active.zoom;
    if (
      Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 2 &&
      active.preview === active.base
    )
      return;
    active.preview = updatePresentationSpatialFrame(active.base, active.frame.blockId, {
      x: active.frame.x + dx,
      y: active.frame.y + dy,
    });
    setPreview({ base: active.base, draft: active.preview });
  }
  function finish(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    move(event);
    gesture.current = null;
    setPreview(null);
    release(active);
    if (active.base === draft && active.preview !== active.base) onChange(active.preview);
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (gesture.current) cancel();
      else if (numberEditRef.current) cancelNumber();
      else onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(focusable)].filter(
        (element) => element.getClientRects().length > 0,
      ),
      first = controls[0],
      last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      event.currentTarget.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function nudge(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 160 : 16,
      dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0,
      dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if ((!dx && !dy) || !activeId || !frame) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
    onChange(
      (current) =>
        updatePresentationSpatialFrame(current, activeId, { x: frame.x + dx, y: frame.y + dy }),
      `spatial:${activeId}:move`,
    );
  }
  function number(field: NumberField, value: string) {
    if (!activeId) return;
    cancel();
    const edit = { base: draft, blockId: activeId, field, value };
    numberEditRef.current = edit;
    setNumberEdit(edit);
  }
  function numberValue(field: NumberField) {
    return numberEdit?.base === draft &&
      numberEdit.blockId === activeId &&
      numberEdit.field === field
      ? numberEdit.value
      : String(frame?.[field] ?? "");
  }
  function commitNumber(field: NumberField) {
    const edit = numberEditRef.current;
    if (!edit || edit.field !== field) return;
    cancelNumber();
    if (
      edit.base !== draft ||
      edit.blockId !== activeId ||
      !edit.value.trim() ||
      !Number.isFinite(Number(edit.value))
    )
      return;
    // A completed field edit owns one checkpoint; separate blurs must not coalesce.
    onChange((current) =>
      current === edit.base
        ? updatePresentationSpatialFrame(current, edit.blockId, { [field]: Number(edit.value) })
        : current,
    );
  }
  function numberKey(event: KeyboardEvent<HTMLInputElement>, field: NumberField) {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") commitNumber(field);
    else cancelNumber();
  }
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={copy("Arrange space")}
      className={styles.backdrop}
      tabIndex={-1}
      onKeyDown={keyboard}
      lang={locale}
    >
      <section className={styles.editor}>
        <header className={styles.header}>
          <div>
            <h2>{copy("Arrange space")}</h2>
            <p>
              {copy(
                "Slide positions form an overview. The numbered filmstrip controls playback order.",
              )}
            </p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose}>
            {copy("Close arrange space")}
          </button>
        </header>
        {!draft.spatial ? (
          <div className={styles.intro}>
            <p>
              {copy(
                "Enable a bounded spatial layout for this presentation. Existing slide, activity and section identities stay the same.",
              )}
            </p>
            <button type="button" onClick={() => onChange(enablePresentationSpatial)}>
              {copy("Enable spatial layout")}
            </button>
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <button
                type="button"
                onClick={() => {
                  cancel();
                  setViewport(fitPresentationSpatialFrames(frames, size.width, size.height));
                }}
              >
                {copy("Fit all")}
              </button>
              <button
                disabled={!frame}
                type="button"
                onClick={() => {
                  cancel();
                  setViewport(
                    fitPresentationSpatialFrames(frame ? [frame] : [], size.width, size.height),
                  );
                }}
              >
                {copy("Fit selected")}
              </button>
              <button
                type="button"
                aria-label={copy("Zoom out spatial layout")}
                onClick={() =>
                  setViewport(
                    zoomPresentationSpatialAt(
                      camera,
                      { x: size.width / 2, y: size.height / 2 },
                      camera.zoom / 1.5,
                    ),
                  )
                }
              >
                −
              </button>
              <button
                type="button"
                aria-label={copy("Zoom in spatial layout")}
                onClick={() =>
                  setViewport(
                    zoomPresentationSpatialAt(
                      camera,
                      { x: size.width / 2, y: size.height / 2 },
                      camera.zoom * 1.5,
                    ),
                  )
                }
              >
                +
              </button>
              <button
                type="button"
                onClick={() => {
                  cancel();
                  onChange(autoLayoutPresentationSpatial);
                  setViewport(null);
                }}
              >
                {copy("Auto layout")}
              </button>
              <button type="button" onClick={onPreviewPath}>
                {copy("Preview path")}
              </button>
              <button
                type="button"
                onClick={() => {
                  cancel();
                  onChange(disablePresentationSpatial);
                }}
              >
                {copy("Disable spatial layout")}
              </button>
            </div>
            <div className={styles.workspace}>
              <div
                ref={stage}
                className={styles.stage}
                aria-label={copy("Spatial frame overview")}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={cancel}
                onLostPointerCapture={() => {
                  if (gesture.current) cancel();
                }}
              >
                <div
                  className={styles.world}
                  style={{
                    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
                  }}
                >
                  {sections.map((section) => (
                    <div
                      key={section.sectionId}
                      className={styles.section}
                      style={{
                        left: section.x - 32,
                        top: section.y - 64,
                        width: section.width + 64,
                        height: section.height + 96,
                      }}
                    >
                      <span lang={section.title ? "" : locale}>
                        {section.title || copy("Unnamed section")}
                      </span>
                    </div>
                  ))}
                  <svg className={styles.path} width="20000" height="20000" aria-hidden="true">
                    <polyline
                      points={frames
                        .filter(
                          (_, index) =>
                            current.blocks[index]?.kind !== "content" ||
                            !current.blocks[index].hidden,
                        )
                        .map(
                          (frame) => `${frame.x + frame.width / 2},${frame.y + frame.height / 2}`,
                        )
                        .join(" ")}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="10"
                      strokeDasharray="24 16"
                    />
                  </svg>
                  {frames.map((rect, index) => {
                    const block = current.blocks[index]!;
                    return (
                      <button
                        type="button"
                        key={block.id}
                        data-spatial-frame={block.id}
                        aria-pressed={key(block.id) === key(activeId ?? "")}
                        className={`${styles.frame} ${key(block.id) === key(activeId ?? "") ? styles.selected : ""}`}
                        style={{
                          left: rect.x,
                          top: rect.y,
                          width: rect.width,
                          height: rect.height,
                        }}
                        onClick={() => onSelect(block.id)}
                        onPointerDown={(event) => start(event, block.id)}
                      >
                        <span className="sr-only">
                          {copy(block.kind === "question" ? "Activity" : "Slide")}{" "}
                        </span>
                        <strong>{formatNumber(locale, index + 1)}:</strong>{" "}
                        <span lang={authoredSpatialBlockTitle(block) ? "" : locale}>
                          {presentationSpatialBlockTitle(block, index, locale)}
                        </span>
                        {block.kind === "content" && block.hidden ? (
                          <small> {copy("Hidden · excluded from publication")}</small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <aside className={styles.controls} aria-label={copy("Spatial frame controls")}>
                <label>
                  {copy("Selected frame")}
                  <select
                    value={activeId ?? ""}
                    onChange={(event) => {
                      cancel();
                      onSelect(event.target.value);
                    }}
                  >
                    {current.blocks.map((block, index) => (
                      <option
                        key={block.id}
                        lang={authoredSpatialBlockTitle(block) ? "" : locale}
                        value={block.id}
                      >
                        {formatNumber(locale, index + 1)}.{" "}
                        {presentationSpatialBlockTitle(block, index, locale)}
                        {block.kind === "content" && block.hidden ? ` ${copy("(hidden)")}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {frame ? (
                  <>
                    <label>
                      {copy("Frame X")}
                      <input
                        type="number"
                        min="0"
                        max={20000 - frame.width}
                        step="16"
                        value={numberValue("x")}
                        onChange={(event) => number("x", event.target.value)}
                        onBlur={() => commitNumber("x")}
                        onKeyDown={(event) => numberKey(event, "x")}
                      />
                    </label>
                    <label>
                      {copy("Frame Y")}
                      <input
                        type="number"
                        min="0"
                        max={20000 - frame.height}
                        step="16"
                        value={numberValue("y")}
                        onChange={(event) => number("y", event.target.value)}
                        onBlur={() => commitNumber("y")}
                        onKeyDown={(event) => numberKey(event, "y")}
                      />
                    </label>
                    <label>
                      {copy("Frame width")}
                      <input
                        type="number"
                        min="320"
                        max="3200"
                        step="16"
                        value={numberValue("width")}
                        onChange={(event) => number("width", event.target.value)}
                        onBlur={() => commitNumber("width")}
                        onKeyDown={(event) => numberKey(event, "width")}
                      />
                    </label>
                    <p>
                      {copy(
                        "Press Enter or leave a numeric field to apply. Escape cancels the edit.",
                      )}
                    </p>
                    <p>
                      {copy("Height: {height}. Frames keep a 16:9 aspect ratio.", {
                        height: formatNumber(locale, frame.height),
                      })}
                    </p>
                    <button
                      type="button"
                      className={styles.move}
                      aria-label={copy("Move selected frame")}
                      onKeyDown={nudge}
                      onPointerDown={(event) => {
                        if (activeId) start(event, activeId, true);
                      }}
                    >
                      {copy("Move selected frame")}
                    </button>
                    <p>
                      {copy(
                        "Drag a frame on wide screens. Arrow keys on Move selected frame move by 16; hold Shift for 160. Escape cancels a drag. On a phone, use the numeric controls.",
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        cancel();
                        if (activeId)
                          onChange((current) => resetPresentationSpatialFrame(current, activeId));
                      }}
                    >
                      {copy("Reset selected frame")}
                    </button>
                  </>
                ) : null}
                {selected ? (
                  <div className={styles.preview} aria-label={copy("Selected frame preview")}>
                    {selected.kind === "content" && selected.hidden ? (
                      <p>{copy("Hidden planning slide. Excluded from published path preview.")}</p>
                    ) : null}
                    {renderPreview?.(selected)}
                  </div>
                ) : null}
              </aside>
            </div>
            <ol className={styles.list} aria-label={copy("Spatial frames in playback order")}>
              {current.blocks.map((block, index) => (
                <li key={block.id}>
                  <button
                    type="button"
                    aria-current={block.id === activeId ? "step" : undefined}
                    onClick={() => {
                      cancel();
                      onSelect(block.id);
                    }}
                  >
                    {formatNumber(locale, index + 1)}.{" "}
                    <span lang={authoredSpatialBlockTitle(block) ? "" : locale}>
                      {presentationSpatialBlockTitle(block, index, locale)}
                    </span>
                    {block.kind === "content" && block.hidden ? ` · ${copy("Hidden")}` : ""}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
