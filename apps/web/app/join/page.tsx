"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import type { AvatarId, JoinPreflightResponse, JoinResponse } from "@openround/contracts";
import { currentRoundClientCapabilities } from "@openround/contracts";
import { Brand } from "../../components/brand";
import { AvatarPicker, ParticipantAvatar } from "../../components/participant-avatar";
import { RoomPasswordInput } from "../../components/room-password";
import { roomPasswordErrorKey } from "../../lib/room-password";
import { useLocale } from "../../components/locale-provider";
import { ApiClientError, apiFetch, humanError } from "../../lib/api";
import { surveyAccessToken, type SurveyAttempt } from "../../lib/survey-client";
import { liveWorkflowCopy } from "../../lib/i18n/live-workflow-copy";
import { deliveryPrimaryCopy, type DeliveryPrimaryKey } from "../../lib/i18n/delivery-primary-copy";
import styles from "./join.module.css";
import {
  beginJoinPreflight,
  completeJoinPreflight,
  failJoinPreflight,
  idleJoinPreflightState,
  joinArtifactFor,
  nicknameForJoin,
  resolveJoinPreflightForSubmission,
  shouldCollectJoinNickname,
  shouldCollectJoinPassword,
} from "../../lib/join-preflight";

export function JoinForm() {
  const { locale, t } = useLocale();
  const copy = liveWorkflowCopy(locale);
  const primaryCopy = deliveryPrimaryCopy(locale);
  const [localError, setLocalError] = useState<DeliveryPrimaryKey | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [code, setCode] = useState(() =>
    (searchParams.get("code") ?? "").replace(/\D/g, "").slice(0, 7),
  );
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRequested, setPasswordRequested] = useState(false);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof roomPasswordErrorKey>>(null);
  const [avatarId, setAvatarId] = useState<AvatarId>("comet");
  const [preflight, setPreflight] = useState(idleJoinPreflightState);
  const preflightRequestId = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<"code" | "nickname" | null>(null);
  const artifactType = joinArtifactFor(preflight, code);
  const collectNickname = shouldCollectJoinNickname(preflight, code);
  const collectPassword = passwordRequested || shouldCollectJoinPassword(preflight, code);

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
          setPreflight((current) => failJoinPreflight(current, requestId, humanError(caught)));
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
    setLocalError(null);
    setErrorField(null);
    setErrorKey(null);
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
          setPreflight((current) => failJoinPreflight(current, requestId, humanError(caught)));
          throw caught;
        }
      }

      if (
        (passwordRequested || shouldCollectJoinPassword(resolvedPreflight, submittedCode)) &&
        !password
      ) {
        setPasswordRequested(true);
        setErrorKey("live.protection.required");
        setBusy(false);
        return;
      }
      const passwordBody = password ? { password } : {};
      const resolvedArtifactType = joinArtifactFor(resolvedPreflight, submittedCode);
      if (resolvedArtifactType === "feedback_room") {
        const roomId = resolvedPreflight.destination?.match(/^\/survey\/([a-f0-9-]{36})$/)?.[1];
        if (!roomId) {
          setLocalError("We could not confirm the room type; try again.");
          setBusy(false);
          return;
        }
        const storageKey = `pollingpops:survey:${roomId}`;
        const token = localStorage.getItem(storageKey) ?? surveyAccessToken();
        // Persist before admission so an interrupted acknowledgement retries the same guest.
        localStorage.setItem(storageKey, token);
        const joined = await apiFetch<{ attempt: SurveyAttempt }>("/v1/survey-rooms/join", {
          method: "POST",
          credentials: "omit",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ code: submittedCode, ...passwordBody }),
        });
        router.push(`/survey/${joined.attempt.roomId}`);
        return;
      }
      if (resolvedArtifactType === "presentation") {
        if (!nickname.trim()) {
          setBusy(false);
          return;
        }
        const joined = await apiFetch<{
          participantToken: string;
          snapshot: { id: string };
        }>("/v1/presentation-sessions/join", {
          method: "POST",
          body: JSON.stringify({ code: submittedCode, nickname: nickname.trim(), ...passwordBody }),
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
        setLocalError("We could not confirm the room type; try again.");
        setBusy(false);
        return;
      }
      const requestedNickname = nicknameForJoin(resolvedPreflight, submittedCode, nickname);
      const joined = await apiFetch<JoinResponse>("/v1/sessions/join", {
        method: "POST",
        body: JSON.stringify({
          code: submittedCode,
          ...passwordBody,
          avatarId,
          clientCapabilities: currentRoundClientCapabilities(),
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
      const key = roomPasswordErrorKey(caught);
      setErrorKey(key);
      if (key) setPasswordRequested(true);
      else {
        setError(humanError(caught));
        setErrorField(
          caught instanceof ApiClientError
            ? ["INVALID_CODE", "NOT_FOUND"].includes(caught.code)
              ? "code"
              : caught.code === "NICKNAME_REJECTED"
                ? "nickname"
                : null
            : null,
        );
      }
      setBusy(false);
    }
  }

  return (
    <section className="join-card auth-card" aria-labelledby="join-heading">
      <p className="eyebrow">{t("delivery.join.eyebrow")}</p>
      <h1 className={styles.heading} id="join-heading">
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
            aria-describedby={errorField === "code" ? "join-code-error" : undefined}
            aria-invalid={errorField === "code" || undefined}
            autoComplete="one-time-code"
            className="input code-input"
            id="join-code"
            inputMode="numeric"
            maxLength={7}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 7));
              setPassword("");
              setPasswordRequested(false);
              setError("");
              setLocalError(null);
              setErrorKey(null);
              setErrorField(null);
            }}
            placeholder="0000000"
            required
            disabled={busy}
            value={code}
          />
          {error && errorField === "code" ? (
            <p className="error" id="join-code-error" lang="en-CA" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        {collectPassword ? (
          <RoomPasswordInput
            value={password}
            onChange={setPassword}
            disabled={busy}
            error={errorKey ? t(errorKey) : undefined}
          />
        ) : null}
        {collectNickname ? (
          <div className="field">
            <label htmlFor="nickname">
              {t(
                artifactType === "presentation"
                  ? "delivery.join.nickname"
                  : "delivery.join.nicknameOptional",
              )}
            </label>
            <input
              aria-describedby={
                [
                  artifactType !== "presentation" ? "nickname-help" : "",
                  errorField === "nickname" ? "nickname-error" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              aria-invalid={errorField === "nickname" || undefined}
              autoComplete="nickname"
              className="input"
              id="nickname"
              maxLength={32}
              onChange={(event) => {
                setNickname(event.target.value);
                if (errorField === "nickname") {
                  setError("");
                  setErrorField(null);
                }
              }}
              placeholder={t("delivery.join.nicknamePlaceholder")}
              required={artifactType === "presentation"}
              disabled={busy}
              value={nickname}
            />
            {artifactType !== "presentation" ? (
              <small className="muted" id="nickname-help">
                {t("delivery.join.nicknameHelp")}
              </small>
            ) : null}
            {error && errorField === "nickname" ? (
              <p className="error" id="nickname-error" lang="en-CA" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="notice" data-testid="friendly-alias-notice" role="status">
            {artifactType === "feedback_room"
              ? copy.surveyPrivacy
              : t("delivery.join.friendlyNicknameNotice")}
          </p>
        )}
        {artifactType === "round" ? (
          <details className={styles.avatarChoice}>
            <summary aria-label={copy.changeAvatar}>
              <ParticipantAvatar avatarId={avatarId} decorative size="small" />
              {copy.changeAvatar}
            </summary>
            <AvatarPicker disabled={busy} onChange={setAvatarId} value={avatarId} />
          </details>
        ) : null}
        {preflight.code === code && preflight.status === "checking" ? (
          <p className="muted" role="status">
            {copy.checkingRoom}
          </p>
        ) : null}
        {preflight.code === code && preflight.status === "failed" ? (
          <p className="notice" lang={locale} role="status">
            {primaryCopy("You can still try joining.")} {primaryCopy("Service message")}:{" "}
            <span lang="en-CA">{preflight.message}</span>
          </p>
        ) : null}
        {error && !errorField ? (
          <p className="error" lang={locale} role="alert">
            {primaryCopy("Service message")}: <span lang="en-CA">{error}</span>
          </p>
        ) : null}
        {localError ? (
          <p className="error" lang={locale} role="alert">
            {primaryCopy(localError)}
          </p>
        ) : null}
        <button
          className="button full-width"
          disabled={
            busy ||
            code.length !== 7 ||
            preflight.status === "checking" ||
            (artifactType === "presentation" && !nickname.trim())
          }
          type="submit"
        >
          {busy
            ? t("delivery.join.joining")
            : artifactType === "feedback_room"
              ? copy.openSurvey
              : artifactType === "presentation"
                ? copy.joinPresentation
                : t("delivery.join.submit")}
        </button>
      </form>
      <p className={`muted ${styles.privacy}`}>
        {copy.privacyPrefix} <Link href="/privacy">{copy.privacyLink}</Link>.
      </p>
      <p className={`muted ${styles.privacy}`}>{copy.codesHint}</p>
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
