"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { WorkspaceSummary } from "@openround/contracts";
import { SiteHeader } from "../../../components/site-header";
import { useLocale } from "../../../components/locale-provider";
import { apiFetch, humanError } from "../../../lib/api";
import { clientUuid } from "../../../lib/uuid";
import styles from "../account.module.css";

type SetupWorkspace = WorkspaceSummary & { accountType?: "personal" | "organization" };

export default function CustomerSetupPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [accountType, setAccountType] = useState<"personal" | "organization">("personal");
  const [businessEnabled, setBusinessEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [segment, setSegment] = useState<"workplace" | "education">("workplace");
  const request = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    const organization = new URLSearchParams(window.location.search).get("type") === "organization";
    if (organization) setAccountType("organization");
    apiFetch<{ user: { email: string }; businessManagementEnabled: boolean }>("/v1/auth/user")
      .then((identity) => {
        if (!active) return;
        setBusinessEnabled(identity.businessManagementEnabled);
        setReady(true);
      })
      .catch((caught) => {
        if (!active) return;
        if ((caught as { status?: number }).status === 401) {
          router.replace(
            `/signin?returnTo=${encodeURIComponent(`/account/setup${organization ? "?type=organization" : ""}`)}`,
          );
        } else setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function configure(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || (accountType === "organization" && !businessEnabled)) return;
    setBusy(true);
    setError("");
    try {
      if (accountType === "personal") {
        const list = await apiFetch<{ workspaces: SetupWorkspace[] }>("/v1/workspaces");
        const personal = list.workspaces.find(
          (item) => item.accountType === "personal" && item.role === "owner",
        );
        if (personal) {
          await apiFetch(`/v1/workspaces/${personal.id}/select`, { method: "POST", body: "{}" });
          window.location.assign("/home");
          return;
        }
      }
      const body = JSON.stringify(
        accountType === "organization"
          ? { accountType, name: name.trim(), workspaceName: workspaceName.trim(), segment }
          : { accountType, segment },
      );
      if (request.current?.body !== body) request.current = { body, key: clientUuid() };
      await apiFetch("/v1/customer/setup", {
        method: "POST",
        headers: { "x-idempotency-key": request.current.key },
        body,
      });
      window.location.assign(accountType === "organization" ? "/account#overview" : "/home");
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className={`shell page-main ${styles.account}`}>
        <header className="page-heading">
          <div>
            <h1>{t("customer.setup.title")}</h1>
            <p className="muted">{t("customer.setup.description")}</p>
          </div>
        </header>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <section className="panel">
          <div className={styles.setupChoices} role="group" aria-label={t("customer.accountType")}>
            {(["personal", "organization"] as const).map((type) => (
              <button
                key={type}
                className="button-quiet"
                type="button"
                aria-pressed={accountType === type}
                disabled={busy}
                onClick={() => setAccountType(type)}
              >
                <strong>{t(`customer.${type}`)}</strong>
                <span>
                  {t(
                    type === "personal"
                      ? "customer.setup.personalDescription"
                      : "customer.setup.organizationDescription",
                  )}
                </span>
              </button>
            ))}
          </div>
          <form className={styles.setupForm} onSubmit={configure}>
            {accountType === "organization" ? (
              <>
                <label className="field" htmlFor="setup-organization-name">
                  <span>{t("customer.setup.organizationName")}</span>
                  <input
                    className="input"
                    id="setup-organization-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    required
                    disabled={busy}
                  />
                </label>
                <label className="field" htmlFor="setup-workspace-name">
                  <span>{t("customer.setup.workspaceName")}</span>
                  <input
                    className="input"
                    id="setup-workspace-name"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    maxLength={120}
                    required
                    disabled={busy}
                  />
                </label>
                <label className="field" htmlFor="setup-workspace-segment">
                  <span>{t("customer.setup.segment")}</span>
                  <select
                    className="select"
                    id="setup-workspace-segment"
                    value={segment}
                    onChange={(event) => setSegment(event.target.value as typeof segment)}
                    disabled={busy}
                  >
                    <option value="workplace">{t("account.segment.workplace")}</option>
                    <option value="education">{t("account.segment.education")}</option>
                  </select>
                </label>
                {ready && !businessEnabled ? (
                  <p className="notice">{t("customer.setup.organizationUnavailable")}</p>
                ) : null}
              </>
            ) : null}
            <button
              className="button"
              type="submit"
              disabled={!ready || busy || (accountType === "organization" && !businessEnabled)}
            >
              {t(
                busy
                  ? "customer.setup.creating"
                  : accountType === "organization"
                    ? "customer.setup.create"
                    : "customer.setup.continue",
              )}
            </button>
          </form>
        </section>
        <p className="muted">
          {t("customer.setup.existingOrganization")}{" "}
          <Link href="/organization">{t("customer.organization.label")}</Link>
        </p>
      </main>
    </>
  );
}
