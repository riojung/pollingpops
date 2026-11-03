import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
import styles from "./home.module.css";

export function HomeFirstRunActions({
  canCreate,
  guideAvailable,
}: {
  canCreate: boolean;
  guideAvailable: boolean;
}) {
  const { t } = useLocale();
  if (!canCreate && !guideAvailable) return null;

  return (
    <div className={styles.onboardingActions}>
      {canCreate ? (
        <Link className="button" href="/create">
          {t("pages.home.firstRun.create")}
        </Link>
      ) : null}
      {guideAvailable ? (
        <Link className="button-quiet" href="/help#quick-start">
          {t("pages.home.firstRun.watch")}
        </Link>
      ) : null}
    </div>
  );
}
