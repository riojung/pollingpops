import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { surveyBranchingFixture } from "../../../../packages/contracts/test/support/survey-branching-fixture";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { SurveyLibraryCards } from "./survey-library-cards";

vi.mock("next/navigation", () => ({ usePathname: () => "/library" }));

describe("retained conditional Survey cards", () => {
  it.each(["draft", "published", "archived"] as const)(
    "keeps %s Surveys view-only without invoking Library sharing actions",
    (status) => {
      const renderSharingAction = vi.fn(() => <button>Share in Library</button>);
      const markup = renderToStaticMarkup(
        withEnglishLocale(
          <SurveyLibraryCards
            surveys={[
              {
                id: "retained",
                title: "Conditional feedback",
                description: "",
                draft: surveyBranchingFixture(),
                status,
                folderId: null,
                favorite: false,
              },
            ]}
            folders={[]}
            view="grid"
            canEdit
            canCreate
            selectedIds={new Set()}
            busy={false}
            onSelect={() => {}}
            onFavorite={() => {}}
            onAction={() => {}}
            renderSharingAction={renderSharingAction}
          />,
        ),
      );
      expect(markup).toContain('data-action="view"');
      expect(markup).toContain('href="/surveys/retained"');
      expect(markup).not.toContain('data-action="edit"');
      expect(markup).not.toContain("Share");
      expect(markup).not.toContain("Duplicate");
      expect(renderSharingAction).not.toHaveBeenCalled();
      expect(markup.includes(">Archive</button>")).toBe(status !== "archived");
      expect(markup).toContain('aria-label="Select Conditional feedback"');
    },
  );
});
