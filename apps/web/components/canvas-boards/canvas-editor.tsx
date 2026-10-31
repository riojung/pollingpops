"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { CanvasObject, CanvasObjectCreate, CanvasExportRegion } from "@openround/contracts";
import { Brand } from "../brand";
import { useLocale } from "../locale-provider";
import { GuardedLink, NavigationGuardProvider, useNavigationBlocker } from "../navigation-guard";
import { apiFetch, humanError } from "../../lib/api";
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
import styles from "./canvas.module.css";

function CanvasEditorContent({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const facilitationCopy = canvasFacilitationCopy(locale);
  const diagramCopy = canvasDiagramCopy(locale);
  function objectLabel(object: CanvasObject, index: number) {
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
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [sharing, setSharing] = useState(false);
  const [outline, setOutline] = useState(true);
  const [workshop, setWorkshop] = useState(false);
  const [facilitation, setFacilitation] = useState(false);
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
      (dirty || state.saving || state.failure !== null || deleting || gestureActive),
    [dirty, state.saving, state.failure, deleting, gestureActive],
  );
  useNavigationBlocker(blocked);
  const busy = state.saving || state.failure !== null || deleting;
  const uiBusy = busy || gestureActive;
  const editable = Boolean(board && selected && canChangeObject(board, selected));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (window.matchMedia?.("(pointer: coarse)").matches) setTool("hand");
    if (window.innerWidth < 760) setOutline(false);
  }, []);
  useEffect(() => {
    setSelectionIds([]);
    setSharing(false);
    setViewport(INITIAL_VIEWPORT);
  }, [id]);
  useEffect(() => {
    if (board?.boardType === "workshop") setWorkshop(true);
  }, [board?.id, board?.boardType]);
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

  function selectMany(ids: string[], additive = false, reveal = true) {
    if (!board || state.saving || deleting) return;
    const peers = canvasSelectionPeers(board.objects, ids);
    const next = additive ? [...new Set([...selectedIds, ...peers])] : peers;
    if (next.length === selectedIds.length && next.every((id) => selectedIds.includes(id))) return;
    if ((dirty || state.failure) && !window.confirm(t("canvas.discard"))) return;
    if (state.failure) state.discard();
    acceptMany(next);
    if (reveal) setOutline(true);
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
      setOutline(true);
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
      const object = newCanvasPen(points);
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
    type: "sticky" | "text" | "rect" | "ellipse" | "frame" | "diamond" | "parallelogram",
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
    const object = newCanvasObject(
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
    if (type === "frame") {
      object.width = 440;
      object.height = 300;
      object.zIndex = -1;
    }
    if (await state.execute({ type: "batch", operations: [{ type: "create", object }] })) {
      acceptSelection(object.id);
      setRevealIds([object.id]);
      setTool("select");
      setOutline(true);
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
    if (!board?.capabilities.edit || busy || dirty) return;
    if (!connectorFrom) {
      setConnectorFrom(next);
      changeSelection(next);
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
    if (await state.execute({ type: "batch", operations: [{ type: "create", object }] })) {
      acceptSelection(object.id);
      setRevealIds([object.id]);
      setConnectorFrom(null);
      setTool("select");
    }
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
        (event.target.matches("input,textarea,select") || event.target.isContentEditable))
    )
      return;
    if (gestureActive) return;
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
      <header className={styles.header}>
        <GuardedLink className={styles.back} href="/boards">
          ← {t("boards.title")}
        </GuardedLink>
        <div className={styles.title}>
          <h1 lang="" dir="auto">
            {board.title}
          </h1>
          <p>
            {t("canvas.origin")}:{" "}
            <span lang="">
              {board.organizationName ? `${board.organizationName} · ` : ""}
              {board.workspaceName ?? board.title}
            </span>{" "}
            · {t(board.role === "owner" ? "role.owner" : `canvas.${board.role}`)}
          </p>
        </div>
        <p className={styles.saveStatus} role="status">
          {state.saving || gestureActive
            ? t("canvas.saving")
            : state.failure
              ? t("canvas.conflict")
              : t(`canvas.${state.connection}`)}
        </p>
        {board.capabilities.share ? (
          <button
            type="button"
            className="button"
            onClick={() => setSharing(true)}
            disabled={uiBusy || dirty}
          >
            {t("canvas.share")}
          </button>
        ) : null}
      </header>
      <div className={styles.toolbar} role="group" aria-label={t("boards.richTypes")}>
        <button
          type="button"
          className="button-quiet"
          aria-pressed={tool === "select"}
          onClick={() => setTool("select")}
        >
          {t("boards.selectTool")}
        </button>
        <button
          type="button"
          className="button-quiet"
          aria-pressed={tool === "hand"}
          onClick={() => setTool("hand")}
        >
          {t("canvas.hand")}
        </button>
        <span className={styles.divider} />
        {(["sticky", "text", "rect", "ellipse", "frame", "diamond", "parallelogram"] as const).map(
          (type) => (
            <button
              type="button"
              className="button-quiet"
              key={type}
              disabled={frozen || uiBusy || creationFull}
              onClick={() => void add(type)}
            >
              {type === "diamond" || type === "parallelogram"
                ? diagramCopy[type]
                : t(
                    type === "sticky"
                      ? "canvas.sticky"
                      : type === "text"
                        ? "boards.textTool"
                        : type === "rect"
                          ? "boards.rectangleTool"
                          : type === "ellipse"
                            ? "boards.ellipseTool"
                            : "canvas.productivity.frame",
                  )}
            </button>
          ),
        )}
        <button
          type="button"
          className="button-quiet"
          aria-pressed={tool === "connector"}
          disabled={frozen || uiBusy || dirty}
          onClick={() => {
            setTool("connector");
            setConnectorFrom(selectedId);
          }}
        >
          {t("canvas.connector")}
        </button>
        <button
          type="button"
          className="button-quiet"
          aria-pressed={tool === "marquee"}
          onClick={() => setTool("marquee")}
        >
          {t("canvas.productivity.area")}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={frozen || uiBusy || dirty || creationFull}
          aria-pressed={tool === "pen"}
          onClick={() => setTool("pen")}
        >
          {t("canvas.productivity.pen")}
        </button>
        <CanvasAssetTools
          board={board}
          disabled={frozen || uiBusy || dirty || gestureActive || creationFull}
          onCreate={createObject}
        />
        <span className={styles.divider} />
        <button
          type="button"
          className="button-quiet"
          disabled={frozen || uiBusy || dirty || !board.undoOperationId}
          onClick={() =>
            board.undoOperationId &&
            void state.execute({ type: "undo", targetOperationId: board.undoOperationId })
          }
        >
          {t("boards.undo")}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={frozen || uiBusy || dirty || !board.redoOperationId}
          onClick={() =>
            board.redoOperationId &&
            void state.execute({ type: "redo", targetOperationId: board.redoOperationId })
          }
        >
          {t("boards.redo")}
        </button>
        <button
          type="button"
          className="button-quiet"
          aria-expanded={outline}
          onClick={() => setOutline(!outline)}
        >
          {t("canvas.objects")}
        </button>
        <button
          type="button"
          className="button-quiet"
          aria-expanded={facilitation}
          onClick={() => {
            setFacilitationMounted(true);
            setFacilitation((visible) => !visible);
          }}
        >
          {facilitationCopy.title}
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={uiBusy || dirty || gestureActive}
          onClick={() => setExporting(true)}
        >
          {t("canvas.export.open")}
        </button>
        {board.boardType === "workshop" && board.capabilities.facilitate ? (
          <button
            className="button-quiet"
            type="button"
            aria-expanded={workshop}
            onClick={() => setWorkshop(!workshop)}
          >
            {t("canvas.workshop.controls")}
          </button>
        ) : null}
      </div>
      <CanvasPresenterControls
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
      <div className={styles.workspace}>
        <div className={styles.stage} ref={stage}>
          <CanvasSurface
            objects={board.objects}
            viewport={viewport}
            onViewport={setViewport}
            onInteract={stopFollowing}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelectMany={(ids, additive) => selectMany(ids, additive, false)}
            onTransform={transform}
            onCreatePen={createPen}
            onGestureActive={setGestureActive}
            onSelect={changeSelection}
            tool={tool}
            canEdit={
              board.capabilities.edit && !uiBusy && !dirty && (tool !== "pen" || !creationFull)
            }
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
          {!board.objects.length ? <p className={styles.emptyCanvas}>{t("canvas.empty")}</p> : null}
          <div
            className={styles.navigation}
            role="group"
            aria-label={t("canvas.zoom")}
            onClickCapture={stopFollowing}
          >
            <button className="button-quiet" type="button" onClick={() => fit()}>
              {t("canvas.fit")}
            </button>
            <button
              className="button-quiet"
              type="button"
              disabled={!selected}
              onClick={() => fit(true)}
            >
              {t("canvas.fitSelection")}
            </button>
            <button
              className="button-quiet"
              type="button"
              aria-label={t("canvas.zoom") + " −"}
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
            >
              −
            </button>
            <output>
              {formatNumber(locale, viewport.zoom, { style: "percent", maximumFractionDigits: 0 })}
            </output>
            <button
              className="button-quiet"
              type="button"
              aria-label={t("canvas.zoom") + " +"}
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
            >
              +
            </button>
          </div>
        </div>
        {outline || workshop || facilitationMounted ? (
          <aside className={styles.sidebar} hidden={!outline && !workshop && !facilitation}>
            {facilitationMounted ? (
              <div hidden={!facilitation}>
                <CanvasFacilitationPanel
                  board={board}
                  selectedIds={selectedIds}
                  disabled={uiBusy || dirty || gestureActive}
                  onPlan={perform}
                  onRefresh={() => void state.refresh()}
                  onSelectObject={(objectId) => changeSelection(objectId)}
                />
              </div>
            ) : null}
            {selectedIds.length ? (
              <CanvasSelectionTools
                board={board}
                ids={selectedIds}
                disabled={uiBusy || dirty || gestureActive}
                onPlan={perform}
                onAll={() => selectMany(board.objects.map((object) => object.id))}
                onClear={() => selectMany([])}
              />
            ) : null}
            {workshop ? (
              <CanvasWorkshopControls
                board={board}
                onRefresh={() => void state.refresh()}
                disabled={uiBusy || dirty}
              />
            ) : null}
            {outline ? (
              <>
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
                          disabled={state.saving || deleting}
                          aria-label={t("canvas.productivity.select", {
                            label: objectLabel(object, index),
                          })}
                          onChange={() => changeSelection(object.id, true)}
                        />
                        <button
                          type="button"
                          aria-pressed={selectedIds.includes(object.id)}
                          onClick={() =>
                            tool === "connector"
                              ? void connect(object.id)
                              : changeSelection(object.id)
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
                        {selected.type === "connector" ? diagramCopy.label : t("boards.textTool")}
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
                          onChange={(event) => setDraft({ ...localDraft, url: event.target.value })}
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
                          {(["yellow", "blue", "green", "pink", "purple", "white"] as const).map(
                            (color) => (
                              <option key={color} value={color}>
                                {t(
                                  color === "yellow" || color === "pink" || color === "white"
                                    ? `canvas.color.${color}`
                                    : color === "blue"
                                      ? "boards.colorBlue"
                                      : color === "green"
                                        ? "boards.colorGreen"
                                        : "boards.colorPurple",
                                )}
                              </option>
                            ),
                          )}
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
              </>
            ) : null}
          </aside>
        ) : null}
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
