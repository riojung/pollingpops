"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  PresentationStageSnapshotSchema,
  type PresentationStageSnapshot,
} from "@openround/contracts";
import { apiFetch, ApiClientError } from "../../../../lib/api";
import {
  capturePresentationStagePass,
  rejectPresentationStagePass,
} from "../../../../lib/presentation-stage-pass";
import {
  presentationRemainingSeconds,
  shouldApplyPresentationSnapshot,
} from "../../../../lib/presentation-realtime";
import { PresentationDeliveryBlock } from "../../../../components/presentation-live/delivery-block";
import { PresentationOpinionResults } from "../../../../components/presentation-live/opinion-results";
import { PresentationTextResults } from "../../../../components/presentation-live/text-results";
import { isTextQuestion } from "../../../../lib/text-response";
import { presentationOpinionSummaryFor } from "../../../../lib/presentation-opinion-response";
import { PresentationDeliveryJoinAccess } from "../../../../components/presentation-live/delivery-join-access";
import { RecoveryPackLiveCardView } from "../../../../components/recovery-pack-live-card";
import styles from "../../../../components/presentation-live/presentation-delivery.module.css";

const storage = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};

function StageMedia({
  sessionId,
  token,
  mediaId,
  altText,
}: {
  sessionId: string;
  token: string;
  mediaId: string | null;
  altText: string | null;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSource("");
    setFailed(false);
    if (!mediaId) return;
    const abort = new AbortController();
    void apiFetch<{ downloadUrl: string }>(
      `/v1/presentation-sessions/${sessionId}/stage-media/${mediaId}`,
      {
        credentials: "omit",
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
        signal: abort.signal,
      },
    )
      .then(({ downloadUrl }) => {
        if (!abort.signal.aborted) setSource(downloadUrl);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [mediaId, sessionId, token]);
  if (!mediaId) return null;
  return source ? (
    <img
      src={source}
      alt={altText ?? ""}
      className="question-media"
      width={640}
      height={360}
      onError={() => {
        setSource("");
        setFailed(true);
      }}
    />
  ) : failed ? (
    <p className={styles.mediaFallback} role="status">
      Image unavailable.{altText ? ` ${altText}` : ""}
    </p>
  ) : (
    <p role="status">Loading image…</p>
  );
}

function PresentationAudienceStage({ sessionId: id }: { sessionId: string }) {
  const [snapshot, setSnapshot] = useState<PresentationStageSnapshot | null>(null);
  const latest = useRef<PresentationStageSnapshot | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const capturedPass = useRef<{ captured: boolean; pass: string | null }>({
    captured: false,
    pass: null,
  });
  const [unavailable, setUnavailable] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const receivedAt = useRef(Date.now());
  const [fullScreenSupported, setFullScreenSupported] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [fullScreenError, setFullScreenError] = useState("");

  useEffect(() => {
    setSnapshot(null);
    latest.current = null;
    setUnavailable(false);
    setReconnecting(false);
    if (!capturedPass.current.captured) {
      capturedPass.current = {
        captured: true,
        pass: capturePresentationStagePass({
          sessionId: id,
          location: window.location,
          history: window.history,
          storage,
        }),
      };
    }
    const pass = capturedPass.current.pass;
    setToken(pass);
    if (!pass) {
      setUnavailable(true);
      return;
    }
    let disposed = false;
    let timer: number | undefined;
    const abort = new AbortController();
    const invalidate = () => {
      rejectPresentationStagePass(storage, id, pass);
      capturedPass.current.pass = null;
      latest.current = null;
      setSnapshot(null);
      setToken(null);
      setUnavailable(true);
    };
    const poll = async () => {
      let delay = 2_000;
      try {
        const response = await apiFetch<{ snapshot: unknown }>(
          `/v1/presentation-sessions/${id}/stage`,
          {
            credentials: "omit",
            cache: "no-store",
            headers: { authorization: `Bearer ${pass}` },
            signal: abort.signal,
          },
        );
        if (disposed) return;
        const parsed = PresentationStageSnapshotSchema.safeParse(response.snapshot);
        if (!parsed.success || parsed.data.sessionId !== id) {
          invalidate();
          return;
        }
        if (shouldApplyPresentationSnapshot(latest.current, parsed.data)) {
          latest.current = parsed.data;
          receivedAt.current = Date.now();
          setSnapshot(parsed.data);
        }
        setReconnecting(false);
      } catch (caught) {
        if (disposed) return;
        if (caught instanceof ApiClientError && [401, 403, 404, 410].includes(caught.status)) {
          invalidate();
          return;
        }
        setReconnecting(true);
        if (caught instanceof ApiClientError && caught.retryAfterSeconds !== undefined)
          delay = Math.max(delay, Math.min(60_000, caught.retryAfterSeconds * 1_000));
      }
      if (!disposed) timer = window.setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      disposed = true;
      abort.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    setFullScreenSupported(typeof document.documentElement.requestFullscreen === "function");
    const update = () => setFullScreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("fullscreenchange", update);
    };
  }, []);

  async function toggleFullScreen() {
    setFullScreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullScreenError("Full screen could not open. You can continue presenting in this tab.");
    }
  }

  const remaining = presentationRemainingSeconds(snapshot, receivedAt.current, now);
  const opinionSummary = presentationOpinionSummaryFor(snapshot);
  const textResults =
    snapshot?.currentBlock?.kind === "question" &&
    isTextQuestion(snapshot.currentBlock.question.type) &&
    ["question_reveal", "intervention"].includes(snapshot.phase);
  return (
    <main className={styles.stagePage} lang="en-CA">
      <div className={styles.stageLayout}>
        {unavailable ? (
          <section className={styles.stageCanvas}>
            <div>
              <h1>Audience stage unavailable</h1>
              <p role="alert">
                Stage access has expired, was revoked, or is missing. Ask the presenter to open a
                new audience stage.
              </p>
            </div>
          </section>
        ) : !snapshot || !token ? (
          <section className={styles.stageCanvas}>
            <h1>Connecting to audience stage…</h1>
          </section>
        ) : (
          <>
            <header className={styles.stageHeader}>
              <p lang="">{snapshot.title}</p>
              <p>Join code: {snapshot.code}</p>
              <p>
                {snapshot.phase === "lobby"
                  ? "Ready to begin"
                  : snapshot.phase === "finished"
                    ? "Presentation complete"
                    : `Slide or activity ${snapshot.currentBlockIndex + 1} of ${snapshot.blockCount}`}
              </p>
            </header>
            {reconnecting ? (
              <p role="status">Reconnecting — showing the last confirmed slide.</p>
            ) : null}
            <section
              aria-label="Audience slide"
              className={`${styles.stageCanvas}${opinionSummary || textResults ? ` ${styles.stageOpinionCanvas}` : ""}`}
              tabIndex={0}
            >
              {snapshot.phase === "lobby" ? (
                <div className={styles.stageBody}>
                  <h1 lang="">{snapshot.title}</h1>
                  <p>Join on your device while you wait.</p>
                </div>
              ) : snapshot.phase === "finished" ? (
                <div className={styles.stageBody}>
                  <h1>Presentation complete</h1>
                  <p>Thank you for taking part.</p>
                </div>
              ) : snapshot.currentBlock ? (
                <div
                  className={`${styles.stageBody}${snapshot.currentBlock.kind === "content" ? ` ${styles.stageFrame}` : ""}${opinionSummary || textResults ? ` ${styles.stageOpinionBody}` : ""}`}
                >
                  {remaining !== null ? <p aria-live="off">{remaining}s remaining</p> : null}
                  {textResults &&
                  snapshot.currentBlock.kind === "question" &&
                  isTextQuestion(snapshot.currentBlock.question.type) ? (
                    <>
                      <h1 lang="">{snapshot.currentBlock.question.prompt}</h1>
                      <PresentationTextResults
                        sessionId={id}
                        blockId={snapshot.currentBlock.id}
                        type={snapshot.currentBlock.question.type}
                        revision={snapshot.revision}
                        seq={snapshot.seq}
                        phase={snapshot.phase}
                        projection="stage"
                        credential={token}
                        compact
                      />
                      <StageMedia
                        key={`${snapshot.currentBlock.id}:${snapshot.currentBlock.question.mediaId}`}
                        sessionId={id}
                        token={token}
                        mediaId={snapshot.currentBlock.question.mediaId}
                        altText={snapshot.currentBlock.question.mediaAlt}
                      />
                      {snapshot.revealedAnswer?.explanation ? (
                        <p lang="">{snapshot.revealedAnswer.explanation}</p>
                      ) : null}
                    </>
                  ) : opinionSummary && snapshot.currentBlock.kind === "question" ? (
                    <>
                      <h1 lang="">{snapshot.currentBlock.question.prompt}</h1>
                      <PresentationOpinionResults summary={opinionSummary} compact />
                      <StageMedia
                        key={`${snapshot.currentBlock.id}:${snapshot.currentBlock.question.mediaId}`}
                        sessionId={id}
                        token={token}
                        mediaId={snapshot.currentBlock.question.mediaId}
                        altText={snapshot.currentBlock.question.mediaAlt}
                      />
                      {snapshot.revealedAnswer?.explanation ? (
                        <p lang="">{snapshot.revealedAnswer.explanation}</p>
                      ) : null}
                    </>
                  ) : (
                    <PresentationDeliveryBlock
                      block={snapshot.currentBlock}
                      interactionSourceKey={JSON.stringify([id, token, reconnecting])}
                      revealedAnswer={snapshot.revealedAnswer}
                      renderMedia={(mediaId, altText) => (
                        <StageMedia
                          key={`${snapshot.currentBlock?.id}:${mediaId}`}
                          sessionId={id}
                          token={token}
                          mediaId={mediaId}
                          altText={altText}
                        />
                      )}
                    />
                  )}
                  {snapshot.phase === "intervention" && snapshot.recoveryPackIntervention ? (
                    <RecoveryPackLiveCardView card={snapshot.recoveryPackIntervention.card} />
                  ) : null}
                </div>
              ) : (
                <p>Waiting for the next slide.</p>
              )}
            </section>
            <footer className={styles.stageFooter}>
              <PresentationDeliveryJoinAccess code={snapshot.code} />
              <div>
                <button
                  type="button"
                  disabled={!fullScreenSupported}
                  onClick={() => void toggleFullScreen()}
                >
                  {fullScreen ? "Exit full screen" : "Enter full screen"}
                </button>
                {!fullScreenSupported ? (
                  <p>
                    Full-screen mode is unavailable in this browser. The stage remains usable in
                    this tab.
                  </p>
                ) : null}
                {fullScreenError ? <p role="alert">{fullScreenError}</p> : null}
              </div>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

export default function PresentationAudienceStagePage() {
  const { id } = useParams<{ id: string }>();
  return <PresentationAudienceStage key={id} sessionId={id} />;
}
