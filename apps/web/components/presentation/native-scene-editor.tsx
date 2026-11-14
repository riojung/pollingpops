"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CanvasColorSchema,
  CanvasShapeVariantSchema,
  PRESENTATION_SCENE_MAX_NODES,
  PRESENTATION_TEXT_LANGUAGES,
  PresentationTextLanguageSchema,
  PresentationSceneDraftSchema,
  plainTextToPresentationRichText,
  presentationRichTextToPlainText,
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneNode,
} from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { nativeEditorCopy, type NativeEditorCopyKey } from "./native-editor-copy";
import { nativeControlNodeLabel, nativeControlsCopy } from "./native-controls-copy";
import { clientUuid } from "../../lib/uuid";
import { setNativeTextLanguage } from "../../lib/presentation-native-text-language";
import {
  boundNativeSceneFrame,
  createNativeLinkNode,
  createNativeRevealNode,
  createNativeDialogNode,
  createNativeHotspotNode,
  createNativeNavigationNode,
  reorderNativeNode,
  updateNativeNode,
} from "../../lib/presentation-native-scene";
import { type SceneImageRenderer } from "./native-scene-view";
import { NativeSceneCanvas } from "./native-scene-canvas";
import { NativeRichTextEditor } from "./native-rich-text-editor";
import { NativeSceneTypographyControls } from "./native-scene-typography-controls";
import { NativeInspectorSection } from "./native-inspector-section";
import { layoutAssistanceCopy } from "./layout-assistance-copy";
import { NativeSceneCompositionControls } from "./native-scene-composition-controls";
import { NativeSceneVideoControls } from "./native-scene-video-controls";
import { NativeSceneLayoutSuggestions } from "./native-scene-layout-suggestions";
import { NativeSceneDataEditor } from "./native-scene-data-editor";
import { NativeSceneInteractionEditor } from "./native-scene-interaction-editor";
import { createNativeChartNode, createNativeTableNode } from "../../lib/presentation-native-data";
import {
  NativeSceneArrangementControls,
  NativeSceneDesignControls,
  NativeSceneImageDesignControls,
  NativeSceneLayoutControls,
} from "./native-scene-design-controls";
import {
  moveNativeSceneNodes,
  removeNativeSceneNodes,
  expandNativeSceneSelection,
  synchronizeNativeHotspots,
} from "../../lib/presentation-native-geometry";
import styles from "./native-scene.module.css";
import inspectorStyles from "./native-scene-inspector.module.css";
import {
  EditorDisclosure,
  EditorIcon,
  EditorMenuSection,
  type EditorIconName,
} from "./presentation-editor-chrome";
import { isNativeInteractionNode } from "./native-scene-interaction-view";

const shapes = [
  ...CanvasShapeVariantSchema.options,
  "ellipse",
  "diamond",
  "parallelogram",
] as const;
const anchors = ["center", "top", "right", "bottom", "left"] as const;
const shapeLabels: Record<(typeof shapes)[number], NativeEditorCopyKey> = {
  rectangle: "rectangle",
  rounded_rectangle: "rounded rectangle",
  triangle: "triangle",
  star: "star",
  pentagon: "pentagon",
  hexagon: "hexagon",
  octagon: "octagon",
  cylinder: "cylinder",
  speech_bubble: "speech bubble",
  cloud: "cloud",
  cross: "cross",
  chevron: "chevron",
  document: "document",
  trapezoid: "trapezoid",
  arrow_right: "arrow right",
  arrow_left: "arrow left",
  arrow_double: "arrow double",
  ellipse: "ellipse",
  diamond: "diamond",
  parallelogram: "parallelogram",
};
const objectContexts: Record<
  PresentationSceneNode["type"],
  { icon: EditorIconName; label: NativeEditorCopyKey; hint: NativeEditorCopyKey }
> = {
  text: { icon: "text", label: "Text", hint: "Edit the words your audience will see." },
  shape: { icon: "shape", label: "Shape", hint: "Give this shape a label and visual style." },
  connector: {
    icon: "connector",
    label: "Connector",
    hint: "Connect two objects and choose their attachment points.",
  },
  image: {
    icon: "image",
    label: "Image",
    hint: "Adjust the image in Media and its description in Access.",
  },
  table: { icon: "table", label: "Table", hint: "Edit and review your data before applying it." },
  chart: { icon: "chart", label: "Chart", hint: "Edit and review your data before applying it." },
  reveal: {
    icon: "reveal",
    label: "Reveal panel",
    hint: "Choose the label and content for this reveal.",
  },
  link: {
    icon: "link",
    label: "Link",
    hint: "Choose a clear label and a destination for your audience.",
  },
  dialog: {
    icon: "dialog",
    label: "Detail dialog",
    hint: "Add the audience content that opens in this dialog.",
  },
  hotspot: {
    icon: "hotspot",
    label: "Image hotspot",
    hint: "Add detail content and connect it to an image.",
  },
  navigation: {
    icon: "navigation",
    label: "Slide link",
    hint: "Choose where this slide link takes your audience.",
  },
};

export function NativeSceneEditor({
  scene,
  canEdit = true,
  onChange: onSceneChange,
  renderImage,
  uploadsEnabled,
  mediaState,
  attachmentPending = false,
  onUploadImage: uploadImage,
  onUndo: undo,
  onRedo: redo,
  onApplyDesignToDeck: applyDesignToDeck,
  navigationTargets,
  onTextAssistance: textAssistance,
  textAssistanceDisabled = false,
  layoutSuggestionsDisabled = false,
  layoutSuggestionsSourceKey,
  onPreviewInteraction,
  previewInteractionUnavailableReason,
  inspectorTarget,
  inspectorSection = "content",
  onInspectSelection,
}: {
  scene: PresentationScene;
  canEdit?: boolean;
  onChange: (scene: PresentationScene, historyField?: string) => boolean | void;
  renderImage: SceneImageRenderer;
  uploadsEnabled: boolean;
  mediaState: "idle" | "uploading" | "scanning";
  attachmentPending?: boolean;
  onUploadImage: (file: File, altText: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onApplyDesignToDeck?: (design: PresentationSceneDesign) => void;
  navigationTargets?: readonly { id: string; title: string }[];
  onTextAssistance?: (nodeId: string, operation: "rewrite" | "shorten" | "translate") => void;
  textAssistanceDisabled?: boolean;
  layoutSuggestionsDisabled?: boolean;
  layoutSuggestionsSourceKey?: string;
  onPreviewInteraction?: () => void;
  previewInteractionUnavailableReason?: string;
  /** Undefined keeps standalone controls inline; null waits for the shell's inspector. */
  inspectorTarget?: HTMLElement | null;
  inspectorSection?: "content" | "layout" | "media" | "accessibility";
  onInspectSelection?: (openInspector?: boolean) => void;
}) {
  const { locale } = useLocale();
  const copy = nativeEditorCopy(locale);
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const permission = useRef(canEdit);
  permission.current = canEdit;
  const onUndo = undo
    ? () => {
        if (permission.current) undo();
      }
    : undefined;
  const onRedo = redo
    ? () => {
        if (permission.current) redo();
      }
    : undefined;
  const onApplyDesignToDeck = applyDesignToDeck
    ? (design: PresentationSceneDesign) => {
        if (permission.current) applyDesignToDeck(design);
      }
    : undefined;
  const onTextAssistance = textAssistance
    ? (...args: Parameters<NonNullable<typeof textAssistance>>) => {
        if (permission.current) textAssistance(...args);
      }
    : undefined;
  const onUploadImage = (...args: Parameters<typeof uploadImage>) => {
    if (permission.current) uploadImage(...args);
  };
  const first = scene.nodes[0]!;
  const initialNode =
    first.type === "shape" && first.decorative
      ? (scene.nodes.find((node) => node.type === "text" && node.role === "title") ?? first)
      : first;
  const [selection, setSelection] = useState<string[]>([initialNode.id]);
  const [imageAlt, setImageAlt] = useState("");
  const [formatError, setFormatError] = useState<NativeEditorCopyKey | null>(null);
  const [changeFailure, setChangeFailure] = useState<{
    scene: PresentationScene;
    message: NativeEditorCopyKey;
  } | null>(null);
  const validSelection = selection.filter((id) => scene.nodes.some((node) => node.id === id));
  const selectedIds = expandNativeSceneSelection(
    scene,
    validSelection.length ? validSelection : [initialNode.id],
  );
  const selected = scene.nodes.find((node) => node.id === selectedIds.at(-1))!;
  const palettePaint =
    selected.type === "shape" &&
    [selected.appearance?.fill, selected.appearance?.stroke].some(
      (paint) => paint !== undefined && paint !== "none",
    );
  const multiple = selectedIds.length > 1;
  const canMoveSelection = scene.nodes.some(
    (node) => selectedIds.includes(node.id) && node.type !== "connector",
  );
  function select(id: string, additive = false) {
    setSelection((current) => {
      const members = expandNativeSceneSelection(scene, [id]);
      if (!additive) return members;
      const valid = expandNativeSceneSelection(
        scene,
        current.filter((candidate) => scene.nodes.some((node) => node.id === candidate)),
      );
      if (!members.every((id) => valid.includes(id)))
        return [...valid.filter((id) => !members.includes(id)), ...members];
      const remaining = valid.filter((id) => !members.includes(id));
      return remaining.length ? remaining : valid;
    });
  }
  function onChange(next: PresentationScene, historyField?: string) {
    if (!permission.current || next === scene) return false;
    next = synchronizeNativeHotspots(scene, next);
    const parsed = PresentationSceneDraftSchema.safeParse(next);
    if (!parsed.success) {
      setChangeFailure({
        scene,
        message:
          "This change cannot fit within the slide’s limits. Keep rotated objects inside the slide; shorten content or remove an object, then try again.",
      });
      return false;
    }
    setChangeFailure(null);
    if (onSceneChange(parsed.data, historyField) === false) {
      setChangeFailure({
        scene,
        message:
          "The Presentation could not accept this change. Reduce content and try again; the current slide is retained.",
      });
      return false;
    }
    return true;
  }
  const canAdd =
    mediaState === "idle" &&
    !attachmentPending &&
    scene.nodes.length < PRESENTATION_SCENE_MAX_NODES;
  const framed = scene.nodes.filter((node) => node.type !== "connector");
  const readingIndex = scene.readingOrder.indexOf(selected.id);
  function update(updater: (node: PresentationSceneNode) => PresentationSceneNode, field?: string) {
    const next = updateNativeNode(scene, selected.id, updater);
    onChange(
      next.nodes.some((node) => node.type === "text" && node.typography)
        ? { ...next, schemaVersion: next.schemaVersion >= 9 ? next.schemaVersion : 9 }
        : next,
      field ? `native:${selected.id}:${field}` : undefined,
    );
  }
  function add(node: PresentationSceneNode) {
    if (!canAdd) return false;
    const minimumVersion =
      node.type === "hotspot" ||
      node.type === "dialog" ||
      node.type === "navigation" ||
      (node.type === "reveal" && node.scope === "broadcast")
        ? 6
        : node.type === "reveal" || node.type === "link"
          ? 5
          : node.type === "table" || node.type === "chart"
            ? 4
            : 1;
    const added = onChange({
      ...scene,
      schemaVersion: scene.schemaVersion >= minimumVersion ? scene.schemaVersion : minimumVersion,
      nodes: [...scene.nodes, node],
      readingOrder: [...scene.readingOrder, node.id],
    });
    if (added) {
      setSelection([node.id]);
      onInspectSelection?.(true);
    }
    return added;
  }
  function insertFromMenu(node: PresentationSceneNode, source?: HTMLButtonElement) {
    if (!add(node)) return;
    const picker = source?.closest("details");
    picker?.removeAttribute("open");
    picker?.querySelector("summary")?.focus({ preventScroll: true });
  }
  function requestTextAssistance(operation: "rewrite" | "shorten" | "translate") {
    if (
      textAssistanceDisabled ||
      multiple ||
      selected.type !== "text" ||
      selected.richText ||
      !selected.text.trim()
    )
      return;
    onTextAssistance?.(selected.id, operation);
  }
  function restoreHistory(action: () => void) {
    const active = document.activeElement;
    const textInput =
      active instanceof HTMLTextAreaElement && active.hasAttribute("data-native-text-input")
        ? active
        : null;
    const fields = textInput?.closest<HTMLElement>("[data-native-text-fields]");
    const start = textInput?.selectionStart ?? 0;
    const end = textInput?.selectionEnd ?? 0;
    action();
    if (!textInput || !fields) return;
    requestAnimationFrame(() => {
      // Undoing the first formatting action replaces the rich textarea with its plain sibling.
      // Keep keyboard history usable without taking focus from another control or a new slide.
      if (textInput.isConnected || !fields.isConnected || document.activeElement !== document.body)
        return;
      const replacement = fields.querySelector<HTMLTextAreaElement>("[data-native-text-input]");
      replacement?.focus({ preventScroll: true });
      replacement?.setSelectionRange(start, end);
    });
  }
  const context = objectContexts[selected.type];
  const contextLabel =
    selected.type === "text" && selected.role === "title" ? "Slide title" : context.label;
  const inlineInspector = inspectorTarget === undefined;
  const sectionHidden = (section: typeof inspectorSection) =>
    !inlineInspector && inspectorSection !== section;
  // Keep every section mounted in one stable portal. Switching inspector tabs must not
  // reset object selection, rich-text formatting, or a partially entered media link.
  const inspector = (
    <div
      className={`${styles.controls} ${styles.contextInspector} ${inspectorStyles.inspector}`}
      aria-label={copy("Native slide editor")}
      lang={locale}
    >
      <div className={inspectorStyles.selectionSummary}>
        <div className={inspectorStyles.objectContext}>
          <span className={inspectorStyles.objectIcon}>
            <EditorIcon name={context.icon} />
          </span>
          <div>
            <span className={inspectorStyles.eyebrow}>{copy("Editing on this slide")}</span>
            <strong>{copy(contextLabel)}</strong>
          </div>
          <span className={inspectorStyles.selectionCount} aria-hidden="true">
            {copy("{count} selected", { count: selectedIds.length })}
          </span>
        </div>
        <label>
          {copy("Selected object")}
          <select
            aria-label={copy("Selected object")}
            value={selected.id}
            onChange={(event) => select(event.target.value)}
          >
            {scene.readingOrder.map((id) => {
              const node = scene.nodes.find((item) => item.id === id)!;
              const label = nativeControlNodeLabel(locale, node);
              return (
                <option key={id} value={id} lang={label.language}>
                  {label.text}
                </option>
              );
            })}
          </select>
        </label>
        <p role="status" className={styles.help}>
          {copy(multiple ? "{count} objects selected" : "{count} object selected", {
            count: selectedIds.length,
          })}
        </p>
      </div>
      <div hidden={sectionHidden("content")} data-native-inspector-section="content">
        <NativeInspectorSection
          key={selected.id}
          title={copy(multiple ? "Last selected object" : "Selected object")}
          icon={context.icon}
          name="content"
          defaultOpen
        >
          <fieldset
            disabled={!canEdit && !isNativeInteractionNode(selected)}
            className={`${inspectorStyles.card} ${inspectorStyles.contentCard}`}
            data-native-text-fields="true"
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLTextAreaElement) ||
                !event.target.hasAttribute("data-native-text-input") ||
                event.altKey ||
                (!event.metaKey && !event.ctrlKey)
              )
                return;
              const key = event.key.toLowerCase();
              if (key !== "z" && !(event.ctrlKey && key === "y")) return;
              const action = key === "y" || event.shiftKey ? onRedo : onUndo;
              if (!action) return;
              event.preventDefault();
              event.stopPropagation();
              restoreHistory(action);
            }}
          >
            <legend>
              <EditorIcon name="content" />
              {copy(multiple ? "Last selected object" : "Selected object")}
            </legend>
            <p className={inspectorStyles.sectionHint}>{copy(context.hint)}</p>
            <div className={inspectorStyles.contentFields}>
              <div lang={locale} style={{ display: "contents" }}>
                <NativeSceneInteractionEditor
                  locale={locale}
                  disabled={!canEdit}
                  scene={scene}
                  node={isNativeInteractionNode(selected) ? selected : null}
                  onChange={onChange}
                  navigationTargets={navigationTargets}
                  onPreview={onPreviewInteraction}
                  previewUnavailableReason={previewInteractionUnavailableReason}
                />
              </div>
              {selected.type === "text" && selected.richText ? (
                <div lang={locale} style={{ display: "contents" }}>
                  <NativeRichTextEditor
                    locale={locale}
                    key={selected.id}
                    node={selected}
                    onUndo={onUndo ? () => restoreHistory(onUndo) : undefined}
                    onRedo={onRedo ? () => restoreHistory(onRedo) : undefined}
                    onChange={(node, field) => {
                      const next = updateNativeNode(scene, selected.id, () => node);
                      const minimumVersion = node.typography ? 9 : 2;
                      onChange(
                        {
                          ...next,
                          schemaVersion:
                            scene.schemaVersion >= minimumVersion
                              ? scene.schemaVersion
                              : minimumVersion,
                        },
                        field ? `native:${selected.id}:${field}` : undefined,
                      );
                    }}
                  />
                </div>
              ) : selected.type === "text" ? (
                <div className={inspectorStyles.plainTextEditor}>
                  <div className={inspectorStyles.plainTextTools}>
                    <NativeSceneTypographyControls
                      node={selected}
                      locale={locale}
                      onChange={(node, field) => update(() => node, field)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        let richText;
                        try {
                          richText = plainTextToPresentationRichText(selected.text);
                        } catch {
                          setFormatError(
                            "This text cannot be formatted within the slide's limits. Use at most 100 paragraphs, remove unsupported control characters, or reduce the slide's content.",
                          );
                          return;
                        }
                        setFormatError(null);
                        onChange({
                          ...updateNativeNode(scene, selected.id, () => ({
                            ...selected,
                            text: presentationRichTextToPlainText(richText),
                            richText,
                          })),
                          schemaVersion: scene.schemaVersion >= 2 ? scene.schemaVersion : 2,
                        });
                      }}
                    >
                      <EditorIcon name="format" />
                      <span>{copy("Format text")}</span>
                    </button>
                  </div>
                  <label>
                    {copy(selected.role === "title" ? "Native slide title" : "Node text")}
                    <textarea
                      data-native-text-input="true"
                      data-text-role={selected.role}
                      rows={selected.role === "title" ? 6 : 12}
                      aria-label={copy(
                        selected.role === "title" ? "Native slide title" : "Node text",
                      )}
                      lang={selected.lang ?? ""}
                      maxLength={selected.role === "title" ? 160 : 4000}
                      value={selected.text}
                      onChange={(event) =>
                        update(
                          (node) =>
                            node.type === "text" ? { ...node, text: event.target.value } : node,
                          "text",
                        )
                      }
                    />
                  </label>
                  <p className={inspectorStyles.textLength} aria-hidden="true">
                    {new Intl.NumberFormat(locale).format(selected.text.length)} /{" "}
                    {new Intl.NumberFormat(locale).format(selected.role === "title" ? 160 : 4000)}
                  </p>
                  {formatError ? (
                    <p role="alert" className={styles.formatError}>
                      {copy(formatError)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {selected.type === "table" || selected.type === "chart" ? (
                <div lang={locale} style={{ display: "contents" }}>
                  <NativeSceneDataEditor
                    locale={locale}
                    key={selected.id}
                    scene={scene}
                    node={selected}
                    onChange={onChange}
                  />
                </div>
              ) : null}
              {selected.type === "shape" ? (
                <>
                  <label>
                    {copy("Shape label")}
                    <input
                      lang=""
                      maxLength={200}
                      value={selected.label}
                      onChange={(event) =>
                        update(
                          (node) =>
                            node.type === "shape"
                              ? {
                                  ...node,
                                  label: event.target.value,
                                  ...(node.decorative && event.target.value.trim()
                                    ? { decorative: false }
                                    : {}),
                                }
                              : node,
                          "label",
                        )
                      }
                    />
                  </label>
                  <label>
                    {copy("Shape")}
                    <select
                      value={selected.shape}
                      onChange={(event) =>
                        update((node) =>
                          node.type === "shape"
                            ? { ...node, shape: event.target.value as typeof node.shape }
                            : node,
                        )
                      }
                    >
                      {shapes.map((shape) => (
                        <option key={shape} value={shape}>
                          {copy(shapeLabels[shape])}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {selected.type === "connector" ? (
                <>
                  <label>
                    {copy("Connector label")}
                    <input
                      lang=""
                      maxLength={200}
                      value={selected.label}
                      onChange={(event) =>
                        update(
                          (node) =>
                            node.type === "connector"
                              ? { ...node, label: event.target.value }
                              : node,
                          "label",
                        )
                      }
                    />
                  </label>
                  {(["from", "to"] as const).map((side) => (
                    <div key={side} className={inspectorStyles.propertyGrid}>
                      <label>
                        {copy(side === "from" ? "Connect from" : "Connect to")}
                        <select
                          value={selected[side].nodeId}
                          onChange={(event) =>
                            update((node) =>
                              node.type === "connector"
                                ? { ...node, [side]: { ...node[side], nodeId: event.target.value } }
                                : node,
                            )
                          }
                        >
                          {framed
                            .filter(
                              (node) =>
                                node.id !== selected[side === "from" ? "to" : "from"].nodeId,
                            )
                            .map((node) => {
                              const label = nativeControlNodeLabel(locale, node);
                              return (
                                <option key={node.id} value={node.id} lang={label.language}>
                                  {label.text}
                                </option>
                              );
                            })}
                        </select>
                      </label>
                      <label>
                        {copy(side === "from" ? "From anchor" : "To anchor")}
                        <select
                          value={selected[side].anchor}
                          onChange={(event) =>
                            update((node) =>
                              node.type === "connector"
                                ? {
                                    ...node,
                                    [side]: {
                                      ...node[side],
                                      anchor: event.target.value as typeof node.from.anchor,
                                    },
                                  }
                                : node,
                            )
                          }
                        >
                          {anchors.map((anchor) => (
                            <option key={anchor} value={anchor}>
                              {copy(anchor)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))}
                </>
              ) : null}
              {selected.type === "shape" || selected.type === "connector" ? (
                <label>
                  {copy("Object color")}
                  <select
                    value={palettePaint ? "palette" : selected.color}
                    onChange={(event) =>
                      update((node) => {
                        if (node.type !== "shape" && node.type !== "connector") return node;
                        const color = event.target.value as typeof node.color;
                        if (node.type !== "shape" || !node.appearance) return { ...node, color };
                        const appearance = { ...node.appearance };
                        // Explicit object color replaces palette paint, while preserving an
                        // authored outline/no-stroke treatment and its border thickness.
                        if (appearance.fill !== "none") delete appearance.fill;
                        if (appearance.stroke !== "none") delete appearance.stroke;
                        return { ...node, color, appearance };
                      })
                    }
                  >
                    {palettePaint ? (
                      <option value="palette" disabled>
                        {nativeControlsCopy(locale)("Theme palettes")}
                      </option>
                    ) : null}
                    {CanvasColorSchema.options.map((color) => (
                      <option key={color} value={color}>
                        {copy(color)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selected.type === "image" ? (
                <p className={styles.help}>
                  {copy("Use Media to adjust this image and Access to edit its description.")}
                </p>
              ) : null}
            </div>
            {selected.type === "text" && onTextAssistance ? (
              <NativeInspectorSection
                title={copy("Writing assistance")}
                icon="rewrite"
                name="writing-assistance"
              >
                <section
                  className={inspectorStyles.assistanceCard}
                  aria-label={copy("Writing assistance")}
                >
                  <div className={inspectorStyles.assistanceHeader}>
                    <EditorIcon name="rewrite" />
                    <h3>{copy("Writing assistance")}</h3>
                  </div>
                  <p className={inspectorStyles.sectionHint}>
                    {copy("Refine the selected text with AI.")}
                  </p>
                  <div className={inspectorStyles.assistanceActions}>
                    <button
                      type="button"
                      aria-label={copy("Rewrite text")}
                      disabled={
                        textAssistanceDisabled ||
                        multiple ||
                        Boolean(selected.richText) ||
                        !selected.text.trim()
                      }
                      onClick={() => requestTextAssistance("rewrite")}
                    >
                      <EditorIcon name="rewrite" />
                      <span>{copy("Rewrite")}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={copy("Shorten text")}
                      disabled={
                        textAssistanceDisabled ||
                        multiple ||
                        Boolean(selected.richText) ||
                        !selected.text.trim()
                      }
                      onClick={() => requestTextAssistance("shorten")}
                    >
                      <EditorIcon name="shorten" />
                      <span>{copy("Shorten")}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={copy("Translate text")}
                      disabled={
                        textAssistanceDisabled ||
                        multiple ||
                        Boolean(selected.richText) ||
                        !selected.text.trim()
                      }
                      onClick={() => requestTextAssistance("translate")}
                    >
                      <EditorIcon name="translate" />
                      <span>{copy("Translate")}</span>
                    </button>
                  </div>
                  {selected.richText ? (
                    <p>
                      {copy(
                        "Text assistance supports plain text only. Formatted text cannot be rewritten or shortened. Translation also requires plain text.",
                      )}
                    </p>
                  ) : multiple ? (
                    <p>{copy("Select one plain text object to use text assistance.")}</p>
                  ) : !selected.text.trim() ? (
                    <p>{copy("Enter some text before using text assistance.")}</p>
                  ) : null}
                </section>
              </NativeInspectorSection>
            ) : null}
            <div className={inspectorStyles.objectFooter}>
              {selected.type === "text" && selected.role === "title" ? (
                <p className={inspectorStyles.sectionHint}>
                  {copy("The slide title stays on this slide.")}
                </p>
              ) : null}
              <button
                className={inspectorStyles.deleteButton}
                type="button"
                disabled={!canEdit || (selected.type === "text" && selected.role === "title")}
                onClick={() => onChange(removeNativeSceneNodes(scene, [selected.id]))}
              >
                <EditorIcon name="trash" />
                <span>{copy("Delete object")}</span>
              </button>
            </div>
          </fieldset>
        </NativeInspectorSection>
      </div>
      <fieldset
        disabled={!canEdit}
        className={styles.permissionControls}
        hidden={sectionHidden("layout")}
        data-native-inspector-section="layout"
      >
        <div className={inspectorStyles.sectionHeader}>
          <EditorIcon name="layout" />
          <div>
            <h3>{copy("Layout and design")}</h3>
            <p>{copy("Arrange the slide and refine the selected object.")}</p>
          </div>
        </div>
        <NativeInspectorSection
          title={layoutAssistanceCopy(locale)("Local layout suggestions")}
          icon="sparkle"
          name="suggestions"
        >
          <div className={inspectorStyles.suggestionCard} lang={locale}>
            <NativeSceneLayoutSuggestions
              locale={locale}
              scene={scene}
              sourceKey={layoutSuggestionsSourceKey}
              disabled={layoutSuggestionsDisabled || mediaState !== "idle" || attachmentPending}
              onChange={(next) => {
                if (layoutSuggestionsDisabled || mediaState !== "idle" || attachmentPending)
                  return false;
                return onChange(next);
              }}
            />
          </div>
        </NativeInspectorSection>
        <NativeSceneDesignControls
          scene={scene}
          onChange={onChange}
          onApplyDesignToDeck={onApplyDesignToDeck}
        />
        <NativeSceneLayoutControls scene={scene} onChange={onChange} />
        <NativeSceneArrangementControls
          scene={scene}
          selectedIds={selectedIds}
          selectedId={selected.id}
          onChange={onChange}
        />
        <NativeSceneCompositionControls
          scene={scene}
          selectedIds={selectedIds}
          selectedId={selected.id}
          onChange={onChange}
        />
        <NativeInspectorSection
          title={copy("Position and size")}
          icon="layout"
          name="position"
          defaultOpen
        >
          <fieldset className={inspectorStyles.card}>
            <legend>
              <EditorIcon name="layout" />
              {copy("Position and size")}
            </legend>
            {selected.type !== "connector" ? (
              <div className={inspectorStyles.positionFields}>
                {(["x", "y", "width", "height"] as const).map((field) => (
                  <label key={field}>
                    {copy("Object {field} (%)", { field: copy(field) })}
                    <input
                      aria-label={copy("Object {field} (%)", { field: copy(field) })}
                      type="number"
                      min={field === "x" || field === "y" ? 0 : 1}
                      max={100}
                      step={1}
                      value={Math.round(selected.frame[field] * 100) / 100}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (!Number.isFinite(value)) return;
                        update(
                          (node) =>
                            node.type === "connector"
                              ? node
                              : {
                                  ...node,
                                  frame: boundNativeSceneFrame({ ...node.frame, [field]: value }),
                                },
                          `frame:${field}`,
                        );
                      }}
                    />
                  </label>
                ))}
              </div>
            ) : null}
            {multiple ? (
              <div className={styles.actions} aria-label={copy("Selection actions")}>
                {(
                  [
                    ["left", -1, 0],
                    ["right", 1, 0],
                    ["up", 0, -1],
                    ["down", 0, 1],
                  ] as const
                ).map(([direction, dx, dy]) => (
                  <button
                    key={direction}
                    type="button"
                    disabled={!canMoveSelection}
                    onClick={() => onChange(moveNativeSceneNodes(scene, selectedIds, dx, dy))}
                  >
                    {copy("Move selection {direction}", { direction: copy(direction) })}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onChange(removeNativeSceneNodes(scene, selectedIds))}
                >
                  <EditorIcon name="trash" />
                  <span>{copy("Delete selected objects")}</span>
                </button>
              </div>
            ) : null}
          </fieldset>
        </NativeInspectorSection>
        <details className={styles.editorDisclosure}>
          <summary>{copy("Moving and resizing objects")}</summary>
          <p className={styles.help}>
            {copy(
              "On wide screens, drag an object or its move button; drag its resize button to change size. Dragging near an object or slide edge/center shows snap guides; hold Alt to move freely. Press Escape to cancel a drag. Shift-click objects or use the selection checkboxes to move several together. Arrow keys on a move button nudge the selection by 1%, or 5% with Shift. Resize keys proportionally resize a stored group or change the focused object; numeric fields change the last selected object. Narrow screens use the reading-order view with keyboard and numeric controls. Deleting objects also removes their connectors. The title stays on the slide.",
            )}
          </p>
        </details>
      </fieldset>
      <fieldset
        disabled={!canEdit}
        className={styles.permissionControls}
        hidden={sectionHidden("media")}
        data-native-inspector-section="media"
      >
        <div className={inspectorStyles.sectionHeader}>
          <EditorIcon name="media" />
          <div>
            <h3>{copy("Images and video")}</h3>
            <p>{copy("Add visual content and accessible video links.")}</p>
          </div>
        </div>
        {selected.type === "image" ? (
          <NativeSceneImageDesignControls scene={scene} node={selected} onChange={onChange} />
        ) : null}
        <NativeInspectorSection title={copy("Add an image")} icon="image" name="add-image">
          <fieldset className={inspectorStyles.card}>
            <legend>
              <EditorIcon name="image" />
              {copy("Add an image")}
            </legend>
            <p className={inspectorStyles.sectionHint}>
              {copy("Start with a useful description, then choose an image.")}
            </p>
            <label>
              {copy("New image description")}
              <input
                aria-label={copy("New image description")}
                lang=""
                maxLength={300}
                value={imageAlt}
                onChange={(event) => setImageAlt(event.target.value)}
              />
            </label>
            <label>
              {copy("Add native image")}
              <input
                aria-label={copy("Add native image")}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!uploadsEnabled || mediaState !== "idle" || !canAdd || !imageAlt.trim()}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadImage(file, imageAlt.trim());
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <p className={styles.help}>
              {copy(
                attachmentPending
                  ? "Finish or discard the uploaded image attachment before choosing another image."
                  : mediaState === "uploading"
                    ? "Uploading to quarantine…"
                    : mediaState === "scanning"
                      ? "Checking image safety…"
                      : uploadsEnabled
                        ? "JPEG, PNG or WebP up to 10 MB. Describe each image before uploading; clean scanned images are added to this slide."
                        : "Uploads are unavailable until malware scanning is configured.",
              )}
            </p>
          </fieldset>
        </NativeInspectorSection>
        <NativeInspectorSection title={copy("Images and video")} icon="media" name="video">
          <div className={inspectorStyles.mediaCard} lang={locale}>
            <NativeSceneVideoControls
              locale={locale}
              scene={scene}
              canAdd={canAdd}
              onChange={onChange}
              // The accepted node is absent from this render's scene until the parent updates.
              onSelect={(id) => setSelection([id])}
            />
          </div>
        </NativeInspectorSection>
      </fieldset>
      <div hidden={sectionHidden("accessibility")} data-native-inspector-section="accessibility">
        <div className={inspectorStyles.sectionHeader}>
          <EditorIcon name="accessibility" />
          <div>
            <h3>{copy("Accessible content")}</h3>
            <p>{copy("Set a clear reading order, language and image descriptions.")}</p>
          </div>
        </div>
        <fieldset className={inspectorStyles.card}>
          <legend>
            <EditorIcon name="accessibility" />
            {copy("Slide objects · reading order")}
          </legend>
          <ol className={`${styles.nodeList} ${inspectorStyles.readingOrder}`}>
            {scene.readingOrder.map((id, index) => {
              const node = scene.nodes.find((item) => item.id === id)!;
              const label = nativeControlNodeLabel(locale, node);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={selectedIds.includes(id)}
                    onClick={(event) => select(id, event.shiftKey)}
                  >
                    {index + 1}
                    {". "}
                    <span lang={label.language}>{label.text}</span>
                  </button>
                  <label className={styles.selectionToggle}>
                    <input
                      type="checkbox"
                      aria-label={copy("Include {name} in selection", {
                        name: nativeControlNodeLabel(locale, node).text,
                      })}
                      checked={selectedIds.includes(id)}
                      onChange={() => select(id, true)}
                    />
                    {copy("Include in selection")}
                  </label>
                </li>
              );
            })}
          </ol>
          <p role="status" className={styles.help}>
            {copy(multiple ? "{count} objects selected" : "{count} object selected", {
              count: selectedIds.length,
            })}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={!canEdit || readingIndex <= 0}
              onClick={() => onChange(reorderNativeNode(scene, selected.id, -1))}
            >
              {copy("Read object earlier")}
            </button>
            <button
              type="button"
              disabled={!canEdit || readingIndex >= scene.readingOrder.length - 1}
              onClick={() => onChange(reorderNativeNode(scene, selected.id, 1))}
            >
              {copy("Read object later")}
            </button>
          </div>
          <p className={styles.help}>
            {copy(
              "Reading order is independent of visual position. On narrow screens objects appear in this order.",
            )}
          </p>
        </fieldset>
        <fieldset disabled={!canEdit} className={inspectorStyles.card}>
          <legend>
            <EditorIcon name={context.icon} />
            {copy("Selected object accessibility")}
          </legend>
          {selected.type === "text" ? (
            <label>
              {copy("Text language")}
              <select
                aria-label={copy("Text language")}
                value={selected.lang ?? ""}
                disabled={multiple}
                onChange={(event) => {
                  const value = event.target.value;
                  const parsed = PresentationTextLanguageSchema.safeParse(value);
                  if (value && !parsed.success) return;
                  try {
                    onChange(
                      setNativeTextLanguage(
                        scene,
                        selected.id,
                        parsed.success ? parsed.data : null,
                      ),
                    );
                  } catch {
                    setChangeFailure({
                      scene,
                      message:
                        "The language change cannot fit within the slide’s limits. Reduce content and try again; the current slide is retained.",
                    });
                  }
                }}
              >
                <option value="">{copy("Unspecified")}</option>
                {PRESENTATION_TEXT_LANGUAGES.map(({ code, label }) => (
                  <option key={code} value={code}>
                    {locale === "en-CA" ? label : (languageNames.of(code) ?? label)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selected.type === "image" ? (
            <label>
              {copy("Image alternative text")}
              <textarea
                lang=""
                maxLength={300}
                value={selected.altText ?? ""}
                onChange={(event) =>
                  update(
                    (node) =>
                      node.type === "image"
                        ? { ...node, altText: event.target.value || null }
                        : node,
                    "altText",
                  )
                }
              />
            </label>
          ) : null}
          {selected.type !== "text" && selected.type !== "image" ? (
            <p className={styles.help}>
              {copy(
                "Edit this object’s visible label in Content. Its label also identifies it to readers.",
              )}
            </p>
          ) : null}
        </fieldset>
      </div>
    </div>
  );
  return (
    <div className={styles.editor} lang={locale}>
      <fieldset
        disabled={!canEdit}
        className={`${styles.permissionControls} ${styles.objectToolbar} ${inspectorStyles.toolbar}`}
        aria-label={copy("Insert slide objects")}
        lang={locale}
      >
        <div className={styles.actions}>
          <button
            aria-label={copy("Add native text")}
            type="button"
            disabled={!canAdd}
            onClick={() =>
              add({
                id: clientUuid(),
                type: "text",
                role: "body",
                text: "",
                frame: { x: 8, y: 35, width: 55, height: 25 },
              })
            }
          >
            <EditorIcon name="text" />
            <span>{copy(inspectorTarget === undefined ? "Add native text" : "Text")}</span>
          </button>
          <button
            aria-label={copy("Add native shape")}
            type="button"
            disabled={!canAdd}
            onClick={() =>
              add({
                id: clientUuid(),
                type: "shape",
                shape: "rounded_rectangle",
                color: "blue",
                label: "",
                frame: { x: 65, y: 35, width: 25, height: 25 },
              })
            }
          >
            <EditorIcon name="shape" />
            <span>{copy(inspectorTarget === undefined ? "Add native shape" : "Shape")}</span>
          </button>
          <button
            aria-label={copy("Add native connector")}
            type="button"
            disabled={!canAdd || framed.length < 2}
            onClick={() =>
              add({
                id: clientUuid(),
                type: "connector",
                from: { nodeId: framed[0]!.id, anchor: "bottom" },
                to: { nodeId: framed[1]!.id, anchor: "top" },
                label: "",
                color: "blue",
              })
            }
          >
            <EditorIcon name="connector" />
            <span>
              {copy(inspectorTarget === undefined ? "Add native connector" : "Connector")}
            </span>
          </button>
        </div>
        <EditorDisclosure
          label={copy("Interactions")}
          icon="interaction"
          align="start"
          className={inspectorStyles.insertMenu}
        >
          <EditorMenuSection label={copy("Audience interactions")}>
            <button
              type="button"
              disabled={!canAdd}
              onClick={(event) => insertFromMenu(createNativeRevealNode(), event?.currentTarget)}
            >
              <EditorIcon name="reveal" />
              <span>{copy("Add reveal panel")}</span>
            </button>
            <button
              type="button"
              disabled={!canAdd}
              onClick={(event) => insertFromMenu(createNativeDialogNode(), event?.currentTarget)}
            >
              <EditorIcon name="dialog" />
              <span>{copy("Add detail dialog")}</span>
            </button>
            <button
              type="button"
              disabled={!canAdd}
              onClick={(event) => {
                const image =
                  selected.type === "image"
                    ? selected
                    : scene.nodes.find((node) => node.type === "image" && !node.rotation);
                insertFromMenu(
                  createNativeHotspotNode(image?.type === "image" ? image : undefined),
                  event?.currentTarget,
                );
              }}
            >
              <EditorIcon name="hotspot" />
              <span>{copy("Add image hotspot")}</span>
            </button>
          </EditorMenuSection>
          <EditorMenuSection label={copy("Links and navigation")}>
            <button
              type="button"
              disabled={!canAdd}
              onClick={(event) => insertFromMenu(createNativeLinkNode(), event?.currentTarget)}
            >
              <EditorIcon name="link" />
              <span>{copy("Add link")}</span>
            </button>
            <button
              type="button"
              disabled={!canAdd}
              onClick={(event) =>
                insertFromMenu(createNativeNavigationNode(), event?.currentTarget)
              }
            >
              <EditorIcon name="navigation" />
              <span>{copy("Add slide link")}</span>
            </button>
          </EditorMenuSection>
          <p className={inspectorStyles.menuHint}>
            {copy(
              "Local panels and detail dialogs open on each viewer’s screen. Broadcast reveals are controlled by the facilitator during live delivery. Interactions do not submit answers. Keep confidential notes in speaker notes.",
            )}
          </p>
        </EditorDisclosure>
        <EditorDisclosure
          label={copy("Insert more")}
          icon="plus"
          align="start"
          className={inspectorStyles.insertMenu}
        >
          <EditorMenuSection label={copy("Tables and charts")}>
            <button
              type="button"
              disabled={!canAdd}
              onClick={(event) =>
                insertFromMenu(createNativeTableNode(locale), event?.currentTarget)
              }
            >
              <EditorIcon name="table" />
              <span>{copy("Add table")}</span>
            </button>
            {(["bar", "line", "pie"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={!canAdd}
                onClick={(event) =>
                  insertFromMenu(createNativeChartNode(kind, locale), event?.currentTarget)
                }
              >
                <EditorIcon name="chart" />
                <span>{copy("Add {kind} chart", { kind: copy(kind) })}</span>
              </button>
            ))}
          </EditorMenuSection>
          <p className={inspectorStyles.menuHint}>
            {copy("Up to {count} objects per slide.", { count: PRESENTATION_SCENE_MAX_NODES })}
          </p>
        </EditorDisclosure>
      </fieldset>
      {changeFailure?.scene === scene ? (
        <p className={styles.formatError} role="alert">
          {copy(changeFailure.message)}
        </p>
      ) : null}
      <div lang="en-CA" style={{ display: "contents" }}>
        <NativeSceneCanvas
          locale={locale}
          canEdit={canEdit}
          scene={scene}
          renderImage={renderImage}
          selectedNodeIds={selectedIds}
          navigationTargets={navigationTargets}
          onEditInteraction={(id) => {
            select(id);
            onInspectSelection?.(true);
          }}
          onSelect={(id, additive) => {
            select(id, additive);
            onInspectSelection?.();
          }}
          onChange={onChange}
        />
      </div>
      {inlineInspector
        ? inspector
        : inspectorTarget
          ? createPortal(inspector, inspectorTarget)
          : null}
    </div>
  );
}
