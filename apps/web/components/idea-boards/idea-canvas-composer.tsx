"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  CanvasObjectSchema,
  canvasDiagramPort,
  IdeaBoardLinkSchema,
  instantiateCanvasTemplate,
  type CanvasObject,
  type CanvasObjectCreate,
  type CanvasTemplateId,
  type IdeaBoardView,
} from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { participantCanvasCopy } from "../../lib/i18n/participant-canvas-messages";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import { guidedWorkshopCopy } from "../../lib/i18n/guided-workshop-messages";
import { canvasFacilitationCopy } from "../../lib/i18n/canvas-facilitation-messages";
import { formatNumber } from "../../lib/i18n/format";
import { clientUuid } from "../../lib/uuid";
import { uploadIdeaBoardImage } from "../../lib/idea-board-client";
import {
  CanvasSurface,
  type CanvasTool,
  type CanvasEndpoint,
} from "../canvas-boards/canvas-surface";
import { CanvasToolPalette } from "../canvas-boards/canvas-tool-palette";
import { CanvasContextToolbar } from "../canvas-boards/canvas-context-toolbar";
import { CanvasToolIcon, type CanvasToolIconName } from "../canvas-boards/canvas-tool-icon";
import {
  defaultCanvasDrawSettings,
  type CanvasConnectorPreset,
  type CanvasPaletteObjectType,
  type CanvasPaletteShapeVariant,
  type CanvasToolColor,
} from "../canvas-boards/canvas-tool-catalog";
import {
  fitViewport,
  INITIAL_VIEWPORT,
  worldPoint,
  zoomAt,
} from "../canvas-boards/canvas-geometry";
import {
  canvasAncestors,
  canvasObjectBounds,
  canvasSelectionClosure,
} from "../canvas-boards/canvas-hierarchy";
import { nextCanvasPosition, newCanvasObject } from "../canvas-boards/canvas-model";
import { newCanvasPen } from "../canvas-boards/canvas-productivity";
import { rasterizeCanvasSvg } from "../canvas-boards/canvas-svg-import";
import { CanvasTemplateChooser } from "./canvas-template-chooser";
import type { IdeaDraft } from "./idea-composer";
import {
  arrangeIdeaCanvas,
  deleteIdeaCanvas,
  duplicateIdeaCanvas,
  groupIdeaCanvas,
  ideaCanvasDraft,
  ideaCanvasObject,
  importIdeaCanvasDraft,
  patchIdeaCanvas,
  transformIdeaCanvas,
  type IdeaCanvasAlignment,
} from "./idea-canvas-model";
import styles from "./idea-canvas-composer.module.css";

type Props = {
  value: IdeaDraft;
  onChange: (value: IdeaDraft) => void;
  onSubmit: (draft: IdeaDraft) => void;
  onUploading: (uploading: boolean) => void;
  onClose: () => void;
  boardId: string;
  guestToken: string;
  canvasId?: string;
  publishedContext: CanvasObject[];
  publishedSourceBoard?: IdeaBoardView;
  imagesAvailable?: boolean;
  disabled: boolean;
  collectionClosed?: boolean;
  submitting?: boolean;
  submissionError?: string;
  onRetry?: () => void;
  onInteract?: () => void;
};
type History = { past: CanvasObject[][]; present: CanvasObject[]; future: CanvasObject[][] };
type AssetKind = "image" | "svg" | "link" | "templates";

export function IdeaCanvasComposer({
  value,
  onChange,
  onSubmit,
  onUploading,
  onClose,
  boardId,
  guestToken,
  canvasId,
  publishedContext,
  publishedSourceBoard,
  imagesAvailable,
  disabled,
  collectionClosed = false,
  submitting = false,
  submissionError,
  onRetry,
  onInteract,
}: Props) {
  const { locale, t } = useLocale();
  const copy = participantCanvasCopy(locale),
    tools = canvasToolCopy(locale),
    navigation = guidedWorkshopCopy(locale);
  const editLinkLabel = `${canvasFacilitationCopy(locale).edit}: ${t("boards.addLink")}`;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    assetDialog = useRef<HTMLDialogElement>(null);
  const formatting = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null),
    title = useRef<HTMLInputElement>(null),
    more = useRef<HTMLElement>(null);
  const current = useRef(value);
  current.current = value;
  const sent = useRef<IdeaDraft | null>(null),
    observed = useRef(value);
  const externallyDisabled = disabled || collectionClosed || submitting;
  const enabled = useRef(!externallyDisabled);
  enabled.current = !externallyDisabled;
  const active = useRef(true),
    upload = useRef<AbortController | null>(null);
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: importIdeaCanvasDraft(value),
    future: [],
  }));
  const objects = history.present;
  const retainedObjectLimit = useRef(Math.max(32, objects.length));
  const liveObjects = useRef(objects);
  liveObjects.current = objects;
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [draw, setDraw] = useState(defaultCanvasDrawSettings),
    [stickyColor, setStickyColor] = useState<CanvasToolColor>("yellow");
  const [connector, setConnector] = useState<CanvasConnectorPreset>("arrow");
  const connectorFrom = useRef<string | null>(null);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [editTextRequest, setEditTextRequest] = useState<{ id: string; nonce: number }>();
  const [arrange, setArrange] = useState(false);
  const [error, setError] = useState<
    "limit" | "invalid" | "title" | "empty" | "upload" | "link" | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [asset, setAsset] = useState<AssetKind | null>(null);
  const [editingAsset, setEditingAsset] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [description, setDescription] = useState("");
  const [url, setUrl] = useState(""),
    [label, setLabel] = useState("");
  const [template, setTemplate] = useState<CanvasTemplateId | null>(null);
  const locked = externallyDisabled || uploading || inlineEditing;
  const selected = objects.filter((object) => selection.includes(object.id));
  const selectedLink = selected.length === 1 && selected[0]?.type === "link" ? selected[0] : null;
  const ownIds = new Set(objects.map((object) => object.id));
  const editable = (object: CanvasObject) =>
    ownIds.has(object.id) &&
    !object.locked &&
    !canvasAncestors(objects, object).some((parent) => parent.locked);
  // Context gets a render-only namespace. Even an ID collision cannot redirect local edits
  // or cause a private media object to use the published canvas media route.
  const context = publishedContext.map((object) => ({
    ...object,
    id: `context:${object.id}`,
    parentId: object.parentId ? `context:${object.parentId}` : null,
    geometricGroupId: object.geometricGroupId ? `context:${object.geometricGroupId}` : null,
    locked: true,
    ...(object.type === "connector"
      ? {
          from: {
            ...object.from,
            objectId: object.from.objectId ? `context:${object.from.objectId}` : null,
          },
          to: {
            ...object.to,
            objectId: object.to.objectId ? `context:${object.to.objectId}` : null,
          },
        }
      : {}),
  })) as CanvasObject[];
  const combined = [...context, ...objects];
  const dimensions = () => ({
    width: stage.current?.clientWidth || 900,
    height: stage.current?.clientHeight || 600,
  });
  function fit(all = false) {
    const visible = all ? combined : objects.length ? objects : context;
    const { width, height } = dimensions();
    setViewport(
      fitViewport(
        visible.map((object) => canvasObjectBounds(object, visible)),
        width,
        height,
      ),
    );
  }
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    title.current?.focus();
    const element = stage.current;
    const initialObjects = liveObjects.current.length ? liveObjects.current : context;
    if (element)
      setViewport(
        fitViewport(
          initialObjects.map((object) => canvasObjectBounds(object, initialObjects)),
          element.clientWidth,
          element.clientHeight,
        ),
      );
    return () => {
      active.current = false;
      upload.current?.abort();
      upload.current = null;
      onUploading(false);
      dialog.current?.close();
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous.getClientRects().length &&
        !previous.closest("[hidden],[inert]")
      )
        previous.focus();
    };
  }, []);
  useEffect(() => {
    if (value === observed.current) return;
    observed.current = value;
    if (value === sent.current) return;
    const next = importIdeaCanvasDraft(value);
    setHistory({ past: [], present: next, future: [] });
    setSelection([]);
  }, [value]);
  useEffect(() => {
    if (!externallyDisabled || !upload.current) return;
    upload.current.abort();
    upload.current = null;
    setUploading(false);
    onUploading(false);
  }, [externallyDisabled, onUploading]);
  useEffect(() => {
    if (!asset) return;
    const previous = document.activeElement;
    const node = assetDialog.current;
    node?.showModal();
    node?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      node?.close();
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous.getClientRects().length
      )
        previous.focus();
    };
  }, [asset]);

  function commit(
    next: CanvasObject[] | null,
    allowInline = false,
    allowFrozen = false,
    draftBase = current.current,
  ) {
    if ((!enabled.current && !allowFrozen) || (inlineEditing && !allowInline)) return false;
    if (!next) {
      setError("invalid");
      return false;
    }
    const result = ideaCanvasDraft(draftBase, next, retainedObjectLimit.current);
    // Only the retention callback below can bypass a freeze, and it changes one already
    // validated text field. Keep an aggregate overflow in memory rather than dropping its
    // buffer; ordinary gestures still reject changes that exceed the submission budget.
    const draft =
      result.draft ??
      (allowFrozen && result.error === "limit"
        ? { ...draftBase, canvasDraft: structuredClone(next) }
        : null);
    if (!draft) {
      setError(result.error);
      return false;
    }
    sent.current = draft;
    current.current = draft;
    liveObjects.current = next;
    onChange(draft);
    setHistory((previous) => ({
      past: [...previous.past.slice(-49), previous.present],
      present: next,
      future: [],
    }));
    setError(result.error);
    if (!allowFrozen) onInteract?.();
    return true;
  }
  function historyAction(redo = false) {
    if (locked) return;
    const next = redo ? history.future[0] : history.past.at(-1);
    if (!next) return;
    const result = ideaCanvasDraft(current.current, next, retainedObjectLimit.current);
    if (!result.draft) {
      setError(result.error);
      return;
    }
    sent.current = result.draft;
    current.current = result.draft;
    onChange(result.draft);
    setHistory(
      redo
        ? { past: [...history.past, objects], present: next, future: history.future.slice(1) }
        : { past: history.past.slice(0, -1), present: next, future: [objects, ...history.future] },
    );
    setSelection([]);
    setError(result.error);
    onInteract?.();
  }
  function select(ids: string[], additive = false) {
    if (inlineEditing) return;
    const incoming = canvasSelectionClosure(
      objects,
      ids.filter((id) => ownIds.has(id)),
    ).map((object) => object.id);
    setSelection((previous) => (additive ? [...new Set([...previous, ...incoming])] : incoming));
  }
  function position(width = 220, height = 160) {
    const size = dimensions();
    return nextCanvasPosition(
      objects,
      worldPoint({ x: size.width / 2 - width / 2, y: size.height / 2 - height / 2 }, viewport),
      width,
      height,
    );
  }
  function add(
    type: CanvasPaletteObjectType,
    options?: { color?: CanvasToolColor; shapeVariant?: CanvasPaletteShapeVariant },
  ) {
    if (locked) return;
    try {
      const point = position(type === "frame" ? 440 : 220, type === "frame" ? 300 : 160);
      const object = ideaCanvasObject({
        ...newCanvasObject(type, point),
        ...(type === "sticky" ? { color: options?.color ?? stickyColor } : {}),
        ...(type === "rect" && options?.shapeVariant ? { shapeVariant: options.shapeVariant } : {}),
        ...(type === "frame" ? { width: 440, height: 300, zIndex: -1 } : {}),
      } as CanvasObjectCreate);
      if (commit([...objects, object])) {
        setSelection([object.id]);
        setTool("select");
        if (options?.color && type === "sticky") setStickyColor(options.color);
        if (type === "sticky" || type === "text")
          setEditTextRequest({ id: object.id, nonce: Date.now() });
      }
    } catch {
      setError("invalid");
    }
  }
  function openAsset(kind: AssetKind) {
    if (
      locked ||
      (kind !== "link" &&
        kind !== "templates" &&
        (imagesAvailable === false || current.current.attachments.length >= 3))
    )
      return;
    setEditingAsset(null);
    setFile(null);
    setDescription("");
    setUrl("");
    setLabel("");
    setTemplate(null);
    setError(null);
    setAsset(kind);
  }
  function editLink(object: Extract<CanvasObject, { type: "link" }>) {
    const existing = liveObjects.current.find((item) => item.id === object.id);
    if (!enabled.current || locked || existing?.type !== "link" || !editable(existing)) return;
    setEditingAsset(existing.id);
    setUrl(existing.url);
    setLabel(existing.text);
    setError(null);
    setAsset("link");
  }
  async function addAsset(event: FormEvent) {
    event.preventDefault();
    if (!asset || locked) return;
    if (asset === "templates") {
      if (!template) return;
      try {
        const point = position();
        const created = instantiateCanvasTemplate(template, clientUuid).map((object) =>
          ideaCanvasObject({
            ...object,
            x: object.x + point.x,
            y: object.y + point.y,
            ...(object.type === "pen"
              ? { points: object.points.map(([x, y]) => [x + point.x, y + point.y]) }
              : {}),
            ...(object.type === "connector"
              ? {
                  from: { ...object.from, x: object.from.x + point.x, y: object.from.y + point.y },
                  to: { ...object.to, x: object.to.x + point.x, y: object.to.y + point.y },
                }
              : {}),
          } as CanvasObjectCreate),
        );
        if (commit([...objects, ...created])) {
          setAsset(null);
          setSelection(created.map((object) => object.id));
        }
      } catch {
        setError("invalid");
      }
      return;
    }
    if (asset === "link") {
      try {
        const link = IdeaBoardLinkSchema.parse({ url, ...(label.trim() ? { label } : {}) });
        const existing = editingAsset
          ? liveObjects.current.find((item) => item.id === editingAsset && item.type === "link")
          : null;
        if (editingAsset && (!existing || !editable(existing))) {
          setError("invalid");
          return;
        }
        const object = existing
          ? CanvasObjectSchema.parse({
              ...existing,
              url: link.url,
              text: link.label ?? "",
              version: existing.version + 1,
            })
          : ideaCanvasObject({
              id: clientUuid(),
              type: "link",
              url: link.url,
              text: link.label ?? "",
              ...position(280, 120),
              width: 280,
              height: 120,
            } as CanvasObjectCreate);
        const next = existing
          ? liveObjects.current.map((item) => (item.id === existing.id ? object : item))
          : [...objects, object];
        // A URL is editable identity, not the identity of its retained thumbnail.
        // Carry the selected link's manifest entry to its new URL before normalization.
        const draftBase =
          existing?.type === "link"
            ? {
                ...current.current,
                links: current.current.links.map((item) =>
                  item.url === existing.url ? { ...item, url: link.url } : item,
                ),
              }
            : current.current;
        if (commit(next, false, false, draftBase)) {
          setAsset(null);
          setSelection([existing?.id ?? object.id]);
        }
      } catch {
        setError("link");
      }
      return;
    }
    if (!file || !description.trim() || imagesAvailable === false) return;
    const request = new AbortController();
    upload.current = request;
    setUploading(true);
    onUploading(true);
    setError(null);
    try {
      const image = asset === "svg" ? await rasterizeCanvasSvg(file, request.signal) : file;
      const media = await uploadIdeaBoardImage(
        boardId,
        guestToken,
        image,
        description.trim(),
        request.signal,
      );
      if (
        !active.current ||
        !enabled.current ||
        request.signal.aborted ||
        upload.current !== request
      )
        return;
      const object = ideaCanvasObject({
        id: clientUuid(),
        type: "image",
        mediaId: media.mediaId,
        altText: media.altText,
        ...position(300, 210),
        width: 300,
        height: 210,
      } as CanvasObjectCreate);
      if (commit([...liveObjects.current, object])) {
        setAsset(null);
        setSelection([object.id]);
      }
    } catch {
      if (active.current && !request.signal.aborted && upload.current === request)
        setError("upload");
    } finally {
      if (active.current && upload.current === request) {
        upload.current = null;
        setUploading(false);
        onUploading(false);
      }
    }
  }
  function closeAsset() {
    upload.current?.abort();
    upload.current = null;
    setUploading(false);
    onUploading(false);
    setAsset(null);
  }
  function duplicate() {
    if (!locked) {
      const next = duplicateIdeaCanvas(objects, selection);
      if (commit(next) && next) setSelection(next.slice(objects.length).map((object) => object.id));
    }
  }
  function remove() {
    if (!locked && commit(deleteIdeaCanvas(objects, selection))) setSelection([]);
  }
  async function createConnector(from: CanvasEndpoint, to: CanvasEndpoint) {
    if (
      locked ||
      [from, to].some((endpoint) => endpoint.objectId && !ownIds.has(endpoint.objectId))
    )
      return false;
    try {
      const object = ideaCanvasObject({
        id: clientUuid(),
        type: "connector",
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.max(1, Math.abs(from.x - to.x)),
        height: Math.max(1, Math.abs(from.y - to.y)),
        from,
        to,
        routing: connector === "elbow" ? "elbow" : "straight",
        endMarker: connector === "line" ? "none" : "arrow",
        color: "black",
      } as CanvasObjectCreate);
      const saved = commit([...objects, object]);
      if (saved) setSelection([object.id]);
      return saved;
    } catch {
      setError("invalid");
      return false;
    }
  }
  function icon(
    label: string,
    name: CanvasToolIconName,
    action: () => void,
    blocked = locked,
    pressed?: boolean,
  ) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={blocked}
        aria-pressed={pressed}
        onClick={action}
      >
        <CanvasToolIcon name={name} />
      </button>
    );
  }
  const errorMessage =
    error === "limit"
      ? copy.canvasLimit
      : error === "title"
        ? copy.titleRequired
        : error === "empty"
          ? copy.emptyCanvasHelp
          : error === "upload"
            ? copy.uploadFailed
            : error === "link"
              ? copy.linkInvalid
              : copy.invalidCanvas;
  const percentage = formatNumber(locale, viewport.zoom, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      onCancel={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || locked || asset) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("input,textarea,select,[contenteditable='true']")) return;
        const command = event.metaKey || event.ctrlKey;
        if (command && event.key.toLowerCase() === "z") {
          event.preventDefault();
          historyAction(event.shiftKey);
        } else if (command && event.key.toLowerCase() === "a") {
          event.preventDefault();
          setSelection(objects.map((object) => object.id));
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          remove();
        } else if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
          selection.length
        ) {
          event.preventDefault();
          const distance = event.shiftKey ? 10 : 1;
          commit(
            transformIdeaCanvas(objects, selection, {
              type: "move",
              dx: event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0,
              dy: event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0,
            }),
          );
        }
      }}
    >
      <header className={styles.header}>
        {icon(copy.backToWorkshop, "back", onClose, false)}
        <div className={styles.identity}>
          <h2 id={`${id}-title`}>{copy.title}</h2>
          <span>{copy.privateDraft}</span>
        </div>
        <label className={styles.titleField}>
          {copy.ideaTitle}
          <input
            ref={title}
            maxLength={1000}
            value={value.body}
            placeholder={copy.ideaTitleHint}
            disabled={externallyDisabled || uploading}
            dir="auto"
            lang=""
            onChange={(event) => {
              const next = { ...current.current, body: event.target.value };
              sent.current = next;
              current.current = next;
              onChange(next);
            }}
          />
        </label>
        <button
          className={styles.submit}
          type="button"
          disabled={locked}
          onClick={() => {
            if (locked) return;
            const result = ideaCanvasDraft(current.current, objects);
            if (result.error) {
              setError(result.error);
              return;
            }
            if (!objects.length) {
              setError("empty");
              return;
            }
            if (!result.draft.body.trim()) {
              setError("title");
              title.current?.focus();
              return;
            }
            sent.current = result.draft;
            current.current = result.draft;
            onChange(result.draft);
            onSubmit(result.draft);
          }}
        >
          {submitting ? copy.submitting : copy.submitIdea}
        </button>
      </header>
      <p id={`${id}-hint`} className={styles.hint}>
        {copy.privateHint} <span>{copy.readOnlyContext}</span>
      </p>
      {collectionClosed ? (
        <p className={styles.notice} role="status">
          {copy.canvasFrozen}
        </p>
      ) : null}
      {submitting ? (
        <p className={styles.notice} role="status">
          {copy.submitting}
        </p>
      ) : null}
      {submissionError ? (
        <div className={`${styles.error} ${styles.retryError}`} role="alert">
          <span>{submissionError}</span>
          {onRetry ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                if (!submitting) onRetry();
              }}
            >
              {t("boards.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {objects.length > 32 && !error ? (
        <p className={styles.error} role="alert">
          {copy.objectLimit.replace("{count}", formatNumber(locale, 32))}
        </p>
      ) : null}
      {error && !asset ? (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className={styles.workArea} data-inline-editing={inlineEditing}>
        <CanvasToolPalette
          activeTool={tool}
          disabled={locked}
          drawSettings={draw}
          selectedStickyColor={stickyColor}
          creationFull={objects.length >= 32}
          stickyStackLimit={Math.max(0, 32 - objects.length)}
          svgUploadDisabled={imagesAvailable === false || value.attachments.length >= 3}
          onAdd={add}
          onTool={(next) => {
            if (!locked) {
              setTool(next);
              connectorFrom.current = null;
              onInteract?.();
            }
          }}
          onConnector={(preset) => {
            if (!locked) {
              setConnector(preset);
              setTool("connector");
            }
          }}
          onDrawSettings={setDraw}
          onUploadSvg={() => openAsset("svg")}
          onTemplates={() => openAsset("templates")}
          onStickyStack={(count, color) => {
            if (locked) return;
            try {
              const point = position();
              const created = Array.from({ length: Math.min(20, count) }, (_, index) =>
                ideaCanvasObject({
                  ...newCanvasObject("sticky", {
                    x: point.x + index * 14,
                    y: point.y + index * 14,
                  }),
                  color,
                }),
              );
              if (commit([...objects, ...created])) {
                setStickyColor(color);
                setSelection(created.map((object) => object.id));
              }
            } catch {
              setError("invalid");
            }
          }}
        />
        <div className={styles.stage} ref={stage}>
          <CanvasSurface
            objects={combined}
            viewport={viewport}
            onViewport={setViewport}
            onInteract={onInteract}
            selectedIds={selection}
            onSelect={(id, additive) => {
              if (additive && id && ownIds.has(id) && selection.includes(id)) {
                const peers = new Set(
                  canvasSelectionClosure(objects, [id]).map((object) => object.id),
                );
                setSelection((previous) => previous.filter((selected) => !peers.has(selected)));
              } else select(id ? [id] : [], additive);
            }}
            onSelectMany={select}
            canEdit={!externallyDisabled && !uploading}
            canCreate={!locked && objects.length < 32}
            isObjectEditable={editable}
            isBackgroundObject={(object) => object.id.startsWith("context:")}
            tool={tool}
            penColor={draw.color}
            penWidth={draw.width}
            penOpacity={draw.mode === "highlighter" ? 0.35 : 1}
            onTransform={async (ids, transform) =>
              commit(transformIdeaCanvas(liveObjects.current, ids, transform))
            }
            onPatch={async (object, patch) =>
              commit(patchIdeaCanvas(liveObjects.current, [object.id], patch))
            }
            onCreatePen={async (points) => {
              if (locked) return false;
              try {
                const object = newCanvasPen(points, {
                  color: draw.color,
                  strokeWidth: draw.width,
                  opacity: draw.mode === "highlighter" ? 0.35 : 1,
                });
                return object ? commit([...liveObjects.current, ideaCanvasObject(object)]) : false;
              } catch {
                setError("invalid");
                return false;
              }
            }}
            onErasePen={async (strokes) =>
              commit(
                deleteIdeaCanvas(
                  liveObjects.current,
                  strokes.map((object) => object.id),
                ),
              )
            }
            onCreateConnector={createConnector}
            onConnect={(id) => {
              if (locked || !ownIds.has(id)) return;
              const target = objects.find((object) => object.id === id);
              if (!target || target.type === "connector" || target.type === "pen") return;
              const source = objects.find((object) => object.id === connectorFrom.current);
              if (!source) {
                connectorFrom.current = id;
                setSelection([id]);
                return;
              }
              if (source.id === id) return;
              const from = {
                objectId: source.id,
                anchor: "right" as const,
                x: source.x + source.width,
                y: source.y + source.height / 2,
              };
              const to = {
                objectId: target.id,
                anchor: "left" as const,
                x: target.x,
                y: target.y + target.height / 2,
              };
              void createConnector(
                { ...from, ...canvasDiagramPort(from, objects) },
                { ...to, ...canvasDiagramPort(to, objects) },
              ).then((saved) => {
                if (saved) connectorFrom.current = null;
              });
            }}
            onCommitText={async (object, text) =>
              commit(patchIdeaCanvas(liveObjects.current, [object.id], { text }), true)
            }
            onRetainText={(original, text) => {
              if (enabled.current) return;
              const object = liveObjects.current.find((object) => object.id === original.id);
              if (
                !object ||
                object.version !== original.version ||
                object.type !== original.type ||
                ![
                  "sticky",
                  "text",
                  "rect",
                  "ellipse",
                  "diamond",
                  "parallelogram",
                  "frame",
                ].includes(object.type)
              )
                return;
              commit(patchIdeaCanvas(liveObjects.current, [object.id], { text }), true, true);
            }}
            onTextEditingChange={setInlineEditing}
            editTextRequest={editTextRequest}
            canvasId={canvasId}
            sourceBoardId={boardId}
            sourceBoard={publishedSourceBoard}
            guestToken={guestToken}
            isIdeaImage={(object) => ownIds.has(object.id)}
          />
        </div>
        {!objects.length ? <p className={styles.empty}>{copy.emptyCanvasHelp}</p> : null}
        <div className={styles.quickTools} role="toolbar" aria-label={copy.tools}>
          {icon(t("boards.undo"), "undo", () => historyAction(), locked || !history.past.length)}
          {icon(
            t("boards.redo"),
            "redo",
            () => historyAction(true),
            locked || !history.future.length,
          )}
          <span className={styles.divider} />
          {icon(
            copy.addImage,
            "image",
            () => openAsset("image"),
            locked || imagesAvailable === false || value.attachments.length >= 3,
          )}
          {icon(copy.addLink, "link", () => openAsset("link"), locked || value.links.length >= 3)}
        </div>
        {selected.length && !inlineEditing ? (
          <div className={styles.formatting} ref={formatting}>
            {selectedLink ? (
              <button
                className={styles.editLink}
                type="button"
                aria-label={editLinkLabel}
                title={editLinkLabel}
                aria-haspopup="dialog"
                disabled={locked || !editable(selectedLink)}
                onClick={(event) => {
                  event.currentTarget.focus();
                  editLink(selectedLink);
                }}
              >
                <CanvasToolIcon name="link" />
                {editLinkLabel}
              </button>
            ) : null}
            <CanvasContextToolbar
              objects={selected}
              disabled={locked}
              editable={selected.every(editable)}
              canLock
              canDuplicate={!locked && selected.every(editable)}
              canDelete={!locked && selected.every(editable)}
              onPatch={(patch) => {
                if (!locked) commit(patchIdeaCanvas(objects, selection, patch));
              }}
              onConvert={(type) => {
                if (!locked) commit(patchIdeaCanvas(objects, selection, { type }));
              }}
              onLock={(lockedValue) => {
                if (!locked)
                  commit(patchIdeaCanvas(objects, selection, { locked: lockedValue }, true));
              }}
              onDuplicate={duplicate}
              onDelete={remove}
              onEditText={() => {
                if (selected.length === 1 && !locked) {
                  const object = selected[0]!;
                  if (object.type !== "link")
                    setEditTextRequest({ id: object.id, nonce: Date.now() });
                }
              }}
              onMore={() => {
                const opener = Array.from(
                  formatting.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
                ).find((button) => button.getAttribute("aria-label") === tools.more);
                opener?.focus();
                more.current = opener ?? null;
                setArrange((value) => !value);
              }}
            />
          </div>
        ) : null}
        {arrange ? (
          <aside
            className={styles.arrange}
            aria-label={copy.arrange}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setArrange(false);
                more.current?.focus();
              }
            }}
          >
            <div className={styles.panelHeader}>
              <h3>{copy.arrange}</h3>
              {icon(
                tools.close,
                "close",
                () => {
                  setArrange(false);
                  more.current?.focus();
                },
                false,
              )}
            </div>
            <div className={styles.arrangeActions}>
              {(["left", "center", "right", "top", "middle", "bottom"] as const).map(
                (alignment: IdeaCanvasAlignment) => (
                  <button
                    key={alignment}
                    type="button"
                    disabled={locked || selected.length < 2}
                    onClick={() => commit(arrangeIdeaCanvas(objects, selection, alignment))}
                  >
                    {t(`canvas.productivity.${alignment}`)}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={locked || selected.length < 2}
                onClick={() => commit(groupIdeaCanvas(objects, selection))}
              >
                {t("canvas.productivity.group")}
              </button>
              <button
                type="button"
                disabled={locked || !selected.some((object) => object.geometricGroupId)}
                onClick={() => commit(groupIdeaCanvas(objects, selection, true))}
              >
                {t("canvas.productivity.ungroup")}
              </button>
            </div>
          </aside>
        ) : null}
        <div className={styles.navigation} role="group" aria-label={t("canvas.zoom")}>
          {icon(
            navigation.zoomOut,
            "minus",
            () => {
              const size = dimensions();
              setViewport(
                zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, viewport.zoom / 1.2),
              );
              onInteract?.();
            },
            false,
          )}
          <button
            type="button"
            aria-label={`${percentage} — ${navigation.resetZoom}`}
            title={navigation.resetZoom}
            onClick={() => {
              const size = dimensions();
              setViewport(zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, 1));
              onInteract?.();
            }}
          >
            {percentage}
          </button>
          {icon(
            navigation.zoomIn,
            "plus",
            () => {
              const size = dimensions();
              setViewport(
                zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, viewport.zoom * 1.2),
              );
              onInteract?.();
            },
            false,
          )}
          {icon(
            t("canvas.fit"),
            "fit",
            () => {
              fit();
              onInteract?.();
            },
            false,
          )}
          {icon(
            copy.sourceContext,
            "objects",
            () => {
              fit(true);
              onInteract?.();
            },
            false,
          )}
        </div>
        <p className={styles.count}>
          {copy.canvasSummary.replace("{count}", formatNumber(locale, objects.length))}
        </p>
      </div>
      {asset ? (
        <dialog
          ref={assetDialog}
          className={`${styles.assetDialog} ${asset === "templates" ? styles.templates : ""}`}
          aria-labelledby={`${id}-asset`}
          onCancel={(event) => {
            event.preventDefault();
            closeAsset();
          }}
        >
          <form onSubmit={(event) => void addAsset(event)}>
            <div className={styles.panelHeader}>
              <h3 id={`${id}-asset`}>
                {asset === "templates"
                  ? tools.templates
                  : asset === "link"
                    ? editingAsset
                      ? editLinkLabel
                      : copy.addLink
                    : asset === "svg"
                      ? tools.uploadSvg
                      : copy.addImage}
              </h3>
              <button
                type="button"
                onClick={() => {
                  closeAsset();
                }}
                aria-label={tools.close}
              >
                <CanvasToolIcon name="close" />
              </button>
            </div>
            {asset === "templates" ? (
              <CanvasTemplateChooser value={template} onChange={setTemplate} browse />
            ) : asset === "link" ? (
              <>
                <label>
                  {t("boards.linkUrl")}
                  <input
                    type="url"
                    maxLength={2048}
                    required
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    disabled={locked}
                  />
                </label>
                <label>
                  {t("boards.linkLabel")}
                  <input
                    maxLength={160}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    disabled={locked}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  {t("boards.imageDescription")}
                  <input
                    maxLength={300}
                    required
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={locked}
                  />
                </label>
                <label>
                  {t("boards.chooseImage")}
                  <input
                    type="file"
                    accept={
                      asset === "svg" ? ".svg,image/svg+xml" : "image/jpeg,image/png,image/webp"
                    }
                    required
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    disabled={locked}
                  />
                </label>
                <p>{asset === "svg" ? tools.svgHelp : t("boards.imageHelp")}</p>
              </>
            )}
            {error ? (
              <p className={styles.error} role="alert">
                {errorMessage}
              </p>
            ) : null}
            <div className={styles.assetActions}>
              <button type="button" disabled={uploading} onClick={() => setAsset(null)}>
                {t("boards.cancel")}
              </button>
              <button
                className={styles.submit}
                type="submit"
                disabled={
                  locked ||
                  (asset === "templates"
                    ? !template
                    : asset === "link"
                      ? !url.trim()
                      : !file || !description.trim())
                }
              >
                {uploading
                  ? t("boards.uploading")
                  : editingAsset && asset === "link"
                    ? copy.saveLink
                    : copy.addToCanvas}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </dialog>
  );
}
