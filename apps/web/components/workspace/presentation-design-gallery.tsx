"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CreatePresentationSchema,
  PresentationDraftMutationSchema,
  PRESENTATION_DESIGN_PALETTES,
} from "@openround/contracts";
import type { ContentSlideDraft, PresentationDraft, SupportedLocale } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { formatNumber } from "../../lib/i18n/format";
import {
  presentationDesignCopy,
  presentationDesignDraftCopy,
} from "../../lib/i18n/presentation-design-copy";
import {
  DESIGN_LAYOUTS,
  PRESENTATION_DESIGNS,
  applyPresentationDesign,
  createDesignDraft,
  summarizePresentationDesign,
  type DesignLayoutId,
  type PresentationDesignId,
} from "../../lib/presentation-designs";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { ContentSlideView } from "../presentation/content-slide-view";
import type { SceneImageRenderer } from "../presentation/native-scene-view";
import { handleModalKeyDown } from "../presentation/presentation-modal-focus";
import { recordAuthoringEvent, recordCreationEvent } from "./product-events";
import { useWorkspace } from "./workspace-provider";
import styles from "./presentation-design-gallery.module.css";

export interface PresentationDesignGalleryProps {
  draft?: PresentationDraft;
  selectedBlockId?: string;
  onApply?: (id: PresentationDesignId, scope: "deck" | "slide") => boolean | void;
  onInsert?: (id: PresentationDesignId, layout: DesignLayoutId) => boolean | void;
  disabled?: boolean;
  renderSceneImage?: SceneImageRenderer;
}

type PendingDesign = {
  schemaVersion: 1;
  designId: PresentationDesignId;
  locale: SupportedLocale;
  postBody: string;
  draftBody: string;
  presentationId: string | null;
};
type FailedDesign = {
  ownerKey: string;
  key: string;
  designId: PresentationDesignId;
  locale: SupportedLocale;
  presentationId: string | null;
};
const pendingDesigns = new Map<string, PendingDesign | null>();
const creatingDesigns = new Set<string>();
const creationIdSchema = CreatePresentationSchema.shape.creationRequestId.unwrap();

function rememberDesign(key: string, attempt: PendingDesign) {
  // Memory recovery also works when the browser disallows tab storage.
  pendingDesigns.set(key, attempt);
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(attempt));
  } catch {
    /* Keep the exact request in memory. */
  }
}
function forgetDesign(key: string) {
  // A tombstone also prevents stale storage from reviving a retired intent if removal fails.
  pendingDesigns.set(key, null);
  try {
    globalThis.sessionStorage?.removeItem(key);
  } catch {
    /* The in-memory tombstone remains authoritative for this tab. */
  }
}
function restoreDesign(
  key: string,
  actorId: string,
  workspaceId: string,
  designId: PresentationDesignId,
  locale: SupportedLocale,
) {
  if (pendingDesigns.has(key)) return pendingDesigns.get(key) ?? null;
  let raw: string | null;
  try {
    raw = globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    if (raw.length > 1_048_576) throw new Error();
    const value = JSON.parse(raw) as PendingDesign;
    if (
      value.schemaVersion !== 1 ||
      value.designId !== designId ||
      value.locale !== locale ||
      typeof value.postBody !== "string" ||
      typeof value.draftBody !== "string"
    )
      throw new Error();
    const post = CreatePresentationSchema.parse(JSON.parse(value.postBody));
    const mutation = PresentationDraftMutationSchema.parse(JSON.parse(value.draftBody));
    if (
      !post.creationRequestId ||
      post.creationContext?.actorId !== actorId ||
      post.creationContext.workspaceId !== workspaceId ||
      mutation.expectedRevision !== 0 ||
      post.title !== mutation.draft.title ||
      post.description !== mutation.draft.description ||
      (value.presentationId !== null &&
        creationIdSchema.parse(value.presentationId) !== value.presentationId)
    )
      throw new Error();
    pendingDesigns.set(key, value);
    return value;
  } catch {
    throw new Error("The saved design request could not be verified. No new request was sent.");
  }
}
type PreviewDesign = {
  id: PresentationDesignId;
  locale: SupportedLocale;
  draft: PresentationDraft;
};

function previewIdFactory(designId: PresentationDesignId) {
  let sequence = (PRESENTATION_DESIGNS.findIndex((design) => design.id === designId) + 1) * 10000;
  return () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
}

/** Native scene artwork rendered at its actual 16:9 proportions, without autoplay. */
export function PresentationDesignArtwork({
  block,
  locale,
  renderSceneImage,
}: {
  block: ContentSlideDraft;
  locale: SupportedLocale;
  renderSceneImage?: SceneImageRenderer;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      const measured = node.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div className={styles.artwork} ref={container} aria-hidden="true" inert>
      <div className={styles.scene} style={{ transform: `scale(${width / 960})` }}>
        <ContentSlideView
          block={block}
          contentLocale={locale}
          variant="preview"
          renderSceneImage={renderSceneImage}
          staticThumbnail
        />
      </div>
    </div>
  );
}

/** Complete reading alternative to the inert artwork, including every data value. */
export function PresentationDesignReadingView({
  block,
  locale,
}: {
  block: ContentSlideDraft;
  locale: SupportedLocale;
}) {
  if (!block.scene)
    return (
      <div>
        {block.textElements.map((element) => (
          <p key={element.id}>{element.text}</p>
        ))}
        {block.mediaAlt ? <p>{block.mediaAlt}</p> : null}
      </div>
    );
  const scene = block.scene;
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  return (
    <div lang={locale}>
      {scene.readingOrder.map((id) => {
        const node = nodes.get(id);
        if (!node || (node.type === "shape" && node.decorative)) return null;
        if (node.type === "text")
          return (
            <p key={id} lang={node.lang ?? locale}>
              {node.role === "title" ? <strong>{node.text}</strong> : node.text}
            </p>
          );
        if (node.type === "image") return node.altText ? <p key={id}>{node.altText}</p> : null;
        if (node.type === "table")
          return (
            <div
              key={id}
              className={styles.readingTable}
              tabIndex={0}
              role="region"
              aria-label={node.caption}
            >
              <table>
                <caption>{node.caption}</caption>
                <thead>
                  <tr>
                    {node.headers.map((header, index) => (
                      <th key={index} scope="col">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {node.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, index) => (
                        <td key={index}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (node.type === "chart")
          return (
            <div key={id}>
              <p>
                <strong>{node.title}</strong>
              </p>
              <p>{node.summary}</p>
              <div
                className={styles.readingTable}
                tabIndex={0}
                role="region"
                aria-label={node.title}
              >
                <table>
                  <caption>{node.title}</caption>
                  <thead>
                    <tr>
                      <th scope="col"></th>
                      {node.series.map((series, index) => (
                        <th key={index} scope="col">
                          {series.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {node.categories.map((category, index) => (
                      <tr key={index}>
                        <th scope="row">{category}</th>
                        {node.series.map((series, seriesIndex) => (
                          <td key={seriesIndex}>{formatNumber(locale, series.values[index]!)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        if (node.type === "reveal" || node.type === "hotspot" || node.type === "dialog")
          return (
            <div key={id}>
              <p>
                <strong>
                  {"detailTitle" in node ? node.detailTitle || node.label : node.label}
                </strong>
              </p>
              <p>{node.body}</p>
            </div>
          );
        return node.label ? <p key={id}>{node.label}</p> : null;
      })}
    </div>
  );
}

export function PresentationDesignGallery({
  draft,
  selectedBlockId,
  onApply,
  onInsert,
  disabled = false,
  renderSceneImage,
}: PresentationDesignGalleryProps = {}) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = presentationDesignCopy(locale);
  const { canEdit, productFeatures, creator } = useWorkspace();
  const ownerKey = creator ? `${creator.userId}:${creator.workspaceId}` : "";
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  const completedLock = useRef<{ key: string; ownerKey: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (completedLock.current) creatingDesigns.delete(completedLock.current.key);
      completedLock.current = null;
    };
  }, []);
  const canCreate =
    canEdit && Boolean(productFeatures?.presentations) && !disabled && Boolean(creator);
  const canCreateRef = useRef(canCreate);
  canCreateRef.current = canCreate;
  const resultId = useId();
  const [search, setSearch] = useState("");
  const [style, setStyle] = useState("all");
  const [preview, setPreview] = useState<PreviewDesign | null>(null);
  const [busy, setBusy] = useState<PresentationDesignId | null>(null);
  const [error, setError] = useState("");
  const [failedCreation, setFailedCreation] = useState<FailedDesign | null>(null);
  const failureRef = useRef(failedCreation);
  failureRef.current = failedCreation;
  const failure = failedCreation?.ownerKey === ownerKey ? failedCreation : null;
  const pending = useRef(
    new Map<PresentationDesignId, { ownerKey: string; key: string; attempt: PendingDesign }>(),
  );
  const creating = useRef(false);
  useEffect(() => {
    const completed = completedLock.current;
    if (completed && (!canCreate || completed.ownerKey !== ownerKey)) {
      creatingDesigns.delete(completed.key);
      completedLock.current = null;
      creating.current = false;
      setBusy(null);
    }
  }, [canCreate, ownerKey]);
  const samples = useMemo(
    () =>
      new Map(
        PRESENTATION_DESIGNS.map((design) => [
          design.id,
          createDesignDraft(
            design.id,
            presentationDesignDraftCopy(design.id, locale),
            previewIdFactory(design.id),
          ),
        ]),
      ),
    [locale],
  );
  const visible = PRESENTATION_DESIGNS.filter(
    (design) =>
      (style === "all" || design.style === style) &&
      `${design.name} ${copy.purposes[design.id]} ${copy.descriptions[design.id]} ${copy[design.style]}`
        .toLocaleLowerCase(locale)
        .includes(search.trim().toLocaleLowerCase(locale)),
  );

  async function startDesign(
    id: PresentationDesignId,
    contentLocale = locale,
    restart?: FailedDesign,
  ) {
    if (
      draft ||
      creating.current ||
      !canCreateRef.current ||
      !creator ||
      ownerRef.current !== ownerKey ||
      (restart && (restart !== failureRef.current || restart.ownerKey !== ownerKey))
    )
      return;
    const currentOwner = ownerKey;
    const current = () =>
      alive.current && canCreateRef.current && ownerRef.current === currentOwner;
    creating.current = true;
    setBusy(id);
    setError("");
    setFailedCreation(null);
    failureRef.current = null;
    let recoveryKey = "";
    let ownsLock = false;
    let navigationDispatched = false;
    let attempt: PendingDesign | null = null;
    try {
      const local = pending.current.get(id);
      recoveryKey =
        restart?.key ??
        (local?.ownerKey === currentOwner
          ? local.key
          : `presentation-design-start:v1:${currentOwner}:${id}:${contentLocale}`);
      if (creatingDesigns.has(recoveryKey)) return;
      creatingDesigns.add(recoveryKey);
      ownsLock = true;
      if (restart) {
        // Explicitly retire only the local intent. The previous server draft is kept unchanged.
        forgetDesign(recoveryKey);
        pending.current.delete(id);
      } else {
        attempt =
          local?.ownerKey === currentOwner
            ? local.attempt
            : restoreDesign(recoveryKey, creator.userId, creator.workspaceId, id, contentLocale);
      }
      if (!attempt) {
        const nextDraft = createDesignDraft(id, presentationDesignDraftCopy(id, contentLocale));
        attempt = {
          schemaVersion: 1,
          designId: id,
          locale: contentLocale,
          presentationId: null,
          postBody: JSON.stringify({
            creationRequestId: clientUuid(),
            creationContext: { actorId: creator.userId, workspaceId: creator.workspaceId },
            title: nextDraft.title,
            description: nextDraft.description,
          }),
          draftBody: JSON.stringify({
            draft: nextDraft,
            expectedRevision: 0,
            mutationId: clientUuid(),
            schemaVersion: 2,
          }),
        };
      }
      // Freeze both requests before the first mutation so a lost POST acknowledgement is safe to retry.
      pending.current.set(id, { ownerKey: currentOwner, key: recoveryKey, attempt });
      rememberDesign(recoveryKey, attempt);
      recordCreationEvent("creation_started", "starter", "presentation");
      if (!attempt.presentationId) {
        const created = await apiFetch<{ presentation: { id: string } }>("/v1/presentations", {
          method: "POST",
          body: attempt.postBody,
        });
        attempt.presentationId = creationIdSchema.parse(created.presentation.id);
        rememberDesign(recoveryKey, attempt);
      }
      if (!current()) return;
      await apiFetch(`/v1/presentations/${attempt.presentationId}/draft`, {
        method: "PUT",
        body: attempt.draftBody,
      });
      if (!current()) return;
      forgetDesign(recoveryKey);
      pending.current.delete(id);
      recordCreationEvent("creation_completed", "starter", "presentation");
      recordAuthoringEvent("first_block_created", "presentation");
      completedLock.current = { key: recoveryKey, ownerKey: currentOwner };
      router.push(`/presentation/${attempt.presentationId}`);
      navigationDispatched = true;
    } catch (caught) {
      if (current()) {
        setError(humanError(caught));
        setFailedCreation({
          ownerKey: currentOwner,
          key: recoveryKey,
          designId: id,
          locale: attempt?.locale ?? contentLocale,
          presentationId: attempt?.presentationId ?? null,
        });
      }
    } finally {
      // Keep the successful request latched while Next commits the navigation.
      // Unmount releases only a completed lock; an in-flight request releases its own lock here.
      if (!navigationDispatched || !current()) {
        if (ownsLock) creatingDesigns.delete(recoveryKey);
        if (completedLock.current?.key === recoveryKey) completedLock.current = null;
        creating.current = false;
        if (alive.current) setBusy(null);
      }
    }
  }

  function openPreview(id: PresentationDesignId, trigger: HTMLButtonElement) {
    trigger.focus();
    setPreview({ id, locale, draft: samples.get(id)! });
  }

  return (
    <div className={styles.gallery} lang={locale}>
      <div className={styles.filters}>
        <label className={`field ${styles.search}`}>
          <span>{copy.search}</span>
          <input
            className="input"
            type="search"
            value={search}
            aria-controls={resultId}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className={styles.styleFilters} role="group" aria-label={copy.styles}>
          {(["all", "minimal", "editorial", "bold", "technical"] as const).map((value) => (
            <button
              className={styles.filter}
              type="button"
              key={value}
              aria-pressed={style === value}
              aria-controls={resultId}
              onClick={() => setStyle(value)}
            >
              {value === "all" ? copy.allStyles : copy[value]}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.resultSummary}>
        <p role="status" aria-live="polite">
          {formatNumber(locale, visible.length)} · {copy.title}
        </p>
        {search || style !== "all" ? (
          <button
            className={styles.clear}
            type="button"
            onClick={() => {
              setSearch("");
              setStyle("all");
            }}
          >
            {copy.clearFilters}
          </button>
        ) : null}
      </div>
      {!canEdit ? (
        <p className={styles.notice}>{copy.readOnly}</p>
      ) : !productFeatures?.presentations ? (
        <p className={styles.notice}>{copy.unavailable}</p>
      ) : null}
      {error && failure ? (
        <p className="error" role="alert" lang="en-CA">
          {error}
        </p>
      ) : null}
      {error && failure ? (
        <div className={styles.recovery}>
          <div className={styles.recoveryActions}>
            {failure.presentationId ? (
              <Link
                className="button-quiet small-button"
                href={`/presentation/${failure.presentationId}`}
              >
                {copy.openDraft}
              </Link>
            ) : null}
            <button
              className="button-quiet small-button"
              type="button"
              data-design-restart={failure.designId}
              disabled={!canCreate || Boolean(busy)}
              onClick={() => void startDesign(failure.designId, failure.locale, failure)}
            >
              {copy.startAnother}
            </button>
          </div>
          <p className={styles.notice}>{copy.startAnotherHint}</p>
        </div>
      ) : null}
      <div className={styles.grid} id={resultId}>
        {visible.map((design) => {
          const sample = samples.get(design.id)!;
          const palette = PRESENTATION_DESIGN_PALETTES[design.design.palette];
          return (
            <article className={styles.card} key={design.id} data-design-card={design.id}>
              <button
                className={styles.previewButton}
                type="button"
                aria-haspopup="dialog"
                aria-label={`${copy.preview}: ${design.name}`}
                onClick={(event) => openPreview(design.id, event.currentTarget)}
              >
                <PresentationDesignArtwork
                  block={sample.blocks[0] as ContentSlideDraft}
                  locale={locale}
                />
                <span className={styles.previewBadge} aria-hidden="true">
                  {copy.preview}
                </span>
              </button>
              <div className={styles.cardBody}>
                <span className={styles.cardHeading}>
                  <strong>{design.name}</strong>
                  <span className={styles.palette} aria-hidden="true">
                    {[palette.background, palette.text, palette.accent].map((color, index) => (
                      <i key={index} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                </span>
                <span className={styles.purpose}>
                  {copy.purposes[design.id]} · {copy[design.style]}
                </span>
                <p>{copy.descriptions[design.id]}</p>
                <div className={styles.cardActions}>
                  <span>{copy.layouts}</span>
                  {!draft && canCreate ? (
                    <button
                      className="button-quiet small-button"
                      type="button"
                      data-design-create={design.id}
                      disabled={Boolean(busy)}
                      onClick={() => void startDesign(design.id)}
                    >
                      {busy === design.id ? copy.creating : copy.useDesign}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {visible.length === 0 ? <p className={styles.empty}>{copy.noMatches}</p> : null}
      {preview ? (
        <PresentationDesignPreview
          key={preview.id}
          preview={preview}
          currentDraft={draft}
          selectedBlockId={selectedBlockId}
          disabled={!canCreate || Boolean(busy)}
          creating={busy === preview.id}
          creationError={failure?.designId === preview.id ? error : undefined}
          recoveryHref={
            failure?.designId === preview.id && failure.presentationId
              ? `/presentation/${failure.presentationId}`
              : undefined
          }
          onRestart={
            failure?.designId === preview.id
              ? () => void startDesign(failure.designId, failure.locale, failure)
              : undefined
          }
          renderSceneImage={renderSceneImage}
          onClose={() => setPreview(null)}
          onCreate={() => void startDesign(preview.id, preview.locale)}
          onApply={onApply}
          onInsert={onInsert}
        />
      ) : null}
    </div>
  );
}

export function PresentationDesignPreview({
  preview,
  currentDraft,
  selectedBlockId,
  disabled,
  creating,
  creationError,
  recoveryHref,
  renderSceneImage,
  onClose,
  onCreate,
  onRestart,
  onApply,
  onInsert,
}: {
  preview: PreviewDesign;
  currentDraft?: PresentationDraft;
  selectedBlockId?: string;
  disabled?: boolean;
  creating?: boolean;
  creationError?: string;
  recoveryHref?: string;
  renderSceneImage?: SceneImageRenderer;
  onClose: () => void;
  onCreate: () => void;
  onRestart?: () => void;
  onApply?: PresentationDesignGalleryProps["onApply"];
  onInsert?: PresentationDesignGalleryProps["onInsert"];
}) {
  const { locale } = useLocale();
  const copy = presentationDesignCopy(locale);
  const family = PRESENTATION_DESIGNS.find((design) => design.id === preview.id)!;
  const dialog = useRef<HTMLDialogElement>(null);
  const [layoutIndex, setLayoutIndex] = useState(0);
  const [mode, setMode] = useState<"samples" | "content">(currentDraft ? "content" : "samples");
  const [scope, setScope] = useState<"deck" | "slide">("deck");
  const [error, setError] = useState("");
  const selected = currentDraft?.blocks.find((block) => block.id === selectedBlockId);
  const summary = currentDraft
    ? summarizePresentationDesign(currentDraft, { scope, blockId: selectedBlockId })
    : null;
  const styled = useMemo(() => {
    if (!currentDraft) return null;
    try {
      return {
        ...applyPresentationDesign(currentDraft, preview.id, { scope, blockId: selectedBlockId }),
        error: "",
      };
    } catch (caught) {
      return { draft: currentDraft, error: humanError(caught) };
    }
  }, [currentDraft, preview.id, scope, selectedBlockId]);
  const contentBlock =
    styled?.draft.blocks.find(
      (block) => block.id === selectedBlockId && block.kind === "content",
    ) ?? (scope === "deck" ? styled?.draft.blocks.find((block) => block.kind === "content") : null);
  const block = mode === "content" ? contentBlock : preview.draft.blocks[layoutIndex];
  const layout = DESIGN_LAYOUTS[layoutIndex]!;
  const activeLabel = mode === "content" ? copy.yourContent : copy.layoutLabels[layout];

  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function commit(action: (() => boolean | void) | undefined) {
    if (disabled || !action) return;
    setError("");
    try {
      if (action() !== false) onClose();
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      lang={locale}
      aria-label={`${copy.preview}: ${family.name}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        handleModalKeyDown(event, onClose);
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          mode !== "samples"
        )
          return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("input,textarea,select,table,[role='region'],[contenteditable='true']"))
          return;
        const next =
          event.key === "ArrowRight"
            ? Math.min(7, layoutIndex + 1)
            : event.key === "ArrowLeft"
              ? Math.max(0, layoutIndex - 1)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 7
                  : null;
        if (next !== null) {
          event.preventDefault();
          setLayoutIndex(next);
        }
      }}
    >
      <header className={styles.dialogHeader}>
        <div>
          <p className={styles.eyebrow}>{copy.title}</p>
          <h2>{family.name}</h2>
          <p>{copy.descriptions[preview.id]}</p>
        </div>
        <button className="button-quiet" type="button" onClick={onClose}>
          {copy.close}
        </button>
      </header>
      {currentDraft ? (
        <div className={styles.editorControls}>
          <div className={styles.styleFilters} role="group" aria-label={copy.preview}>
            <button
              className={styles.filter}
              type="button"
              aria-pressed={mode === "content"}
              onClick={() => setMode("content")}
            >
              {copy.yourContent}
            </button>
            <button
              className={styles.filter}
              type="button"
              aria-pressed={mode === "samples"}
              onClick={() => setMode("samples")}
            >
              {copy.layoutSamples}
            </button>
          </div>
          <label className={`field ${styles.scope}`}>
            <span>{copy.scope}</span>
            <select
              className="input"
              value={scope}
              onChange={(event) => setScope(event.target.value as "deck" | "slide")}
            >
              <option value="deck">{copy.deck}</option>
              <option value="slide" disabled={selected?.kind !== "content"}>
                {copy.slide}
              </option>
            </select>
          </label>
        </div>
      ) : null}
      <div className={styles.stageHeading}>
        <h3>{activeLabel}</h3>
        {mode === "samples" ? (
          <p role="status">
            {copy.slideCount
              .replace("{number}", formatNumber(locale, layoutIndex + 1))
              .replace("{count}", formatNumber(locale, 8))}
          </p>
        ) : null}
      </div>
      {block?.kind === "content" ? (
        <div
          className={styles.stage}
          data-design-preview={mode}
          data-design-preview-layout={mode === "samples" ? layout : undefined}
        >
          <PresentationDesignArtwork
            block={block}
            locale={mode === "samples" ? preview.locale : locale}
            renderSceneImage={mode === "content" ? renderSceneImage : undefined}
          />
          <details className={styles.textPreview}>
            <summary>{activeLabel}</summary>
            <PresentationDesignReadingView
              block={block}
              locale={mode === "samples" ? preview.locale : locale}
            />
          </details>
        </div>
      ) : (
        <p className={styles.empty}>{copy.emptyEligible}</p>
      )}
      {mode === "samples" ? (
        <div className={styles.layoutList} role="group" aria-label={copy.layoutSamples}>
          {DESIGN_LAYOUTS.map((id, index) => (
            <button
              className={styles.layoutChoice}
              type="button"
              key={id}
              aria-pressed={layoutIndex === index}
              data-design-layout={id}
              onClick={() => setLayoutIndex(index)}
            >
              <PresentationDesignArtwork
                block={preview.draft.blocks[index] as ContentSlideDraft}
                locale={preview.locale}
              />
              <span>{copy.layoutLabels[id]}</span>
            </button>
          ))}
        </div>
      ) : null}
      {summary ? (
        <p className={styles.notice}>
          {copy.summary
            .replace("{eligible}", formatNumber(locale, summary.eligibleSlides))
            .replace("{activities}", formatNumber(locale, summary.activitySlides))
            .replace("{imports}", formatNumber(locale, summary.importedSlides))}
        </p>
      ) : null}
      {summary ? <p className={styles.notice}>{copy.inheritanceNotice}</p> : null}
      {summary && summary.importedSlides > 0 ? (
        <p className={styles.notice}>{copy.importedNotice}</p>
      ) : null}
      <p className={styles.notice}>{currentDraft ? copy.applyDescription : copy.staticPreview}</p>
      {error || creationError || styled?.error ? (
        <p className="error" role="alert" lang="en-CA">
          {error || creationError || styled?.error}
        </p>
      ) : null}
      {creationError && (recoveryHref || onRestart) ? (
        <div className={styles.recovery}>
          <div className={styles.recoveryActions}>
            {recoveryHref ? (
              <Link className="button-quiet" href={recoveryHref}>
                {copy.openDraft}
              </Link>
            ) : null}
            {onRestart ? (
              <button
                className="button-quiet"
                type="button"
                data-design-restart={preview.id}
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onRestart();
                }}
              >
                {copy.startAnother}
              </button>
            ) : null}
          </div>
          {onRestart ? <p className={styles.notice}>{copy.startAnotherHint}</p> : null}
        </div>
      ) : null}
      <footer className={styles.dialogFooter}>
        <p>
          {copy.staticPreview}
          {mode === "samples" ? ` ${copy.keyboard}` : ""}
        </p>
        <div className={styles.dialogActions}>
          {currentDraft ? (
            <>
              {mode === "samples" && onInsert ? (
                <button
                  className="button-quiet"
                  type="button"
                  data-design-insert={layout}
                  disabled={disabled}
                  onClick={() => commit(() => onInsert(preview.id, layout))}
                >
                  {copy.addLayout}
                </button>
              ) : null}
              <button
                className="button"
                type="button"
                data-design-apply={preview.id}
                disabled={
                  disabled || !summary?.eligibleSlides || Boolean(styled?.error) || !onApply
                }
                onClick={() => commit(onApply ? () => onApply(preview.id, scope) : undefined)}
              >
                {copy.apply}
              </button>
            </>
          ) : (
            <button
              className="button"
              type="button"
              data-design-create={preview.id}
              disabled={disabled}
              onClick={onCreate}
            >
              {creating ? copy.creating : copy.useDesign}
            </button>
          )}
        </div>
      </footer>
    </dialog>
  );
}
