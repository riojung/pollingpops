import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { boardFixture, boardIdeaId } from "../../test-utils/idea-board";
import { IdeaBoardIdeas } from "./idea-list";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    t: (key: keyof typeof english, values: Record<string, string | number> = {}) =>
      english[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`)),
  }),
}));

describe("idea board audience presentation", () => {
  it("renders approved plain text and native labelled voting controls while excluding moderation rows", () => {
    const markup = renderToStaticMarkup(
      <IdeaBoardIdeas
        board={{
          ...boardFixture,
          status: "voting",
          voteBudget: 1,
          ideas: [
            { ...boardFixture.ideas[0]!, body: "<script> authored text" },
            {
              ...boardFixture.ideas[0]!,
              id: "pending",
              body: "PRIVATE_PENDING",
              status: "pending",
            },
            { ...boardFixture.ideas[0]!, id: "removed", body: null, status: "removed" },
          ],
        }}
        selected={[boardIdeaId]}
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain("&lt;script&gt; authored text");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("PRIVATE_PENDING");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain("<label");
  });

  it("hides vote totals until closure even if inconsistent metadata is supplied", () => {
    const board = {
      ...boardFixture,
      countsVisible: true,
      ideas: [{ ...boardFixture.ideas[0]!, voteCount: 7 }],
    };
    expect(renderToStaticMarkup(<IdeaBoardIdeas board={board} />)).not.toContain("7 votes");
    expect(
      renderToStaticMarkup(<IdeaBoardIdeas board={{ ...board, status: "closed" }} />),
    ).toContain("7 votes");
  });

  it("enforces the visible selection budget and preserves authored group labels", () => {
    const markup = renderToStaticMarkup(
      <IdeaBoardIdeas
        board={{
          ...boardFixture,
          voteBudget: 1,
          groups: [{ id: "group", name: "Synthetic <group>" }],
          ideas: [{ ...boardFixture.ideas[0]!, groupId: "group" }],
        }}
        selected={["another"]}
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain("Synthetic &lt;group&gt;");
    expect(markup).toContain('disabled=""');
  });
});
