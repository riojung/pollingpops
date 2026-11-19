"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { surveyPageViews } from "@openround/contracts/surveys";
import { SurveyResponseControl } from "../../../components/survey-controls";
import { SurveyPagedReader } from "../../../components/survey-paged-reader";
import { Brand } from "../../../components/brand";
import { useLocale } from "../../../components/locale-provider";
import { RoomPasswordInput } from "../../../components/room-password";
import { roomPasswordErrorKey } from "../../../lib/room-password";
import { apiFetch, humanError } from "../../../lib/api";
import { surveyPagesCopy } from "../../../lib/i18n/survey-pages-copy";
import {
  createSurveyParticipantSession,
  initialSurveyParticipantSnapshot,
} from "../../../lib/survey-client";

export default function SurveyPlayer() {
  const id = useParams<{ id: string }>().id;
  const { locale, t } = useLocale();
  const copy = surveyPagesCopy(locale);
  const scopeRef = useRef({ id });
  if (scopeRef.current.id !== id) scopeRef.current = { id };
  const scope = scopeRef.current;
  const [stored, setStored] = useState({ scope, value: initialSurveyParticipantSnapshot() });
  const [password, setPassword] = useState("");
  const [now, setNow] = useState(Date.now());
  const sessionRef = useRef<{
    scope: typeof scope;
    value: ReturnType<typeof createSurveyParticipantSession>;
  } | null>(null);
  const state = stored.scope === scope ? stored.value : initialSurveyParticipantSnapshot();
  const attempt = state.attempt;
  const paged = attempt?.content.schemaVersion === 3;
  const busy = state.loading || state.saving;
  const dirty = Boolean(
    attempt && JSON.stringify(attempt.responses) !== JSON.stringify(state.responses),
  );
  const closed = Boolean(attempt && (attempt.closed || Date.parse(attempt.closesAt) <= now));
  const errorKey = roomPasswordErrorKey(state.error);
  const updateRequired =
    (state.error as { code?: string } | null)?.code === "SURVEY_CLIENT_UPDATE_REQUIRED";
  function session() {
    return scopeRef.current === scope && sessionRef.current?.scope === scope
      ? sessionRef.current.value
      : null;
  }
  useEffect(() => {
    setPassword("");
    const value = createSurveyParticipantSession({
      roomId: id,
      request: apiFetch,
      storage: {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      },
      current: () => scopeRef.current === scope,
      changed: (value) => setStored({ scope, value }),
    });
    sessionRef.current = { scope, value };
    void value.load();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const warn = (event: BeforeUnloadEvent) => {
      if (value.dirty() || value.snapshot().pending) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      value.dispose();
      if (sessionRef.current?.value === value) sessionRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [id, scope]);
  async function join(event: FormEvent) {
    event.preventDefault();
    const current = session();
    if (!current) return;
    await current.join(password);
    if (session() === current && current.snapshot().attempt) setPassword("");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (paged && attempt && state.pageIndex < surveyPageViews(attempt.content).length - 1)
      void session()?.next();
    else void session()?.save(true);
  }
  const notice =
    state.notice === "submitted"
      ? paged
        ? copy.submitted
        : "Your responses were submitted."
      : state.notice === "saved"
        ? paged
          ? copy.saved
          : "Progress saved. You can refresh or return on this browser."
        : state.saving && paged
          ? copy.saving
          : "";
  return (
    <main className="page-shell" lang={paged ? locale : "en-CA"} style={{ maxWidth: 760 }}>
      <Brand />
      <h1 lang="">{attempt?.content.title || "Self-paced Survey"}</h1>
      <p lang="en-CA">
        Answer at your own pace. No account or alias is requested. Your facilitator sees
        question-level totals only after the run closes, with at least five responses per question.
        Your browser stores a room-only credential for resume; clear site data to remove it.
      </p>
      {state.passwordRequired && !attempt ? (
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
      {state.error && !errorKey ? (
        <div className="error" role="alert">
          <p lang={updateRequired || (paged && state.pending) ? locale : "en-CA"}>
            {updateRequired
              ? copy.updateRequired
              : paged && state.pending
                ? copy.saveError
                : humanError(state.error)}
          </p>
          {state.pending ? (
            <button type="button" disabled={busy} onClick={() => void session()?.retry()}>
              {paged ? copy.retrySave : "Retry same operation"}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void session()?.load()}>
              Retry
            </button>
          )}
        </div>
      ) : null}
      <p role="status">{notice}</p>
      {attempt?.finalized ? (
        <section className="card">
          <h2 lang="en-CA">Thank you</h2>
          <p lang="en-CA">
            This Survey is complete. Receipt: {attempt.receipt}. One completed attempt is allowed
            per room credential.
          </p>
        </section>
      ) : attempt ? (
        <form onSubmit={submit}>
          <p lang="">{attempt.content.description}</p>
          {closed ? (
            <p className="notice">
              {paged
                ? copy.closed
                : "This Survey is closed. You can view saved progress, but cannot change or submit it."}
            </p>
          ) : null}
          {paged ? (
            <>
              <p className="muted">{copy.resumeHint}</p>
              <SurveyPagedReader
                content={attempt.content}
                responses={closed ? attempt.responses : state.responses}
                pageIndex={state.pageIndex}
                locale={locale}
                locked={busy || state.pending}
                closed={closed}
                validation={state.validation}
                validationRevision={state.validationRevision}
                dirty={dirty}
                onChange={(id, response) => session()?.change(id, response)}
                onBack={() => session()?.back()}
                onNext={() => void session()?.next()}
                onSave={() => void session()?.save(false)}
                onSubmit={() => void session()?.save(true)}
              />
            </>
          ) : (
            <>
              {attempt.content.items.map((item) => (
                <section className="card" style={{ marginBottom: 20 }} key={item.question.id}>
                  <SurveyResponseControl
                    required={item.required}
                    question={item.question}
                    response={state.responses[item.question.id]}
                    disabled={closed || busy || state.pending}
                    onChange={(response) => session()?.change(item.question.id, response)}
                  />
                </section>
              ))}
              <button
                className="button-quiet"
                type="button"
                disabled={closed || busy || state.pending || !dirty}
                onClick={() => void session()?.save(false)}
              >
                Save progress
              </button>{" "}
              <button className="button" type="submit" disabled={closed || busy || state.pending}>
                Submit Survey
              </button>
            </>
          )}
          <p>
            {dirty
              ? paged
                ? copy.unsaved
                : "Unsaved responses — save progress before leaving."
              : paged
                ? copy.savedAll
                : "Progress is saved."}
          </p>
        </form>
      ) : null}
      <p lang="en-CA">
        <Link href="/join">Join another activity</Link>
      </p>
    </main>
  );
}
