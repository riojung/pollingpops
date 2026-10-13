"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GuardedLink, useConfirmNavigation } from "./navigation-guard";
import {
  customerManagementLinks,
  emptyCustomerManagementNavigation,
  emptyOperatorManagementNavigation,
  fetchCustomerManagementNavigation,
  fetchOperatorManagementNavigation,
  operatorNavigationRoleLabel,
  type CustomerManagementNavigation,
  type ManagementNavigationLink,
  type OperatorManagementNavigation,
} from "../lib/management-navigation";
import styles from "./management-navigation.module.css";

export interface ManagementNavigationState extends CustomerManagementNavigation {
  loading: boolean;
  error: string;
  operator: OperatorManagementNavigation["operator"];
  operatorLinks: ManagementNavigationLink[];
  operatorLoading: boolean;
  refresh: () => Promise<void>;
}

export function useManagementNavigation(): ManagementNavigationState {
  const [customer, setCustomer] = useState(emptyCustomerManagementNavigation);
  const [operator, setOperator] = useState(emptyOperatorManagementNavigation);
  const [loading, setLoading] = useState(true);
  const [operatorLoading, setOperatorLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError("");
    // Revoked operator access disappears before a fresh capability check.
    setOperator(emptyOperatorManagementNavigation);
    try {
      const customerNavigation = await fetchCustomerManagementNavigation(controller.signal);
      if (controller.signal.aborted) return;
      setCustomer(customerNavigation);
      setLoading(false);
      setOperatorLoading(Boolean(customerNavigation.operatorConsoleOrigin));
      const operatorNavigation = await fetchOperatorManagementNavigation(
        customerNavigation.operatorConsoleOrigin,
        controller.signal,
      );
      if (!controller.signal.aborted) setOperator(operatorNavigation);
    } catch {
      if (!controller.signal.aborted) {
        setCustomer(emptyCustomerManagementNavigation);
        setError("Management navigation is unavailable. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setOperatorLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      request.current?.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return {
    ...customer,
    loading,
    error,
    operator: operator.operator,
    operatorLinks: operator.links,
    operatorLoading,
    refresh,
  };
}

function OperatorLink({ link }: { link: ManagementNavigationLink }) {
  const confirmNavigation = useConfirmNavigation();
  return (
    <a
      href={link.href}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          !confirmNavigation()
        ) {
          event.preventDefault();
        }
      }}
    >
      {link.label}
    </a>
  );
}

export function ManagementNavigationLinks({
  navigation,
  variant = "dropdown",
  showAdminSignIn = false,
}: {
  navigation: ManagementNavigationState;
  variant?: "dropdown" | "sections";
  showAdminSignIn?: boolean;
}) {
  const customerLinks = customerManagementLinks(navigation);
  const operatorLinks = navigation.operator ? navigation.operatorLinks : [];
  const adminSignIn = showAdminSignIn && navigation.operatorConsoleOrigin && !navigation.operator;
  if (!customerLinks.length && !operatorLinks.length && !adminSignIn) return null;

  const organizationItems = customerLinks.map((link) => (
    <GuardedLink href={link.href} key={link.id}>
      {link.label}
    </GuardedLink>
  ));
  const operatorItems = operatorLinks.map((link) => <OperatorLink key={link.id} link={link} />);
  const operatorLabel = navigation.operator
    ? operatorNavigationRoleLabel(navigation.operator.role)
    : "Business admin";

  return (
    <div className={variant === "sections" ? styles.sections : styles.dropdowns} lang="en-CA">
      {customerLinks.length ? (
        variant === "sections" ? (
          <section className={styles.section} aria-label="Organization management">
            <p className={styles.heading}>Organization</p>
            {organizationItems}
          </section>
        ) : (
          <details className={styles.menu}>
            <summary>
              Organization <span aria-hidden="true">▾</span>
            </summary>
            <div className={styles.panel}>{organizationItems}</div>
          </details>
        )
      ) : null}
      {operatorLinks.length ? (
        variant === "sections" ? (
          <section className={styles.section} aria-label="Business administration">
            <p className={styles.heading}>Business · {operatorLabel}</p>
            {operatorItems}
          </section>
        ) : (
          <details className={styles.menu}>
            <summary>
              Business · {operatorLabel} <span aria-hidden="true">▾</span>
            </summary>
            <div className={styles.panel}>
              <p className={styles.operatorIdentity}>{navigation.operator?.name}</p>
              {operatorItems}
            </div>
          </details>
        )
      ) : null}
      {adminSignIn ? (
        <OperatorLink
          link={{
            id: "admin-signin",
            label: "Business admin sign in",
            href: `${navigation.operatorConsoleOrigin}/auth/start`,
          }}
        />
      ) : null}
    </div>
  );
}
