"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useLocale } from "../../components/locale-provider";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { PresentationTemplateGallery } from "../../components/workspace/presentation-template-gallery";
import { useWorkspace, WorkspaceProvider } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-content.module.css";
import galleryStyles from "../../components/workspace/template-gallery.module.css";

const types = ["rounds", "presentations", "surveys"] as const;
type TemplateType = (typeof types)[number];

function TemplatesWorkspace() {
  const { t } = useLocale();
  const { canEdit, productFeatures } = useWorkspace();
  const [type, setType] = useState<TemplateType>("rounds");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled =
    type === "rounds" ||
    (type === "presentations" ? productFeatures?.presentations : productFeatures?.surveys);
  const blankHref =
    type === "rounds"
      ? "/create?start=blank"
      : type === "presentations"
        ? "/create/presentation"
        : "/surveys/new";

  return (
    <WorkspaceShell
      actions={
        canEdit && enabled ? (
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
              onClick={() => setType(value)}
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
                setType(types[nextIndex]!);
                tabRefs.current[nextIndex]?.focus();
              }}
            >
              {t(`templateLibrary.${value}`)}
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
                    <h2 className={galleryStyles.sectionTitle}>{t(`templateLibrary.${value}`)}</h2>
                    <p>{t(`templateLibrary.${value}Description`)}</p>
                  </div>
                </div>
                {!enabled && value !== "rounds" ? (
                  <p className="notice">
                    {t(
                      value === "presentations"
                        ? "templateLibrary.presentationUnavailable"
                        : "templateLibrary.surveyUnavailable",
                    )}
                  </p>
                ) : null}
                {value === "presentations" ? (
                  <PresentationTemplateGallery />
                ) : (
                  <StarterGallery survey={value === "surveys"} />
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
  return (
    <WorkspaceProvider>
      <TemplatesWorkspace />
    </WorkspaceProvider>
  );
}
