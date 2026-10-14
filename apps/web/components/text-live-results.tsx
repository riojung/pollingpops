"use client";

import { useEffect, useState } from "react";
import {
  currentRoundClientCapabilities,
  RoundTextResponseResultsSchema,
} from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import {
  currentTextRead,
  type TextReadState,
  type TextResponseResults,
} from "../lib/text-response-client";
import { useLocale } from "./locale-provider";
import { TextResultsView } from "./text-results-view";

export function TextLiveResults({
  sessionId,
  roundId,
  version,
  phase,
  credential,
  role,
  freshness = 0,
  headingLevel = 2,
}: {
  sessionId: string;
  roundId: string;
  version: number;
  phase: string;
  credential: string;
  freshness?: number;
  headingLevel?: 2 | 3;
  role: "host" | "presenter" | "participant";
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const { locale, t } = useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<TextReadState<TextResponseResults> | null>(null);
  const enabled = Boolean(
    credential && ["question_reveal", "leaderboard", "finished"].includes(phase),
  );
  const key = JSON.stringify([sessionId, roundId, version, phase, role, cursor, retry, freshness]);
  const current = currentTextRead(state, key, credential);

  useEffect(() => {
    setCursor(null);
    setHistory([]);
  }, [sessionId, roundId, version, credential]);
  useEffect(() => {
    setState({ key, credential, data: null, error: "" });
    if (!enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        roundId,
        role,
        limit: "50",
        clientCapabilities: JSON.stringify(currentRoundClientCapabilities()),
        ...(cursor ? { cursor } : {}),
      });
      void apiFetch<TextResponseResults>(`/v1/sessions/${sessionId}/response-results?${query}`, {
        headers: { authorization: `Bearer ${credential}` },
        signal: controller.signal,
        cache: "no-store",
      })
        .then((data) => {
          if (!controller.signal.aborted)
            setState({
              key,
              credential,
              data: RoundTextResponseResultsSchema.parse(data),
              error: "",
            });
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            if ((error as { status?: number }).status === 409 && cursor) {
              setCursor(null);
              setHistory([]);
            }
            setState({ key, credential, data: null, error: humanError(error) });
          }
        });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId, roundId, version, phase, credential, role, cursor, retry, enabled, key]);

  return (
    <section
      lang={locale}
      className="distribution-card"
      aria-label={t("live.text.approvedResults")}
    >
      <Heading style={{ fontSize: "1.2rem" }}>{t("live.text.approvedResults")}</Heading>
      {!credential ? (
        <p role="status">{t("live.text.connectionRequired")}</p>
      ) : !enabled || current?.data?.visible === false ? (
        <p className="muted">{t("live.text.publicThreshold")}</p>
      ) : current?.error ? (
        <>
          <p className="error" role="alert" lang="en-CA">
            {current.error}
          </p>
          <button
            className="button-quiet"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("live.text.refresh")}
          </button>
        </>
      ) : !current?.data ? (
        <p role="status">{t("live.text.loading")}</p>
      ) : (
        <TextResultsView
          type={current.data.type}
          respondents={current.data.approvedRespondents}
          items={current.data.items}
          terms={current.data.terms}
        />
      )}
      {current?.data?.visible ? (
        <div className="button-row">
          <button
            className="button-quiet small-button"
            type="button"
            disabled={!history.length}
            onClick={() => {
              setCursor(history.at(-1) ?? null);
              setHistory((pages) => pages.slice(0, -1));
            }}
          >
            {t("live.text.previousPage")}
          </button>
          <button
            className="button-quiet small-button"
            type="button"
            disabled={!current.data.nextCursor}
            onClick={() => {
              setHistory((pages) => [...pages, cursor]);
              setCursor(current.data!.nextCursor);
            }}
          >
            {t("live.text.nextPage")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
