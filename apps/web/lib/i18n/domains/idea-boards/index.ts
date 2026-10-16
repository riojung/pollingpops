import type { SupportedLocale } from "@openround/contracts";
import ideaBoardEnglishMessages, { type IdeaBoardMessages } from "./en-CA";

const loaders: Record<SupportedLocale, () => Promise<{ default: IdeaBoardMessages }>> = {
  "en-CA": async () => ({ default: ideaBoardEnglishMessages }),
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

export async function loadIdeaBoardMessages(locale: SupportedLocale) {
  return (await loaders[locale]()).default;
}
export { ideaBoardEnglishMessages };
export type { IdeaBoardMessageKey, IdeaBoardMessages } from "./en-CA";
