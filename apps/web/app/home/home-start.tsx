import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
import { useWorkspace } from "../../components/workspace/workspace-provider";
import {
  workspaceCreationGoals,
  workspaceCreationOptions,
} from "../../components/workspace/workspace-creation-model";
import { creationGoalMessages } from "../../lib/i18n/creation-goal-messages";
import { homeStartCopy } from "../../lib/i18n/home-start-copy";
import { HomeIcon } from "./home-icon";
import styles from "./home.module.css";

export function HomeStart() {
  const { locale, t } = useLocale();
  const { canEdit, productFeatures } = useWorkspace();
  const options = workspaceCreationOptions({ canEdit, productFeatures });
  const goals = workspaceCreationGoals({ canEdit, productFeatures });
  const copy = homeStartCopy(locale);
  const goalCopy = creationGoalMessages(locale);
  if (!options.length) return null;

  return (
    <section className={styles.startPanel} aria-labelledby="home-start-title" lang={locale}>
      <div className={styles.startHeading}>
        <div>
          <h2 id="home-start-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <Link href="/create">
          {goalCopy.moreFormats} <span aria-hidden="true">→</span>
        </Link>
      </div>
      <nav className={styles.startGoals} aria-label={goalCopy.title}>
        {goals.map((goal) => (
          <Link className={styles.startGoal} href={goal.href} key={goal.kind}>
            <span className={styles.startIcon}>
              <HomeIcon
                name={
                  goal.kind === "presentation"
                    ? "presentation"
                    : goal.kind === "poll"
                      ? "survey"
                      : "round"
                }
              />
            </span>
            <strong>{goal.kind === "round" ? t("common.round") : goalCopy[goal.kind]}</strong>
            <HomeIcon name="arrow" />
          </Link>
        ))}
      </nav>
      <nav className={styles.templateStarts} aria-label={copy.templates}>
        <span>{copy.templates}</span>
        <Link href="/templates?type=rounds">{copy.roundTemplates}</Link>
        {productFeatures?.presentations ? (
          <>
            <Link href="/templates?type=presentations">{t("pages.common.presentations")}</Link>
            <Link href="/templates?type=designs">{copy.designTemplates}</Link>
          </>
        ) : null}
        {productFeatures?.surveys ? (
          <Link href="/templates?type=surveys">{t("pages.common.surveys")}</Link>
        ) : null}
      </nav>
    </section>
  );
}
