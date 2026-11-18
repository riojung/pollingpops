"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useSyncExternalStore } from "react";
import { useLocale } from "../../components/locale-provider";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { PresentationDesignGallery } from "../../components/workspace/presentation-design-gallery";
import { presentationDesignCopy } from "../../lib/i18n/presentation-design-copy";
import { PresentationTemplateGallery } from "../../components/workspace/presentation-template-gallery";
import { useWorkspace, WorkspaceProvider } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-content.module.css";
import galleryStyles from "../../components/workspace/template-gallery.module.css";
import { parseTemplateCollection, type TemplateCollectionId } from "../../lib/template-collections";
import { templateCollectionCopy } from "../../lib/i18n/template-collection-copy";
import { workspaceBlankCreationHref } from "../../components/workspace/workspace-creation-model";

const types = ["designs", "rounds", "presentations", "surveys"] as const;
type TemplateType = (typeof types)[number];

function subscribeToHashChange(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}
const getHash = () => window.location.hash;
const getServerHash = () => "";

function TemplatesWorkspace() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hash = useSyncExternalStore(subscribeToHashChange, getHash, getServerHash);
  const designCopy = presentationDesignCopy(locale);
  const { canEdit, productFeatures } = useWorkspace();
  const requestedType = searchParams.get("type");
  const type: TemplateType = types.some((value) => value === requestedType)
    ? (requestedType as TemplateType)
    : requestedType === null && hash === "#designs" && productFeatures?.presentations
      ? "designs"
      : "rounds";
  const collectionCopy = templateCollectionCopy(locale);
  const collection =
    type === "designs" ? null : parseTemplateCollection(searchParams.get("collection"));
  function selectType(next: TemplateType) {
    const query = new URLSearchParams(searchParams.toString());
    query.set("type", next);
    if (next === "designs") query.delete("collection");
    router.push(`/templates?${query}`, { scroll: false });
  }
  function selectCollection(next: TemplateCollectionId | null) {
    const query = new URLSearchParams(searchParams.toString());
    if (next) {
      query.set("collection", next);
      if (type === "designs") query.set("type", "rounds");
    } else query.delete("collection");
    router.push(`/templates?${query}`, { scroll: false });
  }
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled =
    type === "rounds" ||
    (type === "presentations" || type === "designs"
      ? productFeatures?.presentations
      : productFeatures?.surveys);
  const blankHref = workspaceBlankCreationHref(
    type === "rounds" ? "round" : type === "surveys" ? "survey" : "presentation",
    { canEdit, productFeatures },
  );

  return (
    <WorkspaceShell
      actions={
        blankHref ? (
          <Link className="button" href={blankHref}>
            {t("templateLibrary.startBlank")}
          </Link>
        ) : null
      }
      description={t("templateLibrary.description")}
      eyebrow={t("templateLibrary.eyebrow")}
      title={t("templateLibrary.title")}
      translationLevel="full"
    >
      <div className={styles.panel}>
        <section
          className={galleryStyles.collectionHeader}
          aria-labelledby="template-collection-heading"
          data-template-collection={collection ?? "all"}
        >
          <div>
            <h2 id="template-collection-heading" className={galleryStyles.sectionTitle}>
              {collectionCopy.label}
            </h2>
            {collection ? <p>{collectionCopy.description}</p> : null}
          </div>
          <div
            className={galleryStyles.collectionChoices}
            role="group"
            aria-label={collectionCopy.chooseCollection}
          >
            <button
              type="button"
              className={galleryStyles.collectionChoice}
              aria-pressed={collection === null}
              data-collection="all"
              onClick={() => selectCollection(null)}
            >
              {collectionCopy.allTemplates}
            </button>
            <button
              type="button"
              className={galleryStyles.collectionChoice}
              aria-pressed={collection === "team-meetings"}
              data-collection="team-meetings"
              onClick={() => selectCollection("team-meetings")}
            >
              {collectionCopy.title}
            </button>
          </div>
        </section>
        <div
          className={galleryStyles.tabs}
          role="tablist"
          aria-label={t("templateLibrary.typesLabel")}
        >
          {types.map((value, index) => (
            <button
              className={galleryStyles.tab}
              type="button"
              role="tab"
              key={value}
              id={`template-tab-${value}`}
              aria-controls={`template-panel-${value}`}
              aria-selected={type === value}
              tabIndex={type === value ? 0 : -1}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              onClick={() => selectType(value)}
              onKeyDown={(event) => {
                const nextIndex =
                  event.key === "ArrowRight"
                    ? (index + 1) % types.length
                    : event.key === "ArrowLeft"
                      ? (index + types.length - 1) % types.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? types.length - 1
                          : null;
                if (nextIndex === null) return;
                event.preventDefault();
                selectType(types[nextIndex]!);
                tabRefs.current[nextIndex]?.focus();
              }}
            >
              {value === "designs" ? designCopy.designs : t(`templateLibrary.${value}`)}
            </button>
          ))}
        </div>
        {types.map((value) => (
          <section
            key={value}
            id={`template-panel-${value}`}
            role="tabpanel"
            aria-labelledby={`template-tab-${value}`}
            hidden={type !== value}
          >
            {type === value ? (
              <>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={galleryStyles.sectionTitle}>
                      {value === "designs" ? designCopy.designs : t(`templateLibrary.${value}`)}
                    </h2>
                    <p>
                      {value === "designs"
                        ? designCopy.description
                        : t(`templateLibrary.${value}Description`)}
                    </p>
                  </div>
                </div>
                {!enabled && value !== "rounds" ? (
                  <p className="notice">
                    {t(
                      value === "presentations" || value === "designs"
                        ? "templateLibrary.presentationUnavailable"
                        : "templateLibrary.surveyUnavailable",
                    )}
                  </p>
                ) : null}
                {value === "designs" ? (
                  <PresentationDesignGallery />
                ) : value === "presentations" ? (
                  <PresentationTemplateGallery key={value} collection={collection} />
                ) : (
                  <StarterGallery
                    key={value}
                    survey={value === "surveys"}
                    collection={collection}
                  />
                )}
              </>
            ) : null}
          </section>
        ))}
      </div>
    </WorkspaceShell>
  );
}

export default function TemplatesPage() {
  const { locale, t } = useLocale();
  return (
    <WorkspaceProvider>
      <Suspense
        fallback={
          <p role="status" lang={locale}>
            {t("common.loading")}
          </p>
        }
      >
        <TemplatesWorkspace />
      </Suspense>
    </WorkspaceProvider>
  );
}
