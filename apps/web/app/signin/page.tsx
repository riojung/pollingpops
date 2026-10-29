"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  LocalReturnPathSchema,
  OidcStartSchema,
  type OidcStatus,
  type PublicFeatures,
} from "@openround/contracts";
import { Brand } from "../../components/brand";
import { useLocale } from "../../components/locale-provider";
import { LocalizedPolicyConsent } from "../../components/localized-policy-consent";
import { API_URL, apiFetch, humanError, type ApiClientError } from "../../lib/api";
import {
  clearPinEntry,
  clearSignInIntent,
  readPinEntry,
  readSignInIntent,
  savePinEntry,
  saveSignInIntent,
  type PinContext,
  type PinEntry,
} from "../../lib/signin-pin";
import { resolveSignInEnvironment, type SignInEnvironment } from "../../lib/signin-environment";
import {
  LogoutWarningNotice,
  useManagementNavigation,
} from "../../components/management-navigation";

type EmailFlow =
  { step: "email" } | { step: "verification-sent"; email: string } | ({ step: "pin" } & PinEntry);

interface PinRequestResponse {
  accepted: boolean;
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

function updateSignInLocation(
  context: PinContext,
  mode: "signin" | "signup",
  consumeVerified = true,
) {
  const address = new URL(window.location.href);
  if (mode === "signup") address.searchParams.set("mode", mode);
  else address.searchParams.delete("mode");
  if (consumeVerified) address.searchParams.delete("verified");
  if (context.returnTo) address.searchParams.set("returnTo", context.returnTo);
  else address.searchParams.delete("returnTo");
  if (context.workspaceId) address.searchParams.set("workspaceId", context.workspaceId);
  else address.searchParams.delete("workspaceId");
  window.history.replaceState(
    window.history.state,
    "",
    `${address.pathname}${address.search}${address.hash}`,
  );
}

export default function SignInPage() {
  const { t } = useLocale();
  const management = useManagementNavigation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [segment, setSegment] = useState<"education" | "workplace">("workplace");
  const [accountType, setAccountType] = useState<"personal" | "organization">("personal");
  const [flow, setFlow] = useState<EmailFlow>({ step: "email" });
  const [sending, setSending] = useState(false);
  const [verifyingPin, setVerifyingPin] = useState(false);
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
  const [pinInvalid, setPinInvalid] = useState(false);
  const requestVersion = useRef(0);
  const stage = useRef<EmailFlow["step"] | "verified">("email");
  const emailInput = useRef<HTMLInputElement>(null);
  const pinInput = useRef<HTMLInputElement>(null);
  const verificationNotice = useRef<HTMLDivElement>(null);
  const pending = sending || verifyingPin || federatedBusy;

  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [],
  );

  useEffect(() => {
    setHydrated(true);
    const query = new URLSearchParams(window.location.search);
    const requestedSignup = query.get("mode") === "signup";
    const requestedAccountType =
      query.get("accountType") === "organization" ? "organization" : "personal";
    setAccountType(requestedAccountType);
    const requestedWorkspace = OidcStartSchema.shape.workspaceId.safeParse(
      query.get("workspaceId"),
    );
    const requestedReturn = LocalReturnPathSchema.safeParse(query.get("returnTo"));
    const localReturn = requestedReturn.success ? requestedReturn.data : undefined;
    const context: PinContext = {
      apiUrl: API_URL,
      ...(localReturn ? { returnTo: localReturn } : {}),
      ...(requestedWorkspace.success ? { workspaceId: requestedWorkspace.data } : {}),
    };
    const isVerificationLanding = query.get("verified") === "1";
    if (isVerificationLanding) {
      clearPinEntry();
      clearSignInIntent();
      saveSignInIntent({ step: "verified", context });
    }
    const restored = isVerificationLanding ? null : readPinEntry(context);
    const intent = readSignInIntent(context);
    const knownVerification = isVerificationLanding || intent?.step === "verified";
    // Keep explicit destinations separate from the account choice's signup default.
    setReturnTo(localReturn ?? null);
    if (restored) {
      setFlow({ step: "pin", ...restored });
      setEmail(restored.email);
      setAcceptPolicies(true);
      setNow(Date.now());
    } else if (intent?.step === "pin") {
      setFlow({ ...intent, challenge: null });
      setEmail(intent.email);
      setAcceptPolicies(true);
      setNow(Date.now());
    }
    setMode(
      restored || intent || knownVerification ? "signin" : requestedSignup ? "signup" : "signin",
    );
    setVerified(knownVerification);
    stage.current =
      restored || intent?.step === "pin" ? "pin" : knownVerification ? "verified" : "email";
    if (restored || intent || knownVerification)
      updateSignInLocation(context, "signin", !knownVerification);
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
    if (!hydrated || verifyingPin || federatedBusy) return;
    if (flow.step === "pin") {
      if (flow.challenge || flow.delivery === "requesting") pinInput.current?.focus();
      else verificationNotice.current?.focus();
    } else if (sending) return;
    else if (flow.step === "verification-sent" || verified) verificationNotice.current?.focus();
    else emailInput.current?.focus();
  }, [flow, hydrated, mode, sending, verifyingPin, federatedBusy, verified, error]);

  function changeMode(nextMode: "signin" | "signup") {
    if (stage.current !== "email" || verified || flow.step !== "email") return;
    beginEmailStage(nextMode, false);
  }

  function beginEmailStage(nextMode: "signin" | "signup", anotherIdentity: boolean) {
    requestVersion.current += 1;
    stage.current = "email";
    clearPinEntry();
    clearSignInIntent();
    setSending(false);
    setMode(nextMode);
    setFlow({ step: "email" });
    setPin("");
    setPinInvalid(false);
    setError("");
    setAcceptPolicies(false);
    setVerified(false);
    if (anotherIdentity) setEmail("");
    updateSignInLocation(
      {
        apiUrl: API_URL,
        ...(returnTo ? { returnTo } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      },
      nextMode,
    );
  }

  function commitPinEntry(entry: PinEntry) {
    stage.current = "pin";
    setFlow({ step: "pin", ...entry });
    savePinEntry(entry);
    saveSignInIntent({
      step: "pin",
      email: entry.email,
      context: entry.context,
      delivery: entry.delivery,
      resendAt: entry.resendAt,
    });
  }

  async function requestPin(submittedEmail: string, previous?: PinEntry) {
    setVerified(false);
    setMode("signin");
    const startedAt = Date.now();
    const version = ++requestVersion.current;
    const oldChallenge =
      previous?.challenge && previous.challenge.expiresAt > startedAt ? previous.challenge : null;
    const oldPin = pin;
    const entry: PinEntry = {
      email: submittedEmail,
      context: previous?.context ?? {
        apiUrl: API_URL,
        ...(returnTo ? { returnTo } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      },
      challenge: oldChallenge,
      delivery: "requesting",
      resendAt: startedAt + 60_000,
    };
    updateSignInLocation(entry.context, "signin");
    setSending(true);
    setError("");
    setPinInvalid(false);
    setNow(startedAt);
    if (!previous) setPin("");
    // Show the input before SMTP completes. Only a server-accepted handle is
    // persisted, and verification waits for this request's 202 response.
    commitPinEntry(entry);
    try {
      const result = await apiFetch<PinRequestResponse>("/v1/auth/pin/request", {
        method: "POST",
        body: JSON.stringify({
          email: submittedEmail,
          acceptPolicies: true,
          ...(entry.context.returnTo ? { returnTo: entry.context.returnTo } : {}),
          ...(entry.context.workspaceId ? { workspaceId: entry.context.workspaceId } : {}),
        }),
      });
      if (requestVersion.current !== version) return;
      if (previous) setPin((current) => (current === oldPin ? "" : current));
      const receivedAt = Date.now();
      setNow(receivedAt);
      commitPinEntry({
        ...entry,
        challenge: {
          challengeId: result.challengeId,
          expiresAt: receivedAt + result.expiresInSeconds * 1_000,
        },
        delivery: "requested",
        resendAt: receivedAt + result.resendAfterSeconds * 1_000,
      });
    } catch (caught) {
      if (requestVersion.current !== version) return;
      const failedAt = Date.now();
      setNow(failedAt);
      const failure = caught as Partial<ApiClientError>;
      if (failure.status === 429) {
        commitPinEntry({
          ...entry,
          delivery: "throttled",
          resendAt: failedAt + Math.max(1, failure.retryAfterSeconds ?? 60) * 1_000,
        });
      } else if (failure.code === "EMAIL_DELIVERY_FAILED") {
        commitPinEntry({ ...entry, challenge: null, delivery: "failed" });
        setPin("");
      } else {
        // An interrupted response does not prove delivery failed. Preserve only
        // an earlier accepted handle; a new request remains an explicit action.
        commitPinEntry({ ...entry, delivery: "uncertain" });
      }
    } finally {
      if (requestVersion.current === version) setSending(false);
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    if (
      !hydrated ||
      !acceptPolicies ||
      pending ||
      flow.step !== "email" ||
      (stage.current !== "email" && stage.current !== "verified")
    )
      return;
    const submittedEmail = email.trim().toLowerCase();
    setError("");
    if (mode === "signin" || verified) {
      await requestPin(submittedEmail);
      return;
    }
    const signupReturnTo =
      returnTo ?? (accountType === "organization" ? "/account/setup?type=organization" : null);
    setSending(true);
    try {
      await apiFetch("/v1/auth/email-verification", {
        method: "POST",
        body: JSON.stringify({
          email: submittedEmail,
          segment,
          acceptPolicies,
          ...(signupReturnTo ? { returnTo: signupReturnTo } : {}),
        }),
      });
      // Sign-in continuation must keep the destination chosen for this signup.
      setReturnTo(signupReturnTo);
      stage.current = "verification-sent";
      setFlow({ step: "verification-sent", email: submittedEmail });
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setSending(false);
    }
  }

  async function resendPin() {
    if (flow.step !== "pin" || pending) return;
    if (Date.now() < flow.resendAt) return;
    await requestPin(flow.email, flow);
  }

  async function verifyPin(event: FormEvent) {
    event.preventDefault();
    if (
      flow.step !== "pin" ||
      stage.current !== "pin" ||
      !flow.challenge ||
      sending ||
      verifyingPin ||
      flow.challenge.expiresAt <= Date.now() ||
      !/^\d{6}$/.test(pin)
    )
      return;
    setVerifyingPin(true);
    setError("");
    setPinInvalid(false);
    try {
      const result = await apiFetch<{ redirectTo: string }>("/v1/auth/pin/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId: flow.challenge.challengeId, pin }),
      });
      requestVersion.current += 1;
      clearPinEntry();
      clearSignInIntent();
      window.location.replace(result.redirectTo);
    } catch (caught) {
      const invalid = (caught as { status?: number }).status === 401;
      setPinInvalid(invalid);
      setError(invalid ? t("delivery.auth.invalidPin") : humanError(caught));
      setVerifyingPin(false);
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
  const pinRecovery = flow.step === "pin" && !flow.challenge && flow.delivery !== "requesting";
  const pinNotice =
    flow.step !== "pin"
      ? "delivery.auth.pinSent"
      : flow.delivery === "requesting"
        ? "delivery.auth.pinRequesting"
        : flow.delivery === "uncertain"
          ? "delivery.auth.pinUncertain"
          : flow.delivery === "throttled"
            ? flow.challenge
              ? "delivery.auth.pinThrottledExisting"
              : "delivery.auth.pinThrottled"
            : flow.delivery === "failed"
              ? "delivery.auth.pinDeliveryFailed"
              : !flow.challenge
                ? "delivery.auth.pinExpired"
                : "delivery.auth.pinSent";

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
            {pinRecovery
              ? t("customer.signin.pinRecoveryTitle")
              : flow.step === "pin"
                ? t("delivery.auth.pinTitle")
                : flow.step === "verification-sent"
                  ? t("delivery.auth.verificationSent")
                  : mode === "signup"
                    ? t("delivery.auth.createAccount")
                    : t("delivery.auth.signInTitle")}
          </h1>
          <p className="muted">
            {pinRecovery
              ? t("customer.signin.pinRecoveryDescription")
              : flow.step === "pin"
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
          {hydrated && flow.step === "email" && !verified ? (
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
          ) : null}
          {oidcStatus?.enabled && mode === "signin" && flow.step === "email" && !verified ? (
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
                  <legend className="field-label">{t("customer.accountType")}</legend>
                  <div className="segmented">
                    {(["personal", "organization"] as const).map((type) => (
                      <button
                        key={type}
                        aria-pressed={accountType === type}
                        disabled={!hydrated || pending}
                        onClick={() => setAccountType(type)}
                        type="button"
                      >
                        {t(`customer.${type}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
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
                {sending
                  ? t("delivery.auth.sending")
                  : mode === "signup"
                    ? t("delivery.auth.sendVerification")
                    : t("delivery.auth.sendPin")}
              </button>
              {verified ? (
                <button
                  className="button-quiet full-width auth-status-action"
                  disabled={pending}
                  onClick={() => beginEmailStage("signin", true)}
                  type="button"
                >
                  {t("delivery.auth.useAnotherEmail")}
                </button>
              ) : null}
            </form>
          ) : flow.step === "verification-sent" ? (
            <>
              <div className="success" ref={verificationNotice} role="status" tabIndex={-1}>
                <strong>{t("delivery.auth.verificationSent")}</strong>
                <p>{t("delivery.auth.verificationInstructions", { email: flow.email })}</p>
              </div>
              <button
                className="button full-width"
                onClick={() => beginEmailStage("signin", false)}
                type="button"
              >
                {t("delivery.auth.signInMode")}
              </button>
              <button
                className="button-quiet full-width auth-status-action"
                onClick={() => beginEmailStage("signin", true)}
                type="button"
              >
                {t("delivery.auth.useAnotherEmail")}
              </button>
            </>
          ) : (
            <>
              <div
                className={flow.delivery === "failed" ? "error" : "success"}
                role={flow.delivery === "failed" ? "alert" : "status"}
                ref={verificationNotice}
                tabIndex={-1}
              >
                {t(pinNotice, { email: flow.email, seconds: resendSeconds })}
              </div>
              {!pinRecovery ? (
                <form
                  aria-label={t("delivery.auth.verifyPinForm")}
                  aria-busy={pending}
                  onSubmit={verifyPin}
                >
                  <div className="field">
                    <label htmlFor="signin-pin">{t("delivery.auth.pinLabel")}</label>
                    <input
                      aria-describedby="signin-pin-help"
                      aria-invalid={pinInvalid ? true : undefined}
                      autoComplete="one-time-code"
                      className="input auth-pin-input"
                      disabled={verifyingPin}
                      id="signin-pin"
                      inputMode="numeric"
                      maxLength={6}
                      minLength={6}
                      onChange={(event) => {
                        setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                        setPinInvalid(false);
                      }}
                      pattern="[0-9]{6}"
                      ref={pinInput}
                      required
                      type="text"
                      value={pin}
                    />
                    <p className="muted auth-pin-help" id="signin-pin-help">
                      {t(
                        !flow.challenge
                          ? "delivery.auth.pinNoChallenge"
                          : now >= flow.challenge.expiresAt
                            ? "delivery.auth.pinExpired"
                            : "delivery.auth.pinHelp",
                      )}
                    </p>
                  </div>
                  <button
                    className="button full-width"
                    disabled={
                      sending ||
                      verifyingPin ||
                      !flow.challenge ||
                      now >= flow.challenge.expiresAt ||
                      !/^\d{6}$/.test(pin)
                    }
                    type="submit"
                  >
                    {verifyingPin ? t("delivery.auth.verifying") : t("delivery.auth.signInMode")}
                  </button>
                </form>
              ) : null}
              <div className="button-row auth-pin-actions">
                <button
                  className="button-quiet"
                  disabled={pending || resendSeconds > 0}
                  onClick={() => void resendPin()}
                  type="button"
                >
                  {sending
                    ? t("delivery.auth.sending")
                    : resendSeconds > 0
                      ? t("delivery.auth.resendIn", { seconds: resendSeconds })
                      : t("delivery.auth.resendPin")}
                </button>
                <button
                  className="button-quiet"
                  disabled={verifyingPin}
                  onClick={() => beginEmailStage("signin", true)}
                  type="button"
                >
                  {t("delivery.auth.useAnotherEmail")}
                </button>
              </div>
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
