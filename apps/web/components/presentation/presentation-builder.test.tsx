import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import type { PresentationDraft, QuestionDraft } from "@openround/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { createQuestionBlock } from "../../lib/presentation-builder";

const editor = vi.hoisted(() => ({
  draft: null as PresentationDraft | null,
  nullCursor: 0,
  tab: "build",
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (editor.draft && initial === null) {
        // The editor's first nullable states are its server record, draft and selected block.
        const slot = editor.nullCursor++;
        const values = [
          { id: "presentation-1", status: "draft", draft: editor.draft, draftRevision: 0 },
          editor.draft,
          editor.draft.blocks[0]?.id,
        ];
        if (slot < values.length) return react.useState(values[slot] as T);
      }
      return react.useState(initial === "build" ? (editor.tab as T) : initial);
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/presentation/presentation-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const workspace = vi.hoisted(() => ({
  creator: { workspaceId: "workspace-1" } as { workspaceId: string } | null,
  error: "",
  canEdit: true,
  productFeatures: {},
  refreshAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../workspace/workspace-provider", () => ({ useWorkspace: () => workspace }));

import { PresentationBuilder } from "./presentation-builder";

describe("Presentation Builder UI", () => {
  beforeEach(() => {
    editor.draft = null;
    editor.nullCursor = 0;
    editor.tab = "build";
    workspace.creator = { workspaceId: "workspace-1" };
    workspace.error = "";
  });

  function opinionMarkup(question: QuestionDraft, tab = "build") {
    const block = createQuestionBlock();
    editor.draft = {
      schemaVersion: 9,
      title: "Opinion authoring",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      blocks: [{ ...block, question }],
    };
    editor.nullCursor = 0;
    editor.tab = tab;
    return renderToStaticMarkup(
      withEnglishLocale(<PresentationBuilder presentationId="presentation-1" />),
    );
  }

  function field(markup: string, label: string) {
    const found = markup.match(
      new RegExp(`<label[^>]*><span[^>]*>${label}</span><select([^>]*)>(.*?)</select>`),
    );
    expect(found, `Missing ${label} select`).not.toBeNull();
    return { attributes: found![1]!, options: found![2]! };
  }

  it.each(["poll", "ranking"] as const)(
    "enables bounded %s authoring without correct-answer controls or live-only warnings",
    (type) => {
      const question = createQuestionBlock(type).question;
      if (!("choices" in question)) throw new Error("Expected opinion choices");
      question.choices = question.choices.slice(0, 2).map((choice, index) => ({
        ...choice,
        label: `Option ${index + 1}`,
      }));
      const markup = opinionMarkup(question);
      const limit = field(markup, type === "poll" ? "Maximum selections" : "Choices to rank");
      expect(limit.attributes).not.toContain("disabled");
      expect(limit.options).toContain('value="1"');
      expect(limit.options).toContain('value="2"');
      expect(limit.options).not.toContain('value="3"');
      expect(field(markup, "Points").attributes).toContain("disabled");
      expect(markup).toContain('<option value="ranking"');
      expect(markup).not.toContain('<option value="open_text"');
      expect(markup).not.toContain('<option value="word_cloud"');
      expect(markup).not.toContain("Mark choice");
      expect(markup).not.toContain("live Rounds only");
      expect(markup).not.toContain("Presentations and practice currently require");
    },
  );

  it.each(["poll", "ranking"] as const)(
    "locks %s purpose, confidence and recovery links to the opinion defaults",
    (type) => {
      const question = createQuestionBlock(type).question;
      const diagnose = opinionMarkup(question, "diagnose");
      expect(field(diagnose, "Purpose").attributes).toContain("disabled");
      expect(field(diagnose, "Purpose").options).toContain('value="opinion" selected=""');
      expect(field(diagnose, "Confidence").attributes).toContain("disabled");
      expect(field(diagnose, "Confidence").options).toContain('value="off" selected=""');
      const recovery = opinionMarkup(question, "recover");
      expect(field(recovery, "Delivery role").attributes).toContain("disabled");
      expect(field(recovery, "Delivery role").options).toContain("Main activity");
      expect(field(recovery, "Paired recheck question").attributes).toContain("disabled");
    },
  );
  it("announces its initial loading state while the draft and local recovery are resolved", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<PresentationBuilder presentationId="presentation-1" />),
    );

    expect(markup).toContain("<main");
    expect(markup).toContain("Opening presentation builder…");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("shows a workspace error and retry instead of an endless opening state", () => {
    workspace.creator = null;
    workspace.error = "The workspace request failed.";
    const markup = renderToStaticMarkup(
      withEnglishLocale(<PresentationBuilder presentationId="presentation-1" />),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(workspace.error);
    expect(markup).toContain("Retry workspace");
    expect(markup).not.toContain("Opening presentation builder");
  });
});
