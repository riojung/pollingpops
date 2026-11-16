import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { PRODUCT_BRAND } from "@openround/contracts";
import { ColorModeSync } from "../components/color-mode-sync";
import { LocaleProvider } from "../components/locale-provider";
import { IdleSessionProvider } from "../components/idle-session-provider";
import { COLOR_MODE_BOOTSTRAP_SCRIPT } from "../lib/color-mode";
import { loadMessagesWithFallback, localeDomainsForPath } from "../lib/i18n/catalog";
import { LOCALE_COOKIE_NAME, localeDirection, resolveLocale } from "../lib/i18n/config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.OPENROUND_PUBLIC_URL || `http://localhost:${process.env.PORT || "3000"}`,
  ),
  title: { default: PRODUCT_BRAND.name, template: `%s · ${PRODUCT_BRAND.name}` },
  applicationName: PRODUCT_BRAND.name,
  description: PRODUCT_BRAND.description,
  icons: {
    icon: { url: PRODUCT_BRAND.iconPath, type: "image/svg+xml" },
    apple: "/brand/polling-pops-apple.png",
  },
  openGraph: {
    title: `${PRODUCT_BRAND.name} · ${PRODUCT_BRAND.tagline}`,
    description: PRODUCT_BRAND.description,
    siteName: PRODUCT_BRAND.name,
    images: [{ url: "/brand/polling-pops-social.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_BRAND.name} · ${PRODUCT_BRAND.tagline}`,
    description: PRODUCT_BRAND.description,
    images: ["/brand/polling-pops-social.png"],
  },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const requestedLocale = resolveLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });
  const initialDomains = localeDomainsForPath(requestHeaders.get("x-openround-pathname") ?? "/");
  const { locale, messages, fellBack } = await loadMessagesWithFallback(
    requestedLocale,
    initialDomains,
  );
  return (
    <html
      data-color-mode="light"
      data-color-mode-preference="system"
      data-interface-theme="classic"
      data-scroll-behavior="smooth"
      dir={localeDirection(locale)}
      lang={locale}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_MODE_BOOTSTRAP_SCRIPT }} nonce={nonce} />
      </head>
      <body>
        <LocaleProvider
          initialDomains={initialDomains}
          initialLoadError={fellBack}
          initialLocale={locale}
          initialMessages={messages}
        >
          <ColorModeSync />
          <IdleSessionProvider>{children}</IdleSessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
