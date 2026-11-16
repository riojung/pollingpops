import { expect, type Locator, type Page } from "@playwright/test";

export async function openHostControls(page: Page) {
  const bar = page.getByTestId("host-command-bar");
  const toggle = bar.getByTestId("host-command-tools-toggle");
  if (await toggle.count()) {
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(bar.getByTestId("host-command-tools")).toBeVisible();
    return;
  }
  const more = bar
    .locator("details")
    .filter({ has: page.getByText("More controls", { exact: true }) });
  if ((await more.count()) && (await more.getAttribute("open")) === null) {
    await more.locator("summary").click();
  }
}

export async function clickHostCommand(page: Page, name: string) {
  const command = page.getByTestId("host-command-bar").getByRole("button", { name, exact: true });
  if (!(await command.isVisible())) await openHostControls(page);
  await command.click();
}

export async function closeHostControls(bar: Locator) {
  const toggle = bar.getByTestId("host-command-tools-toggle");
  if (await toggle.count()) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(bar.getByTestId("host-command-tools")).toBeHidden();
    return;
  }
  const more = bar.locator("details");
  if ((await more.count()) && (await more.getAttribute("open")) !== null)
    await more.locator("summary").click();
}

export async function expectControlLabelCentered(control: Locator, allowIconOnly = false) {
  const geometry = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textBoxes: DOMRect[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      if (node.parentElement?.closest('[aria-hidden="true"], .sr-only, [hidden]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      textBoxes.push(...[...range.getClientRects()].filter((rect) => rect.width && rect.height));
    }
    const textTop = Math.min(...textBoxes.map((rect) => rect.top));
    const textBottom = Math.max(...textBoxes.map((rect) => rect.bottom));
    const icon = [...element.querySelectorAll('[aria-hidden="true"]')].find(
      (candidate) => candidate.getClientRects().length > 0,
    );
    const iconBox = icon?.getBoundingClientRect();
    return {
      label: element.getAttribute("aria-label") ?? element.textContent?.trim(),
      height: box.height,
      lines: textBoxes.length,
      centerOffset: Math.abs((textTop + textBottom) / 2 - (box.top + box.bottom) / 2),
      iconCenterOffset: iconBox
        ? Math.abs((iconBox.top + iconBox.bottom) / 2 - (box.top + box.bottom) / 2)
        : null,
    };
  });
  expect(geometry.height, `${geometry.label} has a 44px target`).toBeGreaterThanOrEqual(44);
  if (!geometry.lines && allowIconOnly) {
    expect(geometry.iconCenterOffset, `${geometry.label} has a visible icon`).not.toBeNull();
    expect(
      geometry.iconCenterOffset,
      `${geometry.label} icon is vertically centered`,
    ).toBeLessThanOrEqual(2);
    return;
  }
  expect(geometry.lines, `${geometry.label} has rendered text`).toBeGreaterThan(0);
  expect(
    geometry.centerOffset,
    `${geometry.label} text is vertically centered`,
  ).toBeLessThanOrEqual(2);
}

export async function expectHostActionRow(
  bar: Locator,
  primaryName: string,
  desktop: boolean,
  sameRow = desktop,
) {
  const controls = [
    bar.getByRole("button", { name: primaryName, exact: true }),
    bar.locator('[aria-controls="host-audience-drawer"]'),
    bar.getByTestId("host-command-tools-toggle"),
  ];
  for (const [index, control] of controls.entries())
    await expectControlLabelCentered(control, index === 2 && !desktop);
  if (!sameRow) return;
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
  const centers = boxes.map((box) => box!.y + box!.height / 2);
  expect(
    Math.max(...centers) - Math.min(...centers),
    "Primary, Audience and More controls share one row",
  ).toBeLessThanOrEqual(1);
  const tools = bar.getByTestId("host-command-tools");
  if (!(await tools.isVisible())) return;
  const panel = await tools.boundingBox();
  const rowBottom = Math.max(...boxes.map((box) => box!.y + box!.height));
  expect(
    panel!.y - rowBottom,
    "Tools follow the action row without an empty row",
  ).toBeLessThanOrEqual(24);
  expect(panel!.y).toBeGreaterThanOrEqual(rowBottom - 1);
  const firstToolTop = await tools.evaluate((element) =>
    Math.min(
      ...[...element.querySelectorAll("button, label")]
        .filter((control) => control.getClientRects().length)
        .map((control) => control.getBoundingClientRect().top),
    ),
  );
  expect(
    firstToolTop - rowBottom,
    "Tools use the space immediately below the actions",
  ).toBeLessThanOrEqual(40);
}
