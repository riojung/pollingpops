"use client";

import { useEffect, useRef, type FormEvent } from "react";

export default function PasswordSignInForm({
  busy,
  disabled = false,
  verifying = false,
  username,
  error,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  disabled?: boolean;
  verifying?: boolean;
  username?: string;
  error?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack?: () => void;
}) {
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (verifying) passwordInput.current?.focus();
  }, [verifying]);
  return (
    <form
      className="signin-form"
      method="post"
      action="/auth/password"
      onSubmit={onSubmit}
      aria-busy={busy}
    >
      {verifying && (
        <>
          <h2 id="operator-verify-title">Verify your identity</h2>
          <p>Your change and reason are kept. Verify your identity before applying the change.</p>
        </>
      )}
      <label htmlFor="operator-username">
        Username
        <input
          id="operator-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={128}
          defaultValue={username}
          readOnly={verifying && Boolean(username)}
          required
          disabled={busy}
        />
      </label>
      <label htmlFor="operator-password">
        Password
        <input
          ref={passwordInput}
          id="operator-password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={1024}
          required
          disabled={busy}
        />
      </label>
      <label htmlFor="operator-code">
        Authenticator code
        <input
          id="operator-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          aria-describedby="operator-code-help"
          required
          disabled={busy}
        />
      </label>
      <p className="note" id="operator-code-help">
        Enter a fresh six-digit code from your authenticator app. A code used to sign in cannot be
        used again.
      </p>
      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" type="submit" disabled={busy || disabled}>
        {busy ? "Verifying…" : verifying ? "Verify identity" : "Sign in"}
      </button>
      {onBack && (
        <button type="button" disabled={busy} onClick={onBack}>
          Back to review
        </button>
      )}
    </form>
  );
}
