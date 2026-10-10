"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PresentationCommand,
  PresentationHostSnapshot,
  RecoveryPackCardSelection,
} from "@openround/contracts";
import { CreatorBrand } from "../../../../components/brand";
import { useLocale } from "../../../../components/locale-provider";
import { PresentationMedia } from "../../../../components/presentation-live/presentation-media";
import { PresentationCompanionLauncher } from "../../../../components/presentation-live/companion-launcher";
import { PresentationQnaPanel } from "../../../../components/presentation-live/presentation-qna";
import { ContentSlideView } from "../../../../components/presentation/content-slide-view";
import {
  RecoveryPackCardPicker,
  RecoveryPackLiveCardView,
} from "../../../../components/recovery-pack-live-card";
import {
  useWorkspace,
  WorkspaceProvider,
} from "../../../../components/workspace/workspace-provider";
import { recordAuthoringEvent } from "../../../../components/workspace/product-events";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import { formatNumber } from "../../../../lib/i18n/format";
import {
  createPresentationRealtimeController,
  presentationRemainingSeconds,
  type PresentationConnectionState,
  type PresentationRealtimeController,
} from "../../../../lib/presentation-realtime";
import { clientUuid } from "../../../../lib/uuid";
import {
  createPresentationCommandRecovery,
  type PresentationCommandRecoveryState,
} from "../../../../lib/presentation-command-recovery";
import { createPresentationHostPassManager } from "../../../../lib/presentation-host-pass";

function advanceMessageKey(
  snapshot: PresentationHostSnapshot,
):
  | "live.presentationSession.advance.start"
  | "live.presentationSession.advance.reveal"
  | "live.presentationSession.advance.intervention"
  | "live.presentationSession.advance.continueRecheck"
  | "live.presentationSession.advance.finish"
  | "live.presentationSession.advance.next" {
  if (snapshot.phase === "lobby") return "live.presentationSession.advance.start";
  if (snapshot.phase === "question_open") return "live.presentationSession.advance.reveal";
  if (
    snapshot.phase === "question_reveal" &&
    snapshot.currentBlock?.kind === "question" &&
    snapshot.currentBlock.question.linkedRecheckAvailable
  ) {
    return "live.presentationSession.advance.intervention";
  }
  if (
    snapshot.phase === "intervention" &&
    snapshot.currentBlock?.kind === "question" &&
    snapshot.currentBlock.question.linkedRecheckAvailable
  ) {
    return "live.presentationSession.advance.continueRecheck";
  }
  if (snapshot.currentBlockIndex >= snapshot.blockCount - 1) {
    return "live.presentationSession.advance.finish";
  }
  return "live.presentationSession.advance.next";
}

function PresentationHostContent() {
  const { locale, t } = useLocale();
  const { productFeatures, canEdit } = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<PresentationHostSnapshot | null>(null);
  const [commandState, setCommandState] = useState<PresentationCommandRecoveryState>({
    busy: false,
    pendingCommand: null,
  });
  const [legacyAdvanceBusy, setLegacyAdvanceBusy] = useState(false);
  const legacyAdvanceInFlight = useRef(false);
  const [hasControlPass, setHasControlPass] = useState(false);
  const [audienceToken, setAudienceToken] = useState<string | null>(null);
  const [controlPassBusy, setControlPassBusy] = useState(false);
  const controlPassInFlight = useRef(false);
  const [controlPassAttempt, setControlPassAttempt] = useState(0);
  const [controlPassError, setControlPassError] = useState("");
  const passManagerRef = useRef<ReturnType<typeof createPresentationHostPassManager> | null>(null);
  const passManagerSessionId = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [connection, setConnection] = useState<PresentationConnectionState>("connecting");
  const connectionState = useRef({ hadSuccess: false, failedAfterSuccess: false, tracked: false });
  const snapshotReceivedAt = useRef(Date.now());
  const controllerRef = useRef<PresentationRealtimeController<PresentationHostSnapshot> | null>(
    null,
  );
  const commandsRef = useRef<ReturnType<
    typeof createPresentationCommandRecovery<PresentationHostSnapshot>
  > | null>(null);
  const commandsSessionId = useRef<string | null>(null);

  const applySnapshot = useCallback((incoming: PresentationHostSnapshot) => {
    snapshotReceivedAt.current = Date.now();
    setSnapshot(incoming);
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      const response = await apiFetch<{ snapshot: PresentationHostSnapshot }>(
        `/v1/presentation-sessions/${id}`,
      );
      if (connectionState.current.failedAfterSuccess && !connectionState.current.tracked) {
        recordAuthoringEvent("presentation_reconnected", "presentation");
        connectionState.current.tracked = true;
      }
      connectionState.current.hadSuccess = true;
      connectionState.current.failedAfterSuccess = false;
      setError("");
      return response.snapshot;
    } catch (caught) {
      if (connectionState.current.hadSuccess) {
        connectionState.current.failedAfterSuccess = true;
      }
      if ((caught as { status?: number }).status === 401) router.replace("/signin");
      else setError(humanError(caught));
      throw caught;
    }
  }, [id, router]);

  useEffect(() => {
    setAudienceToken(null);
    let disposed = false;
    let controller: PresentationRealtimeController<PresentationHostSnapshot> | null = null;
    let timer: number | null = null;
    const start = async () => {
      if (!passManagerRef.current || passManagerSessionId.current !== id) {
        passManagerRef.current = createPresentationHostPassManager(sessionStorage, id);
        passManagerSessionId.current = id;
      }
      const passManager = passManagerRef.current;
      let controlToken: string | null = null;
      try {
        controlToken = await passManager.acquireAutomatic(async () => {
          const pass = await apiFetch<{ controlToken: string }>(
            `/v1/presentation-sessions/${id}/control-pass`,
            { method: "POST" },
          );
          return pass.controlToken;
        });
      } catch (caught) {
        // Authenticated REST remains available while realtime is disabled or rolling out.
        if (!disposed) setControlPassError(humanError(caught));
      }
      if (disposed) return;
      setHasControlPass(!!controlToken);
      setAudienceToken(controlToken);
      if (controlToken) setControlPassError("");
      controller = createPresentationRealtimeController<PresentationHostSnapshot>({
        sessionId: id,
        credential: controlToken ? { projection: "host", controlToken } : null,
        fetchSnapshot,
        onSnapshot: (incoming) => {
          if (!disposed) applySnapshot(incoming);
        },
        onConnectionState: (next) => {
          if (!disposed) setConnection(next);
        },
        onRoomStatus: (roomStatus) => {
          if (disposed) return;
          setSnapshot((current) => (current ? { ...current, roomStatus } : current));
        },
        onError: (caught) => {
          if (!disposed) setError(humanError(caught));
        },
        onCredentialRejected: (rejectedToken) => {
          if (disposed || !passManager.reject(rejectedToken)) return;
          setHasControlPass(false);
          setAudienceToken(null);
          setControlPassError(
            "This host control pass is no longer valid. Reacquire it to use live card controls.",
          );
          setControlPassAttempt((attempt) => attempt + 1);
        },
      });
      controllerRef.current = controller;
      if (!commandsRef.current || commandsSessionId.current !== id) {
        commandsRef.current = createPresentationCommandRecovery<PresentationHostSnapshot>({
          execute: (command) => {
            const activeController = controllerRef.current;
            if (!activeController)
              return Promise.reject(
                Object.assign(new Error("Reconnect before changing the Presentation."), {
                  code: "PRESENTATION_RECONNECT_REQUIRED",
                }),
              );
            return activeController.command(command, async () => {
              const response = await apiFetch<{ snapshot: PresentationHostSnapshot }>(
                `/v1/presentation-sessions/${command.sessionId}/command`,
                { method: "POST", body: JSON.stringify(command) },
              );
              return response.snapshot;
            });
          },
          onState: (next) => {
            if (commandsSessionId.current === id) setCommandState(next);
          },
        });
        commandsSessionId.current = id;
        setCommandState(commandsRef.current.state());
      }
      controller.start();
      timer = window.setInterval(() => {
        if (controller?.needsFallbackPolling()) void controller.reconcile();
      }, 1_500);
    };
    void start();
    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      controller?.stop();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [applySnapshot, controlPassAttempt, fetchSnapshot, id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  async function runCommand(command: PresentationCommand) {
    const controller = controllerRef.current;
    const commands = commandsRef.current;
    if (
      !hasControlPass ||
      !passManagerRef.current?.token() ||
      !controller?.canMutate() ||
      !commands ||
      commands.state().busy ||
      legacyAdvanceInFlight.current ||
      controlPassInFlight.current
    )
      return;
    setError("");
    try {
      await commands.run(command);
    } catch (caught) {
      setError(humanError(caught));
      await controller.reconcile();
    }
  }

  function commandCredentials(controlToken: string) {
    return {
      sessionId: id,
      controlToken,
      commandId: clientUuid(),
      expectedRevision: snapshot!.revision,
    };
  }

  async function advance() {
    if (!snapshot || snapshot.phase === "finished") return;
    const controlToken = sessionStorage.getItem(`openround:presentation-host:${id}`);
    if (controlToken) {
      await runCommand({ ...commandCredentials(controlToken), action: "advance" });
      return;
    }
    const controller = controllerRef.current;
    if (
      !controller?.canMutate() ||
      legacyAdvanceInFlight.current ||
      controlPassInFlight.current ||
      commandsRef.current?.state().pendingCommand
    )
      return;
    legacyAdvanceInFlight.current = true;
    setLegacyAdvanceBusy(true);
    setError("");
    try {
      const response = await apiFetch<{ snapshot: PresentationHostSnapshot }>(
        `/v1/presentation-sessions/${id}/advance`,
        { method: "POST", body: JSON.stringify({ expectedRevision: snapshot.revision }) },
      );
      controller.applySnapshot(response.snapshot);
    } catch (caught) {
      // The compatibility endpoint has no command receipt: reconcile, never automatically replay.
      await controller.reconcile();
      setError(
        `${humanError(caught)} Advance was not confirmed. Review the room state before advancing again.`,
      );
    } finally {
      legacyAdvanceInFlight.current = false;
      setLegacyAdvanceBusy(false);
    }
  }

  async function startRecoveryCard(
    recoveryPackCard: RecoveryPackCardSelection,
    interventionType: "explain" | "example",
  ) {
    if (!snapshot || snapshot.phase !== "question_reveal") return;
    const controlToken = sessionStorage.getItem(`openround:presentation-host:${id}`);
    if (!controlToken || !hasControlPass) return;
    await runCommand({
      ...commandCredentials(controlToken),
      action: "start_recovery_card",
      recoveryPackCard,
      interventionType,
    });
  }

  async function retryCommand() {
    const controller = controllerRef.current;
    const commands = commandsRef.current;
    if (
      !hasControlPass ||
      !passManagerRef.current?.token() ||
      !controller?.canMutate() ||
      !commands ||
      commands.state().busy ||
      legacyAdvanceInFlight.current ||
      controlPassInFlight.current
    )
      return;
    setError("");
    try {
      await commands.retry();
    } catch (caught) {
      setError(humanError(caught));
      await controller.reconcile();
    }
  }

  async function retryControlPass() {
    if (
      controlPassInFlight.current ||
      legacyAdvanceInFlight.current ||
      commandsRef.current?.state().busy
    )
      return;
    controlPassInFlight.current = true;
    setControlPassBusy(true);
    setControlPassError("");
    try {
      const pass = await apiFetch<{ controlToken: string }>(
        `/v1/presentation-sessions/${id}/control-pass`,
        { method: "POST" },
      );
      passManagerRef.current?.replace(pass.controlToken);
      commandsRef.current?.rebindControlToken(pass.controlToken);
      setHasControlPass(true);
      setAudienceToken(pass.controlToken);
      setControlPassAttempt((attempt) => attempt + 1);
    } catch (caught) {
      setControlPassError(humanError(caught));
    } finally {
      controlPassInFlight.current = false;
      setControlPassBusy(false);
    }
  }

  const block = snapshot?.currentBlock ?? null;
  const joinUrl = snapshot
    ? `${typeof window === "undefined" ? "" : window.location.origin}/join?code=${snapshot.code}`
    : "";
  const remainingSeconds = presentationRemainingSeconds(snapshot, snapshotReceivedAt.current, now);
  const busy = commandState.busy || legacyAdvanceBusy || controlPassBusy;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <CreatorBrand productFeatures={productFeatures} />
        <div className="button-row">
          <Link href="/sessions">{t("live.common.sessions")}</Link>
          {snapshot?.phase === "finished" ? (
            <Link className="button small-button" href={`/presentation-session/${id}/report`}>
              {t("live.presentationSession.viewReport")}
            </Link>
          ) : null}
        </div>
      </header>
      <div className={styles.stage}>
        <p aria-live="polite" className="muted" role="status">
          {connection === "connected"
            ? "Connected"
            : connection === "fallback"
              ? "Connected using compatibility mode"
              : "Reconnecting…"}
        </p>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        {!snapshot ? (
          <section className={styles.canvas}>{t("live.presentationSession.loading")}</section>
        ) : (
          <div className={styles.hostGrid}>
            <section className={styles.canvas} aria-live="polite">
              <div className={styles.canvasContent}>
                {snapshot.phase === "lobby" ? (
                  <>
                    <span className={styles.statusPill}>
                      {t("live.presentationSession.waitingRoom")}
                    </span>
                    <h1 lang="">{snapshot.title}</h1>
                    <p>{t("live.presentationSession.participantsCanJoin")}</p>
                  </>
                ) : null}
                {block?.kind === "content" ? (
                  <>
                    <span className={styles.statusPill}>
                      {t("live.presentationSession.contentSlide")}
                    </span>
                    <ContentSlideView
                      block={block}
                      media={
                        <PresentationMedia
                          altText={block.mediaAlt}
                          mediaId={block.mediaId}
                          sessionId={id}
                        />
                      }
                      variant="live"
                    />
                  </>
                ) : null}
                {block?.kind === "question" ? (
                  <>
                    <span className={styles.statusPill}>
                      {snapshot.phase === "intervention"
                        ? t("live.presentationSession.recoveryIntervention")
                        : snapshot.phase === "question_reveal"
                          ? t("live.presentationSession.responseReview")
                          : snapshot.acceptingResponses
                            ? t("live.presentationSession.questionOpen")
                            : t("live.presentationSession.timeEnded")}
                    </span>
                    {remainingSeconds !== null ? (
                      <p className={styles.timer} aria-live="off">
                        {formatNumber(locale, remainingSeconds, {
                          style: "unit",
                          unit: "second",
                          unitDisplay: "narrow",
                        })}
                      </p>
                    ) : snapshot.acceptingResponses && snapshot.settings.timeMode === "flex" ? (
                      <p className="muted" lang={locale} role="status">
                        {t("live.common.flexOpen")}
                      </p>
                    ) : null}
                    <h1 lang="">{block.question.prompt}</h1>
                    <PresentationMedia
                      altText={block.question.mediaAlt}
                      mediaId={block.question.mediaId}
                      sessionId={id}
                    />
                    {block.question.choices.length ? (
                      <div className={styles.choiceGrid}>
                        {block.question.choices.map((choice) => (
                          <div
                            className={styles.choice}
                            data-correct={
                              block.revealedAnswer?.kind === "choice"
                                ? block.revealedAnswer.correctChoiceIds.includes(choice.id)
                                : undefined
                            }
                            key={choice.id}
                            lang=""
                          >
                            {choice.label}
                          </div>
                        ))}
                      </div>
                    ) : block.question.type === "numeric" ? (
                      <p>{t("live.presentationSession.numericResponse")}</p>
                    ) : (
                      <p>{t("live.presentationSession.ratingResponse")}</p>
                    )}
                    {block.revealedAnswer?.kind === "numeric" ? (
                      <p className="notice" lang="">
                        {block.revealedAnswer.correctValue}
                        {block.revealedAnswer.tolerance !== "0"
                          ? ` ± ${block.revealedAnswer.tolerance}`
                          : ""}
                        {block.revealedAnswer.unit ? ` ${block.revealedAnswer.unit}` : ""}
                      </p>
                    ) : null}
                    {block.revealedAnswer?.explanation ? (
                      <p className="notice" lang="">
                        {block.revealedAnswer.explanation}
                      </p>
                    ) : null}
                    {snapshot.phase === "intervention" && snapshot.recoveryPackIntervention ? (
                      <RecoveryPackLiveCardView card={snapshot.recoveryPackIntervention.card} />
                    ) : null}
                  </>
                ) : null}
                {snapshot.phase === "finished" ? (
                  <>
                    <span className={styles.statusPill}>{t("live.common.complete")}</span>
                    <h1>{t("live.presentationSession.finished")}</h1>
                    <p>{t("live.presentationSession.completeDescription")}</p>
                    <Link className="button" href={`/presentation-session/${id}/report`}>
                      {t("live.presentationSession.openReport")}
                    </Link>
                  </>
                ) : null}
              </div>
            </section>
            <aside className={styles.sideCard}>
              <h2 className="sr-only" lang="en-CA">
                Facilitation controls
              </h2>
              <div>
                <span className={styles.statusPill}>{t("live.presentationSession.joinCode")}</span>
                <p className={styles.joinCode}>{snapshot.code}</p>
                <Link href={`/join?code=${snapshot.code}`}>
                  {t("live.presentationSession.openJoin")}
                </Link>
              </div>
              <div className={styles.metricRow}>
                <div className={styles.metric}>
                  <strong>{formatNumber(locale, snapshot.roomStatus.joinedCount)}</strong>
                  <span>{t("live.common.participants")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>{formatNumber(locale, snapshot.roomStatus.responseCount)}</strong>
                  <span>{t("live.presentationSession.responsesNow")}</span>
                </div>
              </div>
              <p className="muted" aria-live="polite">
                {formatNumber(locale, snapshot.roomStatus.connectedCount)} connected ·{" "}
                {formatNumber(locale, snapshot.roomStatus.notCurrentlyConnectedCount)} not currently
                connected
              </p>
              <p>
                {t("live.presentationSession.blockProgress", {
                  current: formatNumber(locale, Math.max(snapshot.currentBlockIndex + 1, 0)),
                  total: formatNumber(locale, snapshot.blockCount),
                })}
              </p>
              {snapshot.phase !== "finished" ? (
                <button
                  className="button full-width"
                  disabled={
                    busy || !!commandState.pendingCommand || !controllerRef.current?.canMutate()
                  }
                  onClick={() => void advance()}
                  type="button"
                >
                  {busy ? t("live.common.updating") : t(advanceMessageKey(snapshot))}
                </button>
              ) : null}
              {!hasControlPass &&
              (snapshot.phase !== "finished" || !!commandState.pendingCommand) ? (
                <div lang="en-CA">
                  <p className="muted" role="status">
                    {commandState.pendingCommand
                      ? "Reacquire a host control pass to confirm the pending action."
                      : "Recovery Pack card actions require a host control pass. You can still advance using compatibility mode."}
                    {controlPassError ? ` ${controlPassError}` : ""}
                  </p>
                  <button
                    className="button-quiet full-width"
                    disabled={busy}
                    onClick={() => void retryControlPass()}
                    type="button"
                  >
                    {controlPassBusy ? "Acquiring host control pass…" : "Retry host control pass"}
                  </button>
                </div>
              ) : null}
              {commandState.pendingCommand ? (
                <div lang="en-CA">
                  <p className="muted" role="status" aria-live="polite">
                    {commandState.busy
                      ? "Waiting for server confirmation…"
                      : "Action not yet confirmed. Retry to confirm the original action."}
                  </p>
                  {!commandState.busy ? (
                    <button
                      className="button-quiet full-width"
                      disabled={!hasControlPass || busy || !controllerRef.current?.canMutate()}
                      onClick={() => void retryCommand()}
                      type="button"
                    >
                      {commandState.pendingCommand.action === "start_recovery_card"
                        ? "Retry card action acknowledgement"
                        : "Retry advance acknowledgement"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {snapshot.phase === "question_reveal" && snapshot.recoveryPackCards?.length ? (
                <RecoveryPackCardPicker
                  key={snapshot.currentBlock?.id}
                  cards={snapshot.recoveryPackCards}
                  disabled={
                    !hasControlPass ||
                    busy ||
                    !!commandState.pendingCommand ||
                    !controllerRef.current?.canMutate()
                  }
                  onStart={(selection, type) => void startRecoveryCard(selection, type)}
                />
              ) : null}
              <button
                className="button-quiet full-width"
                disabled={!joinUrl}
                onClick={() => void navigator.clipboard?.writeText(joinUrl)}
                type="button"
              >
                {t("live.presentationSession.copyJoinLink")}
              </button>
              <PresentationCompanionLauncher
                sessionId={id}
                enabled={productFeatures?.presentationCompanion === true}
                canEdit={canEdit}
              />
              {snapshot.participants.length ? (
                <details>
                  <summary>
                    {t("live.common.leaderboard")} ·{" "}
                    {t("live.common.joinedCount", {
                      count: formatNumber(locale, snapshot.participants.length),
                    })}
                  </summary>
                  <ol className={styles.leaderboard}>
                    {snapshot.participants.map((participant) => (
                      <li key={participant.id}>
                        <span lang="">{participant.nickname}</span>
                        <strong>{formatNumber(locale, participant.score)}</strong>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </aside>
          </div>
        )}
      </div>
      {snapshot && audienceToken ? (
        <PresentationQnaPanel
          key={id}
          sessionId={id}
          token={audienceToken}
          role="host"
          closed={snapshot.phase === "finished"}
        />
      ) : null}
    </main>
  );
}

export default function PresentationHostPage() {
  return (
    <WorkspaceProvider>
      <PresentationHostContent />
    </WorkspaceProvider>
  );
}
