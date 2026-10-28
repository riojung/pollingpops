"use client";

import Link from "next/link";
import { CompetitionDashboard } from "../../../components/competition-dashboard";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnswerAck,
  ConfidenceValue,
  EventEnvelope,
  ResponsePayload,
  SessionSnapshot,
} from "@openround/contracts";
import {
  currentRoundClientCapabilities,
  ROUND_CLIENT_UPDATE_MESSAGE,
  normalizeTextResponse,
  textResponseCharacterLimit,
} from "@openround/contracts";
import { Brand } from "../../../components/brand";
import {
  AudiencePanel,
  enqueueAudienceRealtimeUpdate,
  type AudienceRealtimeBatch,
} from "../../../components/audience-panel";
import { ExperiencePreferences } from "../../../components/experience-preferences";
import { Countdown } from "../../../components/countdown";
import { useLocale } from "../../../components/locale-provider";
import { LivePollChoices } from "../../../components/live-poll-choices";
import { RankingChoices } from "../../../components/ranking-choices";
import { TextResponseControl } from "../../../components/text-response-control";
import { TextLiveResults } from "../../../components/text-live-results";
import { isTextQuestion, textResponseError, textResponseReceipt } from "../../../lib/text-response";
import { initialRanking, rankingCount } from "../../../lib/ranking-response";
import { ParticipantAvatar, ParticipantIdentity } from "../../../components/participant-avatar";
import { QuestionMedia } from "../../../components/question-media";
import { RecoveryPackLiveCardView } from "../../../components/recovery-pack-live-card";
import { QnaPanel } from "../../../components/qna-panel";
import { formatNumber } from "../../../lib/i18n/format";
import {
  audienceContextKey,
  createAudienceRealtimeReceipt,
  createRealtimeClient,
  withRealtimeReceipt,
} from "../../../lib/realtime";
import { experienceThemeStyle } from "../../../lib/theme";
import { clientUuid } from "../../../lib/uuid";
import {
  participantProgressStage,
  participantRevealState,
  participantResponseControlsDisabled,
  participantResponseView,
  multipleSelectionPoll,
  togglePollSelection,
  legacyResponseRequiresSubmit,
  type LocalResponseReceipt,
} from "../../../lib/participant-response";
import {
  createAckRecoveryController,
  PARTICIPANT_ACK_CHECKING_MESSAGE,
  PARTICIPANT_ACK_TIMEOUT_MESSAGE,
  participantSubmissionRecovery,
  type AckRecoveryController,
} from "../../../lib/realtime-mutation-recovery";

type Ack<T> = { data?: T; error?: { code: string; message: string } };
type ParticipantSubmission = {
  idempotencyKey: string;
  roundId: string;
  response: ResponsePayload;
  confidence: ConfidenceValue | null;
};

const ACK_TIMEOUT_MS = 10_000;
const SYNC_GRACE_MS = 5_000;
const LOCALIZED_VALUE_MARKER = "\uFFFC";

export default function PlayerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { locale, t } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [errorIsEnglish, setErrorIsEnglish] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState<AnswerAck | null>(null);
  const [localReceipt, setLocalReceipt] = useState<LocalResponseReceipt | null>(null);
  const [retryableSubmission, setRetryableSubmission] = useState<ParticipantSubmission | null>(
    null,
  );
  const [mediaCredential, setMediaCredential] = useState("");
  const [textReadAuthorized, setTextReadAuthorized] = useState(false);
  const [textReadEpoch, setTextReadEpoch] = useState(0);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [rankingChoiceIds, setRankingChoiceIds] = useState<string[]>([]);
  const [textValue, setTextValue] = useState("");
  const [numericValue, setNumericValue] = useState("");
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceValue | null>(null);
  const [qnaRevision, setQnaRevision] = useState(0);
  const [audienceSyncRevision, setAudienceSyncRevision] = useState(0);
  const [audienceRealtimeBatch, setAudienceRealtimeBatch] = useState<AudienceRealtimeBatch | null>(
    null,
  );
  const audiencePanelKey = useMemo(
    () =>
      mediaCredential ? `${sessionId}:participant:${clientUuid()}` : `${sessionId}:participant`,
    [mediaCredential, sessionId],
  );
  const confidenceRef = useRef<HTMLFieldSetElement>(null);
  const syncParticipantRef = useRef<() => void>(() => undefined);
  const submissionRecoveryRef = useRef<AckRecoveryController<ParticipantSubmission> | null>(null);

  if (!submissionRecoveryRef.current) {
    submissionRecoveryRef.current = createAckRecoveryController({
      acknowledgementTimeoutMs: ACK_TIMEOUT_MS,
      reconciliationTimeoutMs: SYNC_GRACE_MS,
      onPendingChange: setSubmitting,
      onReconciliationRequested: () => {
        setError(PARTICIPANT_ACK_CHECKING_MESSAGE);
        setErrorIsEnglish(true);
        syncParticipantRef.current();
      },
      onExpired: ({ context }) => {
        const current = snapshotRef.current;
        if (current?.roundId === context.roundId && current.phase === "question_open") {
          setRetryableSubmission(context);
          setError(PARTICIPANT_ACK_TIMEOUT_MESSAGE);
          setErrorIsEnglish(true);
        } else {
          setRetryableSubmission(null);
          setLocalReceipt(null);
          setError(tRef.current("live.roundPlay.responseUnconfirmed"));
          setErrorIsEnglish(false);
        }
      },
    });
  }

  function clearPendingSubmission(idempotencyKey?: string) {
    return Boolean(submissionRecoveryRef.current?.settle(idempotencyKey));
  }

  function resetResponse(question: SessionSnapshot["question"] = null) {
    clearPendingSubmission();
    setAcknowledged(null);
    setLocalReceipt(null);
    setRetryableSubmission(null);
    setSelectedChoiceIds([]);
    setTextValue("");
    setRankingChoiceIds(question?.type === "ranking" ? initialRanking(question) : []);
    setNumericValue("");
    setRatingValue(null);
    setConfidence(null);
    setError("");
    setErrorIsEnglish(false);
  }

  function reconcilePendingSubmission(nextSnapshot: SessionSnapshot) {
    const pending = submissionRecoveryRef.current?.current();
    if (!pending) {
      if (nextSnapshot.myResponse || nextSnapshot.myResponseAccepted) {
        if (nextSnapshot.myResponseAccepted) {
          setTextValue("");
          setLocalReceipt(null);
        }
        setRetryableSubmission(null);
        setError((current) =>
          current === PARTICIPANT_ACK_TIMEOUT_MESSAGE ||
          current === PARTICIPANT_ACK_CHECKING_MESSAGE
            ? ""
            : current,
        );
      }
      return;
    }
    const resolution = participantSubmissionRecovery(pending.context.roundId, nextSnapshot);
    if (resolution !== "saved") return;
    if (!clearPendingSubmission(pending.id)) return;
    setRetryableSubmission(null);
    if (nextSnapshot.myResponseAccepted) {
      setTextValue("");
      setLocalReceipt(null);
    }
    setError("");
    setErrorIsEnglish(false);
  }

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const token = sessionStorage.getItem(`openround:participant:${sessionId}`);
    if (!token) {
      setError(tRef.current("live.roundPlay.joinAgain"));
      setErrorIsEnglish(false);
      return;
    }
    setMediaCredential(token);
    const sync = () => {
      socket.emit(
        "sync.request",
        {
          sessionId,
          role: "participant",
          clientCapabilities: currentRoundClientCapabilities(),
          participantToken: token,
          lastSeq: snapshotRef.current?.seq ?? 0,
        },
        (response: Ack<{ snapshot: SessionSnapshot }>) => {
          if (response.error) {
            setTextReadAuthorized(false);
            setTextReadEpoch((current) => current + 1);
            setError(response.error.message);
            setErrorIsEnglish(true);
          }
          if (response.data) {
            setTextReadAuthorized(socket.connected);
            const nextSnapshot = response.data.snapshot;
            if (nextSnapshot.roundId !== snapshotRef.current?.roundId)
              resetResponse(nextSnapshot.question);
            else reconcilePendingSubmission(nextSnapshot);
            setSnapshot(nextSnapshot);
          }
        },
      );
    };
    syncParticipantRef.current = sync;
    const update = withRealtimeReceipt((envelope: EventEnvelope<{ snapshot: SessionSnapshot }>) => {
      if (
        audienceContextKey(envelope.payload.snapshot) !== audienceContextKey(snapshotRef.current)
      ) {
        setAudienceSyncRevision((current) => current + 1);
      }
      const nextSnapshot = envelope.payload.snapshot;
      if (nextSnapshot.roundId !== snapshotRef.current?.roundId)
        resetResponse(nextSnapshot.question);
      else reconcilePendingSubmission(nextSnapshot);
      setSnapshot(nextSnapshot);
    });
    const qnaUpdate = withRealtimeReceipt(() => setQnaRevision((current) => current + 1));
    const audienceUpdate = createAudienceRealtimeReceipt((gap, envelope) => {
      setAudienceRealtimeBatch((current) =>
        enqueueAudienceRealtimeUpdate(current, { gap, envelope }),
      );
      if (envelope.type.startsWith("qna.")) setQnaRevision((current) => current + 1);
    });
    socket.on("connect", () => {
      setTextReadAuthorized(false);
      setConnected(true);
      setError((current) =>
        current === PARTICIPANT_ACK_TIMEOUT_MESSAGE || current === PARTICIPANT_ACK_CHECKING_MESSAGE
          ? current
          : "",
      );
      setAudienceSyncRevision((current) => current + 1);
      sync();
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setTextReadAuthorized(false);
      setTextReadEpoch((current) => current + 1);
    });
    for (const event of [
      "lobby.updated",
      "question.open",
      "question.locked",
      "question.reveal",
      "checkpoint.insight",
      "intervention.updated",
      "recheck.open",
      "leaderboard.updated",
      "game.finished",
      "session.snapshot",
      "response.moderated",
    ])
      socket.on(event, update);
    for (const event of [
      "qna.question.created",
      "qna.question.updated",
      "qna.reply.created",
      "qna.reply.updated",
      "qna.vote.updated",
      "qna.settings.updated",
    ])
      socket.on(event, qnaUpdate);
    for (const event of [
      "audience.settings.updated",
      "audience.summary.updated",
      "chat.message.created",
      "chat.message.updated",
      "chat.message.removed",
      "chat.message.pinned",
      "chat.reaction.updated",
      "audience.event",
    ])
      socket.on(event, audienceUpdate);
    socket.on("client.update.required", () => {
      setError(ROUND_CLIENT_UPDATE_MESSAGE);
      setErrorIsEnglish(true);
    });
    socket.connect();
    return () => {
      submissionRecoveryRef.current?.dispose();
      syncParticipantRef.current = () => undefined;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  function sendSubmission(submission: ParticipantSubmission) {
    if (!connected) {
      setError(t("live.roundPlay.waitConnection"));
      setErrorIsEnglish(false);
      return;
    }
    const participantToken = sessionStorage.getItem(`openround:participant:${sessionId}`);
    if (!participantToken) return;
    const attemptId = clientUuid();
    if (!submissionRecoveryRef.current?.begin(attemptId, submission)) return;
    setError("");
    setErrorIsEnglish(false);
    setAcknowledged(null);
    setRetryableSubmission(null);
    setLocalReceipt({ response: submission.response, confidence: submission.confidence });
    socket.emit(
      "answer.submit",
      {
        sessionId,
        roundId: submission.roundId,
        response: submission.response,
        confidence: submission.confidence ?? undefined,
        participantToken,
        idempotencyKey: submission.idempotencyKey,
        clientCapabilities: currentRoundClientCapabilities(),
      },
      (response: Ack<AnswerAck>) => {
        if (!clearPendingSubmission(attemptId)) return;
        if (response.error) {
          setRetryableSubmission(null);
          setLocalReceipt(null);
          setError(response.error.message);
          setErrorIsEnglish(true);
        } else if (response.data) {
          setAcknowledged(response.data);
          if (response.data.accepted) {
            if (submission.response.kind === "text") {
              setTextValue("");
              setLocalReceipt(null);
            }
            setRetryableSubmission(null);
            setError("");
            setErrorIsEnglish(false);
          } else {
            setRetryableSubmission(null);
            setLocalReceipt(null);
            setError(
              response.data.code === "ANSWER_LATE"
                ? t("live.roundPlay.late")
                : t("live.roundPlay.responseRejected"),
            );
            setErrorIsEnglish(false);
          }
        } else {
          setRetryableSubmission(submission);
          setError(PARTICIPANT_ACK_TIMEOUT_MESSAGE);
          setErrorIsEnglish(true);
        }
      },
    );
  }

  function submitResponse(response: ResponsePayload, selectedConfidence = confidence) {
    if (
      !snapshot?.roundId ||
      acknowledged?.accepted ||
      snapshot.myResponse ||
      snapshot.myResponseAccepted ||
      submitting ||
      retryableSubmission
    )
      return;
    if (snapshot.question?.confidence === "required" && selectedConfidence === null) {
      setError(t("live.roundPlay.chooseConfidence"));
      setErrorIsEnglish(false);
      confidenceRef.current?.focus();
      return;
    }
    sendSubmission({
      idempotencyKey: `${sessionId}:${snapshot.roundId}:${clientUuid()}`,
      roundId: snapshot.roundId,
      response,
      confidence: selectedConfidence ?? null,
    });
  }

  function retrySubmission() {
    if (!retryableSubmission || submitting || snapshot?.myResponse || snapshot?.myResponseAccepted)
      return;
    if (snapshot?.roundId !== retryableSubmission.roundId || snapshot.phase !== "question_open") {
      resetResponse();
      setError(t("live.roundPlay.closed"));
      setErrorIsEnglish(false);
      return;
    }
    sendSubmission(retryableSubmission);
  }

  function chooseChoice(choiceId: string) {
    const question = snapshot?.question;
    if (
      !question ||
      snapshot.phase !== "question_open" ||
      acknowledged?.accepted ||
      snapshot.myResponse ||
      snapshot.myResponseAccepted ||
      submitting ||
      retryableSubmission
    )
      return;
    if (question.type === "multi_select" || multipleSelectionPoll(question)) {
      setSelectedChoiceIds((current) =>
        question.type === "poll"
          ? togglePollSelection(current, choiceId, question.maxSelections ?? 1)
          : current.includes(choiceId)
            ? current.filter((selected) => selected !== choiceId)
            : [...current, choiceId],
      );
      setError("");
      setErrorIsEnglish(false);
      return;
    }
    setSelectedChoiceIds([choiceId]);
    setError("");
    setErrorIsEnglish(false);
    if (snapshot.uxBeta !== true && question.confidence === "off") {
      submitResponse(
        question.type === "poll"
          ? { kind: "poll", choiceIds: [choiceId] }
          : { kind: "choice", choiceIds: [choiceId] },
      );
    }
  }

  function submitSelectedResponse() {
    const question = snapshot?.question;
    if (!question) return;
    if (isTextQuestion(question.type)) {
      const validation = textResponseError(question.type, textValue);
      if (validation) {
        setError(
          t(`live.text.error.${validation}`, { limit: textResponseCharacterLimit(question.type) }),
        );
        setErrorIsEnglish(false);
        return;
      }
      submitResponse({ kind: "text", value: normalizeTextResponse(textValue, question.type) });
    } else if (question.type === "ranking") {
      if (rankingChoiceIds.length !== rankingCount(question)) {
        setError(t("live.ranking.chooseCount", { count: rankingCount(question) }));
        setErrorIsEnglish(false);
        return;
      }
      submitResponse({ kind: "ranking", choiceIds: rankingChoiceIds });
    } else if (["single_select", "true_false", "multi_select"].includes(question.type)) {
      if (selectedChoiceIds.length === 0) {
        setError(t("live.roundPlay.chooseAnswer"));
        setErrorIsEnglish(false);
        return;
      }
      submitResponse({ kind: "choice", choiceIds: selectedChoiceIds });
    } else if (question.type === "poll") {
      if (
        selectedChoiceIds.length < 1 ||
        selectedChoiceIds.length > (question.maxSelections ?? 1)
      ) {
        setError(
          t(
            multipleSelectionPoll(question)
              ? "live.roundPlay.chooseMultiplePoll"
              : "live.roundPlay.choosePoll",
            { limit: question.maxSelections ?? 1 },
          ),
        );
        setErrorIsEnglish(false);
        return;
      }
      submitResponse({ kind: "poll", choiceIds: selectedChoiceIds });
    } else if (question.type === "numeric") {
      if (!numericValue.trim()) {
        setError(t("live.roundPlay.enterNumeric"));
        setErrorIsEnglish(false);
        return;
      }
      submitResponse({
        kind: "numeric",
        value: numericValue,
        unit: question.unit ?? undefined,
      });
    } else if (ratingValue !== null) {
      submitResponse({ kind: "rating", value: ratingValue });
    } else {
      setError(t("live.roundPlay.chooseRatingError"));
      setErrorIsEnglish(false);
    }
  }

  const myRow = snapshot?.participants.find(
    (participant) => participant.id === snapshot.myParticipantId,
  );
  const revealed = snapshot ? participantRevealState(snapshot).revealed : false;
  const durableResponse = participantResponseView(
    snapshot?.myResponse,
    snapshot?.myConfidence,
    acknowledged,
    localReceipt,
    snapshot?.myResponseAccepted,
  );
  const retryResponse = retryableSubmission?.response;
  const retryChoiceIds =
    retryResponse?.kind === "choice" || retryResponse?.kind === "poll"
      ? retryResponse.choiceIds
      : [];
  const displayedChoiceIds = retryableSubmission
    ? retryChoiceIds
    : durableResponse.choiceIds.length
      ? durableResponse.choiceIds
      : selectedChoiceIds;
  const displayedRankingIds = retryableSubmission
    ? retryResponse?.kind === "ranking"
      ? retryResponse.choiceIds
      : []
    : durableResponse.saved
      ? durableResponse.rankingChoiceIds
      : rankingChoiceIds;
  const responseSaved = durableResponse.saved;
  const displayedNumericValue = retryableSubmission
    ? retryResponse?.kind === "numeric"
      ? retryResponse.value
      : ""
    : durableResponse.saved
      ? durableResponse.numericValue
      : numericValue;
  const displayedRatingValue = retryableSubmission
    ? retryResponse?.kind === "rating"
      ? retryResponse.value
      : null
    : durableResponse.saved
      ? durableResponse.ratingValue
      : ratingValue;
  const displayedConfidence = retryableSubmission
    ? retryableSubmission.confidence
    : (durableResponse.confidence ?? confidence);
  const responseControlsDisabled = participantResponseControlsDisabled({
    questionOpen: snapshot?.phase === "question_open",
    saved: responseSaved,
    submitting: submitting || Boolean(retryableSubmission),
  });
  const uxBeta = snapshot?.uxBeta === true;
  const progressStage =
    snapshot && uxBeta ? participantProgressStage(snapshot, responseSaved) : null;
  const progressSteps = [
    ["waiting", "Waiting", "en-CA"],
    ["answering", "Answering", "en-CA"],
    ["saved", "Saved", "en-CA"],
    ["discussing", "Discussing", "en-CA"],
    ["reviewing", "Reviewing", "en-CA"],
    ["rechecking", "Rechecking", "en-CA"],
    ["complete", t("live.common.complete"), undefined],
  ] as const;
  const legacyNeedsSubmit = Boolean(
    snapshot?.question && legacyResponseRequiresSubmit(snapshot.question),
  );
  const [checkpointOpenBefore, checkpointOpenAfter = ""] = t("live.presenter.checkpointOpen", {
    prompt: LOCALIZED_VALUE_MARKER,
  }).split(LOCALIZED_VALUE_MARKER);
  const [roundStatusBefore, roundStatusAfter = ""] = t("live.presenter.roundStatus", {
    status: LOCALIZED_VALUE_MARKER,
  }).split(LOCALIZED_VALUE_MARKER);
  const [reviewItemBefore, reviewItemAfter = ""] = t("live.roundPlay.reviewItem", {
    item: LOCALIZED_VALUE_MARKER,
  }).split(LOCALIZED_VALUE_MARKER);

  return (
    <div
      className="live-shell"
      data-corners={snapshot?.experienceTheme.tokens.corners}
      data-motion={snapshot?.experienceTheme.motion}
      data-pattern={snapshot?.experienceTheme.tokens.pattern}
      data-typography={snapshot?.experienceTheme.tokens.typography}
      data-ux-beta={uxBeta}
      style={experienceThemeStyle(snapshot?.experienceTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <div className="button-row">
          <ExperiencePreferences />
          <span
            aria-label={t("live.roundPlay.connectionAria")}
            className="connection"
            data-connected={connected}
            role="status"
          >
            <span className="connection-dot" aria-hidden="true" />
            {connected ? t("live.common.connected") : t("live.common.connecting")}
          </span>
        </div>
      </header>
      <main className="shell live-stage">
        {progressStage ? (
          <ol aria-label={t("live.roundPlay.progressAria")} className="participant-progress">
            {progressSteps.map(([stage, label, language]) => (
              <li
                aria-current={progressStage === stage ? "step" : undefined}
                key={stage}
                lang={language}
              >
                {label}
              </li>
            ))}
          </ol>
        ) : null}
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {snapshot?.phase === "question_open" ? (
            uxBeta ? (
              <span lang="en-CA">
                Question open:{" "}
                {snapshot.question?.prompt ? (
                  <span lang="">{snapshot.question.prompt}</span>
                ) : (
                  "new question"
                )}
              </span>
            ) : snapshot.question?.prompt ? (
              <>
                {checkpointOpenBefore}
                <span lang="">{snapshot.question.prompt}</span>
                {checkpointOpenAfter}
              </>
            ) : (
              t("live.presenter.checkpointOpen", {
                prompt: t("live.presenter.newCheckpoint"),
              })
            )
          ) : snapshot?.phase === "finished" ? (
            t("live.presenter.complete")
          ) : snapshot ? (
            <>
              {roundStatusBefore}
              <span lang="en-CA">{snapshot.phase.replaceAll("_", " ")}</span>
              {roundStatusAfter}
            </>
          ) : (
            <span lang="en-CA">Connecting to the live round.</span>
          )}
        </p>
        {error ? (
          <section className="live-card">
            <p className="error" lang={errorIsEnglish ? "en-CA" : undefined} role="alert">
              {error}
            </p>
            {!snapshot ? (
              <Link className="button" href="/join" lang="en-CA">
                Join again
              </Link>
            ) : null}
          </section>
        ) : null}
        {!snapshot && !error ? (
          <section className="live-card">
            <p>{t("live.roundPlay.syncing")}</p>
          </section>
        ) : null}
        {snapshot?.phase === "lobby" ? (
          <section className="live-card">
            <p className="eyebrow">{t("live.roundPlay.youAreIn")}</p>
            <div className="participant-hero-identity">
              <ParticipantAvatar avatarId={myRow?.avatarId} size="large" />
              <h1 style={{ fontSize: "clamp(2.6rem, 10vw, 5rem)" }}>
                {myRow?.nickname ? (
                  <span lang="">{myRow.nickname}</span>
                ) : (
                  <span lang="en-CA">Ready</span>
                )}
              </h1>
            </div>
            <p className="lead">{t("live.roundPlay.facilitatorStarts")}</p>
            <p className="muted">
              {t("live.common.joinedCount", {
                count: formatNumber(locale, snapshot.participants.length),
              })}
            </p>
          </section>
        ) : null}
        {snapshot?.question && snapshot.phase !== "finished" ? (
          <section className="live-card" data-testid="participant-task">
            <div className="page-heading" style={{ alignItems: "center", marginBottom: 20 }}>
              <span className="status-pill" lang="en-CA">
                {snapshot.roundKind === "main" ? (uxBeta ? "Question" : "Checkpoint") : "Recheck"}{" "}
                {formatNumber(
                  locale,
                  (snapshot.questionPosition ?? snapshot.questionIndex ?? 0) + 1,
                )}{" "}
                of {formatNumber(locale, snapshot.questionCount)}
              </span>
              {snapshot.phase === "question_open" ? (
                snapshot.settings.timeMode === "flex" ? (
                  <span className="muted" lang={locale} role="status">
                    {t("live.common.flexOpen")}
                  </span>
                ) : (
                  <Countdown deadline={snapshot.deadline} />
                )
              ) : null}
            </div>
            <h1 lang="" style={{ fontSize: "clamp(2rem, 7vw, 4rem)" }}>
              {snapshot.question.prompt}
            </h1>
            <span lang="">
              <QuestionMedia
                altText={snapshot.question.mediaAlt}
                credential={mediaCredential}
                mediaId={snapshot.question.mediaId}
                sessionId={sessionId}
              />
            </span>
            {snapshot.phase === "paused" ? (
              <p className="notice" lang="en-CA">
                The facilitator paused this {uxBeta ? "question" : "checkpoint"}.
              </p>
            ) : null}
            {snapshot.phase === "intervention" ? (
              <p className="notice" lang="en-CA">
                The facilitator started{" "}
                {snapshot.intervention?.type.replaceAll("_", " ") ?? "an intervention"}.
              </p>
            ) : null}
            {snapshot.phase === "intervention" && snapshot.recoveryPackCard ? (
              <RecoveryPackLiveCardView card={snapshot.recoveryPackCard} />
            ) : null}
            {isTextQuestion(snapshot.question.type) ? (
              responseSaved ? null : (
                <TextResponseControl
                  type={snapshot.question.type}
                  value={retryResponse?.kind === "text" ? retryResponse.value : textValue}
                  disabled={responseControlsDisabled}
                  onChange={(value) => {
                    setTextValue(value);
                    setError("");
                    setErrorIsEnglish(false);
                  }}
                />
              )
            ) : snapshot.question.type === "ranking" ? (
              <RankingChoices
                question={snapshot.question}
                selectedChoiceIds={displayedRankingIds}
                disabled={responseControlsDisabled}
                onChange={(selected) => {
                  setRankingChoiceIds(selected);
                  setError("");
                  setErrorIsEnglish(false);
                }}
              />
            ) : multipleSelectionPoll(snapshot.question) ? (
              <LivePollChoices
                question={snapshot.question}
                selectedChoiceIds={displayedChoiceIds}
                disabled={responseControlsDisabled}
                onChoose={chooseChoice}
              />
            ) : ["single_select", "true_false", "multi_select", "poll"].includes(
                snapshot.question.type,
              ) ? (
              <div className="answer-grid" aria-label={t("live.roundPlay.answerChoices")}>
                {snapshot.question.choices.map((choice, index) => {
                  const selected = displayedChoiceIds.includes(choice.id);
                  const revealState = participantRevealState(snapshot, selected);
                  return (
                    <button
                      aria-pressed={selected}
                      className="answer-button"
                      data-correct={revealState.selectedCorrect || undefined}
                      data-incorrect={revealState.selectedIncorrect || undefined}
                      data-selected={selected || undefined}
                      disabled={responseControlsDisabled}
                      key={choice.id}
                      onClick={() => chooseChoice(choice.id)}
                      type="button"
                    >
                      <span aria-hidden="true" style={{ marginRight: 10 }}>
                        {String.fromCharCode(65 + index)}.
                      </span>
                      <span lang="">{choice.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : snapshot.question.type === "numeric" ? (
              <label className="field">
                <span>
                  {t("live.presentationPlay.numericResponse")}
                  {snapshot.question.unit ? (
                    <>
                      {" "}
                      <span lang="">{snapshot.question.unit}</span>
                    </>
                  ) : null}
                </span>
                <input
                  className="input"
                  disabled={responseControlsDisabled}
                  inputMode="decimal"
                  onChange={(event) => {
                    setNumericValue(event.target.value);
                    setError("");
                  }}
                  value={displayedNumericValue}
                />
              </label>
            ) : snapshot.question.rating ? (
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="field-label">{t("live.roundPlay.chooseRating")}</legend>
                <div className="answer-grid">
                  {Array.from(
                    {
                      length: snapshot.question.rating.max - snapshot.question.rating.min + 1,
                    },
                    (_, index) => snapshot.question!.rating!.min + index,
                  ).map((value) => (
                    <button
                      aria-pressed={displayedRatingValue === value}
                      className="answer-button"
                      data-selected={displayedRatingValue === value || undefined}
                      disabled={responseControlsDisabled}
                      key={value}
                      onClick={() => {
                        setRatingValue(value);
                        setError("");
                      }}
                      type="button"
                    >
                      {formatNumber(locale, value)}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  <span lang="">{snapshot.question.rating.minLabel}</span> ·{" "}
                  <span lang="">{snapshot.question.rating.maxLabel}</span>
                </p>
              </fieldset>
            ) : null}
            {snapshot.question.confidence !== "off" ? (
              <fieldset
                className="field"
                disabled={responseControlsDisabled}
                ref={confidenceRef}
                style={{ border: 0, padding: 0 }}
                tabIndex={-1}
              >
                <legend className="field-label" lang="en-CA">
                  How sure are you?{snapshot.question.confidence === "required" ? " Required" : ""}
                </legend>
                <div className="button-row">
                  {[
                    [1, t("live.roundPlay.confidence.notSure")],
                    [2, t("live.roundPlay.confidence.somewhat")],
                    [3, t("live.roundPlay.confidence.very")],
                  ].map(([value, label]) => (
                    <button
                      aria-pressed={displayedConfidence === value}
                      className="button-quiet"
                      data-selected={displayedConfidence === value || undefined}
                      key={value}
                      onClick={() => {
                        setConfidence(value as ConfidenceValue);
                        setError("");
                      }}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {snapshot.phase === "question_open" &&
            !responseSaved &&
            (uxBeta || legacyNeedsSubmit || retryableSubmission) ? (
              retryableSubmission ? (
                <div className="participant-submit-bar" data-testid="response-status">
                  <p className="muted" lang="en-CA">
                    Your original response is unchanged. Retry uses the same save request so it
                    cannot create a second answer.
                  </p>
                  <button
                    className="button"
                    disabled={submitting || !connected}
                    onClick={retrySubmission}
                    type="button"
                  >
                    {submitting ? t("live.common.saving") : t("live.roundPlay.retry")}
                  </button>
                </div>
              ) : uxBeta ? (
                <div className="participant-submit-bar" data-testid="response-status">
                  <p className="muted" lang="en-CA">
                    Review your response before submitting. It cannot be changed.
                  </p>
                  <button
                    className="button"
                    disabled={submitting || !connected}
                    onClick={submitSelectedResponse}
                    type="button"
                  >
                    {submitting ? t("live.common.saving") : t("live.roundPlay.submit")}
                  </button>
                </div>
              ) : (
                <button
                  className="button"
                  disabled={submitting}
                  onClick={submitSelectedResponse}
                  type="button"
                >
                  {submitting ? t("live.common.saving") : t("live.roundPlay.submit")}
                </button>
              )
            ) : null}
            {responseSaved && isTextQuestion(snapshot.question.type) ? (
              <p className="success" role="status" lang={locale}>
                {t(textResponseReceipt(snapshot.myResponseModerationStatus))}
              </p>
            ) : responseSaved && !revealed ? (
              <p
                aria-label={t("live.roundPlay.saveStatusAria")}
                className="success"
                lang="en-CA"
                role="status"
              >
                Answer received and saved.
              </p>
            ) : null}
            {isTextQuestion(snapshot.question.type) && snapshot.roundId ? (
              <TextLiveResults
                sessionId={sessionId}
                roundId={snapshot.roundId}
                version={snapshot.version}
                phase={snapshot.phase}
                credential={textReadAuthorized ? mediaCredential : ""}
                freshness={textReadEpoch}
                role="participant"
              />
            ) : null}
            {revealed ? (
              <div className={snapshot.myCorrect ? "success" : "notice"}>
                <strong>
                  {snapshot.question.purpose === "opinion" ? (
                    t("live.presentationPlay.responseRecorded")
                  ) : snapshot.myCorrect === true ? (
                    <span lang="en-CA">Correct</span>
                  ) : snapshot.myCorrect === false ? (
                    <>
                      {reviewItemBefore}
                      <span lang="en-CA">{uxBeta ? "question" : "checkpoint"}</span>
                      {reviewItemAfter}
                    </>
                  ) : (
                    t("live.roundPlay.answerRevealed")
                  )}
                </strong>
                {snapshot.explanation ? <div lang="">{snapshot.explanation}</div> : null}
                {snapshot.feedback ? <div lang="">{snapshot.feedback}</div> : null}
              </div>
            ) : null}
          </section>
        ) : null}
        {snapshot?.phase === "finished" ? (
          <section className="live-card">
            <p className="eyebrow">{t("live.presenter.roundComplete")}</p>
            <h1>{t("live.roundPlay.complete")}</h1>
            {myRow ? (
              <p>
                <ParticipantIdentity
                  avatarId={myRow.avatarId}
                  nickname={myRow.nickname}
                  size="medium"
                />
              </p>
            ) : null}
            <p className="lead" lang="en-CA">
              Your final score is {formatNumber(locale, myRow?.score ?? 0)}.
            </p>
          </section>
        ) : null}
        {snapshot?.competitionStandings &&
        snapshot.phase !== "lobby" &&
        (snapshot.phase === "finished" ||
          (snapshot.phase !== "intervention" && snapshot.roundKind === "main")) ? (
          <CompetitionDashboard
            variant="participant"
            standings={snapshot.competitionStandings}
            finished={snapshot.phase === "finished"}
            participantId={snapshot.myParticipantId ?? undefined}
            compact={snapshot.phase !== "finished" && snapshot.phase !== "leaderboard"}
          />
        ) : null}
        {snapshot && mediaCredential && uxBeta ? (
          <details
            className="audience-tray"
            data-testid="audience-tray"
            key={snapshot.roundId ?? snapshot.phase}
          >
            <summary>{t("live.roundPlay.openTools")}</summary>
            <p className="muted" lang="en-CA">
              These optional tools never affect whether your response is saved.
            </p>
            {snapshot.phase !== "finished" ? (
              <AudiencePanel
                key={audiencePanelKey}
                realtimeBatch={audienceRealtimeBatch}
                role="participant"
                sessionId={sessionId}
                syncRevision={audienceSyncRevision}
                token={mediaCredential}
              />
            ) : null}
            <QnaPanel
              revision={qnaRevision}
              role="participant"
              sessionId={sessionId}
              token={mediaCredential}
            />
          </details>
        ) : null}
        {snapshot && mediaCredential && !uxBeta ? (
          <>
            {snapshot.phase !== "finished" ? (
              <AudiencePanel
                key={audiencePanelKey}
                realtimeBatch={audienceRealtimeBatch}
                role="participant"
                sessionId={sessionId}
                syncRevision={audienceSyncRevision}
                token={mediaCredential}
              />
            ) : null}
            <QnaPanel
              revision={qnaRevision}
              role="participant"
              sessionId={sessionId}
              token={mediaCredential}
            />
          </>
        ) : null}
      </main>
    </div>
  );
}
