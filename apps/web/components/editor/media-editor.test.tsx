import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QuestionDraft } from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import { translate, type MessageKey } from "../../lib/i18n/catalog";
import { deliveryAuthoringEnglishMessages } from "../../lib/i18n/domains/delivery-authoring";
import { MediaEditor } from "./media-editor";
import type { QuestionUpdater } from "./types";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    t: (key: MessageKey) => translate(deliveryAuthoringEnglishMessages, key),
  }),
}));

const question: QuestionDraft = {
  id: "question-id",
  type: "numeric",
  prompt: "Estimate the area",
  correctValue: "4",
  tolerance: "0",
  unit: null,
  timeLimitSeconds: 30,
  basePoints: 1_000,
  explanation: "",
  mediaId: null,
  mediaAlt: "A square split into four parts",
};

function editor(overrides: Partial<Parameters<typeof MediaEditor>[0]> = {}) {
  return MediaEditor({
    question,
    uxBeta: true,
    mediaUploadsEnabled: true,
    mediaState: "idle",
    mediaPreviewUrl: "",
    onRemoveImage: vi.fn(),
    onUpdateQuestion: vi.fn(),
    onUploadImage: vi.fn(),
    ...overrides,
  });
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function control(node: ReactNode, id: string) {
  const element = elements(node).find((item) => item.props.id === id);
  if (!element) throw new Error(`Missing media control: ${id}`);
  return element;
}

describe("MediaEditor", () => {
  it("keeps upload and alternative-text controls available without a preview", () => {
    const markup = renderToStaticMarkup(editor());
    expect(markup).toContain('data-has-preview="false"');
    expect(markup).toContain('<label for="media-alt">');
    expect(markup).toContain('id="media-alt"');
    expect(markup).toContain('<label for="media-upload" lang="en-CA">');
    expect(markup).toContain('aria-describedby="media-help"');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("Remove image");
  });

  it("preserves alternative text, preview removal, and repeated file selection", () => {
    const onUpdateQuestion = vi.fn<QuestionUpdater>();
    const onRemoveImage = vi.fn();
    const onUploadImage = vi.fn();
    const node = editor({
      mediaPreviewUrl: "/scanned-image.png",
      onUpdateQuestion,
      onRemoveImage,
      onUploadImage,
    });
    const markup = renderToStaticMarkup(node);
    expect(markup).toContain('data-has-preview="true"');
    expect(markup).toContain('alt="A square split into four parts"');
    expect(markup).toContain("Remove image");

    const alt = control(node, "media-alt");
    const changeAlt = alt.props.onChange as (event: { target: { value: string } }) => void;
    changeAlt({ target: { value: "Four equal squares" } });
    expect(onUpdateQuestion.mock.calls[0]![0](question)).toEqual({
      ...question,
      mediaAlt: "Four equal squares",
    });
    changeAlt({ target: { value: "" } });
    expect(onUpdateQuestion.mock.calls[1]![0](question).mediaAlt).toBeNull();

    const file = new File(["scanned image"], "square.png", { type: "image/png" });
    const uploadEvent = { target: { files: [file] }, currentTarget: { value: "square.png" } };
    const upload = control(node, "media-upload");
    (upload.props.onChange as (event: typeof uploadEvent) => void)(uploadEvent);
    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(uploadEvent.currentTarget.value).toBe("");

    const remove = elements(node).find((item) => item.type === "button");
    (remove!.props.onClick as () => void)();
    expect(onRemoveImage).toHaveBeenCalledOnce();
  });

  it.each(["uploading", "scanning"] as const)(
    "keeps file selection disabled while %s",
    (mediaState) => {
      const node = editor({ mediaState });
      expect(control(node, "media-upload").props.disabled).toBe(true);
      expect(renderToStaticMarkup(node)).toContain('role="status"');
      expect(control(editor({ mediaUploadsEnabled: false }), "media-upload").props.disabled).toBe(
        true,
      );
    },
  );
});
