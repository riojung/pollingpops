import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { packPracticeCopy } from "../../apps/web/lib/i18n/pack-practice-copy";
import { e01ApiUrl } from "./presentation-e01-support";
import { specialistLocale, specialistQuality } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Pack practice entry keeps frozen links across locale and permission changes ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const recheckId = randomUUID();
    const diagnostic = {
      id: randomUUID(),
      type: "numeric",
      prompt: "Original diagnostic: half of eight?",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["halves"],
      linkedRecheckQuestionId: recheckId,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation: "Original explanation",
      mediaId: null,
      mediaAlt: null,
      correctValue: "4",
      tolerance: "0",
      unit: null,
    };
    const title = `Original practice Pack ${randomUUID().slice(0, 8)}`;
    const created = await page.request.post(`${e01ApiUrl}/v1/recovery-packs`, {
      data: {
        draft: {
          schemaVersion: 1,
          title,
          description: "Original frozen source",
          diagnostic,
          recheck: {
            ...diagnostic,
            id: recheckId,
            prompt: "Original recheck: half of twelve?",
            correctValue: "6",
            delivery: "recheck",
            linkedRecheckQuestionId: null,
          },
          delayedProbe: {
            ...diagnostic,
            id: randomUUID(),
            prompt: "Original delayed probe: half of sixteen?",
            correctValue: "8",
            linkedRecheckQuestionId: null,
          },
          interventions: [
            {
              id: randomUUID(),
              title: "Original facilitator card",
              body: "PRIVATE_FROZEN_GUIDANCE",
            },
          ],
          conceptKeys: ["halves"],
          misconceptionKeys: [],
          citations: [],
        },
      },
    });
    expect(created.status()).toBe(201);
    const pack = (await created.json()).pack;
    const published = await page.request.post(`${e01ApiUrl}/v1/recovery-packs/${pack.id}/publish`, {
      data: { expectedDraftRevision: pack.draftRevision },
    });
    expect(published.status()).toBe(200);
    const version = (await published.json()).version;
    const baseline = (
      await (await page.request.get(`${e01ApiUrl}/v1/recovery-packs/${pack.id}`)).json()
    ).pack;
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
        /\/v1\/(?:recovery-packs|practice-assignments|authoring\/jobs)/.test(request.url())
      )
        mutations.push(request.url());
    });
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto("/recovery-packs");
      await page
        .getByRole("button")
        .filter({ has: page.getByText(title, { exact: true }) })
        .click();
      for (const locale of ["ko-KR", "de-DE"] as const) {
        if (locale === "de-DE") {
          await specialistLocale(page, locale);
          await page.evaluate(() =>
            window.dispatchEvent(new Event("polling-pops:workspace-updated")),
          );
        }
        const copy = packPracticeCopy(locale);
        for (const mode of ["delayed_probe", "full_sequence"] as const) {
          const section = page.getByRole("region", {
            name: copy(
              mode === "full_sequence"
                ? "Full-sequence Pack practice"
                : "Pack delayed-probe practice",
            ),
            exact: true,
          });
          const link = section.getByRole("link", {
            name: copy(
              mode === "full_sequence"
                ? "Assign full-sequence practice"
                : "Assign delayed-probe practice",
            ),
            exact: true,
          });
          await expect(link).toHaveAttribute(
            "href",
            `/recovery-packs/${pack.id}/assign?version=${version.id}${mode === "full_sequence" ? "&mode=full_sequence" : ""}`,
          );
        }
        await specialistQuality(page);
        await page.screenshot({
          path: info.outputPath(`pack-practice-entry-${locale}.png`),
          fullPage: true,
        });
      }
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
      const copy = packPracticeCopy("de-DE");
      for (const mode of ["delayed_probe", "full_sequence"] as const) {
        const section = page.getByRole("region", {
          name: copy(
            mode === "full_sequence"
              ? "Full-sequence Pack practice"
              : "Pack delayed-probe practice",
          ),
          exact: true,
        });
        await expect(section).toContainText(
          copy("An owner or editor must create the practice assignment."),
        );
        await expect(section.getByRole("button")).toBeDisabled();
        await expect(section.getByRole("link")).toHaveCount(0);
      }
      expect(
        (await (await page.request.get(`${e01ApiUrl}/v1/recovery-packs/${pack.id}`)).json()).pack,
      ).toEqual(baseline);
      expect(mutations).toEqual([]);
      await specialistQuality(page);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await specialistLocale(page, "en-CA");
    }
  });
}
