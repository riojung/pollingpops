import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationSceneNode,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  clickNativeInsert,
  closeE01Overlays,
  createE01Deck,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";

const localBody = "Local audience content for this screen.";
const broadcastBody = "Shared evidence for a live audience, tried locally in preview.";
const detailBody = "Review the supporting evidence before deciding what comes next.";
const originalHref = "https://example.com/interaction-brief";
const correctedHref = "https://example.com/reviewed-interaction-brief";

test.use({ actionTimeout: 30_000 });
function fixture() {
  const hidden = { ...e01Slide("HIDDEN planning material"), hidden: true as const };
  const opening = e01Slide("Opening context");
  const current = e01Slide("Interactive evidence");
  const target = e01Slide("Target context");
  current.speakerNotes = "PRIVATE interaction authoring note";
  current.scene = {
    schemaVersion: 6,
    aspectRatio: "16:9",
    nodes: [
      {
        ...current.scene!.nodes[0]!,
        frame: { x: 7, y: 3, width: 86, height: 15 },
      } as PresentationSceneNode,
      {
        id: "local",
        type: "reveal",
        scope: "local",
        label: "Show local detail",
        body: localBody,
        frame: { x: 5, y: 23, width: 42, height: 28 },
      },
      {
        id: "broadcast",
        type: "reveal",
        scope: "broadcast",
        label: "Show shared evidence",
        body: broadcastBody,
        frame: { x: 53, y: 23, width: 42, height: 28 },
      },
      {
        id: "details",
        type: "dialog",
        scope: "local",
        label: "Inspect evidence",
        detailTitle: "Evidence detail",
        body: detailBody,
        frame: { x: 5, y: 57, width: 28, height: 33 },
      },
      {
        id: "link",
        type: "link",
        label: "Read the launch brief",
        href: originalHref,
        frame: { x: 36, y: 57, width: 28, height: 33 },
      },
      {
        id: "navigation",
        type: "navigation",
        label: "Jump to target",
        targetBlockId: target.id.toUpperCase(),
        frame: { x: 67, y: 57, width: 28, height: 33 },
      },
    ],
    readingOrder: [
      current.scene!.nodes[0]!.id,
      "local",
      "broadcast",
      "details",
      "link",
      "navigation",
    ],
  };
  return { hidden, opening, current, target };
}
function currentSlide(record: Awaited<ReturnType<typeof readE01Record>>, id: string) {
  const block = record.draft.blocks.find((candidate) => candidate.id === id);
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected native content");
  return block as ContentSlideDraft & { scene: NonNullable<ContentSlideDraft["scene"]> };
}
async function noOverflow(preview: Locator) {
  const sizes = await preview
    .page()
    .evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  expect(sizes.width, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.viewport + 1);
}

for (const suffix of ["", " @mobile"]) {
  test(`interaction authoring explains scope and previews the selected slide without live side effects${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const slides = fixture();
    const record = await createE01Deck(
      page,
      [slides.hidden, slides.opening, slides.current, slides.target],
      13,
    );
    const sideEffects: string[] = [];
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        request.method() === "POST" &&
        (path.includes("/presentation-sessions") ||
          path.endsWith("/publish") ||
          /\/responses(?:\/|$)/.test(path))
      )
        sideEffects.push(path);
      if (request.url().startsWith("https://example.com/")) externalRequests.push(request.url());
    });
    const viewport = page.viewportSize()!;
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await selectE01Block(page, "Interactive evidence", narrow);
    const inspector = await openE01Inspector(page, "Content");
    const selected = inspector.getByRole("combobox", { name: "Selected object", exact: true });
    const overview = inspector.getByRole("region", { name: "Interaction overview", exact: true });
    const tryIt = inspector.getByRole("button", { name: "Preview this slide", exact: true });
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    const select = async (id: string) => {
      await selected.selectOption(id);
      await expect(selected).toHaveValue(id);
    };
    await select("local");
    const explanation = overview.locator("details");
    await expect(explanation).not.toHaveAttribute("open", "");
    await expect(tryIt).toBeEnabled();
    await overview.getByText("How this interaction works", { exact: true }).click();
    await expect(explanation).toHaveAttribute("open", "");
    for (const label of ["Trigger", "Result", "Audience"])
      await expect(overview.getByText(label, { exact: true })).toBeVisible();
    await expect(
      overview.getByText("Each viewer opens this on their own screen.", { exact: true }),
    ).toBeVisible();
    await expect(tryIt).toBeEnabled();
    await select("broadcast");
    await expect(
      overview.getByText("The facilitator chooses “Show shared evidence” during a live session.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      overview.getByText("Live: reveal for everyone. Preview and shared links: this screen only.", {
        exact: true,
      }),
    ).toBeVisible();
    await select("navigation");
    await expect(overview.getByText("Go to “Target context”.", { exact: true })).toBeVisible();
    await expect(
      overview.getByText("Live: move everyone. Preview and shared links: move this reader only.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      inspector.getByRole("combobox", { name: "Target slide or activity", exact: true }),
    ).toHaveValue(slides.target.id);
    await expect(
      inspector.getByRole("option", { name: "HIDDEN planning material", exact: true }),
    ).toHaveCount(0);
    await select("link");
    await expect(
      overview.getByText(`Open ${originalHref} in a new tab.`, { exact: true }),
    ).toBeVisible();
    const beforeUnsafe = await readE01Record(page, record.id);
    const linkEntry = inspector.getByRole("textbox", { name: "Link URL", exact: true });
    await linkEntry.fill("javascript:alert(1)");
    await expect(linkEntry).toHaveAttribute("aria-invalid", "true");
    await expect(inspector.getByRole("alert")).toContainText("This URL is not saved");
    await expect(tryIt).toBeDisabled();
    await select("local");
    await expect(overview).toContainText(
      "Correct the unsaved link entries on this slide before previewing.",
    );
    await expect(tryIt).toBeDisabled();
    expect(await readE01Record(page, record.id)).toEqual(beforeUnsafe);
    await select("link");
    await expect(linkEntry).toHaveValue("javascript:alert(1)");
    await linkEntry.fill(correctedHref);
    await expect
      .poll(async () => {
        const node = currentSlide(
          await readE01Record(page, record.id),
          slides.current.id,
        ).scene.nodes.find((entry) => entry.id === "link");
        return node?.type === "link" ? node.href : null;
      })
      .toBe(correctedHref);
    await expect(linkEntry).toHaveAttribute("aria-invalid", "false");
    await select("details");
    await expect(overview).toContainText("Open the detail dialog “Evidence detail”.");
    await expect(tryIt).toBeEnabled();
    const beforePreview = await readE01Record(page, record.id);
    await tryIt.click();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-preview-origin", "interaction");
    await expect(preview.getByText("2 / 3", { exact: true })).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "Interactive evidence", exact: true }),
    ).toBeVisible();
    await expect(preview).not.toContainText("HIDDEN planning material");
    await expect(preview).not.toContainText("PRIVATE");
    await expect(preview).not.toContainText(localBody);
    await expect(preview).not.toContainText(broadcastBody);
    const local = preview.getByRole("button", { name: /^Show local detail/ });
    await local.click();
    await expect(
      preview.getByRole("region", { name: "Show local detail", exact: true }),
    ).toHaveText(localBody);
    await local.click();
    await expect(preview).not.toContainText(localBody);
    const broadcast = preview.getByRole("button", { name: /^Show shared evidence/ });
    await expect(broadcast).toContainText("on this screen");
    await broadcast.click();
    await expect(
      preview.getByRole("region", { name: "Show shared evidence", exact: true }),
    ).toHaveText(broadcastBody);
    await broadcast.click();
    await expect(preview).not.toContainText(broadcastBody);
    const link = preview.getByRole("link", { name: /^Read the launch brief/ });
    await expect(link).toHaveAttribute("href", correctedHref);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
    await page.setViewportSize({ width: 320, height: 760 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await noOverflow(preview);
    expect(
      (await new AxeBuilder({ page }).include('[data-presentation-preview="true"]').analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("interaction-current-preview-320.png"),
      fullPage: true,
    });
    const detailTrigger = preview.getByRole("button", { name: /^Inspect evidence/ });
    await detailTrigger.click();
    const details = page.getByRole("dialog", { name: "Evidence detail", exact: true });
    await expect(details).toBeVisible();
    await expect(details.getByRole("region", { name: "Evidence detail", exact: true })).toHaveText(
      detailBody,
    );
    await page.keyboard.press("Escape");
    await expect(details).not.toBeVisible();
    await expect(preview).toBeVisible();
    await expect(detailTrigger).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(preview).not.toBeVisible();
    await expect(inspector).toBeVisible();
    await expect(tryIt).toBeFocused();
    expect(await readE01Record(page, record.id)).toEqual(beforePreview);
    await select("navigation");
    await tryIt.click();
    await expect(preview.getByText("2 / 3", { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: /^Jump to target/ }).click();
    await expect(preview.getByText("3 / 3", { exact: true })).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "Target context", exact: true }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await expect(tryIt).toBeFocused();
    expect(await readE01Record(page, record.id)).toEqual(beforePreview);
    await closeE01Overlays(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(preview.getByText("1 / 3", { exact: true })).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "Opening context", exact: true }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.setViewportSize(viewport);
    await closeE01Overlays(page);
    const picker = page
      .getByText("Interactions", { exact: true })
      .locator("xpath=ancestor::details[1]");
    await picker.locator("summary").click();
    const insertMore = page
      .getByText("Insert more", { exact: true })
      .locator("xpath=ancestor::details[1]");
    for (const name of [
      "Add reveal panel",
      "Add link",
      "Add detail dialog",
      "Add image hotspot",
      "Add slide link",
    ]) {
      await expect(picker.getByRole("button", { name, exact: true })).toBeVisible();
      await expect(
        insertMore.getByRole("button", { name, exact: true, includeHidden: true }),
      ).toHaveCount(0);
    }
    const oldCount = currentSlide(beforePreview, slides.current.id).scene.nodes.length;
    await clickNativeInsert(page, "Add reveal panel");
    await expect
      .poll(
        async () =>
          currentSlide(await readE01Record(page, record.id), slides.current.id).scene.nodes.length,
      )
      .toBe(oldCount + 1);
    await expect(picker).not.toHaveAttribute("open", "");
    await expect(inspector).toBeVisible();
    await expect(overview).toContainText("Add a clear button or link label.");
    await expect(overview).toContainText("Add the audience content to reveal.");
    await expect(tryIt).toBeDisabled();
    await inspector
      .getByRole("textbox", { name: "Reveal panel label", exact: true })
      .fill("Try the new reveal");
    await inspector
      .getByRole("textbox", { name: "Revealed audience content", exact: true })
      .fill("Audience guidance added in the editor.");
    await expect
      .poll(async () =>
        currentSlide(await readE01Record(page, record.id), slides.current.id).scene.nodes.some(
          (node) =>
            node.type === "reveal" &&
            node.label === "Try the new reveal" &&
            node.body === "Audience guidance added in the editor.",
        ),
      )
      .toBe(true);
    await expect(tryIt).toBeEnabled();
    const beforeInsertedPreview = await readE01Record(page, record.id);
    await tryIt.click();
    await expect(preview.getByText("2 / 3", { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: /^Try the new reveal/ }).click();
    await expect(
      preview.getByRole("region", { name: "Try the new reveal", exact: true }),
    ).toHaveText("Audience guidance added in the editor.");
    await page.keyboard.press("Escape");
    await expect(preview).not.toBeVisible();
    await expect(tryIt).toBeFocused();
    expect(await readE01Record(page, record.id)).toEqual(beforeInsertedPreview);
    await clickNativeInsert(page, "Add image hotspot");
    await inspector
      .getByRole("textbox", { name: "Detail button label", exact: true })
      .fill("Inspect the diagram");
    await inspector
      .getByRole("textbox", { name: "Detail title", exact: true })
      .fill("Diagram details");
    await inspector
      .getByRole("textbox", { name: "Detail audience content", exact: true })
      .fill("This hotspot still needs its image.");
    await expect(overview).toContainText("Choose the image for this hotspot.");
    await expect(tryIt).toBeDisabled();
    expect(sideEffects).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}
