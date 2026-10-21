"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "../../components/brand";
import { useLocale } from "../../components/locale-provider";
import { LocalizedPolicyConsent } from "../../components/localized-policy-consent";
import { apiFetch, humanError } from "../../lib/api";

export default function WorkspaceInvitationPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!token || !acceptPolicies) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ requiresSignIn: boolean; redirectTo: string }>(
        "/v1/invitations/accept",
        {
          method: "POST",
          body: JSON.stringify({ token, acceptPolicies }),
        },
      );
      router.replace(result.redirectTo);
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link href="/">{t("delivery.common.home")}</Link>
      </header>
      <main className="shell auth-wrap">
        <section className="join-card auth-card" aria-labelledby="invite-title">
          <p className="eyebrow">{t("delivery.auth.invitation")}</p>
          <h1 id="invite-title" style={{ fontSize: "clamp(2.4rem, 8vw, 4rem)" }}>
            {t("delivery.auth.joinTeam")}
          </h1>
          <p className="muted">{t("delivery.auth.invitationDescription")}</p>
          {!token ? (
            <p className="error" role="alert">
              {t("delivery.auth.invitationIncomplete")}
            </p>
          ) : (
            <form onSubmit={(event) => void accept(event)}>
              <label className="checkbox-field policy-consent">
                <input
                  checked={acceptPolicies}
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
              <button
                className="button full-width"
                disabled={!acceptPolicies || busy}
                type="submit"
              >
                {busy ? t("delivery.auth.joining") : t("delivery.auth.acceptInvitation")}
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}
