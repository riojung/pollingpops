"use client";

import { useState } from "react";
import type { PresentationSceneNode, SupportedLocale } from "@openround/contracts";
import { NATIVE_DESIGN_FONTS } from "../../lib/presentation-native-design";
import { nativeControlsCopy } from "./native-controls-copy";
import { nativeInspectorCopy } from "./native-inspector-copy";
import styles from "./native-scene-typography-controls.module.css";

type TextNode = Extract<PresentationSceneNode, { type: "text" }>;

export function NativeSceneTypographyControls({
  node,
  locale,
  onChange,
}: {
  node: TextNode;
  locale: SupportedLocale;
  onChange: (node: TextNode, field?: string) => void;
}) {
  const copy = nativeInspectorCopy(locale);
  const controlCopy = nativeControlsCopy(locale);
  const sizeRevision = `${node.id}:${node.typography?.size ?? ""}`;
  const [sizeDraft, setSizeDraft] = useState({
    revision: sizeRevision,
    value: String(node.typography?.size ?? ""),
  });
  if (sizeDraft.revision !== sizeRevision)
    setSizeDraft({ revision: sizeRevision, value: String(node.typography?.size ?? "") });
  function update(key: "font" | "size", value: string | number | undefined) {
    const typography = { ...node.typography };
    if (value === undefined) delete typography[key];
    else if (key === "font") typography.font = value as "sans" | "serif" | "mono";
    else typography.size = value as number;
    if (JSON.stringify(typography) === JSON.stringify(node.typography ?? {})) return;
    const next: TextNode = { ...node, typography };
    if (Object.keys(typography).length === 0) delete next.typography;
    onChange(next, `typography:${key}`);
  }
  return (
    <div className={styles.controls} data-native-typography-controls="true">
      <label className={styles.fontField}>
        <span>{copy("Font family")}</span>
        <select
          aria-label={copy("Font family")}
          value={node.typography?.font ?? ""}
          onChange={(event) => {
            const font = event.target.value;
            if (font && !Object.hasOwn(NATIVE_DESIGN_FONTS, font)) return;
            update("font", font || undefined);
          }}
        >
          <option value="">{copy("Inherit slide font")}</option>
          {(Object.keys(NATIVE_DESIGN_FONTS) as ("sans" | "serif" | "mono")[]).map((font) => (
            <option key={font} value={font} style={{ fontFamily: NATIVE_DESIGN_FONTS[font] }}>
              {controlCopy(
                font === "sans" ? "System sans" : font === "serif" ? "Classic serif" : "Monospace",
              )}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.sizeField}>
        <span>{copy("Font size (px)")}</span>
        <input
          aria-label={copy("Font size (px)")}
          type="number"
          min={12}
          max={144}
          step={1}
          placeholder={copy("Automatic")}
          value={
            sizeDraft.revision === sizeRevision
              ? sizeDraft.value
              : String(node.typography?.size ?? "")
          }
          onChange={(event) => {
            setSizeDraft({ revision: sizeRevision, value: event.target.value });
            const value = event.target.value === "" ? undefined : event.target.valueAsNumber;
            if (value !== undefined && (!Number.isFinite(value) || value < 12 || value > 144))
              return;
            update("size", value);
          }}
          onBlur={() =>
            setSizeDraft({ revision: sizeRevision, value: String(node.typography?.size ?? "") })
          }
        />
      </label>
    </div>
  );
}
