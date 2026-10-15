import type { ReactNode } from "react";
import { LocaleProvider } from "../components/locale-provider";
import { englishMessages, localeDomains, type Messages } from "../lib/i18n/catalog";
import { accountEnglishMessages } from "../lib/i18n/domains/account";
import { deliveryAuthoringEnglishMessages } from "../lib/i18n/domains/delivery-authoring";
import { liveDeliveryEnglishMessages } from "../lib/i18n/domains/live-delivery";
import { reportRoundEnglishMessages } from "../lib/i18n/domains/report-round";
import { workspacePageEnglishMessages } from "../lib/i18n/domains/workspace-pages";
import { sessionSummaryEnglishMessages } from "../lib/i18n/domains/session-summary";

const allEnglishMessages: Messages = {
  ...englishMessages,
  ...accountEnglishMessages,
  ...workspacePageEnglishMessages,
  ...deliveryAuthoringEnglishMessages,
  ...reportRoundEnglishMessages,
  ...liveDeliveryEnglishMessages,
  ...sessionSummaryEnglishMessages,
};

export function EnglishLocaleTestProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <LocaleProvider
      initialDomains={localeDomains}
      initialLocale="en-CA"
      initialMessages={allEnglishMessages}
    >
      {children}
    </LocaleProvider>
  );
}

export function withEnglishLocale(children: ReactNode) {
  return <EnglishLocaleTestProvider>{children}</EnglishLocaleTestProvider>;
}
