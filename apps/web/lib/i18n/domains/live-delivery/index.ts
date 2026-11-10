import type { SupportedLocale } from "@openround/contracts";
import liveDeliveryEnglishMessages, { type LiveDeliveryMessages } from "./en-CA";
import { companionMessages } from "./companion-translations";

const loaders: Record<SupportedLocale, () => Promise<{ default: LiveDeliveryMessages }>> = {
  "en-CA": async () => ({ default: liveDeliveryEnglishMessages }),
  "fr-FR": () => import("./fr-FR"),
  "de-DE": () => import("./de-DE"),
  "es-ES": () => import("./es-ES"),
  "it-IT": () => import("./it-IT"),
  "pt-PT": () => import("./pt-PT"),
  "ja-JP": () => import("./ja-JP"),
  "ko-KR": () => import("./ko-KR"),
  "zh-CN": () => import("./zh-CN"),
  "zh-TW": () => import("./zh-TW"),
};

export async function loadLiveDeliveryMessages(locale: SupportedLocale) {
  return { ...(await loaders[locale]()).default, ...companionMessages(locale) };
}

export { liveDeliveryEnglishMessages };
export type { LiveDeliveryMessageKey, LiveDeliveryMessages } from "./en-CA";
