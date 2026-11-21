"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  WorkspaceCapabilityUnavailableReasonSchema,
  type BrandTheme,
  type Entitlements,
  type FederatedIdentity,
  type OidcStatus,
  type WorkspaceCapabilityUnavailableReason,
  type WorkspaceInstitutionPolicy,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspaceSummary,
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
import { IdleTimeoutSettings } from "./idle-timeout-settings";
import { PersonalInstitutionIdentities } from "./personal-institution-identities";
import { PersonalSubscriptionOptions } from "./personal-subscription-options";
import { PersonalBillingNotice } from "./personal-billing-notice";
import {
  loadAccountSettings,
  loadWorkspaceBrandSettings,
  type AccountCreator as Creator,
} from "./load-account-settings";
import { loadLtiRegistrations, loadWorkspaceCollaboration } from "./load-owner-settings";
import { SettingsSectionRead } from "./settings-section-read";
import { useOwnerSettingsSection, type SettingsAuthority } from "./use-owner-settings-section";
import { isWorkspaceSettingsConflict, workspaceSettingsPath } from "./workspace-settings-request";
import {
  accountPermissions,
  canManagePersonalBilling,
  personalBillingAction,
  visibleSettingsSections,
  selectedSettingsSection,
  organizationSettingsHref,
  type SettingsSection,
  type PersonalBillingProfile,
  type PersonalBillingState,
} from "./account-settings-model";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { AUTH_CHANGE_EVENT, ApiClientError, apiFetch, humanError } from "../../lib/api";
import {
  appearanceMessages,
  brandSaveUnavailableMessage,
} from "../../lib/i18n/appearance-messages";
import { formatDate, formatList, formatNumber } from "../../lib/i18n/format";
import { PersonalInterfaceSettings, WorkspaceBrandSettings } from "./appearance-settings";
import styles from "./account.module.css";

type SettingsError = string | { brandSaveUnavailableReason?: WorkspaceCapabilityUnavailableReason };

export default function AccountPage() {
  const { locale, t } = useLocale();
  const management = useManagementNavigation();
  const tRef = useRef(t);
  const router = useRouter();
  const loadGeneration = useRef(0);
  const accountLoad = useRef<AbortController | null>(null);
  const workspaceSelection = useRef<AbortController | null>(null);
  const localWorkspaceUpdate = useRef(false);
  const collaborationMutation = useRef<object | null>(null);
  const brandAccessRequest = useRef<AbortSignal | null>(null);
  const appearanceSelected = useRef(false);
  const membersRegion = useRef<HTMLElement | null>(null);
  const settingsContentRef = useRef<HTMLDivElement | null>(null);
  const loadRegionRef = useRef<HTMLElement | null>(null);
  const settingsOwnedFocus = useRef(false);
  const recoveryFocus = useRef(false);
  const retryFocus = useRef(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadStatus, setLoadStatus] = useState<"loading" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState("");
  const [settingsAuthority, setSettingsAuthority] = useState<SettingsAuthority | null>(null);
  const creator = settingsAuthority?.creator ?? null;
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
  const [brandAvailability, setBrandAvailability] = useState<{
    enabled: boolean;
    unavailableReason?: WorkspaceCapabilityUnavailableReason;
    recheckNeeded?: boolean;
  }>({ enabled: false });
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<
    | ""
    | "audit"
    | "billing"
    | "export"
    | "theme"
    | "brandAccess"
    | "embed"
    | "federation"
    | "delete"
    | "workspace"
  >("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<SettingsError>("");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  const [collaborationBusy, setCollaborationBusy] = useState("");
  const [institutionPolicy, setInstitutionPolicy] = useState<WorkspaceInstitutionPolicy | null>(
    null,
  );
  const [oidcStatus, setOidcStatus] = useState<OidcStatus | null>(null);
  const [federatedIdentities, setFederatedIdentities] = useState<FederatedIdentity[]>([]);
  const [productFeatures, setProductFeatures] = useState<{ workspaceShell: boolean } | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    accountLoad.current = controller;
    const generation = ++loadGeneration.current;
    const current = () => !controller.signal.aborted && generation === loadGeneration.current;
    setLoadStatus("loading");
    setLoadError("");
    setSettingsAuthority(null);
    void loadAccountSettings(controller.signal)
      .then((loaded) => {
        if (!current()) return;
        if (loaded.kind === "unauthenticated") {
          router.replace(
            `/signin?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
          );
          return;
        }
        if (loaded.kind === "billing-only") {
          setWorkspace(null);
          setEntitlements(null);
          setProductFeatures(null);
          setUserIdentity(loaded.identity.user);
          setBusinessManagementEnabled(loaded.identity.businessManagementEnabled);
          setBillingOnly(true);
          setLoadStatus("ready");
          return;
        }
        const { account, branding, workspaceList, embedPolicy, policy, identities, oidcStatus } =
          loaded;
        // Commit only a complete trusted snapshot. Defaults must never masquerade as
        // saved settings or missing institution setup.
        setBillingOnly(false);
        setUserIdentity(null);
        setSettingsAuthority({ creator: account.creator, signal: controller.signal });
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
        setBrandAvailability({
          enabled: branding.enabled === true,
          unavailableReason: WorkspaceCapabilityUnavailableReasonSchema.safeParse(
            branding.unavailableReason,
          ).data,
        });
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
        setOidcStatus(oidcStatus);
        collaborationMutation.current = null;
        setCollaborationBusy("");
        setInviteEmail("");
        setInviteRole("editor");
        setInviteUrl("");
        setConfirmation("");
        setLoadStatus("ready");
      })
      .catch((caught) => {
        if (!current()) return;
        controller.abort();
        setLoadError(humanError(caught));
        setLoadStatus("error");
      });
    return () => controller.abort();
  }, [router, loadAttempt]);

  const suspendSettings = useCallback(() => {
    accountLoad.current?.abort();
    collaborationMutation.current = null;
    settingsOwnedFocus.current = false;
    setSettingsAuthority(null);
    setCollaborationBusy("");
    setBusy("");
    setLoadStatus("loading");
    setLoadError("");
  }, []);

  useEffect(() => {
    const refreshAuthority = () => {
      if (localWorkspaceUpdate.current) return;
      workspaceSelection.current?.abort();
      workspaceSelection.current = null;
      suspendSettings();
      setConfirmation("");
      setMessage("");
      setError("");
      setLoadAttempt((attempt) => attempt + 1);
    };
    window.addEventListener(AUTH_CHANGE_EVENT, refreshAuthority);
    window.addEventListener("polling-pops:workspace-updated", refreshAuthority);
    return () => {
      workspaceSelection.current?.abort();
      window.removeEventListener(AUTH_CHANGE_EVENT, refreshAuthority);
      window.removeEventListener("polling-pops:workspace-updated", refreshAuthority);
    };
  }, [suspendSettings]);

  useEffect(() => {
    const trackFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      // Disabling a focused Save button may blur it without focusing another control.
      if (target !== document.body) {
        settingsOwnedFocus.current = settingsContentRef.current?.contains(target) ?? false;
      }
      if (retryFocus.current && !loadRegionRef.current?.contains(target)) {
        retryFocus.current = false;
      }
    };
    document.addEventListener("focusin", trackFocus);
    return () => document.removeEventListener("focusin", trackFocus);
  }, []);

  function focusLoadedPanel(node: HTMLDivElement | null) {
    if (!node || !retryFocus.current) return;
    const active = document.activeElement;
    const ownsFocus = active === document.body || loadRegionRef.current?.contains(active);
    retryFocus.current = false;
    if (ownsFocus) node.focus();
  }

  function retrySettings() {
    loadRegionRef.current?.focus();
    retryFocus.current = true;
    suspendSettings();
    setLoadAttempt((attempt) => attempt + 1);
  }

  function focusRecoveryRegion(node: HTMLElement | null) {
    loadRegionRef.current = node;
    if (!node || !recoveryFocus.current) return;
    recoveryFocus.current = false;
    if (document.activeElement === document.body) node.focus();
  }

  const reportWorkspaceRequestFailure = useCallback(
    (caught: unknown, signal: AbortSignal) => {
      if (signal.aborted) return;
      if (isWorkspaceSettingsConflict(caught)) {
        const active = document.activeElement;
        recoveryFocus.current =
          active === document.body
            ? settingsOwnedFocus.current
            : (settingsContentRef.current?.contains(active) ?? false);
        suspendSettings();
        setMessage("");
        setError("");
        setLoadError(humanError(caught));
        setLoadStatus("error");
      } else {
        setError(humanError(caught));
      }
    },
    [suspendSettings],
  );

  async function switchWorkspace(workspaceId: string) {
    if (
      !settingsAuthority ||
      settingsAuthority.signal.aborted ||
      workspaceId === creator?.workspaceId ||
      workspaceSelection.current
    ) {
      return;
    }
    const selection = new AbortController();
    workspaceSelection.current = selection;
    suspendSettings();
    setError("");
    setMessage("");
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/select`, {
        method: "POST",
        body: "{}",
        signal: selection.signal,
      });
      if (!selection.signal.aborted) window.location.reload();
    } catch (caught) {
      if (selection.signal.aborted) return;
      workspaceSelection.current = null;
      setError(humanError(caught));
      setLoadAttempt((attempt) => attempt + 1);
    }
  }

  async function mutateCollaboration<T>(
    action: string,
    write: (workspaceId: string) => Promise<T>,
    onSuccess?: (result: T) => void,
  ) {
    if (!ownerAuthority || !collaboration.isReady() || collaborationMutation.current) return;
    const mutation = {};
    collaborationMutation.current = mutation;
    const current = () => collaborationMutation.current === mutation && collaboration.isCurrent();
    setCollaborationBusy(action);
    setError("");
    try {
      const result = await write(ownerAuthority.creator.workspaceId);
      if (!current()) return;
      onSuccess?.(result);
      const region = membersRegion.current;
      if (
        region?.querySelector("[data-account-section-content]")?.contains(document.activeElement)
      ) {
        region.focus();
      }
      collaboration.refresh();
    } catch (caught) {
      if (current()) setError(humanError(caught));
    } finally {
      if (collaborationMutation.current === mutation) {
        collaborationMutation.current = null;
        setCollaborationBusy("");
      }
    }
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();
    await mutateCollaboration(
      "invite",
      (workspaceId) => {
        setMessage("");
        setInviteUrl("");
        return apiFetch<{ invitation: WorkspaceInvitation; debugUrl?: string }>(
          workspaceSettingsPath("/v1/workspace/invitations", workspaceId),
          {
            method: "POST",
            body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
          },
        );
      },
      (result) => {
        setInviteEmail("");
        setInviteUrl(result.debugUrl ?? "");
        setMessage(t("account.feedback.invitationSent", { email: result.invitation.email }));
      },
    );
  }

  async function updateMemberRole(userId: string, role: "editor" | "viewer") {
    await mutateCollaboration(`member:${userId}`, (workspaceId) =>
      apiFetch(workspaceSettingsPath(`/v1/workspace/members/${userId}`, workspaceId), {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    );
  }

  async function removeMember(userId: string) {
    if (!window.confirm(t("account.confirm.removeMember"))) return;
    await mutateCollaboration(`member:${userId}`, (workspaceId) =>
      apiFetch(workspaceSettingsPath(`/v1/workspace/members/${userId}`, workspaceId), {
        method: "DELETE",
      }),
    );
  }

  async function revokeInvitation(invitationId: string) {
    await mutateCollaboration(`invitation:${invitationId}`, (workspaceId) =>
      apiFetch(workspaceSettingsPath(`/v1/workspace/invitations/${invitationId}`, workspaceId), {
        method: "DELETE",
      }),
    );
  }

  async function saveTheme(event: FormEvent) {
    event.preventDefault();
    if (!settingsAuthority || !brandAvailability.enabled || !permissions.manageWorkspace) return;
    const { creator, signal } = settingsAuthority;
    if (signal.aborted) return;
    setBusy("theme");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ theme: BrandTheme }>(
        workspaceSettingsPath("/v1/account/theme", creator.workspaceId),
        { method: "PUT", body: JSON.stringify(theme), signal },
      );
      if (signal.aborted) return;
      setTheme(response.theme);
      setSavedTheme(response.theme);
      setMessage(t("account.feedback.themeSaved"));
    } catch (caught) {
      if (signal.aborted) return;
      if (
        caught instanceof ApiClientError &&
        caught.status === 402 &&
        caught.code === "ENTITLEMENT_LIMIT"
      ) {
        const { details } = caught;
        const unavailableReason =
          details?.actorId === creator.userId && details.workspaceId === creator.workspaceId
            ? WorkspaceCapabilityUnavailableReasonSchema.safeParse(details.unavailableReason).data
            : undefined;
        setBrandAvailability({ enabled: false, unavailableReason, recheckNeeded: true });
        if (!appearanceSelected.current)
          setError({ brandSaveUnavailableReason: unavailableReason });
      } else {
        reportWorkspaceRequestFailure(caught, signal);
      }
    } finally {
      if (!signal.aborted) setBusy("");
    }
  }

  async function recheckBrandAccess() {
    if (
      !settingsAuthority ||
      !brandAvailability.recheckNeeded ||
      !permissions.manageWorkspace ||
      busy
    )
      return;
    const { creator, signal } = settingsAuthority;
    if (signal.aborted || brandAccessRequest.current === signal) return;
    brandAccessRequest.current = signal;
    setBusy("brandAccess");
    setError("");
    setMessage("");
    try {
      const branding = await loadWorkspaceBrandSettings(creator.workspaceId, signal);
      if (signal.aborted) return;
      const enabled = branding.enabled === true;
      setBrandAvailability({
        enabled,
        unavailableReason: WorkspaceCapabilityUnavailableReasonSchema.safeParse(
          branding.unavailableReason,
        ).data,
        recheckNeeded: !enabled,
      });
      if (enabled) setMessage(appearanceMessages(locale).brandSaveAccessRestored);
    } catch (caught) {
      reportWorkspaceRequestFailure(caught, signal);
    } finally {
      if (brandAccessRequest.current === signal) brandAccessRequest.current = null;
      if (!signal.aborted) setBusy("");
    }
  }

  async function resetTheme() {
    if (!settingsAuthority || !savedTheme || !permissions.manageWorkspace) return;
    const { creator, signal } = settingsAuthority;
    if (signal.aborted) return;
    setBusy("theme");
    setError("");
    setMessage("");
    try {
      await apiFetch(workspaceSettingsPath("/v1/account/theme", creator.workspaceId), {
        method: "DELETE",
        signal,
      });
      if (signal.aborted) return;
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
      reportWorkspaceRequestFailure(caught, signal);
    } finally {
      if (!signal.aborted) setBusy("");
    }
  }

  async function saveEmbedOrigins(event: FormEvent) {
    event.preventDefault();
    if (!settingsAuthority || !permissions.manageIntegrations) return;
    const { creator, signal } = settingsAuthority;
    if (signal.aborted) return;
    setBusy("embed");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ origins: string[] }>(
        workspaceSettingsPath("/v1/account/embed-origins", creator.workspaceId),
        {
          method: "PUT",
          body: JSON.stringify({
            origins: originRows.map((origin) => origin.trim()).filter(Boolean),
          }),
          signal,
        },
      );
      if (signal.aborted) return;
      setOriginRows(response.origins);
      setMessage(t("account.feedback.embedSaved"));
    } catch (caught) {
      reportWorkspaceRequestFailure(caught, signal);
    } finally {
      if (!signal.aborted) setBusy("");
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
    if (!settingsAuthority) return;
    const { creator, signal } = settingsAuthority;
    if (signal.aborted || !window.confirm(t("account.confirm.unlinkIdentity"))) return;
    setBusy("federation");
    setError("");
    try {
      await apiFetch(
        workspaceSettingsPath(`/v1/auth/federated-identities/${identityId}`, creator.workspaceId),
        { method: "DELETE", signal },
      );
      if (signal.aborted) return;
      setFederatedIdentities((identities) =>
        identities.filter((identity) => identity.id !== identityId),
      );
      setMessage(t("account.feedback.identityRemoved"));
    } catch (caught) {
      reportWorkspaceRequestFailure(caught, signal);
    } finally {
      if (!signal.aborted) setBusy("");
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
    if (!settingsAuthority) return;
    const { creator, signal } = settingsAuthority;
    if (signal.aborted) return;
    setBusy("audit");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<Record<string, unknown>>(
        workspaceSettingsPath("/v1/workspace/audit-export", creator.workspaceId),
        { signal },
      );
      if (signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `polling-pops-audit-${creator.workspaceId}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage(t("account.feedback.auditExportDownloaded"));
    } catch (caught) {
      reportWorkspaceRequestFailure(caught, signal);
    } finally {
      if (!signal.aborted) setBusy("");
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
  const ownerAuthority =
    loadStatus === "ready" && creator?.role === "owner" ? settingsAuthority : null;
  const organizationPeople =
    organizationUserWorkspace || (workspace?.organization && !ownerAuthority);
  const collaboration = useOwnerSettingsSection(
    organizationUserWorkspace ? null : ownerAuthority,
    selectedSection === "people",
    loadWorkspaceCollaboration,
    reportWorkspaceRequestFailure,
  );
  const ltiRegistrations = useOwnerSettingsSection(
    ownerAuthority,
    selectedSection === "security",
    loadLtiRegistrations,
    reportWorkspaceRequestFailure,
  );
  const hasInstitutionAccess = Boolean(
    oidcStatus?.enabled ||
    federatedIdentities.length ||
    (institutionPolicy &&
      (institutionPolicy.contractStatus !== "disabled" ||
        Object.values(institutionPolicy.capabilities).some(Boolean))),
  );

  const requestSettingsSection = useCallback((section: string) => {
    appearanceSelected.current = section === "appearance" || section === "#appearance";
    setRequestedSection(section);
    if (appearanceSelected.current) {
      setError((current) => (typeof current === "string" ? current : ""));
    }
  }, []);

  useEffect(() => {
    const selectFromHash = () => requestSettingsSection(window.location.hash);
    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, [requestSettingsSection]);

  function selectSection(section: SettingsSection) {
    requestSettingsSection(section);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${section}`,
    );
  }

  async function saveWorkspaceName(event: FormEvent) {
    event.preventDefault();
    if (!settingsAuthority || !permissions.manageWorkspace || !workspaceName.trim()) return;
    const { creator, signal } = settingsAuthority;
    if (signal.aborted) return;
    setBusy("workspace");
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ workspace: WorkspaceAccountContext }>(
        workspaceSettingsPath("/v1/workspace/settings", creator.workspaceId),
        { method: "PATCH", body: JSON.stringify({ name: workspaceName.trim() }), signal },
      );
      if (signal.aborted) return;
      setWorkspace(result.workspace);
      setWorkspaceName(result.workspace.name);
      setWorkspaces((items) =>
        items.map((item) =>
          item.id === result.workspace.id ? { ...item, name: result.workspace.name } : item,
        ),
      );
      localWorkspaceUpdate.current = true;
      try {
        window.dispatchEvent(new Event("polling-pops:workspace-updated"));
      } finally {
        localWorkspaceUpdate.current = false;
      }
      setMessage(t("customer.workspace.saved"));
    } catch (caught) {
      reportWorkspaceRequestFailure(caught, signal);
    } finally {
      if (!signal.aborted) setBusy("");
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
    if (!personalBillingOwner || !settingsAuthority) return;
    const { signal } = settingsAuthority;
    let active = true;
    setPersonalBillingStatus({ state: "loading" });
    void apiFetch<{ billing: PersonalBillingProfile }>("/v1/billing/status")
      .then(({ billing }) => {
        if (!billing || typeof billing.status !== "string")
          throw new Error("Invalid billing status");
        if (active && !signal.aborted) setPersonalBillingStatus({ state: "ready", billing });
      })
      .catch(() => {
        if (active && !signal.aborted) setPersonalBillingStatus({ state: "error" });
      });
    return () => {
      active = false;
    };
  }, [personalBillingOwner, settingsAuthority, billingStatusAttempt]);
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

  if (loadStatus === "ready" && billingOnly && userIdentity)
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
            ref={focusLoadedPanel}
            tabIndex={-1}
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
                {typeof error === "string" && error ? (
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

  const loadState = (
    <section
      aria-busy={loadStatus === "loading"}
      aria-labelledby="account-load-title"
      className={`panel ${styles.loadState}`}
      id="account-load-state"
      ref={focusRecoveryRegion}
      role="region"
      tabIndex={-1}
    >
      <h2 id="account-load-title">
        {t(loadStatus === "loading" ? "page.account.title" : "account.load.unavailable")}
      </h2>
      {loadStatus === "loading" ? (
        <p role="status">{t("account.legacy.loading")}</p>
      ) : (
        <>
          <p className="error" lang="en-CA" role="alert">
            {loadError}
          </p>
          <button className="button-quiet" onClick={retrySettings} type="button">
            {t("workspace.retry")}
          </button>
        </>
      )}
    </section>
  );

  const content = (
    <div
      className={productFeatures?.workspaceShell ? styles.account : undefined}
      id="account-settings-content"
      ref={settingsContentRef}
    >
      {typeof error === "string" && error ? (
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
        ref={focusLoadedPanel}
        tabIndex={-1}
        aria-labelledby={`settings-tab-${selectedSection}`}
      >
        <div aria-live="polite">
          {typeof error !== "string" && selectedSection !== "appearance" ? (
            <p className="error">
              {brandSaveUnavailableMessage(
                appearanceMessages(locale),
                error.brandSaveUnavailableReason,
              )}
            </p>
          ) : null}
        </div>
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
                  disabled={!creator || workspaces.length < 2}
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
          {selectedSection === "security" && settingsAuthority ? (
            <IdleTimeoutSettings
              workspace={workspace}
              canManage={permissions.manageWorkspace}
              signal={settingsAuthority.signal}
              onSaved={setWorkspace}
              onWorkspaceConflict={(caught) =>
                reportWorkspaceRequestFailure(caught, settingsAuthority.signal)
              }
            />
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
              {institutionPolicy?.capabilities.lti && ownerAuthority ? (
                <div
                  aria-labelledby="account-lti-title"
                  className={`stack-sm institution-registration-list ${styles.sectionReadRegion}`}
                  data-account-settings-section=""
                  id="account-lti-section"
                  role="region"
                  tabIndex={-1}
                >
                  <h3 id="account-lti-title">{t("account.institution.ltiTitle")}</h3>
                  <SettingsSectionRead
                    status={ltiRegistrations.state.status}
                    onRetry={ltiRegistrations.retry}
                  >
                    {ltiRegistrations.state.status === "ready" &&
                      (ltiRegistrations.state.data.length ? (
                        <ul>
                          {ltiRegistrations.state.data.map((registration) => (
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
                      ))}
                  </SettingsSectionRead>
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
          {selectedSection === "security" && permissions.manageIntegrations ? (
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
                      ? t("account.subscription.csvAvailable")
                      : t("account.subscription.csvUnavailable"),
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
              ) : workspace?.planSource === "community" ? null : (
                <p className="muted">{t("account.subscription.billingUnavailable")}</p>
              )}
            </section>
          ) : null}
          {selectedSection === "people" && organizationPeople ? (
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
          ownerAuthority &&
          !organizationUserWorkspace ? (
            <section
              aria-labelledby="account-members-title"
              className={`panel workspace-members-panel ${styles.sectionReadRegion}`}
              data-account-settings-section=""
              id="account-members-section"
              ref={membersRegion}
              tabIndex={-1}
            >
              <p className="eyebrow">{t("account.members.eyebrow")}</p>
              <h2 id="account-members-title" style={{ fontSize: "1.8rem" }}>
                {t("account.members.title")}
              </h2>
              <p className="muted">{t("account.members.description")}</p>
              {inviteUrl ? (
                <p className="notice">
                  {t("account.members.localInvitationLink")}:{" "}
                  <a href={inviteUrl}>{t("account.members.openInvitation")}</a>
                </p>
              ) : null}
              <SettingsSectionRead
                status={collaboration.state.status}
                onRetry={collaboration.retry}
              >
                {collaboration.state.status === "ready" && (
                  <>
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
                          onChange={(event) =>
                            setInviteRole(event.target.value as "editor" | "viewer")
                          }
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
                    <div
                      className="table-scroll"
                      role="group"
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
                          {collaboration.state.data.members.map((member) => (
                            <tr key={member.userId}>
                              <td>{member.email}</td>
                              <td>
                                {member.role === "owner" ? (
                                  t("role.owner")
                                ) : (
                                  <select
                                    aria-label={t("account.members.roleFor", {
                                      email: member.email,
                                    })}
                                    className="select compact-select"
                                    disabled={collaborationBusy !== ""}
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
                                    disabled={collaborationBusy !== ""}
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
                    {collaboration.state.data.invitations.some(
                      (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
                    ) ? (
                      <div className="workspace-invitations">
                        <h3>{t("account.members.pendingInvitations")}</h3>
                        <ul>
                          {collaboration.state.data.invitations
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
                                  disabled={collaborationBusy !== ""}
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
                  </>
                )}
              </SettingsSectionRead>
            </section>
          ) : null}
          {selectedSection === "appearance" ? (
            <div>
              <PersonalInterfaceSettings />
              <WorkspaceBrandSettings
                theme={theme}
                savedTheme={savedTheme}
                onChange={setTheme}
                onSave={saveTheme}
                onReset={() => void resetTheme()}
                onRecheckAccess={
                  brandAvailability.recheckNeeded && permissions.manageWorkspace
                    ? () => void recheckBrandAccess()
                    : undefined
                }
                checkingAccess={busy === "brandAccess"}
                canManage={permissions.manageWorkspace}
                entitled={brandAvailability.enabled}
                unavailableReason={brandAvailability.unavailableReason}
                busy={busy !== ""}
              />
            </div>
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

  const visibleContent = loadStatus === "ready" ? content : loadState;

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
          {visibleContent}
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
                : loadStatus === "loading"
                  ? t("account.legacy.loading")
                  : ""}
            </p>
          </div>
        </div>
        {visibleContent}
      </main>
    </>
  );
}
