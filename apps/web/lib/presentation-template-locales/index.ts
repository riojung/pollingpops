import type { SupportedLocale } from "@openround/contracts";
import type { PresentationTemplateLocaleCatalog } from "./types";

type AuthoredLocale = Exclude<SupportedLocale, "en-CA">;
const loaders = {
  "fr-FR": () => import("./fr-FR.json"),
  "de-DE": () => import("./de-DE.json"),
  "es-ES": () => import("./es-ES.json"),
  "it-IT": () => import("./it-IT.json"),
  "pt-PT": () => import("./pt-PT.json"),
  "ja-JP": () => import("./ja-JP.json"),
  "ko-KR": () => import("./ko-KR.json"),
  "zh-CN": () => import("./zh-CN.json"),
  "zh-TW": () => import("./zh-TW.json"),
} satisfies Record<AuthoredLocale, () => Promise<{ default: PresentationTemplateLocaleCatalog }>>;

const catalogs = new Map<AuthoredLocale, PresentationTemplateLocaleCatalog>();
const pending = new Map<AuthoredLocale, Promise<void>>();

function freezeCatalog<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeCatalog);
    Object.freeze(value);
  }
  return value;
}

/** Fetch only the requested creation catalog. English uses the historical source without a fetch. */
export function loadPresentationTemplateLocale(locale: SupportedLocale): Promise<void> {
  if (locale === "en-CA" || catalogs.has(locale)) return Promise.resolve();
  const existing = pending.get(locale);
  if (existing) return existing;
  const request = loaders[locale]()
    .then((module) => {
      catalogs.set(locale, freezeCatalog(module.default));
    })
    .finally(() => pending.delete(locale));
  pending.set(locale, request);
  return request;
}

export function isPresentationTemplateLocaleLoaded(locale: SupportedLocale): boolean {
  return locale === "en-CA" || catalogs.has(locale);
}

/** Creation is synchronous after loading; a missing localized catalog must never masquerade as English. */
export function presentationTemplateLocaleCatalog(locale: SupportedLocale) {
  if (locale === "en-CA") return null;
  const catalog = catalogs.get(locale);
  if (!catalog) throw new Error(`Presentation template locale has not loaded: ${locale}`);
  return catalog;
}
