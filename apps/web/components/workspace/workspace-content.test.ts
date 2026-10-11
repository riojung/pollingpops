import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./workspace-content.module.css", import.meta.url), "utf8");
const hubStyles = readFileSync(new URL("./workspace-hub.module.css", import.meta.url), "utf8");
const themeStyles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function declaration(css: string, selector: string, property: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1];
  const value = rule?.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1]?.trim();
  if (!value) throw new Error(`Missing ${selector} ${property}`);
  return value;
}

function luminance(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex)) {
    throw new Error(`Expected an opaque RGB theme token, received ${hex}`);
  }
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return channel(1) * 0.2126 + channel(3) * 0.7152 + channel(5) * 0.0722;
}

describe("workspace list-card eyebrow contrast", () => {
  it("uses the workspace theme token instead of the fixed legacy teal", () => {
    expect(declaration(styles, ".listCard :global(.eyebrow)", "color")).toBe(
      "var(--ui-accent-ink)",
    );
    expect(declaration(styles, ".listCard", "background")).toBe("var(--ui-surface)");
  });

  it.each([":root", 'html[data-color-mode="dark"]'])(
    "keeps populated card labels above 4.5:1 in %s",
    (theme) => {
      const foreground = luminance(declaration(themeStyles, theme, "--ui-accent-ink"));
      const background = luminance(declaration(themeStyles, theme, "--ui-surface"));
      const contrast =
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("workspace text actions", () => {
  it.each([
    ["start-card actions", styles, ".startLink"],
    ["inline and folder actions", styles, ".inlineButton,\n.folderActions button"],
    ["hub-card actions", hubStyles, ".cardLink"],
    ["hub-card labels", hubStyles, ".featureCard small,\n.methodCard small"],
  ])("keeps %s on the mint ink token rather than the primary fill", (_label, css, selector) => {
    expect(declaration(css!, selector!, "color")).toBe("var(--ui-accent-ink)");
  });

  it.each([
    ["start-card actions", styles, ".startLink"],
    ["hub-card actions", hubStyles, ".cardLink"],
  ])("gives %s an underline as well as color", (_label, css, selector) => {
    expect(declaration(css!, selector!, "text-decoration")).toBe("underline");
  });
});
