import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { LivePollChoices } from "./live-poll-choices";

vi.mock("next/navigation", () => ({ usePathname: () => "/play/test-session" }));

const question = {
  id: "poll",
  maxSelections: 2,
  choices: [
    { id: "a", label: "First priority" },
    { id: "b", label: "Second priority" },
    { id: "c", label: "Third priority" },
  ],
};

describe("LivePollChoices", () => {
  it("exposes selected options as native checkboxes and disables only unselected options at the limit", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<LivePollChoices question={question} selectedChoiceIds={["a", "c"]} />),
    );
    expect(markup).toContain("Select up to 2 options. 2 selected.");
    expect(markup).toMatch(/type="checkbox" name="poll" checked="" value="a"/);
    expect(markup).toMatch(/type="checkbox" disabled="" name="poll" value="b"/);
    expect(markup).toMatch(/type="checkbox" name="poll" checked="" value="c"/);
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(markup).toContain('<span lang="">First priority</span>');
  });

  it("keeps all saved selections checked in a disabled fieldset", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <LivePollChoices question={question} selectedChoiceIds={["a", "b"]} disabled />,
      ),
    );
    expect(markup).toContain('<fieldset disabled=""');
    expect(markup.match(/checked=""/g)).toHaveLength(2);
  });
});
