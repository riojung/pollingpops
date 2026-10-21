"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { OidcStartSchema, type OidcStatus, type PublicFeatures } from "@openround/contracts";
import { Brand } from "../../components/brand";
import { useLocale } from "../../components/locale-provider";
import { LocalizedPolicyConsent } from "../../components/localized-policy-consent";
import { apiFetch, humanError } from "../../lib/api";
import { resolveSignInEnvironment, type SignInEnvironment } from "../../lib/signin-environment";
import {
  LogoutWarningNotice,
  useManagementNavigation,
} from "../../components/management-navigation";

type EmailFlow =
  | { step: "email" }
  | { step: "verification-sent"; email: string }
  | {
      step: "pin";
      email: string;
      challengeId: string;
      expiresAt: number;
      resendAt: number;
    };

interface PinRequestResponse {
  accepted: boolean;
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export default function SignInPage() {
  const { t } = useLocale();
  const management = useManagementNavigation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [segment, setSegment] = useState<"education" | "workplace">("workplace");
  const [flow, setFlow] = useState<EmailFlow>({ step: "email" });
  const [busy, setBusy] = useState<"sending" | "verifying" | null>(null);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [verified, setVerified] = useState(false);
  const [oidcStatus, setOidcStatus] = useState<OidcStatus | null>(null);
  const [federatedBusy, setFederatedBusy] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [publicFeatures, setPublicFeatures] = useState<PublicFeatures | null>(null);
  const [signInEnvironment, setSignInEnvironment] = useState<SignInEnvironment | null>(null);
  const [pin, setPin] = useState("");
  const [now, setNow] = useState(0);
  const emailInput = useRef<HTMLInputElement>(null);
  const pinInput = useRef<HTMLInputElement>(null);
  const verificationNotice = useRef<HTMLDivElement>(null);
  const pending = busy !== null || federatedBusy;

  useEffect(() => {
    setHydrated(true);
    const query = new URLSearchParams(window.location.search);
    const requestedWorkspace = OidcStartSchema.shape.workspaceId.safeParse(
      query.get("workspaceId"),
    );
    const requestedReturn = query.get("returnTo");
    if (requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")) {
      setReturnTo(requestedReturn);
    }
    setVerified(query.get("verified") === "1");
    if (!requestedWorkspace.success) return;
    setWorkspaceId(requestedWorkspace.data);
    apiFetch<OidcStatus>(
      `/v1/auth/oidc/status?workspaceId=${encodeURIComponent(requestedWorkspace.data)}`,
    )
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

  useEffect(() => {
    if (flow.step !== "pin") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [flow]);

  useEffect(() => {
    if (!hydrated || pending) return;
    if (flow.step === "pin") pinInput.current?.focus();
    else if (flow.step === "verification-sent" || verified) verificationNotice.current?.focus();
    else emailInput.current?.focus();
  }, [flow, hydrated, mode, pending, verified, error]);

  function changeMode(nextMode: "signin" | "signup") {
    setMode(nextMode);
    setFlow({ step: "email" });
    setPin("");
    setError("");
    setAcceptPolicies(false);
    setVerified(false);
  }

  async function requestPin(submittedEmail: string) {
    const result = await apiFetch<PinRequestResponse>("/v1/auth/pin/request", {
      method: "POST",
      body: JSON.stringify({
        email: submittedEmail,
        acceptPolicies,
        ...(returnTo ? { returnTo } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      }),
    });
    const requestedAt = Date.now();
    setNow(requestedAt);
    setPin("");
    setFlow({
      step: "pin",
      email: submittedEmail,
      challengeId: result.challengeId,
      expiresAt: requestedAt + result.expiresInSeconds * 1000,
      resendAt: requestedAt + result.resendAfterSeconds * 1000,
    });
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    if (!hydrated || !acceptPolicies || pending) return;
    const submittedEmail = email.trim().toLowerCase();
    setBusy("sending");
    setError("");
    try {
      if (mode === "signup") {
        await apiFetch("/v1/auth/email-verification", {
          method: "POST",
          body: JSON.stringify({
            email: submittedEmail,
            segment,
            acceptPolicies,
            ...(returnTo ? { returnTo } : {}),
          }),
        });
        setFlow({ step: "verification-sent", email: submittedEmail });
      } else {
        await requestPin(submittedEmail);
      }
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function resendPin() {
    if (flow.step !== "pin" || pending || Date.now() < flow.resendAt) return;
    setBusy("sending");
    setError("");
    try {
      await requestPin(flow.email);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function verifyPin(event: FormEvent) {
    event.preventDefault();
    if (flow.step !== "pin" || pending || !/^\d{6}$/.test(pin)) return;
    setBusy("verifying");
    setError("");
    try {
      const result = await apiFetch<{ redirectTo: string }>("/v1/auth/pin/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId: flow.challengeId, pin }),
      });
      window.location.replace(result.redirectTo);
    } catch (caught) {
      setError(
        (caught as { status?: number }).status === 401
          ? t("delivery.auth.invalidPin")
          : humanError(caught),
      );
      setBusy(null);
      pinInput.current?.focus();
    }
  }

  async function signInWithInstitution() {
    if (!oidcStatus?.enabled || pending) return;
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

  const resendSeconds =
    flow.step === "pin" ? Math.max(0, Math.ceil((flow.resendAt - now) / 1000)) : 0;
  const deliveryEmail = flow.step === "email" ? "" : flow.email;

  return (
    <>
      <header className="shell topbar auth-topbar">
        <Brand />
        <Link className="button-quiet auth-join-link" href="/join">
          {t("delivery.site.joinRound")}
        </Link>
      </header>
      <main className="shell auth-wrap">
        <section className="join-card auth-card" aria-labelledby="signin-title">
          <p className="eyebrow">{t("delivery.auth.creatorAccess")}</p>
          <h1 id="signin-title" style={{ fontSize: "clamp(2.4rem, 8vw, 4rem)" }}>
            {flow.step === "pin"
              ? t("delivery.auth.pinTitle")
              : mode === "signup"
                ? t("delivery.auth.createAccount")
                : t("delivery.auth.signInTitle")}
          </h1>
          <p className="muted">
            {flow.step === "pin"
              ? t("delivery.auth.pinDescription")
              : mode === "signup"
                ? t("delivery.auth.createAccountDescription")
                : t("delivery.auth.signInDescription")}
          </p>
          <LogoutWarningNotice navigation={management} />
          {verified ? (
            <div className="success" ref={verificationNotice} role="status" tabIndex={-1}>
              {t("delivery.auth.verified")}
            </div>
          ) : null}
          {signInEnvironment?.originMismatch ? (
            <div className="notice" role="status">
              <strong>{t("delivery.auth.originTitle")}</strong>
              <p className="auth-origin">
                {t("delivery.auth.originDescription", {
                  currentOrigin: signInEnvironment.currentOrigin,
                  configuredOrigin: signInEnvironment.configuredOrigin,
                })}
              </p>
              <a
                className="button-quiet small-button auth-status-action"
                href={signInEnvironment.configuredSignInUrl}
              >
                {t("delivery.auth.openConfigured")}
              </a>
            </div>
          ) : null}
          <div
            className="segmented auth-modes"
            aria-label={t("delivery.auth.accessMode")}
            role="group"
          >
            <button
              aria-pressed={mode === "signin"}
              disabled={!hydrated || pending}
              onClick={() => changeMode("signin")}
              type="button"
            >
              {t("delivery.auth.signInMode")}
            </button>
            <button
              aria-pressed={mode === "signup"}
              disabled={!hydrated || pending}
              onClick={() => changeMode("signup")}
              type="button"
            >
              {t("delivery.auth.createAccount")}
            </button>
          </div>
          {oidcStatus?.enabled && mode === "signin" && flow.step === "email" ? (
            <div className="institution-signin" lang="en-CA">
              <button
                className="button full-width"
                disabled={pending}
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
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {flow.step === "email" ? (
            <form
              aria-label={
                mode === "signup"
                  ? t("delivery.auth.createAccount")
                  : t("delivery.auth.signInTitle")
              }
              aria-busy={pending}
              onSubmit={submitEmail}
            >
              {mode === "signup" ? (
                <fieldset className="field auth-segment">
                  <legend className="field-label">{t("delivery.auth.facilitate")}</legend>
                  <div className="segmented">
                    <button
                      aria-pressed={segment === "workplace"}
                      disabled={!hydrated || pending}
                      onClick={() => setSegment("workplace")}
                      type="button"
                    >
                      {t("delivery.auth.workplace")}
                    </button>
                    <button
                      aria-pressed={segment === "education"}
                      disabled={!hydrated || pending}
                      onClick={() => setSegment("education")}
                      type="button"
                    >
                      {t("delivery.auth.education")}
                    </button>
                  </div>
                </fieldset>
              ) : null}
              <div className="field">
                <label htmlFor="email">{t("delivery.auth.email")}</label>
                <input
                  autoComplete="email"
                  className="input"
                  disabled={!hydrated || pending}
                  id="email"
                  onChange={(event) => setEmail(event.target.value)}
                  ref={emailInput}
                  required
                  type="email"
                  value={email}
                />
              </div>
              <label className="checkbox-field policy-consent">
                <input
                  checked={acceptPolicies}
                  disabled={!hydrated || pending}
                  onChange={(event) => setAcceptPolicies(event.target.checked)}
                  required
                  type="checkbox"
                />
                <LocalizedPolicyConsent />
              </label>
              <button
                className="button full-width"
                disabled={!hydrated || !acceptPolicies || pending}
                type="submit"
              >
                {busy === "sending"
                  ? t("delivery.auth.sending")
                  : mode === "signup"
                    ? t("delivery.auth.sendVerification")
                    : t("delivery.auth.sendPin")}
              </button>
            </form>
          ) : flow.step === "verification-sent" ? (
            <>
              <div className="success" ref={verificationNotice} role="status" tabIndex={-1}>
                <strong>{t("delivery.auth.verificationSent")}</strong>
                <p>{t("delivery.auth.verificationInstructions", { email: flow.email })}</p>
              </div>
              <button
                className="button full-width"
                onClick={() => changeMode("signin")}
                type="button"
              >
                {t("delivery.auth.signInMode")}
              </button>
              <button
                className="button-quiet full-width auth-status-action"
                onClick={() => changeMode("signup")}
                type="button"
              >
                {t("delivery.auth.useAnotherEmail")}
              </button>
            </>
          ) : (
            <>
              <div className="success" role="status">
                {t("delivery.auth.pinSent", { email: flow.email })}
              </div>
              <form
                aria-label={t("delivery.auth.verifyPinForm")}
                aria-busy={pending}
                onSubmit={verifyPin}
              >
                <div className="field">
                  <label htmlFor="signin-pin">{t("delivery.auth.pinLabel")}</label>
                  <input
                    aria-describedby="signin-pin-help"
                    aria-invalid={error ? true : undefined}
                    autoComplete="one-time-code"
                    className="input auth-pin-input"
                    disabled={pending}
                    id="signin-pin"
                    inputMode="numeric"
                    maxLength={6}
                    minLength={6}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    pattern="[0-9]{6}"
                    ref={pinInput}
                    required
                    type="text"
                    value={pin}
                  />
                  <p className="muted auth-pin-help" id="signin-pin-help">
                    {t(
                      now >= flow.expiresAt ? "delivery.auth.pinExpired" : "delivery.auth.pinHelp",
                    )}
                  </p>
                </div>
                <button
                  className="button full-width"
                  disabled={pending || !/^\d{6}$/.test(pin)}
                  type="submit"
                >
                  {busy === "verifying"
                    ? t("delivery.auth.verifying")
                    : t("delivery.auth.signInMode")}
                </button>
                <div className="button-row auth-pin-actions">
                  <button
                    className="button-quiet"
                    disabled={pending || resendSeconds > 0}
                    onClick={() => void resendPin()}
                    type="button"
                  >
                    {busy === "sending"
                      ? t("delivery.auth.sending")
                      : resendSeconds > 0
                        ? t("delivery.auth.resendIn", { seconds: resendSeconds })
                        : t("delivery.auth.resendPin")}
                  </button>
                  <button
                    className="button-quiet"
                    disabled={pending}
                    onClick={() => changeMode("signin")}
                    type="button"
                  >
                    {t("delivery.auth.useAnotherEmail")}
                  </button>
                </div>
              </form>
              <p className="muted auth-account-help">{t("delivery.auth.needAccount")}</p>
              <button
                className="button-quiet full-width"
                disabled={pending}
                onClick={() => changeMode("signup")}
                type="button"
              >
                {t("delivery.auth.createAccount")}
              </button>
            </>
          )}
          {deliveryEmail && publicFeatures?.developmentEmailInboxUrl ? (
            <aside className="notice">
              <p>{t("delivery.auth.inboxInstructions", { email: deliveryEmail })}</p>
              <a
                className="button-quiet small-button auth-status-action"
                href={publicFeatures.developmentEmailInboxUrl}
                rel="noreferrer"
                target="_blank"
              >
                {t("delivery.auth.openInbox")}
              </a>
              {signInEnvironment?.originMismatch ? (
                <p className="auth-origin auth-status-action">
                  {t("delivery.auth.deliveryOrigin", {
                    origin: signInEnvironment.configuredOrigin,
                  })}
                </p>
              ) : null}
            </aside>
          ) : null}
        </section>
      </main>
    </>
  );
}
