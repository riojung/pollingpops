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
  Entitlements,
  SupportedLocale,
  WorkspaceProductFeatures as ContractWorkspaceProductFeatures,
} from "@openround/contracts";
import { WorkspaceProductFeaturesSchema } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { useLocale } from "../locale-provider";
import { useConfirmNavigation } from "../navigation-guard";
import { useManagementNavigation, type ManagementNavigationState } from "../management-navigation";
import { fetchCustomerManagementNavigation } from "../../lib/management-navigation";

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

interface WorkspaceAccountResponse {
  creator: WorkspaceCreator;
  entitlements: Entitlements;
  productFeatures: WorkspaceProductFeatures;
}

interface WorkspaceContextValue {
  management: ManagementNavigationState;
  creator: WorkspaceCreator | null;
  entitlements: Entitlements | null;
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
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [productFeatures, setProductFeatures] = useState<WorkspaceProductFeatures | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      setEntitlements(account.entitlements);
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
      setEntitlements(null);
      setProductFeatures(null);
      if ((caught as { status?: number }).status === 401) {
        // An authenticated billing-only user has no workspace context.
        const navigation = await fetchCustomerManagementNavigation().catch(() => null);
        redirecting = true;
        router.replace(
          navigation?.user && navigation.organizationManagementEnabled
            ? "/organization"
            : "/signin",
        );
        return;
      }
      setError(humanError(caught));
    } finally {
      if (!redirecting) setLoading(false);
    }
  }, [router, setLocale]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      management,
      creator,
      entitlements,
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
        const result = await apiFetch<{ url: string }>("/v1/billing/checkout", {
          method: "POST",
          body: "{}",
        });
        window.location.assign(result.url);
      },
    }),
    [
      confirmNavigation,
      creator,
      entitlements,
      error,
      loading,
      management,
      productFeatures,
      refreshAccount,
      router,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
