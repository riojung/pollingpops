import { expect, test, type Page } from "@playwright/test";
import korean from "../../apps/web/lib/i18n/domains/delivery-authoring/ko-KR";
import german from "../../apps/web/lib/i18n/domains/delivery-authoring/de-DE";
import { sourceWorkflowsCopy } from "../../apps/web/components/presentation/source-workflows-copy";
import { presentationCommandCopy } from "../../apps/web/components/presentation/presentation-command-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import {
  closeSpecialistInspector,
  specialistLanguage,
  specialistLocale,
  specialistQuality,
} from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.skip(
  process.env.BETA_E2E_AUTHORING !== "true",
  "Trusted-source form uses the owned authoring configuration.",
);
test.use({ actionTimeout: 20_000 });

async function refreshWorkspace(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B trusted-source guidance retains pasted input across locale and current permission changes ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const record = await createE01Deck(page, [e01Slide("Original source workflow slide")], 14);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/v1\/(?:authoring\/jobs|presentations\/[^/]+\/blocks\/source-proposals)/.test(
          request.url(),
        )
      )
        writes.push(request.url());
    });
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      await closeSpecialistInspector(page);
      const mapToggle = page.locator('button[aria-controls="presentation-slide-navigator"]');
      if ((await mapToggle.getAttribute("aria-expanded")) === "false") await mapToggle.click();
      const map = page.locator("#presentation-slide-navigator");
      const opener = map.getByRole("button", {
        name: korean["delivery.presentationBuilder.fromTrustedSource"],
        exact: true,
      });
      if (!(await opener.isVisible()))
        await map
          .getByTitle(presentationCommandCopy("ko-KR").insertImport, { exact: true })
          .click();
      await opener.click();
      let dialog = page.getByRole("dialog", {
        name: korean["delivery.assistant.insertTrustedSource"],
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("lang", "ko-KR");
      await expect(
        dialog.getByRole("button", { name: sourceWorkflowsCopy("ko-KR")("Close"), exact: true }),
      ).toBeFocused();
      await expect(dialog).toContainText(sourceWorkflowsCopy("ko-KR")("Review before insertion"));
      const sourceName = "Review before insertion";
      const sourceText =
        "Le texte source original conserve sa langue et ses citations pendant la préparation de cette présentation.";
      await dialog
        .getByRole("textbox", { name: korean["delivery.assistant.sourceName"], exact: true })
        .fill(sourceName);
      await dialog
        .getByRole("textbox", { name: korean["delivery.assistant.trustedText"], exact: true })
        .fill(sourceText);
      for (const key of [
        "delivery.assistant.sourceName",
        "delivery.assistant.trustedText",
      ] as const)
        await specialistLanguage(
          dialog.getByRole("textbox", { name: korean[key], exact: true }),
          "",
        );
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press(index % 2 ? "Shift+Tab" : "Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      await specialistQuality(page);
      await page.screenshot({
        path: info.outputPath("trusted-source-korean-review.png"),
        fullPage: true,
      });
      await specialistLocale(page, "de-DE");
      await refreshWorkspace(page);
      dialog = page.getByRole("dialog", {
        name: german["delivery.assistant.insertTrustedSource"],
        exact: true,
      });
      await expect(dialog).toHaveAttribute("lang", "de-DE");
      await expect(
        dialog.getByRole("textbox", { name: german["delivery.assistant.sourceName"], exact: true }),
      ).toHaveValue(sourceName);
      await expect(
        dialog.getByRole("textbox", {
          name: german["delivery.assistant.trustedText"],
          exact: true,
        }),
      ).toHaveValue(sourceText);
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await refreshWorkspace(page);
      await expect(
        dialog.getByText(german["delivery.assistant.viewerNotice"], { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: sourceWorkflowsCopy("de-DE")("Close"), exact: true }),
      ).toBeFocused();
      await expect(
        dialog.getByRole("button", {
          name: german["delivery.assistant.createProposal"],
          exact: true,
        }),
      ).toBeHidden();
      await expect(dialog.getByRole("textbox")).toHaveCount(0);
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
      expect(writes).toEqual([]);
      await specialistQuality(page);
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await refreshWorkspace(page);
      await expect(
        dialog.getByRole("textbox", { name: german["delivery.assistant.sourceName"], exact: true }),
      ).toHaveValue(sourceName);
      await expect(
        dialog.getByRole("textbox", {
          name: german["delivery.assistant.trustedText"],
          exact: true,
        }),
      ).toHaveValue(sourceText);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(
        map.getByRole("button", {
          name: german["delivery.presentationBuilder.fromTrustedSource"],
          exact: true,
        }),
      ).toBeFocused();
      expect(writes).toEqual([]);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await specialistLocale(page, "en-CA");
    }
  });
}
