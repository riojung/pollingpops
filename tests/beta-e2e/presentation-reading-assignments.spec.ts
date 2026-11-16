import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PresentationAssignmentCreatedSchema,
  PresentationAssignmentPreviewSchema,
  PresentationReadingAttemptSnapshotSchema,
  PresentationReadingMutationResultSchema,
} from "../../packages/contracts/src/index.ts";
import {
  openEditorActions,
  clickEditorAction,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const privateMarker = "PRIVATE_E08_READING_NOTES_AND_ANSWER";
const unavailable = "This reading assignment is unavailable or has expired.";

function safeRecipient(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /PRIVATE_E08|isCorrect|explanation|speakerNotes|recoveryPack|tokenHash|intentHash|attemptTokenHash/,
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

for (const suffix of ["", " @mobile"]) {
  test(`reading assignments preserve private progress, exact retries and a frozen publication${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const run = randomUUID().slice(0, 8);
    const title = `Reading opening ${run}`;
    const opening = e01Slide(title);
    opening.speakerNotes = privateMarker;
    const closing = e01Slide(`Reading closing ${run}`);
    const question = {
      id: randomUUID(),
      kind: "question" as const,
      question: {
        id: randomUUID(),
        type: "single_select" as const,
        prompt: "A question for reading only",
        choices: [
          { id: randomUUID(), label: "Public option A", isCorrect: true },
          { id: randomUUID(), label: "Public option B", isCorrect: false },
        ],
        purpose: "diagnostic" as const,
        confidence: "off" as const,
        delivery: "main" as const,
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 100,
        explanation: privateMarker,
        mediaId: null,
        mediaAlt: null,
      },
    };
    const record = await createE01Deck(page, [opening, question, closing]);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      {
        data: { expectedDraftRevision: record.draftRevision },
      },
    );
    expect(published.status()).toBe(200);
    const frozenVersionId = (await published.json()).version.id as string;
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    const assignButton = page.getByRole("button", { name: "Assign reading", exact: true });
    await openEditorActions(page);
    await expect(assignButton).toBeInViewport();
    await clickEditorAction(page, "Assign reading");
    const dialog = page.getByRole("dialog", { name: "Assign a reading assignment", exact: true });
    await dialog.getByRole("combobox", { name: "Reading deadline", exact: true }).selectOption("7");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/assignments`,
    );
    await dialog.getByRole("button", { name: "Create assignment", exact: true }).click();
    const created = PresentationAssignmentCreatedSchema.parse(await (await createdResponse).json());
    expect(created.assignment.versionId).toBe(frozenVersionId);
    const link = dialog.getByRole("textbox", { name: "Your assignment link", exact: true });
    await expect(link).toHaveValue(created.url);
    const assignmentUrl = await link.inputValue();
    const assignmentId = created.assignment.id;
    const assignmentToken = new URLSearchParams(new URL(assignmentUrl).hash.slice(1)).get("token")!;
    const apiPath = `/v1/presentation-assignments/${assignmentId}`;
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const contextOptions = {
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce" as const,
      colorScheme: "light" as const,
    };
    const context = await browser.newContext(contextOptions);
    const freshContext = await browser.newContext(contextOptions);
    try {
      // A same-host cookie would reach the API unless anonymous fetches explicitly omit it.
      await context.addCookies([
        { name: "reading_privacy_probe", value: "anonymous-cookie", url: contextOptions.baseURL },
      ]);
      const reader = await context.newPage();
      const requested: string[] = [];
      const headerChecks: Promise<Record<string, string>>[] = [];
      reader.on("request", (request) => {
        requested.push(request.url());
        if (new URL(request.url()).pathname.startsWith(apiPath))
          headerChecks.push(request.allHeaders());
      });
      const previewResponse = reader.waitForResponse(
        (response) => new URL(response.url()).pathname === apiPath,
      );
      await reader.goto(assignmentUrl);
      const previewRaw = await (await previewResponse).json();
      safeRecipient(previewRaw);
      const preview = PresentationAssignmentPreviewSchema.parse(previewRaw);
      expect(preview.review.versionId).toBe(frozenVersionId);
      await expect(reader).toHaveURL((url) => !url.hash && !url.search);
      await expect(
        reader.getByRole("button", { name: "Start reading", exact: true }),
      ).toBeEnabled();
      expect(requested.some((url) => url.includes("/attempts"))).toBe(false);
      await expect(
        reader.getByRole("button", { name: "Mark page as read", exact: true }),
      ).toHaveCount(0);
      const startResponse = reader.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `${apiPath}/attempts`,
      );
      await reader.getByRole("button", { name: "Start reading", exact: true }).click();
      const startRaw = await (await startResponse).json();
      safeRecipient(startRaw);
      const started = PresentationReadingMutationResultSchema.parse(startRaw);
      expect(started.attempt.readBlockIds).toEqual([]);
      expect(started.attempt.revision).toBe(0);
      await expect(reader.getByText("0 of 3 pages read", { exact: true })).toBeVisible();
      await expect(
        reader.getByRole("button", { name: "Finish reading", exact: true }),
      ).toBeDisabled();
      const privateLink = reader.getByRole("textbox", {
        name: "Your private resume link",
        exact: true,
      });
      const resumeUrl = await privateLink.inputValue();
      const resumeValues = new URLSearchParams(new URL(resumeUrl).hash.slice(1));
      const attemptToken = resumeValues.get("resume")!;
      expect(resumeValues.get("attempt")).toBe(started.attempt.id);
      expect(attemptToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const progressUrl = `${e01ApiUrl}${apiPath}/attempts/${started.attempt.id}/progress`;
      const commands: unknown[] = [];
      await reader.route(progressUrl, async (route) => {
        commands.push(route.request().postDataJSON());
        if (commands.length === 1) {
          const accepted = await route.fetch();
          expect(accepted.status()).toBe(200);
          const result = PresentationReadingMutationResultSchema.parse(await accepted.json());
          expect(result.attempt.readBlockIds).toEqual([opening.id]);
          expect(result.attempt.revision).toBe(1);
          return route.abort("failed");
        }
        return route.continue();
      });
      await reader.getByRole("button", { name: "Mark page as read", exact: true }).click();
      await expect(
        reader.getByRole("button", { name: "Retry saving progress", exact: true }),
      ).toBeEnabled();
      const retryResponse = reader.waitForResponse((response) => response.url() === progressUrl);
      await reader.getByRole("button", { name: "Retry saving progress", exact: true }).click();
      const recovered = PresentationReadingMutationResultSchema.parse(
        await (await retryResponse).json(),
      );
      expect(recovered.replayed).toBe(true);
      expect(recovered.attempt.revision).toBe(1);
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(commands[0]);
      await reader.unroute(progressUrl);
      await expect(reader.getByText("1 of 3 pages read", { exact: true })).toBeVisible();
      await noStoredCredentials(reader, [assignmentToken, attemptToken, started.attempt.id]);

      // Later publication cannot rewrite the version or page IDs assigned to this reader.
      const current = await readE01Record(page, record.id);
      const nextDraft = structuredClone(current.draft);
      const first = nextDraft.blocks[0];
      if (first?.kind !== "content" || first.scene?.nodes[0]?.type !== "text")
        throw new Error("Reading fixture lost its native title");
      first.scene.nodes[0].text = `Newer unpublished-to-reader title ${run}`;
      const changed = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          draft: nextDraft,
          expectedRevision: current.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(changed.status()).toBe(200);
      const changedRevision = (await changed.json()).presentation.draftRevision as number;
      expect(
        (
          await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
            data: { expectedDraftRevision: changedRevision },
          })
        ).status(),
      ).toBe(200);

      // Scrubbed URLs and browser storage cannot rediscover a previous person's attempt.
      await reader.reload();
      await expect(reader.getByText(unavailable, { exact: true })).toBeVisible();
      const beforeResume = requested.filter((url) => url.includes("/attempts/")).length;
      await reader.goto(resumeUrl);
      await expect(
        reader.getByRole("button", { name: "Resume reading", exact: true }),
      ).toBeEnabled();
      expect(requested.filter((url) => url.includes("/attempts/")).length).toBe(beforeResume);
      const snapshotResponse = reader.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${apiPath}/attempts/${started.attempt.id}`,
      );
      await reader.getByRole("button", { name: "Resume reading", exact: true }).click();
      const resumedRaw = await (await snapshotResponse).json();
      safeRecipient(resumedRaw);
      const resumed = PresentationReadingAttemptSnapshotSchema.parse(resumedRaw);
      expect(resumed.review.versionId).toBe(frozenVersionId);
      expect(resumed.attempt.readBlockIds).toEqual([opening.id]);
      expect(resumed.attempt.revision).toBe(1);
      const currentPage = reader.getByRole("region", {
        name: "Current presentation page",
        exact: true,
      });
      await expect(currentPage).toContainText(title);
      await expect(currentPage).not.toContainText(`Newer unpublished-to-reader title ${run}`);
      await expect(reader.getByText("1 of 3 pages read", { exact: true })).toBeVisible();
      await reader.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(currentPage).toContainText("A question for reading only");
      await expect(currentPage.getByRole("radio")).toHaveCount(0);
      await expect(currentPage).toContainText("Responses are not collected.");
      await reader.getByRole("button", { name: "Mark page as read", exact: true }).click();
      await expect(reader.getByText("2 of 3 pages read", { exact: true })).toBeVisible();
      await reader.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(currentPage).toContainText(`Reading closing ${run}`);
      await reader.getByRole("button", { name: "Mark page as read", exact: true }).click();
      await expect(reader.getByText("3 of 3 pages read", { exact: true })).toBeVisible();
      const finishResponse = reader.waitForResponse((response) => response.url() === progressUrl);
      await reader.getByRole("button", { name: "Finish reading", exact: true }).click();
      const completed = PresentationReadingMutationResultSchema.parse(
        await (await finishResponse).json(),
      );
      expect(completed.attempt.revision).toBe(4);
      expect(completed.attempt.completedAt).not.toBeNull();
      await expect(reader.getByText("Reading complete", { exact: true })).toBeVisible();
      await noStoredCredentials(reader, [assignmentToken, attemptToken, started.attempt.id]);
      expect(
        await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const completionImage = await reader.screenshot({
        path: info.outputPath("e08-reading-complete.png"),
        fullPage: true,
        mask: [privateLink],
      });
      await info.attach("Reading completion", { body: completionImage, contentType: "image/png" });

      const nextReader = await freshContext.newPage();
      const nextRequests: string[] = [];
      nextReader.on("request", (request) => nextRequests.push(request.url()));
      await nextReader.goto(assignmentUrl);
      await expect(
        nextReader.getByRole("button", { name: "Start reading", exact: true }),
      ).toBeEnabled();
      await expect(nextReader.getByText(/\d of 3 pages read/)).toHaveCount(0);
      await expect(
        nextReader.getByRole("button", { name: "Resume reading", exact: true }),
      ).toHaveCount(0);
      expect(nextRequests.some((url) => url.includes("/attempts"))).toBe(false);
      expect(
        await nextReader.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const axe = await new AxeBuilder({ page: nextReader })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(axe.violations.map(({ id }) => id)).toEqual([]);
      await nextReader.screenshot({
        path: info.outputPath("e08-reading-assignment-preview.png"),
        fullPage: true,
      });
      expect(
        requested.some((url) => url.includes(assignmentToken) || url.includes(attemptToken)),
      ).toBe(false);
      for (const headers of await Promise.all(headerChecks)) expect(headers.cookie).toBeUndefined();
      expect((await context.cookies()).some((cookie) => cookie.name === "openround_creator")).toBe(
        false,
      );
      await dialog.getByRole("button", { name: "Revoke assignment", exact: true }).click();
      await expect(dialog.getByText("Revoked", { exact: false })).toBeVisible();
      await reader.getByRole("button", { name: "Previous page", exact: true }).click();
      await expect(reader.getByText(unavailable, { exact: true })).toBeVisible();
      await expect(
        reader.getByRole("region", { name: "Current presentation page", exact: true }),
      ).toHaveCount(0);
      await nextReader.goto(resumeUrl);
      await expect(nextReader.getByText(unavailable, { exact: true })).toBeVisible();
      await expect(
        nextReader.getByRole("button", { name: "Resume reading", exact: true }),
      ).toHaveCount(0);
    } finally {
      await context.close();
      await freshContext.close();
    }
  });
}
