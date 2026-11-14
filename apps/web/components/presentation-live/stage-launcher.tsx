"use client";

import { useEffect, useRef, useState } from "react";
import { PresentationStagePassResponseSchema } from "@openround/contracts";
import { apiFetch, ApiClientError, humanError } from "../../lib/api";
import { isolatePresentationCompanionWindow } from "../../lib/presentation-companion-pass";
import { presentationStageLaunchUrl } from "../../lib/presentation-stage-pass";
import { useLocale } from "../locale-provider";
import { presentationWorkspaceCopy } from "../../lib/i18n/presentation-workspace-copy";
import styles from "./presentation-delivery.module.css";

export function PresentationStageLauncher({
  sessionId,
  canEdit,
  finished,
}: {
  sessionId: string;
  canEdit: boolean;
  finished: boolean;
}) {
  const { locale } = useLocale();
  const copy = presentationWorkspaceCopy(locale);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [staleRevocation, setStaleRevocation] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const key = `openround:presentation-stage-credential:${sessionId}`;
  useEffect(() => {
    mounted.current = true;
    try {
      setCredentialId(sessionStorage.getItem(key));
    } catch {
      /* A pass can still be revoked in this visit. */
    }
    return () => {
      mounted.current = false;
    };
  }, [key]);
  if (!canEdit) return null;

  async function launch() {
    if (inFlight.current || finished) return;
    inFlight.current = true;
    setBusy(true);
    setFallback(null);
    setError("");
    setStaleRevocation(false);
    let popup: Window | null = null;
    try {
      popup = isolatePresentationCompanionWindow(
        window.open("about:blank", "_blank", "popup,width=1280,height=800"),
      );
      const pass = PresentationStagePassResponseSchema.parse(
        await apiFetch(`/v1/presentation-sessions/${sessionId}/stage-pass`, { method: "POST" }),
      );
      if (!mounted.current) {
        popup?.close();
        return;
      }
      setCredentialId(pass.credentialId);
      try {
        sessionStorage.setItem(key, pass.credentialId);
      } catch {
        /* Optional refresh convenience. */
      }
      const url = presentationStageLaunchUrl(window.location.origin, sessionId, pass.stageToken);
      if (popup && !popup.closed) popup.location.replace(url);
      else setFallback(url);
    } catch (caught) {
      popup?.close();
      if (mounted.current) setError(humanError(caught));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function revoke() {
    if (inFlight.current || !credentialId) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setStaleRevocation(false);
    try {
      await apiFetch(`/v1/presentation-sessions/${sessionId}/stage-passes/${credentialId}`, {
        method: "DELETE",
      });
      if (!mounted.current) return;
      setCredentialId(null);
      setFallback(null);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Server revocation is authoritative. */
      }
    } catch (caught) {
      if (mounted.current) {
        setError(humanError(caught));
        setStaleRevocation(caught instanceof ApiClientError && caught.status === 409);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section aria-label={copy("Audience stage controls")} className={styles.launch} lang={locale}>
      <button
        type="button"
        className="button-quiet full-width"
        disabled={busy || finished}
        onClick={() => void launch()}
      >
        {copy(busy ? "Updating stage access…" : "Open audience stage")}
      </button>
      <p>
        {copy(
          "Share the audience stage window. Presenter notes and controls stay in this workspace.",
        )}
      </p>
      {fallback ? (
        <>
          <p role="status">
            {copy(
              "Your browser blocked the stage window. Open it using this link, then share that tab.",
            )}
          </p>
          <a href={fallback} target="_blank" rel="noopener noreferrer">
            {copy("Open audience stage in a new tab")}
          </a>
        </>
      ) : null}
      {credentialId ? (
        <button
          type="button"
          className="button-quiet full-width"
          disabled={busy}
          onClick={() => void revoke()}
        >
          {copy("Revoke audience stage access")}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="error" lang="en-CA">
          {error}
        </p>
      ) : null}
      {staleRevocation ? (
        <p>
          {copy(
            "Use the host tab that opened the current stage, or open a replacement stage here and then revoke it.",
          )}
        </p>
      ) : null}
    </section>
  );
}
