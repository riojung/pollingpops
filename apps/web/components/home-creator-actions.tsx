"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useLocale } from "./locale-provider";
import { creatorLandingHref, type CreatorNavigationFeatures } from "./brand";
import { publicSiteShellCopy } from "../lib/i18n/public-site-shell-copy";

export function HomeCreatorActions() {
  const { locale, t } = useLocale();
  const copy = publicSiteShellCopy(locale);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [productFeatures, setProductFeatures] = useState<CreatorNavigationFeatures | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<{ productFeatures?: CreatorNavigationFeatures }>("/v1/auth/me")
      .then((account) => {
        if (active) {
          setSignedIn(true);
          setProductFeatures(account.productFeatures ?? null);
        }
      })
      .catch(() => {
        if (active) setSignedIn(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="hero-actions">
      <Link
        className="button"
        href={
          signedIn === false
            ? "/signin?mode=signup&returnTo=%2Fcreate"
            : creatorLandingHref(productFeatures)
        }
      >
        {signedIn === true ? copy.openWorkspace : copy.startCreating}
      </Link>
      <Link className="button-quiet" href="#how-it-works">
        {t("delivery.landing.howItWorks")}
      </Link>
    </div>
  );
}
