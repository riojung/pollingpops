import type { ReactNode } from "react";
import { questionTypeDefinition, type QuestionDraft } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { roundToolsCopy } from "../../lib/i18n/round-tools-copy";
import styles from "./round-builder.module.css";
import tools from "./round-tools.module.css";

export type InspectorTab = "build" | "diagnose" | "recover";

export function QuestionInspector({
  activeTab,
  collapsed,
  build,
  diagnose,
  recover,
  question,
  questionNumber,
  uxBeta = true,
  readOnly = false,
  modal = false,
  onTabChange,
  onToggle,
}: {
  activeTab: InspectorTab;
  collapsed: boolean;
  build: ReactNode;
  diagnose: ReactNode;
  recover: ReactNode;
  question?: QuestionDraft | null;
  questionNumber?: number;
  uxBeta?: boolean;
  readOnly?: boolean;
  modal?: boolean;
  onTabChange: (tab: InspectorTab) => void;
  onToggle: () => void;
}) {
  const { t, locale } = useLocale();
  const copy = roundToolsCopy(locale);
  const heading = uxBeta ? copy("Question tools") : t("delivery.builder.inspector");
  const tabLabels: Record<InspectorTab, string> = {
    build: t("delivery.builder.build"),
    diagnose: t("delivery.builder.diagnose"),
    recover: t("delivery.builder.recover"),
  };
  const panels = { build, diagnose, recover };
  return (
    <aside
      className={`${styles.inspector} ${tools.inspector}`}
      data-collapsed={collapsed}
      id="round-question-tools"
      role={modal && !collapsed ? "dialog" : undefined}
      aria-modal={modal && !collapsed ? true : undefined}
      aria-label={heading}
    >
      <div className={tools.header}>
        <div className={tools.topline}>
          <h2 lang={locale}>{heading}</h2>
          <button
            aria-label={copy("Close question tools")}
            className={tools.close}
            lang={locale}
            onClick={onToggle}
            type="button"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20" width="18" height="18">
              <path
                d="m5 5 10 10M15 5 5 15"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        </div>
        {question ? (
          <div className={tools.context} data-question-id={question.id}>
            <div className={tools.contextMeta} lang={locale}>
              <span>
                {questionNumber === undefined
                  ? copy("Selected question")
                  : copy("Question {number}", {
                      number: new Intl.NumberFormat(locale).format(questionNumber),
                    })}
              </span>
              <span className={tools.badge}>{t(`delivery.builder.type.${question.type}`)}</span>
              <span>
                {copy(
                  questionTypeDefinition(question.type).scored && question.purpose !== "opinion"
                    ? "Scored"
                    : "Unscored",
                )}
              </span>
            </div>
            <p
              className={tools.contextTitle}
              lang={question.prompt.trim() ? "" : locale}
              title={question.prompt.trim() || undefined}
            >
              {question.prompt.trim() || copy("Untitled question")}
            </p>
          </div>
        ) : null}
        <div aria-label={heading} className={tools.tabs} role="tablist">
          {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
            <button
              aria-controls={`inspector-${tab}`}
              aria-selected={activeTab === tab}
              className={tools.tab}
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
              <svg aria-hidden="true" fill="none" viewBox="0 0 20 20" width="14" height="14">
                {tab === "build" ? (
                  <path
                    d="M4 5h12M4 10h12M4 15h12M7 3v4m6 1v4m-5 1v4"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.5"
                  />
                ) : tab === "diagnose" ? (
                  <path
                    d="M4 16V9m6 7V4m6 12v-5"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                ) : (
                  <path
                    d="M5 7h8a4 4 0 0 1 0 8h-3M5 7l3-3M5 7l3 3"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                )}
              </svg>
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>
      {(Object.keys(tabLabels) as InspectorTab[]).map((tab) => (
        <div
          aria-labelledby={`inspector-tab-${tab}`}
          className={`${styles.inspectorBody} ${tools.panel}`}
          hidden={activeTab !== tab}
          id={`inspector-${tab}`}
          key={tab}
          role="tabpanel"
        >
          <fieldset className={tools.panelFields} disabled={readOnly}>
            <legend className="sr-only" lang={locale}>
              {tabLabels[tab]}
            </legend>
            {panels[tab]}
          </fieldset>
        </div>
      ))}
    </aside>
  );
}
