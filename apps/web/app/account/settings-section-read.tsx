import type { ReactNode } from "react";
import { useLocale } from "../../components/locale-provider";
import type { SectionReadState } from "./use-owner-settings-section";
import styles from "./account.module.css";

export function SettingsSectionRead({
  status,
  onRetry,
  children,
}: {
  status: SectionReadState<unknown>["status"];
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className={styles.sectionReadStatus} role="status">
        {status === "loading" ? <p>{t("account.section.loading")}</p> : null}
      </div>
      <div aria-busy={status === "loading"} data-account-section-content="">
        {status === "error" ? (
          <div className={styles.sectionReadError}>
            <p className="error" role="alert">
              {t("account.section.unavailable")}
            </p>
            <button
              className="button-quiet"
              onClick={({ currentTarget }) => {
                if (currentTarget.ownerDocument.activeElement === currentTarget) {
                  currentTarget.closest<HTMLElement>("[data-account-settings-section]")?.focus();
                }
                onRetry();
              }}
              type="button"
            >
              {t("workspace.retry")}
            </button>
          </div>
        ) : status === "ready" ? (
          children
        ) : null}
      </div>
    </>
  );
}
