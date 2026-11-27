"use client";

import Link from "next/link";
import { useLocale } from "../../locale-provider";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import { libraryDiscoveryHref, type LibraryDiscoveryQuery } from "../../../lib/library-controls";
import { libraryScopeHref, type LibraryScope } from "./client";
import styles from "./library-sharing.module.css";

export function LibraryScopeNavigation({
  scope,
  type,
  discoveryQuery,
  organization,
  canManage = false,
}: {
  scope: LibraryScope;
  type: string;
  discoveryQuery?: LibraryDiscoveryQuery;
  organization: boolean;
  canManage?: boolean;
}) {
  const { locale } = useLocale();
  const copy = librarySharingMessages(locale);
  function href(target: LibraryScope) {
    if (!discoveryQuery) return libraryScopeHref(target, type);
    if (target === scope) return libraryDiscoveryHref(discoveryQuery, target);
    return libraryDiscoveryHref(
      {
        ...discoveryQuery,
        status: "active",
        favorites: false,
        folder: "all",
        progress: "all",
        permission: "all",
        organizationId: "",
      },
      target,
    );
  }

  return (
    <nav className={styles.scopes} aria-label={copy.scopes}>
      {(["workspace", ...(organization ? ["organization" as const] : []), "shared"] as const).map(
        (value) => (
          <Link
            key={value}
            href={href(value)}
            className={styles.scope}
            aria-current={scope === value ? "page" : undefined}
          >
            {copy[value]}
          </Link>
        ),
      )}
      {canManage ? (
        <Link
          href={href("managed")}
          className={`${styles.scope} ${styles.manageLink}`}
          aria-current={scope === "managed" ? "page" : undefined}
        >
          {copy.managed}
        </Link>
      ) : null}
    </nav>
  );
}
