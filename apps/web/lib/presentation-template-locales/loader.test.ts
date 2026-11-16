import { expect, it, vi } from "vitest";

it("loads only the requested authored locale and never fetches a translated catalog for English", async () => {
  vi.resetModules();
  const catalogs = await import("./index");
  expect(catalogs.isPresentationTemplateLocaleLoaded("en-CA")).toBe(true);
  expect(catalogs.isPresentationTemplateLocaleLoaded("fr-FR")).toBe(false);
  expect(catalogs.isPresentationTemplateLocaleLoaded("de-DE")).toBe(false);
  await catalogs.loadPresentationTemplateLocale("en-CA");
  expect(catalogs.isPresentationTemplateLocaleLoaded("fr-FR")).toBe(false);
  expect(() => catalogs.presentationTemplateLocaleCatalog("fr-FR")).toThrow(/has not loaded/);
  const first = catalogs.loadPresentationTemplateLocale("fr-FR");
  expect(catalogs.loadPresentationTemplateLocale("fr-FR")).toBe(first);
  await first;
  expect(catalogs.isPresentationTemplateLocaleLoaded("fr-FR")).toBe(true);
  expect(catalogs.presentationTemplateLocaleCatalog("fr-FR")?.native).toHaveLength(12);
  expect(catalogs.isPresentationTemplateLocaleLoaded("de-DE")).toBe(false);
});
