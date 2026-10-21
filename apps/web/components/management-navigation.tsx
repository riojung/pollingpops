"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NavigationLink } from "./navigation-link";
import {
  customerManagementLinks,
  emptyCustomerManagementNavigation,
  fetchCustomerManagementNavigation,
  type CustomerManagementNavigation,
} from "../lib/management-navigation";
import styles from "./management-navigation.module.css";
import {
  AUTH_CHANGE_EVENT,
  LOGOUT_REVOCATION_WARNING,
  readLogoutWarning,
  dismissLogoutWarning as dismissStoredLogoutWarning,
} from "../lib/api";

export interface ManagementNavigationState extends CustomerManagementNavigation {
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  logoutWarning?: string | null;
  dismissLogoutWarning?: () => void;
}

export function useManagementNavigation(): ManagementNavigationState {
  const [customer, setCustomer] = useState(emptyCustomerManagementNavigation);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logoutWarning, setLogoutWarning] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError("");
    try {
      const customerNavigation = await fetchCustomerManagementNavigation(controller.signal);
      if (controller.signal.aborted) return;
      setCustomer(customerNavigation);
    } catch {
      if (!controller.signal.aborted) {
        setCustomer(emptyCustomerManagementNavigation);
        setError("Management navigation is unavailable. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLogoutWarning(readLogoutWarning());
    void refresh();
    const onAuthChange = () => {
      setLogoutWarning(readLogoutWarning());
      void refresh();
    };
    window.addEventListener("focus", onAuthChange);
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    return () => {
      request.current?.abort();
      window.removeEventListener("focus", onAuthChange);
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    };
  }, [refresh]);

  const dismissLogoutWarning = useCallback(() => {
    setLogoutWarning(null);
    dismissStoredLogoutWarning();
  }, []);

  return {
    ...customer,
    loading,
    error,
    refresh,
    logoutWarning,
    dismissLogoutWarning,
  };
}

export function LogoutWarningNotice({ navigation }: { navigation: ManagementNavigationState }) {
  if (navigation.logoutWarning !== LOGOUT_REVOCATION_WARNING) return null;
  return (
    <div className="error" lang="en-CA" role="alert">
      <p>{LOGOUT_REVOCATION_WARNING}</p>
      {navigation.dismissLogoutWarning ? (
        <button
          className="button-quiet small-button"
          onClick={navigation.dismissLogoutWarning}
          type="button"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function ManagementNavigationLinks({
  navigation,
  variant = "dropdown",
}: {
  navigation: ManagementNavigationState;
  variant?: "dropdown" | "sections";
}) {
  const pathname = usePathname();
  const customerLinks = customerManagementLinks(navigation);
  if (!customerLinks.length) return null;

  const organizationItems = customerLinks.map((link) => (
    <NavigationLink href={link.href} key={link.id}>
      {link.label}
    </NavigationLink>
  ));

  return (
    <div className={variant === "sections" ? styles.sections : styles.dropdowns} lang="en-CA">
      {variant === "sections" ? (
        <section className={styles.section} aria-label="Organization management">
          <p className={styles.heading}>Organization</p>
          {organizationItems}
        </section>
      ) : (
        <details
          className={styles.menu}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !event.currentTarget.open) return;
            event.preventDefault();
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }}
        >
          <summary
            className="navigation-control"
            data-current={pathname === "/organization" || undefined}
          >
            Organization <span aria-hidden="true">▾</span>
          </summary>
          <div className={styles.panel}>{organizationItems}</div>
        </details>
      )}
    </div>
  );
}
