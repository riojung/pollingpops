"use client";

import Link from "next/link";
import { useLocale } from "../../locale-provider";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import { libraryScopeHref, type LibraryScope } from "./client";
import styles from "./library-sharing.module.css";

export function LibraryScopeNavigation({
  scope,
  type,
  organization,
  canManage = false,
}: {
  scope: LibraryScope;
  type: string;
  organization: boolean;
  canManage?: boolean;
}) {
  const { locale } = useLocale();
  const copy = librarySharingMessages(locale);
  return (
    <nav className={styles.scopes} aria-label={copy.scopes}>
      {(["workspace", ...(organization ? ["organization" as const] : []), "shared"] as const).map(
        (value) => (
          <Link
            key={value}
            href={libraryScopeHref(value, type)}
            className={styles.scope}
            aria-current={scope === value ? "page" : undefined}
          >
            {copy[value]}
          </Link>
        ),
      )}
      {canManage ? (
        <Link
          href={libraryScopeHref("managed", type)}
          className={`${styles.scope} ${styles.manageLink}`}
          aria-current={scope === "managed" ? "page" : undefined}
        >
          {copy.managed}
        </Link>
      ) : null}
    </nav>
  );
}
