"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type {
  CheckpointSetImportUnavailableReason,
  Entitlements,
  SupportedLocale,
  WorkspaceProductFeatures as ContractWorkspaceProductFeatures,
} from "@openround/contracts";
import {
  CheckpointSetImportUnavailableReasonSchema,
  WorkspaceProductFeaturesSchema,
} from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { useLocale } from "../locale-provider";
import { useConfirmNavigation } from "../navigation-guard";
import { useManagementNavigation, type ManagementNavigationState } from "../management-navigation";
import { fetchCustomerManagementNavigation } from "../../lib/management-navigation";
import { clearOtherCanvasCreationSetups } from "../../lib/canvas-creation-storage";
import type { IdleSessionPolicy } from "../../lib/idle-session";

export interface WorkspaceCreator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  role: "owner" | "editor" | "viewer";
  plan: "free" | "pro" | "team";
  locale: SupportedLocale;
  localePreferenceSet: boolean;
}

export type WorkspaceProductFeatures = ContractWorkspaceProductFeatures;

export interface WorkspaceAccountContext {
  id: string;
  name: string;
  sessionPolicy?: IdleSessionPolicy;
  accountType: "personal" | "organization";
  licenseUnit: "workspace" | "user";
  planSource?: "community" | "subscription" | "free";
  organization: {
    id: string;
    name: string;
    role: "owner" | "admin" | "billing" | "member" | null;
  } | null;
  permissions: {
    manageWorkspace: boolean;
    managePeople: boolean;
    manageBilling: boolean;
    manageIntegrations: boolean;
  };
}

interface WorkspaceAccountResponse {
  creator: WorkspaceCreator;
  workspace?: WorkspaceAccountContext;
  entitlements: Entitlements;
  checkpointSetImportUnavailableReason?: unknown;
  productFeatures: WorkspaceProductFeatures;
}

interface WorkspaceContextValue {
  management: ManagementNavigationState;
  creator: WorkspaceCreator | null;
  workspace: WorkspaceAccountContext | null;
  entitlements: Entitlements | null;
  checkpointSetImportUnavailableReason?: CheckpointSetImportUnavailableReason;
  productFeatures: WorkspaceProductFeatures | null;
  loading: boolean;
  error: string;
  canEdit: boolean;
  refreshAccount: () => Promise<void>;
  signOut: () => Promise<void>;
  startUpgrade: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const confirmNavigation = useConfirmNavigation();
  const management = useManagementNavigation();
  const { locale, loadError: localeLoadError, setLocale } = useLocale();
  const localeRef = useRef(locale);
  const localeLoadErrorRef = useRef(localeLoadError);
  localeRef.current = locale;
  localeLoadErrorRef.current = localeLoadError;
  const [creator, setCreator] = useState<WorkspaceCreator | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceAccountContext | null>(null);
  const [access, setAccess] = useState<{
    actorId: string;
    workspaceId: string;
    entitlements: Entitlements;
    importUnavailableReason?: CheckpointSetImportUnavailableReason;
  } | null>(null);
  const [productFeatures, setProductFeatures] = useState<WorkspaceProductFeatures | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const entitlements = access?.entitlements ?? null;
  const checkpointSetImportUnavailableReason =
    access &&
    access.entitlements.csvExport === false &&
    access.actorId === creator?.userId &&
    access.workspaceId === creator?.workspaceId
      ? access.importUnavailableReason
      : undefined;

  const refreshAccount = useCallback(async () => {
    setError("");
    setLoading(true);
    let redirecting = false;
    try {
      const account = await apiFetch<WorkspaceAccountResponse>("/v1/auth/me");
      const features = WorkspaceProductFeaturesSchema.safeParse(account.productFeatures);
      if (!features.success) {
        throw new Error("Workspace access could not be loaded. Try again.");
      }
      setCreator(account.creator);
      clearOtherCanvasCreationSetups(account.creator.userId);
      setWorkspace(account.workspace ?? null);
      setAccess({
        actorId: account.creator.userId,
        workspaceId: account.creator.workspaceId,
        entitlements: account.entitlements,
        importUnavailableReason: CheckpointSetImportUnavailableReasonSchema.safeParse(
          account.checkpointSetImportUnavailableReason,
        ).data,
      });
      setProductFeatures(features.data);
      try {
        if (account.creator.localePreferenceSet) {
          if (account.creator.locale !== localeRef.current) {
            await setLocale(account.creator.locale);
            localeRef.current = account.creator.locale;
          }
        } else if (!localeLoadErrorRef.current) {
          const inheritedLocale = localeRef.current;
          await apiFetch<{ locale: SupportedLocale }>("/v1/account/locale", {
            method: "PUT",
            body: JSON.stringify({ locale: inheritedLocale }),
          });
          setCreator((current) =>
            current?.userId === account.creator.userId
              ? { ...current, locale: inheritedLocale, localePreferenceSet: true }
              : current,
          );
        }
      } catch {
        // Locale initialization must never turn a valid authenticated workspace into an error
        // state. Catalog failures remain visible in the language menu and an inherited account
        // preference is retried on the next account refresh.
      }
    } catch (caught) {
      setCreator(null);
      setWorkspace(null);
      setAccess(null);
      setProductFeatures(null);
      if ((caught as { status?: number }).status === 401) {
        // An authenticated billing-only user has no workspace context.
        const navigation = await fetchCustomerManagementNavigation().catch(() => null);
        redirecting = true;
        router.replace(navigation?.user ? "/account/setup" : "/signin");
        return;
      }
      setError(humanError(caught));
    } finally {
      if (!redirecting) setLoading(false);
    }
  }, [router, setLocale]);

  useEffect(() => {
    void refreshAccount();
    const refresh = () => void refreshAccount();
    window.addEventListener("polling-pops:workspace-updated", refresh);
    return () => window.removeEventListener("polling-pops:workspace-updated", refresh);
  }, [refreshAccount]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      management,
      creator,
      workspace,
      entitlements,
      checkpointSetImportUnavailableReason,
      productFeatures,
      loading,
      error,
      canEdit: creator?.role === "owner" || creator?.role === "editor",
      refreshAccount,
      signOut: async () => {
        if (!confirmNavigation()) return;
        await apiFetch("/v1/auth/logout", { method: "POST", body: "{}" });
        router.replace("/");
      },
      startUpgrade: async () => {
        if (!confirmNavigation()) return;
        if (window.location.pathname === "/account") window.location.hash = "plan";
        else router.push("/account#plan");
      },
    }),
    [
      checkpointSetImportUnavailableReason,
      confirmNavigation,
      creator,
      entitlements,
      error,
      loading,
      management,
      productFeatures,
      refreshAccount,
      router,
      workspace,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
