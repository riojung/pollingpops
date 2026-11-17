import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WordCloudVisual } from "./word-cloud-visual";

describe("word cloud visual", () => {
  it("renders a deterministic decorative cloud with literal labels and exact frequencies", () => {
    const render = () =>
      renderToStaticMarkup(
        <WordCloudVisual
          terms={[
            { value: "idea", label: "idea", count: 8 },
            { value: "markup", label: "<script>literal</script>", count: 1 },
          ]}
        />,
      );
    const markup = render();
    expect(render()).toBe(markup);
    expect(markup).toContain('data-testid="word-cloud-visual"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-term="idea" data-count="8"');
    expect(markup).toContain("&lt;script&gt;literal");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("<svg");
    expect(markup).toContain('focusable="false"');
  });
});
