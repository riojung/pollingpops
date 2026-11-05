import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import type { PresentationDraft, QuestionDraft } from "@openround/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { createQuestionBlock } from "../../lib/presentation-builder";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { LocaleProvider } from "../locale-provider";
import {
  loadMessages,
  localeDomainsForPath,
  type LocaleDomain,
  type Messages,
} from "../../lib/i18n/catalog";

const editor = vi.hoisted(() => ({
  draft: null as PresentationDraft | null,
  nullCursor: 0,
  tab: "build",
  preview: false,
  previewPending: false,
  previewUsed: false,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (editor.preview && !editor.previewUsed && initial === "idle") editor.previewPending = true;
      if (editor.previewPending && initial === false) {
        editor.previewPending = false;
        editor.previewUsed = true;
        return react.useState(true as T);
      }
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
    editor.preview = false;
    editor.previewPending = false;
    editor.previewUsed = false;
    workspace.creator = { workspaceId: "workspace-1" };
    workspace.error = "";
  });

  function opinionMarkup(
    question: QuestionDraft,
    tab = "build",
    routeLocale?: { domains: LocaleDomain[]; messages: Messages },
  ) {
    const block = createQuestionBlock();
    editor.draft = {
      schemaVersion: question.type === "open_text" || question.type === "word_cloud" ? 10 : 9,
      title: "Opinion authoring",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      blocks: [{ ...block, question }],
    };
    editor.nullCursor = 0;
    editor.tab = tab;
    const builder = <PresentationBuilder presentationId="presentation-1" />;
    return renderToStaticMarkup(
      routeLocale ? (
        <LocaleProvider
          initialLocale="en-CA"
          initialDomains={routeLocale.domains}
          initialMessages={routeLocale.messages}
        >
          {builder}
        </LocaleProvider>
      ) : (
        withEnglishLocale(builder)
      ),
    );
  }

  function field(markup: string, label: string) {
    const found = markup.match(
      new RegExp(`<label[^>]*><span[^>]*>${label}</span><select([^>]*)>(.*?)</select>`),
    );
    expect(found, `Missing ${label} select`).not.toBeNull();
    return { attributes: found![1]!, options: found![2]! };
  }

  it.each([true, false])(
    "retains the imported %s visual/reading distinction after modal closure",
    (visual) => {
      const block = createNativeContentBlock();
      block.sourceDisclosure = {
        sourceName: "Exported slides.pdf",
        sourceDigest: "a".repeat(64),
        provider: "Polling Pops",
        model: "visual-import-v1",
      };
      if (visual)
        block.scene!.nodes.push({
          id: "page-image",
          type: "image",
          mediaId: "page-media",
          altText: "A reviewed chart",
          frame: { x: 0, y: 20, width: 100, height: 80 },
        });
      editor.draft = {
        schemaVersion: 7,
        title: "Imported pages",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        blocks: [block],
      };
      editor.nullCursor = 0;
      const markup = renderToStaticMarkup(
        withEnglishLocale(<PresentationBuilder presentationId="presentation-1" />),
      );
      expect(markup).toContain(visual ? "Imported visual slide" : "Imported reading slide");
      expect(markup).toContain(
        visual
          ? "Source objects, animation and media are flattened"
          : "Author-reviewed accessible text is editable",
      );
      expect(markup).not.toContain(visual ? "Imported reading slide" : "Imported visual slide");
    },
  );

  it.each(["open_text", "word_cloud"] as const)(
    "renders a disabled localized %s preview using only the actual builder route domains",
    async (type) => {
      const domains = localeDomainsForPath("/presentation/presentation-1");
      const messages = await loadMessages("en-CA", domains);
      editor.preview = true;
      const markup = opinionMarkup(createQuestionBlock(type).question, "build", {
        domains,
        messages,
      });
      expect(markup).toContain('aria-label="Presentation preview"');
      expect(markup).toContain(type === "open_text" ? "Your response" : "A word or short phrase");
      expect(markup).toContain(`0 of ${type === "open_text" ? 1000 : 80} characters`);
      expect(markup).toContain("Only approved responses can appear publicly after reveal");
      expect(markup).not.toContain("live.text.");
      expect(markup).toMatch(
        type === "open_text" ? /<textarea[^>]*disabled=""/ : /<input[^>]*disabled=""/,
      );
    },
  );

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
      expect(markup).toContain('<option value="open_text"');
      expect(markup).toContain('<option value="word_cloud"');
      expect(markup).not.toContain("Mark choice");
      expect(markup).not.toContain("live Rounds only");
      expect(markup).not.toContain("Presentations and practice currently require");
    },
  );

  it.each(["poll", "ranking", "open_text", "word_cloud"] as const)(
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
  it.each(["open_text", "word_cloud"] as const)(
    "shows the fixed %s limit and unscored authoring guidance without answer controls",
    (type) => {
      const markup = opinionMarkup(createQuestionBlock(type).question);
      expect(markup).toContain(`plain text up to ${type === "open_text" ? 1000 : 80} characters`);
      expect(markup).toContain("Responses wait for facilitator approval");
      expect(field(markup, "Points").attributes).toContain("disabled");
      expect(markup).not.toContain("Mark choice");
      expect(markup).not.toContain("live Rounds only");
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
