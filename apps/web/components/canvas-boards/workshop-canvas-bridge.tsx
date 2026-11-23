"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type {
  CanvasBoardCreate,
  CanvasBoardGuestView,
  IdeaBoardView,
  CanvasExportRegion,
} from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import {
  boardLaunchErrorKey,
  boardLaunchUnavailableKey,
  type BoardLaunchNoticeKey,
} from "../../lib/board-launch-availability";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "../workspace/workspace-provider";
import { createCanvas } from "./canvas-client";
import { CanvasReadOnlySurface } from "./canvas-surface";
import { CanvasGuestFacilitation } from "./canvas-guest-facilitation";
import {
  readGuestWorkshopCanvas,
  readWorkshopCanvas,
  watchGuestWorkshopCanvas,
} from "./workshop-canvas-client";
import guestStyles from "./workshop-canvas-guest.module.css";

export type WorkshopCanvasAttempt = { actorId: string; input: CanvasBoardCreate };

export function WorkshopCanvasLauncher({
  board,
  disabled = false,
  attempt,
  launchDenial,
  onLaunchDenialChange,
}: {
  board: IdeaBoardView;
  disabled?: boolean;
  attempt: RefObject<WorkshopCanvasAttempt | null>;
  launchDenial: BoardLaunchNoticeKey | undefined;
  onLaunchDenialChange: (key: BoardLaunchNoticeKey | undefined) => void;
}) {
  const { t } = useLocale();
  const { creator, canEdit, productFeatures } = useWorkspace();
  const router = useRouter();
  const [existing, setExisting] = useState<{ sourceId: string; canvasId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<false | "lookup" | "create">(false);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const active = useRef<AbortController | null>(null);
  const launchNoticeId = useId();
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setFailed(false);
    void readWorkshopCanvas(board.id, controller.signal)
      .then((canvas) => {
        if (!controller.signal.aborted) setExisting({ sourceId: board.id, canvasId: canvas.id });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setExisting(null);
        if (!(error instanceof ApiClientError && error.status === 404)) setFailed("lookup");
      });
    return () => controller.abort();
  }, [board.id, creator?.workspaceId, refresh]);
  const current = existing?.sourceId === board.id ? existing : null;
  const previousAttempt =
    creator &&
    attempt.current?.actorId === creator.userId &&
    attempt.current.input.workspaceId === creator.workspaceId &&
    attempt.current.input.sourceBoardId === board.id
      ? attempt.current
      : null;
  const launchUnavailable = boardLaunchUnavailableKey(
    productFeatures?.canvasBoardsLaunchUnavailableReason,
  );
  const launchNotice = launchDenial ?? launchUnavailable;
  const canLaunch =
    (productFeatures?.canvasBoards || launchUnavailable) &&
    (board.status === "draft" || board.status === "collecting");
  async function open() {
    if (inFlight.current || !creator || !canEdit || disabled) return;
    if (!previousAttempt && (!canLaunch || launchUnavailable)) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    onLaunchDenialChange(undefined);
    const controller = active.current;
    try {
      const input =
        previousAttempt?.input ??
        ({
          schemaVersion: 1,
          workspaceId: creator.workspaceId,
          title: board.title,
          boardType: "workshop",
          sourceBoardId: board.id,
          operationId: clientUuid(),
        } satisfies CanvasBoardCreate);
      attempt.current = { actorId: creator.userId, input };
      const canvas = await createCanvas(input, controller?.signal, {
        userId: creator.userId,
        workspaceId: input.workspaceId,
      });
      if (!controller?.signal.aborted) {
        attempt.current = null;
        setExisting({ sourceId: board.id, canvasId: canvas.id });
        router.push(`/canvas/${canvas.id}`);
      }
    } catch (error) {
      if (controller?.signal.aborted) return;
      if (error instanceof ApiClientError && error.status < 500 && error.status !== 429)
        attempt.current = null;
      const launchError = boardLaunchErrorKey(error);
      if (launchError) onLaunchDenialChange(launchError);
      else setFailed("create");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (current)
    return (
      <Link className="button-quiet" href={`/canvas/${current.canvasId}`}>
        {t("canvas.workshop.open")}
      </Link>
    );
  if (!canEdit || (!canLaunch && !previousAttempt)) return null;
  return (
    <div>
      <button
        className="button-quiet"
        type="button"
        disabled={disabled || busy || (Boolean(launchUnavailable) && !previousAttempt)}
        aria-describedby={launchNotice ? launchNoticeId : undefined}
        onClick={() => void open()}
      >
        {t(previousAttempt ? "boards.retry" : "canvas.workshop.add")}
      </button>
      {launchNotice ? (
        <p id={launchNoticeId} role={launchDenial ? "alert" : undefined}>
          {t(launchNotice)}
        </p>
      ) : null}
      {failed === "lookup" || failed === "create" ? (
        <p className="error" role="alert">
          {t("canvas.workshop.loadError")}
          {failed === "lookup" ? (
            <button
              type="button"
              className="button-quiet"
              disabled={busy}
              onClick={() => setRefresh((value) => value + 1)}
            >
              {t("boards.retry")}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function PublishedWorkshopCanvas({
  sourceBoardId,
  token,
  onAvailabilityChange,
  renderCanvas,
}: {
  sourceBoardId: string;
  token: string;
  onAvailabilityChange?: (available: boolean) => void;
  renderCanvas?: (context: { board: CanvasBoardGuestView; onInteract: () => void }) => ReactNode;
}) {
  const { t } = useLocale();
  const [followRegion, setFollowRegion] = useState<CanvasExportRegion | null>(null);
  const [navigation, setNavigation] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    sourceId: string;
    board: CanvasBoardGuestView;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const availabilityObserver = useRef(onAvailabilityChange);
  availabilityObserver.current = onAvailabilityChange;
  const authoring = Boolean(renderCanvas);
  useEffect(() => {
    if (authoring) {
      setFollowRegion(null);
      setNavigation((value) => value + 1);
    }
  }, [authoring]);
  useEffect(() => {
    const active = new AbortController();
    let inFlight = false;
    let again = false;
    let notifyTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(null);
    setFailed(false);
    async function refresh() {
      if (active.signal.aborted) return;
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      do {
        again = false;
        try {
          const board = await readGuestWorkshopCanvas(sourceBoardId, token, active.signal);
          if (active.signal.aborted) return;
          setFailed(false);
          setSnapshot((previous) => {
            if (
              previous?.sourceId === sourceBoardId &&
              (previous.board.canvasSeq > board.canvasSeq ||
                previous.board.sourceBoard.revision > board.sourceBoard.revision)
            )
              return previous;
            return { sourceId: sourceBoardId, board };
          });
        } catch (error) {
          if (active.signal.aborted) return;
          const unavailable =
            error instanceof ApiClientError && [401, 403, 404, 410].includes(error.status);
          if (unavailable) setSnapshot(null);
          setFailed(!unavailable);
        }
      } while (again && !active.signal.aborted);
      inFlight = false;
    }
    const poll = setInterval(() => void refresh(), 5000);
    function schedule() {
      if (notifyTimer || active.signal.aborted) return;
      notifyTimer = setTimeout(() => {
        notifyTimer = undefined;
        void refresh();
      }, 500);
    }
    function revoke() {
      setSnapshot(null);
      setFailed(false);
      active.abort();
      clearInterval(poll);
    }
    async function watch() {
      if (active.signal.aborted) return;
      try {
        await watchGuestWorkshopCanvas(sourceBoardId, token, active.signal, schedule, revoke);
      } catch (error) {
        if (active.signal.aborted) return;
        if (error instanceof ApiClientError && [401, 403, 410].includes(error.status)) {
          revoke();
          return;
        }
      }
      if (!active.signal.aborted) retryTimer = setTimeout(() => void watch(), 5000);
    }
    void refresh();
    void watch();
    return () => {
      active.abort();
      clearInterval(poll);
      if (notifyTimer) clearTimeout(notifyTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [sourceBoardId, token, refreshKey]);
  const board = snapshot?.sourceId === sourceBoardId ? snapshot.board : null;
  const available = Boolean(board);
  useEffect(() => {
    availabilityObserver.current?.(available);
  }, [available]);
  if (!board)
    return failed ? (
      <p className="error" role="alert">
        {t("canvas.workshop.loadError")}{" "}
        <button
          type="button"
          className="button-quiet"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          {t("boards.retry")}
        </button>
      </p>
    ) : null;
  const onInteract = () => {
    setFollowRegion(null);
    setNavigation((value) => value + 1);
  };
  if (renderCanvas)
    return <div className={guestStyles.published}>{renderCanvas({ board, onInteract })}</div>;
  return (
    <div className={guestStyles.published}>
      <div className={guestStyles.liveTools}>
        <h2>{t("canvas.workshop.published")}</h2>
        <CanvasGuestFacilitation
          boardId={board.id}
          sourceBoardId={sourceBoardId}
          token={token}
          canvasSeq={board.canvasSeq}
          objects={board.objects}
          cancelKey={navigation}
          onFollow={setFollowRegion}
        />
      </div>
      <CanvasReadOnlySurface
        fill
        objects={board.objects}
        canvasId={board.id}
        sourceBoardId={sourceBoardId}
        sourceBoard={board.sourceBoard}
        guestToken={token}
        label={t("canvas.workshop.published")}
        followRegion={followRegion}
        onInteract={onInteract}
      />
    </div>
  );
}
