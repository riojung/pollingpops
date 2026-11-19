import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import { SurveyPageAuthoring } from "./survey-page-authoring";
import type { PagedSurveyDraft } from "../lib/survey-page-authoring";

type Hooks = { cursor: number; slots: unknown[]; effects: Array<() => void> };
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T) => {
          hooks.slots[index] = next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as readonly unknown[] | undefined;
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) {
        hooks.slots[index] = dependencies;
        hooks.effects.push(effect as () => void);
      }
    },
  };
});
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function fixture(): PagedSurveyDraft {
  return SurveyDraftSchema.parse({
    schemaVersion: 3,
    title: "Feedback",
    items: [1, 2].map((value) => ({
      required: true,
      question: {
        id: id(value),
        type: "rating",
        prompt: `Question ${value}`,
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        basePoints: 0,
        timeLimitSeconds: 30,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
        min: 1,
        max: 5,
        minLabel: "Low",
        maxLabel: "High",
      },
    })),
    pages: [
      { id: id(10), title: "First", description: "Notes\nMore notes", questionIds: [id(1)] },
      { id: id(11), title: "Second", description: "", questionIds: [id(2)] },
    ],
  }) as PagedSurveyDraft;
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const focus = vi.fn();
  const props = {
    draft: fixture(),
    locale: "en-CA" as const,
    disabled: false,
    onChange: vi.fn((next: PagedSurveyDraft) => {
      props.draft = next;
    }),
  };
  let tree: ReactNode;
  const view = {
    props,
    focus,
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = SurveyPageAuthoring(props);
      } finally {
        mocked.hooks = null;
      }
      for (const node of nodes(tree))
        if (node.type === "h3") (node.props.ref as { current: unknown }).current = { focus };
      hooks.effects.splice(0).forEach((effect) => effect());
      return renderToStaticMarkup(tree);
    },
    button(label: string) {
      const button = nodes(tree).find(
        (node) => node.type === "button" && text(node.props.children as ReactNode) === label,
      );
      if (!button) throw new Error(`Missing button ${label}`);
      return button.props as { disabled?: boolean; onClick: () => void };
    },
    all() {
      return nodes(tree);
    },
  };
  view.render();
  return view;
}
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("Survey page authoring controls", () => {
  it.each(["", "   \t  "])(
    "uses accessible fallback titles for blank input %j while keeping the raw editor value",
    (rawTitle) => {
      const view = harness();
      view.props.draft = {
        ...view.props.draft,
        pages: view.props.draft.pages.map((page, index) =>
          index === 0 ? { ...page, title: rawTitle } : page,
        ),
      };
      view.render();
      expect(view.button("Page 1")).toMatchObject({ title: "Page 1" });
      const heading = view.all().find((node) => node.type === "h3")!;
      expect(heading.props).toMatchObject({ children: "Page 1", lang: "en-CA" });
      const input = view
        .all()
        .find((node) => node.type === "input" && node.props.maxLength === 160)!;
      expect(input.props.value).toBe(rawTitle);
      expect(view.props.draft.pages[0]!.title).toBe(rawTitle);
      view.button("Preview Survey").onClick();
      expect(view.render()).toContain(">Page 1</h2>");
      expect(view.props.onChange).not.toHaveBeenCalled();
    },
  );
  it("selects pages accessibly, edits title/instructions and scopes questions to the selected page", () => {
    const view = harness();
    expect(view.render()).toContain('aria-label="Survey pages navigation"');
    expect(view.render()).toContain('aria-current="page"');
    expect(view.render()).toContain('data-survey-author-question="' + id(1));
    expect(view.render()).not.toContain('data-survey-author-question="' + id(2));
    view.button("Second").onClick();
    const markup = view.render();
    expect(view.focus).toHaveBeenCalledOnce();
    expect(markup).toContain('data-survey-selected-page="' + id(11));
    const input = view
      .all()
      .find((node) => node.type === "input" && node.props.value === "Second")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: "  Second edited  " } });
    expect(view.props.draft.pages[1]!.title).toBe("  Second edited  ");
    view.render();
    const textarea = view.all().find((node) => node.type === "textarea")!;
    (textarea.props.onChange as (event: unknown) => void)({ target: { value: "Line 1\nLine 2" } });
    expect(view.props.draft.pages[1]!.description).toBe("Line 1\nLine 2");
  });
  it("requires confirmation to remove a nonempty page, preserves questions and selects its destination", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const view = harness();
    const before = structuredClone(view.props.draft);
    view.button("Remove page").onClick();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Second"));
    expect(view.props.onChange).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    view.button("Remove page").onClick();
    expect(view.props.draft.pages).toHaveLength(1);
    expect(view.props.draft.items).toEqual(before.items);
    expect(view.props.draft.pages[0]!.questionIds).toEqual([id(1), id(2)]);
    expect(view.render()).toContain('data-survey-selected-page="' + id(11));
    expect(view.button("Remove page").disabled).toBe(true);
  });
  it("moves a question to another page and removes content only after an explicit confirmed question deletion", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const view = harness();
    const select = view.all().find((node) => node.type === "select")!;
    expect(select.props["aria-label"]).toBe("Move to page: Question 1");
    (select.props.onChange as (event: unknown) => void)({ target: { value: id(11) } });
    expect(view.props.draft.pages[0]!.questionIds).toEqual([]);
    expect(view.props.draft.pages[1]!.questionIds).toEqual([id(2), id(1)]);
    view.button("Second").onClick();
    view.render();
    view.button("Remove question").onClick();
    expect(view.props.draft.items).toHaveLength(2);
    confirm.mockReturnValue(true);
    view.button("Remove question").onClick();
    expect(view.props.draft.items.map((row) => row.question.id)).toEqual([id(1)]);
  });
  it("confirms removal of an empty page too, preserving authored instructions on cancellation", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const view = harness();
    view.props.draft = {
      ...view.props.draft,
      pages: [
        ...view.props.draft.pages,
        {
          id: id(12),
          title: "Empty with valuable instructions",
          description: "Keep these instructions",
          questionIds: [],
        },
      ],
    };
    view.render();
    view.button("Empty with valuable instructions").onClick();
    view.render();
    view.button("Remove page").onClick();
    expect(confirm).toHaveBeenCalledOnce();
    expect(view.props.draft.pages[2]!.description).toBe("Keep these instructions");
    expect(view.props.onChange).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    view.button("Remove page").onClick();
    expect(view.props.draft.pages).toHaveLength(2);
    expect(view.props.draft.items).toHaveLength(2);
  });
  it("previews ordered pages without response writes and keeps page browsing available when disabled", () => {
    const view = harness();
    view.button("Preview Survey").onClick();
    const markup = view.render();
    expect(markup).toContain('data-survey-page="' + id(10));
    expect(markup).toContain("Notes\nMore notes");
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("Submit Survey");
    expect(view.props.onChange).not.toHaveBeenCalled();
    view.button("Edit pages").onClick();
    view.props.disabled = true;
    view.render();
    expect(view.button("Add page").disabled).toBe(true);
    view.button("Add page").onClick();
    expect(view.props.onChange).not.toHaveBeenCalled();
    view.button("Second").onClick();
    expect(view.render()).toContain('data-survey-selected-page="' + id(11));
  });
});
