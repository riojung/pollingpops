import type { SupportedLocale } from "@openround/contracts";
import {
  englishMessages as coreEnglishMessages,
  type MessageKey as CoreMessageKey,
} from "./messages/en-CA";
import type { AccountMessageKey } from "./domains/account/en-CA";
import type { DeliveryAuthoringMessageKey } from "./domains/delivery-authoring/en-CA";
import type { LiveDeliveryMessageKey } from "./domains/live-delivery/en-CA";
import type { ReportRoundMessageKey } from "./domains/report-round/en-CA";
import type { WorkspacePageMessageKey } from "./domains/workspace-pages";

export const localeDomains = [
  "account",
  "workspace-pages",
  "delivery-authoring",
  "report-round",
  "live-delivery",
] as const;

export type LocaleDomain = (typeof localeDomains)[number];
export type MessageKey =
  | CoreMessageKey
  | AccountMessageKey
  | WorkspacePageMessageKey
  | DeliveryAuthoringMessageKey
  | ReportRoundMessageKey
  | LiveDeliveryMessageKey;
export type Messages = Partial<Record<MessageKey, string>>;
export type MessageCatalog = Messages;

// Core copy is the only catalog shipped in the global client baseline. Feature
// domains are imported on demand for the active route.
export const englishMessages: Messages = coreEnglishMessages;

const coreLoaders: Record<SupportedLocale, () => Promise<{ default: Record<string, string> }>> = {
  "en-CA": async () => ({ default: coreEnglishMessages }),
  "fr-FR": () => import("./messages/fr-FR"),
  "de-DE": () => import("./messages/de-DE"),
  "es-ES": () => import("./messages/es-ES"),
  "it-IT": () => import("./messages/it-IT"),
  "pt-PT": () => import("./messages/pt-PT"),
  "ja-JP": () => import("./messages/ja-JP"),
  "ko-KR": () => import("./messages/ko-KR"),
  "zh-CN": () => import("./messages/zh-CN"),
  "zh-TW": () => import("./messages/zh-TW"),
};

const domainLoaders: Record<LocaleDomain, (locale: SupportedLocale) => Promise<MessageCatalog>> = {
  account: async (locale) => {
    const catalog = await import("./domains/account");
    return {
      ...catalog.accountEnglishMessages,
      ...(await catalog.loadAccountMessages(locale)),
    };
  },
  "workspace-pages": async (locale) => {
    const catalog = await import("./domains/workspace-pages");
    return {
      ...catalog.workspacePageEnglishMessages,
      ...(await catalog.loadWorkspacePageMessages(locale)),
    };
  },
  "delivery-authoring": async (locale) => {
    const catalog = await import("./domains/delivery-authoring");
    return {
      ...catalog.deliveryAuthoringEnglishMessages,
      ...(await catalog.loadDeliveryAuthoringMessages(locale)),
    };
  },
  "report-round": async (locale) => {
    const catalog = await import("./domains/report-round");
    return {
      ...catalog.reportRoundEnglishMessages,
      ...(await catalog.loadReportRoundMessages(locale)),
    };
  },
  "live-delivery": async (locale) => {
    const catalog = await import("./domains/live-delivery");
    return {
      ...catalog.liveDeliveryEnglishMessages,
      ...(await catalog.loadLiveDeliveryMessages(locale)),
    };
  },
};

function uniqueDomains(domains: readonly LocaleDomain[]) {
  return [...new Set(domains)];
}

const roundEditorDomains = [
  "delivery-authoring",
  "report-round",
  "live-delivery",
] as const satisfies readonly LocaleDomain[];

function quizRouteDomains(path: string): LocaleDomain[] | null {
  const match = /^\/quiz\/[^/]+(?:\/([^/]+))?\/?$/.exec(path);
  if (!match) return path === "/quiz" || path === "/quiz/" ? [] : null;

  switch (match[1]) {
    case undefined:
    case "preview":
    case "rehearse":
      return [...roundEditorDomains];
    case "assign":
      return ["account", "delivery-authoring", "report-round"];
    default:
      return [];
  }
}

export function localeDomainsForPath(pathname: string): LocaleDomain[] {
  const path = pathname.split("?", 1)[0] || "/";

  if (path === "/account" || path.startsWith("/account/")) return ["account"];
  // Survey sharing reuses the QR/address controls from live delivery.
  if (/^\/surveys\/rooms\/[^/]+\/?$/.test(path)) return ["live-delivery"];
  if (
    [
      "/home",
      "/library",
      "/sessions",
      "/assignments",
      "/results",
      "/discover",
      "/groups",
      "/activity",
      "/help",
    ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  ) {
    return ["workspace-pages"];
  }
  const quizDomains = quizRouteDomains(path);
  if (quizDomains) return quizDomains;
  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    return ["workspace-pages", "delivery-authoring", "report-round"];
  }
  if (path === "/report" || path.startsWith("/report/")) {
    return ["report-round", "live-delivery"];
  }
  if (
    ["/practice", "/followup"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  ) {
    return ["report-round"];
  }
  if (
    ["/host", "/play", "/present", "/presentation-session", "/embed/present"].some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return ["live-delivery"];
  }
  if (path === "/") return ["delivery-authoring"];
  if (path === "/create" || path === "/create/") {
    return ["delivery-authoring", "report-round"];
  }
  if (path === "/recovery-packs" || path === "/recovery-packs/") {
    return ["delivery-authoring"];
  }
  if (
    path === "/presentation/join" ||
    path.startsWith("/presentation/join/") ||
    /^\/presentation\/[^/]+\/host\/?$/.test(path)
  ) {
    return ["delivery-authoring", "live-delivery"];
  }
  if (
    ["/signin", "/invite", "/presentation"].some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ) ||
    path === "/create/presentation" ||
    path.startsWith("/create/presentation/")
  ) {
    return ["delivery-authoring"];
  }
  if (path === "/join" || path.startsWith("/join/")) {
    return ["delivery-authoring", "live-delivery"];
  }
  return [];
}

export async function loadDomainMessages(
  locale: SupportedLocale,
  domains: readonly LocaleDomain[],
): Promise<MessageCatalog> {
  const catalogs = await Promise.all(
    uniqueDomains(domains).map((domain) => domainLoaders[domain](locale)),
  );
  return Object.assign({}, ...catalogs) as MessageCatalog;
}

export async function loadMessages(
  locale: SupportedLocale,
  domains: readonly LocaleDomain[] = localeDomains,
): Promise<Messages> {
  const [core, domainMessages] = await Promise.all([
    coreLoaders[locale](),
    loadDomainMessages(locale, domains),
  ]);
  return {
    ...coreEnglishMessages,
    ...core.default,
    ...domainMessages,
  };
}

export async function loadMessagesWithFallback(
  locale: SupportedLocale,
  domains: readonly LocaleDomain[] = localeDomains,
): Promise<{
  locale: SupportedLocale;
  messages: Messages;
  fellBack: boolean;
}> {
  try {
    return { locale, messages: await loadMessages(locale, domains), fellBack: false };
  } catch {
    return {
      locale: "en-CA",
      messages: await loadMessages("en-CA", domains),
      fellBack: locale !== "en-CA",
    };
  }
}

export function translate(
  messages: Messages,
  key: MessageKey,
  values: Record<string, string | number> = {},
) {
  const message = messages[key] ?? coreEnglishMessages[key as CoreMessageKey] ?? key;
  return message.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
