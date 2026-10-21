"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  BrandTheme,
  Entitlements,
  FederatedIdentity,
  LtiRegistration,
  OidcStatus,
  WorkspaceInstitutionPolicy,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceSummary,
} from "@openround/contracts";
import { CreatorBrand } from "../../components/brand";
import { SiteHeader } from "../../components/site-header";
import {
  ManagementNavigationLinks,
  useManagementNavigation,
} from "../../components/management-navigation";
import { useLocale } from "../../components/locale-provider";
import { WorkspaceProvider } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../lib/api";
import { formatDate, formatList, formatNumber } from "../../lib/i18n/format";
import { liveThemeStyle } from "../../lib/theme";
import styles from "./account.module.css";

interface Creator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  role: "owner" | "editor" | "viewer";
  plan: "free" | "pro" | "team";
}

export default function AccountPage() {
  const { locale, t } = useLocale();
  const management = useManagementNavigation();
  const tRef = useRef(t);
  const router = useRouter();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [userIdentity, setUserIdentity] = useState<{ userId: string; email: string } | null>(null);
  const [billingOnly, setBillingOnly] = useState(false);
  const [businessManagementEnabled, setBusinessManagementEnabled] = useState(false);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [theme, setTheme] = useState<BrandTheme>(() => ({
    organizationName: t("account.theme.defaultOrganizationName"),
    primaryColor: "#39243C",
    accentColor: "#AC2855",
  }));
  const [savedTheme, setSavedTheme] = useState<BrandTheme | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<
    "" | "audit" | "billing" | "export" | "theme" | "embed" | "federation" | "delete"
  >("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  const [collaborationBusy, setCollaborationBusy] = useState("");
  const [embedOrigins, setEmbedOrigins] = useState("");
  const [institutionPolicy, setInstitutionPolicy] = useState<WorkspaceInstitutionPolicy | null>(
    null,
  );
  const [oidcStatus, setOidcStatus] = useState<OidcStatus | null>(null);
  const [federatedIdentities, setFederatedIdentities] = useState<FederatedIdentity[]>([]);
  const [ltiRegistrations, setLtiRegistrations] = useState<LtiRegistration[]>([]);
  const [productFeatures, setProductFeatures] = useState<{ workspaceShell: boolean } | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    Promise.all([
      apiFetch<{
        creator: Creator;
        entitlements: Entitlements;
        businessManagementEnabled?: boolean;
        productFeatures?: { uxBeta?: boolean; workspaceShell?: boolean };
      }>("/v1/auth/me"),
      apiFetch<{ theme: BrandTheme | null; enabled: boolean }>("/v1/account/theme"),
      apiFetch<{ activeWorkspaceId: string; workspaces: WorkspaceSummary[] }>("/v1/workspaces"),
      apiFetch<{ origins: string[] }>("/v1/account/embed-origins"),
      apiFetch<WorkspaceInstitutionPolicy>("/v1/workspace/institution-policy"),
      apiFetch<{ identities: FederatedIdentity[] }>("/v1/auth/federated-identities"),
    ])
      .then(async ([account, branding, workspaceList, embedPolicy, policy, identities]) => {
        setCreator(account.creator);
        setBusinessManagementEnabled(account.businessManagementEnabled === true);
        setEntitlements(account.entitlements);
        setProductFeatures({ workspaceShell: account.productFeatures?.workspaceShell === true });
        setSavedTheme(branding.theme);
        setTheme(
          branding.theme ?? {
            organizationName: tRef.current("account.theme.defaultOrganizationName"),
            primaryColor: "#39243C",
            accentColor: "#AC2855",
          },
        );
        setWorkspaces(workspaceList.workspaces);
        setEmbedOrigins(embedPolicy.origins.join("\n"));
        setInstitutionPolicy(policy);
        setFederatedIdentities(identities.identities);
        setOidcStatus(
          await apiFetch<OidcStatus>(
            `/v1/auth/oidc/status?workspaceId=${encodeURIComponent(account.creator.workspaceId)}`,
          ),
        );
        if (account.creator.role === "owner") {
          const [collaboration, lti] = await Promise.all([
            apiFetch<{
              members: WorkspaceMember[];
              invitations: WorkspaceInvitation[];
            }>("/v1/workspace/members"),
            apiFetch<{ registrations: LtiRegistration[] }>("/v1/workspace/lti-registrations"),
          ]);
          setMembers(collaboration.members);
          setInvitations(collaboration.invitations);
          setLtiRegistrations(lti.registrations);
        }
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) {
          void apiFetch<{
            user: { userId: string; email: string };
            businessManagementEnabled: boolean;
          }>("/v1/auth/user")
            .then((identity) => {
              if (!identity.businessManagementEnabled) {
                router.replace("/signin");
                return;
              }
              setUserIdentity(identity.user);
              setBusinessManagementEnabled(true);
              setBillingOnly(true);
            })
            .catch(() => router.replace("/signin"));
        } else setError(humanError(caught));
      });
  }, [router]);

  async function refreshCollaboration() {
    const collaboration = await apiFetch<{
      members: WorkspaceMember[];
      invitations: WorkspaceInvitation[];
    }>("/v1/workspace/members");
    setMembers(collaboration.members);
    setInvitations(collaboration.invitations);
  }

  async function switchWorkspace(workspaceId: string) {
    if (!creator || workspaceId === creator.workspaceId) return;
    setCollaborationBusy("switch");
    setError("");
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/select`, { method: "POST", body: "{}" });
      window.location.reload();
    } catch (caught) {
      setError(humanError(caught));
      setCollaborationBusy("");
    }
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();
    setCollaborationBusy("invite");
    setError("");
    setMessage("");
    setInviteUrl("");
    try {
      const result = await apiFetch<{ invitation: WorkspaceInvitation; debugUrl?: string }>(
        "/v1/workspace/invitations",
        {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        },
      );
      setInviteEmail("");
      setInviteUrl(result.debugUrl ?? "");
      setMessage(t("account.feedback.invitationSent", { email: result.invitation.email }));
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

  async function updateMemberRole(userId: string, role: "editor" | "viewer") {
    setCollaborationBusy(`member:${userId}`);
    setError("");
    try {
      await apiFetch(`/v1/workspace/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm(t("account.confirm.removeMember"))) return;
    setCollaborationBusy(`member:${userId}`);
    setError("");
    try {
      await apiFetch(`/v1/workspace/members/${userId}`, { method: "DELETE" });
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

  async function revokeInvitation(invitationId: string) {
    setCollaborationBusy(`invitation:${invitationId}`);
    setError("");
    try {
      await apiFetch(`/v1/workspace/invitations/${invitationId}`, { method: "DELETE" });
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

  async function saveTheme(event: FormEvent) {
    event.preventDefault();
    if (!entitlements?.brandTheme) return;
    setBusy("theme");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ theme: BrandTheme }>("/v1/account/theme", {
        method: "PUT",
        body: JSON.stringify(theme),
      });
      setTheme(response.theme);
      setSavedTheme(response.theme);
      setMessage(t("account.feedback.themeSaved"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function resetTheme() {
    if (!savedTheme) return;
    setBusy("theme");
    setError("");
    setMessage("");
    try {
      await apiFetch("/v1/account/theme", { method: "DELETE" });
      setSavedTheme(null);
      setTheme({
        organizationName: t("account.theme.defaultOrganizationName"),
        primaryColor: "#39243C",
        accentColor: "#AC2855",
      });
      setMessage(t("account.feedback.themeRemoved"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function saveEmbedOrigins(event: FormEvent) {
    event.preventDefault();
    if (creator?.role !== "owner") return;
    setBusy("embed");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ origins: string[] }>("/v1/account/embed-origins", {
        method: "PUT",
        body: JSON.stringify({
          origins: embedOrigins
            .split("\n")
            .map((origin) => origin.trim())
            .filter(Boolean),
        }),
      });
      setEmbedOrigins(response.origins.join("\n"));
      setMessage(t("account.feedback.embedSaved"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function linkInstitutionIdentity() {
    if (!creator) return;
    setBusy("federation");
    setError("");
    try {
      const result = await apiFetch<{ authorizationUrl: string }>("/v1/auth/oidc/start", {
        method: "POST",
        body: JSON.stringify({ workspaceId: creator.workspaceId, mode: "link" }),
      });
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(humanError(caught));
      setBusy("");
    }
  }

  async function unlinkInstitutionIdentity(identityId: string) {
    if (!window.confirm(t("account.confirm.unlinkIdentity"))) return;
    setBusy("federation");
    setError("");
    try {
      await apiFetch(`/v1/auth/federated-identities/${identityId}`, { method: "DELETE" });
      setFederatedIdentities((identities) =>
        identities.filter((identity) => identity.id !== identityId),
      );
      setMessage(t("account.feedback.identityRemoved"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function downloadExport() {
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<Record<string, unknown>>("/v1/account/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "polling-pops-account-export.json";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage(t("account.feedback.accountExportDownloaded"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function downloadAuditExport() {
    setBusy("audit");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<Record<string, unknown>>("/v1/workspace/audit-export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `polling-pops-audit-${creator?.workspaceId ?? "workspace"}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage(t("account.feedback.auditExportDownloaded"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function openBillingPortal() {
    setBusy("billing");
    setError("");
    try {
      const result = await apiFetch<{ url: string }>("/v1/billing/portal", {
        method: "POST",
        body: "{}",
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(humanError(caught));
      setBusy("");
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== "DELETE") return;
    setBusy("delete");
    setError("");
    try {
      await apiFetch("/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      router.replace("/");
    } catch (caught) {
      setError(humanError(caught));
      setBusy("");
    }
  }

  const effectivePlan = entitlements?.plan ?? creator?.plan;
  const roleLabel = (role: Creator["role"] | WorkspaceMember["role"] | WorkspaceSummary["role"]) =>
    role === "owner" ? t("role.owner") : role === "editor" ? t("role.editor") : t("role.viewer");
  const planLabel = (plan: Creator["plan"]) =>
    plan === "free" ? t("plan.free") : plan === "pro" ? t("plan.pro") : t("plan.team");
  const contractStatusLabel = institutionPolicy
    ? institutionPolicy.contractStatus === "active"
      ? t("account.status.active")
      : institutionPolicy.contractStatus === "pilot"
        ? t("account.status.pilot")
        : t("account.status.disabled")
    : "";
  const identityRequirementLabel = institutionPolicy
    ? institutionPolicy.identityRequirement === "institution"
      ? t("account.identity.institution")
      : institutionPolicy.identityRequirement === "optional"
        ? t("account.identity.optional")
        : t("account.identity.guest")
    : "";
  const capabilityLabels: Record<keyof WorkspaceInstitutionPolicy["capabilities"], string> = {
    oidc: t("account.capability.oidc"),
    managedSso: t("account.capability.managedSso"),
    scim: t("account.capability.scim"),
    lti: t("account.capability.lti"),
    nrps: t("account.capability.nrps"),
    ags: t("account.capability.ags"),
    auditExports: t("account.capability.auditExports"),
    residencyControls: t("account.capability.residencyControls"),
  };
  const enabledCapabilities = institutionPolicy
    ? Object.entries(institutionPolicy.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => capabilityLabels[name as keyof typeof capabilityLabels])
    : [];

  if (billingOnly && userIdentity)
    return (
      <>
        <SiteHeader />
        <main className="shell" lang="en-CA">
          <section className="panel">
            <h1>Personal account</h1>
            <p>{userIdentity.email}</p>
            <Link className="button button-quiet" href="/organization">
              Organizations and billing
            </Link>
            <p className="muted">
              Your sign-in is active. Workspace membership is required to open polls and reports.
              Organization permissions determine billing access.
            </p>
            <button
              className="button-quiet"
              disabled={busy !== ""}
              onClick={() =>
                void apiFetch("/v1/auth/logout", { method: "POST" })
                  .then(() => router.replace("/"))
                  .catch((caught) => setError(humanError(caught)))
              }
            >
              Sign out
            </button>
          </section>
          <section className="panel danger-panel">
            <h2>Delete personal account</h2>
            <p>
              Organization content and financial records are retained. Transfer ownership or close
              any organization you own before deleting your sign-in.
            </p>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <form onSubmit={deleteAccount}>
              <label className="field">
                Type DELETE to confirm
                <input
                  className="input"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="button-danger"
                disabled={confirmation !== "DELETE" || busy !== ""}
                type="submit"
              >
                {busy === "delete" ? "Deleting…" : "Delete personal account"}
              </button>
            </form>
          </section>
        </main>
      </>
    );

  const content = (
    <div className={productFeatures?.workspaceShell ? styles.account : undefined}>
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="success" role="status">
          {message}
        </p>
      ) : null}
      <div className="settings-grid">
        {businessManagementEnabled ? (
          <section className="panel" lang="en-CA">
            <h2>Organization management</h2>
            <p className="muted">
              Manage organization roles, workspace licenses, billing, and shared event credits.
            </p>
            <div className="actions">
              <Link className="button button-quiet" href="/organization">
                Organization and billing
              </Link>
              <Link className="button button-quiet" href="/organization#event-credits">
                Event credits
              </Link>
            </div>
          </section>
        ) : null}
        <section className="panel">
          <p className="eyebrow">{t("account.workspace.eyebrow")}</p>
          <h2 style={{ fontSize: "1.8rem" }}>{t("account.workspace.title")}</h2>
          <p className="muted">
            {t("account.workspace.roleDescription", {
              role: creator ? roleLabel(creator.role) : t("common.loading"),
            })}
          </p>
          <p className="notice">
            {t("account.workspace.homeRegion", {
              region:
                workspaces.find((workspace) => workspace.id === creator?.workspaceId)?.homeRegion ??
                t("common.loading"),
            })}
          </p>
          <label className="field" htmlFor="active-workspace">
            <span>{t("account.workspace.field")}</span>
            <select
              className="select"
              disabled={!creator || collaborationBusy === "switch" || workspaces.length < 2}
              id="active-workspace"
              onChange={(event) => void switchWorkspace(event.target.value)}
              value={creator?.workspaceId ?? ""}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} · {roleLabel(workspace.role)}
                </option>
              ))}
            </select>
          </label>
        </section>
        <section className="panel">
          <p className="eyebrow">{t("account.institution.eyebrow")}</p>
          <h2 style={{ fontSize: "1.8rem" }}>{t("account.institution.title")}</h2>
          <p className="muted">{t("account.institution.description")}</p>
          {institutionPolicy ? (
            <dl className="definition-list compact-definition-list">
              <div>
                <dt>{t("account.institution.contract")}</dt>
                <dd>{contractStatusLabel}</dd>
              </div>
              <div>
                <dt>{t("account.institution.participantIdentity")}</dt>
                <dd>{identityRequirementLabel}</dd>
              </div>
              <div>
                <dt>{t("account.institution.approvedCapabilities")}</dt>
                <dd>
                  {enabledCapabilities.length
                    ? formatList(locale, enabledCapabilities)
                    : t("account.common.none")}
                </dd>
              </div>
              <div>
                <dt>{t("account.institution.k12Mode")}</dt>
                <dd>{t("account.status.disabled")}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">{t("account.institution.loading")}</p>
          )}
          {oidcStatus?.enabled ? (
            <div className="stack-sm">
              <p className="notice">{t("account.institution.linkGuidance")}</p>
              {federatedIdentities.map((identity) => (
                <div className="identity-row" key={identity.id}>
                  <span>
                    <strong>{oidcStatus.providerName}</strong>
                    <small>
                      {identity.emailHint ?? identity.issuer} ·{" "}
                      {t("account.institution.linked", {
                        date: formatDate(locale, identity.linkedAt),
                      })}
                    </small>
                  </span>
                  <button
                    className="button-danger small-button"
                    disabled={busy !== ""}
                    onClick={() => void unlinkInstitutionIdentity(identity.id)}
                    type="button"
                  >
                    {t("account.institution.unlink")}
                  </button>
                </div>
              ))}
              {federatedIdentities.length === 0 ? (
                <button
                  className="button-quiet"
                  disabled={busy !== ""}
                  onClick={() => void linkInstitutionIdentity()}
                  type="button"
                >
                  {busy === "federation"
                    ? t("account.institution.openingSignIn")
                    : t("account.institution.linkProvider", {
                        provider: oidcStatus.providerName ?? "",
                      })}
                </button>
              ) : (
                <p className="muted">
                  {t("account.institution.signInUrl")}:{" "}
                  <code>/signin?workspaceId={creator?.workspaceId}</code>
                </p>
              )}
            </div>
          ) : (
            <p className="notice">{t("account.institution.notEnabled")}</p>
          )}
          {institutionPolicy?.capabilities.lti && creator?.role === "owner" ? (
            <div className="stack-sm institution-registration-list">
              <h3>{t("account.institution.ltiTitle")}</h3>
              {ltiRegistrations.length ? (
                <ul>
                  {ltiRegistrations.map((registration) => (
                    <li key={registration.id}>
                      <strong>{registration.name}</strong>
                      <span>
                        {registration.issuer} · {registration.deploymentId} ·{" "}
                        {registration.status === "active"
                          ? t("account.status.active")
                          : t("account.status.disabled")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notice">{t("account.institution.ltiEmpty")}</p>
              )}
            </div>
          ) : null}
          {institutionPolicy?.capabilities.auditExports && creator?.role === "owner" ? (
            <div className="stack-sm">
              <h3>{t("account.institution.auditTitle")}</h3>
              <p className="muted">{t("account.institution.auditDescription")}</p>
              <button
                className="button-quiet"
                disabled={busy !== ""}
                onClick={() => void downloadAuditExport()}
                type="button"
              >
                {busy === "audit"
                  ? t("account.institution.preparingAudit")
                  : t("account.institution.downloadAudit")}
              </button>
            </div>
          ) : null}
        </section>
        <section className="panel">
          <p className="eyebrow">{t("account.embed.eyebrow")}</p>
          <h2 style={{ fontSize: "1.8rem" }}>{t("account.embed.title")}</h2>
          <p className="muted">{t("account.embed.description")}</p>
          <form onSubmit={saveEmbedOrigins}>
            <label className="field" htmlFor="embed-origins">
              <span>{t("account.embed.allowedOrigins")}</span>
              <textarea
                className="textarea"
                disabled={creator?.role !== "owner" || busy !== ""}
                id="embed-origins"
                onChange={(event) => setEmbedOrigins(event.target.value)}
                placeholder={"https://lms.example.edu\nhttps://slides.example.org"}
                rows={5}
                value={embedOrigins}
              />
            </label>
            {creator?.role === "owner" ? (
              <button className="button-quiet" disabled={busy !== ""} type="submit">
                {busy === "embed" ? t("account.common.saving") : t("account.embed.save")}
              </button>
            ) : (
              <p className="notice">{t("account.embed.ownerOnly")}</p>
            )}
          </form>
        </section>
        <section className="panel">
          <p className="eyebrow">{t("account.subscription.eyebrow")}</p>
          <h2 style={{ fontSize: "1.8rem" }}>
            {creator && effectivePlan
              ? t("account.subscription.plan", { plan: planLabel(effectivePlan) })
              : t("account.subscription.loading")}
          </h2>
          <p className="muted">{t("account.subscription.description")}</p>
          {entitlements ? (
            <p className="muted">
              {formatList(locale, [
                t("account.subscription.participants", {
                  count: formatNumber(locale, entitlements.maxParticipants),
                }),
                entitlements.maxPublishedQuizzes === null
                  ? t("account.subscription.unlimitedPublished")
                  : t("account.subscription.published", {
                      count: formatNumber(locale, entitlements.maxPublishedQuizzes),
                    }),
                t("account.subscription.retention", {
                  count: formatNumber(locale, entitlements.reportRetentionDays),
                }),
                entitlements.csvExport
                  ? t("account.subscription.csvIncluded")
                  : t("account.subscription.csvRequiresPro"),
              ])}
            </p>
          ) : null}
          {effectivePlan === "pro" ? (
            <button
              className="button-quiet"
              disabled={busy !== ""}
              onClick={() => void openBillingPortal()}
              type="button"
            >
              {busy === "billing"
                ? t("account.subscription.openingPortal")
                : t("account.subscription.manageBilling")}
            </button>
          ) : effectivePlan === "free" ? (
            <Link className="button-quiet" href="/pricing">
              {t("account.subscription.comparePlans")}
            </Link>
          ) : (
            <p className="muted">{t("account.subscription.operatorLimits")}</p>
          )}
        </section>
        {creator?.role === "owner" ? (
          <section className="panel workspace-members-panel">
            <p className="eyebrow">{t("account.members.eyebrow")}</p>
            <h2 style={{ fontSize: "1.8rem" }}>{t("account.members.title")}</h2>
            <p className="muted">{t("account.members.description")}</p>
            <form className="toolbar" onSubmit={(event) => void inviteMember(event)}>
              <label className="field workspace-invite-email">
                <span>{t("account.members.email")}</span>
                <input
                  className="input"
                  maxLength={320}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <label className="field">
                <span>{t("account.members.role")}</span>
                <select
                  className="select"
                  onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}
                  value={inviteRole}
                >
                  <option value="editor">{t("role.editor")}</option>
                  <option value="viewer">{t("role.viewer")}</option>
                </select>
              </label>
              <button
                className="button"
                disabled={collaborationBusy !== ""}
                style={{ alignSelf: "end" }}
                type="submit"
              >
                {collaborationBusy === "invite"
                  ? t("account.members.sending")
                  : t("account.members.invite")}
              </button>
            </form>
            {inviteUrl ? (
              <p className="notice">
                {t("account.members.localInvitationLink")}:{" "}
                <a href={inviteUrl}>{t("account.members.openInvitation")}</a>
              </p>
            ) : null}
            <div
              className="table-scroll"
              role="region"
              aria-label={t("account.members.tableLabel")}
              tabIndex={0}
            >
              <table className="report-table">
                <thead>
                  <tr>
                    <th>{t("account.members.email")}</th>
                    <th>{t("account.members.role")}</th>
                    <th>{t("account.members.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId}>
                      <td>{member.email}</td>
                      <td>
                        {member.role === "owner" ? (
                          t("role.owner")
                        ) : (
                          <select
                            aria-label={t("account.members.roleFor", { email: member.email })}
                            className="select compact-select"
                            disabled={collaborationBusy === `member:${member.userId}`}
                            onChange={(event) =>
                              void updateMemberRole(
                                member.userId,
                                event.target.value as "editor" | "viewer",
                              )
                            }
                            value={member.role}
                          >
                            <option value="editor">{t("role.editor")}</option>
                            <option value="viewer">{t("role.viewer")}</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {member.role !== "owner" ? (
                          <button
                            className="button-danger small-button"
                            disabled={collaborationBusy === `member:${member.userId}`}
                            onClick={() => void removeMember(member.userId)}
                            type="button"
                          >
                            {t("account.members.remove")}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invitations.some((invitation) => !invitation.acceptedAt && !invitation.revokedAt) ? (
              <div className="workspace-invitations">
                <h3>{t("account.members.pendingInvitations")}</h3>
                <ul>
                  {invitations
                    .filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)
                    .map((invitation) => (
                      <li key={invitation.id}>
                        <span>
                          {invitation.email} · {roleLabel(invitation.role)} ·{" "}
                          {t("account.members.expires", {
                            date: formatDate(locale, invitation.expiresAt),
                          })}
                        </span>
                        <button
                          className="button-danger small-button"
                          disabled={collaborationBusy === `invitation:${invitation.id}`}
                          onClick={() => void revokeInvitation(invitation.id)}
                          type="button"
                        >
                          {t("account.members.revoke")}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
        <section className="panel">
          <p className="eyebrow">{t("account.theme.eyebrow")}</p>
          <h2 style={{ fontSize: "1.8rem" }}>{t("account.theme.title")}</h2>
          <p className="muted">{t("account.theme.description")}</p>
          {entitlements && !entitlements.brandTheme ? (
            <p className="notice">{t("account.theme.requiresPro")}</p>
          ) : null}
          <div
            className="live-shell theme-preview"
            data-branded="true"
            style={liveThemeStyle(theme)}
          >
            <CreatorBrand
              inverted
              name={theme.organizationName || t("account.theme.defaultOrganizationName")}
              productFeatures={productFeatures}
            />
            <p className="theme-preview-copy">{t("account.theme.preview")}</p>
          </div>
          <form onSubmit={saveTheme}>
            <label className="field" htmlFor="theme-name">
              <span>{t("account.theme.organizationName")}</span>
              <input
                className="input"
                disabled={!entitlements?.brandTheme || busy !== ""}
                id="theme-name"
                maxLength={80}
                onChange={(event) => setTheme({ ...theme, organizationName: event.target.value })}
                required
                value={theme.organizationName}
              />
            </label>
            <div className="settings-grid">
              <label className="field" htmlFor="theme-primary">
                <span>
                  {t("account.theme.backgroundColour")} · {theme.primaryColor}
                </span>
                <input
                  className="color-input"
                  disabled={!entitlements?.brandTheme || busy !== ""}
                  id="theme-primary"
                  onChange={(event) => setTheme({ ...theme, primaryColor: event.target.value })}
                  type="color"
                  value={theme.primaryColor}
                />
              </label>
              <label className="field" htmlFor="theme-accent">
                <span>
                  {t("account.theme.actionColour")} · {theme.accentColor}
                </span>
                <input
                  className="color-input"
                  disabled={!entitlements?.brandTheme || busy !== ""}
                  id="theme-accent"
                  onChange={(event) => setTheme({ ...theme, accentColor: event.target.value })}
                  type="color"
                  value={theme.accentColor}
                />
              </label>
            </div>
            <p className="muted">{t("account.theme.contrastHelp")}</p>
            <div className="button-row">
              <button
                className="button"
                disabled={!entitlements?.brandTheme || busy !== ""}
                type="submit"
              >
                {busy === "theme" ? t("account.common.saving") : t("account.theme.save")}
              </button>
              {savedTheme ? (
                <button
                  className="button-quiet"
                  disabled={busy !== ""}
                  onClick={() => void resetTheme()}
                  type="button"
                >
                  {t("account.theme.useOpenRound")}
                </button>
              ) : null}
            </div>
          </form>
        </section>
        <section className="panel">
          <p className="eyebrow">{t("account.export.eyebrow")}</p>
          <h2 style={{ fontSize: "1.8rem" }}>{t("account.export.title")}</h2>
          <p className="muted">{t("account.export.description")}</p>
          <button
            className="button-quiet"
            disabled={!creator || busy !== ""}
            onClick={() => void downloadExport()}
            type="button"
          >
            {busy === "export" ? t("account.export.preparing") : t("account.export.download")}
          </button>
        </section>
        <section className="panel danger-panel">
          <p className="eyebrow">{t("account.delete.eyebrow")}</p>
          <h2 style={{ fontSize: "1.8rem" }}>{t("account.delete.title")}</h2>
          {businessManagementEnabled ? (
            <p className="muted" lang="en-CA">
              Delete your personal sign-in. Organization content and financial records are retained.
              Transfer ownership or close your organizations first.
            </p>
          ) : (
            <p className="muted">{t("account.delete.description")}</p>
          )}
          <form onSubmit={deleteAccount}>
            <label className="field" htmlFor="delete-confirmation">
              <span>{t("account.delete.confirm", { confirmation: "DELETE" })}</span>
              <input
                autoComplete="off"
                className="input"
                id="delete-confirmation"
                onChange={(event) => setConfirmation(event.target.value)}
                value={confirmation}
              />
            </label>
            <button
              className="button-danger"
              disabled={!creator || confirmation !== "DELETE" || busy !== ""}
              type="submit"
            >
              {busy === "delete" ? t("account.delete.deleting") : t("account.delete.action")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );

  if (productFeatures?.workspaceShell) {
    return (
      <WorkspaceProvider>
        <WorkspaceShell
          description={t("page.account.description")}
          eyebrow={t("page.account.eyebrow")}
          requireBeta={false}
          title={t("page.account.title")}
          translationLevel="full"
        >
          {content}
        </WorkspaceShell>
      </WorkspaceProvider>
    );
  }

  return (
    <>
      <header className="shell topbar">
        <CreatorBrand productFeatures={productFeatures} />
        <nav className="button-row" aria-label="Account navigation">
          <Link className="button-quiet small-button" href="/dashboard">
            {t("account.legacy.dashboard")}
          </Link>
          <ManagementNavigationLinks navigation={management} />
        </nav>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{t("page.account.eyebrow")}</p>
            <h1>{t("account.legacy.title")}</h1>
            <p className="muted">
              {creator && effectivePlan
                ? t("account.legacy.summary", {
                    email: creator.email,
                    segment:
                      creator.segment === "education"
                        ? t("account.segment.education")
                        : t("account.segment.workplace"),
                    plan: planLabel(effectivePlan),
                  })
                : t("account.legacy.loading")}
            </p>
          </div>
        </div>
        {content}
      </main>
    </>
  );
}
