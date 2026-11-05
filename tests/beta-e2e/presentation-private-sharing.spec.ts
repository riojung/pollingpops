import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
for (const suffix of ["", " @mobile"]) {
  test(`private review pins publication and recovers a lost create acknowledgement${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const title = `Review opening ${randomUUID().slice(0, 8)}`;
    const closing = e01Slide("Review closing");
    const opening = e01Slide(title);
    opening.scene!.schemaVersion = 6;
    opening.scene!.nodes = [
      opening.scene!.nodes[0]!,
      {
        id: "review-reveal",
        type: "reveal",
        scope: "broadcast",
        label: "Shared review evidence",
        body: "Viewer-local review evidence",
        frame: { x: 5, y: 70, width: 40, height: 20 },
      },
      {
        id: "review-detail",
        type: "dialog",
        scope: "local",
        label: "Review detail",
        detailTitle: "Detail for the reader",
        body: "Public review detail body",
        frame: { x: 70, y: 30, width: 25, height: 20 },
      },
      {
        id: "review-navigation",
        type: "navigation",
        label: "Read closing slide",
        targetBlockId: closing.id,
        frame: { x: 55, y: 70, width: 40, height: 20 },
      },
    ];
    opening.scene!.readingOrder = opening.scene!.nodes.map((node) => node.id);
    opening.speakerNotes = "PRIVATE review speaker cue";
    const question = {
      id: randomUUID(),
      kind: "question" as const,
      question: {
        id: randomUUID(),
        type: "single_select" as const,
        prompt: "Read-only review question",
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
        explanation: "PRIVATE review answer explanation",
        mediaId: null,
        mediaAlt: null,
      },
    };
    const record = await createE01Deck(page, [opening, question, closing], 13);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await page
      .getByRole("textbox", { name: "New image description", exact: true })
      .fill("Synthetic review diagram");
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0b6270";
      ctx.fillRect(0, 0, 96, 64);
      ctx.fillStyle = "#fcd35d";
      ctx.fillRect(14, 16, 28, 32);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(70, 32, 16, 0, Math.PI * 2);
      ctx.fill();
      return canvas.toDataURL("image/png").split(",")[1]!;
    });
    await page.getByLabel("Add native image", { exact: true }).setInputFiles({
      name: "synthetic-review-diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await expect
      .poll(async () => {
        const first = (await readE01Record(page, record.id)).draft.blocks[0];
        return (
          first?.kind === "content" && first.scene?.nodes.some((node) => node.type === "image")
        );
      })
      .toBe(true);
    const publish = async () => {
      const response = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
      );
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      expect((await response).status()).toBe(200);
    };
    await publish();
    const published = await (
      await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`)
    ).json();
    const expiredIntent = await page.evaluate(
      ({ id, versionId }) => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const intent = {
          requestId: crypto.randomUUID(),
          versionId,
          token: btoa(String.fromCharCode(...bytes))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replace(/=+$/, ""),
          expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
        };
        sessionStorage.setItem(`openround:presentation-share-intent:${id}`, JSON.stringify(intent));
        return intent;
      },
      { id: record.id, versionId: published.presentation.currentVersionId as string },
    );
    await page.getByRole("button", { name: "Share review link", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Share a private review link", exact: true });
    await expect(dialog.getByRole("combobox")).toBeDisabled();
    const expiredResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/shares`,
    );
    await dialog.getByRole("button", { name: "Retry link creation", exact: true }).click();
    const rejected = await expiredResponse;
    expect(rejected.status()).toBe(410);
    expect((await rejected.json()).error.code).toBe("PRESENTATION_SHARE_REQUEST_EXPIRED");
    await expect(dialog.getByRole("combobox")).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Create link", exact: true })).toBeVisible();
    await dialog.getByRole("combobox").selectOption("7");
    let acceptedIntent: unknown;
    let acceptedId = "";
    let lost = false;
    await page.route(`${e01ApiUrl}/v1/presentations/${record.id}/shares`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const intent = route.request().postDataJSON();
      if (!lost) {
        expect(intent.requestId !== expiredIntent.requestId).toBe(true);
        expect(intent.token !== expiredIntent.token).toBe(true);
        expect(Date.parse(intent.expiresAt) > Date.now()).toBe(true);
        acceptedIntent = intent;
        const accepted = await route.fetch();
        expect(accepted.ok()).toBe(true);
        acceptedId = (await accepted.json()).share.id;
        lost = true;
        return route.abort("failed");
      }
      expect(JSON.stringify(intent) === JSON.stringify(acceptedIntent)).toBe(true);
      return route.continue();
    });
    await dialog.getByRole("button", { name: "Create link", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Retry link creation", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Share review link", exact: true }).click();
    await dialog.getByRole("button", { name: "Retry link creation", exact: true }).click();
    const privateLink = dialog.getByRole("textbox", { name: "Your private link", exact: true });
    await expect(privateLink).toHaveValue(/#token=/);
    const shareUrl = await privateLink.inputValue();
    const token = new URLSearchParams(new URL(shareUrl).hash.slice(1)).get("token")!;
    expect(new URL(shareUrl).pathname.endsWith(acceptedId)).toBe(true);
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    const reader = await context.newPage();
    const requested: string[] = [];
    reader.on("request", (request) => requested.push(request.url()));
    const reviewResponse = reader.waitForResponse(
      (response) => new URL(response.url()).pathname === `/v1/shared-presentations/${acceptedId}`,
    );
    await reader.goto(shareUrl);
    const safe = await (await reviewResponse).json();
    expect(JSON.stringify(safe)).not.toMatch(
      /PRIVATE|isCorrect|explanation|speakerNotes|recoveryPack|branches/,
    );
    expect(reader.url().includes(token)).toBe(false);
    expect((await context.cookies()).some((cookie) => cookie.name === "openround_creator")).toBe(
      false,
    );
    await expect(reader.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const current = reader.getByRole("region", { name: "Current presentation page", exact: true });
    const outline = current.getByRole("button", { name: "Show accessible outline", exact: true });
    if (await outline.isVisible()) await outline.click();
    await expect(
      current.getByRole("img", { name: "Synthetic review diagram", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        current
          .getByRole("img", { name: "Synthetic review diagram", exact: true })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(96);
    await current.getByRole("button", { name: /Shared review evidence/ }).click();
    await expect(current.getByText("Viewer-local review evidence", { exact: true })).toBeVisible();
    const detail = current.getByRole("button", { name: /^Review detail/ });
    await detail.focus();
    await detail.press("Enter");
    await expect(
      reader.getByRole("dialog", { name: "Detail for the reader", exact: true }),
    ).toBeVisible();
    await reader.keyboard.press("Escape");
    await expect(detail).toBeFocused();
    await current.getByRole("button", { name: /^Read closing slide/ }).click();
    await expect(
      current.getByRole("heading", { name: "Review closing", exact: true }),
    ).toBeVisible();
    const map = reader.getByRole("navigation", { name: "Presentation pages", exact: true });
    await map.getByRole("button", { name: /Read-only review question/ }).click();
    await expect(
      current.getByText("Review only. Responses are not collected.", { exact: true }),
    ).toBeVisible();
    await expect(current.getByRole("radio")).toHaveCount(0);
    await map.getByRole("button", { name: new RegExp(title) }).click();
    await expect(current.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect
      .poll(() =>
        current
          .getByRole("img", { name: "Synthetic review diagram", exact: true })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(96);
    await reader.screenshot({ path: info.outputPath("e08-private-review.png"), fullPage: true });
    await noOverflow(reader);
    const axe = await new AxeBuilder({ page: reader })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
    expect(requested.some((url) => url.includes(token))).toBe(false);
    expect(
      requested.some((url) => /\/presentation-sessions|\/responses|\/attempts/.test(url)),
    ).toBe(false);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const closeInspector = page.getByRole("button", { name: "Hide inspector", exact: true });
    if (narrow && (await closeInspector.isVisible())) await closeInspector.click();
    await page
      .getByRole("textbox", { name: "Native slide title", exact: true })
      .fill("New publication title");
    await expect
      .poll(async () => {
        const block = (await readE01Record(page, record.id)).draft.blocks[0];
        return (
          block?.kind === "content" &&
          block.scene?.nodes.some(
            (node) =>
              node.type === "text" &&
              node.role === "title" &&
              node.text === "New publication title",
          )
        );
      })
      .toBe(true);
    await publish();
    await reader.reload();
    await expect(reader.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(await reader.content()).not.toContain("New publication title");
    await page.getByRole("button", { name: "Share review link", exact: true }).click();
    await dialog.getByRole("button", { name: "Revoke link", exact: true }).click();
    await expect(dialog.getByText("Revoked", { exact: false })).toBeVisible();
    const mediaUrl = requested.find((url) =>
      new URL(url).pathname.startsWith(`/v1/shared-presentations/${acceptedId}/media/`),
    );
    expect(Boolean(mediaUrl)).toBe(true);
    expect(
      (
        await reader.request.get(mediaUrl!, { headers: { authorization: `Bearer ${token}` } })
      ).status(),
    ).toBe(404);
    await map.getByRole("button", { name: /Review closing/ }).click();
    await expect(reader.getByText(/unavailable|expired|revoked/i).first()).toBeVisible();
    await expect(reader.getByRole("region", { name: "Current presentation page" })).toHaveCount(0);
    await reader.reload();
    await expect(reader.getByRole("region", { name: "Current presentation page" })).toHaveCount(0);
    await context.close();
  });
}
