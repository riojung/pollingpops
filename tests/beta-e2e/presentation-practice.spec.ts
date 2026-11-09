import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PresentationPracticeAssignmentCreatedSchema,
  PresentationPracticePreviewSchema,
  PresentationPracticeAttemptSnapshotSchema,
  PresentationPracticeMutationResultSchema,
  PresentationPracticeInsightsSchema,
  type PresentationDraft,
} from "../../packages/contracts/src/index.ts";
import {
  clickEditorAction,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const privateMarker = "PRIVATE_PRACTICE_SPEAKER_NOTES";
const firstExplanation = "Personal first-check explanation";
const firstFeedback = "Personal selected-choice feedback";
const secondExplanation = "Personal true-false explanation";
const unavailable = "This practice assignment is unavailable or has expired.";
function safePreview(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /PRIVATE_PRACTICE|isCorrect|explanation|selectedFeedback|correctChoiceId|speakerNotes|tokenHash|intentHash/,
  );
}
async function noStoredCredentials(page: Page, secrets: string[]) {
  const stored = await page.evaluate(() =>
    [sessionStorage, localStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => `${key}:${storage.getItem(key)}`),
    ),
  );
  for (const secret of secrets) expect(stored.some((entry) => entry.includes(secret))).toBe(false);
}
function check(
  prompt: string,
  type: "single_select" | "true_false",
  explanation: string,
): Extract<PresentationDraft["blocks"][number], { kind: "question" }> {
  return {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type,
      prompt,
      choices: [
        { id: randomUUID(), label: type === "true_false" ? "True" : "North", isCorrect: true },
        {
          id: randomUUID(),
          label: type === "true_false" ? "False" : "South",
          isCorrect: false,
          feedback: firstFeedback,
        },
      ],
      purpose: "practice",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation,
      mediaId: null,
      mediaAlt: null,
    },
  };
}
for (const suffix of ["", " @mobile"]) {
  test(`self-paced practice acknowledges immutable answers, private feedback and resumable frozen content${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const run = randomUUID().slice(0, 8),
      title = `Practice opening ${run}`;
    const opening = e01Slide(title),
      closing = e01Slide(`Practice closing ${run}`);
    opening.speakerNotes = privateMarker;
    const firstCheck = check("Choose the northern direction", "single_select", firstExplanation);
    const secondCheck = check(
      "This is a true-false practice check",
      "true_false",
      secondExplanation,
    );
    const record = await createE01Deck(page, [opening, firstCheck, secondCheck, closing]);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: record.draftRevision } },
    );
    expect(published.status()).toBe(200);
    const frozenVersionId = (await published.json()).version.id as string;
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await clickEditorAction(page, "Assign practice");
    const dialog = page.getByRole("dialog", { name: "Assign self-paced practice", exact: true });
    await dialog
      .getByRole("combobox", { name: "Practice deadline", exact: true })
      .selectOption("7");
    const creationCommands: unknown[] = [];
    const creationUrl = `${e01ApiUrl}/v1/presentations/${record.id}/practice-assignments`;
    await page.route(creationUrl, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      creationCommands.push(route.request().postDataJSON());
      if (creationCommands.length === 1) {
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(201);
        return route.abort("failed");
      }
      return route.continue();
    });
    await dialog.getByRole("button", { name: "Create assignment", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Retry assignment creation", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("combobox", { name: "Practice deadline", exact: true }),
    ).toBeDisabled();
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/practice-assignments`,
    );
    await dialog.getByRole("button", { name: "Retry assignment creation", exact: true }).click();
    const created = PresentationPracticeAssignmentCreatedSchema.parse(
      await (await createdResponse).json(),
    );
    expect(created.replayed).toBe(true);
    expect(creationCommands).toHaveLength(2);
    expect(creationCommands[1]).toEqual(creationCommands[0]);
    await page.unroute(creationUrl);
    expect(created.assignment.versionId).toBe(frozenVersionId);
    await expect(
      dialog.getByRole("textbox", { name: "Your assignment link", exact: true }),
    ).toHaveValue(created.url);
    const assignmentId = created.assignment.id,
      assignmentUrl = created.url;
    const assignmentToken = new URLSearchParams(new URL(assignmentUrl).hash.slice(1)).get("token")!;
    const apiPath = `/v1/presentation-practice/${assignmentId}`;
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const options = {
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce" as const,
      colorScheme: "light" as const,
    };
    const context = await browser.newContext(options),
      fresh = await browser.newContext(options);
    try {
      await context.addCookies([
        { name: "practice_cookie_probe", value: "anonymous-cookie", url: options.baseURL },
      ]);
      const reader = await context.newPage(),
        newcomer = await fresh.newPage();
      await reader.clock.install({ time: new Date() });
      const requested: string[] = [],
        headers: Promise<Record<string, string>>[] = [];
      reader.on("request", (request) => {
        requested.push(request.url());
        if (new URL(request.url()).pathname.startsWith(apiPath)) headers.push(request.allHeaders());
      });
      const previewResponse = reader.waitForResponse(
        (response) => new URL(response.url()).pathname === apiPath,
      );
      await reader.goto(assignmentUrl);
      const previewRaw = await (await previewResponse).json();
      safePreview(previewRaw);
      expect(PresentationPracticePreviewSchema.parse(previewRaw).review.versionId).toBe(
        frozenVersionId,
      );
      await expect(reader).toHaveURL((url) => !url.hash && !url.search);
      await expect(
        reader.getByRole("button", { name: "Start practice", exact: true }),
      ).toBeEnabled();
      expect(requested.some((url) => url.includes("/attempts"))).toBe(false);
      const startedResponse = reader.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `${apiPath}/attempts`,
      );
      await reader.getByRole("button", { name: "Start practice", exact: true }).click();
      const startRaw = await (await startedResponse).json();
      safePreview(startRaw);
      const started = PresentationPracticeMutationResultSchema.parse(startRaw);
      expect(started.attempt.answers).toEqual([]);
      expect(started.attempt.readBlockIds).toEqual([]);
      const privateLink = reader.getByRole("textbox", {
        name: "Your private resume link",
        exact: true,
      });
      const resumeUrl = await privateLink.inputValue();
      const resumeValues = new URLSearchParams(new URL(resumeUrl).hash.slice(1)),
        attemptToken = resumeValues.get("resume")!;
      const progressUrl = `${e01ApiUrl}${apiPath}/attempts/${started.attempt.id}/progress`;
      const currentPage = reader.getByRole("region", {
        name: "Current presentation page",
        exact: true,
      });
      await reader.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(currentPage).toContainText(firstCheck.question.prompt);
      await expect(currentPage).not.toContainText(firstExplanation);
      await expect(
        currentPage.getByRole("button", { name: "Mark page as read", exact: true }),
      ).toHaveCount(0);
      await currentPage.getByRole("radio", { name: "South", exact: true }).check();
      const commands: unknown[] = [];
      await reader.route(progressUrl, async (route) => {
        commands.push(route.request().postDataJSON());
        if (commands.length === 1) {
          const accepted = await route.fetch();
          expect(accepted.status()).toBe(200);
          const result = PresentationPracticeMutationResultSchema.parse(await accepted.json());
          expect(result.attempt.readBlockIds).toEqual([firstCheck.id]);
          expect(result.attempt.answers[0]?.correct).toBe(false);
          return route.abort("failed");
        }
        return route.continue();
      });
      await currentPage.getByRole("button", { name: "Submit answer", exact: true }).click();
      await expect(
        reader.getByRole("button", { name: "Retry saving progress", exact: true }),
      ).toBeEnabled();
      await expect(currentPage).not.toContainText(firstExplanation);
      await expect(
        reader.getByText("0 of 4 pages read · 0 of 2 checks answered", { exact: true }),
      ).toBeVisible();
      const retryResponse = reader.waitForResponse((response) => response.url() === progressUrl);
      await reader.getByRole("button", { name: "Retry saving progress", exact: true }).click();
      const recovered = PresentationPracticeMutationResultSchema.parse(
        await (await retryResponse).json(),
      );
      expect(recovered.replayed).toBe(true);
      expect(recovered.attempt.revision).toBe(1);
      expect(commands[1]).toEqual(commands[0]);
      await reader.unroute(progressUrl);
      await expect(currentPage).toContainText("Incorrect · Answer accepted");
      await expect(currentPage).toContainText("Correct answer: North");
      await expect(currentPage).toContainText(firstExplanation);
      await expect(currentPage).toContainText(firstFeedback);
      await expect(
        currentPage.getByRole("button", { name: "Submit answer", exact: true }),
      ).toHaveCount(0);
      const earlyFinish = await context.request.post(progressUrl, {
        headers: { authorization: `Bearer ${attemptToken}` },
        data: { kind: "complete", requestId: randomUUID(), expectedRevision: 1 },
      });
      expect(earlyFinish.status()).toBe(409);
      await reader.getByRole("button", { name: "Next page", exact: true }).click();
      await currentPage.getByRole("radio", { name: "True", exact: true }).check();
      await currentPage.getByRole("button", { name: "Submit answer", exact: true }).click();
      await expect(currentPage).toContainText("Correct · Answer accepted");
      await expect(currentPage).toContainText(secondExplanation);
      await expect(
        reader.getByRole("button", { name: "Finish practice", exact: true }),
      ).toBeDisabled();
      await reader
        .getByRole("navigation", { name: "Presentation pages", exact: true })
        .getByRole("button", { name: new RegExp(`^1\\. ${title}`) })
        .click();
      await reader.getByRole("button", { name: "Mark page as read", exact: true }).click();
      await expect(
        reader.getByText("3 of 4 pages read · 2 of 2 checks answered", { exact: true }),
      ).toBeVisible();
      await noStoredCredentials(reader, [assignmentToken, attemptToken, started.attempt.id]);

      const latest = await readE01Record(page, record.id),
        draft = structuredClone(latest.draft);
      const changed = draft.blocks[0];
      if (changed?.kind !== "content" || changed.scene?.nodes[0]?.type !== "text")
        throw new Error("Native opening fixture required");
      changed.scene.nodes[0].text = `Newer practice title ${run}`;
      const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          draft,
          expectedRevision: latest.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(saved.status()).toBe(200);
      expect(
        (
          await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
            data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision },
          })
        ).status(),
      ).toBe(200);
      await reader.reload();
      await expect(reader.getByText(unavailable, { exact: true })).toBeVisible();
      const beforeResume = requested.filter((url) => url.includes("/attempts/")).length;
      await reader.goto(resumeUrl);
      await expect(
        reader.getByRole("button", { name: "Resume practice", exact: true }),
      ).toBeEnabled();
      expect(requested.filter((url) => url.includes("/attempts/")).length).toBe(beforeResume);
      await expect(reader.getByText(firstExplanation, { exact: true })).toHaveCount(0);
      const snapshotResponse = reader.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${apiPath}/attempts/${started.attempt.id}`,
      );
      await reader.getByRole("button", { name: "Resume practice", exact: true }).click();
      const snapshot = PresentationPracticeAttemptSnapshotSchema.parse(
        await (await snapshotResponse).json(),
      );
      expect(snapshot.review.versionId).toBe(frozenVersionId);
      expect(snapshot.attempt.answers).toHaveLength(2);
      await expect(currentPage).toContainText(title);
      await expect(currentPage).not.toContainText(`Newer practice title ${run}`);
      const nav = reader.getByRole("navigation", { name: "Presentation pages", exact: true });
      await nav.getByRole("button", { name: /^4\./ }).click();
      await reader.getByRole("button", { name: "Mark page as read", exact: true }).click();
      await expect(
        reader.getByRole("button", { name: "Finish practice", exact: true }),
      ).toBeEnabled();
      await reader.getByRole("button", { name: "Finish practice", exact: true }).click();
      await expect(reader.getByText("Practice complete", { exact: true })).toBeVisible();
      await expect(
        reader.getByText("Your results: 1 correct of 2 answered checks.", { exact: true }),
      ).toBeVisible();
      await noStoredCredentials(reader, [assignmentToken, attemptToken, started.attempt.id]);
      expect(
        await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await reader.screenshot({
        path: info.outputPath("practice-complete.png"),
        fullPage: true,
        mask: [privateLink],
      });
      const axe = await new AxeBuilder({ page: reader })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(axe.violations.map(({ id }) => id)).toEqual([]);
      await reader.getByRole("button", { name: "Clear reader", exact: true }).click();
      await expect(
        reader.getByRole("textbox", { name: "Your private resume link", exact: true }),
      ).toHaveCount(0);
      await expect(reader.getByText("Practice complete", { exact: true })).toHaveCount(0);
      await expect(
        reader.getByRole("button", { name: "Start practice", exact: true }),
      ).toBeEnabled();

      await newcomer.goto(assignmentUrl);
      await expect(
        newcomer.getByRole("button", { name: "Start practice", exact: true }),
      ).toBeEnabled();
      await expect(
        newcomer.getByRole("button", { name: "Resume practice", exact: true }),
      ).toHaveCount(0);
      await expect(newcomer.getByText(firstExplanation, { exact: true })).toHaveCount(0);
      const nextStartResponse = newcomer.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `${apiPath}/attempts`,
      );
      await newcomer.getByRole("button", { name: "Start practice", exact: true }).click();
      expect(
        PresentationPracticeMutationResultSchema.parse(await (await nextStartResponse).json())
          .attempt.answers,
      ).toEqual([]);
      expect(
        (
          await fresh.request.get(`${e01ApiUrl}${apiPath}/attempts/${started.attempt.id}`, {
            headers: { authorization: `Bearer ${assignmentToken}` },
          })
        ).status(),
      ).toBe(404);
      await dialog.getByRole("button", { name: "Practice insights", exact: true }).click();
      const insightsResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith(`/practice-assignments/${assignmentId}/insights`),
      );
      await dialog.getByRole("button", { name: "Load practice insights", exact: true }).click();
      const insights = PresentationPracticeInsightsSchema.parse(
        await (await insightsResponse).json(),
      );
      expect(insights.startedAttempts).toBeNull();
      expect(insights.completedAttempts).toBeNull();
      expect(insights.inProgressAttempts).toBeNull();
      await expect(dialog.locator("dd", { hasText: "Suppressed" })).toHaveCount(3);
      await expect(dialog.getByText(firstExplanation, { exact: true })).toHaveCount(0);
      await reader.clock.fastForward(7 * 86_400_000 + 2_000);
      await expect(reader.getByText(unavailable, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Revoke assignment", exact: true }).click();
      await newcomer.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(newcomer.getByText(unavailable, { exact: true })).toBeVisible();
      expect(
        requested.some((url) => url.includes(assignmentToken) || url.includes(attemptToken)),
      ).toBe(false);
      for (const value of await Promise.all(headers)) expect(value.cookie).toBeUndefined();
    } finally {
      await context.close();
      await fresh.close();
    }
  });
  test(`unsupported practice publications explain the rejection and release their creation intent${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await signInBeta(page);
    const record = await createE01Deck(page, [e01Slide("Content-only unsupported practice")]);
    expect(
      (
        await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
          data: { expectedDraftRevision: record.draftRevision },
        })
      ).status(),
    ).toBe(200);
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    await clickEditorAction(page, "Assign practice");
    const dialog = page.getByRole("dialog", { name: "Assign self-paced practice", exact: true });
    const rejectedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(
          `/presentations/${record.id}/practice-assignments`,
        ),
    );
    await dialog.getByRole("button", { name: "Create assignment", exact: true }).click();
    const rejected = await rejectedResponse;
    expect(rejected.status()).toBe(422);
    const error = await rejected.json();
    expect(error.error.code).toBe("PRESENTATION_PRACTICE_UNSUPPORTED_CONTENT");
    await expect(dialog.getByRole("alert")).toContainText(error.error.message);
    await expect(
      dialog.getByRole("button", { name: "Create assignment", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "Retry assignment creation", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: "Practice deadline", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const latest = await readE01Record(page, record.id);
    const changed = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        draft: {
          ...latest.draft,
          blocks: [
            ...latest.draft.blocks,
            check("A supported published check", "single_select", "Accepted explanation"),
          ],
        },
        expectedRevision: latest.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(changed.status()).toBe(200);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: (await changed.json()).presentation.draftRevision } },
    );
    expect(published.status()).toBe(200);
    const versionId = (await published.json()).version.id as string;
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    await clickEditorAction(page, "Assign practice");
    const acceptedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(
          `/presentations/${record.id}/practice-assignments`,
        ),
    );
    await dialog.getByRole("button", { name: "Create assignment", exact: true }).click();
    const accepted = await acceptedResponse;
    expect(accepted.status()).toBe(201);
    expect(
      PresentationPracticeAssignmentCreatedSchema.parse(await accepted.json()).assignment.versionId,
    ).toBe(versionId);
  });
}
