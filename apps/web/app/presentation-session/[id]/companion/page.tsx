"use client";

import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PresentationCompanionSnapshotSchema,
  type PresentationCompanionCommand,
  type PresentationCompanionSnapshot,
  type PresentationQuickCheckInput,
  type PresentationPublishedQuestionSelection,
  type RecoveryPackCardSelection,
} from "@openround/contracts";
import { useLocale } from "../../../../components/locale-provider";
import { CompanionOverlay } from "../../../../components/presentation-live/companion-overlay";
import { PresentationQnaPanel } from "../../../../components/presentation-live/presentation-qna";
import { CompanionQuickCheckForm } from "../../../../components/presentation-live/companion-quick-check";
import { CompanionPublishedQuestionPicker } from "../../../../components/presentation-live/companion-published-questions";
import {
  CompanionRecoveryPackPicker,
  CompanionRecoveryCardPicker,
} from "../../../../components/presentation-live/companion-recovery-packs";
import { RecoveryPackLiveCardView } from "../../../../components/recovery-pack-live-card";
import styles from "../../../../components/presentation-live/companion.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import {
  capturePresentationCompanionPass,
  rejectPresentationCompanionPass,
} from "../../../../lib/presentation-companion-pass";
import {
  createPresentationCommandRecovery,
  type PresentationCommandRecoveryState,
} from "../../../../lib/presentation-command-recovery";
import {
  createPresentationRealtimeController,
  type PresentationConnectionState,
  type PresentationRealtimeController,
} from "../../../../lib/presentation-realtime";
import { formatNumber } from "../../../../lib/i18n/format";
import { clientUuid } from "../../../../lib/uuid";
import { isPresentationHostPassRejection } from "../../../../lib/presentation-host-pass";
import {
  companionCommandRetryMessageKey,
  fetchPresentationCompanionRecoveryPacks,
  type CompanionRecoveryPackCatalog,
} from "../../../../lib/presentation-companion-recovery-packs";
import { createCompanionQuickCheckDraft } from "../../../../lib/presentation-companion-quick-check";
import {
  fetchPresentationCompanionPublishedQuestions,
  selectedPublishedQuestion,
  type CompanionPublishedQuestionCatalog,
} from "../../../../lib/presentation-companion-published-questions";

function companionAdvanceMessageKey(snapshot: PresentationCompanionSnapshot) {
  if (snapshot.phase === "lobby") return "live.presentationSession.advance.start" as const;
  if (snapshot.phase === "question_open") return "live.presentationSession.advance.reveal" as const;
  if (snapshot.phase === "question_reveal") return "live.companion.continue" as const;
  if (snapshot.phase === "intervention")
    return "live.presentationSession.advance.continueRecheck" as const;
  if (snapshot.currentBlockIndex >= snapshot.blockCount - 1)
    return "live.presentationSession.advance.finish" as const;
  return "live.presentationSession.advance.next" as const;
}

/** Shareable aggregate results are available only for the current, closed question. */
function companionResults(snapshot: PresentationCompanionSnapshot | null) {
  if (
    !snapshot?.resultSummary ||
    snapshot.acceptingResponses ||
    !["question_reveal", "intervention", "finished"].includes(snapshot.phase) ||
    snapshot.currentBlock?.kind !== "question" ||
    snapshot.currentBlock.id !== snapshot.resultSummary.blockId
  )
    return null;
  return snapshot.resultSummary;
}

type CompanionRecovery = ReturnType<
  typeof createPresentationCommandRecovery<
    PresentationCompanionSnapshot,
    PresentationCompanionCommand
  >
>;

export default function PresentationCompanionPage() {
  const { id } = useParams<{ id: string }>();
  const { locale, t } = useLocale();
  const [pass, setPass] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [snapshot, setSnapshot] = useState<PresentationCompanionSnapshot | null>(null);
  const [connection, setConnection] = useState<PresentationConnectionState>("connecting");
  const [commandState, setCommandState] = useState<
    PresentationCommandRecoveryState<PresentationCompanionCommand>
  >({ busy: false, pendingCommand: null });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [overlay, setOverlay] = useState<
    "join" | "results" | "packs" | "quickCheck" | "publishedQuestions" | null
  >(null);
  const [quickCheckDraft, setQuickCheckDraft] = useState(createCompanionQuickCheckDraft);
  const [packCatalog, setPackCatalog] = useState<CompanionRecoveryPackCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [publishedQuestionCatalog, setPublishedQuestionCatalog] =
    useState<CompanionPublishedQuestionCatalog | null>(null);
  const [publishedQuestionLoading, setPublishedQuestionLoading] = useState(false);
  const [publishedQuestionError, setPublishedQuestionError] = useState("");
  const catalogRequest = useRef(0);
  const passRef = useRef(pass);
  passRef.current = pass;
  const controllerRef =
    useRef<PresentationRealtimeController<PresentationCompanionSnapshot> | null>(null);
  const commandsRef = useRef<CompanionRecovery | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  const rejectPass = useCallback(
    (rejectedToken: string) => {
      if (passRef.current !== rejectedToken) return;
      rejectPresentationCompanionPass(sessionStorage, id, rejectedToken);
      passRef.current = null;
      catalogRequest.current += 1;
      setRejected(true);
      setPass(null);
      setSnapshot(null);
      setOverlay(null);
      setPackCatalog(null);
      setCatalogLoading(false);
      setCatalogError("");
      setPublishedQuestionCatalog(null);
      setPublishedQuestionLoading(false);
      setPublishedQuestionError("");
      setError("");
    },
    [id],
  );

  useLayoutEffect(() => {
    try {
      setPass(
        capturePresentationCompanionPass({
          sessionId: id,
          location: window.location,
          history: window.history,
          storage: sessionStorage,
        }),
      );
    } catch {
      setError(t("live.companion.missingPass"));
    }
    setCaptured(true);
  }, [id, t]);

  const applySnapshot = useCallback(
    (incoming: PresentationCompanionSnapshot) => setSnapshot(incoming),
    [],
  );

  useEffect(() => {
    if (!pass) return;
    let disposed = false;
    const controller = createPresentationRealtimeController<PresentationCompanionSnapshot>({
      sessionId: id,
      credential: { projection: "companion", companionToken: pass },
      fetchSnapshot: async () => {
        const response = await apiFetch<{ snapshot: unknown }>(
          `/v1/presentation-sessions/${id}/companion?includeQuickChecks=true&includePublishedQuestions=true`,
          { credentials: "omit", headers: { authorization: `Bearer ${pass}` } },
        );
        const incoming = PresentationCompanionSnapshotSchema.parse(response.snapshot);
        if (!disposed) setError("");
        return incoming;
      },
      onSnapshot: (incoming) => {
        if (!disposed) applySnapshot(incoming);
      },
      onConnectionState: (next) => {
        if (!disposed) setConnection(next);
      },
      onRoomStatus: (roomStatus) => {
        if (!disposed) setSnapshot((current) => (current ? { ...current, roomStatus } : current));
      },
      onCredentialRejected: (rejectedToken) => {
        if (!disposed) rejectPass(rejectedToken);
      },
      onError: (caught) => {
        if (!disposed) setError(humanError(caught));
      },
    });
    controllerRef.current = controller;
    const commands = createPresentationCommandRecovery<
      PresentationCompanionSnapshot,
      PresentationCompanionCommand
    >({
      execute: (command) =>
        controller.command(command, async () => {
          const response = await apiFetch<{ snapshot: unknown }>(
            `/v1/presentation-sessions/${id}/companion-command?includeQuickChecks=true&includePublishedQuestions=true`,
            { method: "POST", credentials: "omit", body: JSON.stringify(command) },
          );
          return PresentationCompanionSnapshotSchema.parse(response.snapshot);
        }),
      onState: (next) => {
        if (!disposed) setCommandState(next);
      },
    });
    commandsRef.current = commands;
    controller.start();
    const fallbackTimer = window.setInterval(() => {
      if (controller.needsFallbackPolling()) void controller.reconcile();
    }, 1_500);
    // Periodic authorization checks also discover expiration/revocation while a quiet room is connected.
    const authorizationTimer = window.setInterval(() => void controller.reconcile(), 15_000);
    return () => {
      disposed = true;
      catalogRequest.current += 1;
      window.clearInterval(fallbackTimer);
      window.clearInterval(authorizationTimer);
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (commandsRef.current === commands) commandsRef.current = null;
    };
  }, [applySnapshot, id, pass, rejectPass]);

  const results = companionResults(snapshot);
  useEffect(() => {
    if (!results && overlay === "results") setOverlay(null);
  }, [overlay, results]);

  function closeOverlay() {
    catalogRequest.current += 1;
    setOverlay(null);
    setPackCatalog(null);
    setCatalogLoading(false);
    setCatalogError("");
    setPublishedQuestionCatalog(null);
    setPublishedQuestionLoading(false);
    setPublishedQuestionError("");
  }

  function openQuickCheck() {
    const commands = commandsRef.current;
    if (
      !pass ||
      !snapshot?.canInsertQuickCheck ||
      !controllerRef.current?.canMutate() ||
      !commands ||
      commands.state().busy ||
      commands.state().pendingCommand
    )
      return;
    setOverlay("quickCheck");
  }

  async function openPackPicker() {
    if (!pass || !snapshot?.canInsertRecoveryPack || commandsRef.current?.state().pendingCommand)
      return;
    const request = ++catalogRequest.current;
    const requestedPass = pass;
    setOverlay("packs");
    setPackCatalog(null);
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const catalog = await fetchPresentationCompanionRecoveryPacks(id, requestedPass);
      if (request !== catalogRequest.current || passRef.current !== requestedPass) return;
      setPackCatalog(catalog);
    } catch (caught) {
      if (request !== catalogRequest.current || passRef.current !== requestedPass) return;
      if (isPresentationHostPassRejection(caught)) rejectPass(requestedPass);
      else {
        setCatalogError(humanError(caught));
        void controllerRef.current?.reconcile();
      }
    } finally {
      if (request === catalogRequest.current) setCatalogLoading(false);
    }
  }

  async function openPublishedQuestionPicker(search = "") {
    const commands = commandsRef.current;
    if (
      !pass ||
      !snapshot?.canInsertPublishedQuestion ||
      !controllerRef.current?.canMutate() ||
      !commands ||
      commands.state().busy ||
      commands.state().pendingCommand
    )
      return;
    const request = ++catalogRequest.current;
    const requestedPass = pass;
    setOverlay("publishedQuestions");
    setPublishedQuestionCatalog(null);
    setPublishedQuestionLoading(true);
    setPublishedQuestionError("");
    try {
      const catalog = await fetchPresentationCompanionPublishedQuestions(id, requestedPass, search);
      if (request !== catalogRequest.current || passRef.current !== requestedPass) return;
      setPublishedQuestionCatalog(catalog);
    } catch (caught) {
      if (request !== catalogRequest.current || passRef.current !== requestedPass) return;
      if (isPresentationHostPassRejection(caught)) rejectPass(requestedPass);
      else {
        setPublishedQuestionError(humanError(caught));
        void controllerRef.current?.reconcile();
      }
    } finally {
      if (request === catalogRequest.current) setPublishedQuestionLoading(false);
    }
  }

  async function executeCommand(command?: PresentationCompanionCommand) {
    const controller = controllerRef.current;
    const commands = commandsRef.current;
    if (!pass || !snapshot || !controller?.canMutate() || !commands || commands.state().busy)
      return;
    if (command && commands.state().pendingCommand) return;
    if (!command && !commands.state().pendingCommand) return;
    const activeCommand = command ?? commands.state().pendingCommand;
    setError("");
    setConfirmed(false);
    try {
      const response = command ? await commands.run(command) : await commands.retry();
      if (response) {
        setConfirmed(true);
        if (
          activeCommand?.action === "insert_recovery_pack" ||
          activeCommand?.action === "insert_quick_check" ||
          activeCommand?.action === "insert_published_question"
        )
          closeOverlay();
      }
      return response;
    } catch (caught) {
      if (!isPresentationHostPassRejection(caught)) setError(humanError(caught));
      await controller.reconcile();
    }
  }

  async function advanceOrRetry() {
    if (commandsRef.current?.state().pendingCommand) return executeCommand();
    if (!pass || !snapshot || snapshot.primaryAction !== "advance") return;
    return executeCommand({
      sessionId: id,
      companionToken: pass,
      commandId: clientUuid(),
      expectedRevision: snapshot.revision,
      action: "advance",
    });
  }

  async function insertPack(packVersionId: string) {
    if (
      !pass ||
      !snapshot?.canInsertRecoveryPack ||
      !packCatalog?.packs.some((pack) => pack.packVersionId === packVersionId)
    )
      return;
    return executeCommand({
      sessionId: id,
      companionToken: pass,
      commandId: clientUuid(),
      expectedRevision: snapshot.revision,
      action: "insert_recovery_pack",
      packVersionId,
    });
  }

  async function insertQuickCheck(quickCheck: PresentationQuickCheckInput) {
    if (!pass || !snapshot?.canInsertQuickCheck) return;
    return executeCommand({
      sessionId: id,
      companionToken: pass,
      commandId: clientUuid(),
      expectedRevision: snapshot.revision,
      action: "insert_quick_check",
      quickCheck,
    });
  }

  async function insertPublishedQuestion(
    publishedQuestion: PresentationPublishedQuestionSelection,
  ) {
    if (
      !pass ||
      !snapshot?.canInsertPublishedQuestion ||
      !selectedPublishedQuestion(publishedQuestionCatalog, publishedQuestion)
    )
      return;
    return executeCommand({
      sessionId: id,
      companionToken: pass,
      commandId: clientUuid(),
      expectedRevision: snapshot.revision,
      action: "insert_published_question",
      publishedQuestion,
    });
  }

  async function startRecoveryCard(
    recoveryPackCard: RecoveryPackCardSelection,
    interventionType: "explain" | "example",
  ) {
    if (
      !pass ||
      !snapshot ||
      snapshot.phase !== "question_reveal" ||
      snapshot.acceptingResponses ||
      !snapshot.recoveryPackCards?.some(
        (card) =>
          card.reference.insertionId === recoveryPackCard.insertionId &&
          card.reference.cardId === recoveryPackCard.cardId,
      )
    )
      return;
    return executeCommand({
      sessionId: id,
      companionToken: pass,
      commandId: clientUuid(),
      expectedRevision: snapshot.revision,
      action: "start_recovery_card",
      recoveryPackCard,
      interventionType,
    });
  }

  const joinUrl = snapshot
    ? `${typeof window === "undefined" ? "" : window.location.origin}/join?code=${encodeURIComponent(snapshot.code)}`
    : "";
  const block = snapshot?.currentBlock;
  return (
    <main className={styles.page}>
      <section className={styles.sidecar} aria-label={t("live.companion.title")}>
        <header>
          <h1>{t("live.companion.title")}</h1>
          <p className="muted" role="status" aria-live="polite">
            {t(
              !pass && captured
                ? "live.companion.disconnected"
                : connection === "fallback" && !snapshot
                  ? "live.companion.reconciling"
                  : `live.companion.${connection}`,
            )}
          </p>
        </header>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!pass && captured ? (
          <p role="status">
            {t(rejected ? "live.companion.passRejected" : "live.companion.missingPass")}
          </p>
        ) : null}
        {pass && !snapshot ? <p role="status">{t("live.companion.loading")}</p> : null}
        {snapshot ? (
          <>
            <div className={styles.current}>
              <span className={styles.phase}>{t(`live.companion.phase.${snapshot.phase}`)}</span>
              <h2 lang="">
                {block?.kind === "question"
                  ? block.question.prompt
                  : block?.kind === "content"
                    ? (block.textElements.find((element) => element.role === "title")?.text ??
                      snapshot.title)
                    : snapshot.title}
              </h2>
              <p className="muted">
                {t("live.presentationSession.blockProgress", {
                  current: formatNumber(locale, Math.max(0, snapshot.currentBlockIndex + 1)),
                  total: formatNumber(locale, snapshot.blockCount),
                })}
              </p>
            </div>
            <dl className={styles.metrics}>
              {(
                [
                  ["joined", snapshot.roomStatus.joinedCount],
                  ["answered", snapshot.roomStatus.responseCount],
                  ["connectedCount", snapshot.roomStatus.connectedCount],
                  ["disconnected", snapshot.roomStatus.notCurrentlyConnectedCount],
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <dt>{t(`live.companion.${label}`)}</dt>
                  <dd>{formatNumber(locale, count)}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.acknowledgement} role="status" aria-live="polite">
              {t(
                commandState.busy
                  ? "live.companion.waitingAck"
                  : commandState.pendingCommand
                    ? "live.companion.unconfirmed"
                    : confirmed
                      ? "live.companion.confirmed"
                      : "live.companion.ready",
              )}
            </p>
            <button
              className="button full-width"
              disabled={
                !pass ||
                commandState.busy ||
                !controllerRef.current?.canMutate() ||
                (!commandState.pendingCommand && snapshot.primaryAction !== "advance")
              }
              onClick={() => void advanceOrRetry()}
              ref={primaryButtonRef}
              type="button"
            >
              {t(
                commandState.busy
                  ? "live.common.updating"
                  : commandState.pendingCommand
                    ? companionCommandRetryMessageKey(commandState.pendingCommand)
                    : snapshot.primaryAction === "none"
                      ? "live.companion.noAction"
                      : companionAdvanceMessageKey(snapshot),
              )}
            </button>
            <div className={styles.secondary}>
              <button className="button-quiet" onClick={() => setOverlay("join")} type="button">
                {t("live.companion.showJoin")}
              </button>
              {results ? (
                <button
                  className="button-quiet"
                  onClick={() => setOverlay("results")}
                  type="button"
                >
                  {t("live.companion.showResults")}
                </button>
              ) : null}
              {snapshot.canInsertRecoveryPack !== undefined ? (
                <button
                  className="button-quiet"
                  disabled={
                    !pass ||
                    !snapshot.canInsertRecoveryPack ||
                    commandState.busy ||
                    !!commandState.pendingCommand
                  }
                  onClick={() => void openPackPicker()}
                  type="button"
                >
                  {t("live.companion.packs.open")}
                </button>
              ) : null}
              {snapshot.canInsertQuickCheck !== undefined ? (
                <button
                  className="button-quiet"
                  disabled={
                    !pass ||
                    !snapshot.canInsertQuickCheck ||
                    commandState.busy ||
                    !!commandState.pendingCommand ||
                    !controllerRef.current?.canMutate()
                  }
                  onClick={openQuickCheck}
                  type="button"
                >
                  {t("live.companion.quickCheck.open")}
                </button>
              ) : null}
              {snapshot.canInsertPublishedQuestion !== undefined ? (
                <button
                  className="button-quiet"
                  disabled={
                    !pass ||
                    !snapshot.canInsertPublishedQuestion ||
                    commandState.busy ||
                    !!commandState.pendingCommand ||
                    !controllerRef.current?.canMutate()
                  }
                  onClick={() => void openPublishedQuestionPicker()}
                  type="button"
                >
                  {t("live.companion.publishedQuestions.open")}
                </button>
              ) : null}
            </div>
            {snapshot.phase === "question_reveal" &&
            !snapshot.acceptingResponses &&
            snapshot.recoveryPackCards?.length ? (
              <CompanionRecoveryCardPicker
                key={snapshot.currentBlock?.id}
                cards={snapshot.recoveryPackCards}
                disabled={
                  !pass ||
                  commandState.busy ||
                  !!commandState.pendingCommand ||
                  !controllerRef.current?.canMutate()
                }
                onStart={(selection, interventionType) =>
                  void startRecoveryCard(selection, interventionType)
                }
              />
            ) : null}
            {snapshot.phase === "intervention" && snapshot.recoveryPackIntervention ? (
              <RecoveryPackLiveCardView card={snapshot.recoveryPackIntervention.card} />
            ) : null}
          </>
        ) : null}
      </section>
      {overlay === "join" && snapshot ? (
        <CompanionOverlay title={t("live.companion.joinTitle")} onClose={closeOverlay}>
          <p>{t("live.presentationSession.joinCode")}</p>
          <p className={styles.joinCode}>{snapshot.code}</p>
          <QRCodeSVG value={joinUrl} size={200} title={t("live.companion.joinQr")} />
          <a className={styles.joinLink} href={joinUrl} target="_blank" rel="noopener noreferrer">
            {joinUrl}
          </a>
        </CompanionOverlay>
      ) : null}
      {overlay === "results" && results && block?.kind === "question" ? (
        <CompanionOverlay title={t("live.companion.resultTitle")} onClose={closeOverlay}>
          <p lang="">{block.question.prompt}</p>
          <p>
            {t("live.companion.answered")}: {formatNumber(locale, results.responseCount)}
          </p>
          {results.choiceCounts.length ? (
            <dl className={styles.results}>
              {results.choiceCounts.map(({ choiceId, count }) => {
                const choice = block.question.choices.find(
                  (candidate) => candidate.id === choiceId,
                );
                return choice ? (
                  <div key={choiceId}>
                    <dt lang="">{choice.label}</dt>
                    <dd>{formatNumber(locale, count)}</dd>
                  </div>
                ) : null;
              })}
            </dl>
          ) : null}
        </CompanionOverlay>
      ) : null}
      {overlay === "packs" && snapshot && pass ? (
        <CompanionOverlay
          title={t("live.companion.packs.pickerTitle")}
          onClose={closeOverlay}
          returnFocusRef={primaryButtonRef}
        >
          <CompanionRecoveryPackPicker
            catalog={packCatalog}
            loading={catalogLoading}
            error={catalogError}
            disabled={
              !snapshot.canInsertRecoveryPack ||
              commandState.busy ||
              !!commandState.pendingCommand ||
              !controllerRef.current?.canMutate()
            }
            onReload={() => void openPackPicker()}
            onInsert={(packVersionId) => void insertPack(packVersionId)}
          />
          {commandState.pendingCommand ? (
            <>
              <p role="status">
                {t(commandState.busy ? "live.companion.waitingAck" : "live.companion.unconfirmed")}
              </p>
              {!commandState.busy ? (
                <button
                  className="button-quiet full-width"
                  disabled={!controllerRef.current?.canMutate()}
                  onClick={() => void executeCommand()}
                  type="button"
                >
                  {t(companionCommandRetryMessageKey(commandState.pendingCommand))}
                </button>
              ) : null}
            </>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </CompanionOverlay>
      ) : null}
      {overlay === "quickCheck" && snapshot && pass ? (
        <CompanionOverlay
          title={t("live.companion.quickCheck.title")}
          onClose={closeOverlay}
          returnFocusRef={primaryButtonRef}
        >
          <CompanionQuickCheckForm
            draft={quickCheckDraft}
            timeMode={snapshot.settings.timeMode}
            available={!!snapshot.canInsertQuickCheck}
            disabled={
              !snapshot.canInsertQuickCheck ||
              commandState.busy ||
              !!commandState.pendingCommand ||
              !controllerRef.current?.canMutate()
            }
            onChange={setQuickCheckDraft}
            onInsert={(quickCheck) => void insertQuickCheck(quickCheck)}
          />
          {commandState.pendingCommand ? (
            <>
              <p role="status">
                {t(commandState.busy ? "live.companion.waitingAck" : "live.companion.unconfirmed")}
              </p>
              {!commandState.busy ? (
                <button
                  className="button-quiet full-width"
                  disabled={!controllerRef.current?.canMutate()}
                  onClick={() => void executeCommand()}
                  type="button"
                >
                  {t(companionCommandRetryMessageKey(commandState.pendingCommand))}
                </button>
              ) : null}
            </>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </CompanionOverlay>
      ) : null}
      {overlay === "publishedQuestions" && snapshot && pass ? (
        <CompanionOverlay
          title={t("live.companion.publishedQuestions.title")}
          onClose={closeOverlay}
          returnFocusRef={primaryButtonRef}
        >
          <CompanionPublishedQuestionPicker
            catalog={publishedQuestionCatalog}
            loading={publishedQuestionLoading}
            error={publishedQuestionError}
            disabled={
              !snapshot.canInsertPublishedQuestion ||
              commandState.busy ||
              !!commandState.pendingCommand ||
              !controllerRef.current?.canMutate()
            }
            onSearch={(search) => void openPublishedQuestionPicker(search)}
            onInsert={(selection) => void insertPublishedQuestion(selection)}
          />
          {commandState.pendingCommand ? (
            <>
              <p role="status">
                {t(commandState.busy ? "live.companion.waitingAck" : "live.companion.unconfirmed")}
              </p>
              {!commandState.busy ? (
                <button
                  className="button-quiet full-width"
                  disabled={!controllerRef.current?.canMutate()}
                  onClick={() => void executeCommand()}
                  type="button"
                >
                  {t(companionCommandRetryMessageKey(commandState.pendingCommand))}
                </button>
              ) : null}
            </>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </CompanionOverlay>
      ) : null}
      {snapshot && pass ? (
        <PresentationQnaPanel
          key={id}
          sessionId={id}
          token={pass}
          role="companion"
          closed={snapshot.phase === "finished"}
        />
      ) : null}
    </main>
  );
}
