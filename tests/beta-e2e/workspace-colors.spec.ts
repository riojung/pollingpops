import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  FollowupSummarySchema,
  ReportSummarySchema,
  SessionSummarySchema,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabTo,
} from "./option-b-accessibility-support";
import {
  densityAxe,
  installDensityFixtures,
  measureDensity,
  type DensityMetric,
} from "./workspace-density-support";

const collection = (page: Page) => page.locator("main section[data-view]:visible");
const cardWithTitle = (page: Page, title: string) =>
  collection(page)
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/** Measure resolved text colors, including alpha backgrounds, rather than token names. */
async function readableSignals(root: Locator) {
  const samples = await root
    .locator(
      'span[data-status][data-state-tone], a[data-action], button[data-action], [role="tab"][aria-selected="true"], a[aria-current="page"][data-kind]',
    )
    .evaluateAll((elements) => {
      const rgba = (text: string) => {
        const parts = text.match(/[\d.]+/g)?.map(Number);
        if (!parts || parts.length < 3) throw new Error(`Unsupported color: ${text}`);
        return [...parts.slice(0, 3), parts[3] ?? 1];
      };
      const blend = (front: number[], back: number[]) =>
        front.slice(0, 3).map((n, i) => n * front[3]! + back[i]! * (1 - front[3]!));
      const luminance = (color: number[]) =>
        color.reduce((sum, n, i) => {
          const value = n / 255;
          return (
            sum +
            (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][i]!
          );
        }, 0);
      return elements
        .filter(
          (element) => element.getClientRects().length && !(element as HTMLButtonElement).disabled,
        )
        .map((element) => {
          const style = getComputedStyle(element);
          const layers: number[][] = [];
          for (let parent: Element | null = element; parent; parent = parent.parentElement) {
            const color = rgba(getComputedStyle(parent).backgroundColor);
            layers.unshift(color);
            if (color[3] === 1) break;
          }
          const background = layers.reduce((back, front) => blend(front, back), [255, 255, 255]);
          const values = [luminance(blend(rgba(style.color), background)), luminance(background)];
          return {
            label: element.textContent?.trim(),
            state: element.getAttribute("data-status"),
            action: element.getAttribute("data-action"),
            text: style.color,
            background: style.backgroundColor,
            contrast: (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05),
          };
        });
    });
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples)
    expect(sample.contrast, `${sample.label}: resolved text contrast`).toBeGreaterThanOrEqual(4.5);
  return samples;
}

async function expectState(card: Locator, state: string, tone: string, label: string) {
  await expect(card).toHaveAttribute("data-state-tone", tone);
  const badge = card.locator(`span[data-status="${state}"]`);
  await expect(badge).toHaveText(label);
  await expect(badge).toHaveAttribute("data-state-tone", tone);
  await expect(badge.locator('svg[aria-hidden="true"][focusable="false"]')).toHaveCount(1);
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Workspace colors distinguish type, lifecycle and available actions ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const phone = suffix.includes("mobile");
    await page.setViewportSize({ width: phone ? 320 : 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/library" });
    await specialistLocale(page, "en-CA");
    const fixture = await installDensityFixtures(page);
    // GET-only mixed lifecycles: no mutation is intercepted or reported as successful.
    Object.assign(fixture.rounds[0]!, {
      status: "draft",
      currentVersionId: null,
      publishedDraftRevision: null,
    });
    fixture.sessions[0] = SessionSummarySchema.parse({
      ...fixture.sessions[0],
      status: "active",
      phase: "lobby",
      questionPosition: null,
      participantCount: 0,
      answerCount: 0,
      reportId: null,
    });
    fixture.sessions[1] = SessionSummarySchema.parse({
      ...fixture.sessions[1],
      status: "expired",
      phase: "lobby",
      questionPosition: null,
      participantCount: 0,
      answerCount: 0,
      reportId: null,
      expiresAt: "2026-10-02T12:00:00.000Z",
    });
    for (const [index, status] of ["pending", "failed"].entries())
      fixture.reports[index] = ReportSummarySchema.parse({
        ...fixture.reports[index],
        status,
        generatedAt: null,
        initialAccuracyPercent: null,
        recovery: { recovered: 0, eligible: 0, percent: null },
        unresolvedConceptCount: 0,
        interventionCount: 0,
      });
    fixture.reports[2]!.initialAccuracyPercent = 0;
    fixture.reports[3]!.initialAccuracyPercent = null;
    fixture.followups[1] = FollowupSummarySchema.parse({
      ...fixture.followups[1],
      status: "scheduled",
      opensAt: "2099-08-01T12:00:00.000Z",
      attemptCount: 0,
      completedAttemptCount: 0,
    });
    const metrics: DensityMetric[] = [];
    const colors: Record<string, Awaited<ReturnType<typeof readableSignals>>> = {};
    await mkdir("artifacts/workspace-colors", { recursive: true });
    try {
      for (const mode of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: mode });
        await page.goto("/library");
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
        for (const [type, kind, label] of [
          ["rounds", "round", "Rounds"],
          ["presentations", "presentation", "Presentations"],
          ["surveys", "survey", "Surveys"],
        ]) {
          const tab = page.locator(`#${type}-tab`);
          await tab.click();
          await expect(tab).toHaveAttribute("aria-selected", "true");
          await expect(tab).toHaveAccessibleName(new RegExp(`^${label} \\d+$`));
          await expect(
            tab.locator(`svg[aria-hidden="true"][focusable="false"][data-kind="${kind}"]`),
          ).toHaveCount(1);
          await expect(collection(page).getByRole("article")).toHaveCount(8);
          colors[`library-${type}-${mode}`] = await readableSignals(page.locator("main"));
        }
        await page.locator("#rounds-tab").click();
        for (const view of ["grid", "list"] as const) {
          await page
            .getByRole("button", { name: `${view === "grid" ? "Grid" : "List"} view`, exact: true })
            .click();
          const draft = cardWithTitle(page, fixture.rounds[0]!.title);
          const published = cardWithTitle(page, fixture.rounds[1]!.title);
          await expectState(draft, "draft", "warning", "Draft");
          await expect(draft.locator('[data-action="host"]')).toHaveCount(0);
          await expect(draft.locator('a[data-action="edit"]')).toHaveAttribute(
            "href",
            `/quiz/${fixture.rounds[0]!.id}`,
          );
          await expectState(published, "published", "positive", "Published");
          await expect(published.locator('[data-action="host"]')).toHaveText("Host");
          metrics.push(
            await measureDensity(page, collection(page), {
              key: `library-${view}-${mode}`,
              phone,
              list: view === "list",
              maxHeight: view === "list" ? 140 : 320,
            }),
          );
          if (view === "grid") {
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({
              path: `artifacts/workspace-colors/${info.project.name}-library-grid-${mode}.png`,
            });
          }
        }
        const host = cardWithTitle(page, fixture.rounds[1]!.title).locator('a[data-action="host"]');
        await tabTo(page, host);
        await expectVisibleKeyboardFocus(host);
        await densityAxe(page);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `artifacts/workspace-colors/${info.project.name}-library-${mode}.png`,
        });

        await page.goto("/sessions");
        for (const view of ["grid", "list"] as const) {
          await page
            .getByRole("button", { name: `${view === "grid" ? "Grid" : "List"} view`, exact: true })
            .click();
          const active = cardWithTitle(page, fixture.sessions[0]!.title);
          const expired = cardWithTitle(page, fixture.sessions[1]!.title);
          await expectState(active, "active", "active", "Active");
          await expect(active.locator('button[data-action="resume"]')).toBeEnabled();
          await expectState(expired, "expired", "danger", "Access Expired");
          await expect(expired.locator('[data-action="resume"]')).toHaveCount(0);
          await expectState(
            cardWithTitle(page, fixture.sessions[2]!.title),
            "finished",
            "neutral",
            "Finished",
          );
          metrics.push(
            await measureDensity(page, collection(page), {
              key: `sessions-${view}-${mode}`,
              phone,
              list: view === "list",
              maxHeight: 280,
            }),
          );
          if (view === "grid") {
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({
              path: `artifacts/workspace-colors/${info.project.name}-sessions-grid-${mode}.png`,
            });
          }
        }
        colors[`sessions-${mode}`] = await readableSignals(page.locator("main"));
        await densityAxe(page);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `artifacts/workspace-colors/${info.project.name}-sessions-${mode}.png`,
        });

        await page.goto("/results");
        for (const view of ["grid", "list"] as const) {
          await page
            .getByRole("button", { name: `${view === "grid" ? "Grid" : "List"} view`, exact: true })
            .click();
          await expectState(
            cardWithTitle(page, fixture.reports[0]!.title),
            "pending",
            "warning",
            "Processing",
          );
          await expectState(
            cardWithTitle(page, fixture.reports[1]!.title),
            "failed",
            "danger",
            "Needs attention",
          );
          // Genuine zero and absent evidence keep the same report-ready status.
          for (const index of [2, 3])
            await expectState(
              cardWithTitle(page, fixture.reports[index]!.title),
              "ready",
              "positive",
              "Ready",
            );
          await expect(cardWithTitle(page, fixture.reports[2]!.title)).toContainText("0%");
          metrics.push(
            await measureDensity(page, collection(page), {
              key: `results-${view}-${mode}`,
              phone,
              list: view === "list",
              maxHeight: 400,
            }),
          );
          if (view === "grid") {
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({
              path: `artifacts/workspace-colors/${info.project.name}-results-grid-${mode}.png`,
            });
          }
        }
        colors[`results-${mode}`] = await readableSignals(page.locator("main"));
        await densityAxe(page);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `artifacts/workspace-colors/${info.project.name}-results-${mode}.png`,
        });
        await page.goto("/assignments");
        await expect(page.locator('main article[data-state-tone="active"]')).toHaveCount(7);
        await expect(page.locator('main article[data-state-tone="warning"]')).toHaveCount(1);
        colors[`assignments-${mode}`] = await readableSignals(page.locator("main"));
        await densityAxe(page);
      }
      // Hover must not replace the keyboard focus ring in forced-color mode.
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto("/library");
      const edit = cardWithTitle(page, fixture.rounds[0]!.title).locator('a[data-action="edit"]');
      await tabTo(page, edit);
      await edit.hover();
      await expectVisibleKeyboardFocus(edit);
      await expect(edit).toHaveCSS("outline-width", "3px");
      await densityAxe(page);
      await page.emulateMedia({ forcedColors: "none" });
      await specialistLocale(page, "de-DE");
      await page.goto("/library");
      await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
      await expect(collection(page).locator('span[data-status="draft"]')).toHaveText("Entwurf");
      await expectDocumentReflow(page);
      colors["library-de-DE"] = await readableSignals(page.locator("main"));
      expect(fixture.mutations).toEqual([]);
    } finally {
      await specialistLocale(page, "en-CA");
      await writeFile(
        `artifacts/workspace-colors/${info.project.name}-metrics.json`,
        `${JSON.stringify({ metrics, colors }, null, 2)}\n`,
      );
    }
  });
}
