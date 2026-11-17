import {
  isValidElement,
  type ReactNode,
  type ReactElement,
  type KeyboardEvent,
  type ComponentProps,
} from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { supportedLocales, type QuestionDraft, type SupportedLocale } from "@openround/contracts";
import { availableQuestionTypes, questionOutlineItems } from "./round-navigation-helpers";
import { roundNavigationCopy } from "../../lib/i18n/round-navigation-copy";
import styles from "./round-navigation.module.css";

interface HookSlots {
  cursor: number;
  slots: unknown[];
  effects: (() => void)[];
}
const fixture = vi.hoisted(() => ({
  hooks: null as HookSlots | null,
  locale: "en-CA" as SupportedLocale,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      if (!fixture.hooks) return react.useState(initial);
      const hooks = fixture.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (value: T) => {
          hooks.slots[index] = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!fixture.hooks) return react.useRef(initial);
      const hooks = fixture.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useId: () => (fixture.hooks ? "round-nav-test" : react.useId()),
    useEffect: (effect: () => void) => {
      if (!fixture.hooks) return react.useEffect(effect);
      fixture.hooks.effects.push(effect);
    },
  };
});
vi.mock("../locale-provider", async () => {
  const { translate, loadMessages, localeDomainsForPath } = await import("../../lib/i18n/catalog");
  // Match the editor's route boundary: loading every feature domain hides raw-key regressions.
  const editorDomains = localeDomainsForPath("/quiz/test-round");
  const messages = Object.fromEntries(
    await Promise.all(
      supportedLocales.map(async (locale) => [locale, await loadMessages(locale, editorDomains)]),
    ),
  );
  return {
    useLocale: () => ({
      locale: fixture.locale,
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages[fixture.locale], key, values),
    }),
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/quiz/test-round" }));
import { QuestionNavigator, type QuestionNavigatorProps } from "./question-navigator";
import { BuilderCommandBar } from "./builder-command-bar";

const one: QuestionDraft = {
  id: "one",
  type: "single_select",
  prompt: "AUTHOR QUESTION ONE",
  delivery: "main",
  choices: [
    { id: "a", label: "AUTHOR ANSWER", isCorrect: true },
    { id: "b", label: "Second", isCorrect: false },
  ],
  timeLimitSeconds: 30,
  basePoints: 1000,
  explanation: "",
  mediaId: null,
  mediaAlt: null,
};
const two: QuestionDraft = { ...one, id: "two", prompt: "AUTHOR RECHECK TWO", delivery: "recheck" };
const three: QuestionDraft = { ...one, id: "three", prompt: "AUTHOR QUESTION THREE" };
function props(): QuestionNavigatorProps {
  return {
    draft: { title: "Round", description: "", questions: [one, two, three] },
    insertType: "single_select",
    selectedQuestionId: "two",
    uxBeta: true,
    canReuseQuestions: true,
    issueQuestionIds: new Set(["two"]),
    onAddQuestion: vi.fn(),
    onInsertTypeChange: vi.fn(),
    onSelectQuestion: vi.fn(),
    onMoveQuestion: vi.fn(),
    onDuplicateQuestion: vi.fn(),
    onDeleteQuestion: vi.fn(),
    onOpenQuestionReuse: vi.fn(),
  };
}
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children as ReactNode)];
}
function content(tree: ReactNode): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(content).join("");
  return isValidElement<{ children?: ReactNode }>(tree) ? content(tree.props.children) : "";
}
function harness(overrides: Partial<QuestionNavigatorProps> = {}) {
  fixture.locale = "en-CA";
  const values = { ...props(), ...overrides };
  const hooks: HookSlots = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  const nativeDialog = {
    open: false,
    showModal: vi.fn(() => {
      nativeDialog.open = true;
    }),
    close: vi.fn(() => {
      nativeDialog.open = false;
    }),
  };
  const focusByQuestion = new Map<string, ReturnType<typeof vi.fn>>();
  const render = () => {
    hooks.cursor = 0;
    fixture.hooks = hooks;
    try {
      tree = QuestionNavigator(values);
    } finally {
      fixture.hooks = null;
    }
    for (const node of nodes(tree)) {
      if (node.type === "dialog") (node.props.ref as { current: unknown }).current = nativeDialog;
      if (node.type === "button" && typeof node.props.ref === "function") {
        const id = content(node).includes(two.prompt)
          ? two.id
          : content(node).includes(three.prompt)
            ? three.id
            : one.id;
        const focus = focusByQuestion.get(id) ?? vi.fn();
        focusByQuestion.set(id, focus);
        node.props.ref({ focus });
      }
      if (node.type === "input" && node.props.ref)
        (node.props.ref as { current: unknown }).current = { focus: vi.fn() };
    }
    for (const effect of hooks.effects.splice(0)) effect();
    return tree;
  };
  render();
  return {
    values,
    nativeDialog,
    focusByQuestion,
    render,
    all: () => nodes(tree),
    button: (label: string) =>
      nodes(tree).find(
        (node) =>
          node.type === "button" && (node.props["aria-label"] === label || content(node) === label),
      )!,
    row: (prompt: string) =>
      nodes(tree).find(
        (node) =>
          node.type === "button" &&
          node.props["aria-current"] !== undefined &&
          content(node).includes(prompt),
      )!,
    card: (label: string) =>
      nodes(tree).find(
        (node) =>
          node.type === "button" &&
          nodes(node).some((child) => child.type === "strong" && content(child) === label),
      )!,
    search: () =>
      nodes(tree).find(
        (node) => node.type === "input" && node.props.placeholder === "Search questions",
      )!,
  };
}
function click(node: ReactElement<Record<string, unknown>>, event: unknown = {}) {
  (node.props.onClick as (event: unknown) => void)(event);
}
function key(node: ReactElement<Record<string, unknown>>, value: string, altKey = false) {
  (node.props.onKeyDown as (event: KeyboardEvent<HTMLButtonElement>) => void)({
    key: value,
    altKey,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLButtonElement>);
}

describe("Round question outline", () => {
  it("filters by content, type and readiness without changing order or original numbers", () => {
    const typeLabels = Object.fromEntries(
      availableQuestionTypes({
        rankingPollsEnabled: true,
        openTextPollsEnabled: true,
        wordCloudPollsEnabled: true,
      }).map((type) => [type, type]),
    ) as Parameters<typeof questionOutlineItems>[1]["typeLabels"];
    const options = {
      query: "AUTHOR ANSWER",
      filter: "attention" as const,
      issueQuestionIds: new Set(["two", "three"]),
      typeLabels,
    };
    expect(
      questionOutlineItems([one, two, three], options).map(({ question, index }) => [
        question.id,
        index + 1,
      ]),
    ).toEqual([
      ["two", 2],
      ["three", 3],
    ]);
    expect(
      questionOutlineItems([one, two, three], { ...options, query: "", filter: "recheck" }).map(
        ({ question }) => question.id,
      ),
    ).toEqual(["two"]);
    expect(questionOutlineItems([one, two], { ...options, query: "missing" })).toEqual([]);
    const h = harness();
    (h.search().props.onChange as (event: unknown) => void)({ target: { value: "THREE" } });
    h.render();
    expect(
      h
        .all()
        .filter((node) => node.type === "li")
        .map((node) => node.props.value),
    ).toEqual([3]);
    expect(h.button("Show selected question")).toBeTruthy();
    click(h.button("Show selected question"));
    h.render();
    expect(h.all().filter((node) => node.type === "li")).toHaveLength(3);
  });

  it("has one selected action strip and moves by stable ID with keyboard navigation", () => {
    const h = harness();
    expect(h.all().filter((node) => node.props["aria-label"] === "Duplicate")).toHaveLength(1);
    click(h.button("Duplicate"));
    expect(h.values.onDuplicateQuestion).toHaveBeenCalledWith("two");
    key(h.row(two.prompt), "ArrowDown");
    expect(h.values.onSelectQuestion).toHaveBeenCalledWith("three");
    expect(h.focusByQuestion.get("three")).toHaveBeenCalled();
    key(h.row(two.prompt), "ArrowUp", true);
    expect(h.values.onMoveQuestion).toHaveBeenCalledWith("two", -1);
    h.values.selectedQuestionId = "one";
    h.render();
    expect(h.button("Move earlier").props.disabled).toBe(true);
    key(h.row(one.prompt), "ArrowUp", true);
    expect(h.values.onMoveQuestion).toHaveBeenCalledTimes(1);
  });

  it("opens a labelled native picker and restores the exact Safari pointer trigger", () => {
    const h = harness();
    const trigger = { isConnected: true, matches: vi.fn(() => false), focus: vi.fn() };
    const event = { currentTarget: trigger };
    click(h.button("Add question"), event);
    event.currentTarget = null as unknown as typeof trigger;
    expect(h.nativeDialog.showModal).toHaveBeenCalled();
    const dialog = h.all().find((node) => node.type === "dialog")!;
    expect(
      h
        .all()
        .some(
          (node) =>
            node.props.id === dialog.props["aria-labelledby"] &&
            content(node) === "Choose a question type",
        ),
    ).toBe(true);
    click(h.card("Numeric response"));
    expect(h.values.onInsertTypeChange).toHaveBeenCalledWith("numeric");
    expect(h.values.onAddQuestion).toHaveBeenCalledWith("numeric");
    expect(h.nativeDialog.close).toHaveBeenCalled();
    (dialog.props.onClose as () => void)();
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
    trigger.matches.mockReturnValue(true);
    (dialog.props.onClose as () => void)();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("uses actual rollout gates and limits text cards while keeping other formats available", () => {
    expect(availableQuestionTypes()).toEqual([
      "single_select",
      "true_false",
      "multi_select",
      "numeric",
      "poll",
      "rating",
    ]);
    const text: QuestionDraft = {
      id: "text",
      type: "open_text",
      prompt: "Opinion",
      purpose: "opinion",
      confidence: "off",
      timeLimitSeconds: 60,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const h = harness({
      openTextPollsEnabled: true,
      wordCloudPollsEnabled: true,
      rankingPollsEnabled: true,
      draft: {
        title: "Round",
        description: "",
        questions: Array.from({ length: 10 }, (_, index) => ({ ...text, id: String(index) })),
      },
    });
    expect(h.card("Open text").props.disabled).toBe(true);
    expect(h.card("Word cloud").props.disabled).toBe(true);
    expect(h.card("Ranking").props.disabled).toBe(false);
    expect(h.button("Add question").props.disabled).toBe(false);
    click(h.card("Open text"));
    expect(h.values.onAddQuestion).not.toHaveBeenCalled();
  });

  it("keeps viewer navigation usable and disables mutations including an already open picker", () => {
    const h = harness({ readOnly: true });
    for (const label of [
      "Add question",
      "Duplicate",
      "Delete",
      "Move earlier",
      "Move later",
      "Reuse from your workspace",
    ])
      expect(h.button(label).props.disabled, label).toBe(true);
    expect(h.row(two.prompt).props.disabled).toBeUndefined();
    expect(h.search().props.disabled).toBeUndefined();
    click(h.row(one.prompt));
    expect(h.values.onSelectQuestion).toHaveBeenCalledWith("one");
    key(h.row(two.prompt), "ArrowUp", true);
    expect(h.values.onMoveQuestion).not.toHaveBeenCalled();
    h.nativeDialog.open = true;
    h.render();
    expect(h.nativeDialog.close).toHaveBeenCalled();
    expect(h.all().find((node) => node.type === "fieldset")?.props.disabled).toBe(true);
  });

  it.each(supportedLocales)(
    "localizes chrome while retaining authored material in %s",
    (locale) => {
      fixture.locale = locale;
      const markup = renderToStaticMarkup(<QuestionNavigator {...props()} />);
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain(`<span lang="">${one.prompt}</span>`);
      expect(markup).toContain(`<span lang="">AUTHOR ANSWER</span>`);
      expect(markup).toContain(roundNavigationCopy(locale)("Choose a question type"));
      if (locale !== "en-CA") expect(markup).not.toContain(">Test knowledge<");
    },
  );
});

const commandProps = (): ComponentProps<typeof BuilderCommandBar> => ({
  title: "AUTHOR TITLE",
  saveState: "error",
  canUndo: true,
  canRedo: true,
  previewDisabled: false,
  publishDisabled: false,
  publishLabel: "Publish",
  questionMapOpen: true,
  inspectorOpen: true,
  onTitleChange: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onPreview: vi.fn(),
  onPublish: vi.fn(),
  onToggleQuestionMap: vi.fn(),
  onToggleInspector: vi.fn(),
  onRetrySave: vi.fn(),
  assignHref: "/quiz/test-round/assign",
});

function commandView(
  overrides: Partial<ComponentProps<typeof BuilderCommandBar>> = {},
  locale: SupportedLocale = "en-CA",
) {
  fixture.locale = locale;
  const values = { ...commandProps(), ...overrides };
  fixture.hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReturnType<typeof BuilderCommandBar>;
  try {
    tree = BuilderCommandBar(values);
  } finally {
    fixture.hooks = null;
  }
  const elements = nodes(tree);
  return {
    values,
    elements,
    host: elements.find(
      (node) => typeof node.props.href === "string" && node.props.href === values.hostHref,
    ),
    publish: elements.find(
      (node) => node.type === "button" && content(node) === values.publishLabel,
    )!,
  };
}

describe("Round command hierarchy", () => {
  it("keeps preview available to viewers and disables title/history/publish/save mutations", () => {
    fixture.locale = "en-CA";
    const markup = renderToStaticMarkup(<BuilderCommandBar {...commandProps()} readOnly />);
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*id="quiz-title"/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Publish<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Retry save<\/button>/);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Preview<\/button>/);
    expect(markup).toContain('aria-label="More actions"');
    expect(markup).toContain('lang=""');
  });

  it("keeps Publish primary without a supplied published-version hosting destination", () => {
    const h = commandView({ status: "published", saveState: "saved" });
    expect(h.host).toBeUndefined();
    expect(h.elements.some((node) => content(node) === "Host live")).toBe(false);
    expect(h.publish.props.className).toBe(styles.publishButton);
    click(h.publish);
    expect(h.values.onPublish).toHaveBeenCalledTimes(1);
  });

  it("makes Host live primary and links to the exact published destination without republishing", () => {
    const hostHref = "/host?quiz=test-round&version=published-version";
    const h = commandView({ status: "published", saveState: "saved", hostHref });
    expect(h.host).toBeTruthy();
    expect(h.host!.props.href).toBe(hostHref);
    expect(content(h.host)).toBe("Host live");
    expect(h.host!.props.title).toBe("Uses the published version. Draft changes are excluded.");
    expect(h.host!.props["aria-disabled"]).toBe(false);
    expect(h.host!.props.tabIndex).toBeUndefined();
    expect(h.host!.props.className).toBe(styles.publishButton);
    expect(h.publish.props.className).toBe(styles.previewButton);
    const preventDefault = vi.fn();
    click(h.host!, { preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(h.values.onPublish).not.toHaveBeenCalled();
    click(h.publish);
    expect(h.values.onPublish).toHaveBeenCalledTimes(1);
  });

  it.each(["idle", "saving", "error", "conflict"] as const)(
    "removes hosting from keyboard navigation and prevents activation while save state is %s",
    (saveState) => {
      const h = commandView({ hostHref: "/host?quiz=test-round", saveState });
      expect(h.host!.props["aria-disabled"]).toBe(true);
      expect(h.host!.props.tabIndex).toBe(-1);
      const preventDefault = vi.fn();
      click(h.host!, { preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(h.values.onPublish).not.toHaveBeenCalled();
    },
  );

  it("prevents hosting while a draft mutation is busy and hides hosting for viewers", () => {
    const busy = commandView({
      hostHref: "/host?quiz=test-round",
      saveState: "saved",
      disabled: true,
    });
    expect(busy.host!.props["aria-disabled"]).toBe(true);
    expect(busy.host!.props.tabIndex).toBe(-1);
    const preventDefault = vi.fn();
    click(busy.host!, { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    const viewer = commandView({
      hostHref: "/host?quiz=test-round",
      saveState: "saved",
      readOnly: true,
    });
    expect(viewer.host).toBeUndefined();
    expect(viewer.publish.props.disabled).toBe(true);
  });

  it("shows unpublished draft changes without changing the published hosting destination", () => {
    const clean = commandView({ status: "published", saveState: "saved" });
    expect(clean.elements.some((node) => node.props.className === styles.unpublished)).toBe(false);
    const hostHref = "/host?quiz=test-round&version=published-version";
    const changed = commandView({
      status: "published",
      saveState: "saved",
      hostHref,
      hasUnpublishedChanges: true,
    });
    const badge = changed.elements.find((node) => node.props.className === styles.unpublished);
    expect(content(badge)).toBe("Unpublished changes");
    expect(changed.host!.props.href).toBe(hostHref);
    expect(changed.host!.props["aria-disabled"]).toBe(false);
    expect(changed.host!.props.title).toContain("Draft changes are excluded.");
  });

  it("localizes hosting guidance and unpublished changes while preserving the link", () => {
    const hostHref = "/host?quiz=test-round&version=published-version";
    const h = commandView({ saveState: "saved", hostHref, hasUnpublishedChanges: true }, "ko-KR");
    expect(content(h.host)).toBe("라이브 진행");
    expect(h.host!.props.title).toBe(
      "게시된 버전을 사용합니다. 초안 변경 사항은 포함되지 않습니다.",
    );
    expect(h.host!.props.href).toBe(hostHref);
    expect(content(h.elements.find((node) => node.props.className === styles.unpublished))).toBe(
      "게시되지 않은 변경사항",
    );
  });
});
