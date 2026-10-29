"use client";

import { GuardedLink as Link, useConfirmNavigation } from "../navigation-guard";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CreatorBrand, creatorLandingHref } from "../brand";
import { useLocale } from "../locale-provider";
import { humanError } from "../../lib/api";
import { librarySearchHref } from "../../lib/library-controls";
import type { MessageKey } from "../../lib/i18n/catalog";
import { ColorModeMenu } from "./color-mode-menu";
import { LanguageMenu } from "./language-menu";
import { FeedbackButton } from "./feedback-button";
import { ManagementNavigationLinks } from "../management-navigation";
import { customerManagementLinks } from "../../lib/management-navigation";
import type { ManagementNavigationState } from "../management-navigation";
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
  | "help"
  | "collapse"
  | "expand"
  | "signOut"
  | "upgrade"
  | "billing"
  | "settings";

export const SIDEBAR_PREFERENCE_KEY = "pollingpops:sidebar-collapsed:v1";

export function readSidebarCollapsed() {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(collapsed));
  } catch {
    // The current page still works when browser storage is unavailable.
  }
}

const destinations: Array<{
  href: string;
  icon: IconName;
  label: MessageKey;
  match: (path: string) => boolean;
  feature?: "discover" | "groups" | "ideaBoards";
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
    href: "/boards",
    icon: "library",
    label: "workspace.nav.boards",
    match: (path) => path.startsWith("/boards"),
    feature: "ideaBoards",
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
    case "collapse":
    case "expand":
      return (
        <svg {...common}>
          <rect height="16" rx="2" width="20" x="2" y="4" />
          <path d="M8 4v16" />
          <path d={name === "collapse" ? "m16 9-3 3 3 3" : "m13 9 3 3-3 3"} />
        </svg>
      );
    case "signOut":
      return (
        <svg {...common}>
          <path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4" />
        </svg>
      );
    case "upgrade":
      return (
        <svg {...common}>
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />
        </svg>
      );
    case "billing":
      return (
        <svg {...common}>
          <rect height="14" rx="2" width="20" x="2" y="5" />
          <path d="M2 10h20M6 15h4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
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
  /** Compatibility name: requires the baseline shell, independently of UX beta. */
  requireBeta?: boolean;
  requiredFeature?: WorkspaceRolloutFeature;
  featureFallbackHref?: string;
  translationLevel?: "none" | "header" | "full";
}

export type WorkspaceRolloutFeature =
  "workspaceShell" | "builderV2" | "presentations" | "groups" | "discover";

export function WorkspaceNav({
  mobile = false,
  collapsed = false,
}: {
  mobile?: boolean;
  collapsed?: boolean;
}) {
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
              aria-label={collapsed && !mobile ? t(destination.label) : undefined}
              data-sidebar-hint={collapsed && !mobile ? t(destination.label) : undefined}
              title={collapsed && !mobile ? t(destination.label) : undefined}
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
              {mobile ? (
                t(destination.label)
              ) : (
                <span className={styles.sidebarLabel}>{t(destination.label)}</span>
              )}
            </Link>
          );
        })}
    </nav>
  );
}

const managementRailItems: Record<string, { icon: IconName; label: MessageKey }> = {
  organization: { icon: "workspace", label: "workspace.sidebar.organization" },
  workspaces: { icon: "library", label: "workspace.sidebar.workspaces" },
  members: { icon: "groups", label: "workspace.sidebar.members" },
  billing: { icon: "billing", label: "workspace.sidebar.billing" },
  credits: { icon: "upgrade", label: "workspace.sidebar.credits" },
  settings: { icon: "settings", label: "workspace.sidebar.settings" },
};

export function WorkspaceManagementRail({ navigation }: { navigation: ManagementNavigationState }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const links = customerManagementLinks(navigation);
  if (!links.length) return null;
  return (
    <nav className={styles.managementRail} aria-label={t("workspace.sidebar.management")}>
      {links.map((link) => {
        const item = managementRailItems[link.id];
        const label = item ? t(item.label) : link.label;
        return (
          <Link
            aria-current={link.href === pathname ? "page" : undefined}
            aria-label={label}
            className={styles.navLink}
            data-sidebar-hint={label}
            href={link.href}
            key={link.id}
            title={label}
          >
            <ShellIcon name={item?.icon ?? "workspace"} />
            <span className={styles.srOnly}>{label}</span>
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

function WorkspaceAccessState({ error, retry }: { error: string; retry: () => Promise<void> }) {
  const { locale, t } = useLocale();
  return (
    <main className={styles.loading} id="main" lang={locale}>
      {error ? (
        <>
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
          <button className="button-quiet" onClick={() => void retry()} type="button">
            {t("workspace.retry")}
          </button>
        </>
      ) : (
        <>
          <div className={styles.loadingMark} aria-hidden="true" />
          <p>{t("workspace.loading")}</p>
        </>
      )}
    </main>
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
  featureFallbackHref,
  translationLevel = "none",
}: WorkspaceShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const confirmNavigation = useConfirmNavigation();
  const { locale, t } = useLocale();
  const {
    creator,
    workspace,
    entitlements,
    productFeatures,
    loading,
    error,
    canEdit,
    signOut,
    startUpgrade,
    management,
    refreshAccount,
  } = useWorkspace();
  const [actionError, setActionError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHint, setSidebarHint] = useState<{ label: string; top: number } | null>(null);
  const workspaceAccessUnavailable =
    Boolean(error) ||
    (requireBeta && productFeatures?.workspaceShell !== true) ||
    (requiredFeature !== undefined && productFeatures?.[requiredFeature] !== true);
  const resolvedFallbackHref =
    featureFallbackHref ??
    (requiredFeature === "builderV2" ? "/dashboard" : creatorLandingHref(productFeatures));
  const shouldReturnToFallback =
    !loading && !error && productFeatures !== null && workspaceAccessUnavailable;

  useEffect(() => {
    if (shouldReturnToFallback) {
      router.replace(resolvedFallbackHref);
    }
  }, [resolvedFallbackHref, router, shouldReturnToFallback]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSidebarCollapsed(readSidebarCollapsed());
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== SIDEBAR_PREFERENCE_KEY && event.key !== null) return;
      setSidebarCollapsed(readSidebarCollapsed());
      setSidebarHint(null);
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  if (loading || workspaceAccessUnavailable) {
    return <WorkspaceAccessState error={error} retry={refreshAccount} />;
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmNavigation()) return;
    router.push(librarySearchHref(globalSearch, window.location.pathname, window.location.search));
  }

  const workspaceLabel =
    workspace?.organization?.name ?? workspace?.name ?? t("workspace.switcher.current");
  const effectivePlan = entitlements?.plan ?? creator?.plan;
  const organizationRole = workspace?.organization?.role;
  const identityRole =
    organizationRole === "admin" || organizationRole === "billing" || organizationRole === "member"
      ? t(`customer.role.${organizationRole}`)
      : creator
        ? t(`role.${organizationRole ?? creator.role}`)
        : "";
  const accountInitial = creator?.email?.trim().charAt(0).toUpperCase() || "O";
  const accountDescription =
    creator && effectivePlan
      ? workspace?.planSource === "community"
        ? `${identityRole} · ${t("customer.plan.community")}`
        : t("workspace.identity", { role: identityRole, plan: t(`plan.${effectivePlan}`) })
      : "";
  const sidebarAction = t(
    sidebarCollapsed ? "workspace.sidebar.expand" : "workspace.sidebar.collapse",
  );

  function showSidebarHint(target: EventTarget | null) {
    if (!sidebarCollapsed || !(target instanceof Element)) return;
    const control = target.closest<HTMLElement>("[data-sidebar-hint]");
    const label = control?.dataset.sidebarHint;
    if (!control || !label) {
      setSidebarHint(null);
      return;
    }
    const bounds = control.getBoundingClientRect();
    setSidebarHint({
      label,
      top: Math.max(24, Math.min(window.innerHeight - 24, bounds.top + bounds.height / 2)),
    });
  }

  return (
    <div className={styles.workspace} data-sidebar-collapsed={sidebarCollapsed}>
      <a className={styles.skipLink} href="#main" lang={locale}>
        {t("workspace.skipToMain")}
      </a>
      <aside
        aria-label={t("workspace.sidebar.label")}
        className={styles.sidebar}
        data-collapsed={sidebarCollapsed}
        lang={locale}
        onFocusCapture={(event) => showSidebarHint(event.target)}
        onBlurCapture={() => setSidebarHint(null)}
        onMouseOver={(event) => showSidebarHint(event.target)}
        onMouseLeave={() => setSidebarHint(null)}
        onScrollCapture={() => setSidebarHint(null)}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") setSidebarHint(null);
        }}
      >
        <div className={styles.brandWrap}>
          <CreatorBrand productFeatures={productFeatures} />
          <button
            aria-controls="workspace-sidebar-navigation"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarAction}
            className={styles.sidebarToggle}
            data-sidebar-hint={sidebarCollapsed ? sidebarAction : undefined}
            onClick={() => {
              const collapsed = !sidebarCollapsed;
              setSidebarCollapsed(collapsed);
              setSidebarHint(null);
              saveSidebarCollapsed(collapsed);
            }}
            title={sidebarAction}
            type="button"
          >
            <ShellIcon name={sidebarCollapsed ? "expand" : "collapse"} />
          </button>
        </div>
        <div className={styles.sidebarNavigation} id="workspace-sidebar-navigation">
          <WorkspaceNav collapsed={sidebarCollapsed} />
          {management ? (
            sidebarCollapsed ? (
              <WorkspaceManagementRail navigation={management} />
            ) : (
              <ManagementNavigationLinks navigation={management} variant="sections" />
            )
          ) : null}
        </div>
        <div className={styles.sidebarFooter}>
          {sidebarCollapsed ? (
            <Link
              aria-describedby={
                accountDescription ? "workspace-sidebar-account-description" : undefined
              }
              aria-label={`${t("workspace.accountSettings")}${creator?.email ? `: ${creator.email}` : ""}`}
              className={styles.sidebarAccount}
              data-sidebar-hint={
                [creator?.email, accountDescription].filter(Boolean).join(" · ") ||
                t("workspace.accountSettings")
              }
              href="/account"
              title={creator?.email}
            >
              <span aria-hidden="true">{accountInitial}</span>
              <span className={styles.srOnly} id="workspace-sidebar-account-description">
                {accountDescription}
              </span>
            </Link>
          ) : (
            <p className={styles.identity} title={creator?.email}>
              <strong>{creator?.email}</strong>
              <span>{accountDescription}</span>
            </p>
          )}
          <div className={styles.accountActions}>
            {effectivePlan === "free" && !workspace?.organization ? (
              <button
                className={styles.textButton}
                aria-label={sidebarCollapsed ? t("workspace.explorePro") : undefined}
                data-sidebar-hint={sidebarCollapsed ? t("workspace.explorePro") : undefined}
                title={sidebarCollapsed ? t("workspace.explorePro") : undefined}
                onClick={() => {
                  setActionError("");
                  void startUpgrade().catch((caught) => setActionError(humanError(caught)));
                }}
                type="button"
              >
                <ShellIcon name="upgrade" />
                <span className={styles.sidebarLabel}>{t("workspace.explorePro")}</span>
              </button>
            ) : null}
            <button
              className={styles.textButton}
              aria-label={sidebarCollapsed ? t("workspace.signOut") : undefined}
              data-sidebar-hint={sidebarCollapsed ? t("workspace.signOut") : undefined}
              title={sidebarCollapsed ? t("workspace.signOut") : undefined}
              onClick={() => {
                setActionError("");
                void signOut().catch((caught) => setActionError(humanError(caught)));
              }}
              type="button"
            >
              <ShellIcon name="signOut" />
              <span className={styles.sidebarLabel}>{t("workspace.signOut")}</span>
            </button>
          </div>
        </div>
      </aside>
      {sidebarCollapsed && sidebarHint ? (
        <span aria-hidden="true" className={styles.sidebarTooltip} style={{ top: sidebarHint.top }}>
          {sidebarHint.label}
        </span>
      ) : null}
      <div className={styles.contentColumn}>
        <header className={styles.topHeader} lang={locale}>
          <div className={styles.mobileBrand}>
            <CreatorBrand productFeatures={productFeatures} />
          </div>
          <Link
            aria-current={pathname.startsWith("/account") ? "page" : undefined}
            className={styles.workspaceSwitch}
            href="/account"
          >
            <ShellIcon name="workspace" />
            <span>
              <small>
                {t(
                  workspace?.organization
                    ? "customer.organization.label"
                    : "workspace.switcher.label",
                )}
              </small>
              <strong>{workspaceLabel}</strong>
              {workspace ? (
                <em className={styles.workspaceDetail}>
                  {workspace.organization ? workspace.name : t("customer.personal")}
                </em>
              ) : null}
            </span>
          </Link>
          <form className={styles.globalSearch} onSubmit={submitSearch} role="search">
            <label className={styles.srOnly} htmlFor="workspace-search">
              {t(
                pathname === "/sessions"
                  ? "pages.sessions.workspaceSearch"
                  : "workspace.search.label",
              )}
            </label>
            <ShellIcon name="search" />
            <input
              autoComplete="off"
              id="workspace-search"
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder={t(
                pathname === "/sessions"
                  ? "pages.sessions.workspaceSearch"
                  : "workspace.search.placeholder",
              )}
              type="search"
              value={globalSearch}
            />
          </form>
          <div className={styles.topActions}>
            {canEdit && productFeatures ? <CreateMenu productFeatures={productFeatures} /> : null}
            <LanguageMenu />
            <ColorModeMenu />
            <Link
              aria-current={pathname === "/activity" ? "page" : undefined}
              className={styles.utilityAction}
              href="/activity"
              title={t("workspace.activityTitle")}
            >
              <ShellIcon name="activity" />
              <span className={styles.utilityLabel}>{t("workspace.activity")}</span>
            </Link>
            <Link
              aria-current={
                pathname === "/help" || pathname.startsWith("/help/") ? "page" : undefined
              }
              className={styles.utilityAction}
              href="/help"
              title={t("workspace.help")}
            >
              <ShellIcon name="help" />
              <span className={styles.utilityLabel}>{t("workspace.help")}</span>
            </Link>
            <FeedbackButton />
            <Link
              aria-current={pathname.startsWith("/account") ? "page" : undefined}
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
  fallbackHref,
}: {
  feature: WorkspaceRolloutFeature;
  children: ReactNode;
  fallbackHref?: string;
}) {
  const router = useRouter();
  const { productFeatures, loading, error, refreshAccount } = useWorkspace();
  const resolvedFallbackHref =
    fallbackHref ?? (feature === "builderV2" ? "/dashboard" : creatorLandingHref(productFeatures));
  const resolved = productFeatures !== null;
  const unavailable = resolved && productFeatures?.[feature] !== true;

  useEffect(() => {
    if (!loading && !error && resolved && unavailable) router.replace(resolvedFallbackHref);
  }, [resolvedFallbackHref, loading, error, resolved, router, unavailable]);

  if (loading || error || !resolved || unavailable) {
    return <WorkspaceAccessState error={error} retry={refreshAccount} />;
  }

  return children;
}
