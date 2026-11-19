"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NavigationLink as Link } from "./navigation-link";
import {
  Brand,
  creatorLandingHref,
  creatorLibraryHref,
  type CreatorNavigationFeatures,
} from "./brand";
import { apiFetch, humanError } from "../lib/api";
import { publicProductNavigation } from "../lib/public-product-content";
import { publicSiteShellCopy } from "../lib/i18n/public-site-shell-copy";
import { useLocale } from "./locale-provider";
import { JoinCodeForm } from "./join-code-form";
import { ColorModeMenu } from "./workspace/color-mode-menu";
import {
  LogoutWarningNotice,
  ManagementNavigationLinks,
  useManagementNavigation,
} from "./management-navigation";
import styles from "./public-site-shell.module.css";

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

function Chevron() {
  return (
    <svg aria-hidden="true" className={styles.chevron} viewBox="0 0 16 16">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function SiteHeader() {
  const { locale, t } = useLocale();
  const copy = publicSiteShellCopy(locale);
  const management = useManagementNavigation();
  const [session, setSession] = useState<SessionState>({ status: "checking", creator: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [previewSlug, setPreviewSlug] = useState(publicProductNavigation[0]?.slug);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const navigationId = useId();
  const productId = useId();
  const joinId = useId();
  const joinInputId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const productToggle = useRef<HTMLButtonElement>(null);
  const joinToggle = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    setMenuOpen(false);
    setProductOpen(false);
    setJoinOpen(false);
    if (accountRef.current) accountRef.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setProductOpen(false);
        setMenuOpen(false);
        setJoinOpen(false);
        if (accountRef.current) accountRef.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

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
      .catch(() => {
        if (active) setSession({ status: "signed-out", creator: null });
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
  const workspaceHref = creatorLandingHref(workspaceSignedIn ? session.productFeatures : null);
  const brandHref = workspaceSignedIn
    ? workspaceHref
    : signedIn && management.organizationManagementEnabled
      ? "/organization"
      : "/";
  const preview =
    publicProductNavigation.find((feature) => feature.slug === previewSlug) ??
    publicProductNavigation[0];

  return (
    <>
      <div className={styles.headerSurface}>
        <header
          className={styles.header}
          data-menu-open={menuOpen}
          data-join-open={joinOpen}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            if (productOpen) {
              event.preventDefault();
              setProductOpen(false);
              productToggle.current?.focus();
            } else if (joinOpen) {
              event.preventDefault();
              setJoinOpen(false);
              joinToggle.current?.focus();
            } else if (menuOpen) {
              event.preventDefault();
              setMenuOpen(false);
              menuToggle.current?.focus();
            }
          }}
          ref={headerRef}
        >
          <a className="skip-link" href="#main">
            {t("delivery.site.skip")}
          </a>
          <Brand href={brandHref} />
          <nav
            aria-busy={session.status === "checking" && management.loading}
            aria-label={t("delivery.site.primaryNavigation")}
            className={styles.primaryNav}
            id={navigationId}
          >
            <div className={styles.productDisclosure}>
              <button
                aria-controls={productId}
                aria-expanded={productOpen}
                className={styles.navButton}
                data-current={
                  pathname === "/product" || pathname?.startsWith("/product/") || undefined
                }
                onClick={() => {
                  setProductOpen((open) => !open);
                  if (accountRef.current) accountRef.current.open = false;
                }}
                ref={productToggle}
                type="button"
              >
                {copy.product}
                <Chevron />
              </button>
              <div className={styles.productPanel} hidden={!productOpen} id={productId}>
                <div className={styles.productLinks}>
                  <Link className={styles.productOverview} href="/product">
                    {copy.productOverview}
                    <span aria-hidden="true">↗</span>
                  </Link>
                  <div className={styles.featureGrid} lang="en-CA">
                    {publicProductNavigation.map((feature, index) => (
                      <Link
                        className={styles.featureLink}
                        href={feature.href}
                        key={feature.slug}
                        onFocus={() => setPreviewSlug(feature.slug)}
                        onMouseEnter={() => setPreviewSlug(feature.slug)}
                      >
                        <span
                          aria-hidden="true"
                          className={styles.featureGlyph}
                          data-tone={index % 3}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span>
                          <strong>{feature.title}</strong>
                          <small>{feature.shortDescription}</small>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
                {preview ? (
                  <aside className={styles.featurePreview}>
                    <p className={styles.previewEyebrow}>{copy.previewEyebrow}</p>
                    <div aria-hidden="true" className={styles.previewArtwork}>
                      <span className={styles.artworkSpark}>✦</span>
                      <div className={styles.artworkCard}>
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <span className={styles.artworkBubble}>•••</span>
                    </div>
                    <div className={styles.previewCopy} lang="en-CA">
                      <strong>{preview.title}</strong>
                      <p>{preview.shortDescription}</p>
                    </div>
                    <Link className={styles.previewLink} href="/product">
                      {copy.exploreProduct}
                      <span aria-hidden="true">→</span>
                    </Link>
                  </aside>
                ) : null}
              </div>
            </div>
            <Link href="/solutions" match="section">
              {copy.useCases}
            </Link>
            <Link href="/examples" match="section">
              {copy.templates}
            </Link>
            <Link href="/pricing">{copy.plans}</Link>
            <Link href="/resources" match="section">
              {copy.resources}
            </Link>
          </nav>
          <div className={styles.sessionControls}>
            {signedIn ? (
              <>
                {workspaceSignedIn ? (
                  <Link className={styles.workspaceLink} href={workspaceHref}>
                    {copy.openWorkspace}
                  </Link>
                ) : null}
                <details
                  className={styles.accountMenu}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || !event.currentTarget.open) return;
                    event.preventDefault();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }}
                  onToggle={(event) => {
                    if (event.currentTarget.open) setProductOpen(false);
                  }}
                  ref={accountRef}
                >
                  <summary className={styles.accountTrigger}>
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
                    </svg>
                    <span className={styles.accountLabel}>{t("delivery.site.account")}</span>
                    <Chevron />
                  </summary>
                  <div className={styles.accountPanel}>
                    <div className={styles.identity}>
                      <span>{t("delivery.site.signedInAs")}</span>
                      <strong>{email}</strong>
                    </div>
                    {workspaceSignedIn ? (
                      <Link href={libraryHref}>{t("delivery.site.myRounds")}</Link>
                    ) : null}
                    <Link href="/account">{t("delivery.site.account")}</Link>
                    <ManagementNavigationLinks navigation={management} variant="sections" />
                    <button
                      className="navigation-control"
                      disabled={signingOut}
                      onClick={() => void signOut()}
                      type="button"
                    >
                      {signingOut ? t("delivery.site.signingOut") : t("delivery.site.signOut")}
                    </button>
                    {signOutError ? (
                      <p className={styles.navError} role="alert">
                        {signOutError}
                      </p>
                    ) : null}
                  </div>
                </details>
              </>
            ) : (
              <Link href="/signin">{t("delivery.site.signIn")}</Link>
            )}
          </div>
          <div className={styles.appearance}>
            <span>{t("appearance.label")}</span>
            <ColorModeMenu />
          </div>
          <button
            aria-controls={navigationId}
            aria-expanded={menuOpen}
            className={styles.menuToggle}
            onClick={() => {
              setMenuOpen((open) => !open);
              setJoinOpen(false);
              setProductOpen(false);
            }}
            ref={menuToggle}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              {menuOpen ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
            <span className="sr-only">
              {menuOpen ? t("delivery.site.close") : t("delivery.site.menu")}
            </span>
          </button>
          <button
            aria-controls={joinId}
            aria-expanded={joinOpen}
            className={styles.joinToggle}
            onClick={() => {
              const opening = !joinOpen;
              setJoinOpen(opening);
              setMenuOpen(false);
              setProductOpen(false);
              if (opening)
                requestAnimationFrame(() => document.getElementById(joinInputId)?.focus());
            }}
            ref={joinToggle}
            type="button"
          >
            {copy.join}
          </button>
          <div className={styles.joinArea} id={joinId}>
            <span className={styles.joinLabel}>{copy.joinLabel}</span>
            <JoinCodeForm
              className={styles.joinForm}
              codeLabel={copy.codeLabel}
              formLabel={copy.joinLabel}
              id={joinInputId}
              submitLabel={copy.join}
            />
            <p className={styles.joinHelp}>{copy.joinHelp}</p>
          </div>
        </header>
      </div>
      <div className="shell">
        <LogoutWarningNotice navigation={management} />
      </div>
    </>
  );
}
