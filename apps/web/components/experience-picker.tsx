"use client";

import { useId } from "react";
import {
  RoundCategorySchema,
  colorContrastRatio,
  type ExperiencePresetId,
  type RoundCategory,
} from "@openround/contracts";
import { experiencePresets, getExperiencePreset, presetForCategory } from "@openround/experience";
import { experienceThemeStyle } from "../lib/theme";
import { useLocale } from "./locale-provider";
import styles from "./experience-picker.module.css";

export function ExperiencePicker({
  category,
  presetId,
  onCategoryChange,
  onPresetChange,
  showCategory = true,
}: {
  category: RoundCategory;
  presetId: ExperiencePresetId;
  onCategoryChange?: (category: RoundCategory) => void;
  onPresetChange: (preset: ExperiencePresetId) => void;
  showCategory?: boolean;
}) {
  const { t } = useLocale();
  const pickerId = useId();
  const categoryLabel = (value: RoundCategory) => t(`live.experience.category.${value}`);
  const presetName = (id: ExperiencePresetId) => t(`live.experience.preset.${id}.name`);
  const selected = getExperiencePreset(presetId);
  const recommendation = presetForCategory(category);
  const preview = { ...selected, soundEnabled: false };

  return (
    <div className={styles.picker}>
      {showCategory ? (
        <label className="field">
          <span>{t("live.experience.categoryLabel")}</span>
          <select
            aria-describedby={`${pickerId}-category-help`}
            aria-label={t("live.experience.categoryLabel")}
            className="select"
            onChange={(event) => onCategoryChange?.(event.target.value as RoundCategory)}
            value={category}
          >
            {RoundCategorySchema.options.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)}
              </option>
            ))}
          </select>
          <small className="muted" id={`${pickerId}-category-help`}>
            {t("live.experience.categoryHelp")}
          </small>
        </label>
      ) : null}
      <fieldset aria-describedby={`${pickerId}-help`} className={styles.gallery}>
        <legend>{t("live.experience.presetLabel")}</legend>
        <p className="muted" id={`${pickerId}-help`}>
          {t("live.experience.galleryHelp")}
        </p>
        <div className={styles.cards}>
          {experiencePresets.map((preset) => {
            const id = preset.preset.id;
            const isSelected = id === presetId;
            const dark =
              colorContrastRatio(preset.tokens.surface, "#FFFFFF") >
              colorContrastRatio(preset.tokens.surface, "#000000");
            return (
              <label
                className={styles.card}
                data-selected={isSelected || undefined}
                key={id}
                style={experienceThemeStyle({ ...preset, soundEnabled: false })}
              >
                <input
                  aria-label={presetName(id)}
                  checked={isSelected}
                  name={`${pickerId}-preset`}
                  onChange={() => onPresetChange(id)}
                  type="radio"
                  value={id}
                />
                <strong>{presetName(id)}</strong>
                <span className={styles.appearance}>
                  {t(dark ? "live.experience.paletteDark" : "live.experience.paletteLight")}
                  {isSelected ? ` · ${t("live.experience.selected")}` : ""}
                </span>
                <span aria-hidden="true" className={styles.swatches}>
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                {id === recommendation ? (
                  <span className={styles.recommended}>{t("live.experience.recommended")}</span>
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className={styles.recommendation}>
        <small className="muted">
          {t("live.experience.recommendedFor", { category: categoryLabel(category) })}
        </small>
        {recommendation !== presetId ? (
          <button
            className="text-button"
            onClick={() => onPresetChange(recommendation)}
            type="button"
          >
            {t("live.experience.useRecommended", { name: presetName(recommendation) })}
          </button>
        ) : null}
      </div>
      <div
        aria-label={t("live.experience.previewAria", { name: presetName(presetId) })}
        className={`experience-preview ${styles.preview}`}
        data-corners={selected.tokens.corners}
        data-pattern={selected.tokens.pattern}
        data-typography={selected.tokens.typography}
        role="region"
        style={experienceThemeStyle(preview)}
      >
        <div className={styles.previewHeading}>
          <strong>{presetName(presetId)}</strong>
          <span>
            {t("live.experience.motion", {
              motion: t(`live.experience.motion.${selected.motion}`),
            })}
          </span>
        </div>
        <p>{t(`live.experience.preset.${presetId}.description`)}</p>
        <div className={styles.question}>
          <h3>{t("live.experience.previewQuestion")}</h3>
          <div className={styles.answers}>
            <span>A · {t("live.experience.previewChoiceA")}</span>
            <span>B · {t("live.experience.previewChoiceB")}</span>
          </div>
        </div>
        <p className={styles.previewHelp}>{t("live.experience.previewHelp")}</p>
      </div>
    </div>
  );
}
