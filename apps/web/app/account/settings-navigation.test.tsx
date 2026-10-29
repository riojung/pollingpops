import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsNavigation } from "./settings-navigation";

describe("settings category navigation", () => {
  it("exposes one selected keyboard tab and excludes unauthorized categories", () => {
    const markup = renderToStaticMarkup(
      <SettingsNavigation
        sections={["overview", "plan", "data"]}
        selected="data"
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Settings categories"');
    expect(markup).toMatch(/id="settings-tab-data"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup.match(/aria-controls="settings-panel"/g)).toHaveLength(3);
    expect(markup).not.toContain("settings-tab-people");
    expect(markup).not.toContain("settings-tab-security");
  });
});
