"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "../../../components/brand";
import { ApiClientError, apiFetch, humanError } from "../../../lib/api";

export default function OrganizationInvitePage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [organizationId, setOrganizationId] = useState("");
  useEffect(() => {
    const requested = new URL(window.location.href).searchParams.get("token") ?? "";
    if (/^[A-Za-z0-9_-]{43}$/.test(requested)) setToken(requested);
    else
      setError(
        "This invitation link is incomplete. Ask the organization administrator for a new invitation.",
      );
    setReady(true);
  }, []);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const accepted = await apiFetch<{ organizationId: string }>(
        "/v1/organization-invitations/accept",
        { method: "POST", body: JSON.stringify({ token }) },
      );
      setOrganizationId(accepted.organizationId);
      window.history.replaceState(null, "", "/organization/invite");
    } catch (failure) {
      setNeedsSignIn(failure instanceof ApiClientError && failure.status === 401);
      setError(humanError(failure));
    } finally {
      setBusy(false);
    }
  }
  const returnTo = `/organization/invite?token=${encodeURIComponent(token)}`;
  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link href="/organization">Organization management</Link>
      </header>
      <main className="shell auth-wrap">
        <section className="panel">
          <h1>Organization invitation</h1>
          <p>
            Sign in with the email address that received this invitation, then accept to join the
            organization. Workspace content access is managed separately.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {organizationId ? (
            <>
              <p role="status">Invitation accepted.</p>
              <Link
                className="button"
                href={`/organization?organization=${encodeURIComponent(organizationId)}`}
              >
                Open organization
              </Link>
            </>
          ) : (
            <div className="actions">
              <button
                className="button"
                disabled={!ready || !token || busy}
                onClick={() => void accept()}
              >
                {busy ? "Accepting…" : "Accept invitation"}
              </button>
              {ready && token && (
                <Link
                  className="button button-quiet"
                  href={`/signin?returnTo=${encodeURIComponent(returnTo)}`}
                  referrerPolicy="no-referrer"
                >
                  {needsSignIn ? "Sign in to accept" : "Sign in with another account"}
                </Link>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
