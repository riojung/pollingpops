import type { ReactNode } from "react";
import { useLocale } from "../locale-provider";
import styles from "./round-builder.module.css";

export type InspectorTab = "build" | "diagnose" | "recover";

export function QuestionInspector({
  activeTab,
  collapsed,
  build,
  diagnose,
  recover,
  onTabChange,
  onToggle,
}: {
  activeTab: InspectorTab;
  collapsed: boolean;
  build: ReactNode;
  diagnose: ReactNode;
  recover: ReactNode;
  onTabChange: (tab: InspectorTab) => void;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const tabLabels: Record<InspectorTab, string> = {
    build: t("delivery.builder.build"),
    diagnose: t("delivery.builder.diagnose"),
    recover: t("delivery.builder.recover"),
  };
  const panels = { build, diagnose, recover };
  return (
    <aside
      className={styles.inspector}
      data-collapsed={collapsed}
      aria-label={t("delivery.builder.inspector")}
    >
      <div className={styles.inspectorHeader}>
        <div className={styles.inspectorTopline}>
          <h2>{t("delivery.builder.inspector")}</h2>
          <button className={styles.iconButton} onClick={onToggle} type="button">
            {t("delivery.common.close")}
          </button>
        </div>
        <div
          aria-label={t("delivery.builder.inspector")}
          className={styles.inspectorTabs}
          role="tablist"
        >
          {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
            <button
              aria-controls={`inspector-${tab}`}
              aria-selected={activeTab === tab}
              className={styles.inspectorTab}
              id={`inspector-tab-${tab}`}
              key={tab}
              onClick={() => onTabChange(tab)}
              onKeyDown={(event) => {
                const tabs = Object.keys(tabLabels) as InspectorTab[];
                const index = tabs.indexOf(tab);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                onTabChange(tabs[next]!);
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`#inspector-tab-${tabs[next]}`)
                  ?.focus();
              }}
              role="tab"
              tabIndex={activeTab === tab ? 0 : -1}
              type="button"
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>
      {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
        <div
          aria-labelledby={`inspector-tab-${tab}`}
          className={styles.inspectorBody}
          hidden={activeTab !== tab}
          id={`inspector-${tab}`}
          key={tab}
          role="tabpanel"
        >
          {panels[tab]}
        </div>
      ))}
    </aside>
  );
}
