import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
type Folder = { id: string; name: string; parentId: string | null; position: number };
const cases = [
  { type: "rounds", artifactType: "round", label: "Rounds", endpoint: "quizzes", field: "quiz" },
  {
    type: "presentations",
    artifactType: "presentation",
    label: "Presentations",
    endpoint: "presentations",
    field: "presentation",
  },
  {
    type: "surveys",
    artifactType: "survey",
    label: "Surveys",
    endpoint: "surveys",
    field: "survey",
  },
] as const;

async function folders(page: Page, artifactType: string): Promise<Folder[]> {
  const response = await page.request.get(`${api}/v1/folders?artifactType=${artifactType}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).folders;
}

for (const journey of [...cases, { ...cases[0], mobile: true }]) {
  const mobile = "mobile" in journey;
  test(`${mobile ? "@mobile " : ""}${journey.label} have separate nested folders and durable content moves`, async ({
    page,
  }) => {
    await signInBeta(page);
    const suffix = randomUUID().slice(0, 8);
    const title = `Synthetic ${journey.label} folder content ${suffix}`;
    const artifactResponse = await page.request.post(`${api}/v1/${journey.endpoint}`, {
      data:
        journey.artifactType === "survey"
          ? { title, idempotencyKey: randomUUID() }
          : { title, description: "" },
    });
    expect(artifactResponse.ok()).toBe(true);
    const artifact = (await artifactResponse.json())[journey.field];
    if (journey.artifactType === "round") {
      const tagged = await page.request.patch(`${api}/v1/quizzes/${artifact.id}/organization`, {
        data: { folderId: null, tags: ["folder-move-preserved"] },
      });
      expect(tagged.ok()).toBe(true);
    }
    const foreignType = journey.artifactType === "round" ? "survey" : "round";
    const foreignName = `Other type ${suffix}`;
    const foreign = await page.request.post(`${api}/v1/folders`, {
      data: { name: foreignName, artifactType: foreignType },
    });
    expect(foreign.ok()).toBe(true);

    await page.goto(`/library?type=${journey.type}`);
    await expect(page.getByRole("tab", { name: new RegExp(`^${journey.label}`) })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const manageLink = page.getByRole("link", { name: "Manage folders", exact: true });
    await expect(manageLink).toHaveAttribute("href", `/library/folders?type=${journey.type}`);
    await manageLink.click();
    await expect(page.getByRole("heading", { name: "Manage folders", exact: true })).toBeVisible();
    await expect(
      page.locator('a[aria-current="page"][href="/library"]:visible').first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Library content type", exact: true })
        .getByRole("link", { name: journey.label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("button", { name: `Open folder ${foreignName}`, exact: true }),
    ).toHaveCount(0);

    const rootName = `Workshop ${suffix}`;
    const secondName = `Archive ${suffix}`;
    const childName = `Week 1 ${suffix}`;
    const createFolder = async (name: string, parentId = "") => {
      await page.getByLabel("Folder name", { exact: true }).fill(name);
      const parent = page.getByRole("combobox", { name: "Parent folder", exact: true });
      if (parentId) await parent.selectOption(parentId);
      else await parent.selectOption({ label: "Top level" });
      await page.getByRole("button", { name: "Create folder", exact: true }).click();
      await expect
        .poll(async () =>
          (await folders(page, journey.artifactType)).some((folder) => folder.name === name),
        )
        .toBe(true);
      return (await folders(page, journey.artifactType)).find((folder) => folder.name === name)!;
    };
    const root = await createFolder(rootName);
    const second = await createFolder(secondName);
    const child = await createFolder(childName, root.id);
    await expect(
      page.getByRole("button", { name: `Open folder ${rootName} / ${childName}`, exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Move ${rootName} down`, exact: true }).click();
    await expect
      .poll(async () => {
        const rows = await folders(page, journey.artifactType);
        return (
          rows.find((folder) => folder.id === root.id)!.position >
          rows.find((folder) => folder.id === second.id)!.position
        );
      })
      .toBe(true);
    await page.getByRole("button", { name: `Rename ${secondName}`, exact: true }).click();
    const renamed = `${secondName} updated`;
    await page.getByLabel("New folder name", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Open folder ${renamed}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: `Move ${rootName} / ${childName}`, exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "New parent folder", exact: true })
      .selectOption(second.id);
    await page.getByRole("button", { name: "Move folder", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await folders(page, journey.artifactType)).find((folder) => folder.id === child.id)
            ?.parentId,
      )
      .toBe(second.id);

    await page.goto(`/library/folders?type=${journey.type}`);
    await page.getByRole("checkbox", { name: `Select ${title}`, exact: true }).check();
    if (journey.artifactType === "round") {
      const concurrentTagEdit = await page.request.patch(
        `${api}/v1/quizzes/${artifact.id}/organization`,
        {
          data: { folderId: null, tags: ["folder-move-preserved", "concurrent-tag-update"] },
        },
      );
      expect(concurrentTagEdit.ok()).toBe(true);
    }
    await page
      .getByRole("combobox", { name: "Destination folder", exact: true })
      .selectOption(child.id);
    await page.getByRole("button", { name: "Move selected", exact: true }).click();
    const getArtifact = async () => {
      const response = await page.request.get(`${api}/v1/${journey.endpoint}/${artifact.id}`);
      expect(response.ok()).toBe(true);
      return (await response.json())[journey.field];
    };
    await expect.poll(async () => (await getArtifact()).folderId).toBe(child.id);
    if (journey.artifactType === "round") {
      expect((await getArtifact()).tags).toEqual([
        "folder-move-preserved",
        "concurrent-tag-update",
      ]);
    }
    await page.reload();
    await page
      .getByRole("button", { name: `Open folder ${renamed} / ${childName}`, exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", { name: `Select ${title}`, exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Delete ${renamed}`, exact: true }).click();
    await page.getByRole("button", { name: "Delete folder", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await folders(page, journey.artifactType)).find((folder) => folder.id === child.id)
            ?.parentId,
      )
      .toBe(null);
    await expect.poll(async () => (await getArtifact()).folderId).toBe(child.id);
    await expect(
      page.getByRole("button", { name: `Open folder ${childName}`, exact: true }),
    ).toBeVisible();
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results-beta/folders-${journey.type}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}
