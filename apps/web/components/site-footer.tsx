"use client";

import Link from "next/link";
import { Brand } from "./brand";
import { useLocale } from "./locale-provider";
import { publicSiteShellCopy } from "../lib/i18n/public-site-shell-copy";
import { publicProductNavigation } from "../lib/public-product-content";
import styles from "./public-site-shell.module.css";

export function SiteFooter() {
  const { locale, t } = useLocale();
  const copy = publicSiteShellCopy(locale);
  const productLinks = publicProductNavigation.filter((feature) =>
    ["live-polls", "quizzes", "presentations", "surveys"].includes(feature.slug),
  );

  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Brand />
          <p className={styles.footerTagline}>{copy.footerTagline}</p>
          <p className={styles.communityNote}>{copy.communityNote}</p>
        </div>
        <nav aria-label={copy.product} className={styles.footerGroup}>
          <h2>{copy.product}</h2>
          <Link href="/product">{copy.productOverview}</Link>
          {productLinks.map((feature) => (
            <Link href={feature.href} key={feature.slug} lang="en-CA">
              {feature.title}
            </Link>
          ))}
        </nav>
        <nav aria-label={copy.resources} className={styles.footerGroup}>
          <h2>{copy.resources}</h2>
          <Link href="/solutions">{copy.useCases}</Link>
          <Link href="/examples">{copy.templates}</Link>
          <Link href="/resources">{copy.resources}</Link>
          <Link href="/pricing">{copy.plans}</Link>
        </nav>
        <nav aria-label={t("delivery.site.legalLinks")} className={styles.footerGroup}>
          <h2>{copy.trust}</h2>
          <Link href="/privacy">{t("delivery.site.privacy")}</Link>
          <Link href="/terms">{t("delivery.site.terms")}</Link>
          <Link href="/status">{t("delivery.site.status")}</Link>
        </nav>
        <div className={styles.footerBottom}>
          <span>{t("delivery.site.project", { year: new Date().getFullYear() })}</span>
          <span aria-hidden="true" className={styles.footerPops}>
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </footer>
  );
}
