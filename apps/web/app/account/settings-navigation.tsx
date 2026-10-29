import type { KeyboardEvent } from "react";
import { useLocale } from "../../components/locale-provider";
import type { SettingsSection } from "./account-settings-model";
import styles from "./account.module.css";

export function SettingsNavigation({
  sections,
  selected,
  onSelect,
}: {
  sections: readonly SettingsSection[];
  selected: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const { locale, t } = useLocale();
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!offset && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? sections.length - 1
          : (index + offset + sections.length) % sections.length;
    onSelect(sections[next]!);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }
  return (
    <nav
      className={styles.sectionMenu}
      role="tablist"
      lang={locale}
      aria-label={t("customer.section.navigation")}
    >
      {sections.map((section, index) => (
        <button
          key={section}
          type="button"
          role="tab"
          id={`settings-tab-${section}`}
          aria-controls="settings-panel"
          aria-selected={selected === section}
          tabIndex={selected === section ? 0 : -1}
          onClick={() => onSelect(section)}
          onKeyDown={(event) => move(event, index)}
        >
          {t(`customer.section.${section}`)}
        </button>
      ))}
    </nav>
  );
}
