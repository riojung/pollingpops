"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConfidenceValue,
  PresentationParticipantQuestionBlock,
  PresentationParticipantSnapshot,
  PresentationResponseAck,
} from "@openround/contracts";
import { Brand } from "../../../../components/brand";
import { useLocale } from "../../../../components/locale-provider";
import { PresentationMedia } from "../../../../components/presentation-live/presentation-media";
import { PresentationQnaPanel } from "../../../../components/presentation-live/presentation-qna";
import { ContentSlideView } from "../../../../components/presentation/content-slide-view";
import { RecoveryPackLiveCardView } from "../../../../components/recovery-pack-live-card";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import { formatNumber } from "../../../../lib/i18n/format";
import {
  createPresentationRealtimeController,
  presentationRemainingSeconds,
  presentationSaveStateForBlock,
  type PresentationConnectionState,
  type PresentationRealtimeController,
  type PresentationSaveStatus,
} from "../../../../lib/presentation-realtime";
import { clientUuid } from "../../../../lib/uuid";

export default function PresentationParticipantPage() {
  const { locale, t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<PresentationParticipantSnapshot | null>(null);
  const [audienceToken, setAudienceToken] = useState<string | null>(null);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [numericValue, setNumericValue] = useState("");
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [connection, setConnection] = useState<PresentationConnectionState>("connecting");
  const [saveStatus, setSaveStatus] = useState<PresentationSaveStatus>({
    blockId: null,
    state: "idle",
  });
  const blockId = useRef<string | null>(null);
  const snapshotReceivedAt = useRef(Date.now());
  const controllerRef =
    useRef<PresentationRealtimeController<PresentationParticipantSnapshot> | null>(null);

  const applySnapshot = useCallback((incoming: PresentationParticipantSnapshot) => {
    snapshotReceivedAt.current = Date.now();
    if (incoming.currentBlock?.id !== blockId.current) {
      blockId.current = incoming.currentBlock?.id ?? null;
      setSelectedChoiceIds([]);
      setNumericValue("");
      setRatingValue(null);
      setConfidence(null);
      setSaveStatus({
        blockId: incoming.currentBlock?.id ?? null,
        state: incoming.responseSubmitted ? "saved" : "idle",
      });
    }
    setSnapshot(incoming);
  }, []);

  const fetchSnapshot = useCallback(async () => {
    const token = sessionStorage.getItem(`openround:presentation-participant:${id}`);
    if (!token) {
      router.replace("/join");
      throw new Error("Participant credential required");
    }
    try {
      const response = await apiFetch<{ snapshot: PresentationParticipantSnapshot }>(
        `/v1/presentation-sessions/${id}/participant`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      setError("");
      return response.snapshot;
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) {
        sessionStorage.removeItem(`openround:presentation-participant:${id}`);
        setAudienceToken(null);
        router.replace("/join");
      } else {
        setError(humanError(caught));
      }
      throw caught;
    }
  }, [id, router]);

  useEffect(() => {
    setAudienceToken(null);
    const participantToken = sessionStorage.getItem(`openround:presentation-participant:${id}`);
    if (!participantToken) {
      router.replace("/join");
      return;
    }
    setAudienceToken(participantToken);
    const controller = createPresentationRealtimeController<PresentationParticipantSnapshot>({
      sessionId: id,
      credential: { projection: "participant", participantToken },
      fetchSnapshot,
      onSnapshot: applySnapshot,
      onConnectionState: setConnection,
      onSaveState: (state, responseBlockId) => setSaveStatus({ blockId: responseBlockId, state }),
      onError: (caught) => setError(humanError(caught)),
    });
    controllerRef.current = controller;
    controller.start();
    const timer = window.setInterval(() => {
      if (controller.needsFallbackPolling()) void controller.reconcile();
    }, 1_500);
    return () => {
      window.clearInterval(timer);
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [applySnapshot, fetchSnapshot, id, router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  function toggleChoice(
    question: PresentationParticipantQuestionBlock["question"],
    choiceId: string,
  ) {
    if (question.type !== "multi_select") {
      setSelectedChoiceIds([choiceId]);
      return;
    }
    setSelectedChoiceIds((current) =>
      current.includes(choiceId)
        ? current.filter((candidate) => candidate !== choiceId)
        : [...current, choiceId],
    );
  }

  async function submitResponse() {
    const token = sessionStorage.getItem(`openround:presentation-participant:${id}`);
    const block = snapshot?.currentBlock;
    const controller = controllerRef.current;
    if (!token || block?.kind !== "question" || !controller) return;
    const currentSnapshot = snapshot;
    if (!currentSnapshot) return;
    const question = block.question;
    const response =
      question.type === "numeric"
        ? { numericValue, ...(confidence ? { confidence } : {}) }
        : question.type === "rating"
          ? { ratingValue: ratingValue!, ...(confidence ? { confidence } : {}) }
          : { choiceIds: selectedChoiceIds, ...(confidence ? { confidence } : {}) };
    setBusy(true);
    setError("");
    const idempotencyKey = `${id}:${block.id}:${clientUuid()}`;
    try {
      await controller.submitResponse(
        {
          sessionId: id,
          participantToken: token,
          blockId: block.id,
          expectedRevision: currentSnapshot.revision,
          idempotencyKey,
          response,
        },
        async () => {
          const accepted = await apiFetch<PresentationResponseAck>(
            `/v1/presentation-sessions/${id}/responses`,
            {
              method: "POST",
              body: JSON.stringify({
                participantToken: token,
                blockId: block.id,
                expectedRevision: currentSnapshot.revision,
                idempotencyKey,
                response,
              }),
            },
          );
          // The POST acknowledgement already contains the durable receipt and authoritative
          // participant projection. A second GET can fail after the response was safely stored,
          // which would incorrectly tell the participant that saving failed.
          return accepted;
        },
      );
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  const block = snapshot?.currentBlock ?? null;
  const saveState = presentationSaveStateForBlock(saveStatus, block?.id ?? null);
  const canSubmit =
    block?.kind === "question" &&
    snapshot?.phase === "question_open" &&
    snapshot.acceptingResponses &&
    !snapshot.responseSubmitted &&
    (block.question.type === "numeric"
      ? numericValue.trim() !== ""
      : block.question.type === "rating"
        ? ratingValue !== null
        : selectedChoiceIds.length > 0) &&
    (block.question.confidence !== "required" || confidence !== null);
  const remainingSeconds = presentationRemainingSeconds(snapshot, snapshotReceivedAt.current, now);
  const deliveryStatus =
    saveState === "saving"
      ? "Saving…"
      : saveState === "reconnecting_not_saved"
        ? "Reconnecting—not yet saved"
        : saveState === "saved" || snapshot?.responseSubmitted
          ? "Saved"
          : connection === "connected" || connection === "fallback"
            ? "Connected"
            : "Reconnecting—not yet saved";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Brand />
        <span>
          {snapshot
            ? t("live.common.joinedCount", {
                count: formatNumber(locale, snapshot.participantCount),
              })
            : t("live.common.connecting")}
        </span>
      </header>
      <div className={styles.stage}>
        <p aria-live="polite" className="muted" role="status">
          {deliveryStatus}
        </p>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        <section className={styles.canvas} aria-live="polite">
          <div className={styles.canvasContent}>
            {!snapshot ? <p>{t("live.presentationPlay.restoring")}</p> : null}
            {snapshot?.phase === "lobby" ? (
              <>
                <span className={styles.statusPill}>{t("live.presentationPlay.youreIn")}</span>
                <h1 lang="">{snapshot.title}</h1>
                <p>{t("live.presentationPlay.facilitatorStarts")}</p>
              </>
            ) : null}
            {block?.kind === "content" ? (
              <>
                <span className={styles.statusPill}>{t("live.presentationPlay.content")}</span>
                <ContentSlideView
                  block={block}
                  media={
                    <PresentationMedia
                      altText={block.mediaAlt}
                      mediaId={block.mediaId}
                      participant
                      sessionId={id}
                    />
                  }
                  variant="live"
                />
                <p className="muted">{t("live.presentationPlay.noResponse")}</p>
              </>
            ) : null}
            {block?.kind === "question" ? (
              <>
                <span className={styles.statusPill}>
                  {snapshot?.phase === "intervention"
                    ? t("live.presentationPlay.reviewRecover")
                    : snapshot?.acceptingResponses
                      ? t("live.presentationPlay.respondNow")
                      : t("live.presentationPlay.responseClosed")}
                </span>
                {remainingSeconds !== null ? (
                  <p className={styles.timer} aria-live="off">
                    {formatNumber(locale, remainingSeconds, {
                      style: "unit",
                      unit: "second",
                      unitDisplay: "narrow",
                    })}
                  </p>
                ) : snapshot?.acceptingResponses && snapshot.settings.timeMode === "flex" ? (
                  <p className="muted" lang={locale} role="status">
                    {t("live.common.flexOpen")}
                  </p>
                ) : null}
                <h1 lang="">{block.question.prompt}</h1>
                <PresentationMedia
                  altText={block.question.mediaAlt}
                  mediaId={block.question.mediaId}
                  participant
                  sessionId={id}
                />
                {block.question.choices.length ? (
                  <div className={styles.choiceGrid}>
                    {block.question.choices.map((choice) => (
                      <button
                        aria-pressed={selectedChoiceIds.includes(choice.id)}
                        className={styles.choiceButton}
                        disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                        key={choice.id}
                        lang=""
                        onClick={() => toggleChoice(block.question, choice.id)}
                        type="button"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : block.question.type === "numeric" ? (
                  <label className={styles.formStack}>
                    {t("live.presentationPlay.numericResponse")}
                    <input
                      disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                      inputMode="decimal"
                      onChange={(event) => setNumericValue(event.target.value)}
                      value={numericValue}
                    />
                  </label>
                ) : (
                  <label className={styles.formStack}>
                    {t("live.presentationPlay.rating")}
                    <select
                      disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                      onChange={(event) => setRatingValue(Number(event.target.value))}
                      value={ratingValue ?? ""}
                    >
                      <option disabled value="">
                        {t("live.presentationPlay.chooseRating")}
                      </option>
                      {Array.from(
                        {
                          length:
                            (block.question.rating?.max ?? 5) -
                            (block.question.rating?.min ?? 1) +
                            1,
                        },
                        (_, index) => (block.question.rating?.min ?? 1) + index,
                      ).map((value) => (
                        <option key={value} value={value}>
                          {formatNumber(locale, value)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {block.question.confidence !== "off" && snapshot?.acceptingResponses ? (
                  <label className={styles.formStack}>
                    {t("live.presentationPlay.confidence", {
                      requirement:
                        block.question.confidence === "required"
                          ? t("live.presentationPlay.required")
                          : t("live.presentationPlay.optional"),
                    })}
                    <select
                      disabled={snapshot.responseSubmitted}
                      onChange={(event) =>
                        setConfidence(
                          event.target.value
                            ? (Number(event.target.value) as ConfidenceValue)
                            : null,
                        )
                      }
                      value={confidence ?? ""}
                    >
                      <option value="">{t("live.presentationPlay.chooseConfidence")}</option>
                      <option value="1">{t("live.presentationPlay.low")}</option>
                      <option value="2">{t("live.presentationPlay.medium")}</option>
                      <option value="3">{t("live.presentationPlay.high")}</option>
                    </select>
                  </label>
                ) : null}
                <div className={styles.responseActions}>
                  {snapshot?.responseResult ? (
                    <p className="notice" role="status">
                      {snapshot.responseResult.correct === null
                        ? t("live.presentationPlay.responseRecorded")
                        : snapshot.responseResult.correct
                          ? t("live.presentationPlay.correctPoints", {
                              score: formatNumber(locale, snapshot.responseResult.score),
                            })
                          : t("live.presentationPlay.notQuite")}
                      {snapshot.standing
                        ? t("live.presentationPlay.rankPoints", {
                            rank: formatNumber(locale, snapshot.standing.rank),
                            score: formatNumber(locale, snapshot.standing.score),
                          })
                        : ""}
                    </p>
                  ) : snapshot?.responseSubmitted ? (
                    <p className="notice" role="status">
                      {t("live.presentationPlay.responseSaved")}
                    </p>
                  ) : snapshot?.acceptingResponses ? (
                    <button
                      className="button"
                      disabled={!canSubmit || busy || !controllerRef.current?.canMutate()}
                      onClick={() => void submitResponse()}
                      type="button"
                    >
                      {busy ? t("live.common.saving") : t("live.presentationPlay.submit")}
                    </button>
                  ) : (
                    <p className="muted">{t("live.presentationPlay.closed")}</p>
                  )}
                </div>
                {snapshot?.phase === "intervention" && snapshot.recoveryPackIntervention ? (
                  <RecoveryPackLiveCardView card={snapshot.recoveryPackIntervention.card} />
                ) : null}
              </>
            ) : null}
            {snapshot?.phase === "finished" ? (
              <>
                <span className={styles.statusPill}>{t("live.common.complete")}</span>
                <h1>{t("live.presentationPlay.thanks")}</h1>
                <p>{t("live.presentationPlay.savedForReport")}</p>
                <Link className="button" href="/">
                  {t("live.presentationPlay.leave")}
                </Link>
              </>
            ) : null}
          </div>
        </section>
      </div>
      {snapshot && audienceToken ? (
        <PresentationQnaPanel
          key={id}
          sessionId={id}
          token={audienceToken}
          role="participant"
          closed={snapshot.phase === "finished"}
        />
      ) : null}
    </main>
  );
}
