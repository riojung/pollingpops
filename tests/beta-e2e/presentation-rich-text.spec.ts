import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PresentationDraft } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const bodyText = "Decide together\nAssign an owner\nReview the brief";
const link = "https://example.com/brief";
test.use({ actionTimeout: 30_000 });

async function savedDraft(page: Page, id: string): Promise<PresentationDraft> {
  const response = await page.request.get(`${apiUrl}/v1/presentations/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).presentation.draft;
}

async function selectText(textarea: Locator, start: number, end: number) {
  await textarea.focus();
  await textarea.evaluate(
    (element, range) => {
      const input = element as HTMLTextAreaElement;
      input.setSelectionRange(range.start, range.end);
    },
    { start, end },
  );
  // React's select event depends on real selection/keyboard events, not a synthetic DOM select.
  await textarea.press("Shift");
}

for (const suffix of ["", " @mobile"]) {
  test(`native rich text saves, recovers and publishes semantic text and links${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const created = await page.request.post(`${apiUrl}/v1/presentations`, {
      data: { title: `Rich text ${randomUUID().slice(0, 8)}` },
    });
    expect(created.status()).toBe(201);
    const record = (await created.json()).presentation;
    const blockId = randomUUID();
    const legacyId = randomUUID();
    const scene = {
      schemaVersion: 1,
      aspectRatio: "16:9",
      nodes: [
        {
          id: "title",
          type: "text",
          role: "title",
          text: "Project decision",
          frame: { x: 8, y: 5, width: 84, height: 20 },
        },
        {
          id: "body",
          type: "text",
          role: "body",
          text: bodyText,
          frame: { x: 8, y: 30, width: 84, height: 60 },
        },
      ],
      readingOrder: ["title", "body"],
    };
    const saved = await page.request.put(`${apiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        draft: {
          ...record.draft,
          schemaVersion: 4,
          blocks: [
            {
              id: blockId,
              kind: "content",
              layout: "title_body",
              textElements: [],
              mediaId: null,
              mediaAlt: null,
              speakerNotes: "PRIVATE rich text cue",
              scene,
            },
            {
              id: legacyId,
              kind: "content",
              layout: "title_body",
              textElements: [
                {
                  id: "legacy-title",
                  role: "title",
                  text: "Legacy follow-up",
                  region: "top_center",
                  order: 0,
                },
              ],
              mediaId: null,
              mediaAlt: null,
              speakerNotes: "",
            },
          ],
        },
        expectedRevision: record.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(saved.status()).toBe(200);
    await page.goto(`/presentation/${record.id}`);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    if (narrow) {
      await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
      await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    }
    await page.getByRole("button", { name: /^2\. Decide together/ }).click();
    const textarea = page.getByLabel("Node text", { exact: true });
    await page.getByRole("button", { name: "Format text", exact: true }).click();
    await selectText(textarea, 1, 4);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("button", { name: "Format text", exact: true })).toBeVisible();
    await expect(textarea).toBeFocused();
    await expect
      .poll(() =>
        textarea.evaluate((element) => {
          const input = element as HTMLTextAreaElement;
          return [input.selectionStart, input.selectionEnd];
        }),
      )
      .toEqual([1, 4]);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(() =>
        textarea.evaluate((element) => {
          const input = element as HTMLTextAreaElement;
          return [input.selectionStart, input.selectionEnd];
        }),
      )
      .toEqual([1, 4]);
    await expect(page.getByRole("button", { name: "Bold", exact: true })).toBeEnabled();
    await selectText(textarea, 0, "Decide".length);
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(page.locator('[data-node-id="body"] strong')).toHaveText("Decide");
    const bulletStart = bodyText.indexOf("Assign");
    await selectText(textarea, bulletStart, bulletStart + "Assign an owner".length);
    await page
      .getByRole("combobox", { name: "Paragraph style", exact: true })
      .selectOption("bullet");
    await expect(page.locator('[data-node-id="body"] ul li')).toHaveText("Assign an owner");
    const linkStart = bodyText.indexOf("Review");
    await selectText(textarea, linkStart, bodyText.length);
    await page.getByLabel("Link address", { exact: true }).fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Apply link", exact: true }).click();
    await expect(page.locator('[data-node-id="body"] a')).toHaveCount(0);
    await page.getByLabel("Link address", { exact: true }).fill(link);
    await page.getByRole("button", { name: "Apply link", exact: true }).click();
    const editorLink = page.getByRole("link", { name: "Review the brief", exact: true });
    await expect(editorLink).toHaveAttribute("href", link);
    await editorLink.click();
    await expect(page).toHaveURL(`/presentation/${record.id}`);
    await expect
      .poll(async () => {
        const draft = await savedDraft(page, record.id);
        const block = draft.blocks[0];
        return {
          version: draft.schemaVersion,
          sceneVersion: block?.kind === "content" ? block.scene?.schemaVersion : 0,
        };
      })
      .toEqual({ version: 5, sceneVersion: 2 });
    const expectedRichText = {
      paragraphs: [
        { kind: "paragraph", runs: [{ text: "Decide", bold: true }, { text: " together" }] },
        { kind: "bullet", runs: [{ text: "Assign an owner" }] },
        { kind: "paragraph", runs: [{ text: "Review the brief", href: link }] },
      ],
    };
    await expect
      .poll(async () => {
        const block = (await savedDraft(page, record.id)).blocks[0];
        const node =
          block?.kind === "content"
            ? block.scene?.nodes.find((node) => node.id === "body")
            : undefined;
        return node?.type === "text" ? node.richText : undefined;
      })
      .toEqual(expectedRichText);
    const formattedDraft = await savedDraft(page, record.id);
    const formattedBlock = formattedDraft.blocks[0];
    if (formattedBlock?.kind !== "content" || !formattedBlock.scene)
      throw new Error("Expected formatted scene");
    const formatted = formattedBlock.scene.nodes.find((node) => node.id === "body");
    expect(formatted).toMatchObject({
      text: bodyText,
      richText: expectedRichText,
    });
    expect(formattedBlock.scene.nodes.map((node) => node.id)).toEqual(["title", "body"]);

    await page.reload();
    if (narrow) {
      await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
      await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    }
    await expect(page.locator('[data-node-id="body"] strong')).toHaveText("Decide");
    await expect(page.locator('[data-node-id="body"] ul li')).toHaveText("Assign an owner");
    await page.getByRole("button", { name: /^2\. Decide together/ }).click();
    // Unsupported clipboard formats must not replace a selected, formatted text range.
    await selectText(textarea, 0, "Decide".length);
    for (const kind of ["html", "image", "file", "empty"]) {
      const clipboard = await textarea.evaluate((element, kind) => {
        const data = new DataTransfer();
        if (kind === "html") data.setData("text/html", "<strong>Unsupported replacement</strong>");
        if (kind === "image")
          data.items.add(
            new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", { type: "image/png" }),
          );
        if (kind === "file")
          data.items.add(new File(["File contents"], "notes.txt", { type: "text/plain" }));
        const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: data });
        element.dispatchEvent(event);
        return { types: Array.from(data.types), prevented: event.defaultPrevented };
      }, kind);
      expect(clipboard.types).not.toContain("text/plain");
      expect(clipboard.prevented).toBe(true);
      await expect(textarea).toHaveValue(bodyText);
      await expect(page.locator('[data-node-id="body"] strong')).toHaveText("Decide");
      expect(
        await textarea.evaluate((element) => {
          const input = element as HTMLTextAreaElement;
          return [input.selectionStart, input.selectionEnd];
        }),
      ).toEqual([0, "Decide".length]);
    }
    expect(await savedDraft(page, record.id)).toEqual(formattedDraft);
    // Repeated characters must keep the formatting of the character that actually survives.
    await selectText(textarea, bodyText.length, bodyText.length);
    await textarea.press("Enter");
    await textarea.pressSequentially("aa");
    const repeatedStart = bodyText.length + 1;
    await selectText(textarea, repeatedStart, repeatedStart + 1);
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(page.locator('[data-node-id="body"] p:last-child strong')).toHaveText("a");
    await selectText(textarea, repeatedStart, repeatedStart + 1);
    await textarea.press("Backspace");
    await expect(textarea).toHaveValue(`${bodyText}\na`);
    await expect(page.locator('[data-node-id="body"] p:last-child strong')).toHaveCount(0);
    await textarea.press("End");
    await textarea.press("ControlOrMeta+z");
    await expect(textarea).toHaveValue(`${bodyText}\naa`);
    await expect(page.locator('[data-node-id="body"] p:last-child strong')).toHaveText("a");
    await textarea.press("ControlOrMeta+Shift+z");
    await expect(textarea).toHaveValue(`${bodyText}\na`);
    await expect(page.locator('[data-node-id="body"] p:last-child strong')).toHaveCount(0);
    for (let step = 0; step < 3; step += 1) {
      await page.getByRole("button", { name: "Undo", exact: true }).click();
    }
    await expect(textarea).toHaveValue(bodyText);
    // Plain-text paste is accepted; clipboard HTML never becomes a stored or rendered element.
    await selectText(textarea, bodyText.length, bodyText.length);
    await textarea.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", " soon");
      data.setData("text/html", '<img src="x" onerror="alert(1)">');
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      // Firefox drops constructor-supplied clipboardData on untrusted fixture events.
      Object.defineProperty(event, "clipboardData", { value: data });
      element.dispatchEvent(event);
    });
    await expect(textarea).toHaveValue(`${bodyText} soon`);
    await expect(page.locator('[data-node-id="body"] img')).toHaveCount(0);
    await expect(page.locator('[data-node-id="body"] strong')).toHaveText("Decide");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(textarea).toHaveValue(bodyText);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(textarea).toHaveValue(`${bodyText} soon`);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(textarea).toHaveValue(bodyText);
    await expect.poll(() => savedDraft(page, record.id)).toEqual(formattedDraft);
    await page.screenshot({ path: testInfo.outputPath("rich-text-editor.png"), fullPage: true });

    // Adding another plain native slide must not downgrade the formatted document.
    if (narrow) await page.getByRole("button", { name: "Open map", exact: true }).click();
    await page.getByRole("button", { name: "Add native slide", exact: true }).click();
    if (narrow) await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    await page.getByLabel("Native slide title", { exact: true }).fill("Next actions");
    await expect.poll(async () => (await savedDraft(page, record.id)).blocks.length).toBe(3);
    expect((await savedDraft(page, record.id)).schemaVersion).toBe(5);
    if (narrow) await page.getByRole("button", { name: "Open map", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Presentation map", exact: true })
      .getByRole("button", { name: /Legacy follow-up/ })
      .click();
    if (narrow) {
      await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    }
    await page.getByRole("button", { name: "Convert to native slide", exact: true }).click();
    await expect
      .poll(async () => {
        const draft = await savedDraft(page, record.id);
        const block = draft.blocks.find((block) => block.id === legacyId);
        return {
          version: draft.schemaVersion,
          sceneVersion: block?.kind === "content" ? block.scene?.schemaVersion : 0,
        };
      })
      .toEqual({ version: 5, sceneVersion: 1 });
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publishing).status()).toBe(200);
    const hosted = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id },
    });
    expect(hosted.status()).toBe(201);
    const { snapshot: lobby, controlToken } = await hosted.json();
    const sessionId = lobby.sessionId as string;
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: sessionId, token: controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
    });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`/join?code=${lobby.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("Rich text attendee");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expect(guest.locator('[data-node-id="body"] strong')).toHaveText("Decide");
      await expect(guest.locator('[data-node-id="body"] ul li')).toHaveText("Assign an owner");
      const audienceLink = guest.getByRole("link", { name: "Review the brief", exact: true });
      await expect(audienceLink).toHaveAttribute("href", link);
      await expect(audienceLink).toHaveAttribute("target", "_blank");
      await expect(audienceLink).toHaveAttribute("rel", /noopener/);
      await expect(audienceLink).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(await guest.locator("body").innerText()).not.toContain("PRIVATE");
      await expect(guest.locator("[data-native-scene] button")).toHaveCount(0);
      await guest.reload();
      await expect(guest.locator('[data-node-id="body"] strong')).toHaveText("Decide");
      await guest.screenshot({
        path: testInfo.outputPath("rich-text-audience.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(guest.getByRole("heading", { name: "Next actions", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: "Legacy follow-up", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      await expect(guest.getByRole("heading", { name: "Thanks for participating" })).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });
}
