"use client";

import Link from "next/link";
import { CompetitionDashboard } from "../../../../components/competition-dashboard";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
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
import { PresentationActivitySlide } from "../../../../components/presentation/presentation-activity-slide";
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
import presenter from "../../../../components/presentation-live/presentation-presenter.module.css";
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
import { presentationPresenterAction } from "../../../../lib/presentation-presenter-controls";
import { PresenterTimer } from "../../../../components/presentation-live/presenter-timer";
import { PresentationOpinionResults } from "../../../../components/presentation-live/opinion-results";
import { PresentationTextResults } from "../../../../components/presentation-live/text-results";
import { PresentationTextModerationPanel } from "../../../../components/presentation-live/text-moderation";
import { isTextQuestion } from "../../../../lib/text-response";
import { presentationOpinionSummaryFor } from "../../../../lib/presentation-opinion-response";
import { PresentationStageLauncher } from "../../../../components/presentation-live/stage-launcher";
import { PresentationDeliveryBlock } from "../../../../components/presentation-live/delivery-block";
import { PresentationDeliveryJoinAccess } from "../../../../components/presentation-live/delivery-join-access";
import delivery from "../../../../components/presentation-live/presentation-delivery.module.css";
import { PresentationNavigationDialog } from "../../../../components/presentation-live/presentation-navigation";
import {
  isPresentationRecoverableCommand,
  persistPresentationNavigationCommand,
  restorePresentationNavigationCommand,
} from "../../../../lib/presentation-navigation";
import {
  branchNavigationCopy,
  branchNavigationRetryLabel,
} from "../../../../components/presentation/branch-navigation-copy";
import { companionCopy } from "../../../../lib/i18n/domains/live-delivery/companion-translations";
import { presentationInteractionRuntime } from "../../../../lib/presentation-interaction-runtime";
import { PresentationBranches } from "../../../../components/presentation-live/presentation-branches";
import { PresentationSpatialDelivery } from "../../../../components/presentation-live/presentation-spatial-delivery";

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
  const navigationCopy = branchNavigationCopy(locale);
  const sharedCopy = companionCopy(locale);
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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationButtonRef = useRef<HTMLButtonElement>(null);
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
            "This host control pass is no longer valid. Reacquire it to use live controls.",
          );
          setControlPassAttempt((attempt) => attempt + 1);
        },
      });
      controllerRef.current = controller;
      if (controlToken && (!commandsRef.current || commandsSessionId.current !== id)) {
        commandsRef.current = createPresentationCommandRecovery<PresentationHostSnapshot>({
          pendingCommand: restorePresentationNavigationCommand(sessionStorage, id, {
            controlToken,
          }),
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
            persistPresentationNavigationCommand(sessionStorage, id, "host", next.pendingCommand);
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
      return await commands.run(command);
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

  async function navigate(action: "jump_to_block" | "return_to_path", targetBlockId?: string) {
    const controlToken = passManagerRef.current?.token();
    if (!snapshot?.navigation || !controlToken) return;
    if (
      action === "jump_to_block" &&
      !snapshot.navigation.entries.some(
        (entry) => entry.blockId === targetBlockId && entry.status !== "current" && entry.canJump,
      )
    )
      return;
    if (action === "return_to_path" && !snapshot.navigation.canReturn) return;
    const command: PresentationCommand =
      action === "jump_to_block"
        ? { ...commandCredentials(controlToken), action, targetBlockId: targetBlockId! }
        : { ...commandCredentials(controlToken), action };
    if (await runCommand(command)) setNavigationOpen(false);
  }

  async function sceneAction(nodeId: string, revealed?: boolean) {
    const controlToken = passManagerRef.current?.token();
    const block = snapshot?.currentBlock;
    if (!snapshot || block?.kind !== "content" || !controlToken) return;
    const node = block.scene?.nodes.find((entry) => entry.id === nodeId);
    if (typeof revealed === "boolean") {
      if (node?.type !== "reveal" || node.scope !== "broadcast") return;
      return runCommand({
        ...commandCredentials(controlToken),
        action: "set_reveal",
        blockId: block.id,
        nodeId,
        revealed,
      });
    }
    if (
      node?.type !== "navigation" ||
      !snapshot.navigation?.entries.some(
        (entry) =>
          entry.blockId.toLowerCase() === node.targetBlockId?.toLowerCase() &&
          entry.canJump &&
          entry.status !== "current",
      )
    )
      return;
    return runCommand({
      ...commandCredentials(controlToken),
      action: "navigate_scene",
      blockId: block.id,
      nodeId,
    });
  }

  async function followBranch(branchId: string) {
    const controlToken = passManagerRef.current?.token();
    if (
      !snapshot ||
      snapshot.currentBlock?.kind !== "question" ||
      !controlToken ||
      !snapshot.branches?.some((branch) => branch.id === branchId && branch.available)
    )
      return;
    return runCommand({
      ...commandCredentials(controlToken),
      action: "follow_branch",
      blockId: snapshot.currentBlock.id,
      branchId,
    });
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
      const response = await commands.retry();
      if (response) setNavigationOpen(false);
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
  const opinionSummary = presentationOpinionSummaryFor(snapshot);
  const remainingSeconds = presentationRemainingSeconds(snapshot, snapshotReceivedAt.current, now);
  const busy = commandState.busy || legacyAdvanceBusy || controlPassBusy;
  const interactionRuntime = presentationInteractionRuntime(snapshot, {
    mode: "live_staff",
    disabled:
      busy ||
      !!commandState.pendingCommand ||
      !hasControlPass ||
      !controllerRef.current?.canMutate(),
    onNavigate: (nodeId) => void sceneAction(nodeId),
    onSetReveal: (nodeId, revealed) => void sceneAction(nodeId, revealed),
  });

  const onPresenterKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      !snapshot ||
      snapshot.phase === "finished" ||
      busy ||
      commandState.pendingCommand ||
      legacyAdvanceInFlight.current ||
      controlPassInFlight.current ||
      !controllerRef.current?.canMutate()
    )
      return;
    if (
      presentationPresenterAction(event, {
        dialogOpen: !!document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
        ),
      }) !== "advance"
    )
      return;
    event.preventDefault();
    void advance();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onPresenterKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <CreatorBrand productFeatures={productFeatures} />
        <div className="button-row">
          <p aria-live="polite" className={presenter.headerStatus} role="status">
            {connection === "connected"
              ? "Connected"
              : connection === "fallback"
                ? "Connected using compatibility mode"
                : "Reconnecting…"}
          </p>
          <Link href="/sessions">{t("live.common.sessions")}</Link>
          {snapshot?.phase === "finished" ? (
            <Link className="button small-button" href={`/presentation-session/${id}/report`}>
              {t("live.presentationSession.viewReport")}
            </Link>
          ) : null}
        </div>
      </header>
      <div className={styles.stage}>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        {!snapshot ? (
          <section className={styles.canvas}>{t("live.presentationSession.loading")}</section>
        ) : (
          <>
            <p className={delivery.privateNotice} lang="en-CA">
              Private presenter workspace. Share the audience stage window with your audience.
            </p>
            <section className={presenter.commandBar} aria-label="Facilitation controls">
              <div className={presenter.commandRow}>
                <div className={presenter.commandContext}>
                  <h1 lang="">{snapshot.title}</h1>
                  <p>
                    {t("live.presentationSession.blockProgress", {
                      current: formatNumber(locale, Math.max(snapshot.currentBlockIndex + 1, 0)),
                      total: formatNumber(locale, snapshot.blockCount),
                    })}
                  </p>
                </div>
                <div className={presenter.commandActions}>
                  {snapshot.navigation ? (
                    <button
                      className="button-quiet full-width"
                      type="button"
                      lang={locale}
                      ref={navigationButtonRef}
                      aria-haspopup="dialog"
                      aria-expanded={navigationOpen}
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        setNavigationOpen(true);
                      }}
                    >
                      {sharedCopy("Open navigation")}
                    </button>
                  ) : null}
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
                </div>
              </div>
              {!hasControlPass &&
              (snapshot.phase !== "finished" || !!commandState.pendingCommand) ? (
                <div lang={locale}>
                  <p className="muted" role="status">
                    {commandState.pendingCommand
                      ? navigationCopy(
                          "Reacquire a host control pass to confirm the pending action.",
                        )
                      : navigationCopy(
                          "Live navigation and Recovery Pack card actions require a host control pass. You can still advance using compatibility mode.",
                        )}
                    {controlPassError ? <span lang="en-CA"> {controlPassError}</span> : null}
                  </p>
                  <button
                    className="button-quiet full-width"
                    disabled={busy}
                    onClick={() => void retryControlPass()}
                    type="button"
                  >
                    {navigationCopy(
                      controlPassBusy ? "Acquiring host control pass…" : "Retry host control pass",
                    )}
                  </button>
                </div>
              ) : null}
              {commandState.pendingCommand ? (
                <div lang={locale}>
                  <p className="muted" role="status" aria-live="polite">
                    {commandState.busy
                      ? sharedCopy("Waiting for server confirmation…")
                      : sharedCopy(
                          "Action not yet confirmed. Retry to confirm the original action.",
                        )}
                  </p>
                  {!commandState.busy ? (
                    <button
                      className="button-quiet full-width"
                      disabled={!hasControlPass || busy || !controllerRef.current?.canMutate()}
                      onClick={() => void retryCommand()}
                      type="button"
                    >
                      {isPresentationRecoverableCommand(commandState.pendingCommand)
                        ? branchNavigationRetryLabel(locale, commandState.pendingCommand)
                        : commandState.pendingCommand.action === "start_recovery_card"
                          ? sharedCopy("Retry card action acknowledgement")
                          : sharedCopy("Retry advance acknowledgement")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
            <div className={`${styles.hostGrid} ${presenter.hostGrid}`}>
              <div className={delivery.presenterColumn}>
                <PresentationSpatialDelivery
                  spatial={snapshot.spatial}
                  currentBlockIndex={snapshot.currentBlockIndex}
                  phase={snapshot.phase}
                  sourceKey={`${id}:${snapshot.presentationVersionId}`}
                  navigation={snapshot.navigation}
                  disabled={
                    busy ||
                    !!commandState.pendingCommand ||
                    !hasControlPass ||
                    !controllerRef.current?.canMutate()
                  }
                  onJump={(blockId) => void navigate("jump_to_block", blockId)}
                />
                <section className={styles.canvas} aria-live="polite" aria-label="Current slide">
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
                          designOverride={block.design}
                          interactionRuntime={interactionRuntime}
                          interactionSourceKey={JSON.stringify([
                            id,
                            audienceToken,
                            connection === "fallback",
                          ])}
                          renderSceneImage={(mediaId, altText) => (
                            <PresentationMedia
                              key={mediaId}
                              sessionId={id}
                              mediaId={mediaId}
                              altText={altText}
                            />
                          )}
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
                        <PresentationActivitySlide
                          question={block.question}
                          design={block.design}
                          media={
                            block.question.mediaId ? (
                              <PresentationMedia
                                altText={block.question.mediaAlt}
                                mediaId={block.question.mediaId}
                                sessionId={id}
                              />
                            ) : undefined
                          }
                          revealedChoiceIds={
                            block.revealedAnswer?.kind === "choice"
                              ? block.revealedAnswer.correctChoiceIds
                              : undefined
                          }
                        />
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
                        {opinionSummary ? (
                          <PresentationOpinionResults summary={opinionSummary} />
                        ) : null}
                        {isTextQuestion(block.question.type) ? (
                          <PresentationTextResults
                            sessionId={id}
                            blockId={block.id}
                            type={block.question.type}
                            revision={snapshot.revision}
                            seq={snapshot.seq}
                            phase={snapshot.phase}
                            projection="creator"
                          />
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
                        <p>
                          {t("live.common.joinedCount", {
                            count: formatNumber(locale, snapshot.participantCount),
                          })}
                        </p>
                        <Link className="button" href={`/presentation-session/${id}/report`}>
                          {t("live.presentationSession.openReport")}
                        </Link>
                      </>
                    ) : null}
                  </div>
                </section>
                <div className={delivery.backstage} lang="en-CA">
                  <section className={delivery.panel} aria-label="Private speaker notes">
                    <h2>Private speaker notes</h2>
                    <div
                      className={delivery.notes}
                      tabIndex={0}
                      role="group"
                      aria-label="Speaker notes text"
                    >
                      <p lang={snapshot.presenter?.speakerNotes ? "" : "en-CA"}>
                        {snapshot.presenter?.speakerNotes || "No speaker notes for this slide."}
                      </p>
                    </div>
                  </section>
                  <section className={delivery.panel} aria-label="Next slide preview">
                    <h2>Next slide preview</h2>
                    {snapshot.presenter?.nextBlock ? (
                      <div
                        className={delivery.nextPreview}
                        tabIndex={0}
                        role="group"
                        aria-label="Next slide content"
                      >
                        <PresentationDeliveryBlock
                          accessibilityContext="preview"
                          block={snapshot.presenter.nextBlock}
                          interactionRuntime={{ mode: "live_audience" }}
                          interactionSourceKey={JSON.stringify([
                            id,
                            audienceToken,
                            connection === "fallback",
                          ])}
                          renderMedia={(mediaId, altText) => (
                            <PresentationMedia
                              key={`${snapshot.presenter?.nextBlock?.id}:${mediaId}`}
                              sessionId={id}
                              mediaId={mediaId}
                              altText={altText}
                            />
                          )}
                        />
                      </div>
                    ) : (
                      <p>
                        {snapshot.phase === "finished"
                          ? "Presentation complete."
                          : "No further slides or activities."}
                      </p>
                    )}
                  </section>
                </div>
              </div>
              <aside className={`${styles.sideCard} ${presenter.tools}`}>
                <details className={presenter.toolGroup}>
                  <summary>
                    {t("live.presentationSession.joinCode")}{" "}
                    <strong lang="">{snapshot.code}</strong>
                  </summary>
                  <PresentationDeliveryJoinAccess code={snapshot.code} />
                </details>
                <PresentationStageLauncher
                  key={id}
                  sessionId={id}
                  canEdit={canEdit}
                  finished={snapshot.phase === "finished"}
                />
                <PresenterTimer sessionId={id} />
                <div className={`${styles.metricRow} ${presenter.liveMetrics}`}>
                  <div className={styles.metric}>
                    <strong>{formatNumber(locale, snapshot.roomStatus.joinedCount)}</strong>
                    <span>{t("live.common.participants")}</span>
                  </div>
                  <div className={styles.metric}>
                    <strong>{formatNumber(locale, snapshot.roomStatus.responseCount)}</strong>
                    <span>{t("live.presentationSession.responsesNow")}</span>
                  </div>
                </div>
                <p className={presenter.roomStatus} aria-live="polite" lang="en-CA">
                  {formatNumber(locale, snapshot.roomStatus.connectedCount)} connected ·{" "}
                  {formatNumber(locale, snapshot.roomStatus.notCurrentlyConnectedCount)} not
                  currently connected
                </p>
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
                {snapshot.branches ? (
                  <PresentationBranches
                    locale={locale}
                    branches={snapshot.branches}
                    disabled={
                      busy ||
                      !!commandState.pendingCommand ||
                      !hasControlPass ||
                      !controllerRef.current?.canMutate()
                    }
                    onFollow={(branchId) => void followBranch(branchId)}
                  />
                ) : null}
                <p className={presenter.keyboardHint} lang="en-CA">
                  Advance with Right Arrow, Page Down or Space when no control or dialog is focused.
                  Each action waits for server confirmation.
                </p>
                <div className={presenter.companionTools}>
                  <PresentationCompanionLauncher
                    sessionId={id}
                    enabled={productFeatures?.presentationCompanion === true}
                    canEdit={canEdit}
                  />
                </div>
                {snapshot.competitionStandings ? (
                  <CompetitionDashboard
                    variant="host"
                    standings={snapshot.competitionStandings}
                    finished={snapshot.phase === "finished"}
                    compact={snapshot.phase !== "finished"}
                  />
                ) : null}
              </aside>
            </div>
          </>
        )}
      </div>
      {navigationOpen && snapshot?.navigation ? (
        <PresentationNavigationDialog
          locale={locale}
          navigation={snapshot.navigation}
          disabled={
            busy ||
            !!commandState.pendingCommand ||
            !hasControlPass ||
            !controllerRef.current?.canMutate()
          }
          onJump={(blockId) => void navigate("jump_to_block", blockId)}
          onReturn={() => void navigate("return_to_path")}
          onClose={() => setNavigationOpen(false)}
          returnFocusRef={navigationButtonRef}
          pendingCommand={commandState.pendingCommand}
          busy={commandState.busy}
          onRetry={() => void retryCommand()}
          retryDisabled={!hasControlPass || busy || !controllerRef.current?.canMutate()}
        />
      ) : null}
      {snapshot?.textModerationAvailable && audienceToken ? (
        <PresentationTextModerationPanel
          sessionId={id}
          blockId={
            block?.kind === "question" && isTextQuestion(block.question.type) ? block.id : null
          }
          revision={snapshot.revision}
          seq={snapshot.seq}
          phase={snapshot.phase}
          credential={audienceToken}
          disabled={
            busy ||
            !hasControlPass ||
            !!commandState.pendingCommand ||
            !controllerRef.current?.canMutate()
          }
          onChanged={() => {
            void controllerRef.current?.reconcile();
          }}
        />
      ) : null}
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
