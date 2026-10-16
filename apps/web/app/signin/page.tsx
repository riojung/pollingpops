"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { OidcStatus, PublicFeatures } from "@openround/contracts";
import { Brand } from "../../components/brand";
import { useLocale } from "../../components/locale-provider";
import { LocalizedPolicyConsent } from "../../components/localized-policy-consent";
import { apiFetch, humanError } from "../../lib/api";
import { resolveSignInEnvironment, type SignInEnvironment } from "../../lib/signin-environment";
import {
  LogoutWarningNotice,
  useManagementNavigation,
} from "../../components/management-navigation";

export default function SignInPage() {
  const { t } = useLocale();
  const management = useManagementNavigation();
  const [email, setEmail] = useState("");
  const [segment, setSegment] = useState<"education" | "workplace">("workplace");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [debugUrl, setDebugUrl] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [oidcStatus, setOidcStatus] = useState<OidcStatus | null>(null);
  const [federatedBusy, setFederatedBusy] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [publicFeatures, setPublicFeatures] = useState<PublicFeatures | null>(null);
  const [signInEnvironment, setSignInEnvironment] = useState<SignInEnvironment | null>(null);

  useEffect(() => {
    setHydrated(true);
    const workspaceId = new URLSearchParams(window.location.search).get("workspaceId");
    const requestedReturn = new URLSearchParams(window.location.search).get("returnTo");
    if (requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")) {
      setReturnTo(requestedReturn);
    }
    if (!workspaceId) return;
    apiFetch<OidcStatus>(`/v1/auth/oidc/status?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(setOidcStatus)
      .catch(() => setOidcStatus(null));
  }, []);

  useEffect(() => {
    let active = true;
    const currentLocation = window.location.href;
    apiFetch<PublicFeatures>("/v1/features")
      .then((features) => {
        if (!active) return;
        setPublicFeatures(features);
        setSignInEnvironment(resolveSignInEnvironment(features.publicWebUrl, currentLocation));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submittedEmail = email.trim().toLowerCase();
    setStatus("sending");
    setError("");
    try {
      const result = await apiFetch<{
        accepted: boolean;
        debugUrl?: string;
        signInOrigin?: string;
      }>("/v1/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({
          email: submittedEmail,
          segment,
          acceptPolicies,
          ...(returnTo ? { returnTo } : {}),
        }),
      });
      if (result.signInOrigin) {
        const environment = resolveSignInEnvironment(result.signInOrigin, window.location.href);
        if (environment) setSignInEnvironment(environment);
      }
      setDebugUrl(result.debugUrl ?? "");
      setSentEmail(submittedEmail);
      setStatus("sent");
    } catch (caught) {
      setError(humanError(caught));
      setStatus("idle");
    }
  }

  async function signInWithInstitution() {
    if (!oidcStatus?.enabled) return;
    setFederatedBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ authorizationUrl: string }>("/v1/auth/oidc/start", {
        method: "POST",
        body: JSON.stringify({ workspaceId: oidcStatus.workspaceId, mode: "login" }),
      });
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(humanError(caught));
      setFederatedBusy(false);
    }
  }

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link href="/join">{t("delivery.site.joinRound")}</Link>
      </header>
      <main className="shell auth-wrap">
        <section className="join-card auth-card" aria-labelledby="signin-title">
          <p className="eyebrow">{t("delivery.auth.creatorAccess")}</p>
          <h1 id="signin-title" style={{ fontSize: "clamp(2.4rem, 8vw, 4rem)" }}>
            {t("delivery.auth.signInTitle")}
          </h1>
          <p className="muted">{t("delivery.auth.signInDescription")}</p>
          <LogoutWarningNotice navigation={management} />
          {signInEnvironment?.originMismatch ? (
            <div className="notice" role="status">
              <strong>Use the configured address to sign in.</strong>
              <p>
                This page is open at{" "}
                <span className="auth-origin">{signInEnvironment.currentOrigin}</span>, but sign-in
                links and browser cookies use{" "}
                <span className="auth-origin">{signInEnvironment.configuredOrigin}</span>.
              </p>
              <a
                className="button-quiet small-button auth-status-action"
                href={signInEnvironment.configuredSignInUrl}
              >
                Open the configured sign-in page
              </a>
            </div>
          ) : null}
          {oidcStatus?.enabled ? (
            <div className="institution-signin">
              <button
                className="button full-width"
                disabled={federatedBusy}
                onClick={() => void signInWithInstitution()}
                type="button"
              >
                {federatedBusy
                  ? "Opening institution sign-in…"
                  : `Continue with ${oidcStatus.providerName}`}
              </button>
              <p className="muted">
                This works after you explicitly link your institution identity in Polling Pops. An
                email match alone will never link accounts.
              </p>
              <div className="auth-divider" aria-hidden="true">
                <span>or use email</span>
              </div>
            </div>
          ) : null}
          <form onSubmit={submit}>
            <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="field-label" style={{ marginBottom: 8 }}>
                {t("delivery.auth.facilitate")}
              </legend>
              <div className="segmented">
                <button
                  aria-pressed={segment === "workplace"}
                  disabled={!hydrated}
                  onClick={() => setSegment("workplace")}
                  type="button"
                >
                  {t("delivery.auth.workplace")}
                </button>
                <button
                  aria-pressed={segment === "education"}
                  disabled={!hydrated}
                  onClick={() => setSegment("education")}
                  type="button"
                >
                  {t("delivery.auth.education")}
                </button>
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="email">{t("delivery.auth.email")}</label>
              <input
                autoComplete="email"
                className="input"
                disabled={!hydrated}
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <label className="checkbox-field policy-consent">
              <input
                checked={acceptPolicies}
                disabled={!hydrated}
                onChange={(event) => setAcceptPolicies(event.target.checked)}
                required
                type="checkbox"
              />
              <LocalizedPolicyConsent />
            </label>
            {error ? (
              <p className="error" lang="en-CA" role="alert">
                {error}
              </p>
            ) : null}
            {status === "sent" ? (
              <div className="success" role="status">
                {debugUrl ? (
                  <div lang="en-CA" style={{ marginTop: 10 }}>
                    Your local sign-in link is ready. <a href={debugUrl}>Continue to dashboard</a>.
                  </div>
                ) : publicFeatures?.developmentEmailInboxUrl ? (
                  <div>
                    <strong>Your local sign-in email is ready.</strong>
                    <p>
                      Open the development inbox and select the newest message sent to {sentEmail}.
                      The link expires in 15 minutes and can be used once.
                    </p>
                    <a
                      className="button-quiet small-button auth-status-action"
                      href={publicFeatures.developmentEmailInboxUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open local email inbox
                    </a>
                    {signInEnvironment?.originMismatch ? (
                      <p>
                        The email signs you in at{" "}
                        <span className="auth-origin">{signInEnvironment.configuredOrigin}</span>.
                        Continue using that address after opening the link.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  `A sign-in email was sent to ${sentEmail}. Open the newest message within 15 minutes.`
                )}
              </div>
            ) : null}
            <button
              className="button full-width"
              disabled={!hydrated || !acceptPolicies || status === "sending"}
              type="submit"
            >
              {status === "sending" ? t("delivery.auth.sending") : t("delivery.auth.sendLink")}
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
