"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  BrandThemeSchema,
  colorContrastRatio,
  PRODUCT_BRAND,
  type BrandTheme,
} from "@openround/contracts";
import { resolveExperienceTheme, workspaceThemePresets } from "@openround/experience";
import { useLocale } from "../../components/locale-provider";
import {
  applyColorModePreference,
  COLOR_MODE_APPLIED_EVENT,
  getColorModePreference,
  type ColorModePreference,
  type ResolvedColorMode,
} from "../../lib/color-mode";
import {
  applyInterfaceThemePreference,
  getInterfaceThemePreference,
  getInterfaceThemeStyle,
  INTERFACE_THEME_CHANGE_EVENT,
  interfaceThemePresets,
  type InterfaceThemeId,
} from "../../lib/interface-theme";
import { appearanceMessages, type AppearanceMessages } from "../../lib/i18n/appearance-messages";
import { experienceThemeStyle } from "../../lib/theme";
import styles from "./appearance-settings.module.css";

type InspectionMode = ResolvedColorMode | "compare";

function InspectionControls({
  value,
  onChange,
  copy,
  label,
}: {
  value: InspectionMode;
  onChange: (mode: InspectionMode) => void;
  copy: AppearanceMessages;
  label: string;
}) {
  return (
    <div aria-label={label} className={styles.segmented} role="group">
      {(["light", "dark", "compare"] as const).map((mode) => (
        <button
          aria-pressed={value === mode}
          key={mode}
          onClick={() => onChange(mode)}
          type="button"
        >
          {copy[mode]}
        </button>
      ))}
    </div>
  );
}

function InterfaceThumbnail({ id }: { id: InterfaceThemeId }) {
  return (
    <span aria-hidden="true" className={styles.thumbnailPair}>
      {(["light", "dark"] as const).map((mode) => (
        <span
          className={styles.interfaceThumbnail}
          key={mode}
          style={getInterfaceThemeStyle(id, mode)}
        >
          <span className={styles.thumbnailRail}>
            <i />
            <i />
            <i />
          </span>
          <span className={styles.thumbnailContent}>
            <i />
            <span>
              <b />
              <b />
            </span>
            <em />
          </span>
        </span>
      ))}
    </span>
  );
}

export function InterfaceWorkspacePreview({
  id,
  mode,
  copy,
}: {
  id: InterfaceThemeId;
  mode: ResolvedColorMode;
  copy: AppearanceMessages;
}) {
  return (
    <div
      className={styles.interfacePreview}
      data-preview-mode={mode}
      style={getInterfaceThemeStyle(id, mode)}
    >
      <div className={styles.workspaceTop}>
        <strong>
          <span aria-hidden="true" className={styles.brandGlyph}>
            P
          </span>{" "}
          {PRODUCT_BRAND.name}
        </strong>
        <span className={styles.previewMode}>{copy[mode]}</span>
      </div>
      <div className={styles.workspaceBody}>
        <div className={styles.workspaceNav}>
          <strong>{copy.workspace}</strong>
          <span>
            ⌂ <span>{copy.home}</span>
          </span>
          <span className={styles.activeNav}>
            ▦ <span>{copy.library}</span>
          </span>
          <span className={styles.workspaceAvatar} aria-hidden="true">
            AL
          </span>
        </div>
        <div className={styles.workspaceMain}>
          <div className={styles.libraryHeading}>
            <strong>{copy.library}</strong>
            <span className={styles.createSample}>+ {copy.create}</span>
          </div>
          <div className={styles.searchSample}>
            <span aria-hidden="true">⌕</span> {copy.search}
          </div>
          <div className={styles.roundSample}>
            <div className={styles.roundArtwork} aria-hidden="true">
              <span>?</span>
              <i />
              <b />
            </div>
            <div className={styles.roundDetails}>
              <strong>{copy.previewRound}</strong>
              <span>{copy.questions}</span>
              <span className={styles.readyPill}>{copy.ready}</span>
            </div>
          </div>
          <div className={styles.draftSample}>
            <span aria-hidden="true">▤</span>
            <strong>{copy.question}</strong>
            <span>{copy.draft}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface InterfacePreference {
  theme: InterfaceThemeId;
  mode: ColorModePreference;
}

export function PersonalInterfaceSettings() {
  const { locale } = useLocale();
  const copy = appearanceMessages(locale);
  const [preferences, setPreferences] = useState<{
    saved: InterfacePreference;
    draft: InterfacePreference;
    ready: boolean;
    applied: boolean;
  }>({
    saved: { theme: "classic", mode: "system" },
    draft: { theme: "classic", mode: "system" },
    ready: false,
    applied: false,
  });
  const [inspection, setInspection] = useState<InspectionMode>("compare");

  useEffect(() => {
    const synchronize = () => {
      const next = { theme: getInterfaceThemePreference(), mode: getColorModePreference() };
      setPreferences((current) => {
        const hasDraft =
          current.ready &&
          (current.draft.theme !== current.saved.theme ||
            current.draft.mode !== current.saved.mode);
        return {
          saved: next,
          draft: hasDraft ? current.draft : next,
          ready: true,
          applied: current.applied,
        };
      });
    };
    synchronize();
    window.addEventListener(INTERFACE_THEME_CHANGE_EVENT, synchronize);
    window.addEventListener(COLOR_MODE_APPLIED_EVENT, synchronize);
    return () => {
      window.removeEventListener(INTERFACE_THEME_CHANGE_EVENT, synchronize);
      window.removeEventListener(COLOR_MODE_APPLIED_EVENT, synchronize);
    };
  }, []);

  const dirty =
    preferences.draft.theme !== preferences.saved.theme ||
    preferences.draft.mode !== preferences.saved.mode;
  const modes = inspection === "compare" ? (["light", "dark"] as const) : [inspection];

  function selectTheme(theme: InterfaceThemeId) {
    setPreferences((current) => ({
      ...current,
      draft: { ...current.draft, theme },
      applied: false,
    }));
  }

  function apply() {
    applyInterfaceThemePreference(preferences.draft.theme);
    applyColorModePreference(preferences.draft.mode);
    setPreferences((current) => ({ ...current, saved: current.draft, applied: true }));
  }

  return (
    <section aria-labelledby="personal-appearance-title" className={`panel ${styles.section}`}>
      <div className={styles.sectionHeading}>
        <span aria-hidden="true" className={styles.sectionNumber}>
          01
        </span>
        <div>
          <h2 id="personal-appearance-title">{copy.personalTitle}</h2>
          <p>{copy.personalHelp}</p>
        </div>
      </div>
      <fieldset className={styles.themeFieldset}>
        <legend>{copy.themesLabel}</legend>
        <div className={styles.themeGrid}>
          {interfaceThemePresets.map((preset) => (
            <button
              aria-pressed={preferences.draft.theme === preset.id}
              className={styles.themeCard}
              disabled={!preferences.ready}
              key={preset.id}
              onClick={() => selectTheme(preset.id)}
              type="button"
            >
              <InterfaceThumbnail id={preset.id} />
              <span className={styles.cardTitle}>
                <strong>{copy[preset.id]}</strong>
                {preferences.saved.theme === preset.id ? (
                  <span className={styles.currentBadge}>{copy.current}</span>
                ) : preferences.draft.theme === preset.id ? (
                  <span aria-hidden="true" className={styles.selectedCheck}>
                    ✓
                  </span>
                ) : null}
              </span>
              <span className={styles.cardDescription}>{copy[`${preset.id}Description`]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className={styles.previewHeading}>
        <div>
          <strong>
            {copy.preview} · {copy[preferences.draft.theme]}
          </strong>
          <p>{copy.previewHelp}</p>
        </div>
        <InspectionControls
          copy={copy}
          label={`${copy.preview} — ${copy.personalTitle}`}
          onChange={setInspection}
          value={inspection}
        />
      </div>
      <div
        aria-label={`${copy.sample} — ${copy[preferences.draft.theme]}`}
        className={styles.previewGrid}
      >
        {modes.map((mode) => (
          <InterfaceWorkspacePreview
            copy={copy}
            id={preferences.draft.theme}
            key={mode}
            mode={mode}
          />
        ))}
      </div>
      <div className={styles.personalActions}>
        <fieldset className={styles.modeFieldset}>
          <legend>{copy.colorMode}</legend>
          <div className={styles.segmented}>
            {(["light", "dark", "system"] as const).map((mode) => (
              <button
                aria-pressed={preferences.draft.mode === mode}
                disabled={!preferences.ready}
                key={mode}
                onClick={() =>
                  setPreferences((current) => ({
                    ...current,
                    draft: { ...current.draft, mode },
                    applied: false,
                  }))
                }
                type="button"
              >
                {copy[mode]}
              </button>
            ))}
          </div>
          <p>{copy.deviceHelp}</p>
        </fieldset>
        <div className={styles.applyActions}>
          <p aria-live="polite" className={styles.changeStatus}>
            {dirty ? copy.unsaved : preferences.applied ? copy.applied : ""}
          </p>
          <div className="button-row">
            <button
              className="button"
              disabled={!preferences.ready || !dirty}
              onClick={apply}
              type="button"
            >
              {copy.apply}
            </button>
            <button
              className="button-quiet"
              disabled={!dirty}
              onClick={() =>
                setPreferences((current) => ({ ...current, draft: current.saved, applied: false }))
              }
              type="button"
            >
              {copy.discard}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function readableOn(color: string) {
  return colorContrastRatio(color, "#FFFFFF") >= colorContrastRatio(color, "#17202A")
    ? "#FFFFFF"
    : "#17202A";
}

export function WorkspaceLivePreview({
  theme,
  mode,
  copy,
}: {
  theme: BrandTheme;
  mode: ResolvedColorMode;
  copy: AppearanceMessages;
}) {
  const snapshot = resolveExperienceTheme({
    category: "general",
    presetId: "pops",
    brandTheme: { ...theme, colorMode: mode },
  });
  const style = {
    ...experienceThemeStyle(snapshot),
    "--preview-on-primary": readableOn(snapshot.tokens.primaryFill ?? snapshot.tokens.primary),
    "--preview-on-accent": readableOn(snapshot.tokens.accent),
  } as CSSProperties;
  return (
    <div className={styles.livePreview} data-preview-mode={mode} style={style}>
      <div className={styles.liveTop}>
        <strong>{theme.organizationName || PRODUCT_BRAND.name}</strong>
        <span className={styles.liveMode}>{copy[mode]}</span>
      </div>
      <div className={styles.liveContent}>
        <div className={styles.presenterSample}>
          <div className={styles.sampleEyebrow}>
            <span>{copy.presenter}</span>
            <span>{copy.questions}</span>
          </div>
          <strong className={styles.questionSample}>{copy.question}</strong>
          <div className={styles.resultHeader}>
            <strong>{copy.results}</strong>
            <span>{copy.responses}</span>
          </div>
          <div className={styles.resultRow}>
            <span>{copy.choiceA}</span>
            <strong>67%</strong>
            <i style={{ width: "67%" }} />
          </div>
          <div className={styles.resultRow}>
            <span>{copy.choiceB}</span>
            <strong>33%</strong>
            <i style={{ width: "33%" }} />
          </div>
          <div className={styles.joinSample}>
            <span>{copy.join}</span>
            <strong>482 913</strong>
          </div>
        </div>
        <div className={styles.participantSample}>
          <div className={styles.sampleEyebrow}>{copy.participant}</div>
          <strong>{copy.question}</strong>
          <div className={styles.choiceSample}>
            <b>A</b>
            <span>{copy.choiceA}</span>
          </div>
          <div className={styles.choiceSample}>
            <b>B</b>
            <span>{copy.choiceB}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandThumbnail({
  primaryColor,
  accentColor,
}: {
  primaryColor: string;
  accentColor: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={styles.brandThumbnail}
      style={
        { "--preview-primary": primaryColor, "--preview-accent": accentColor } as CSSProperties
      }
    >
      <span />
      <i />
      <span className={styles.thumbnailBars}>
        <b />
        <b />
        <b />
      </span>
      <em />
    </span>
  );
}

export function selectedWorkspacePreset(theme: BrandTheme): string | undefined {
  return workspaceThemePresets.find(
    (preset) =>
      preset.primaryColor.toLowerCase() === theme.primaryColor.toLowerCase() &&
      preset.accentColor.toLowerCase() === theme.accentColor.toLowerCase(),
  )?.id;
}

export function WorkspaceBrandSettings({
  theme,
  savedTheme,
  onChange,
  onSave,
  onReset,
  canManage,
  entitled,
  busy,
}: {
  theme: BrandTheme;
  savedTheme: BrandTheme | null;
  onChange: (theme: BrandTheme) => void;
  onSave: (event: FormEvent) => void;
  onReset: () => void;
  canManage: boolean;
  entitled: boolean;
  busy: boolean;
}) {
  const { locale } = useLocale();
  const copy = appearanceMessages(locale);
  const [inspection, setInspection] = useState<InspectionMode>("compare");
  const selectedPreset = selectedWorkspacePreset(theme);
  const modes = inspection === "compare" ? (["light", "dark"] as const) : [inspection];
  const canSave = canManage && entitled;
  const validBrand = BrandThemeSchema.safeParse(theme).success;
  const primaryInvalid = colorContrastRatio(theme.primaryColor, "#FFFFFF") < 4.5;
  const accentInvalid = colorContrastRatio(theme.accentColor, "#FFFFFF") < 4.5;
  const nameInvalid = theme.organizationName.trim().length === 0;
  const dirty =
    !savedTheme ||
    theme.organizationName !== savedTheme.organizationName ||
    theme.primaryColor !== savedTheme.primaryColor ||
    theme.accentColor !== savedTheme.accentColor ||
    theme.colorMode !== savedTheme.colorMode;
  const update = (patch: Partial<BrandTheme>) =>
    onChange({ ...theme, colorMode: theme.colorMode ?? "light", ...patch });

  return (
    <section aria-labelledby="workspace-appearance-title" className={`panel ${styles.section}`}>
      <div className={styles.sectionHeading}>
        <span aria-hidden="true" className={styles.sectionNumber}>
          02
        </span>
        <div>
          <h2 id="workspace-appearance-title">{copy.brandTitle}</h2>
          <p>{copy.brandHelp}</p>
        </div>
      </div>
      {!canManage ? (
        <p className={styles.accessNote}>{copy.readOnly}</p>
      ) : !entitled ? (
        <p className={styles.accessNote}>{copy.requiresPro}</p>
      ) : null}
      <form
        onSubmit={(event) => {
          if (!canSave || busy || !dirty || !theme.colorMode || !validBrand) {
            event.preventDefault();
            return;
          }
          onSave(event);
        }}
      >
        <fieldset className={styles.themeFieldset} disabled={busy}>
          <legend>{copy.themesLabel}</legend>
          <div className={styles.themeGrid}>
            {workspaceThemePresets.map((preset) => (
              <button
                aria-pressed={selectedPreset === preset.id}
                className={styles.themeCard}
                key={preset.id}
                onClick={() =>
                  update({ primaryColor: preset.primaryColor, accentColor: preset.accentColor })
                }
                type="button"
              >
                <BrandThumbnail
                  accentColor={preset.accentColor}
                  primaryColor={preset.primaryColor}
                />
                <span className={styles.cardTitle}>
                  <strong>{copy[preset.id]}</strong>
                  {selectedPreset === preset.id ? (
                    <span aria-hidden="true" className={styles.selectedCheck}>
                      ✓
                    </span>
                  ) : null}
                </span>
                <span className={styles.cardDescription}>{copy[`${preset.id}Description`]}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className={styles.brandFields}>
          <label className="field" htmlFor="theme-name">
            <span>{copy.brandName}</span>
            <input
              className="input"
              disabled={busy}
              aria-invalid={nameInvalid || undefined}
              aria-describedby={nameInvalid ? "theme-name-error" : undefined}
              id="theme-name"
              maxLength={80}
              onChange={(event) => update({ organizationName: event.target.value })}
              required
              value={theme.organizationName}
            />
          </label>
          <fieldset className={styles.modeFieldset} disabled={busy}>
            <legend>{copy.brandMode}</legend>
            <div className={styles.segmented}>
              {(["light", "dark"] as const).map((mode) => (
                <button
                  aria-pressed={theme.colorMode === mode}
                  key={mode}
                  onClick={() => update({ colorMode: mode })}
                  type="button"
                >
                  {copy[mode]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {nameInvalid ? (
          <p className={styles.validationError} id="theme-name-error" role="alert">
            {copy.nameRequired}
          </p>
        ) : null}
        <p className={styles.help}>{copy.brandModeHelp}</p>
        {!theme.colorMode ? <p className={styles.help}>{copy.legacyHelp}</p> : null}
        <details className={styles.customColors}>
          <summary>
            {copy.customColors}
            {!selectedPreset ? ` · ${copy.custom}` : ""}
          </summary>
          <div className={styles.colorFields}>
            <label htmlFor="theme-primary">
              <span>{copy.primaryColor}</span>
              <span className={styles.colorValue}>
                <input
                  disabled={busy}
                  aria-invalid={primaryInvalid || undefined}
                  aria-describedby={primaryInvalid ? "theme-contrast-error" : undefined}
                  id="theme-primary"
                  onChange={(event) => update({ primaryColor: event.target.value })}
                  type="color"
                  value={theme.primaryColor}
                />
                <code>{theme.primaryColor.toUpperCase()}</code>
              </span>
            </label>
            <label htmlFor="theme-accent">
              <span>{copy.accentColor}</span>
              <span className={styles.colorValue}>
                <input
                  disabled={busy}
                  aria-invalid={accentInvalid || undefined}
                  aria-describedby={accentInvalid ? "theme-contrast-error" : undefined}
                  id="theme-accent"
                  onChange={(event) => update({ accentColor: event.target.value })}
                  type="color"
                  value={theme.accentColor}
                />
                <code>{theme.accentColor.toUpperCase()}</code>
              </span>
            </label>
          </div>
          <p className={styles.help}>{copy.contrastHelp}</p>
        </details>
        {primaryInvalid || accentInvalid ? (
          <p className={styles.validationError} id="theme-contrast-error" role="alert">
            {copy.contrastHelp}
          </p>
        ) : null}
        <div className={styles.previewHeading}>
          <strong>
            {copy.preview} ·{" "}
            {selectedPreset ? copy[selectedPreset as InterfaceThemeId] : copy.custom}
          </strong>
          <InspectionControls
            copy={copy}
            label={`${copy.preview} — ${copy.brandTitle}`}
            onChange={setInspection}
            value={inspection}
          />
        </div>
        <div aria-label={copy.brandTitle} className={styles.previewGrid}>
          {modes.map((mode) => (
            <WorkspaceLivePreview copy={copy} key={mode} mode={mode} theme={theme} />
          ))}
        </div>
        <div className={styles.brandActions}>
          <p aria-live="polite" className={styles.changeStatus}>
            {dirty ? copy.saveChanges : savedTheme ? copy.savedBrand : ""}
          </p>
          <div className="button-row">
            <button
              className="button"
              disabled={!canSave || busy || !dirty || !theme.colorMode || !validBrand}
              type="submit"
            >
              {busy ? copy.saving : copy.save}
            </button>
            {savedTheme && dirty ? (
              <button
                className="button-quiet"
                disabled={busy}
                onClick={() => onChange(savedTheme)}
                type="button"
              >
                {copy.discard}
              </button>
            ) : null}
            {savedTheme && canManage ? (
              <button className="button-quiet" disabled={busy} onClick={onReset} type="button">
                {copy.remove}
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </section>
  );
}
