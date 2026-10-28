"use client";

import { useParams } from "next/navigation";
import { CompetitionDashboard } from "../../../components/competition-dashboard";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventEnvelope, SessionSnapshot } from "@openround/contracts";
import { currentRoundClientCapabilities, ROUND_CLIENT_UPDATE_MESSAGE } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import {
  AudiencePanel,
  enqueueAudienceRealtimeUpdate,
  type AudienceRealtimeBatch,
} from "../../../components/audience-panel";
import { ExperiencePreferences } from "../../../components/experience-preferences";
import { Countdown } from "../../../components/countdown";
import { JoinAccess } from "../../../components/join-access";
import { useLocale } from "../../../components/locale-provider";
import { ParticipantIdentity } from "../../../components/participant-avatar";
import { QuestionMedia } from "../../../components/question-media";
import { RecoveryPackLiveCardView } from "../../../components/recovery-pack-live-card";
import { ResponseDistributionView } from "../../../components/response-distribution";
import { TextLiveResults } from "../../../components/text-live-results";
import { isTextQuestion } from "../../../lib/text-response";
import { formatNumber } from "../../../lib/i18n/format";
import {
  audienceContextKey,
  createAudienceRealtimeReceipt,
  createRealtimeClient,
  withRealtimeReceipt,
} from "../../../lib/realtime";
import { experienceThemeStyle } from "../../../lib/theme";
import { playPresenterCue } from "../../../lib/sound";
import { clientUuid } from "../../../lib/uuid";

type Ack<T> = { data?: T; error?: { message: string } };

export default function PresenterPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { locale, t } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [error, setError] = useState("");
  const [errorIsEnglish, setErrorIsEnglish] = useState(false);
  const [mediaCredential, setMediaCredential] = useState("");
  const [textReadAuthorized, setTextReadAuthorized] = useState(false);
  const [textReadEpoch, setTextReadEpoch] = useState(0);
  const [embedded, setEmbedded] = useState(false);
  const [audienceSyncRevision, setAudienceSyncRevision] = useState(0);
  const [audienceRealtimeBatch, setAudienceRealtimeBatch] = useState<AudienceRealtimeBatch | null>(
    null,
  );
  const audiencePanelKey = useMemo(
    () => (mediaCredential ? `${sessionId}:presenter:${clientUuid()}` : `${sessionId}:presenter`),
    [mediaCredential, sessionId],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    setEmbedded(window.self !== window.top);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fragmentCredential = fragment.get("credential");
    if (fragmentCredential) {
      sessionStorage.setItem(`openround:presenter:${sessionId}`, fragmentCredential);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    const presenterToken =
      fragmentCredential ?? sessionStorage.getItem(`openround:presenter:${sessionId}`);
    if (!presenterToken) {
      setError(tRef.current("live.presenter.unauthorized"));
      setErrorIsEnglish(false);
      return;
    }
    setMediaCredential(presenterToken);
    const sync = () =>
      socket.emit(
        "sync.request",
        {
          sessionId,
          role: "presenter",
          clientCapabilities: currentRoundClientCapabilities(),
          hostToken: presenterToken,
          lastSeq: snapshotRef.current?.seq ?? 0,
        },
        (response: Ack<{ snapshot: SessionSnapshot }>) => {
          if (response.data) {
            setTextReadAuthorized(socket.connected);
            setSnapshot(response.data.snapshot);
          } else if (response.error) {
            setTextReadAuthorized(false);
            setTextReadEpoch((current) => current + 1);
            setError(response.error.message);
            setErrorIsEnglish(true);
          } else {
            setError(tRef.current("live.presenter.syncError"));
            setErrorIsEnglish(false);
          }
        },
      );
    const update = withRealtimeReceipt((envelope: EventEnvelope<{ snapshot: SessionSnapshot }>) => {
      playPresenterCue(envelope.payload.snapshot.experienceTheme, envelope.type);
      if (
        audienceContextKey(envelope.payload.snapshot) !== audienceContextKey(snapshotRef.current)
      ) {
        setAudienceSyncRevision((current) => current + 1);
      }
      setSnapshot(envelope.payload.snapshot);
    });
    const audienceUpdate = createAudienceRealtimeReceipt((gap, envelope) =>
      setAudienceRealtimeBatch((current) =>
        enqueueAudienceRealtimeUpdate(current, { gap, envelope }),
      ),
    );
    socket.on("client.update.required", () => {
      setError(ROUND_CLIENT_UPDATE_MESSAGE);
      setErrorIsEnglish(true);
    });
    socket.on("connect", () => {
      setTextReadAuthorized(false);
      setAudienceSyncRevision((current) => current + 1);
      sync();
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
    socket.on("disconnect", () => {
      setTextReadAuthorized(false);
      setTextReadEpoch((current) => current + 1);
    });
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  const showCompetitionDashboard = Boolean(
    snapshot?.competitionStandings &&
    snapshot.phase !== "lobby" &&
    (snapshot.phase === "finished" ||
      (snapshot.phase !== "intervention" && snapshot.roundKind === "main")),
  );

  return (
    <div
      className="live-shell"
      data-corners={snapshot?.experienceTheme.tokens.corners}
      data-motion={snapshot?.experienceTheme.motion}
      data-pattern={snapshot?.experienceTheme.tokens.pattern}
      data-typography={snapshot?.experienceTheme.tokens.typography}
      style={experienceThemeStyle(snapshot?.experienceTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <div className="button-row">
          <ExperiencePreferences />
          {!embedded ? (
            <button
              className="button-quiet small-button"
              lang="en-CA"
              onClick={() => window.close()}
              type="button"
            >
              Close presenter
            </button>
          ) : (
            <span className="status-pill">{t("live.presenter.readOnly")}</span>
          )}
        </div>
      </header>
      <main className="shell live-stage">
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {snapshot?.phase === "question_open" ? (
            snapshot.question?.prompt ? (
              <>
                {t("live.presenter.checkpointOpen", { prompt: "" })}
                <span lang="">{snapshot.question.prompt}</span>
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
              {t("live.presenter.roundStatus", { status: "" })}
              <span lang="en-CA">{snapshot.phase.replaceAll("_", " ")}</span>
            </>
          ) : (
            t("live.presenter.syncing")
          )}
        </p>
        {error ? (
          <section className="live-card">
            <p className="error" lang={errorIsEnglish ? "en-CA" : undefined} role="alert">
              {error}
            </p>
          </section>
        ) : null}
        {!snapshot && !error ? (
          <section className="live-card">
            <p>{t("live.presenter.syncingProgress")}</p>
          </section>
        ) : null}
        {snapshot?.phase === "lobby" ? (
          <section className="live-card" style={{ textAlign: "center" }}>
            <p className="eyebrow">{t("live.presenter.joinAtSite")}</p>
            <div className="session-code">{snapshot.code}</div>
            <JoinAccess code={snapshot.code} size={220} />
            <h2 lang="en-CA">{formatNumber(locale, snapshot.participants.length)} ready</h2>
            <ul className="roster" style={{ justifyContent: "center" }}>
              {snapshot.participants.map((participant) => (
                <li key={participant.id}>
                  <ParticipantIdentity
                    avatarId={participant.avatarId}
                    nickname={participant.nickname}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {snapshot?.question &&
        snapshot.phase !== "finished" &&
        !(
          snapshot.phase === "leaderboard" &&
          showCompetitionDashboard &&
          snapshot.competitionStandings &&
          snapshot.competitionStandings.status !== "unscored"
        ) ? (
          <section className="live-card">
            <div className="page-heading" style={{ alignItems: "center" }}>
              <span className="status-pill">
                {snapshot.roundKind === "linked_recheck" ? (
                  t("live.presenter.linkedRecheck")
                ) : snapshot.roundKind === "revote" ? (
                  t("live.presenter.revote")
                ) : (
                  <span lang="en-CA">
                    Checkpoint{" "}
                    {formatNumber(
                      locale,
                      (snapshot.questionPosition ?? snapshot.questionIndex ?? 0) + 1,
                    )}{" "}
                    of {formatNumber(locale, snapshot.questionCount)}
                  </span>
                )}
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
            <h1 lang="" style={{ fontSize: "clamp(2.4rem, 6vw, 5rem)" }}>
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
            {snapshot.question.type === "poll" && (snapshot.question.maxSelections ?? 1) > 1 ? (
              <p className="muted">
                {t("live.roundPlay.pollSelectionInstructions", {
                  limit: snapshot.question.maxSelections ?? 1,
                })}
              </p>
            ) : null}
            {snapshot.question.type === "ranking" ? (
              <p className="muted">
                {t("live.ranking.instructions", {
                  count: snapshot.question.rankCount ?? snapshot.question.choices.length,
                  total: snapshot.question.choices.length,
                })}
              </p>
            ) : null}
            {snapshot.question.choices.length > 0 ? (
              <div className="answer-grid">
                {snapshot.question.choices.map((choice, index) => {
                  const correct =
                    snapshot.correctResponse?.kind === "choice" &&
                    snapshot.correctResponse.choiceIds.includes(choice.id);
                  return (
                    <div
                      className="answer-button"
                      data-correct={correct || snapshot.correctChoiceId === choice.id || undefined}
                      key={choice.id}
                    >
                      <span aria-hidden="true">{String.fromCharCode(65 + index)}.</span>{" "}
                      <span lang="">{choice.label}</span>
                    </div>
                  );
                })}
              </div>
            ) : snapshot.question.type === "numeric" ? (
              <p className="lead" lang="en-CA">
                Enter a numeric response
                {snapshot.question.unit ? (
                  <>
                    {" "}
                    in <span lang="">{snapshot.question.unit}</span>
                  </>
                ) : null}
                {snapshot.correctResponse?.kind === "numeric" ? (
                  <>
                    . Correct response: <span lang="">{snapshot.correctResponse.value}</span>
                    {snapshot.question.unit ? (
                      <>
                        {" "}
                        <span lang="">{snapshot.question.unit}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  "."
                )}
              </p>
            ) : snapshot.question.rating ? (
              <p className="lead" lang="en-CA">
                Rate from {formatNumber(locale, snapshot.question.rating.min)} (
                {<span lang="">{snapshot.question.rating.minLabel}</span>}) to{" "}
                {formatNumber(locale, snapshot.question.rating.max)} (
                {<span lang="">{snapshot.question.rating.maxLabel}</span>}).
              </p>
            ) : null}
            {snapshot.phase === "intervention" && snapshot.intervention ? (
              <p className="notice">
                {snapshot.intervention.type === "peer_discussion"
                  ? t("live.presenter.discuss")
                  : snapshot.intervention.type === "example"
                    ? t("live.presenter.example")
                    : snapshot.intervention.type === "explain"
                      ? t("live.presenter.clarifying")
                      : t("live.presenter.shortBreak")}
              </p>
            ) : null}
            {snapshot.phase === "intervention" && snapshot.recoveryPackCard ? (
              <RecoveryPackLiveCardView card={snapshot.recoveryPackCard} />
            ) : null}
            {snapshot.explanation ? (
              <p className="notice" lang="">
                {snapshot.explanation}
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
                role="presenter"
              />
            ) : null}
            {(snapshot.uxBeta === true ||
              snapshot.question?.type === "ranking" ||
              (snapshot.question?.type === "poll" && (snapshot.question.maxSelections ?? 1) > 1)) &&
            snapshot.responseDistribution ? (
              <ResponseDistributionView distribution={snapshot.responseDistribution} />
            ) : null}
            {!snapshot.competitionStandings &&
            snapshot.phase === "leaderboard" &&
            snapshot.settings.resultVisibility === "leaderboard" ? (
              <ol style={{ fontSize: "1.4rem", lineHeight: 1.8 }}>
                {snapshot.participants.slice(0, 5).map((participant) => (
                  <li key={participant.id}>
                    <ParticipantIdentity
                      avatarId={participant.avatarId}
                      nickname={participant.nickname}
                    />{" "}
                    · {formatNumber(locale, participant.score)}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}
        {snapshot?.competitionStandings && showCompetitionDashboard ? (
          <CompetitionDashboard
            variant="presenter"
            standings={snapshot.competitionStandings}
            finished={snapshot.phase === "finished"}
            compact={snapshot.phase !== "finished" && snapshot.phase !== "leaderboard"}
          />
        ) : null}
        {snapshot?.phase === "finished" && !snapshot.competitionStandings ? (
          <section className="live-card" style={{ textAlign: "center" }}>
            <p className="eyebrow">{t("live.presenter.roundComplete")}</p>
            <h1 style={{ fontSize: "clamp(3rem, 9vw, 6rem)" }}>{t("live.presenter.thankYou")}</h1>
            <p className="lead" lang="en-CA" style={{ margin: "auto" }}>
              The facilitator now has the results for follow-up.
            </p>
          </section>
        ) : null}
        {snapshot && snapshot.phase !== "finished" && mediaCredential ? (
          <AudiencePanel
            key={audiencePanelKey}
            realtimeBatch={audienceRealtimeBatch}
            role="presenter"
            sessionId={sessionId}
            syncRevision={audienceSyncRevision}
            token={mediaCredential}
          />
        ) : null}
      </main>
    </div>
  );
}
