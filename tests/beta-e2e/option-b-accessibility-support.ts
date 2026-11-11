import { expect, type Locator, type Page } from "@playwright/test";

/** Follow the browser's sequential keyboard order rather than clicking/focusing the destination. */
export function tabKey(page: Page, backwards = false) {
  const engine = page.context().browser()?.browserType().name();
  return `${backwards ? "Shift+" : ""}${engine === "webkit" ? "Alt+" : ""}Tab`;
}

export async function tabTo(page: Page, target: Locator, backwards = false, limit = 220) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let index = 0; index < limit; index++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press(tabKey(page, backwards));
  }
  throw new Error("The target was not reachable in the bounded sequential keyboard order.");
}

/** Supporting browser measurements; these do not replace manual WCAG/AT acceptance. */
export async function expectVisibleKeyboardFocus(target: Locator) {
  await expect(target).toBeFocused();
  await target
    .page()
    .evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  const focus = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const rgba = (value: string): number[] => {
      const parts = value.match(/[\d.]+/g)?.map(Number);
      if (!parts || parts.length < 3) throw new Error("Unsupported computed focus color");
      return [...parts.slice(0, 3), parts[3] ?? 1];
    };
    const composite = (front: number[], back: number[]) =>
      front.slice(0, 3).map((value, index) => value * front[3]! + back[index]! * (1 - front[3]!));
    const layers: number[][] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const color = rgba(getComputedStyle(parent).backgroundColor);
      layers.unshift(color);
      if (color[3] === 1) break;
    }
    const background = layers.reduce((back, layer) => composite(layer, back), [255, 255, 255]);
    const luminance = (color: number[]) =>
      color.reduce((sum, value, index) => {
        const normalized = value / 255;
        return (
          sum +
          (normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]!
        );
      }, 0);
    const values = [
      luminance(composite(rgba(style.outlineColor), background)),
      luminance(background),
    ];
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      },
      keyboard: element.matches(":focus-visible"),
      insideViewport:
        rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= innerWidth + 1 &&
        rect.bottom <= innerHeight + 1,
      uncovered: top === element || Boolean(top && element.contains(top)),
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
      outlineContrast: (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05),
    };
  });
  expect(focus.keyboard).toBe(true);
  expect(focus.insideViewport, JSON.stringify(focus.bounds)).toBe(true);
  expect(focus.uncovered).toBe(true);
  expect(focus.outlineStyle).not.toBe("none");
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focus.outlineContrast).toBeGreaterThanOrEqual(3);
}

export async function expectDocumentReflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
}
