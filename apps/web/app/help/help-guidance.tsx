"use client";

import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
import { useWorkspace } from "../../components/workspace/workspace-provider";
import { VideoGuide } from "../../components/workspace/video-guide";
import guideStyles from "../../components/workspace/video-guide.module.css";
import styles from "../../components/workspace/workspace-hub.module.css";
import { helpVideoScripts } from "../../lib/help-video-scripts";
import videoMetadata from "../../lib/help-video-metadata.json";
import {
  professionalBuilderGuidesAvailable,
  professionalRoundBuilderAvailable,
} from "../../lib/help-guide-availability";

const quickStartTranscript = helpVideoScripts.quickStart.map((scene) => scene.narration);
const builderGuideTranscript = helpVideoScripts.userGuide.map((scene) => scene.narration);

export function HelpGuidance() {
  const { t } = useLocale();
  const { canEdit, productFeatures } = useWorkspace();
  const showProfessionalVideos = professionalBuilderGuidesAvailable(productFeatures);
  const roundBuilderAvailable = professionalRoundBuilderAvailable(productFeatures);
  const workspaceAvailable = productFeatures?.workspaceShell === true;
  const assignmentsAvailable = productFeatures?.practiceAssignments === true;
  const createHref = roundBuilderAvailable ? "/create?start=starters" : "/dashboard";
  const libraryHref = workspaceAvailable ? "/library" : "/dashboard";
  const fallbackHref = canEdit ? createHref : libraryHref;

  return (
    <>
      <section
        aria-labelledby="video-guides-title"
        className={`${styles.section} ${guideStyles.section}`}
        id="video-guides"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="video-guides-title">
              {roundBuilderAvailable
                ? t("pages.help.guides.title")
                : t("pages.help.guides.currentTitle")}
            </h2>
            <p>
              {roundBuilderAvailable
                ? t("pages.help.guides.description")
                : t("pages.help.guides.currentDescription")}
            </p>
          </div>
        </div>

        {roundBuilderAvailable ? (
          <>
            <div className={guideStyles.grid}>
              <VideoGuide
                captionsSrc="/guides/polling-pops-quick-start.vtt"
                chapters={videoMetadata.quickStart.chapters}
                description={t("pages.help.quickStart.description")}
                duration={videoMetadata.quickStart.duration}
                id="quick-start"
                posterSrc="/guides/polling-pops-quick-start-poster.jpg"
                title={t("pages.help.quickStart.title")}
                transcript={quickStartTranscript}
                tryHref={canEdit ? "/create?start=blank" : "/library"}
                tryLabel={canEdit ? t("pages.help.quickStart.try") : t("pages.common.openLibrary")}
                videoSrc="/guides/polling-pops-quick-start.mp4"
              />
              {showProfessionalVideos ? (
                <VideoGuide
                  captionsSrc="/guides/polling-pops-user-guide.vtt"
                  chapters={videoMetadata.userGuide.chapters}
                  description={t("pages.help.builder.description")}
                  duration={videoMetadata.userGuide.duration}
                  id="round-builder-guide"
                  posterSrc="/guides/polling-pops-user-guide-poster.jpg"
                  title={t("pages.help.builder.title")}
                  transcript={builderGuideTranscript}
                  tryHref={canEdit ? "/create?start=blank" : "/library"}
                  tryLabel={canEdit ? t("pages.help.builder.try") : t("pages.common.openLibrary")}
                  videoSrc="/guides/polling-pops-user-guide.mp4"
                />
              ) : (
                <p className={styles.notice}>{t("pages.help.hiddenVideos")}</p>
              )}
            </div>
          </>
        ) : (
          <div className={styles.notice}>
            <strong>
              {roundBuilderAvailable
                ? t("pages.help.enabledBuilder")
                : t("pages.help.classicWorkflow")}
            </strong>{" "}
            {t("pages.help.hiddenVideos")}
            <div className={guideStyles.noticeAction}>
              <Link className="button" href={fallbackHref}>
                {canEdit
                  ? roundBuilderAvailable
                    ? t("pages.library.createRound")
                    : t("pages.help.openDashboard")
                  : workspaceAvailable
                    ? t("pages.common.openLibrary")
                    : t("pages.help.openDashboard")}
              </Link>
            </div>
          </div>
        )}
      </section>

      <section className={styles.cardGrid}>
        <Link className={styles.quickCard} href="/help/first-round">
          <span className={styles.cardIcon}>01</span>
          <h3>{t("pages.help.card.createTitle")}</h3>
          <p>
            {roundBuilderAvailable
              ? t("pages.help.card.createDescription")
              : t("pages.help.card.classicDescription")}
          </p>
          <span className={styles.cardLink}>{t("pages.help.card.openGuide")} →</span>
        </Link>
        <Link
          className={styles.quickCard}
          href={assignmentsAvailable ? "/help/practice" : "/help/hosting-and-qr"}
        >
          <span className={styles.cardIcon} data-tone="coral">
            02
          </span>
          <h3>
            {assignmentsAvailable
              ? t("pages.help.card.hostAssignTitle")
              : t("pages.help.card.hostTitle")}
          </h3>
          <p>
            {assignmentsAvailable
              ? t("pages.help.card.hostAssignDescription")
              : t("pages.help.card.hostDescription")}
          </p>
          <span className={styles.cardLink}>{t("pages.help.card.readGuide")} →</span>
        </Link>
        <Link className={styles.quickCard} href="/help/reports">
          <span className={styles.cardIcon} data-tone="violet">
            03
          </span>
          <h3>{t("pages.help.card.recoveryTitle")}</h3>
          <p>{t("pages.help.card.recoveryDescription")}</p>
          <span className={styles.cardLink}>{t("pages.help.card.readGuide")} →</span>
        </Link>
      </section>
    </>
  );
}
