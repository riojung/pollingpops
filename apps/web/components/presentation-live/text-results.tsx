"use client";

import { useEffect, useState } from "react";
import type { PresentationTextResponseResults } from "@openround/contracts";
import { humanError } from "../../lib/api";
import { currentTextRead, type TextReadState } from "../../lib/text-response-client";
import { readPresentationTextResults } from "../../lib/presentation-text-client";
import { useLocale } from "../locale-provider";
import { TextResultsView } from "../text-results-view";
import styles from "./text-results.module.css";

export interface PresentationTextResultsProps {
  sessionId: string;
  blockId: string;
  type: "open_text" | "word_cloud";
  revision: number;
  seq: number;
  phase: string;
  projection: "creator" | "host" | "participant" | "companion" | "stage";
  credential?: string;
  compact?: boolean;
}

export function PresentationTextResults({
  sessionId,
  blockId,
  type,
  revision,
  seq,
  phase,
  projection,
  credential = "",
  compact = false,
}: PresentationTextResultsProps) {
  const { locale, t } = useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<TextReadState<PresentationTextResponseResults> | null>(null);
  const enabled = ["question_reveal", "intervention", "finished"].includes(phase);
  const authorized = projection === "creator" || Boolean(credential);
  const key = JSON.stringify([
    sessionId,
    blockId,
    type,
    revision,
    seq,
    phase,
    projection,
    cursor,
    retry,
  ]);
  const current = currentTextRead(state, key, credential);
  useEffect(() => {
    setCursor(null);
    setHistory([]);
  }, [sessionId, blockId, type, revision, seq, projection, credential]);
  useEffect(() => {
    setState({ key, credential, data: null, error: "" });
    if (!enabled || !authorized) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void readPresentationTextResults({
        sessionId,
        blockId,
        type,
        revision,
        seq,
        projection,
        credential,
        cursor,
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setState({ key, credential, data, error: "" });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          if ((error as { status?: number }).status === 409 && cursor) {
            setCursor(null);
            setHistory([]);
          }
          setState({ key, credential, data: null, error: humanError(error) });
        });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    sessionId,
    blockId,
    type,
    revision,
    seq,
    phase,
    projection,
    credential,
    cursor,
    retry,
    key,
    enabled,
    authorized,
  ]);

  return (
    <section
      lang={locale}
      className={`${styles.results}${compact ? ` ${styles.compact}` : ""}`}
      aria-label={t("live.text.approvedResults")}
    >
      <h2>{t("live.text.approvedResults")}</h2>
      {!authorized ? (
        <p role="status">{t("live.text.connectionRequired")}</p>
      ) : !enabled || current?.data?.visible === false ? (
        <p className="muted">{t("live.text.publicThreshold")}</p>
      ) : current?.error ? (
        <p className="error" role="alert" lang="en-CA">
          {current.error}
        </p>
      ) : !current?.data ? (
        <p role="status">{t("live.text.loading")}</p>
      ) : (
        <TextResultsView
          type={type}
          compact={compact}
          respondents={current.data.approvedRespondents}
          items={current.data.items.map((item, index) => ({
            answerId: `${key}:${index}`,
            body: item.textValue,
          }))}
          terms={current.data.terms}
        />
      )}
      {enabled && authorized ? (
        <div className="button-row">
          <button
            className="button-quiet small-button"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("live.text.refresh")}
          </button>
          {current?.data?.visible ? (
            <>
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
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
