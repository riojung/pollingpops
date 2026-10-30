"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CanvasBoardGuestView, IdeaBoardView } from "@openround/contracts";
import { ApiClientError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "../workspace/workspace-provider";
import { createCanvas } from "./canvas-client";
import { CanvasReadOnlySurface } from "./canvas-surface";
import {
  readGuestWorkshopCanvas,
  readWorkshopCanvas,
  watchGuestWorkshopCanvas,
} from "./workshop-canvas-client";

export function WorkshopCanvasLauncher({
  board,
  disabled = false,
}: {
  board: IdeaBoardView;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const { creator, canEdit, productFeatures } = useWorkspace();
  const router = useRouter();
  const [existing, setExisting] = useState<{ sourceId: string; canvasId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const attempt = useRef<{ sourceId: string; operationId: string } | null>(null);
  const active = useRef<AbortController | null>(null);
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
        if (!(error instanceof ApiClientError && error.status === 404)) setFailed(true);
      });
    return () => controller.abort();
  }, [board.id, creator?.workspaceId, refresh]);
  const current = existing?.sourceId === board.id ? existing : null;
  async function open() {
    if (inFlight.current || !creator || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    const controller = active.current;
    if (attempt.current?.sourceId !== board.id)
      attempt.current = { sourceId: board.id, operationId: clientUuid() };
    try {
      const canvas = await createCanvas(
        {
          schemaVersion: 1,
          workspaceId: creator.workspaceId,
          title: board.title,
          boardType: "workshop",
          sourceBoardId: board.id,
          operationId: attempt.current.operationId,
        },
        controller?.signal,
      );
      if (!controller?.signal.aborted) router.push(`/canvas/${canvas.id}`);
    } catch (error) {
      if (controller?.signal.aborted) return;
      if (error instanceof ApiClientError && error.status < 500 && error.status !== 429)
        attempt.current = null;
      setFailed(true);
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
  if (!canEdit || !productFeatures?.canvasBoards || !["draft", "collecting"].includes(board.status))
    return null;
  return (
    <div>
      <button
        className="button-quiet"
        type="button"
        disabled={disabled || busy}
        onClick={() => void open()}
      >
        {t("canvas.workshop.add")}
      </button>
      {failed ? (
        <p className="error" role="alert">
          {t("canvas.workshop.loadError")}{" "}
          <button
            type="button"
            className="button-quiet"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("boards.retry")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function PublishedWorkshopCanvas({
  sourceBoardId,
  token,
}: {
  sourceBoardId: string;
  token: string;
}) {
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<{
    sourceId: string;
    board: CanvasBoardGuestView;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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
  return (
    <section aria-label={t("canvas.workshop.published")}>
      <h2>{t("canvas.workshop.published")}</h2>
      <CanvasReadOnlySurface
        objects={board.objects}
        canvasId={board.id}
        sourceBoardId={sourceBoardId}
        sourceBoard={board.sourceBoard}
        guestToken={token}
        label={t("canvas.workshop.published")}
      />
    </section>
  );
}
