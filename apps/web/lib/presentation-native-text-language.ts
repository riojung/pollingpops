import {
  PresentationSceneDraftSchema,
  PresentationTextLanguageSchema,
  type PresentationScene,
  type PresentationTextLanguage,
} from "@openround/contracts";
import { updateNativeNode } from "./presentation-native-scene";

/** A creator can correct/clear pronunciation without rewriting text or its AI edit history. */
export function setNativeTextLanguage(
  scene: PresentationScene,
  nodeId: string,
  language: PresentationTextLanguage | null,
): PresentationScene {
  const lang = language === null ? undefined : PresentationTextLanguageSchema.parse(language);
  const target = scene.nodes.find((node) => node.id === nodeId);
  if (target?.type !== "text" || target.lang === lang) return scene;
  const next = updateNativeNode(scene, nodeId, (node) => {
    if (node.type !== "text") return node;
    if (lang !== undefined) return { ...node, lang };
    const { lang: removed, ...rest } = node;
    void removed;
    return rest;
  });
  PresentationSceneDraftSchema.parse(next);
  return next;
}
