"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  CANVAS_MAX_OBJECTS,
  CANVAS_MAX_OPERATIONS,
  CanvasObjectCreateSchema,
  CanvasColorSchema,
  type CanvasTemplateId,
  type CanvasObject,
  type CanvasObjectCreate,
  type CanvasExportRegion,
} from "@openround/contracts";
import { Brand } from "../brand";
import { useLocale } from "../locale-provider";
import { GuardedLink, NavigationGuardProvider, useNavigationBlocker } from "../navigation-guard";
import { apiFetch, humanError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/i18n/format";
import { CanvasSurface, type CanvasPatch, type CanvasTool } from "./canvas-surface";
import {
  fitViewport,
  INITIAL_VIEWPORT,
  worldPoint,
  zoomAt,
  revealCanvasBounds,
  type CanvasPoint,
} from "./canvas-geometry";
import {
  canvasObjectLabel,
  canChangeObject,
  canPublishCanvasObject,
  newCanvasObject,
  nextCanvasPosition,
  reviewedCanvasCommand,
} from "./canvas-model";
import { useCanvasBoard } from "./use-canvas-board";
import { canvasPath, deleteCanvas } from "./canvas-client";
import { CanvasShareDialog } from "./canvas-share-dialog";
import { CanvasWorkshopControls } from "./workshop-controls";
import { useCanvasDraft } from "./use-canvas-draft";
import { CanvasDraftRecovery } from "./canvas-draft-recovery";
import { CanvasSelectionTools, canvasPlanMessage } from "./canvas-selection-tools";
import {
  canvasObjectBounds,
  canvasSelectionBounds,
  canvasSelectionPeers,
} from "./canvas-hierarchy";
import {
  newCanvasPen,
  canvasCreationFull,
  planCanvasDuplicate,
  planCanvasDelete,
  planCanvasTransform,
  planCanvasLock,
  resizeCanvasPatch,
  type CanvasPlan,
  type CanvasTransform,
} from "./canvas-productivity";
import { CanvasAssetTools } from "./canvas-asset-tools";
import { CanvasFacilitationPanel } from "./canvas-facilitation-panel";
import { CanvasExportDialog } from "./canvas-export-dialog";
import { CanvasPresenterControls } from "./canvas-presenter-controls";
import { canvasVisibleRegion, followCanvasRegion } from "./canvas-presentation";
import { canvasFacilitationCopy } from "../../lib/i18n/canvas-facilitation-messages";
import { canvasDiagramCopy } from "../../lib/i18n/canvas-diagram-messages";
import { CanvasDiagramInspector } from "./canvas-diagram-inspector";
import { canvasConnectorDraftPatch } from "./canvas-diagram-model";
import { planCanvasLayer } from "./canvas-productivity";
import { CanvasToolIcon, type CanvasToolIconName } from "./canvas-tool-icon";
import { CanvasToolPalette } from "./canvas-tool-palette";
import { canvasShapeCatalog } from "./canvas-tool-catalog";
import type {
  CanvasDrawSettings,
  CanvasPaletteObjectType,
  CanvasToolColor,
  CanvasPaletteShapeVariant,
} from "./canvas-tool-catalog";
import { CanvasContextToolbar, type CanvasConvertibleType } from "./canvas-context-toolbar";
import {
  planCanvasQuickStyle,
  planCanvasStickyStack,
  planCanvasTemplateInsert,
  planCanvasEraseStrokes,
} from "./canvas-tool-actions";
import { CanvasTemplateChooser } from "../idea-boards/canvas-template-chooser";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import { CanvasTopbar } from "./canvas-topbar";
import { CanvasInspectorDrawer } from "./canvas-inspector-drawer";
import { canvasChromeCopy } from "../../lib/i18n/canvas-chrome-messages";
import experience from "./canvas-context-toolbar.module.css";
import styles from "./canvas.module.css";

function CanvasChromeButton({
  label,
  icon,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children" | "title" | "aria-label"> & {
  label: string;
  icon: CanvasToolIconName;
}) {
  return (
    <button
      {...props}
      type="button"
      className={styles.chromeButton}
      aria-label={label}
      title={label}
    >
      <CanvasToolIcon name={icon} />
    </button>
  );
}

function CanvasEditorContent({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const facilitationCopy = canvasFacilitationCopy(locale);
  const diagramCopy = canvasDiagramCopy(locale);
  const toolCopy = canvasToolCopy(locale);
  const chromeCopy = canvasChromeCopy(locale);
  function objectLabel(object: CanvasObject, index: number) {
    if (object.type === "rect" && object.shapeVariant !== "rectangle") {
      const shape = canvasShapeCatalog.find(
        (entry) => entry.type === "rect" && entry.shapeVariant === object.shapeVariant,
      );
      if (shape)
        return canvasObjectLabel(
          object,
          `${toolCopy[shape.label]} ${formatNumber(locale, index + 1)}`,
        );
    }
    if (object.type === "diamond" || object.type === "parallelogram")
      return canvasObjectLabel(
        object,
        `${diagramCopy[object.type]} ${formatNumber(locale, index + 1)}`,
      );
    const name = t(
      object.type === "sticky"
        ? "canvas.sticky"
        : object.type === "text"
          ? "boards.textTool"
          : object.type === "rect"
            ? "boards.rectangleTool"
            : object.type === "ellipse"
              ? "boards.ellipseTool"
              : object.type === "connector"
                ? "canvas.connector"
                : object.type === "idea_ref"
                  ? "canvas.protected"
                  : object.type === "frame"
                    ? "canvas.productivity.frame"
                    : object.type === "pen"
                      ? "canvas.productivity.pen"
                      : object.type === "image"
                        ? "canvas.assets.image"
                        : "boards.elementSettings",
    );
    return canvasObjectLabel(object, `${name} ${formatNumber(locale, index + 1)}`);
  }
  const state = useCanvasBoard(id);
  const board = state.board;
  const creationFull = Boolean(board && canvasCreationFull(board));
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [gestureActive, setGestureActive] = useState(false);
  const [planError, setPlanError] = useState<CanvasPlan["reason"]>(null);
  const [revealIds, setRevealIds] = useState<string[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [drawSettings, setDrawSettings] = useState<CanvasDrawSettings>({
    mode: "pen",
    color: "blue",
    width: 3,
  });
  const [stickyColor, setStickyColor] = useState<CanvasToolColor>("yellow");
  const [connectorPreset, setConnectorPreset] = useState<"line" | "arrow" | "elbow">("arrow");
  const [assetRequest, setAssetRequest] = useState<{
    kind: "image" | "link" | "svg";
    id: number;
  }>();
  const [inlineEditing, setInlineEditing] = useState(false);
  const [editTextRequest, setEditTextRequest] = useState<{ id: string; nonce: number }>();
  const [templates, setTemplates] = useState(false);
  const [templateId, setTemplateId] = useState<CanvasTemplateId | null>(null);
  const templateDialog = useRef<HTMLDialogElement>(null);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [sharing, setSharing] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("objects");
  const [compactViewport, setCompactViewport] = useState(false);
  const inspectorReturnFocus = useRef<HTMLElement | null>(null);
  const [facilitationMounted, setFacilitationMounted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [visibleRegion, setVisibleRegion] = useState<CanvasExportRegion | null>(null);
  const [navigation, setNavigation] = useState(0);
  const followedRegion = useRef<CanvasExportRegion | null>(null);
  const [presence, setPresence] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteAttempted, setDeleteAttempted] = useState(false);
  const deleted = useRef(false);
  const active = useRef(true);
  const [members, setMembers] = useState<
    Array<{ userId: string; name: string; cursor: CanvasPoint | null }>
  >([]);
  const [connectorFrom, setConnectorFrom] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stopFollowing = useCallback(() => {
    followedRegion.current = null;
    setNavigation((value) => value + 1);
  }, []);
  const followRegion = useCallback((region: CanvasExportRegion | null) => {
    followedRegion.current = region;
    const element = stage.current;
    if (!region || !element) return;
    const next = followCanvasRegion(region, element.clientWidth, element.clientHeight);
    if (next)
      setViewport((previous) =>
        previous.x === next.x && previous.y === next.y && previous.zoom === next.zoom
          ? previous
          : next,
      );
  }, []);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !board) return;
    const update = () => {
      const region = canvasVisibleRegion(viewport, element.clientWidth, element.clientHeight);
      setVisibleRegion((previous) =>
        JSON.stringify(previous) === JSON.stringify(region) ? previous : region,
      );
      if (followedRegion.current) followRegion(followedRegion.current);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [board?.id, viewport, followRegion]);
  const cursor = useRef<CanvasPoint | null>(null);
  const restoredTool = useRef<CanvasTool | null>(null);
  const {
    selectedId,
    selected,
    localDraft,
    dirty,
    draft,
    recovery,
    setDraft,
    acceptSelection: acceptPrimarySelection,
  } = useCanvasDraft(id, board, {
    locked: state.saving || deleting,
    pending: state.failure !== null,
    confirmDiscard: () => window.confirm(t("canvas.discard")),
    onDiscardPending: state.discard,
  });
  const selectedIds = board
    ? selectionIds.includes(selectedId ?? "")
      ? selectionIds.filter((id) => board.objects.some((object) => object.id === id))
      : selected
        ? [selected.id]
        : []
    : [];
  function acceptMany(ids: string[]) {
    acceptPrimarySelection(ids[0] ?? null);
    setSelectionIds(ids);
  }
  function acceptSelection(id: string | null) {
    acceptMany(id ? [id] : []);
  }
  useLayoutEffect(() => {
    if (!board || !revealIds.length) return;
    const bounds = canvasSelectionBounds(board.objects, revealIds);
    if (bounds && stage.current)
      setViewport((current) =>
        revealCanvasBounds(
          current,
          bounds,
          stage.current!.clientWidth,
          stage.current!.clientHeight,
        ),
      );
    setRevealIds([]);
  }, [board, revealIds]);
  const blocked = useCallback(
    () =>
      !deleted.current &&
      (dirty ||
        state.saving ||
        state.failure !== null ||
        deleting ||
        gestureActive ||
        inlineEditing),
    [dirty, state.saving, state.failure, deleting, gestureActive, inlineEditing],
  );
  useNavigationBlocker(blocked);
  const busy = state.saving || state.failure !== null || deleting;
  const uiBusy = busy || gestureActive || inlineEditing;
  const editable = Boolean(board && selected && canChangeObject(board, selected));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (window.matchMedia?.("(pointer: coarse)").matches) setTool("hand");
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setSelectionIds([]);
    setInspectorOpen(false);
    setInspectorTab("objects");
    setFacilitationMounted(false);
    setSharing(false);
    setViewport(INITIAL_VIEWPORT);
  }, [id]);
  useEffect(() => {
    function closeTools() {
      setInspectorOpen(false);
      setFacilitationMounted(false);
      setTemplates(false);
      setTemplateId(null);
      setAssetRequest(undefined);
      setEditTextRequest(undefined);
    }
    window.addEventListener(AUTH_CHANGE_EVENT, closeTools);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, closeTools);
  }, []);
  useEffect(() => {
    if (!board) {
      setInspectorOpen(false);
      setFacilitationMounted(false);
      setTemplates(false);
      setEditTextRequest(undefined);
      setAssetRequest(undefined);
    }
  }, [Boolean(board)]);
  useEffect(() => {
    if (board?.boardType === "workshop" && board.capabilities.facilitate) {
      setInspectorTab("workshop");
      setInspectorOpen(true);
    }
  }, [board?.id, board?.boardType, board?.capabilities.facilitate]);
  useEffect(() => {
    if (!templates) return;
    const element = templateDialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [templates]);
  useEffect(() => {
    if (!presence || !board) {
      setMembers([]);
      return;
    }
    const active = new AbortController();
    const path = `${canvasPath(id)}/presence`;
    let running = false;
    async function update() {
      if (running || active.signal.aborted) return;
      running = true;
      try {
        await apiFetch(path, {
          method: "PUT",
          signal: active.signal,
          body: JSON.stringify({ cursor: cursor.current }),
        });
        const response = await apiFetch<{ members: typeof members }>(path, {
          signal: active.signal,
          cache: "no-store",
        });
        if (!active.signal.aborted) setMembers(response.members);
      } catch {
        if (!active.signal.aborted) setMembers([]);
      } finally {
        running = false;
      }
    }
    void update();
    const timer = setInterval(() => void update(), 3000);
    return () => {
      active.abort();
      clearInterval(timer);
      void apiFetch(path, { method: "DELETE" }).catch(() => undefined);
    };
  }, [id, presence, Boolean(board)]);

  function showInspector(tab: string) {
    if (inlineEditing || gestureActive) return;
    if (!inspectorOpen)
      inspectorReturnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (tab === "facilitation") setFacilitationMounted(true);
    setInspectorTab(tab);
    setInspectorOpen(true);
  }
  function closeInspector() {
    if (!inlineEditing && !gestureActive) setInspectorOpen(false);
  }
  function toggleInspector(tab: string) {
    if (inspectorOpen && inspectorTab === tab) closeInspector();
    else showInspector(tab);
  }
  function selectMany(ids: string[], additive = false, reveal = true, fromGesture = false) {
    if (!board || state.saving || deleting || inlineEditing || (gestureActive && !fromGesture))
      return;
    const peers = canvasSelectionPeers(board.objects, ids);
    const next = additive ? [...new Set([...selectedIds, ...peers])] : peers;
    if (next.length === selectedIds.length && next.every((id) => selectedIds.includes(id))) return;
    if ((dirty || state.failure) && !window.confirm(t("canvas.discard"))) return;
    if (state.failure) state.discard();
    acceptMany(next);
    if (reveal) showInspector(next.length > 1 ? "arrange" : "properties");
  }
  function changeSelection(next: string | null, additive = false, revealInspector = true) {
    if (!board) return;
    if (additive && next) {
      const peers = canvasSelectionPeers(board.objects, [next]);
      if (peers.every((id) => selectedIds.includes(id)))
        selectMany(
          selectedIds.filter((id) => !peers.includes(id)),
          false,
          revealInspector,
        );
      else selectMany(peers, true, revealInspector);
    } else selectMany(next ? [next] : [], false, revealInspector && next !== selectedId);
  }
  async function perform(plan: CanvasPlan) {
    if (busy || dirty) return false;
    if (!plan.command) {
      setPlanError(plan.reason);
      return false;
    }
    setPlanError(null);
    if (await state.execute(plan.command)) {
      acceptMany(plan.selection);
      if (plan.command.operations.some((operation) => operation.type === "create"))
        setRevealIds(plan.selection);
      return true;
    }
    return false;
  }
  async function transform(
    ids: string[],
    value: CanvasTransform,
    originalObjects = board?.objects,
  ) {
    if (!board || !originalObjects) return false;
    return perform(planCanvasTransform({ ...board, objects: originalObjects }, ids, value));
  }
  async function createObject(object: CanvasObjectCreate) {
    if (!board?.capabilities.edit || busy || dirty) return false;
    if (creationFull) {
      setPlanError("objects");
      return false;
    }
    const preferred = worldPoint(
      {
        x: (stage.current?.clientWidth ?? 900) / 2 - object.width / 2,
        y: (stage.current?.clientHeight ?? 650) / 2 - object.height / 2,
      },
      viewport,
    );
    const created = {
      ...object,
      ...nextCanvasPosition(board.objects, preferred, object.width, object.height),
      parentId: null,
      geometricGroupId: null,
      visibility: "team" as const,
    };
    if (await state.execute({ type: "batch", operations: [{ type: "create", object: created }] })) {
      acceptSelection(created.id);
      setRevealIds([created.id]);
      if (!window.matchMedia("(max-width: 760px)").matches) showInspector("properties");
      return true;
    }
    return false;
  }
  async function createPen(points: [number, number][]) {
    if (!board?.capabilities.edit || busy || dirty) return false;
    if (creationFull) {
      setPlanError("objects");
      return false;
    }
    try {
      const object = newCanvasPen(points, {
        color: drawSettings.color,
        strokeWidth: drawSettings.width,
        opacity: drawSettings.mode === "highlighter" ? 0.35 : 1,
      });
      if (!object) return false;
      if (await state.execute({ type: "batch", operations: [{ type: "create", object }] })) {
        acceptSelection(object.id);
        setRevealIds([object.id]);
        return true;
      }
    } catch {
      setPlanError("bounds");
    }
    return false;
  }
  function fit(selection = false) {
    if (!board) return;
    setViewport(
      fitViewport(
        selection && selectedIds.length
          ? [canvasSelectionBounds(board.objects, selectedIds)!]
          : board.objects.map((object) => canvasObjectBounds(object, board.objects)),
        stage.current?.clientWidth ?? 1000,
        stage.current?.clientHeight ?? 650,
      ),
    );
  }
  async function add(
    type: CanvasPaletteObjectType,
    options?: { color?: CanvasToolColor; shapeVariant?: CanvasPaletteShapeVariant },
  ) {
    if (
      !board?.capabilities.edit ||
      busy ||
      creationFull ||
      (dirty && !window.confirm(t("canvas.discard")))
    )
      return;
    const point = worldPoint(
      {
        x: (stage.current?.clientWidth ?? 900) / 2 - 100,
        y: (stage.current?.clientHeight ?? 650) / 2 - 80,
      },
      viewport,
    );
    const seed = newCanvasObject(
      type,
      nextCanvasPosition(
        board.objects,
        point,
        type === "text" ? 280 : 220,
        type === "text" ? 100 : 160,
      ),
      type === "text"
        ? t("boards.newText")
        : type === "frame"
          ? t("canvas.productivity.frame")
          : "",
    );
    const object = CanvasObjectCreateSchema.parse({
      ...seed,
      ...(options?.color
        ? { color: options.color }
        : type === "sticky"
          ? { color: stickyColor }
          : {}),
      ...(type === "rect" && options?.shapeVariant ? { shapeVariant: options.shapeVariant } : {}),
    });
    if (type === "sticky" && options?.color) setStickyColor(options.color);
    if (type === "frame") {
      object.width = 440;
      object.height = 300;
      object.zIndex = -1;
    }
    if (await state.execute({ type: "batch", operations: [{ type: "create", object }] })) {
      acceptSelection(object.id);
      setRevealIds([object.id]);
      setTool("select");
      if (!window.matchMedia("(max-width: 760px)").matches) showInspector("properties");
    }
  }
  async function duplicate() {
    if (board) await perform(planCanvasDuplicate(board, selectedIds));
  }
  async function remove() {
    if (board) await perform(planCanvasDelete(board, selectedIds));
  }
  async function deleteBoard() {
    if (
      busy ||
      dirty ||
      (!deleteAttempted &&
        (!board ||
          board.boardType !== "team" ||
          !board.capabilities.delete ||
          !window.confirm(t("canvas.deleteConfirm"))))
    )
      return;
    setDeleteAttempted(true);
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteCanvas(id);
      if (!active.current) return;
      deleted.current = true;
      window.location.assign("/boards");
    } catch (error) {
      if (active.current) {
        setDeleteError(humanError(error));
        setDeleting(false);
      }
    }
  }
  async function connect(next: string) {
    if (!board?.capabilities.edit || busy || dirty || creationFull) return;
    if (!connectorFrom) {
      setConnectorFrom(next);
      changeSelection(next, false, false);
      return;
    }
    if (connectorFrom === next) return;
    const from = board.objects.find((object) => object.id === connectorFrom),
      to = board.objects.find((object) => object.id === next);
    if (!from || !to) return;
    const object = newCanvasObject("connector", { x: from.x, y: from.y });
    if (object.type !== "connector") return;
    object.from = {
      objectId: from.id,
      x: from.x + from.width / 2,
      y: from.y + from.height / 2,
      anchor:
        Math.abs(to.x + to.width / 2 - from.x - from.width / 2) >=
        Math.abs(to.y + to.height / 2 - from.y - from.height / 2)
          ? to.x + to.width / 2 >= from.x + from.width / 2
            ? "right"
            : "left"
          : to.y + to.height / 2 >= from.y + from.height / 2
            ? "bottom"
            : "top",
    };
    object.to = {
      objectId: to.id,
      x: to.x + to.width / 2,
      y: to.y + to.height / 2,
      anchor:
        Math.abs(to.x + to.width / 2 - from.x - from.width / 2) >=
        Math.abs(to.y + to.height / 2 - from.y - from.height / 2)
          ? to.x + to.width / 2 >= from.x + from.width / 2
            ? "left"
            : "right"
          : to.y + to.height / 2 >= from.y + from.height / 2
            ? "top"
            : "bottom",
    };
    object.routing = connectorPreset === "elbow" ? "elbow" : "straight";
    object.endMarker = connectorPreset === "line" ? "none" : "arrow";
    if (await state.execute({ type: "batch", operations: [{ type: "create", object }] })) {
      acceptSelection(object.id);
      setRevealIds([object.id]);
      setConnectorFrom(null);
      setTool("select");
    }
  }
  async function createConnector(
    from: Extract<CanvasObject, { type: "connector" }>["from"],
    to: Extract<CanvasObject, { type: "connector" }>["to"],
  ) {
    if (!board?.capabilities.edit || busy || dirty || creationFull) return false;
    const object = CanvasObjectCreateSchema.parse({
      ...newCanvasObject("connector", { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) }),
      from,
      to,
      routing: connectorPreset === "elbow" ? "elbow" : "straight",
      endMarker: connectorPreset === "line" ? "none" : "arrow",
    });
    if (await state.execute({ type: "batch", operations: [{ type: "create", object }] })) {
      acceptSelection(object.id);
      setConnectorFrom(null);
      return true;
    }
    return false;
  }
  async function quickStyle(patch: CanvasPatch) {
    if (board) await perform(planCanvasQuickStyle(board, selectedIds, patch));
  }
  async function eraseStrokes(strokes: Extract<CanvasObject, { type: "pen" }>[]) {
    if (!board || inlineEditing) return false;
    const plan = planCanvasEraseStrokes(board, strokes);
    const erased = new Set(strokes.map((object) => object.id));
    return perform({ ...plan, selection: selectedIds.filter((id) => !erased.has(id)) });
  }
  async function commitText(original: CanvasObject, text: string) {
    if (!board || busy || dirty) return false;
    const current = board.objects.find((object) => object.id === original.id);
    if (!current || !canChangeObject(board, current) || current.type === "idea_ref") return false;
    return state.execute({
      type: "batch",
      operations: [
        { type: "update", id: original.id, expectedVersion: original.version, patch: { text } },
      ],
    });
  }
  function creationPoint() {
    return worldPoint(
      {
        x: (stage.current?.clientWidth ?? 900) / 2 - 110,
        y: (stage.current?.clientHeight ?? 650) / 2 - 80,
      },
      viewport,
    );
  }
  async function addStack(count: number, color: CanvasToolColor) {
    if (!board) return;
    setStickyColor(color);
    await perform(planCanvasStickyStack(board, creationPoint(), count, color));
  }
  async function insertTemplate() {
    if (!board || !templateId || busy || dirty) return;
    const plan = planCanvasTemplateInsert(board, creationPoint(), templateId);
    if (!plan.command) {
      setPlanError(plan.reason);
      return;
    }
    const success = await perform(plan);
    setTemplates(false);
    if (success) setInspectorOpen(false);
  }
  async function saveProperties(event: FormEvent) {
    event.preventDefault();
    if (!board || !selected || !localDraft || !editable || busy) return;
    const value = localDraft;
    const connector =
      selected.type === "connector" ? canvasConnectorDraftPatch(selected, value) : null;
    if (connector && !connector.success) {
      setPlanError("bounds");
      return;
    }
    const patchValue: CanvasPatch = connector?.success
      ? connector.data
      : resizeCanvasPatch(selected, {
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height,
        });
    if (selected.type !== "idea_ref" && selected.type !== "connector") {
      patchValue.text = value.text;
      patchValue.color = value.color;
      patchValue.rotation = value.rotation;
    }
    if (selected.type !== "idea_ref")
      Object.assign(patchValue, {
        fontSize: value.fontSize,
        fontFamily: value.fontFamily,
        fontWeight: value.fontWeight,
        fontStyle: value.fontStyle,
        textDecoration: value.textDecoration,
        textAlign: value.textAlign,
        strokeWidth: value.strokeWidth,
        opacity: value.opacity,
      });
    if (selected.type === "rect" && value.shapeVariant)
      patchValue.shapeVariant = value.shapeVariant;
    if (canPublishCanvasObject(board, selected)) patchValue.visibility = value.visibility;
    if (selected.type === "image") patchValue.altText = value.altText ?? selected.altText;
    if (selected.type === "link") patchValue.url = value.url ?? selected.url;
    const moved = planCanvasTransform(board, [selected.id], {
      type: "move",
      dx: value.x - selected.x,
      dy: value.y - selected.y,
    });
    const geometryChanged =
      selected.type !== "connector" && (value.x !== selected.x || value.y !== selected.y);
    if (geometryChanged && !moved.command) {
      setPlanError(moved.reason);
      return;
    }
    const operations = geometryChanged && moved.command ? moved.command.operations : [];
    const own = operations.find(
      (operation) => operation.type === "update" && operation.id === selected.id,
    );
    if (own?.type === "update") {
      own.expectedVersion = value.version;
      own.patch = { ...own.patch, ...patchValue };
    } else
      operations.push({
        type: "update",
        id: selected.id,
        expectedVersion: value.version,
        patch: patchValue,
      });
    try {
      if (await state.execute({ type: "batch", operations })) setDraft(null);
    } catch {
      setPlanError("bounds");
    }
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (
      event.nativeEvent.isComposing ||
      (event.target instanceof HTMLElement &&
        (event.target.matches("input,textarea,select") ||
          event.target.isContentEditable ||
          event.target.closest("button,a,summary,[role=tab],[role=tablist],[role=tabpanel]")))
    )
      return;
    if (gestureActive || inlineEditing) return;
    if (event.code === "Space" && !event.repeat && event.target instanceof SVGElement) {
      event.preventDefault();
      restoredTool.current = tool;
      setTool("hand");
      return;
    }
    if (!board || busy) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "a" &&
      event.target instanceof SVGElement
    ) {
      event.preventDefault();
      selectMany(board.objects.map((object) => object.id));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      const targetOperationId = event.shiftKey ? board.redoOperationId : board.undoOperationId;
      if (targetOperationId && board.capabilities.edit && !dirty) {
        event.preventDefault();
        void state.execute({ type: event.shiftKey ? "redo" : "undo", targetOperationId });
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selected) {
      event.preventDefault();
      void duplicate();
    } else if (
      selected &&
      editable &&
      !dirty &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      void transform(selectedIds, {
        type: "move",
        dx: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
        dy: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
      });
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selected &&
      editable &&
      !dirty
    ) {
      event.preventDefault();
      void remove();
    } else if (event.key === "Escape") {
      setConnectorFrom(null);
      setTool("select");
    }
  }
  async function reviewedRetry() {
    if (!board || !state.failure) return;
    const command = reviewedCanvasCommand(board, state.failure.operation.command);
    if (!command) return;
    state.discard();
    if (await state.execute(command)) setDraft(null);
  }
  async function retryPending() {
    if (await state.execute()) setDraft(null);
  }
  function discardPending() {
    state.discard();
    setDraft(null);
  }

  if (!board)
    return (
      <main className={styles.access}>
        <Brand />
        <h1>{t("canvas.team")}</h1>
        {draft && recovery ? (
          <CanvasDraftRecovery
            draft={draft}
            reason={recovery}
            disabled={state.saving}
            onDiscard={discardPending}
          />
        ) : null}
        {state.loading ? (
          <p role="status">{t("boards.loading")}</p>
        ) : (
          <>
            <p role="alert" lang="en-CA">
              {state.error || t("boards.unavailable")}
            </p>
            {deleteAttempted ? (
              <>
                {deleting ? <p role="status">{t("canvas.saving")}</p> : null}
                {deleteError ? (
                  <p className="error" role="alert" lang="en-CA">
                    {deleteError}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="button"
                  disabled={deleting}
                  onClick={() => void deleteBoard()}
                >
                  {t("boards.retry")}
                </button>
              </>
            ) : null}
            <button type="button" className="button" onClick={() => void state.refresh()}>
              {t("boards.refresh")}
            </button>
            <GuardedLink href={`/signin?returnTo=${encodeURIComponent(`/canvas/${id}`)}`}>
              {t("canvas.signIn")}
            </GuardedLink>
            <GuardedLink href="/boards">{t("boards.back")}</GuardedLink>
          </>
        )}
      </main>
    );
  const frozen = !board.capabilities.edit;
  return (
    <main
      className={styles.editor}
      onKeyDown={keyboard}
      onKeyUp={(event) => {
        if (gestureActive) return;
        if (event.code === "Space" && restoredTool.current) {
          setTool(restoredTool.current);
          restoredTool.current = null;
        }
      }}
    >
      <CanvasTopbar
        panelReturnFocusRef={inspectorReturnFocus}
        title={board.title}
        subtitle={
          <>
            {board.organizationName ? `${board.organizationName} · ` : ""}
            {board.workspaceName ?? board.title} ·{" "}
            {t(board.role === "owner" ? "role.owner" : `canvas.${board.role}`)}
          </>
        }
        backLink={
          <GuardedLink
            className={styles.chromeButton}
            href="/boards"
            aria-label={t("boards.title")}
            title={t("boards.title")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m14 5-7 7 7 7M7 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </GuardedLink>
        }
        saveStatus={
          <span className={styles.saveStatus} role="status">
            {state.saving || gestureActive
              ? t("canvas.saving")
              : state.failure
                ? t("canvas.conflict")
                : dirty
                  ? chromeCopy.unsaved
                  : t(`canvas.${state.connection}`)}
          </span>
        }
        history={
          <>
            <CanvasChromeButton
              icon="undo"
              label={t("boards.undo")}
              disabled={frozen || uiBusy || dirty || !board.undoOperationId}
              onClick={() =>
                board.undoOperationId &&
                void state.execute({ type: "undo", targetOperationId: board.undoOperationId })
              }
            />
            <CanvasChromeButton
              icon="redo"
              label={t("boards.redo")}
              disabled={frozen || uiBusy || dirty || !board.redoOperationId}
              onClick={() =>
                board.redoOperationId &&
                void state.execute({ type: "redo", targetOperationId: board.redoOperationId })
              }
            />
          </>
        }
        assets={
          <CanvasAssetTools
            hideButtons
            board={board}
            openRequest={assetRequest}
            disabled={frozen || uiBusy || dirty || creationFull}
            onCreate={createObject}
          />
        }
        insertActions={(
          [
            {
              id: "image",
              label: t("canvas.assets.image"),
              icon: "image" as const,
              disabled: frozen || uiBusy || dirty || creationFull || !board.imageUploadsAvailable,
            },
            {
              id: "link",
              label: t("canvas.assets.link"),
              icon: "link" as const,
              disabled: frozen || uiBusy || dirty || creationFull,
            },
            {
              id: "svg",
              label: toolCopy.uploadSvg,
              icon: "upload-svg" as const,
              disabled: frozen || uiBusy || dirty || creationFull || !board.imageUploadsAvailable,
            },
          ] as const
        ).map((action) => ({
          ...action,
          onSelect: () =>
            setAssetRequest((previous) => ({ kind: action.id, id: (previous?.id ?? 0) + 1 })),
        }))}
        panels={
          <>
            <CanvasChromeButton
              icon="objects"
              label={t("canvas.objects")}
              disabled={inlineEditing || gestureActive}
              aria-expanded={inspectorOpen && inspectorTab === "objects"}
              onClick={() => toggleInspector("objects")}
            />
            <CanvasChromeButton
              icon="facilitation"
              label={facilitationCopy.title}
              disabled={inlineEditing || gestureActive}
              aria-expanded={inspectorOpen && inspectorTab === "facilitation"}
              onClick={() => toggleInspector("facilitation")}
            />
            <CanvasChromeButton
              icon="export"
              label={t("canvas.export.open")}
              disabled={uiBusy || dirty}
              onClick={() => setExporting(true)}
            />
            {board.boardType === "workshop" && board.capabilities.facilitate ? (
              <CanvasChromeButton
                icon="workshop"
                label={t("canvas.workshop.controls")}
                disabled={inlineEditing || gestureActive}
                aria-expanded={inspectorOpen && inspectorTab === "workshop"}
                onClick={() => toggleInspector("workshop")}
              />
            ) : null}
            <CanvasChromeButton
              icon="more"
              label={chromeCopy.details}
              disabled={inlineEditing || gestureActive}
              aria-expanded={inspectorOpen && inspectorTab === "board"}
              onClick={() => toggleInspector("board")}
            />
          </>
        }
        presenter={
          <CanvasPresenterControls
            compact
            boardId={board.id}
            objects={board.objects}
            canPresent={board.capabilities.facilitate}
            viewportRegion={visibleRegion}
            sourceBoardId={board.sourceBoardId ?? undefined}
            publishedFrameId={
              selected?.type === "frame" && selected.visibility === "published" ? selected.id : null
            }
            cancelKey={navigation}
            onFollow={followRegion}
          />
        }
        share={
          board.capabilities.share ? (
            <CanvasChromeButton
              icon="share"
              label={t("canvas.share")}
              onClick={() => setSharing(true)}
              disabled={uiBusy || dirty}
            />
          ) : null
        }
      />
      {frozen ? <p className={styles.readOnlyNotice}>{t("canvas.readOnly")}</p> : null}
      {tool === "connector" ? (
        <p className={styles.readOnlyNotice} role="status">
          {t("canvas.connectHelp")}
        </p>
      ) : null}
      {state.failure && !recovery ? (
        <section className={styles.failure} role="alert">
          <strong>{t(state.failure.conflict ? "canvas.conflict" : "canvas.offline")}</strong>
          <p>{t("canvas.conflictHelp")}</p>
          <ul>
            {state.failure.operation.command.type === "batch"
              ? state.failure.operation.command.operations.map((operation, index) => (
                  <li key={index}>
                    {operation.type === "create"
                      ? operation.object.text
                      : operation.type === "update"
                        ? (operation.patch.text ??
                          `${operation.patch.x ?? ""}, ${operation.patch.y ?? ""}`)
                        : t("boards.deleteElement")}
                  </li>
                ))
              : null}
          </ul>
          <div className={styles.actions}>
            {state.failure.conflict ? (
              <button
                type="button"
                className="button"
                disabled={!reviewedCanvasCommand(board, state.failure.operation.command)}
                onClick={() => void reviewedRetry()}
              >
                {t("canvas.applyReviewed")}
              </button>
            ) : (
              <button type="button" className="button" onClick={() => void retryPending()}>
                {t("boards.retry")}
              </button>
            )}
            <button type="button" className="button-quiet" onClick={discardPending}>
              {t("canvas.discard")}
            </button>
          </div>
        </section>
      ) : null}
      {planError ? (
        <p className={styles.readOnlyNotice} role="alert">
          {t(canvasPlanMessage(planError))}
        </p>
      ) : null}
      {tool === "pen" ? (
        <p className={styles.readOnlyNotice}>{t("canvas.productivity.penHelp")}</p>
      ) : null}
      {state.error ? (
        <p className={styles.readOnlyNotice} role="alert" lang="en-CA">
          {state.error}
        </p>
      ) : null}
      {draft && recovery ? (
        <CanvasDraftRecovery
          draft={draft}
          reason={recovery}
          disabled={state.saving}
          onDiscard={discardPending}
        />
      ) : null}
      <div
        className={`${styles.workArea} ${experience.workArea}`}
        data-sidebar-open={inspectorOpen}
      >
        <div
          inert={compactViewport && inspectorOpen}
          aria-hidden={compactViewport && inspectorOpen}
        >
          <CanvasToolPalette
            activeTool={tool}
            disabled={uiBusy || dirty}
            readOnly={frozen}
            creationFull={creationFull}
            drawSettings={drawSettings}
            selectedStickyColor={stickyColor}
            stickyStackLimit={Math.max(
              0,
              Math.min(
                20,
                CANVAS_MAX_OBJECTS - board.objects.length,
                board.boardType === "workshop"
                  ? 300 - board.objects.filter((object) => object.type !== "idea_ref").length
                  : 20,
              ),
            )}
            svgUploadDisabled={!board.imageUploadsAvailable}
            onAdd={(type, options) => void add(type, options)}
            onTool={(next) => {
              if (!uiBusy) {
                setTool(next);
                if (next !== "connector") setConnectorFrom(null);
              }
            }}
            onConnector={(preset) => {
              if (!frozen && !uiBusy && !dirty && !creationFull) {
                setConnectorPreset(preset);
                setTool("connector");
                setConnectorFrom(selectedId);
              }
            }}
            onDrawSettings={(settings) => {
              if (
                !frozen &&
                !uiBusy &&
                Number.isFinite(settings.width) &&
                settings.width >= 1 &&
                settings.width <= 24
              )
                setDrawSettings(settings);
            }}
            onUploadSvg={() =>
              setAssetRequest((previous) => ({ kind: "svg", id: (previous?.id ?? 0) + 1 }))
            }
            onTemplates={() => {
              setPlanError(null);
              setTemplateId(null);
              setTemplates(true);
            }}
            onStickyStack={(count, color) => void addStack(count, color)}
          />
        </div>
        <div className={styles.workspace} data-inspector-open={inspectorOpen}>
          <div
            className={styles.stage}
            ref={stage}
            inert={compactViewport && inspectorOpen}
            aria-hidden={compactViewport && inspectorOpen}
          >
            <CanvasSurface
              objects={board.objects}
              viewport={viewport}
              onViewport={setViewport}
              onInteract={stopFollowing}
              selectedId={selectedId}
              selectedIds={selectedIds}
              onSelectMany={(ids, additive) => selectMany(ids, additive, false, true)}
              onTransform={transform}
              onCreatePen={createPen}
              onCreateConnector={createConnector}
              onErasePen={eraseStrokes}
              penColor={drawSettings.color}
              penWidth={drawSettings.width}
              penOpacity={drawSettings.mode === "highlighter" ? 0.35 : 1}
              onCommitText={commitText}
              onTextEditingChange={setInlineEditing}
              editTextRequest={editTextRequest}
              onGestureActive={setGestureActive}
              onSelect={(next, additive) => changeSelection(next, additive, false)}
              tool={tool}
              canEdit={board.capabilities.edit && !busy && !dirty}
              canCreate={board.capabilities.edit && !busy && !dirty && !creationFull}
              canFacilitate={board.capabilities.facilitate}
              isObjectEditable={(object) => canChangeObject(board, object)}
              onConnect={(next) => void connect(next)}
              onCursor={(point) => {
                cursor.current = point;
              }}
              members={members}
              canvasId={board.id}
              sourceBoardId={board.sourceBoardId ?? undefined}
              sourceBoard={board.sourceBoard}
            />
            {selectedIds.length && !inlineEditing ? (
              <div className={experience.dock}>
                <CanvasContextToolbar
                  objects={board.objects.filter((object) => selectedIds.includes(object.id))}
                  disabled={uiBusy || dirty}
                  editable={
                    selectedIds.length <= CANVAS_MAX_OPERATIONS &&
                    board.objects
                      .filter((object) => selectedIds.includes(object.id))
                      .every((object) => canChangeObject(board, object))
                  }
                  canLock={Boolean(
                    planCanvasLock(
                      board,
                      selectedIds,
                      !board.objects
                        .filter((object) => selectedIds.includes(object.id))
                        .every((object) => object.locked),
                    ).command,
                  )}
                  canDuplicate={
                    selectedIds.length <= CANVAS_MAX_OPERATIONS &&
                    board.objects
                      .filter((object) => selectedIds.includes(object.id))
                      .every(
                        (object) => object.type !== "idea_ref" && canChangeObject(board, object),
                      )
                  }
                  canDelete={
                    selectedIds.length <= CANVAS_MAX_OPERATIONS &&
                    board.objects
                      .filter((object) => selectedIds.includes(object.id))
                      .every(
                        (object) => object.type !== "idea_ref" && canChangeObject(board, object),
                      )
                  }
                  onPatch={(patch) => void quickStyle(patch)}
                  onConvert={(type: CanvasConvertibleType) => void quickStyle({ type })}
                  onLock={(locked) => void perform(planCanvasLock(board, selectedIds, locked))}
                  onDuplicate={() => void duplicate()}
                  onDelete={() => void remove()}
                  onEditText={() =>
                    selected &&
                    setEditTextRequest((previous) => ({
                      id: selected.id,
                      nonce: (previous?.nonce ?? 0) + 1,
                    }))
                  }
                  onMore={() => showInspector(selectedIds.length > 1 ? "arrange" : "properties")}
                />
              </div>
            ) : null}
            {!board.objects.length ? (
              <p className={styles.emptyCanvas}>{t("canvas.empty")}</p>
            ) : null}
            <div
              className={styles.navigation}
              role="group"
              aria-label={t("canvas.zoom")}
              onClickCapture={stopFollowing}
            >
              <CanvasChromeButton icon="fit" label={t("canvas.fit")} onClick={() => fit()} />
              <CanvasChromeButton
                icon="fit-selection"
                label={t("canvas.fitSelection")}
                disabled={!selected}
                onClick={() => fit(true)}
              />
              <span className={styles.divider} aria-hidden="true" />
              <CanvasChromeButton
                icon="minus"
                label={t("canvas.zoom") + " −"}
                onClick={() =>
                  setViewport(
                    zoomAt(
                      viewport,
                      {
                        x: (stage.current?.clientWidth ?? 900) / 2,
                        y: (stage.current?.clientHeight ?? 650) / 2,
                      },
                      viewport.zoom / 1.25,
                    ),
                  )
                }
              />
              <output>
                {formatNumber(locale, viewport.zoom, {
                  style: "percent",
                  maximumFractionDigits: 0,
                })}
              </output>
              <CanvasChromeButton
                icon="plus"
                label={t("canvas.zoom") + " +"}
                onClick={() =>
                  setViewport(
                    zoomAt(
                      viewport,
                      {
                        x: (stage.current?.clientWidth ?? 900) / 2,
                        y: (stage.current?.clientHeight ?? 650) / 2,
                      },
                      viewport.zoom * 1.25,
                    ),
                  )
                }
              />
            </div>
          </div>
          <CanvasInspectorDrawer
            returnFocusRef={inspectorReturnFocus}
            open={inspectorOpen}
            disabled={inlineEditing || gestureActive}
            title={chromeCopy.inspector}
            tab={inspectorTab}
            onTabChange={showInspector}
            onClose={closeInspector}
            tabs={[
              {
                id: "objects",
                label: chromeCopy.objects,
                icon: <CanvasToolIcon name="objects" />,
                content: (
                  <div className={styles.objectsPanel}>
                    <details open>
                      <summary>
                        {t("canvas.objects")} · {formatNumber(locale, board.objects.length)}
                      </summary>
                      <ol className={styles.outline}>
                        {board.objects.map((object, index) => (
                          <li key={object.id} className={styles.outlineRow}>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(object.id)}
                              disabled={uiBusy}
                              aria-label={t("canvas.productivity.select", {
                                label: objectLabel(object, index),
                              })}
                              onChange={() => changeSelection(object.id, true, false)}
                            />
                            <button
                              type="button"
                              disabled={uiBusy}
                              aria-pressed={selectedIds.includes(object.id)}
                              onClick={() =>
                                tool === "connector"
                                  ? void connect(object.id)
                                  : changeSelection(object.id, false, false)
                              }
                            >
                              {object.type === "idea_ref"
                                ? (object.idea?.body ??
                                  board.sourceBoard?.ideas.find((idea) => idea.id === object.ideaId)
                                    ?.body ??
                                  t("canvas.protected"))
                                : objectLabel(object, index)}
                            </button>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>
                ),
              },
              {
                id: "properties",
                label: chromeCopy.properties,
                icon: <CanvasToolIcon name="sliders" />,
                content: (
                  <div className={styles.propertiesPanel}>
                    {selected && localDraft && !recovery ? (
                      <form
                        className={styles.inspector}
                        onSubmit={(event) => void saveProperties(event)}
                      >
                        <h2>
                          {t("boards.elementSettings")} ·{" "}
                          <span lang="" dir="auto">
                            {objectLabel(
                              selected,
                              board.objects.findIndex((object) => object.id === selected.id),
                            )}
                          </span>
                        </h2>
                        {selected.type === "idea_ref" ? (
                          <p className={styles.protected}>{t("canvas.protected")}</p>
                        ) : selected.type === "image" ? null : (
                          <label>
                            {selected.type === "connector"
                              ? diagramCopy.label
                              : t("boards.textTool")}
                            <textarea
                              maxLength={2000}
                              value={localDraft.text}
                              disabled={!editable || uiBusy}
                              dir="auto"
                              lang=""
                              onChange={(event) =>
                                setDraft({ ...localDraft, text: event.target.value })
                              }
                            />
                          </label>
                        )}
                        {selected.type === "image" ? (
                          <label>
                            {t("canvas.assets.altText")}
                            <input
                              required
                              maxLength={300}
                              value={localDraft.altText ?? selected.altText}
                              disabled={!editable || uiBusy}
                              onChange={(event) =>
                                setDraft({ ...localDraft, altText: event.target.value })
                              }
                            />
                          </label>
                        ) : null}
                        {selected.type === "link" ? (
                          <label>
                            {t("canvas.assets.url")}
                            <input
                              type="url"
                              pattern={"https?://[^\\s/@]+(?:[/?#][^\\s]*)?"}
                              required
                              maxLength={2048}
                              value={localDraft.url ?? selected.url}
                              disabled={!editable || uiBusy}
                              onChange={(event) =>
                                setDraft({ ...localDraft, url: event.target.value })
                              }
                            />
                          </label>
                        ) : null}
                        {dirty && draft!.version !== selected.version ? (
                          <div className={styles.draftConflict}>
                            <strong>{t("canvas.currentVersion")}</strong>
                            <p lang="" dir="auto">
                              {selected.text}
                            </p>
                            <p>{t("canvas.conflictHelp")}</p>
                          </div>
                        ) : null}
                        {selected.type !== "connector" ? (
                          <div className={styles.numeric}>
                            {(["x", "y", "width", "height"] as const).map((field) => (
                              <label key={field}>
                                {t(
                                  field === "x"
                                    ? "boards.positionX"
                                    : field === "y"
                                      ? "boards.positionY"
                                      : field === "width"
                                        ? "boards.shapeWidth"
                                        : "boards.shapeHeight",
                                )}
                                <input
                                  type="number"
                                  step="any"
                                  min={field === "width" || field === "height" ? 1 : -100000}
                                  max={field === "width" || field === "height" ? 10000 : 100000}
                                  value={localDraft[field]}
                                  disabled={!editable || uiBusy}
                                  onChange={(event) => {
                                    if (Number.isFinite(event.currentTarget.valueAsNumber))
                                      setDraft({
                                        ...localDraft,
                                        [field]: event.currentTarget.valueAsNumber,
                                      });
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                        <CanvasDiagramInspector
                          object={selected}
                          objects={board.objects}
                          draft={localDraft}
                          disabled={!editable || uiBusy}
                          onChange={setDraft}
                          label={objectLabel}
                        />
                        <div className={styles.actions}>
                          {(["front", "back"] as const).map((direction) => {
                            const plan = planCanvasLayer(board, selectedIds, direction);
                            return (
                              <button
                                type="button"
                                className="button-quiet"
                                key={direction}
                                disabled={!editable || uiBusy || dirty || !plan.command}
                                title={plan.reason ? t(canvasPlanMessage(plan.reason)) : undefined}
                                onClick={() => void perform(plan)}
                              >
                                {diagramCopy[direction]}
                              </button>
                            );
                          })}
                        </div>
                        {selected.type !== "idea_ref" && selected.type !== "connector" ? (
                          <label>
                            {t("boards.strokeColor")}
                            <select
                              disabled={!editable || uiBusy}
                              value={localDraft.color}
                              onChange={(event) =>
                                setDraft({
                                  ...localDraft,
                                  color: event.target.value as CanvasObject["color"],
                                })
                              }
                            >
                              {CanvasColorSchema.options.map((color) => (
                                <option key={color} value={color}>
                                  {toolCopy.colors[color]}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {canPublishCanvasObject(board, selected) ? (
                          <>
                            <label>
                              {t("canvas.visibility")}
                              <select
                                aria-describedby="canvas-visibility-help"
                                value={localDraft.visibility}
                                disabled={uiBusy}
                                onChange={(event) =>
                                  setDraft({
                                    ...localDraft,
                                    visibility: event.target.value as CanvasObject["visibility"],
                                  })
                                }
                              >
                                <option value="team">{t("canvas.teamOnly")}</option>
                                <option value="published">{t("canvas.published")}</option>
                              </select>
                            </label>
                            <small id="canvas-visibility-help">{t("canvas.publishHelp")}</small>
                          </>
                        ) : null}
                        {!editable && selected.type !== "idea_ref" ? (
                          <p className={styles.muted}>{t("canvas.readOnly")}</p>
                        ) : null}
                        <button
                          type="submit"
                          className="button"
                          disabled={!editable || uiBusy || !dirty}
                        >
                          {t("canvas.saveChanges")}
                        </button>
                        {dirty ? (
                          <button
                            type="button"
                            className="button-quiet"
                            disabled={state.saving}
                            onClick={() => setDraft(null)}
                          >
                            {t("canvas.discard")}
                          </button>
                        ) : null}
                      </form>
                    ) : (
                      <p className={styles.muted}>{t("boards.noElements")}</p>
                    )}
                  </div>
                ),
              },
              {
                id: "arrange",
                label: chromeCopy.arrange,
                icon: <CanvasToolIcon name="align-center" />,
                content: selectedIds.length ? (
                  <CanvasSelectionTools
                    board={board}
                    ids={selectedIds}
                    disabled={uiBusy || dirty}
                    onPlan={perform}
                    onAll={() =>
                      selectMany(
                        board.objects.map((object) => object.id),
                        false,
                        false,
                      )
                    }
                    onClear={() => selectMany([], false, false)}
                  />
                ) : (
                  <p className={styles.muted}>{t("boards.noElements")}</p>
                ),
              },
              {
                id: "facilitation",
                label: facilitationCopy.title,
                icon: <CanvasToolIcon name="facilitation" />,
                content: facilitationMounted ? (
                  <CanvasFacilitationPanel
                    board={board}
                    selectedIds={selectedIds}
                    disabled={uiBusy || dirty || gestureActive}
                    onPlan={perform}
                    onRefresh={() => void state.refresh()}
                    onSelectObject={(objectId) => changeSelection(objectId, false, false)}
                  />
                ) : null,
              },
              ...(board.boardType === "workshop" && board.capabilities.facilitate
                ? [
                    {
                      id: "workshop",
                      label: t("canvas.workshop.controls"),
                      icon: <CanvasToolIcon name="workshop" />,
                      content: (
                        <CanvasWorkshopControls
                          board={board}
                          onRefresh={() => void state.refresh()}
                          disabled={uiBusy || dirty}
                        />
                      ),
                    },
                  ]
                : []),
              {
                id: "board",
                label: chromeCopy.board,
                icon: <CanvasToolIcon name="more" />,
                content: (
                  <div className={styles.boardPanel}>
                    <h2 lang="" dir="auto">
                      {board.title}
                    </h2>
                    <p className={styles.boardOrigin}>
                      {t("canvas.origin")}:{" "}
                      <span lang="">
                        {board.organizationName ? `${board.organizationName} · ` : ""}
                        {board.workspaceName ?? board.title}
                      </span>{" "}
                      · {t(board.role === "owner" ? "role.owner" : `canvas.${board.role}`)}
                    </p>
                    <p className={styles.keyboardHelp}>{t("canvas.keyboard")}</p>
                    <p className={styles.muted}>
                      {t("canvas.retention", { date: formatDateTime(locale, board.expiresAt) })}
                    </p>
                    {board.capabilities.archive ? (
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={uiBusy || dirty}
                        onClick={() =>
                          void state.execute({
                            type: board.status === "archived" ? "restore" : "archive",
                          })
                        }
                      >
                        {t(board.status === "archived" ? "canvas.restore" : "canvas.archive")}
                      </button>
                    ) : null}
                    {board.boardType === "team" && board.capabilities.delete ? (
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={uiBusy || dirty}
                        onClick={() => void deleteBoard()}
                      >
                        {t("canvas.delete")}
                      </button>
                    ) : null}
                    {deleteError ? (
                      <p className="error" role="alert" lang="en-CA">
                        {deleteError}
                      </p>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
      {exporting ? (
        <CanvasExportDialog
          boardId={board.id}
          title={board.title}
          objects={board.objects}
          selectedIds={selectedIds}
          viewportRegion={visibleRegion}
          disabled={uiBusy || dirty || gestureActive}
          onClose={() => setExporting(false)}
        />
      ) : null}
      <footer className={styles.footer}>
        <label>
          <input
            type="checkbox"
            checked={presence}
            onChange={(event) => setPresence(event.target.checked)}
          />{" "}
          {t("canvas.presence")}
        </label>
        {presence ? (
          <span>
            {t("canvas.connected")}: {formatNumber(locale, members.length)}
          </span>
        ) : null}
        <button type="button" className="button-quiet" onClick={() => void state.refresh()}>
          {t("boards.refresh")}
        </button>
      </footer>
      {templates ? (
        <dialog
          ref={templateDialog}
          className={experience.templateDialog}
          aria-label={toolCopy.templates}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setTemplates(false);
          }}
        >
          <header className={experience.templateHeader}>
            <h2>{toolCopy.templates}</h2>
            <button
              type="button"
              className="button-quiet"
              disabled={busy}
              onClick={() => setTemplates(false)}
            >
              {toolCopy.close}
            </button>
          </header>
          <div className={experience.templateBody}>
            <CanvasTemplateChooser value={templateId} onChange={setTemplateId} browse />
          </div>
          <footer className={experience.templateFooter}>
            {planError ? (
              <p role="alert">{t(canvasPlanMessage(planError))}</p>
            ) : (
              <span>{toolCopy.shapeHelp}</span>
            )}
            <button
              type="button"
              className="button"
              disabled={!templateId || busy || dirty || creationFull || frozen}
              onClick={() => void insertTemplate()}
            >
              {toolCopy.insertTemplate}
            </button>
          </footer>
        </dialog>
      ) : null}
      {sharing && board.capabilities.share ? (
        <CanvasShareDialog
          board={board}
          onClose={() => setSharing(false)}
          onRefresh={() => void state.refresh()}
        />
      ) : null}
    </main>
  );
}

export function CanvasEditor({ id }: { id: string }) {
  return (
    <NavigationGuardProvider>
      <CanvasEditorContent id={id} key={id} />
    </NavigationGuardProvider>
  );
}
