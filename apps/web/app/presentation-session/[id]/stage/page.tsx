"use client";

import { useParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  NATIVE_DESIGN_THEMES,
  NATIVE_DESIGN_FONTS,
} from "../../../../lib/presentation-native-design";
import {
  PresentationStageSnapshotSchema,
  type PresentationStageSnapshot,
} from "@openround/contracts";
import { apiFetch, ApiClientError } from "../../../../lib/api";
import { useLocale } from "../../../../components/locale-provider";
import { presentationDeliveryCopy } from "../../../../lib/i18n/presentation-delivery-copy";
import { formatNumber } from "../../../../lib/i18n/format";
import {
  capturePresentationStagePass,
  rejectPresentationStagePass,
} from "../../../../lib/presentation-stage-pass";
import {
  presentationRemainingSeconds,
  shouldApplyPresentationSnapshot,
} from "../../../../lib/presentation-realtime";
import { PresentationDeliveryBlock } from "../../../../components/presentation-live/delivery-block";
import { PresentationSpatialDelivery } from "../../../../components/presentation-live/presentation-spatial-delivery";
import { presentationInteractionRuntime } from "../../../../lib/presentation-interaction-runtime";
import { PresentationOpinionResults } from "../../../../components/presentation-live/opinion-results";
import { PresentationTextResults } from "../../../../components/presentation-live/text-results";
import { isTextQuestion } from "../../../../lib/text-response";
import { presentationOpinionSummaryFor } from "../../../../lib/presentation-opinion-response";
import { PresentationDeliveryJoinAccess } from "../../../../components/presentation-live/delivery-join-access";
import { RecoveryPackLiveCardView } from "../../../../components/recovery-pack-live-card";
import { Brand } from "../../../../components/brand";
import { stageDisplayCopy } from "../../../../components/presentation-live/stage-display-copy";
import { useStageSetupPopup } from "../../../../components/presentation-live/stage-setup-popup";
import { useExperienceMotionReduced } from "../../../../lib/experience-motion";
import display from "../../../../components/presentation-live/stage-display.module.css";
import styles from "../../../../components/presentation-live/audience-workspace.module.css";

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
  const { locale } = useLocale();
  const copy = presentationDeliveryCopy(locale);
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
      {copy("imageUnavailable")}
      {altText ? (
        <>
          {" "}
          <span lang="">{altText}</span>
        </>
      ) : null}
    </p>
  ) : (
    <p role="status">{copy("loadingImage")}</p>
  );
}

function PresentationAudienceStage({ sessionId: id }: { sessionId: string }) {
  const { locale } = useLocale();
  const copy = presentationDeliveryCopy(locale);
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
  const [fullScreenError, setFullScreenError] = useState(false);
  const [exitError, setExitError] = useState(false);
  const [focusView, setFocusView] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [requestingFullScreen, setRequestingFullScreen] = useState(false);
  const screen = stageDisplayCopy(locale);
  const setup = useStageSetupPopup();
  const displayRef = useRef<HTMLElement>(null);
  const slideRef = useRef<HTMLElement>(null);
  const previousSlide = useRef<string | undefined>(undefined);
  const previousOpinion = useRef<string | undefined>(undefined);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const controlsTimer = useRef<number | undefined>(undefined);
  const activeFullScreen = useRef(false);
  const fullScreenRequest = useRef(0);
  const fullScreenBusy = useRef(false);
  const reducedMotion = useExperienceMotionReduced();

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
    setFullScreenSupported(
      typeof displayRef.current?.requestFullscreen === "function" &&
        document.fullscreenEnabled !== false,
    );
    const update = () => {
      const active = document.fullscreenElement === displayRef.current;
      const exited = activeFullScreen.current && !active;
      activeFullScreen.current = active;
      setFullScreen(active);
      if (active) {
        setFocusView(true);
        setFullScreenError(false);
      } else if (exited) {
        setFocusView(false);
        setExitError(false);
        window.requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }));
      }
    };
    update();
    document.addEventListener("fullscreenchange", update);
    return () => {
      fullScreenRequest.current++;
      window.clearInterval(timer);
      if (controlsTimer.current !== undefined) window.clearTimeout(controlsTimer.current);
      document.removeEventListener("fullscreenchange", update);
    };
  }, []);

  function revealControls() {
    setControlsVisible(true);
    if (controlsTimer.current !== undefined) window.clearTimeout(controlsTimer.current);
    controlsTimer.current = window.setTimeout(() => setControlsVisible(false), 2_400);
  }
  useEffect(() => {
    if (!focusView) return;
    displayRef.current?.focus({ preventScroll: true });
    revealControls();
    return () => {
      if (controlsTimer.current !== undefined) window.clearTimeout(controlsTimer.current);
    };
  }, [focusView]);

  async function leaveFocusView() {
    fullScreenRequest.current++;
    setExitError(false);
    try {
      if (document.fullscreenElement === displayRef.current) await document.exitFullscreen();
      setFocusView(false);
      setFullScreenError(false);
      window.requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }));
    } catch {
      setExitError(true);
      revealControls();
    }
  }
  async function toggleFullScreen() {
    if (document.fullscreenElement === displayRef.current) {
      await leaveFocusView();
      return;
    }
    if (fullScreenBusy.current) return;
    const element = displayRef.current;
    if (!element) return;
    setFocusView(true);
    setFullScreenError(false);
    setExitError(false);
    if (typeof element.requestFullscreen !== "function" || document.fullscreenEnabled === false)
      return;
    const request = ++fullScreenRequest.current;
    fullScreenBusy.current = true;
    setRequestingFullScreen(true);
    try {
      // Request synchronously in this click's user activation; opening a second
      // window never grants this stage an automatic fullscreen request.
      await element.requestFullscreen({ navigationUI: "hide" });
      if (request !== fullScreenRequest.current && document.fullscreenElement === element)
        await document.exitFullscreen();
    } catch {
      if (request === fullScreenRequest.current) setFullScreenError(true);
    } finally {
      fullScreenBusy.current = false;
      if (displayRef.current === element) setRequestingFullScreen(false);
    }
  }

  const remaining = presentationRemainingSeconds(snapshot, receivedAt.current, now);
  const opinionSummary = presentationOpinionSummaryFor(snapshot);
  const slideBlockId =
    snapshot?.phase === "lobby" || snapshot?.phase === "finished"
      ? undefined
      : snapshot?.currentBlock?.id;
  const opinionBlockId = slideBlockId ? opinionSummary?.blockId : undefined;

  useLayoutEffect(() => {
    const changedSlide = previousSlide.current !== slideBlockId;
    previousSlide.current = slideBlockId;
    const slide = slideRef.current;
    if (!slideBlockId || !changedSlide || !slide) return;

    // Reset reused scroll containers while keeping the stage and its focus in place.
    const origin = { top: 0, left: 0, behavior: "instant" } as const;
    slide.scrollTo(origin);
    for (const results of slide.querySelectorAll<HTMLElement>("[data-opinion-results-scroll]")) {
      results.scrollTo(origin);
    }
    if (reducedMotion) return;

    const entrance = slide.animate?.([{ opacity: 0.82 }, { opacity: 1 }], {
      duration: 240,
      easing: "ease-out",
      id: "presentation-slide-enter",
    });
    return () => entrance?.cancel();
  }, [slideBlockId, reducedMotion]);

  useLayoutEffect(() => {
    const revealedOpinion = previousOpinion.current !== opinionBlockId;
    previousOpinion.current = opinionBlockId;
    if (!opinionBlockId || !revealedOpinion || reducedMotion || !slideRef.current) return;

    const bars = slideRef.current.querySelectorAll<HTMLElement>("[data-opinion-result-bar]");
    const reveals = Array.from(bars, (bar) =>
      bar.animate?.([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: 420,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        id: "presentation-opinion-reveal",
      }),
    );
    return () => reveals.forEach((reveal) => reveal?.cancel());
  }, [opinionBlockId, reducedMotion]);

  const questionDesign =
    snapshot?.currentBlock?.kind === "question" ? snapshot.currentBlock.design : undefined;
  const questionPalette = questionDesign ? NATIVE_DESIGN_THEMES[questionDesign.theme] : undefined;
  const questionStyle: CSSProperties | undefined =
    questionPalette && questionDesign
      ? {
          background: questionPalette.background,
          color: questionPalette.text,
          fontFamily: NATIVE_DESIGN_FONTS[questionDesign.font],
        }
      : undefined;
  const textResults =
    snapshot?.currentBlock?.kind === "question" &&
    isTextQuestion(snapshot.currentBlock.question.type) &&
    ["question_reveal", "intervention"].includes(snapshot.phase);
  return (
    <main
      ref={displayRef}
      className={`${styles.theaterPage} ${display.screen}`}
      data-audience-stage
      data-stage-focus={focusView ? "true" : "false"}
      data-stage-motion={reducedMotion ? "reduced" : "full"}
      data-stage-controls-visible={controlsVisible ? "true" : "false"}
      tabIndex={-1}
      lang={locale}
      onPointerMove={() => {
        if (focusView) revealControls();
      }}
      onPointerDown={() => {
        if (focusView) revealControls();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && focusView && !document.fullscreenElement) {
          event.preventDefault();
          void leaveFocusView();
        }
      }}
    >
      <div
        className={display.focusTools}
        data-stage-focus-controls
        data-error={fullScreenError || exitError ? "true" : undefined}
        hidden={!focusView}
        role="group"
        aria-label={screen.focus}
      >
        <div>
          <button type="button" onClick={() => void leaveFocusView()}>
            {screen.exitFocus}
          </button>
          {!fullScreen && fullScreenSupported ? (
            <button
              type="button"
              disabled={requestingFullScreen}
              onClick={() => void toggleFullScreen()}
            >
              {copy("enterFullScreen")}
            </button>
          ) : null}
        </div>
        <p>{screen.focusHelp}</p>
        {!fullScreenSupported ? <p role="status">{screen.fallback}</p> : null}
        {fullScreenError ? (
          <p role="alert">
            {copy("fullScreenError")} {screen.rejected}
          </p>
        ) : null}
        {exitError ? <p role="alert">{screen.exitRejected}</p> : null}
      </div>
      <div className={`${styles.theaterLayout} ${display.layout}`}>
        <header
          className={`${styles.theaterHeader} ${display.chrome}`}
          data-stage-header
          hidden={focusView}
        >
          <Brand />
          <p className={styles.theaterTitle} lang={snapshot ? "" : locale}>
            {snapshot?.title ?? copy("audienceSlide")}
          </p>
          <div className={styles.theaterMeta}>
            {snapshot ? (
              <>
                <p>{copy("joinCodeHeader", { code: snapshot.code })}</p>
                <p>
                  {snapshot.phase === "lobby"
                    ? copy("ready")
                    : snapshot.phase === "finished"
                      ? copy("complete")
                      : copy("progress", {
                          current: formatNumber(locale, snapshot.currentBlockIndex + 1),
                          total: formatNumber(locale, snapshot.blockCount),
                        })}
                </p>
                {remaining !== null ? (
                  <p aria-live="off">
                    {copy("secondsRemaining", { count: formatNumber(locale, remaining) })}
                  </p>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              disabled={!fullScreenSupported || requestingFullScreen}
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                void toggleFullScreen();
              }}
            >
              {copy(fullScreen ? "exitFullScreen" : "enterFullScreen")}
            </button>
            <button
              type="button"
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                setFullScreenError(false);
                setFocusView(true);
              }}
            >
              {screen.focus}
            </button>
            <details ref={setup.detailsRef} className={display.setup} onToggle={setup.position}>
              <summary>{screen.setup}</summary>
              <div ref={setup.popupRef} data-stage-setup-popup="display">
                <p>{screen.stageHelp}</p>
                <p>{screen.privacy}</p>
              </div>
            </details>
          </div>
        </header>
        {!fullScreenSupported && !focusView ? (
          <p className={styles.theaterNotice}>{copy("fullScreenUnavailable")}</p>
        ) : null}
        {fullScreenError && !focusView ? (
          <p className={styles.theaterNotice} role="alert">
            {copy("fullScreenError")}
          </p>
        ) : null}
        {unavailable ? (
          <section className={`${styles.theaterCanvas} ${display.canvas}`}>
            <div>
              <h1>{copy("unavailable")}</h1>
              <p role="alert">{copy("accessExpired")}</p>
            </div>
          </section>
        ) : !snapshot || !token ? (
          <section className={`${styles.theaterCanvas} ${display.canvas}`}>
            <h1>{copy("connecting")}</h1>
          </section>
        ) : (
          <>
            {reconnecting ? (
              <p className={styles.theaterNotice} role="status">
                {copy("reconnecting")}
              </p>
            ) : null}
            <div className={display.chrome} data-stage-spatial hidden={focusView}>
              <PresentationSpatialDelivery
                compact
                spatial={snapshot.spatial}
                currentBlockIndex={snapshot.currentBlockIndex}
                phase={snapshot.phase}
                sourceKey={`${id}:${snapshot.presentationVersionId}`}
              />
            </div>
            <section
              ref={slideRef}
              aria-label={copy("audienceSlide")}
              style={questionStyle}
              className={`${styles.theaterCanvas} ${display.canvas}`}
              data-stage-slide
              data-kind={
                snapshot.phase === "lobby" || snapshot.phase === "finished"
                  ? snapshot.phase
                  : snapshot.currentBlock?.kind
              }
              data-results={opinionSummary || textResults ? "true" : undefined}
              tabIndex={0}
            >
              {snapshot.phase === "lobby" ? (
                <div className={`${styles.theaterBody} ${display.body}`}>
                  <h1 lang="">{snapshot.title}</h1>
                  <p>{copy("joinWaiting")}</p>
                </div>
              ) : snapshot.phase === "finished" ? (
                <div className={`${styles.theaterBody} ${display.body}`}>
                  <h1>{copy("complete")}</h1>
                  <p>{copy("thanks")}</p>
                </div>
              ) : snapshot.currentBlock ? (
                <div
                  className={`${styles.theaterBody} ${display.body}${snapshot.currentBlock.kind === "content" ? ` ${styles.theaterFrame}` : ""}${opinionSummary || textResults ? ` ${styles.theaterResults}` : ""}`}
                >
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
                      <PresentationOpinionResults summary={opinionSummary} compact showChart />
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
                      fixedLayout={focusView}
                      interactionRuntime={presentationInteractionRuntime(snapshot, {
                        mode: "live_audience",
                      })}
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
                <p>{copy("waiting")}</p>
              )}
            </section>
            <footer
              className={`${styles.theaterFooter} ${display.chrome}`}
              data-stage-footer
              hidden={focusView}
            >
              <PresentationDeliveryJoinAccess code={snapshot.code} />
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
