import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { PresentationBuilder } from "../../../components/presentation/presentation-builder";
import PresentationBuilderPage from "./page";

describe("Presentation editor outline handoff query", () => {
  it.each([
    [{ start: "outline" }, true],
    [{}, false],
    [{ start: "Outline" }, false],
    [{ start: "outline " }, false],
    [{ start: "generate" }, false],
    [{ start: ["outline"] }, false],
    [{ start: ["outline", "outline"] }, false],
    [{ outline: "outline", returnUrl: "https://example.com" }, false],
  ] as Array<[Record<string, string | string[]>, boolean]>)(
    "allowlists only a scalar outline start request: %j",
    async (query, expected) => {
      const page = await PresentationBuilderPage({
        params: Promise.resolve({ id: "saved-deck" }),
        searchParams: Promise.resolve(query),
      });
      const builder = page.props.children as ReactElement<
        ComponentProps<typeof PresentationBuilder>
      >;
      expect(builder.type).toBe(PresentationBuilder);
      expect(builder.props).toEqual({ presentationId: "saved-deck", startOutline: expected });
    },
  );

  it("forwards no pasted outline or navigation destination from a URL", async () => {
    const page = await PresentationBuilderPage({
      params: Promise.resolve({ id: "saved-deck" }),
      searchParams: Promise.resolve({
        start: "outline",
        outline: "Never submit this URL value",
        returnUrl: "javascript:alert(1)",
      }),
    });
    const builder = page.props.children as ReactElement<ComponentProps<typeof PresentationBuilder>>;
    expect(builder.props).toEqual({ presentationId: "saved-deck", startOutline: true });
  });
});
