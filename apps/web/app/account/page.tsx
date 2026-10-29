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
import {
  WorkspaceProvider,
  type WorkspaceAccountContext,
} from "../../components/workspace/workspace-provider";
import { SettingsNavigation } from "./settings-navigation";
import { PersonalInstitutionIdentities } from "./personal-institution-identities";
import { PersonalSubscriptionOptions } from "./personal-subscription-options";
import { PersonalBillingNotice } from "./personal-billing-notice";
import { loadOwnerSettings } from "./load-owner-settings";
import {
  accountPermissions,
  canManagePersonalBilling,
  personalBillingAction,
  visibleSettingsSections,
  selectedSettingsSection,
  organizationSettingsHref,
  workspaceThemePresets,
  type SettingsSection,
  type PersonalBillingProfile,
  type PersonalBillingState,
} from "./account-settings-model";
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
  const [workspace, setWorkspace] = useState<WorkspaceAccountContext | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [requestedSection, setRequestedSection] = useState("");
  const [originRows, setOriginRows] = useState<string[]>([]);
  const [userIdentity, setUserIdentity] = useState<{ userId: string; email: string } | null>(null);
  const [billingOnly, setBillingOnly] = useState(false);
  const [businessManagementEnabled, setBusinessManagementEnabled] = useState(false);
  const [personalBillingStatus, setPersonalBillingStatus] = useState<PersonalBillingState>({
    state: "loading",
  });
  const [billingStatusAttempt, setBillingStatusAttempt] = useState(0);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [theme, setTheme] = useState<BrandTheme>(() => ({
    organizationName: t("account.theme.defaultOrganizationName"),
    primaryColor: "#39243C",
    accentColor: "#AC2855",
  }));
  const [savedTheme, setSavedTheme] = useState<BrandTheme | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<
    "" | "audit" | "billing" | "export" | "theme" | "embed" | "federation" | "delete" | "workspace"
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
        workspace?: WorkspaceAccountContext;
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
        setWorkspace(account.workspace ?? null);
        setWorkspaceName(
          account.workspace?.name ??
            workspaceList.workspaces.find((item) => item.id === account.creator.workspaceId)
              ?.name ??
            "",
        );
        setBusinessManagementEnabled(account.businessManagementEnabled === true);
        setEntitlements(account.entitlements);
        setProductFeatures({ workspaceShell: account.productFeatures?.workspaceShell === true });
        setSavedTheme(branding.theme);
        setTheme(
          branding.theme ?? {
            organizationName: (
              account.workspace?.organization?.name ??
              account.workspace?.name ??
              workspaceList.workspaces.find((item) => item.id === account.creator.workspaceId)
                ?.name ??
              tRef.current("account.theme.defaultOrganizationName")
            ).slice(0, 80),
            primaryColor: "#39243C",
            accentColor: "#AC2855",
          },
        );
        setWorkspaces(workspaceList.workspaces);
        setOriginRows(embedPolicy.origins);
        setInstitutionPolicy(policy);
        setFederatedIdentities(identities.identities);
        setOidcStatus(
          await apiFetch<OidcStatus>(
            `/v1/auth/oidc/status?workspaceId=${encodeURIComponent(account.creator.workspaceId)}`,
          ),
        );
        const { collaboration, registrations } = await loadOwnerSettings(
          account.creator.role,
          account.workspace ?? null,
        );
        if (collaboration) {
          setMembers(collaboration.members);
          setInvitations(collaboration.invitations);
        }
        setLtiRegistrations(registrations);
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) {
          void apiFetch<{
            user: { userId: string; email: string };
            businessManagementEnabled: boolean;
          }>("/v1/auth/user")
            .then((identity) => {
              setUserIdentity(identity.user);
              setBusinessManagementEnabled(identity.businessManagementEnabled);
              setBillingOnly(true);
            })
            .catch(() =>
              router.replace(
                `/signin?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
              ),
            );
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
    if (!entitlements?.brandTheme || !permissions.manageWorkspace) return;
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
    if (!savedTheme || !permissions.manageWorkspace) return;
    setBusy("theme");
    setError("");
    setMessage("");
    try {
      await apiFetch("/v1/account/theme", { method: "DELETE" });
      setSavedTheme(null);
      setTheme({
        organizationName: (
          workspace?.organization?.name ??
          workspace?.name ??
          workspaceName ??
          t("account.theme.defaultOrganizationName")
        ).slice(0, 80),
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
    if (!permissions.manageIntegrations) return;
    setBusy("embed");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ origins: string[] }>("/v1/account/embed-origins", {
        method: "PUT",
        body: JSON.stringify({
          origins: originRows.map((origin) => origin.trim()).filter(Boolean),
        }),
      });
      setOriginRows(response.origins);
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
    if (personalBilling !== "portal") return;
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

  async function openPersonalCheckout(offerId?: string) {
    if (personalBilling !== "checkout" || (businessManagementEnabled && !offerId)) return;
    setBusy("billing");
    setError("");
    try {
      const result = await apiFetch<{ url: string }>("/v1/billing/checkout", {
        method: "POST",
        body: JSON.stringify(offerId ? { offerId } : {}),
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

  const permissions = accountPermissions(workspace, creator?.role);
  const sections = visibleSettingsSections(workspace, creator?.role);
  const selectedSection = selectedSettingsSection(requestedSection, sections);
  const organizationUserWorkspace =
    workspace?.accountType === "organization" && workspace.licenseUnit === "user";
  const hasInstitutionAccess = Boolean(
    oidcStatus?.enabled ||
    federatedIdentities.length ||
    (institutionPolicy &&
      (institutionPolicy.contractStatus !== "disabled" ||
        Object.values(institutionPolicy.capabilities).some(Boolean))),
  );

  useEffect(() => {
    const selectFromHash = () => setRequestedSection(window.location.hash);
    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, []);

  function selectSection(section: SettingsSection) {
    setRequestedSection(section);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${section}`,
    );
  }

  async function saveWorkspaceName(event: FormEvent) {
    event.preventDefault();
    if (!permissions.manageWorkspace || !workspaceName.trim()) return;
    setBusy("workspace");
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ workspace: WorkspaceAccountContext }>(
        "/v1/workspace/settings",
        { method: "PATCH", body: JSON.stringify({ name: workspaceName.trim() }) },
      );
      setWorkspace(result.workspace);
      setWorkspaceName(result.workspace.name);
      setWorkspaces((items) =>
        items.map((item) =>
          item.id === result.workspace.id ? { ...item, name: result.workspace.name } : item,
        ),
      );
      window.dispatchEvent(new Event("polling-pops:workspace-updated"));
      setMessage(t("customer.workspace.saved"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  const effectivePlan = entitlements?.plan ?? creator?.plan;
  const personalBillingOwner = canManagePersonalBilling(workspace, creator?.role);
  const personalBilling = personalBillingAction(
    workspace,
    creator?.role,
    effectivePlan,
    personalBillingStatus,
  );

  useEffect(() => {
    if (!personalBillingOwner || !creator?.workspaceId) return;
    let active = true;
    void apiFetch<{ billing: PersonalBillingProfile }>("/v1/billing/status")
      .then(({ billing }) => {
        if (!billing || typeof billing.status !== "string")
          throw new Error("Invalid billing status");
        if (active) setPersonalBillingStatus({ state: "ready", billing });
      })
      .catch(() => {
        if (active) setPersonalBillingStatus({ state: "error" });
      });
    return () => {
      active = false;
    };
  }, [personalBillingOwner, creator?.workspaceId, billingStatusAttempt]);
  const roleLabel = (
    role:
      | Creator["role"]
      | WorkspaceMember["role"]
      | WorkspaceSummary["role"]
      | "admin"
      | "billing"
      | "member",
  ) =>
    role === "admin" || role === "billing" || role === "member"
      ? t(`customer.role.${role}`)
      : role === "owner"
        ? t("role.owner")
        : role === "editor"
          ? t("role.editor")
          : t("role.viewer");
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
          <SettingsNavigation
            sections={["overview", "data"]}
            selected={selectedSection === "data" ? "data" : "overview"}
            onSelect={selectSection}
          />
          <div
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${selectedSection === "data" ? "data" : "overview"}`}
          >
            <section className="panel">
              <h1>Personal account</h1>
              <p>{userIdentity.email}</p>
              <div className="actions">
                <Link className="button button-quiet" href="/organization">
                  Organizations and billing
                </Link>
                <Link className="button button-quiet" href="/account/setup">
                  {t("customer.setup.title")}
                </Link>
              </div>
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
            {selectedSection === "data" ? (
              <section className="panel danger-panel">
                <h2>Delete personal account</h2>
                <p>
                  Organization content and financial records are retained. Transfer ownership or
                  close any organization you own before deleting your sign-in.
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
            ) : null}
          </div>
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
      <SettingsNavigation sections={sections} selected={selectedSection} onSelect={selectSection} />
      <div
        className={styles.settingsContent}
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={`settings-tab-${selectedSection}`}
      >
        <div className="settings-grid">
          {selectedSection === "overview" &&
          businessManagementEnabled &&
          workspace?.organization ? (
            <section className="panel" lang="en-CA">
              <h2>{t("customer.organization.label")}</h2>
              <p className="muted">{t("customer.setup.organizationDescription")}</p>
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
          {selectedSection === "overview" ? (
            <section className="panel">
              <p className="eyebrow">{t("account.workspace.eyebrow")}</p>
              <h2 style={{ fontSize: "1.8rem" }}>{t("account.workspace.title")}</h2>
              <p className="muted">
                {workspace?.organization && creator
                  ? `${roleLabel(workspace.organization.role ?? creator.role)} · ${workspace.organization.name}`
                  : t("account.workspace.roleDescription", {
                      role: creator ? roleLabel(creator.role) : t("common.loading"),
                    })}
              </p>
              <p className="notice">
                {t("account.workspace.homeRegion", {
                  region:
                    workspaces.find((workspace) => workspace.id === creator?.workspaceId)
                      ?.homeRegion ?? t("common.loading"),
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
              <dl className="compact-definition-list">
                <div>
                  <dt>{t("customer.accountType")}</dt>
                  <dd>
                    {t(
                      workspace?.accountType === "organization"
                        ? "customer.organization"
                        : "customer.personal",
                    )}
                  </dd>
                </div>
                {workspace?.organization ? (
                  <div>
                    <dt>{t("customer.organization.label")}</dt>
                    <dd>{workspace.organization.name}</dd>
                  </div>
                ) : null}
              </dl>
              {permissions.manageWorkspace ? (
                <form className={styles.renameForm} onSubmit={saveWorkspaceName}>
                  <label className="field" htmlFor="workspace-name">
                    <span>{t("customer.workspace.name")}</span>
                    <input
                      className="input"
                      id="workspace-name"
                      value={workspaceName}
                      maxLength={120}
                      required
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </label>
                  <button
                    className="button-quiet"
                    disabled={busy !== "" || !workspaceName.trim()}
                    type="submit"
                  >
                    {busy === "workspace"
                      ? t("account.common.saving")
                      : t("customer.workspace.save")}
                  </button>
                </form>
              ) : null}
              {businessManagementEnabled && !workspace?.organization ? (
                <Link className="button-quiet" href="/account/setup">
                  {t("customer.setup.title")}
                </Link>
              ) : null}
            </section>
          ) : null}
          {selectedSection === "security" && hasInstitutionAccess ? (
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
          ) : null}
          {selectedSection === "security" ? (
            <section className="panel">
              <p className="eyebrow">{t("account.embed.eyebrow")}</p>
              <h2 style={{ fontSize: "1.8rem" }}>{t("account.embed.title")}</h2>
              <p className="muted">{t("customer.origins.description")}</p>
              <form onSubmit={saveEmbedOrigins}>
                {!originRows.length ? <p className="muted">{t("customer.origins.empty")}</p> : null}
                <div className={styles.originRows}>
                  {originRows.map((origin, index) => (
                    <div className={styles.originRow} key={index}>
                      <label className="field" htmlFor={`embed-origin-${index}`}>
                        <span>{t("customer.origins.origin", { number: index + 1 })}</span>
                        <input
                          className="input"
                          id={`embed-origin-${index}`}
                          type="url"
                          placeholder="https://slides.example.org"
                          disabled={!permissions.manageIntegrations || busy !== ""}
                          value={origin}
                          onChange={(event) =>
                            setOriginRows((items) =>
                              items.map((item, itemIndex) =>
                                itemIndex === index ? event.target.value : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        className="button-quiet"
                        type="button"
                        aria-label={t("customer.origins.remove", { number: index + 1 })}
                        disabled={!permissions.manageIntegrations || busy !== ""}
                        onClick={() =>
                          setOriginRows((items) =>
                            items.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="button-quiet"
                  type="button"
                  disabled={
                    !permissions.manageIntegrations || busy !== "" || originRows.length >= 10
                  }
                  onClick={() => setOriginRows((items) => [...items, ""])}
                >
                  {t("customer.origins.add")}
                </button>
                {permissions.manageIntegrations ? (
                  <button className="button-quiet" disabled={busy !== ""} type="submit">
                    {busy === "embed" ? t("account.common.saving") : t("account.embed.save")}
                  </button>
                ) : (
                  <p className="notice">{t("account.embed.ownerOnly")}</p>
                )}
              </form>
            </section>
          ) : null}
          {selectedSection === "plan" ? (
            <section className="panel">
              <p className="eyebrow">{t("account.subscription.eyebrow")}</p>
              <h2 style={{ fontSize: "1.8rem" }}>
                {workspace?.planSource === "community"
                  ? t("customer.plan.community")
                  : creator && effectivePlan
                    ? t("account.subscription.plan", { plan: planLabel(effectivePlan) })
                    : t("account.subscription.loading")}
              </h2>
              <p className="muted">
                {t(
                  workspace?.planSource === "community"
                    ? "customer.plan.communityDescription"
                    : workspace?.organization
                      ? "customer.organization.plan"
                      : "account.subscription.description",
                )}
              </p>
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
              {workspace?.organization ? (
                permissions.manageBilling ? (
                  <Link
                    className="button-quiet"
                    href={organizationSettingsHref(workspace, "billing")}
                  >
                    {t("customer.organization.billing")}
                  </Link>
                ) : null
              ) : personalBilling === "portal" ? (
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
              ) : personalBilling === "checkout" ? (
                <div className={styles.subscriptionChoices}>
                  {businessManagementEnabled ? (
                    <PersonalSubscriptionOptions
                      key={creator?.workspaceId}
                      busy={busy !== ""}
                      onCheckout={(offerId) => void openPersonalCheckout(offerId)}
                    />
                  ) : (
                    <button
                      className="button"
                      type="button"
                      disabled={busy !== ""}
                      onClick={() => void openPersonalCheckout()}
                    >
                      {busy === "billing"
                        ? t("account.subscription.openingPortal")
                        : t("workspace.explorePro")}
                    </button>
                  )}
                  <Link className="button-quiet" href="/pricing">
                    {t("account.subscription.comparePlans")}
                  </Link>
                </div>
              ) : personalBillingOwner ? (
                <PersonalBillingNotice
                  status={personalBillingStatus}
                  onRetry={() => {
                    setPersonalBillingStatus({ state: "loading" });
                    setBillingStatusAttempt((current) => current + 1);
                  }}
                />
              ) : (
                <p className="muted">{t("account.subscription.operatorLimits")}</p>
              )}
            </section>
          ) : null}
          {selectedSection === "people" && organizationUserWorkspace ? (
            <section className="panel">
              <h2>{t("customer.section.people")}</h2>
              <p>{t("customer.organization.people")}</p>
              <Link className="button" href={organizationSettingsHref(workspace, "members")}>
                {t("customer.organization.manage")}
              </Link>
            </section>
          ) : null}
          {selectedSection === "people" &&
          permissions.managePeople &&
          !organizationUserWorkspace ? (
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
          {selectedSection === "appearance" ? (
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
                  <span>{t("customer.theme.brandName")}</span>
                  <input
                    className="input"
                    disabled={
                      !entitlements?.brandTheme || !permissions.manageWorkspace || busy !== ""
                    }
                    id="theme-name"
                    maxLength={80}
                    onChange={(event) =>
                      setTheme({ ...theme, organizationName: event.target.value })
                    }
                    required
                    value={theme.organizationName}
                  />
                </label>
                <fieldset className={styles.themePresets}>
                  <legend>{t("customer.theme.presets")}</legend>
                  <div className={styles.presetChoices}>
                    {workspaceThemePresets.map((preset) => (
                      <button
                        className="button-quiet"
                        key={preset.id}
                        type="button"
                        aria-pressed={
                          theme.primaryColor === preset.primaryColor &&
                          theme.accentColor === preset.accentColor
                        }
                        disabled={
                          !entitlements?.brandTheme || !permissions.manageWorkspace || busy !== ""
                        }
                        onClick={() =>
                          setTheme((value) => ({
                            ...value,
                            primaryColor: preset.primaryColor,
                            accentColor: preset.accentColor,
                          }))
                        }
                      >
                        <span
                          aria-hidden="true"
                          className={styles.themeSwatch}
                          style={{ background: preset.primaryColor }}
                        />
                        {t(`customer.theme.${preset.id}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <details className={styles.advanced}>
                  <summary>{t("customer.theme.advanced")}</summary>
                  <div className="settings-grid">
                    <label className="field" htmlFor="theme-primary">
                      <span>
                        {t("account.theme.backgroundColour")} · {theme.primaryColor}
                      </span>
                      <input
                        className="color-input"
                        disabled={
                          !entitlements?.brandTheme || !permissions.manageWorkspace || busy !== ""
                        }
                        id="theme-primary"
                        onChange={(event) =>
                          setTheme({ ...theme, primaryColor: event.target.value })
                        }
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
                        disabled={
                          !entitlements?.brandTheme || !permissions.manageWorkspace || busy !== ""
                        }
                        id="theme-accent"
                        onChange={(event) =>
                          setTheme({ ...theme, accentColor: event.target.value })
                        }
                        type="color"
                        value={theme.accentColor}
                      />
                    </label>
                  </div>
                </details>
                <p className="muted">{t("account.theme.contrastHelp")}</p>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={
                      !entitlements?.brandTheme || !permissions.manageWorkspace || busy !== ""
                    }
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
          ) : null}
          {selectedSection === "data" ? (
            <PersonalInstitutionIdentities
              status={oidcStatus}
              identities={federatedIdentities}
              workspaceId={creator?.workspaceId}
              busy={busy !== ""}
              onLink={() => void linkInstitutionIdentity()}
              onUnlink={(id) => void unlinkInstitutionIdentity(id)}
            />
          ) : null}
          {selectedSection === "data" ? (
            <section className="panel">
              <p className="eyebrow">{t("account.export.eyebrow")}</p>
              <h2 style={{ fontSize: "1.8rem" }}>{t("customer.data.personal")}</h2>
              {workspace?.organization ? (
                <p className="notice">{t("customer.data.organization")}</p>
              ) : null}
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
          ) : null}
          {selectedSection === "data" ? (
            <section className="panel danger-panel">
              <p className="eyebrow">{t("account.delete.eyebrow")}</p>
              <h2 style={{ fontSize: "1.8rem" }}>{t("account.delete.title")}</h2>
              {businessManagementEnabled || workspace?.organization ? (
                <p className="muted" lang="en-CA">
                  Delete your personal sign-in. Organization content and financial records are
                  retained. Transfer ownership or close your organizations first.
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
          ) : null}
        </div>
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
