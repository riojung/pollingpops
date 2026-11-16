import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import { nativeResizeDirectionLabel } from "./native-scene-resize-copy";

describe("direct resize handle names", () => {
  it.each(supportedLocales)("gives all eight handles distinct readable names in %s", (locale) => {
    const names = (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((edge) =>
      nativeResizeDirectionLabel(locale, edge),
    );
    expect(names.every((name) => name.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(8);
    expect(names).not.toContain("nw");
  });
  it("uses full English edge and corner labels", () => {
    expect(nativeResizeDirectionLabel("en-CA", "nw")).toBe("top left");
    expect(nativeResizeDirectionLabel("en-CA", "e")).toBe("right");
    expect(nativeResizeDirectionLabel("ko-KR", "se")).toBe("오른쪽 아래");
  });
});
