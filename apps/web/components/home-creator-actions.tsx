"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useLocale } from "./locale-provider";
import { creatorLandingHref, type CreatorNavigationFeatures } from "./brand";

export function HomeCreatorActions() {
  const { t } = useLocale();
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
        href={signedIn === false ? "/signin" : creatorLandingHref(productFeatures)}
      >
        {signedIn === true
          ? t("delivery.landing.manage")
          : signedIn === false
            ? t("delivery.landing.create")
            : t("delivery.landing.createOrManage")}
      </Link>
      <Link className="button-quiet" href="#how-it-works">
        {t("delivery.landing.howItWorks")}
      </Link>
    </div>
  );
}
