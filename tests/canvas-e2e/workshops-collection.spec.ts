import { expect, test, type Page } from "@playwright/test";
import type { PresentationDraft } from "@openround/contracts";
import { api, fits, organization } from "./support";

const members = {
  rounds: ["exit-ticket", "workshop-expectations"],
  presentations: ["native-practical-workshop", "workshop"],
  surveys: ["learning-needs"],
};
const nativeTitle = "From booking friction to a small service experiment";
const blueprint = "Illustrative booking-service blueprint";

async function expectWorkshopMembers(page: Page, type: keyof typeof members) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/templates" &&
      url.searchParams.get("type") === type &&
      url.searchParams.get("collection") === "workshops",
  );
  await expect(page.locator("[data-collection='workshops']")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(`#template-tab-${type}`)).toHaveAttribute("aria-selected", "true");
  const cards = page.locator(`#template-panel-${type} [data-template-id]`);
  await expect
    .poll(() =>
      cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-template-id")).sort(),
      ),
    )
    .toEqual(members[type]);
}

async function readPresentation(page: Page, id: string) {
  const response = await page.request.get(`${api}/v1/presentations/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  const { presentation } = (await response.json()) as {
    presentation: { id: string; status: string; draft: PresentationDraft };
  };
  return presentation;
}

test("Workshops shows exactly its Round, Presentation and Survey templates", async ({
  page,
}, info) => {
  await organization(page, info);
  await page.goto("/templates?type=rounds");
  await page.getByRole("button", { name: "Workshops", exact: true }).click();
  await expectWorkshopMembers(page, "rounds");

  await page.locator("#template-tab-presentations").click();
  await expectWorkshopMembers(page, "presentations");
  await page.locator("#template-tab-surveys").click();
  await expectWorkshopMembers(page, "surveys");

  await page.getByRole("button", { name: "Training and onboarding", exact: true }).click();
  await expect(page.locator("[data-template-id='onboarding-experience']")).toBeAttached();
  await page.goBack();
  await expectWorkshopMembers(page, "surveys");
});

test("Workshops previews the native worked example and copies it into an editable draft", async ({
  page,
}, info) => {
  await organization(page, info);
  const creationRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/v1/presentations" && request.method() === "POST") creationRequests.push(path);
  });

  const catalog = "/templates?type=presentations&collection=workshops";
  await page.goto(catalog);
  const card = page.locator("[data-template-id='native-practical-workshop']");
  const trigger = card.getByRole("button", { name: "Preview structure", exact: true });
  await trigger.click();
  const preview = page.getByRole("dialog", { name: "Presentation template preview", exact: true });
  await expect(preview.getByRole("heading", { name: nativeTitle, exact: true })).toBeVisible();
  await expect(
    preview.getByText("Read-only template preview. Example information is illustrative."),
  ).toBeVisible();
  const guide = preview.locator("details").filter({ hasText: "Template guide" });
  await expect(guide).toHaveAttribute("open", "");
  await expect(guide.locator("dd")).toHaveText([/\S/, /\S/, /\S/, /\S/, /\S/]);

  const next = preview.getByRole("button", { name: "Next slide", exact: true });
  await next.click();
  await next.click();
  await expect(preview.getByRole("status")).toHaveText("Slide 3 of 8");
  const table = preview.getByRole("table", { name: blueprint, exact: true });
  await expect(
    table.getByRole("cell", { name: "Distinguish receipt from confirmation" }),
  ).toBeVisible();
  await preview.getByText("Presenter guide", { exact: true }).click();
  await expect(preview.getByText(/Explain each column using the same request/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  expect(creationRequests).toEqual([]);

  await card.getByRole("button", { name: "Use presentation template", exact: true }).click();
  await expect(page).toHaveURL(/\/presentation\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const created = await readPresentation(page, id);
  expect(created).toMatchObject({ id, status: "draft", draft: { title: nativeTitle } });
  expect(created.draft.blocks).toHaveLength(8);
  expect(created.draft.blocks.every((block) => block.kind === "content" && block.scene)).toBe(true);
  expect(created.draft.blocks[2]).toMatchObject({
    scene: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ type: "table", caption: blueprint }),
      ]),
    },
  });

  const title = page.getByRole("textbox", { name: "Presentation title", exact: true });
  await expect(title).toHaveValue(nativeTitle);
  const editedTitle = "Our community centre workshop";
  await title.fill(editedTitle);
  await expect.poll(async () => (await readPresentation(page, id)).draft.title).toBe(editedTitle);

  await page.goto(catalog);
  await trigger.click();
  await expect(preview.getByRole("heading", { name: nativeTitle, exact: true })).toBeVisible();
  expect(creationRequests).toEqual(["/v1/presentations"]);
});

test("Workshops fits with all collection choices at 320px @mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await organization(page, info);
  await page.goto("/templates?type=rounds");

  const selector = page.getByRole("group", { name: "Collection", exact: true });
  const choices = [
    "All templates",
    "Team meetings",
    "Training and onboarding",
    "Workshops",
    "Event feedback",
  ];
  await expect(selector.getByRole("button")).toHaveCount(choices.length);
  for (const name of choices) {
    const button = selector.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height, `${name} tap target height`).toBeGreaterThanOrEqual(44);
    expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(320);
  }
  await fits(page);

  const workshops = selector.getByRole("button", { name: "Workshops", exact: true });
  await workshops.tap();
  await expectWorkshopMembers(page, "rounds");
  await fits(page);
  const all = selector.getByRole("button", { name: "All templates", exact: true });
  await all.tap();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(workshops).toHaveAttribute("aria-pressed", "false");
  await fits(page);
});
