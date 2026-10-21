"use client";

import { NavigationLink as Link } from "./navigation-link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Brand,
  creatorLandingHref,
  creatorLibraryHref,
  type CreatorNavigationFeatures,
} from "./brand";
import { apiFetch, humanError } from "../lib/api";
import { useLocale } from "./locale-provider";
import {
  LogoutWarningNotice,
  ManagementNavigationLinks,
  useManagementNavigation,
} from "./management-navigation";

interface CreatorSummary {
  email: string;
}

type SessionState =
  | { status: "checking"; creator: null }
  | { status: "signed-out"; creator: null }
  | {
      status: "signed-in";
      creator: CreatorSummary;
      productFeatures: CreatorNavigationFeatures | null;
    };

export function SiteHeader() {
  const { t } = useLocale();
  const management = useManagementNavigation();
  const [session, setSession] = useState<SessionState>({ status: "checking", creator: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const mobileMenuId = useId();
  const menuToggle = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    apiFetch<{
      creator: CreatorSummary;
      productFeatures?: CreatorNavigationFeatures;
    }>("/v1/auth/me")
      .then(({ creator, productFeatures }) => {
        if (active) {
          setSession({
            status: "signed-in",
            creator,
            productFeatures: productFeatures ?? null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if ((error as { status?: number }).status === 401) {
          setSession({ status: "signed-out", creator: null });
          return;
        }
        setSession({ status: "signed-out", creator: null });
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await apiFetch("/v1/auth/logout", { method: "POST", body: "{}" });
      window.location.assign("/");
    } catch (error) {
      setSignOutError(humanError(error));
      setSigningOut(false);
    }
  }

  const workspaceSignedIn = session.status === "signed-in";
  const signedIn = workspaceSignedIn || management.user !== null;
  const email = workspaceSignedIn ? session.creator.email : management.user?.email;
  const libraryHref = creatorLibraryHref(workspaceSignedIn ? session.productFeatures : null);
  const brandHref = workspaceSignedIn
    ? creatorLandingHref(session.productFeatures)
    : signedIn && management.organizationManagementEnabled
      ? "/organization"
      : "/";

  return (
    <>
      <header
        className="shell topbar site-header"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !menuOpen) return;
          event.preventDefault();
          setMenuOpen(false);
          menuToggle.current?.focus();
        }}
      >
        <a className="skip-link" href="#main">
          {t("delivery.site.skip")}
        </a>
        <Brand href={brandHref} />
        <nav
          aria-busy={session.status === "checking" && management.loading}
          aria-label={t("delivery.site.primaryNavigation")}
          className="nav-links site-desktop-nav"
        >
          {signedIn ? (
            <>
              <span className="creator-identity" title={email}>
                {email}
              </span>
              {workspaceSignedIn ? (
                <Link href={libraryHref}>{t("delivery.site.myRounds")}</Link>
              ) : null}
              <Link href="/account">{t("delivery.site.account")}</Link>
              <button
                className="navigation-control"
                disabled={signingOut}
                onClick={() => void signOut()}
                type="button"
              >
                {signingOut ? t("delivery.site.signingOut") : t("delivery.site.signOut")}
              </button>
              {signOutError ? (
                <span className="site-nav-error" role="alert">
                  {signOutError}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <Link href="/pricing">{t("delivery.site.pricing")}</Link>
              <Link href="/privacy">{t("delivery.site.privacy")}</Link>
              <Link href="/signin">{t("delivery.site.signIn")}</Link>
            </>
          )}
          <ManagementNavigationLinks navigation={management} />
          <Link className="button small-button" href="/join">
            {t("delivery.site.joinRound")}
          </Link>
        </nav>
        <div className="site-mobile-actions">
          <Link
            className="button small-button"
            href={workspaceSignedIn ? libraryHref : signedIn ? "/account" : "/signin"}
          >
            {workspaceSignedIn
              ? t("delivery.site.myLibrary")
              : signedIn
                ? t("delivery.site.account")
                : t("delivery.site.signIn")}
          </Link>
          <button
            aria-controls={mobileMenuId}
            aria-expanded={menuOpen}
            className="button-quiet small-button"
            onClick={() => setMenuOpen((open) => !open)}
            ref={menuToggle}
            type="button"
          >
            {menuOpen ? t("delivery.site.close") : t("delivery.site.menu")}
          </button>
        </div>
        <nav
          aria-busy={session.status === "checking" && management.loading}
          aria-label={t("delivery.site.mobileNavigation")}
          className="site-mobile-nav"
          hidden={!menuOpen}
          id={mobileMenuId}
        >
          {signedIn ? (
            <>
              <div className="site-mobile-session">
                <span>{t("delivery.site.signedInAs")}</span>
                <strong>{email}</strong>
              </div>
              {workspaceSignedIn ? (
                <Link href={libraryHref}>{t("delivery.site.myRounds")}</Link>
              ) : null}
              <Link href="/account">{t("delivery.site.account")}</Link>
              <Link href="/pricing">{t("delivery.site.plans")}</Link>
              <button
                className="navigation-control"
                disabled={signingOut}
                onClick={() => void signOut()}
                type="button"
              >
                {signingOut ? t("delivery.site.signingOut") : t("delivery.site.signOut")}
              </button>
            </>
          ) : (
            <>
              <Link className="site-mobile-primary" href="/signin">
                {t("delivery.site.signInToCreate")}
              </Link>
              <Link href="/pricing">{t("delivery.site.pricing")}</Link>
              <Link href="/privacy">{t("delivery.site.privacy")}</Link>
            </>
          )}
          <ManagementNavigationLinks navigation={management} variant="sections" />
          <Link href="/join">{t("delivery.site.joinRound")}</Link>
          {signOutError ? (
            <p className="site-nav-error" role="alert">
              {signOutError}
            </p>
          ) : null}
        </nav>
      </header>
      <div className="shell">
        <LogoutWarningNotice navigation={management} />
      </div>
    </>
  );
}
