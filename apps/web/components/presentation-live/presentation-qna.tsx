"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PresentationAudienceAvailability } from "@openround/contracts";
import { ApiClientError, humanError, isRetryableReadError } from "../../lib/api";
import { createInFlightRefreshCoalescer, createReadRetryScheduler } from "../../lib/refresh-queue";
import { createPresentationQnaClient } from "../../lib/presentation-qna";
import { createScopedAudienceSubscription } from "../../lib/scoped-audience-realtime";
import { clientUuid } from "../../lib/uuid";
import { QnaPanel } from "../qna-panel";
import { useLocale } from "../locale-provider";
import { localizeQnaModerationError, qnaModerationCopy } from "../../lib/i18n/qna-moderation-copy";
import styles from "./presentation-qna.module.css";

export function PresentationQnaPanel({
  sessionId,
  token,
  role,
  closed,
}: {
  sessionId: string;
  token: string;
  role: "host" | "participant" | "companion";
  closed: boolean;
}) {
  const { locale, t } = useLocale();
  const copy = qnaModerationCopy(locale);
  const [availability, setAvailability] = useState<PresentationAudienceAvailability | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const activationKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const availabilityRequest = useRef(0);
  const discoveryQueue = useRef(createInFlightRefreshCoalescer<void>());
  const discoveryRetry = useRef(createReadRetryScheduler());
  const client = useMemo(() => createPresentationQnaClient(sessionId, token), [sessionId, token]);

  const discover = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    const currentGeneration = generation.current;
    await discoveryQueue.current.run(
      `${sessionId}:${token}`,
      async () => {
        if (currentGeneration !== generation.current || inFlight.current) return;
        const requestId = ++availabilityRequest.current;
        discoveryRetry.current.clearPending();
        try {
          const next = await client.availability();
          if (
            requestId === availabilityRequest.current &&
            currentGeneration === generation.current
          ) {
            setAvailability(next);
            setError("");
            discoveryRetry.current.reset();
          }
        } catch (caught) {
          if (requestId !== availabilityRequest.current || currentGeneration !== generation.current)
            return;
          if (caught instanceof ApiClientError && caught.status === 404) {
            discoveryRetry.current.reset();
            setAvailability(null);
            setError("");
            return;
          }
          setError(humanError(caught));
          if (isRetryableReadError(caught)) {
            discoveryRetry.current.schedule(() => {
              if (currentGeneration === generation.current) void discover();
            });
          } else {
            discoveryRetry.current.reset();
            setAvailability(null);
          }
        }
      },
      true,
    );
  }, [client, sessionId, token]);

  useEffect(() => {
    generation.current += 1;
    activationKey.current = null;
    discoveryRetry.current.reset();
    inFlight.current = false;
    setAvailability(null);
    setError("");
    setBusy(false);
    setOpen(false);
    setHasOpened(false);
    void discover();
    return () => {
      generation.current += 1;
      availabilityRequest.current += 1;
      discoveryRetry.current.reset();
    };
  }, [client, discover]);

  useEffect(() => {
    if (!availability?.available || availability.activated || closed) return;
    // Stop discovery polling once active; audience notices handle subsequent changes.
    const timer = window.setInterval(() => void discover(), 5_000);
    return () => window.clearInterval(timer);
  }, [availability?.available, availability?.activated, closed, discover]);

  useEffect(() => {
    if (!availability?.activated || !open) return;
    let refreshTimer: number | null = null;
    const refresh = () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        setRevision((value) => value + 1);
      }, 100);
    };
    const subscription = createScopedAudienceSubscription({
      scopeId: sessionId,
      token,
      onRefresh: refresh,
      onAccessDenied: () => {
        discoveryRetry.current.reset();
        setAvailability(null);
        setError(
          "Q&A access has expired. Rejoin the Presentation or reacquire your host/Companion pass.",
        );
      },
    });
    const timer = window.setInterval(() => {
      if (subscription.needsPolling()) refresh();
    }, 3_000);
    return () => {
      window.clearInterval(timer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      subscription.stop();
    };
  }, [availability?.activated, open, sessionId, token]);

  useEffect(() => {
    setRevision((value) => value + 1);
  }, [closed]);

  async function activate() {
    if (!availability?.canActivate || inFlight.current) return;
    inFlight.current = true;
    discoveryRetry.current.reset();
    availabilityRequest.current += 1;
    const currentGeneration = generation.current;
    activationKey.current ??= clientUuid();
    setBusy(true);
    setError("");
    try {
      await client.activate(activationKey.current);
      if (currentGeneration !== generation.current) return;
      setAvailability({ schemaVersion: 1, available: true, activated: true, canActivate: false });
      setOpen(true);
      setHasOpened(true);
    } catch (caught) {
      if (currentGeneration === generation.current) setError(humanError(caught));
    } finally {
      if (currentGeneration === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  if (!availability?.available && !error) return null;
  const displayError = localizeQnaModerationError(locale, error);
  return (
    <div
      className={`${styles.container} ${role === "companion" ? styles.compact : ""}`}
      data-presentation-qna
      lang={locale}
    >
      {error ? (
        <>
          <p className="error" lang={displayError.language} role="alert">
            {displayError.text}
          </p>
          <button type="button" className="button-quiet" onClick={() => void discover()}>
            {t("live.qna.refresh")}
          </button>
        </>
      ) : null}
      {availability?.activated ? (
        <details
          open={open}
          onToggle={(event) => {
            setOpen(event.currentTarget.open);
            if (event.currentTarget.open) setHasOpened(true);
          }}
        >
          <summary className={styles.toggle}>{t("live.qna.title")}</summary>
          {hasOpened ? (
            <>
              {role === "companion" ? (
                <p className="notice">
                  {copy("Companion Q&A is read-only. Use the host window to moderate questions.")}
                </p>
              ) : null}
              <QnaPanel
                role={
                  role === "host" ? "moderator" : role === "companion" ? "observer" : "participant"
                }
                sessionId={sessionId}
                token={token}
                revision={revision}
                scopeKind="presentation"
              />
            </>
          ) : null}
        </details>
      ) : availability?.canActivate ? (
        <div className="panel">
          <h2>{t("live.qna.title")}</h2>
          <p>
            {copy(
              "Open a moderated question space alongside this Presentation. Companion access is read-only.",
            )}
          </p>
          <button
            className="button"
            type="button"
            disabled={busy || closed}
            onClick={() => void activate()}
          >
            {copy(busy ? "Activating Q&A…" : "Activate audience Q&A")}
          </button>
        </div>
      ) : availability?.available ? (
        <p className="notice">
          {copy("Audience Q&A will appear when the facilitator activates it.")}
        </p>
      ) : null}
    </div>
  );
}
