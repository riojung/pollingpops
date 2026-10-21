import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { boardId } from "../../test-utils/idea-board";
import {
  addDraftLink,
  emptyIdeaDraft,
  IdeaComposer,
  removeDraftImage,
  type IdeaDraft,
} from "./idea-composer";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    t: (key: keyof typeof english, values: Record<string, string | number> = {}) =>
      english[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`)),
  }),
}));

const mediaId = "00000000-0000-4000-8000-000000000005";
const initial: IdeaDraft = {
  ...emptyIdeaDraft(),
  body: "A useful idea",
  attachments: [{ mediaId, alt: "Link illustration" }],
};

describe("rich idea composition", () => {
  it("adds a normalized website or social-post link with a caption and an uploaded image", () => {
    const draft = addDraftLink(initial, " https://EXAMPLE.com/post ", " Useful post ", mediaId);
    expect(draft.links).toEqual([
      { url: "https://example.com/post", label: "Useful post", imageMediaId: mediaId },
    ]);
    expect(() => addDraftLink(initial, "javascript:alert(1)", "")).toThrow();
    expect(() => addDraftLink(initial, "https://user@example.com", "")).toThrow();
    expect(() => addDraftLink(initial, "https://example.com", "", boardId)).toThrow();
    expect(initial.links).toEqual([]);
  });

  it("clears a link thumbnail when its attachment is removed while preserving the link and caption", () => {
    const draft = addDraftLink(initial, "https://example.com/post", "Useful post", mediaId);
    const removed = removeDraftImage(draft, mediaId);
    expect(removed.attachments).toEqual([]);
    expect(removed.links).toEqual([{ url: "https://example.com/post", label: "Useful post" }]);
    expect(draft.links[0]!.imageMediaId).toBe(mediaId);
  });

  it("rejects duplicate links and prevents a fourth link", () => {
    let draft = initial;
    for (let index = 0; index < 3; index++)
      draft = addDraftLink(draft, `https://example.com/${index}`, "");
    expect(() => addDraftLink(draft, "https://example.com/new", "")).toThrow();
    expect(() =>
      addDraftLink(addDraftLink(initial, "https://example.com", ""), "https://EXAMPLE.com/", ""),
    ).toThrow();
  });

  it("shows a precise image capability state while retaining the other composition actions", () => {
    const markup = renderToStaticMarkup(
      <IdeaComposer
        boardId={boardId}
        guestToken={"ab".repeat(32)}
        value={emptyIdeaDraft()}
        disabled={false}
        imagesAvailable={false}
        onChange={() => {}}
        onSubmit={() => {}}
        onUploading={() => {}}
      />,
    );
    const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
      attributes: match[1]!,
      text: match[2]!.replace(/<[^>]*>/g, ""),
    }));
    expect(buttons.find((button) => button.text.endsWith("Image"))!.attributes).toContain(
      "disabled",
    );
    expect(buttons.find((button) => button.text.endsWith("Draw"))!.attributes).not.toContain(
      "disabled",
    );
    expect(buttons.find((button) => button.text.endsWith("Link"))!.attributes).not.toContain(
      "disabled",
    );
    expect(buttons.find((button) => button.text === "Submit idea")!.attributes).toContain(
      "disabled",
    );
    expect(markup).toContain("Image uploads are unavailable for this board.");
    expect(markup).toContain('required=""');
    expect(markup).not.toContain("abababab");
  });
});
