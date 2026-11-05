import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type {
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
} from "../../packages/contracts/src/index.ts";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const revealLabel = "See the supporting evidence";
const audienceBody =
  "Public evidence <strong>stays plain text</strong>.\nChoose the next step together.";
const sourceLabel = "Read the evidence source";
const href = "https://example.test/evidence";

function revealButton(page: Page) {
  return page.locator('[data-native-interaction="reveal"] button');
}
async function expectClosed(page: Page) {
  await expect(revealButton(page)).toHaveAttribute("aria-expanded", "false");
  // The body is absent, rather than merely concealed in a hidden element.
  expect(await page.content()).not.toContain("Choose the next step together");
}
async function expectNoOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(sizes.width, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.viewport + 1);
}
async function participantSnapshot(page: Page, sessionId: string) {
  const token = await page.evaluate(
    (id) => sessionStorage.getItem(`openround:presentation-participant:${id}`),
    sessionId,
  );
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/participant`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot as PresentationParticipantSnapshot;
}
function monitorInteractionCommands() {
  const monitoredWindow = window as typeof window & { e06SentCommands?: string[] };
  monitoredWindow.e06SentCommands = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string" && /presentation\.(?:command|response)/.test(data))
      monitoredWindow.e06SentCommands!.push(data);
    return send.call(this, data);
  };
}
async function sentCommands(page: Page) {
  return page.evaluate(
    () => (window as typeof window & { e06SentCommands?: string[] }).e06SentCommands ?? [],
  );
}

async function hostSnapshot(page: Page, sessionId: string) {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot as PresentationHostSnapshot;
}

for (const suffix of ["", " @mobile"]) {
  test(`basic interactions save, duplicate, publish and stay local across delivery screens${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.context().addInitScript(monitorInteractionCommands);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const title = `Evidence interaction ${randomUUID().slice(0, 8)}`;
    const copyTitle = `${title} copy`;
    const slide = e01Slide(title);
    slide.scene!.nodes = slide.scene!.nodes.slice(0, 1);
    slide.scene!.readingOrder = slide.scene!.nodes.map((node) => node.id);
    slide.speakerNotes = "PRIVATE E06 facilitator cue";
    slide.citations = [{ locator: "PRIVATE E06 source", excerpt: "PRIVATE E06 excerpt" }];
    const record = await createE01Deck(page, [slide]);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await page.getByRole("button", { name: "Add reveal panel", exact: true }).click();
    await page.getByRole("textbox", { name: "Reveal panel label", exact: true }).fill(revealLabel);
    await page
      .getByRole("textbox", { name: "Revealed audience content", exact: true })
      .fill(audienceBody);
    await page.getByRole("button", { name: "Add link", exact: true }).click();
    await page.getByRole("textbox", { name: "Link label", exact: true }).fill(sourceLabel);
    const url = page.getByRole("textbox", { name: "Link URL", exact: true });
    await url.fill("javascript:alert(1)");
    await expect(url).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("alert").filter({ hasText: "This URL is not saved" }),
    ).toBeVisible();
    await url.fill(href);
    await expect(url).toHaveAttribute("aria-invalid", "false");
    await page.getByRole("button", { name: "Read object earlier", exact: true }).click();
    const editor = page.locator("[data-native-scene]");
    await expect(editor.getByRole("link", { name: new RegExp(sourceLabel) })).toHaveCount(0);
    await expect(editor.locator('[data-native-interaction="reveal"] button')).toHaveCount(0);
    await expect
      .poll(async () => {
        const draft = (await readE01Record(page, record.id)).draft;
        const saved = draft.blocks[0];
        return saved?.kind === "content"
          ? {
              version: draft.schemaVersion,
              sceneVersion: saved.scene?.schemaVersion,
              nodes: saved.scene?.nodes.filter(
                (node) => node.type === "reveal" || node.type === "link",
              ),
            }
          : null;
      })
      .toMatchObject({
        version: 11,
        sceneVersion: 5,
        nodes: [
          { type: "reveal", label: revealLabel, body: audienceBody, scope: "local" },
          { type: "link", label: sourceLabel, href },
        ],
      });
    const original = (await readE01Record(page, record.id)).draft.blocks[0]!;
    if (original.kind !== "content" || !original.scene) throw new Error("Expected native scene");
    const originalIds = new Set(original.scene.nodes.map((node) => node.id));
    const linkNode = original.scene.nodes.find((node) => node.type === "link")!;
    const revealNode = original.scene.nodes.find((node) => node.type === "reveal")!;
    expect(original.scene.readingOrder.indexOf(linkNode.id)).toBeLessThan(
      original.scene.readingOrder.indexOf(revealNode.id),
    );
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.getByRole("textbox", { name: "Native slide title", exact: true }).fill(copyTitle);
    await page.getByRole("button", { name: "Move earlier", exact: true }).click();
    await expect
      .poll(async () => {
        const draft = (await readE01Record(page, record.id)).draft;
        const copy = draft.blocks[0];
        return (
          copy?.kind === "content" &&
          copy.scene?.nodes.every((node) => !originalIds.has(node.id)) &&
          copy.scene.nodes.some((node) => node.type === "text" && node.text === copyTitle)
        );
      })
      .toBe(true);
    await page.reload();
    if (narrow) {
      await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
      await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    }
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publishing).status()).toBe(200);
    const sessionResponse = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id },
    });
    expect(sessionResponse.status()).toBe(201);
    const { snapshot: lobby, controlToken } = await sessionResponse.json();
    const sessionId = lobby.sessionId as string;
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: sessionId, token: controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    const stageCreated = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
    const stage = await stageCreated;
    const companionCreated = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Launch companion", exact: true }).click();
    const companion = await companionCreated;
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    try {
      await guestContext.addInitScript(monitorInteractionCommands);
      const guest = await guestContext.newPage();
      await guest.goto(`/join?code=${lobby.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("E06 interaction audience");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      for (const surface of [stage, companion, guest]) {
        await surface.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
        await expectClosed(surface);
        const external = surface.getByRole("link", {
          name: `${sourceLabel} Opens in a new tab`,
          exact: true,
        });
        await expect(external).toHaveAttribute("href", href);
        await expect(external).toHaveAttribute("target", "_blank");
        await expect(external).toHaveAttribute("rel", "noopener noreferrer");
        expect(await surface.content()).not.toContain("PRIVATE E06");
        await expect(
          surface.getByText(
            "Panels open only on this screen. They do not change other screens, responses or scores.",
            { exact: true },
          ),
        ).toBeVisible();
      }
      const before = await hostSnapshot(page, sessionId);
      const beforeParticipant = await participantSnapshot(guest, sessionId);
      const writes: string[] = [];
      for (const surface of [page, stage, companion, guest]) {
        surface.on("request", (request) => {
          if (request.method() !== "GET" && /presentation-sessions/.test(request.url()))
            writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        });
      }
      const commandCounts = await Promise.all(
        [page, stage, companion, guest].map(
          async (surface) => (await sentCommands(surface)).length,
        ),
      );
      // Native Enter/Space activation must leave the presenter's global advance shortcut idle.
      const hostCurrent = page.getByRole("region", { name: "Current slide", exact: true });
      const hostReveal = hostCurrent.locator('[data-native-interaction="reveal"] button');
      await hostReveal.focus();
      await hostReveal.press("Enter");
      await expect(hostReveal).toHaveAttribute("aria-expanded", "true");
      await hostReveal.press("Space");
      await expect(hostReveal).toHaveAttribute("aria-expanded", "false");
      await hostReveal.press("ArrowRight");
      await revealButton(stage).focus();
      await revealButton(stage).press("Enter");
      await expect(revealButton(stage)).toHaveAttribute("aria-expanded", "true");
      await expectClosed(companion);
      await expectClosed(guest);
      const audienceRegion = stage.getByRole("region", { name: revealLabel, exact: true });
      await expect(audienceRegion).toContainText("<strong>stays plain text</strong>");
      await expect(audienceRegion.locator("strong")).toHaveCount(0);
      for (const surface of [stage, companion, guest]) {
        await surface.getByRole("button", { name: "Show accessible outline", exact: true }).click();
        const scene = surface.locator("[data-native-scene]");
        await expect(scene).toHaveAttribute("data-native-outline", "true");
        await expect(surface.locator('[data-native-interaction="reveal"] button')).toHaveCount(1);
        expect(
          await scene
            .locator("[data-node-id]")
            .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-type"))),
        ).toEqual(["text", "link", "reveal"]);
        await expectNoOverflow(surface);
        expect((await new AxeBuilder({ page: surface }).analyze()).violations).toEqual([]);
      }
      // Switching layout retains the one disclosure's local state.
      await expect(revealButton(stage)).toHaveAttribute("aria-expanded", "true");
      await revealButton(companion).click();
      await expect(revealButton(companion)).toHaveAttribute("aria-expanded", "true");
      await expectClosed(guest);
      const after = await hostSnapshot(page, sessionId);
      const afterParticipant = await participantSnapshot(guest, sessionId);
      expect({
        revision: after.revision,
        seq: after.seq,
        block: after.currentBlock?.id,
        responses: after.roomStatus.responseCount,
      }).toEqual({
        revision: before.revision,
        seq: before.seq,
        block: before.currentBlock?.id,
        responses: before.roomStatus.responseCount,
      });
      expect({
        submitted: afterParticipant.responseSubmitted,
        standing: afterParticipant.standing,
      }).toEqual({
        submitted: beforeParticipant.responseSubmitted,
        standing: beforeParticipant.standing,
      });
      expect(JSON.stringify(afterParticipant)).not.toContain("PRIVATE E06");
      expect(writes).toEqual([]);
      expect(
        await Promise.all(
          [page, stage, companion, guest].map(
            async (surface) => (await sentCommands(surface)).length,
          ),
        ),
      ).toEqual(commandCounts);
      await companion.reload();
      await expectClosed(companion);
      await stage.screenshot({
        path: testInfo.outputPath("basic-interactions-outline.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      for (const surface of [stage, companion, guest]) {
        await expect(
          surface.locator("[data-native-scene]").getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        await expectClosed(surface);
      }
      await revealButton(guest).click();
      await expect(revealButton(guest)).toHaveAttribute("aria-expanded", "true");
      await guest.reload();
      await expectClosed(guest);
    } finally {
      await guestContext.close();
      await stage.close();
      await companion.close();
    }
  });
}
