import type { SupportedLocale } from "@openround/contracts";
import sessionSummaryEnglishMessages, { type SessionSummaryMessages } from "./en-CA";

const loaders: Record<SupportedLocale, () => Promise<{ default: SessionSummaryMessages }>> = {
  "en-CA": async () => ({ default: sessionSummaryEnglishMessages }),
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

export async function loadSessionSummaryMessages(locale: SupportedLocale) {
  return (await loaders[locale]()).default;
}
export { sessionSummaryEnglishMessages };
export type { SessionSummaryMessageKey, SessionSummaryMessages } from "./en-CA";
