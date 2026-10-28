import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AVATAR_IDS, supportedLocales } from "@openround/contracts";
import { loadMessages, translate } from "../lib/i18n/catalog";
import { LocaleProvider } from "./locale-provider";
import { withEnglishLocale } from "../test-utils/english-locale";
import {
  AvatarPicker,
  PARTICIPANT_AVATARS,
  ParticipantAvatar,
  ParticipantIdentity,
} from "./participant-avatar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/play/test-session",
}));

describe("participant avatars", () => {
  it("defines an original labelled presentation for every contract avatar", () => {
    expect(PARTICIPANT_AVATARS).toHaveLength(24);
    expect(PARTICIPANT_AVATARS.map((avatar) => avatar.id)).toEqual(AVATAR_IDS);
    expect(new Set(PARTICIPANT_AVATARS.map((avatar) => avatar.emoji)).size).toBe(AVATAR_IDS.length);

    const markup = renderToStaticMarkup(withEnglishLocale(<ParticipantAvatar avatarId="owl" />));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Owl avatar"');
    expect(markup).toContain("🦉");
  });

  it("renders a required native radio group with exactly one selected avatar", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<AvatarPicker onChange={() => undefined} value="rocket" />),
    );
    expect(markup).toContain("Choose your avatar");
    expect(markup).toContain("Explore 24 avatars. Scroll for more.");
    expect(markup.match(/type="radio"/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup.match(/required=""/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup.match(/avatar-option-check/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup).toContain('value="rocket"');
  });

  it("renders every avatar with a localized picker label and accessible name in all ten locales", async () => {
    for (const locale of supportedLocales) {
      const messages = await loadMessages(locale, ["live-delivery"]);
      const localized = (children: ReactNode) => (
        <LocaleProvider
          initialDomains={["live-delivery"]}
          initialLocale={locale}
          initialMessages={messages}
        >
          {children}
        </LocaleProvider>
      );
      const picker = renderToStaticMarkup(
        localized(<AvatarPicker onChange={() => undefined} value="hedgehog" />),
      );
      expect(picker.match(/type="radio"/g), locale).toHaveLength(24);
      expect(picker.match(/checked=""/g), locale).toHaveLength(1);
      for (const avatar of PARTICIPANT_AVATARS) {
        const label = messages[`live.avatar.${avatar.id}`] ?? "";
        expect(label.trim(), `${locale}: ${avatar.id}`).not.toBe("");
        expect(picker, `${locale}: ${avatar.id}`).toContain(`>${label}</span>`);
        const image = renderToStaticMarkup(localized(<ParticipantAvatar avatarId={avatar.id} />));
        expect(image, `${locale}: ${avatar.id}`).toContain(avatar.emoji);
        expect(image, `${locale}: ${avatar.id}`).toContain(
          `aria-label="${translate(messages, "live.avatar.ariaLabel", { name: label })}"`,
        );
      }
    }
  });

  it("keeps selection disabled while joining and hides decorative images from assistive technology", () => {
    const picker = renderToStaticMarkup(
      withEnglishLocale(<AvatarPicker disabled onChange={() => undefined} value="turtle" />),
    );
    expect(picker).toMatch(/<fieldset[^>]*disabled=""/);
    expect(picker.match(/checked=""/g)).toHaveLength(1);
    expect(picker).toContain('value="turtle"');
    const image = renderToStaticMarkup(
      withEnglishLocale(<ParticipantAvatar avatarId="turtle" decorative />),
    );
    expect(image).toContain('aria-hidden="true"');
    expect(image).not.toContain('role="img"');
    expect(image).not.toContain("aria-label");
  });

  it("masks the chosen avatar and leaves the participant-authored nickname language unknown", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ParticipantIdentity avatarId="fox" identityVisible={false} nickname="Participant" />,
      ),
    );
    expect(markup).toContain("Participant");
    expect(markup).toContain('<span lang="">Participant</span>');
    expect(markup).not.toContain("🦊");
    expect(markup).not.toContain("Fox avatar");
    expect(markup).not.toContain('data-avatar="fox"');
  });
});
