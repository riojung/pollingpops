"use client";

import Link from "next/link";
import { presentationDesignCopy } from "../../lib/i18n/presentation-design-copy";
import { useLocale } from "../../components/locale-provider";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { WorkspacePage } from "../../components/workspace/workspace-shell";
import { useWorkspace } from "../../components/workspace/workspace-provider";
import hub from "../../components/workspace/workspace-hub.module.css";
import content from "../../components/workspace/workspace-content.module.css";

function PresentationCreateLink({ card = false }: { card?: boolean }) {
  const { t } = useLocale();
  const { productFeatures } = useWorkspace();
  if (!productFeatures?.presentations) return null;
  return card ? (
    <Link className={hub.quickCard} href="/create/presentation">
      <span className={hub.cardIcon} data-tone="violet">
        P
      </span>
      <h3>{t("pages.discover.presentation.title")}</h3>
      <p>{t("pages.discover.presentation.description")}</p>
      <span className={hub.cardLink}>{t("pages.discover.presentation.action")} →</span>
    </Link>
  ) : (
    <Link className={hub.heroPrimary} href="/create/presentation">
      {t("pages.discover.presentation.create")}
    </Link>
  );
}

function PresentationDesignLink() {
  const { locale } = useLocale();
  const { productFeatures } = useWorkspace();
  if (!productFeatures?.presentations) return null;
  return (
    <Link className="button-quiet" href="/templates#designs">
      {presentationDesignCopy(locale).browseDesigns}
    </Link>
  );
}

function RoundSourceLink({ card = false }: { card?: boolean }) {
  const { t } = useLocale();
  const { productFeatures } = useWorkspace();
  if (!productFeatures?.builderV2) return null;
  return card ? (
    <Link className={hub.quickCard} href="/create?start=source">
      <span className={hub.cardIcon} data-tone="coral">
        S
      </span>
      <h3>{t("pages.discover.source.title")}</h3>
      <p>{t("pages.discover.source.description")}</p>
      <span className={hub.cardLink}>{t("pages.discover.source.action")} →</span>
    </Link>
  ) : (
    <Link className={hub.heroSecondary} href="/create?start=source">
      {t("pages.discover.source.create")}
    </Link>
  );
}

export default function DiscoverPage() {
  const { t } = useLocale();
  return (
    <WorkspacePage
      actions={
        <Link className="button-quiet" href="/templates">
          {t("pages.discover.browseTemplates")}
        </Link>
      }
      description={t("page.discover.description")}
      eyebrow={t("page.discover.eyebrow")}
      requiredFeature="discover"
      title={t("page.discover.title")}
      translationLevel="full"
    >
      <section className={hub.hero}>
        <div className={hub.heroContent}>
          <p className={hub.heroEyebrow}>{t("pages.discover.hero.eyebrow")}</p>
          <h2>{t("pages.discover.hero.title")}</h2>
          <p>{t("pages.discover.hero.description")}</p>
          <div className={hub.heroActions}>
            <PresentationCreateLink />
            <RoundSourceLink />
          </div>
        </div>
      </section>

      <section className={hub.section}>
        <div className={hub.sectionHeading}>
          <div>
            <h2>{t("pages.discover.explore.title")}</h2>
            <p>{t("pages.discover.explore.description")}</p>
          </div>
          <PresentationDesignLink />
        </div>
        <div className={hub.cardGrid}>
          <Link className={hub.quickCard} href="/templates">
            <span className={hub.cardIcon}>D</span>
            <h3>{t("pages.discover.diagnose.title")}</h3>
            <p>{t("pages.discover.diagnose.description")}</p>
            <span className={hub.cardLink}>{t("pages.discover.diagnose.action")} →</span>
          </Link>
          <PresentationCreateLink card />
          <RoundSourceLink card />
        </div>
      </section>

      <section className={`${hub.section} ${content.panel}`}>
        <div className={hub.sectionHeading}>
          <div>
            <p className={hub.sectionEyebrow}>{t("pages.discover.library.eyebrow")}</p>
            <h2>{t("pages.discover.library.title")}</h2>
            <p>{t("pages.discover.library.description")}</p>
          </div>
          <Link href="/templates">{t("pages.common.seeAll")}</Link>
        </div>
        <StarterGallery compact />
      </section>
    </WorkspacePage>
  );
}
