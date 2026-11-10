"use client";

import { useEffect, useRef, useState } from "react";
import { PresentationCompanionPassResponseSchema } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { localizeCompanionError } from "../../lib/i18n/domains/live-delivery/companion-translations";
import {
  isolatePresentationCompanionWindow,
  presentationCompanionLaunchUrl,
} from "../../lib/presentation-companion-pass";

export function PresentationCompanionLauncher({
  sessionId,
  enabled,
  canEdit,
}: {
  sessionId: string;
  enabled: boolean;
  canEdit: boolean;
}) {
  const { locale, t } = useLocale();
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const launchUrl = useRef<string | null>(null);
  const credentialKey = `openround:presentation-companion-credential:${sessionId}`;
  const displayError = localizeCompanionError(locale, error);

  useEffect(() => {
    setCredentialId(sessionStorage.getItem(credentialKey));
    launchUrl.current = null;
    setBlocked(false);
  }, [credentialKey]);

  if (!canEdit || (!enabled && !credentialId)) return null;

  async function launch() {
    if (inFlight.current || !enabled) return;
    // Reserve the popup during the click. Detach its opener before loading the scoped pass.
    const popup = isolatePresentationCompanionWindow(
      window.open("about:blank", "_blank", "popup,width=420,height=720"),
    );
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const pass = PresentationCompanionPassResponseSchema.parse(
        await apiFetch(`/v1/presentation-sessions/${sessionId}/companion-pass`, { method: "POST" }),
      );
      setCredentialId(pass.credentialId);
      sessionStorage.setItem(credentialKey, pass.credentialId);
      launchUrl.current = presentationCompanionLaunchUrl(
        window.location.origin,
        sessionId,
        pass.companionToken,
      );
      if (popup && !popup.closed) {
        popup.location.replace(launchUrl.current);
        setBlocked(false);
      } else {
        setBlocked(true);
      }
    } catch (caught) {
      popup?.close();
      setError(humanError(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function revoke() {
    if (inFlight.current || !credentialId) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/v1/presentation-sessions/${sessionId}/companion-passes/${credentialId}`, {
        method: "DELETE",
      });
      launchUrl.current = null;
      sessionStorage.removeItem(credentialKey);
      setCredentialId(null);
      setBlocked(false);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-label={t("live.companion.title")} lang={locale}>
      {enabled ? (
        <button
          className="button-quiet full-width"
          disabled={busy}
          onClick={() => void launch()}
          type="button"
        >
          {busy ? t("live.common.updating") : t("live.companion.launch")}
        </button>
      ) : null}
      {blocked && launchUrl.current ? (
        <>
          <p className="muted" role="status">
            {t("live.companion.popupBlocked")}
          </p>
          <button
            className="button-quiet full-width"
            disabled={busy}
            onClick={() => {
              if (launchUrl.current)
                window.open(
                  launchUrl.current,
                  "_blank",
                  "noopener,noreferrer,popup,width=420,height=720",
                );
            }}
            type="button"
          >
            {t("live.companion.openWindow")}
          </button>
        </>
      ) : null}
      {credentialId ? (
        <button
          className="button-quiet full-width"
          disabled={busy}
          onClick={() => void revoke()}
          type="button"
        >
          {t("live.companion.revoke")}
        </button>
      ) : null}
      {error ? (
        <p className="error" role="alert" lang={displayError.language}>
          {displayError.text}
        </p>
      ) : null}
    </section>
  );
}
