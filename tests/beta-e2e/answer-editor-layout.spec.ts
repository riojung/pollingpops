import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const longOption = `More time for ${"collaborative".repeat(10)} practice`;

async function expectNoOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}

async function expectEditableSpace(field: Locator, remove: Locator) {
  const text = await field.boundingBox();
  const action = await remove.boundingBox();
  expect(text).not.toBeNull();
  expect(action).not.toBeNull();
  expect(action!.width).toBeGreaterThanOrEqual(44);
  expect(action!.width).toBeLessThanOrEqual(46);
  expect(action!.height).toBeGreaterThanOrEqual(44);
  expect(text!.width).toBeGreaterThan(action!.width * 2);
  expect(text!.height).toBeGreaterThanOrEqual(64);
  expect(text!.x + text!.width).toBeLessThanOrEqual(action!.x);
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Round answer fields remain editable with conditional controls ${suffix}`, async ({
    page,
  }) => {
    test.skip(process.env.BETA_E2E_ROUND_PROTOCOL !== "true", "Opt-in Round formats");
    test.setTimeout(180_000);
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 740 });
    await signInBeta(page);
    // Both Round surfaces share the control. Only the builder flag is varied;
    // all authoring, saving and publishing below use the real seeded server.
    for (const builderV2 of [true, false]) {
      await page.route("**/v1/auth/me", async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        account.productFeatures.builderV2 = builderV2;
        await route.fulfill({ response, json: account });
      });
      for (const type of ["poll", "ranking", "single_select", "multi_select", "true_false"]) {
        const created = await page.request.post(`${api}/v1/quizzes`, {
          data: { title: `Synthetic ${type} answer layout` },
        });
        expect(created.status()).toBe(201);
        const id = (await created.json()).quiz.id as string;
        const opinion = type === "poll" || type === "ranking";
        const question = {
          id: randomUUID(),
          type,
          prompt: `Review ${type} answer fields`,
          choices: (type === "true_false"
            ? ["True", "False"]
            : ["Clearer ownership", longOption, "Discussion"]
          ).map((label, index) => ({
            id: randomUUID(),
            label,
            isCorrect: !opinion && index === 0,
          })),
          ...(type === "poll" ? { maxSelections: 3 } : {}),
          ...(type === "ranking" ? { rankCount: 3 } : {}),
          purpose: opinion ? "opinion" : "diagnostic",
          confidence: "off",
          timeLimitSeconds: 30,
          basePoints: opinion ? 0 : 1000,
          explanation: "Discuss the response together.",
          mediaId: null,
          mediaAlt: null,
        };
        expect(
          (
            await page.request.patch(`${api}/v1/quizzes/${id}`, {
              data: {
                title: `Synthetic ${type} answer layout`,
                description: "",
                questions: [question],
              },
            })
          ).ok(),
        ).toBeTruthy();
        await page.goto(`/quiz/${id}`);
        await page.evaluate(
          (mode) => {
            localStorage.setItem("openround:color-mode", mode);
            window.dispatchEvent(new Event("openround:color-mode-change"));
          },
          builderV2 ? "dark" : "light",
        );
        const first = page.getByRole("textbox", { name: "Answer 1", exact: true });
        await expect(first).toHaveValue(question.choices[0]!.label);
        expect((await page.locator("#media-alt").boundingBox())!.width).toBeGreaterThan(150);
        await expectNoOverflow(page);
        if (type === "true_false") {
          await expect(first).toBeDisabled();
          expect((await first.boundingBox())!.width).toBeGreaterThan(100);
          await expect(page.getByRole("button", { name: /^Delete Answer/ })).toHaveCount(0);
          continue;
        }
        const remove = page.getByRole("button", { name: "Delete Answer 1", exact: true });
        await expectEditableSpace(first, remove);
        // Click near the far edge where the old oversized Delete button lived.
        const box = (await first.boundingBox())!;
        await first.click({ position: { x: box.width - 10, y: 20 } });
        await expect(first).toBeFocused();
        const edited = "Clearer ownership and time to practice";
        await first.press("ControlOrMeta+A");
        await first.pressSequentially(edited);
        await expect(first).toHaveValue(edited);
        await expect(page.getByRole("group", { name: /^Answer \d+$/ })).toHaveCount(3);
        if (type === "poll" || type === "single_select") {
          await page
            .getByRole("group", { name: "Answer 1", exact: true })
            .locator("..")
            .screenshot({
              path: test.info().outputPath(`${type}-${builderV2 ? "dark" : "light"}.png`),
            });
        }
        await page.getByRole("button", { name: "Delete Answer 3", exact: true }).click();
        await expect(page.getByRole("group", { name: /^Answer \d+$/ })).toHaveCount(2);
        await expect(page.getByRole("button", { name: /^Delete Answer/ })).toHaveCount(0);
        if (opinion) {
          await expect(
            page.getByRole("combobox", {
              name: type === "poll" ? "Maximum selections" : "Choices to rank",
              exact: true,
            }),
          ).toHaveValue("2");
        }
        await page.getByRole("button", { name: "Add answer", exact: true }).click();
        const saved = page.waitForResponse(
          (response) =>
            response.request().method() === (builderV2 ? "PUT" : "PATCH") &&
            new URL(response.url()).pathname === `/v1/quizzes/${id}${builderV2 ? "/draft" : ""}` &&
            response.request().postDataJSON().draft.questions[0].choices[2]?.label ===
              "More examples",
        );
        await page.getByRole("textbox", { name: "Answer 3", exact: true }).fill("More examples");
        expect((await saved).ok()).toBeTruthy();
        await page.reload();
        await expect(first).toHaveValue(edited);
        await expect(page.getByRole("textbox", { name: "Answer 2", exact: true })).toHaveValue(
          longOption,
        );
        await expect(page.getByRole("textbox", { name: "Answer 3", exact: true })).toHaveValue(
          "More examples",
        );
        if (type === "poll") {
          const published = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname === `/v1/quizzes/${id}/publish`,
          );
          await page.getByRole("button", { name: "Publish", exact: true }).click();
          expect((await published).ok()).toBeTruthy();
          await page.getByRole("button", { name: "Preview", exact: true }).click();
          await page.waitForURL(`/quiz/${id}/preview`);
          await expect(page.getByRole("checkbox", { name: edited, exact: true })).toBeDisabled();
          await expect(page.getByRole("checkbox", { name: longOption, exact: true })).toBeVisible();
        }
      }
      await page.unroute("**/v1/auth/me");
    }
  });

  test(`Survey editors and participant choices preserve space and long labels ${suffix}`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    await page.goto("/surveys/new");
    await page.getByRole("button", { name: "Create blank Survey", exact: true }).click();
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Synthetic answer layout Survey");
    await page.getByRole("button", { name: "Add poll", exact: true }).click();
    const poll = page.getByRole("group", { name: "Poll question", exact: true });
    await poll
      .getByRole("textbox", { name: "Question", exact: true })
      .fill("What would help your next project?");
    const first = poll.getByRole("textbox", { name: "Option 1", exact: true });
    await first.fill("Clearer ownership");
    await poll.getByRole("textbox", { name: "Option 2", exact: true }).fill(longOption);
    await poll.getByRole("button", { name: "Add option", exact: true }).click();
    await expectEditableSpace(
      first,
      poll.getByRole("button", { name: "Remove option 1", exact: true }),
    );
    const box = (await first.boundingBox())!;
    await first.click({ position: { x: box.width - 10, y: 20 } });
    await first.press("ControlOrMeta+A");
    await first.pressSequentially("Clearer ownership and practice");
    await expect(first).toHaveValue("Clearer ownership and practice");
    await expect(poll.getByRole("textbox", { name: /^Option \d+$/ })).toHaveCount(3);
    await poll.getByRole("combobox", { name: "Maximum selections", exact: true }).selectOption("3");
    await poll.getByRole("button", { name: "Remove option 3", exact: true }).click();
    await expect(
      poll.getByRole("combobox", { name: "Maximum selections", exact: true }),
    ).toHaveValue("2");
    await expect(poll.getByRole("button", { name: "Remove option 1", exact: true })).toBeDisabled();
    await expect
      .poll(() =>
        poll
          .getByRole("textbox", { name: "Option 2", exact: true })
          .evaluate((field) => field.scrollHeight <= field.clientHeight + 1),
      )
      .toBe(true);
    await poll.screenshot({ path: test.info().outputPath("survey-answer-editor.png") });
    await page.getByRole("button", { name: "Add rating", exact: true }).click();
    const rating = page.getByRole("group", { name: "Rating question", exact: true });
    await rating
      .getByRole("textbox", { name: "Question", exact: true })
      .fill("How useful was this session?");
    await rating
      .getByRole("textbox", { name: "Low endpoint label", exact: true })
      .fill("L".repeat(80));
    await rating
      .getByRole("textbox", { name: "High endpoint label", exact: true })
      .fill("H".repeat(80));
    await page
      .getByRole("group", { name: "Question 2 actions", exact: true })
      .getByRole("button", { name: "Move up", exact: true })
      .click();
    await expect(
      page
        .locator("fieldset")
        .filter({ has: page.getByRole("textbox", { name: "Question", exact: true }) })
        .first(),
    ).toContainText("Rating question");
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(first).toHaveValue("Clearer ownership and practice");
    await page.getByRole("button", { name: "Preview Survey", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: longOption, exact: true })).toBeDisabled();
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Edit questions", exact: true }).click();
    await page.getByRole("button", { name: "Publish Survey", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create sharing link", exact: true }),
    ).toBeEnabled();
    const shared = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/v1\/surveys\/.+\/rooms$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Create sharing link", exact: true }).click();
    const room = (await (await shared).json()).room;
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: { width: 320, height: 740 },
    });
    try {
      const participant = await context.newPage();
      await participant.goto(`/join?code=${room.code}`);
      await participant.getByRole("button", { name: "Survey", exact: true }).click();
      const choice = participant.getByRole("checkbox", { name: longOption, exact: true });
      await expect(choice).toBeVisible();
      await expectNoOverflow(participant);
      await choice.check();
      await expect(choice).toBeChecked();
      const row = choice.locator("..");
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await choice.boundingBox())!.width).toBeGreaterThanOrEqual(20);
      await participant.screenshot({
        path: test.info().outputPath("survey-participant-320.png"),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
}
