"use client";

import { GuardedLink as Link, useConfirmNavigation } from "../navigation-guard";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CreatorBrand } from "../brand";
import { useLocale } from "../locale-provider";
import { humanError } from "../../lib/api";
import { librarySearchHref } from "../../lib/library-controls";
import type { MessageKey } from "../../lib/i18n/catalog";
import { ColorModeMenu } from "./color-mode-menu";
import { LanguageMenu } from "./language-menu";
import { FeedbackButton } from "./feedback-button";
import { ManagementNavigationLinks } from "../management-navigation";
import {
  useWorkspace,
  WorkspaceProvider,
  type WorkspaceProductFeatures,
} from "./workspace-provider";
import styles from "./workspace.module.css";

type IconName =
  | "home"
  | "library"
  | "sessions"
  | "assignments"
  | "results"
  | "discover"
  | "groups"
  | "workspace"
  | "search"
  | "plus"
  | "presentation"
  | "activity"
  | "help";

const destinations: Array<{
  href: string;
  icon: IconName;
  label: MessageKey;
  match: (path: string) => boolean;
  feature?: "discover" | "groups";
}> = [
  {
    href: "/home",
    icon: "home",
    label: "workspace.nav.home",
    match: (path) => path === "/home",
  },
  {
    href: "/library",
    icon: "library",
    label: "workspace.nav.library",
    match: (path) =>
      path === "/library" ||
      path.startsWith("/library/") ||
      path === "/dashboard" ||
      (path.startsWith("/surveys") && !path.startsWith("/surveys/rooms")),
  },
  {
    href: "/sessions",
    icon: "sessions",
    label: "workspace.nav.sessions",
    match: (path) => path.startsWith("/sessions"),
  },
  {
    href: "/assignments",
    icon: "assignments",
    label: "workspace.nav.assignments",
    match: (path) => path.startsWith("/assignments") || path.includes("/assign"),
  },
  {
    href: "/results",
    icon: "results",
    label: "workspace.nav.results",
    match: (path) => path.startsWith("/results") || path.startsWith("/report/"),
  },
  {
    href: "/discover",
    icon: "discover",
    label: "workspace.nav.discover",
    match: (path) => path.startsWith("/discover") || path.startsWith("/templates"),
    feature: "discover",
  },
  {
    href: "/groups",
    icon: "groups",
    label: "workspace.nav.groups",
    match: (path) => path.startsWith("/groups"),
    feature: "groups",
  },
  {
    href: "/account",
    icon: "workspace",
    label: "workspace.nav.workspace",
    match: (path) => path.startsWith("/account"),
  },
];

function ShellIcon({ name }: { name: IconName }) {
  const common = {
    "aria-hidden": true,
    className: styles.icon,
    fill: "none",
    viewBox: "0 0 24 24",
  } as const;

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="m3 11 9-7 9 7" />
          <path d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" />
        </svg>
      );
    case "library":
      return (
        <svg {...common}>
          <rect height="14" rx="2" width="5" x="3" y="5" />
          <rect height="14" rx="2" width="5" x="10" y="5" />
          <path d="m17 6 3.5-1 3 13.5-3.5.8z" />
        </svg>
      );
    case "sessions":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
          <path d="M6 3.5 3.5 6M18 3.5 20.5 6" />
        </svg>
      );
    case "assignments":
      return (
        <svg {...common}>
          <rect height="16" rx="2" width="14" x="5" y="5" />
          <path d="M9 5V3h6v2M8.5 10h7M8.5 14h4" />
          <path d="m14.5 16 1.5 1.5 3-3" />
        </svg>
      );
    case "results":
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "discover":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" />
        </svg>
      );
    case "groups":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3" />
          <circle cx="17" cy="10" r="2.5" />
          <path d="M3.5 19c.5-3.3 2.3-5 5.5-5s5 1.7 5.5 5M15 15c2.8 0 4.5 1.3 5 4" />
        </svg>
      );
    case "workspace":
      return (
        <svg {...common}>
          <path d="M4 20V7l8-4 8 4v13" />
          <path d="M8 20v-5h8v5M8 9h1M12 9h1M16 9h1" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "presentation":
      return (
        <svg {...common}>
          <rect height="12" rx="2" width="18" x="3" y="4" />
          <path d="M12 16v4M8 20h8M7 12l3-3 2 2 3-3 2 2" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M4 13h4l2-6 4 11 2-5h4" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.4 2.4 0 0 1 4.6 1c0 2-2.4 2.2-2.4 4M12 18h.01" />
        </svg>
      );
  }
}

interface WorkspaceShellProps {
  eyebrow?: string;
  title: string;
  titleLanguage?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  requireBeta?: boolean;
  requiredFeature?: WorkspaceRolloutFeature;
  featureFallbackHref?: string;
  translationLevel?: "none" | "header" | "full";
}

export type WorkspaceRolloutFeature =
  "workspaceShell" | "builderV2" | "presentations" | "groups" | "discover";

export function WorkspaceNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const { locale, t } = useLocale();
  const { productFeatures } = useWorkspace();
  return (
    <nav
      className={mobile ? styles.mobileNav : styles.nav}
      aria-label={mobile ? t("workspace.nav.mobileLabel") : t("workspace.nav.label")}
      lang={locale}
    >
      {destinations
        .filter(
          (destination) => !destination.feature || productFeatures?.[destination.feature] === true,
        )
        .map((destination) => {
          const active = destination.match(pathname);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={
                mobile
                  ? active
                    ? styles.mobileNavActive
                    : styles.mobileNavLink
                  : active
                    ? styles.navLinkActive
                    : styles.navLink
              }
              href={destination.href}
              key={destination.href}
            >
              {!mobile ? <ShellIcon name={destination.icon} /> : null}
              {t(destination.label)}
            </Link>
          );
        })}
    </nav>
  );
}

function CreateMenu({ productFeatures }: { productFeatures: WorkspaceProductFeatures }) {
  const { t } = useLocale();
  return (
    <details className={styles.createMenu}>
      <summary
        aria-label={t("workspace.create.label")}
        className={styles.createButton}
        role="button"
      >
        <ShellIcon name="plus" />
        <span>{t("workspace.create.label")}</span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className={styles.createMenuPanel}>
        <p className={styles.createMenuLabel}>{t("workspace.create.new")}</p>
        <Link
          className={styles.createMenuItem}
          href={productFeatures.builderV2 ? "/create" : "/dashboard"}
        >
          <span className={styles.createMenuIcon}>
            <ShellIcon name="assignments" />
          </span>
          <span>
            <strong>{t("common.round")}</strong>
            <small>{t("workspace.create.roundDescription")}</small>
          </span>
        </Link>
        {productFeatures.presentations ? (
          <Link className={styles.createMenuItem} href="/create/presentation">
            <span className={styles.createMenuIcon} data-tone="violet">
              <ShellIcon name="presentation" />
            </span>
            <span>
              <strong>{t("common.presentation")}</strong>
              <small>{t("workspace.create.presentationDescription")}</small>
            </span>
          </Link>
        ) : null}
        {productFeatures.surveys ? (
          <Link className={styles.createMenuItem} href="/surveys/new">
            <span className={styles.createMenuIcon}>
              <ShellIcon name="assignments" />
            </span>
            <span>
              <strong>{t("create.kind.survey")}</strong>
              <small>{t("create.kind.survey.description")}</small>
            </span>
          </Link>
        ) : null}
      </div>
    </details>
  );
}

export function WorkspaceShell({
  eyebrow = "Creator workspace",
  title,
  titleLanguage,
  description,
  actions,
  children,
  requireBeta = true,
  requiredFeature,
  featureFallbackHref = "/dashboard",
  translationLevel = "none",
}: WorkspaceShellProps) {
  const router = useRouter();
  const confirmNavigation = useConfirmNavigation();
  const { locale, t } = useLocale();
  const { creator, productFeatures, loading, error, canEdit, signOut, startUpgrade, management } =
    useWorkspace();
  const [actionError, setActionError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const workspaceAccessUnavailable =
    Boolean(error) ||
    (requireBeta &&
      (productFeatures?.workspaceShell !== true || productFeatures?.uxBeta !== true)) ||
    (requiredFeature !== undefined && productFeatures?.[requiredFeature] !== true);
  const shouldReturnToDashboard =
    !loading &&
    (creator !== null || productFeatures !== null || Boolean(error)) &&
    workspaceAccessUnavailable;

  useEffect(() => {
    if (shouldReturnToDashboard) {
      router.replace(featureFallbackHref);
    }
  }, [featureFallbackHref, router, shouldReturnToDashboard]);

  if (loading || workspaceAccessUnavailable) {
    return (
      <main className={styles.loading} id="main" lang={locale}>
        <div className={styles.loadingMark} aria-hidden="true" />
        <p>{t("workspace.loading")}</p>
      </main>
    );
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmNavigation()) return;
    router.push(librarySearchHref(globalSearch, window.location.pathname, window.location.search));
  }

  const workspaceLabel = creator
    ? t(
        creator.segment === "workplace"
          ? "workspace.switcher.workplace"
          : "workspace.switcher.education",
      )
    : t("workspace.switcher.current");
  const accountInitial = creator?.email?.trim().charAt(0).toUpperCase() || "O";

  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#main" lang={locale}>
        {t("workspace.skipToMain")}
      </a>
      <aside className={styles.sidebar} lang={locale}>
        <div className={styles.brandWrap}>
          <CreatorBrand productFeatures={productFeatures} />
        </div>
        <WorkspaceNav />
        {management ? (
          <ManagementNavigationLinks navigation={management} variant="sections" />
        ) : null}
        <div className={styles.sidebarFooter}>
          <p className={styles.identity} title={creator?.email}>
            <strong>{creator?.email}</strong>
            <span>
              {creator
                ? t("workspace.identity", {
                    role: t(`role.${creator.role}`),
                    plan: t(`plan.${creator.plan}`),
                  })
                : null}
            </span>
          </p>
          <div className={styles.accountActions}>
            {creator?.plan === "free" ? (
              <button
                className={styles.textButton}
                onClick={() => {
                  setActionError("");
                  void startUpgrade().catch((caught) => setActionError(humanError(caught)));
                }}
                type="button"
              >
                {t("workspace.explorePro")}
              </button>
            ) : null}
            <button
              className={styles.textButton}
              onClick={() => {
                setActionError("");
                void signOut().catch((caught) => setActionError(humanError(caught)));
              }}
              type="button"
            >
              {t("workspace.signOut")}
            </button>
          </div>
        </div>
      </aside>
      <div className={styles.contentColumn}>
        <header className={styles.topHeader} lang={locale}>
          <div className={styles.mobileBrand}>
            <CreatorBrand productFeatures={productFeatures} />
          </div>
          <Link className={styles.workspaceSwitch} href="/account">
            <ShellIcon name="workspace" />
            <span>
              <small>{t("workspace.switcher.label")}</small>
              <strong>{workspaceLabel}</strong>
            </span>
          </Link>
          <form className={styles.globalSearch} onSubmit={submitSearch} role="search">
            <label className={styles.srOnly} htmlFor="workspace-search">
              {t("workspace.search.label")}
            </label>
            <ShellIcon name="search" />
            <input
              autoComplete="off"
              id="workspace-search"
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder={t("workspace.search.placeholder")}
              type="search"
              value={globalSearch}
            />
          </form>
          <div className={styles.topActions}>
            {canEdit && productFeatures ? <CreateMenu productFeatures={productFeatures} /> : null}
            <LanguageMenu />
            <ColorModeMenu />
            <Link
              className={styles.utilityAction}
              href="/activity"
              title={t("workspace.activityTitle")}
            >
              <ShellIcon name="activity" />
              <span className={styles.utilityLabel}>{t("workspace.activity")}</span>
            </Link>
            <Link className={styles.utilityAction} href="/help" title={t("workspace.help")}>
              <ShellIcon name="help" />
              <span className={styles.utilityLabel}>{t("workspace.help")}</span>
            </Link>
            <FeedbackButton />
            <Link
              aria-label={t("workspace.accountSettings")}
              className={styles.accountButton}
              href="/account"
              title={creator?.email}
            >
              {accountInitial}
            </Link>
          </div>
        </header>
        <WorkspaceNav mobile />
        {management ? (
          <div className={styles.mobileManagement}>
            <ManagementNavigationLinks navigation={management} />
          </div>
        ) : null}
        <main
          className={styles.main}
          id="main"
          lang={translationLevel === "full" ? locale : "en-CA"}
        >
          <header
            className={styles.pageHeader}
            lang={translationLevel === "none" ? "en-CA" : locale}
          >
            <div>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1 lang={titleLanguage}>{title}</h1>
              {description ? <p className={styles.description}>{description}</p> : null}
            </div>
            <div
              className={styles.pageActions}
              lang={translationLevel === "full" ? locale : "en-CA"}
            >
              {actions}
            </div>
          </header>
          {error || actionError ? (
            <p className="error" lang="en-CA" role="alert">
              {error || actionError}
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export function WorkspacePage(props: WorkspaceShellProps) {
  return (
    <WorkspaceProvider>
      <WorkspaceShell {...props} />
    </WorkspaceProvider>
  );
}

export function WorkspaceFeatureGate({
  feature,
  children,
  fallbackHref = "/dashboard",
}: {
  feature: WorkspaceRolloutFeature;
  children: ReactNode;
  fallbackHref?: string;
}) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { productFeatures, loading, error } = useWorkspace();
  const resolved = productFeatures !== null || Boolean(error);
  const unavailable = resolved && (Boolean(error) || productFeatures?.[feature] !== true);

  useEffect(() => {
    if (!loading && resolved && unavailable) router.replace(fallbackHref);
  }, [fallbackHref, loading, resolved, router, unavailable]);

  if (loading || !resolved || unavailable) {
    return (
      <main className={styles.loading} id="main" lang={locale}>
        <div className={styles.loadingMark} aria-hidden="true" />
        <p>{t("workspace.loading")}</p>
      </main>
    );
  }

  return children;
}
