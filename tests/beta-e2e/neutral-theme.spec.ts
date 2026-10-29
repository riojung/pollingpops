import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInBeta } from "./sign-in";

for (const surface of ["desktop", "phone @mobile"]) {
  test(`neutral brand theme keeps text actions mint and underlined on ${surface}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);

    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode });
      const ink = mode === "light" ? "rgb(20, 101, 82)" : "rgb(185, 234, 206)";
      for (const [path, action] of [
        ["/create", "Choose a starting point"],
        ["/discover", "Explore starters →"],
      ] as const) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
        const textAction = page.getByRole("main").getByText(action, { exact: true }).first();
        await expect(textAction).toBeVisible();
        await expect(textAction).toHaveCSS("color", ink);
        await expect(textAction).toHaveCSS("text-decoration-line", "underline");
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
    }
  });

  test(`neutral brand theme keeps templates usable in light and dark on ${surface}`, async ({
    page,
  }, testInfo) => {
    if (surface === "desktop") await page.setViewportSize({ width: 1512, height: 982 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    await page.goto("/templates");
    await expect(page.getByRole("heading", { name: "Templates", exact: true })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(36);

    for (const mode of ["light", "dark"] as const) {
      // Filtering replaces cards beneath the pointer; do not assert a hover color
      // as the resting palette when the next appearance iteration starts.
      await page.mouse.move(0, 0);
      await page.emulateMedia({ colorScheme: mode });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
      await expect(page.getByRole("button", { name: "Preview questions" }).first()).toHaveCSS(
        "background-color",
        mode === "light" ? "rgb(241, 243, 245)" : "rgb(38, 43, 51)",
      );
      await expect(page.getByRole("button", { name: "Use this starter" }).first()).toHaveCSS(
        "background-color",
        mode === "light" ? "rgb(38, 43, 51)" : "rgb(237, 240, 244)",
      );
      // Wait for inherited text as well as control fills before inspecting contrast.
      await expect(page.getByLabel("Search templates").locator("..").locator("span")).toHaveCSS(
        "color",
        mode === "light" ? "rgb(48, 54, 64)" : "rgb(232, 235, 240)",
      );
      await expect(page.locator("body")).toHaveCSS("background-image", "none");
      const brandSurface = page.getByRole(surface === "desktop" ? "complementary" : "banner");
      await expect(brandSurface).toHaveCSS("background-image", /radial-gradient/);
      await expect(brandSurface).toHaveCSS(
        "background-image",
        mode === "light" ? /rgba\(249, 104, 138, 0\.18\)/ : /rgba\(249, 104, 138, 0\.12\)/,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.getByRole("heading", { name: "Templates", exact: true }).click();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath(`templates-${mode}.png`), scale: "css" });
      if (surface === "desktop") {
        await page.screenshot({
          path: testInfo.outputPath(`logo-glow-${mode}.png`),
          clip: { x: 0, y: 0, width: 244, height: 240 },
          scale: "css",
        });
      }

      const search = page.getByLabel("Search templates");
      await search.focus();
      await expect(search).toBeFocused();
      await expect(search).toHaveCSS("outline-style", "solid");
      await search.fill("api retries");
      await expect(page.getByRole("article")).toHaveCount(1);
      const preview = page.getByRole("button", { name: "Preview questions" });
      await preview.focus();
      await expect(preview).toHaveCSS("outline-width", "3px");
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("A client times out after submitting a payment.", {
          exact: false,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close preview" }).click();
      await search.fill("");
      await expect(page.getByRole("article")).toHaveCount(36);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  });
}
