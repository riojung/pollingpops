"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import type { AvatarId, JoinPreflightResponse, JoinResponse } from "@openround/contracts";
import { Brand } from "../../components/brand";
import { AvatarPicker } from "../../components/participant-avatar";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { surveyAccessToken, type SurveyAttempt } from "../../lib/survey-client";
import {
  beginJoinPreflight,
  completeJoinPreflight,
  failJoinPreflight,
  idleJoinPreflightState,
  joinArtifactFor,
  nicknameForJoin,
  resolveJoinPreflightForSubmission,
  shouldCollectJoinNickname,
} from "../../lib/join-preflight";

function JoinForm() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [code, setCode] = useState(() =>
    (searchParams.get("code") ?? "").replace(/\D/g, "").slice(0, 7),
  );
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState<AvatarId>("comet");
  const [preflight, setPreflight] = useState(idleJoinPreflightState);
  const preflightRequestId = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const artifactType = joinArtifactFor(preflight, code);
  const collectNickname = shouldCollectJoinNickname(preflight, code);

  useEffect(() => {
    const requestId = ++preflightRequestId.current;
    if (code.length !== 7) {
      setPreflight(idleJoinPreflightState);
      return;
    }

    const controller = new AbortController();
    setPreflight(beginJoinPreflight(code, requestId));
    const timer = window.setTimeout(() => {
      void apiFetch<JoinPreflightResponse>(
        `/v1/live-rooms/join/preflight?${new URLSearchParams({ code })}`,
        { signal: controller.signal },
      )
        .then((response) => {
          setPreflight((current) => completeJoinPreflight(current, requestId, response));
        })
        .catch((caught) => {
          if (controller.signal.aborted) return;
          setPreflight((current) =>
            failJoinPreflight(
              current,
              requestId,
              `${humanError(caught)}. You can still try joining.`,
            ),
          );
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [code]);

  useEffect(() => {
    if (!collectNickname) setNickname("");
  }, [collectNickname]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submittedCode = code;
    setBusy(true);
    setError("");
    try {
      let resolvedPreflight = preflight;
      if (joinArtifactFor(resolvedPreflight, submittedCode) === null) {
        const requestId = ++preflightRequestId.current;
        setPreflight(beginJoinPreflight(submittedCode, requestId));
        try {
          const resolved = await resolveJoinPreflightForSubmission(
            resolvedPreflight,
            submittedCode,
            requestId,
            (roomCode) =>
              apiFetch<JoinPreflightResponse>(
                `/v1/live-rooms/join/preflight?${new URLSearchParams({ code: roomCode })}`,
              ),
          );
          resolvedPreflight = resolved;
          setPreflight((current) =>
            current.requestId === requestId && current.code === submittedCode ? resolved : current,
          );
        } catch (caught) {
          setPreflight((current) =>
            failJoinPreflight(
              current,
              requestId,
              `${humanError(caught)}. We could not confirm the room type; try again.`,
            ),
          );
          throw caught;
        }
      }

      const resolvedArtifactType = joinArtifactFor(resolvedPreflight, submittedCode);
      if (resolvedArtifactType === "feedback_room") {
        const roomId = resolvedPreflight.destination?.match(/^\/survey\/([a-f0-9-]{36})$/)?.[1];
        if (!roomId) throw new Error("Could not confirm this Survey. Check the code and retry.");
        const storageKey = `pollingpops:survey:${roomId}`;
        const token = localStorage.getItem(storageKey) ?? surveyAccessToken();
        // Persist before admission so an interrupted acknowledgement retries the same guest.
        localStorage.setItem(storageKey, token);
        const joined = await apiFetch<{ attempt: SurveyAttempt }>("/v1/survey-rooms/join", {
          method: "POST",
          credentials: "omit",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ code: submittedCode }),
        });
        router.push(`/survey/${joined.attempt.roomId}`);
        return;
      }
      if (resolvedArtifactType === "presentation") {
        const joined = await apiFetch<{
          participantToken: string;
          snapshot: { id: string };
        }>("/v1/presentation-sessions/join", {
          method: "POST",
          body: JSON.stringify({ code: submittedCode, nickname: nickname.trim() }),
        });
        sessionStorage.setItem(
          `openround:presentation-participant:${joined.snapshot.id}`,
          joined.participantToken,
        );
        sessionStorage.setItem("openround:last-code", submittedCode);
        router.push(`/presentation-session/${joined.snapshot.id}/play`);
        return;
      }
      if (resolvedArtifactType !== "round") {
        throw new Error("The room type could not be confirmed. Please try again.");
      }
      const requestedNickname = nicknameForJoin(resolvedPreflight, submittedCode, nickname);
      const joined = await apiFetch<JoinResponse>("/v1/sessions/join", {
        method: "POST",
        body: JSON.stringify({
          code: submittedCode,
          avatarId,
          ...(requestedNickname ? { nickname: requestedNickname } : {}),
        }),
      });
      sessionStorage.setItem(
        `openround:participant:${joined.snapshot.sessionId}`,
        joined.participantToken,
      );
      sessionStorage.setItem("openround:last-code", submittedCode);
      router.push(`/play/${joined.snapshot.sessionId}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <section className="join-card auth-card" aria-labelledby="join-heading">
      <p className="eyebrow">{t("delivery.join.eyebrow")}</p>
      <h1 id="join-heading" style={{ fontSize: "clamp(2.5rem, 9vw, 4.4rem)" }}>
        {artifactType === "feedback_room"
          ? t("create.kind.survey")
          : artifactType === "presentation"
            ? t("delivery.join.presentationTitle")
            : t("delivery.join.title")}
      </h1>
      <p className="muted">
        {artifactType === "feedback_room"
          ? t("create.kind.survey.description")
          : artifactType === "presentation"
            ? t("delivery.join.presentationDescription")
            : t("delivery.join.description")}
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="join-code">{t("delivery.join.codeLabel")}</label>
          <input
            autoComplete="one-time-code"
            className="input code-input"
            id="join-code"
            inputMode="numeric"
            maxLength={7}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 7))}
            placeholder="0000000"
            required
            disabled={busy}
            value={code}
          />
        </div>
        {collectNickname ? (
          <div className="field">
            <label htmlFor="nickname">{t("delivery.join.nickname")}</label>
            <input
              autoComplete="nickname"
              className="input"
              id="nickname"
              maxLength={32}
              onChange={(event) => setNickname(event.target.value)}
              placeholder={t("delivery.join.nicknamePlaceholder")}
              required={artifactType !== "round"}
              disabled={busy}
              value={nickname}
            />
          </div>
        ) : (
          <p className="notice" data-testid="friendly-alias-notice" role="status">
            {artifactType === "feedback_room"
              ? "No nickname or learning identity is collected. Organizers see question-level totals, not linked respondent answers."
              : "A privacy-friendly nickname will be assigned when you join."}
          </p>
        )}
        {artifactType === "round" ? (
          <AvatarPicker disabled={busy} onChange={setAvatarId} value={avatarId} />
        ) : null}
        {preflight.code === code && preflight.status === "checking" ? (
          <p className="muted" role="status">
            Checking room name settings…
          </p>
        ) : null}
        {preflight.code === code && preflight.status === "failed" ? (
          <p className="notice" lang="en-CA" role="status">
            {preflight.message}
          </p>
        ) : null}
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button full-width"
          disabled={
            busy ||
            code.length !== 7 ||
            preflight.status === "checking" ||
            (artifactType !== "round" && artifactType !== "feedback_room" && !nickname.trim())
          }
          type="submit"
        >
          {busy
            ? t("delivery.join.joining")
            : artifactType === "feedback_room"
              ? t("create.kind.survey")
              : artifactType === "presentation"
                ? t("delivery.join.presentationTitle")
                : t("delivery.join.submit")}
        </button>
      </form>
      <p className="muted" style={{ fontSize: "0.84rem", marginTop: 18, marginBottom: 0 }}>
        By joining, you agree to the session rules and <Link href="/privacy">privacy notice</Link>.
      </p>
      <p className="muted" style={{ fontSize: "0.84rem", marginBottom: 0 }}>
        Round, Presentation, and Survey codes all work here.
      </p>
    </section>
  );
}

export default function JoinPage() {
  const { t } = useLocale();
  return (
    <>
      <header className="shell topbar">
        <Brand />
      </header>
      <main className="shell auth-wrap">
        <Suspense fallback={<div className="panel">{t("delivery.common.loading")}</div>}>
          <JoinForm />
        </Suspense>
      </main>
    </>
  );
}
