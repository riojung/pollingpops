"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SurveyResponses } from "@openround/contracts/surveys";
import { SurveyResponseControl } from "../../../components/survey-controls";
import { Brand } from "../../../components/brand";
import { useLocale } from "../../../components/locale-provider";
import { RoomPasswordInput } from "../../../components/room-password";
import { roomPasswordErrorKey } from "../../../lib/room-password";
import { apiFetch, humanError, ApiClientError } from "../../../lib/api";
import {
  surveyAccessToken,
  surveyMutationKey,
  type SurveyAttempt,
} from "../../../lib/survey-client";

export default function SurveyPlayer() {
  const id = useParams<{ id: string }>().id;
  const { locale, t } = useLocale();
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState<ReturnType<typeof roomPasswordErrorKey>>(null);
  const [attempt, setAttempt] = useState<SurveyAttempt | null>(null);
  const [responses, setResponses] = useState<SurveyResponses>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<{ final: boolean; body: string } | null>(null);
  const token = useRef("");
  const activeRoom = useRef(id);
  activeRoom.current = id;
  const joinRequest = useRef(0);
  function acceptAttempt(value: SurveyAttempt) {
    setAttempt(value);
    setResponses(value.responses);
    setPassword("");
    setPasswordRequired(false);
    setErrorKey(null);
  }
  async function join(event?: FormEvent, submittedPassword = password) {
    event?.preventDefault();
    const submittedRoomId = id;
    const requestId = ++joinRequest.current;
    const isCurrent = () =>
      activeRoom.current === submittedRoomId && joinRequest.current === requestId;
    setBusy(true);
    setError("");
    setErrorKey(null);
    try {
      const storageKey = `pollingpops:survey:${submittedRoomId}`;
      const joiningToken = window.localStorage.getItem(storageKey) || surveyAccessToken();
      token.current = joiningToken;
      // Save the room credential before admission so interrupted acknowledgements resume safely.
      window.localStorage.setItem(storageKey, joiningToken);
      const result = await apiFetch<{ attempt: SurveyAttempt }>(
        `/v1/survey-rooms/${submittedRoomId}/join`,
        {
          method: "POST",
          credentials: "omit",
          headers: { authorization: `Bearer ${joiningToken}` },
          body: JSON.stringify(submittedPassword ? { password: submittedPassword } : {}),
        },
      );
      if (isCurrent()) acceptAttempt(result.attempt);
    } catch (caught) {
      if (!isCurrent()) return;
      const key = roomPasswordErrorKey(caught);
      setErrorKey(key);
      if (key) setPasswordRequired(true);
      else setError(humanError(caught));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  async function load(isActive: () => boolean = () => true) {
    setError("");
    setErrorKey(null);
    try {
      token.current = window.localStorage.getItem(`pollingpops:survey:${id}`) ?? "";
      if (token.current) {
        try {
          const result = await apiFetch<{ attempt: SurveyAttempt }>(
            `/v1/survey-rooms/${id}/attempt`,
            {
              credentials: "omit",
              headers: { authorization: `Bearer ${token.current}` },
            },
          );
          if (isActive()) acceptAttempt(result.attempt);
          return;
        } catch (caught) {
          if (!(caught instanceof ApiClientError) || caught.code !== "UNAUTHORIZED") throw caught;
        }
      }
      const result = await apiFetch<{ room: { passwordRequired: boolean } }>(
        `/v1/survey-rooms/${id}/public`,
        { credentials: "omit" },
      );
      if (!isActive()) return;
      if (result.room.passwordRequired) setPasswordRequired(true);
      else await join(undefined, "");
    } catch (caught) {
      if (isActive()) setError(humanError(caught));
    }
  }
  useEffect(() => {
    let active = true;
    ++joinRequest.current;
    setBusy(false);
    setAttempt(null);
    setResponses({});
    setPassword("");
    setPasswordRequired(false);
    setErrorKey(null);
    setNotice("");
    pending.current = null;
    void load(() => active);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      ++joinRequest.current;
      window.clearInterval(timer);
    };
  }, [id]);
  const dirty = Boolean(attempt && JSON.stringify(attempt.responses) !== JSON.stringify(responses));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const closed = Boolean(
    attempt && (attempt.closed || new Date(attempt.closesAt).getTime() <= now),
  );
  async function save(final: boolean) {
    if (!attempt) return;
    setBusy(true);
    setError("");
    const operation = pending.current ?? {
      final,
      body: JSON.stringify({
        expectedRevision: attempt.revision,
        idempotencyKey: surveyMutationKey(),
        responses,
      }),
    };
    pending.current = operation;
    try {
      const result = await apiFetch<{ attempt: SurveyAttempt }>(
        `/v1/survey-rooms/${id}/${operation.final ? "submit" : "draft"}`,
        {
          method: "POST",
          credentials: "omit",
          headers: { authorization: `Bearer ${token.current}` },
          body: operation.body,
        },
      );
      setAttempt(result.attempt);
      setResponses(result.attempt.responses);
      setNotice(
        operation.final
          ? "Your responses were submitted."
          : "Progress saved. You can refresh or return on this browser.",
      );
      pending.current = null;
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pending.current = null;
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-shell" lang="en-CA" style={{ maxWidth: 760 }}>
      <Brand />
      <h1>{attempt?.content.title || "Self-paced Survey"}</h1>
      <p>
        Answer at your own pace. No account or alias is requested. Your facilitator sees
        question-level totals only after the run closes, with at least five responses per question.
        Your browser stores a room-only credential for resume; clear site data to remove it.
      </p>
      {passwordRequired && !attempt ? (
        <form onSubmit={(event) => void join(event)} lang={locale}>
          <RoomPasswordInput value={password} onChange={setPassword} disabled={busy} />
          <button className="button" type="submit" disabled={busy || !password}>
            {t(busy ? "live.protection.joining" : "live.protection.join")}
          </button>
        </form>
      ) : null}
      {errorKey ? (
        <p className="error" lang={locale} role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}{" "}
          {pending.current ? (
            <button type="button" disabled={busy} onClick={() => void save(pending.current!.final)}>
              Retry same operation
            </button>
          ) : (
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          )}
        </p>
      ) : null}
      <p role="status">{notice}</p>
      {attempt?.finalized ? (
        <section className="card">
          <h2>Thank you</h2>
          <p>
            This Survey is complete. Receipt: {attempt.receipt}. One completed attempt is allowed
            per room credential.
          </p>
        </section>
      ) : attempt ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(true);
          }}
        >
          <p>{attempt.content.description}</p>
          {closed ? (
            <p className="notice">
              This Survey is closed. You can view saved progress, but cannot change or submit it.
            </p>
          ) : null}
          {attempt.content.items.map((item) => (
            <section className="card" style={{ marginBottom: 20 }} key={item.question.id}>
              <SurveyResponseControl
                required={item.required}
                question={item.question}
                response={responses[item.question.id]}
                disabled={closed || busy || Boolean(pending.current)}
                onChange={(response) => {
                  setNotice("");
                  setResponses((current) => {
                    const next = { ...current };
                    if (response) next[item.question.id] = response;
                    else delete next[item.question.id];
                    return next;
                  });
                }}
              />
            </section>
          ))}
          <p>
            {dirty ? "Unsaved responses — save progress before leaving." : "Progress is saved."}
          </p>
          <button
            className="button-quiet"
            type="button"
            disabled={closed || busy || Boolean(pending.current) || !dirty}
            onClick={() => void save(false)}
          >
            Save progress
          </button>{" "}
          <button
            className="button"
            type="submit"
            disabled={closed || busy || Boolean(pending.current)}
          >
            Submit Survey
          </button>
        </form>
      ) : null}
      <p>
        <Link href="/join">Join another activity</Link>
      </p>
    </main>
  );
}
