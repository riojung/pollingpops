import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  buildPresentationQuestionSuggestionBlock,
  presentationQuestionSuggestionInsertedBlockHash,
  presentationQuestionSuggestionsProposalHash,
  presentationQuestionSuggestionsSourceDigest,
  supportedLocales,
  type PresentationQuestionSuggestionsProposal,
  type SupportedLocale,
} from "@openround/contracts";
import type * as ApiModule from "../../lib/api";
import { AUTH_CHANGE_EVENT, ApiClientError } from "../../lib/api";
import type { QuestionSuggestionsRecovery } from "../../lib/presentation-question-suggestions-client";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
interface Slot {
  value?: unknown;
  deps?: readonly unknown[];
  cleanup?: void | (() => void);
}
interface Hooks {
  cursor: number;
  slots: Slot[];
  effects: Array<() => void>;
  dirty: boolean;
}
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null, request: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: fixture.request,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
      return [
        hooks.slots[index]!.value as T,
        (next: T | ((value: T) => T)) => {
          const before = hooks.slots[index]!.value as T;
          const value = typeof next === "function" ? (next as (value: T) => T)(before) : next;
          if (!Object.is(before, value)) hooks.dirty = true;
          hooks.slots[index]!.value = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: { current: initial } };
      return hooks.slots[index]!.value;
    },
    useId: () => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useId();
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: `suggestions-${index}` };
      return hooks.slots[index]!.value;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++,
        previous = hooks.slots[index];
      if (
        deps &&
        previous?.deps &&
        deps.length === previous.deps.length &&
        deps.every((value, offset) => Object.is(value, previous.deps![offset]))
      )
        return;
      hooks.slots[index] = { deps };
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index]!.cleanup = effect();
      });
    },
  };
});
import {
  PresentationQuestionSuggestions,
  QuestionSuggestionsProposalReview,
  QuestionSuggestionsSourceReview,
} from "./presentation-question-suggestions";
import { questionSuggestionsCopy, questionSuggestionsFeedback } from "./question-suggestions-copy";
const id = (n: number) => `aabbccdd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = {
  blockId: id(2),
  title: { nodeId: "Title:Exact", text: "Préparer le lancement", lang: "fr" as const },
  body: [
    {
      nodeId: "Body:Exact",
      text: "Clarifier le périmètre\nChoisir une équipe",
      lang: "fr" as const,
      paragraphs: [
        { kind: "bullet" as const, text: "Clarifier le périmètre" },
        { kind: "bullet" as const, text: "Choisir une équipe" },
      ],
    },
  ],
  readingOrder: ["Title:Exact", "Body:Exact"],
};
const proposal: PresentationQuestionSuggestionsProposal = {
  schemaVersion: 1,
  blockId: source.blockId,
  source,
  sourceDigest: presentationQuestionSuggestionsSourceDigest(source),
  outputLanguage: "en",
  provider: "fixture-provider",
  model: "fixture-model",
  generatedAt: "2026-11-07T12:00:00.000Z",
  reviewWarning: PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  suggestions: [
    {
      id: id(31),
      kind: "discussion",
      type: "open_text",
      prompt: "How could clarifying scope help your launch team?",
      citations: [{ locator: "body 1 paragraph 1", excerpt: "Clarifier le périmètre" }],
    },
    {
      id: id(32),
      kind: "reflection",
      type: "open_text",
      prompt: "What would you consider when choosing a launch team?",
      citations: [{ locator: "body 1 paragraph 2", excerpt: "Choisir une équipe" }],
    },
  ],
};
const storageKey = `presentation-question-suggestions:v1:actor:workspace:${id(1)}`;
const sourceBlock = createNativeContentBlock();
sourceBlock.id = source.blockId;
sourceBlock.scene!.schemaVersion = 7;
sourceBlock.scene!.nodes = [
  {
    id: source.title.nodeId,
    type: "text",
    role: "title",
    text: source.title.text,
    lang: source.title.lang,
    frame: { x: 5, y: 5, width: 90, height: 15 },
  },
  {
    id: source.body[0]!.nodeId,
    type: "text",
    role: "body",
    text: source.body[0]!.text,
    lang: source.body[0]!.lang,
    richText: {
      paragraphs: source.body[0]!.paragraphs.map((paragraph) => ({
        kind: paragraph.kind,
        runs: [{ text: paragraph.text }],
      })),
    },
    frame: { x: 5, y: 25, width: 90, height: 65 },
  },
];
sourceBlock.scene!.readingOrder = [...source.readingOrder];
function elements(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}
class FocusTarget {
  isConnected = true;
  focus = vi.fn();
  closest = vi.fn(() => null);
  matches = vi.fn(() => false);
}
let storage: Map<string, string>;
let tab: EventTarget & {
  sessionStorage: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};
let trigger: FocusTarget;
let currentJob: string | null;
let allowance = {
  enabled: true,
  monthlyLimit: 10,
  used: 0,
  remaining: 10,
  active: 0,
  maxActiveJobs: 2,
};
beforeEach(() => {
  storage = new Map();
  currentJob = null;
  allowance = {
    enabled: true,
    monthlyLimit: 10,
    used: 0,
    remaining: 10,
    active: 0,
    maxActiveJobs: 2,
  };
  trigger = new FocusTarget();
  tab = Object.assign(new EventTarget(), {
    sessionStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    },
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("window", tab);
  vi.stubGlobal("HTMLElement", FocusTarget);
  vi.stubGlobal("document", { activeElement: trigger, querySelector: vi.fn(() => trigger) });
  fixture.request.mockReset();
  fixture.request.mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (path.includes("/status?")) return { status: allowance };
    if (path.endsWith("/jobs")) {
      currentJob = JSON.parse(String(init.body)).requestId;
      return { job: readyJob() };
    }
    if (path.includes("/jobs/")) {
      if (!currentJob) throw new ApiClientError("Missing", "NOT_FOUND", 404);
      return { job: readyJob() };
    }
    if (path.endsWith("/question-suggestions/insert")) {
      const input = JSON.parse(String(init.body));
      const block = buildPresentationQuestionSuggestionBlock({
        proposal,
        jobId: input.jobId,
        suggestionId: input.suggestionId,
        mutationId: input.mutationId,
      });
      return {
        presentation: {
          id: id(1),
          draftRevision: input.expectedRevision + 1,
          draft: {
            schemaVersion: 16,
            title: "Deck",
            description: "",
            experiencePreset: { id: "focus", version: 1 },
            sections: [],
            blocks: [structuredClone(sourceBlock), block],
          },
        },
        insertedBlockId: block.id,
        insertedQuestionId: block.question.id,
        jobId: input.jobId,
        proposalHash: input.proposalHash,
        suggestionId: input.suggestionId,
        sourceDigest: input.sourceDigest,
        sourceBlockId: input.blockId,
      };
    }
    throw new Error("Unexpected request");
  });
});
function readyJob() {
  return {
    schemaVersion: 1,
    id: currentJob,
    requestId: currentJob,
    presentationId: id(1),
    blockId: source.blockId,
    sourceRevision: 4,
    sourceDigest: proposal.sourceDigest,
    outputLanguage: "en",
    status: "ready",
    attempts: 1,
    proposal,
    proposalHash: presentationQuestionSuggestionsProposalHash(proposal),
    error: null,
    createdAt: proposal.generatedAt,
    updatedAt: proposal.generatedAt,
    expiresAt: "2026-11-08T12:00:00.000Z",
  };
}
function validRecovery(insert = false): QuestionSuggestionsRecovery {
  const jobId = id(90),
    mutationId = id(91),
    suggestionId = id(31);
  const createBody = JSON.stringify({
    schemaVersion: 1,
    requestId: jobId,
    presentationId: id(1),
    blockId: source.blockId,
    expectedRevision: 4,
    sourceDigest: proposal.sourceDigest,
    outputLanguage: "en",
  });
  return {
    schemaVersion: 1,
    actorKey: "actor:workspace",
    presentationId: id(1),
    blockId: source.blockId,
    sourceDigest: proposal.sourceDigest,
    sourceRevision: 4,
    expectedRevision: 4,
    jobId,
    createBody,
    createUncertain: false,
    suggestionId,
    insertBody: insert
      ? JSON.stringify({
          schemaVersion: 1,
          jobId,
          proposalHash: presentationQuestionSuggestionsProposalHash(proposal),
          blockId: source.blockId,
          sourceDigest: proposal.sourceDigest,
          suggestionId,
          reviewed: true,
          expectedRevision: 4,
          mutationId,
        })
      : null,
    insertProjectionHash: insert
      ? presentationQuestionSuggestionInsertedBlockHash(
          buildPresentationQuestionSuggestionBlock({ proposal, jobId, suggestionId, mutationId }),
        )
      : null,
  };
}
function harness(open = true, locale?: SupportedLocale) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], dirty: true };
  const props: ComponentProps<typeof PresentationQuestionSuggestions> = {
    presentationId: id(1),
    locale,
    actorKey: "actor:workspace",
    canEdit: true,
    open,
    target: {
      blockId: source.blockId.toUpperCase(),
      expectedRevision: 4,
      source,
      sourceDigest: proposal.sourceDigest,
    },
    onInserted: vi.fn(async () => undefined),
    onReloadTarget: vi.fn(async () => ({
      blockId: source.blockId,
      expectedRevision: 5,
      source,
      sourceDigest: proposal.sourceDigest,
    })),
    onReloadForInvalidRecovery: vi.fn(async () => undefined),
    onClose: vi.fn(() => {
      props.open = false;
      hooks.dirty = true;
    }),
    onPendingChange: vi.fn(),
    onRecoveryChange: vi.fn(),
  };
  const native = {
    open: false,
    showModal: vi.fn(() => {
      native.open = true;
    }),
    close: vi.fn(() => {
      native.open = false;
    }),
  };
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    hooks.dirty = false;
    fixture.hooks = hooks;
    try {
      tree = PresentationQuestionSuggestions(props);
    } finally {
      fixture.hooks = null;
    }
    const dialog = elements(tree).find((node) => node.type === "dialog");
    if (dialog) (dialog.props.ref as { current: unknown }).current = native;
    for (const effect of hooks.effects.splice(0)) effect();
  };
  const flush = () => {
    for (let index = 0; index < 20; index++) if (hooks.dirty) render();
  };
  const settle = async () => {
    for (let index = 0; index < 40; index++) {
      await Promise.resolve();
      flush();
    }
  };
  const button = (label: string) => {
    const node = elements(tree).find(
      (node) => node.type === "button" && node.props.children === label,
    );
    if (!node) throw new Error(`Missing ${label}`);
    return node;
  };
  render();
  flush();
  return {
    props,
    native,
    render,
    flush,
    settle,
    button,
    get nodes() {
      return elements(tree);
    },
    get dialog() {
      return elements(tree).find((node) => node.type === "dialog");
    },
    get review() {
      return elements(tree).find((node) => node.type === QuestionSuggestionsProposalReview);
    },
    async click(label: string) {
      (button(label).props.onClick as () => void)();
      await settle();
    },
    acknowledgeInvalid() {
      const check = elements(tree).find(
        (node) => node.type === "input" && node.props.type === "checkbox",
      )!;
      (check.props.onChange as (event: unknown) => void)({ target: { checked: true } });
      flush();
    },
    async reviewAndChoose(suggestionId = id(31)) {
      const review = elements(tree).find(
        (node) => node.type === QuestionSuggestionsProposalReview,
      )!;
      (review.props.onSelect as (id: string) => void)(suggestionId);
      flush();
      const next = elements(tree).find((node) => node.type === QuestionSuggestionsProposalReview)!;
      (next.props.onReview as (checked: boolean) => void)(true);
      await settle();
    },
    unmount() {
      for (const slot of hooks.slots) slot.cleanup?.();
    },
  };
}
afterEach(() => {
  fixture.hooks = null;
  vi.unstubAllGlobals();
});

describe("optional discussion suggestion review", () => {
  it.each(supportedLocales)(
    "renders selected %s UI without changing the English generation or review intent",
    async (locale) => {
      const t = questionSuggestionsCopy(locale);
      const h = harness(true, locale);
      await h.settle();
      expect(h.dialog?.props.lang).toBe(locale);
      expect(h.button(t("Generate discussion suggestions")).props.disabled).toBe(false);
      expect(
        h.nodes.find((node) => node.type === QuestionSuggestionsSourceReview)?.props.locale,
      ).toBe(locale);
      await h.click(t("Generate discussion suggestions"));
      const create = fixture.request.mock.calls.find(
        (call) => String(call[0]).endsWith("/jobs") && call[1]?.method === "POST",
      )!;
      expect(JSON.parse(String(create[1].body))).toMatchObject({
        outputLanguage: "en",
        sourceDigest: proposal.sourceDigest,
        expectedRevision: 4,
      });
      expect(String(create[1].body)).not.toContain("locale");
      expect(h.review?.props.locale).toBe(locale);
      expect(h.button(t("Insert reviewed question")).props.disabled).toBe(true);
      await h.reviewAndChoose(id(32));
      const retained = storage.get(storageKey);
      const calls = fixture.request.mock.calls.length;
      h.props.locale = locale === "en-CA" ? "ko-KR" : "en-CA";
      h.render();
      await h.settle();
      expect(storage.get(storageKey)).toBe(retained);
      expect(fixture.request).toHaveBeenCalledTimes(calls);
      expect(h.review?.props.reviewed).toBe(true);
      expect(h.review?.props.suggestionId).toBe(id(32));
      expect(
        h.button(questionSuggestionsCopy(h.props.locale)("Insert reviewed question")).props
          .disabled,
      ).toBe(false);
      expect(h.native.showModal).toHaveBeenCalledOnce();
      h.unmount();
    },
  );

  it("keeps a pending generation and exact saved request through a locale change", async () => {
    const h = harness(true, "ko-KR");
    await h.settle();
    const ordinary = fixture.request.getMockImplementation()!;
    let finish: () => void = () => undefined;
    fixture.request.mockImplementation(async (path: string, init: RequestInit = {}) => {
      if (path.endsWith("/jobs") && init.method === "POST") {
        currentJob = JSON.parse(String(init.body)).requestId;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { job: readyJob() };
      }
      return ordinary(path, init);
    });
    (
      h.button(questionSuggestionsCopy("ko-KR")("Generate discussion suggestions")).props
        .onClick as () => void
    )();
    await h.settle();
    const retained = storage.get(storageKey)!;
    expect(JSON.parse(retained).createUncertain).toBe(true);
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    h.props.locale = "de-DE";
    h.render();
    await h.settle();
    expect(storage.get(storageKey)).toBe(retained);
    expect(h.button(questionSuggestionsCopy("de-DE")("Recover saved request")).props.disabled).toBe(
      true,
    );
    finish();
    await h.settle();
    expect(h.review?.props.locale).toBe("de-DE");
    expect(h.review?.props.reviewed).toBe(false);
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(false);
    expect(
      fixture.request.mock.calls.filter(
        (call) => String(call[0]).endsWith("/jobs") && call[1]?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(JSON.parse(storage.get(storageKey)!).createBody).toBe(JSON.parse(retained).createBody);
    h.unmount();
  });

  it("localizes retained insertion feedback and retries identical bytes after switching locale", async () => {
    const h = harness(true, "ko-KR");
    const failure = "The exact saved source could not be loaded. Your review is retained.";
    (h.props.onInserted as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(failure));
    await h.settle();
    await h.click(questionSuggestionsCopy("ko-KR")("Generate discussion suggestions"));
    await h.reviewAndChoose(id(32));
    await h.click(questionSuggestionsCopy("ko-KR")("Insert reviewed question"));
    expect(h.nodes.find((node) => node.props.role === "alert")?.props).toMatchObject({
      lang: "ko-KR",
      children: questionSuggestionsFeedback("ko-KR", failure).text,
    });
    const retained = storage.get(storageKey)!;
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    h.props.locale = "de-DE";
    h.render();
    await h.settle();
    expect(storage.get(storageKey)).toBe(retained);
    expect(h.nodes.find((node) => node.props.role === "alert")?.props).toMatchObject({
      lang: "de-DE",
      children: questionSuggestionsFeedback("de-DE", failure).text,
    });
    await h.click(questionSuggestionsCopy("de-DE")("Retry exact insertion"));
    const inserts = fixture.request.mock.calls.filter((call) =>
      String(call[0]).endsWith("/question-suggestions/insert"),
    );
    expect(inserts.map((call) => call[1].body)).toEqual([
      JSON.parse(retained).insertBody,
      JSON.parse(retained).insertBody,
    ]);
    expect(h.props.onInserted).toHaveBeenCalledTimes(2);
    expect(storage.has(storageKey)).toBe(false);
    h.unmount();
  });

  it("keeps invalid recovery acknowledgement, locks and English unknown diagnostics through locale changes", async () => {
    storage.set(storageKey, "{malformed");
    const h = harness(true, "ko-KR");
    await h.settle();
    h.acknowledgeInvalid();
    expect(h.nodes.find((node) => node.props.role === "alert")?.props.lang).toBe("en-CA");
    h.props.locale = "de-DE";
    h.render();
    await h.settle();
    expect(
      h.nodes.find((node) => node.type === "input" && node.props.type === "checkbox")?.props
        .checked,
    ).toBe(true);
    expect(
      h.button(questionSuggestionsCopy("de-DE")("Reload saved deck and clear invalid recovery"))
        .props.disabled,
    ).toBe(false);
    expect(storage.get(storageKey)).toBe("{malformed");
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    await h.click(questionSuggestionsCopy("de-DE")("Reload saved deck and clear invalid recovery"));
    expect(h.props.onReloadForInvalidRecovery).toHaveBeenCalledOnce();
    expect(storage.has(storageKey)).toBe(false);
    h.unmount();
  });

  it("preserves the permission fence when locale changes during a private review", async () => {
    const h = harness(true, "ko-KR");
    await h.settle();
    await h.click(questionSuggestionsCopy("ko-KR")("Generate discussion suggestions"));
    const retained = storage.get(storageKey);
    h.props.canEdit = false;
    h.props.locale = "de-DE";
    h.render();
    await h.settle();
    const calls = fixture.request.mock.calls.length;
    expect(h.review).toBeUndefined();
    expect(h.nodes.some((node) => node.type === QuestionSuggestionsSourceReview)).toBe(false);
    expect(JSON.stringify(h.nodes)).toContain(
      questionSuggestionsCopy("de-DE")("Editor permission is required."),
    );
    h.props.canEdit = true;
    h.props.locale = "ko-KR";
    h.render();
    await h.settle();
    expect(h.review).toBeUndefined();
    expect(storage.get(storageKey)).toBe(retained);
    expect(fixture.request).toHaveBeenCalledTimes(calls);
    expect(h.props.onInserted).not.toHaveBeenCalled();
    h.unmount();
  });

  it.each(supportedLocales)(
    "preserves complete English prompts, French source, raw citations and provenance under %s review",
    (locale) => {
      const before = JSON.stringify(proposal);
      const markup = renderToStaticMarkup(
        <QuestionSuggestionsProposalReview
          proposal={proposal}
          suggestionId={id(31)}
          reviewed={false}
          disabled={false}
          onSelect={vi.fn()}
          onReview={vi.fn()}
          locale={locale}
        />,
      );
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain(questionSuggestionsCopy(locale)("Review both questions"));
      expect(markup).toContain(
        questionSuggestionsCopy(locale)(PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING),
      );
      for (const suggestion of proposal.suggestions) {
        expect(markup).toContain(suggestion.prompt);
        for (const citation of suggestion.citations) {
          expect(markup).toContain(`<strong lang="en-CA">${citation.locator}</strong>`);
          expect(markup).toContain(`<blockquote lang="fr">${citation.excerpt}</blockquote>`);
        }
      }
      expect(markup).toContain('lang="en"');
      expect(markup).toContain('lang="">fixture-provider / fixture-model</span>');
      expect(markup).toContain(`dateTime="${proposal.generatedAt}"`);
      expect(markup).toContain(proposal.source.title.text);
      expect(markup).toContain(proposal.source.body[0]!.text);
      expect(JSON.stringify(proposal)).toBe(before);
    },
  );

  it("does not translate authored source or generated prompt strings that equal known UI copy", () => {
    const authored = structuredClone(proposal);
    authored.source.title.text = "Close";
    authored.source.title.lang = null;
    authored.source.body[0]!.text = "Private source context";
    authored.source.body[0]!.lang = null;
    authored.suggestions[0]!.prompt = "Discussion question";
    authored.suggestions[0]!.citations[0]!.excerpt = "Private source context";
    const markup = renderToStaticMarkup(
      <QuestionSuggestionsProposalReview
        proposal={authored}
        suggestionId={null}
        reviewed={false}
        disabled={false}
        onSelect={vi.fn()}
        onReview={vi.fn()}
        locale="ko-KR"
      />,
    );
    expect(markup).toContain('lang="en">Discussion question</p>');
    expect(markup).toContain('lang="">Close</p>');
    expect(markup).toContain('<blockquote lang="">Private source context</blockquote>');
  });
  it("opens native modal and checks availability without auto-generating", async () => {
    const h = harness();
    await h.settle();
    expect(h.native.showModal).toHaveBeenCalledOnce();
    expect(h.dialog?.props.open).toBeUndefined();
    expect(h.dialog?.props["aria-modal"]).toBe("true");
    expect(h.button("Generate discussion suggestions").props.disabled).toBe(false);
    expect(fixture.request.mock.calls.every((call) => String(call[0]).includes("/status?"))).toBe(
      true,
    );
    expect(JSON.stringify(h.nodes)).toContain("One generation uses one AI job");
    expect(JSON.stringify(h.nodes)).toContain(
      "Free question starters and manual questions remain available",
    );
    h.unmount();
  });
  it("requires complete review and inserts just the selected question", async () => {
    const h = harness();
    await h.settle();
    await h.click("Generate discussion suggestions");
    expect(h.button("Insert reviewed question").props.disabled).toBe(true);
    await h.reviewAndChoose(id(32));
    expect(h.button("Insert reviewed question").props.disabled).toBe(false);
    await h.click("Insert reviewed question");
    expect(h.props.onInserted).toHaveBeenCalledOnce();
    expect((h.props.onInserted as ReturnType<typeof vi.fn>).mock.calls[0]![0].suggestionId).toBe(
      id(32),
    );
    expect(h.dialog).toBeUndefined();
    expect(h.native.close).toHaveBeenCalledOnce();
    h.unmount();
  });
  it("allows insertion of a ready proposal when new generation is disabled or quota is exhausted", async () => {
    const h = harness();
    await h.settle();
    await h.click("Generate discussion suggestions");
    allowance = { ...allowance, enabled: false, remaining: 0 };
    await h.click("Retry availability");
    await h.reviewAndChoose();
    expect(h.button("Insert reviewed question").props.disabled).toBe(false);
    await h.click("Insert reviewed question");
    expect(h.props.onInserted).toHaveBeenCalledOnce();
    h.unmount();
  });
  it("allows safe discard and manual editing after fresh generation preflight fails", async () => {
    const h = harness();
    await h.settle();
    allowance = { ...allowance, remaining: 0 };
    await h.click("Generate discussion suggestions");
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(false);
    expect(h.button("Discard proposal").props.disabled).toBe(false);
    expect(fixture.request.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
    await h.click("Discard proposal");
    expect(storage.has(storageKey)).toBe(false);
    expect(h.props.onClose).toHaveBeenCalledOnce();
    h.unmount();
  });
  it("blocks competing actions and keeps the parent locked when a source reload outlives the modal", async () => {
    const h = harness();
    await h.settle();
    await h.click("Generate discussion suggestions");
    await h.reviewAndChoose();
    const staleInsert = h.button("Insert reviewed question").props.onClick as () => void;
    let finish: (target: NonNullable<typeof h.props.target>) => void = () => undefined;
    h.props.onReloadTarget = vi.fn(
      () =>
        new Promise<NonNullable<typeof h.props.target>>((resolve) => {
          finish = resolve;
        }),
    );
    (h.button("Reload exact source").props.onClick as () => void)();
    await h.settle();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    expect(h.button("Insert reviewed question").props.disabled).toBe(true);
    staleInsert();
    await h.settle();
    expect(
      fixture.request.mock.calls.some((call) =>
        String(call[0]).endsWith("/question-suggestions/insert"),
      ),
    ).toBe(false);
    await h.click("Close review");
    expect(h.dialog).toBeUndefined();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    finish({ ...h.props.target!, expectedRevision: 5 });
    await h.settle();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(false);
    expect(h.props.onInserted).not.toHaveBeenCalled();
    h.unmount();
  });
  it("retains receipt and modal if parent latest-draft adoption fails", async () => {
    const h = harness();
    (h.props.onInserted as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Fresh reload failed"),
    );
    await h.settle();
    await h.click("Generate discussion suggestions");
    await h.reviewAndChoose();
    await h.click("Insert reviewed question");
    expect(h.dialog).toBeDefined();
    expect(h.button("Retry exact insertion").props.disabled).toBe(false);
    expect(h.props.onClose).not.toHaveBeenCalled();
    const body = JSON.parse(storage.get(storageKey)!).insertBody;
    await h.click("Retry exact insertion");
    const inserts = fixture.request.mock.calls.filter((call) =>
      String(call[0]).endsWith("/question-suggestions/insert"),
    );
    expect(inserts.map((call) => call[1].body)).toEqual([body, body]);
    expect(h.dialog).toBeUndefined();
    h.unmount();
  });
  it("keeps known recovery closed until explicit Resume/Recover and never auto-generates on remount", async () => {
    const saved = validRecovery();
    storage.set(storageKey, JSON.stringify(saved));
    currentJob = saved.jobId;
    const h = harness(false);
    await h.settle();
    expect(fixture.request).not.toHaveBeenCalled();
    expect(h.props.onRecoveryChange).toHaveBeenLastCalledWith(true);
    expect(h.native.showModal).not.toHaveBeenCalled();
    h.props.open = true;
    h.render();
    await h.settle();
    expect(fixture.request.mock.calls).toHaveLength(1);
    expect(h.review).toBeUndefined();
    await h.click("Recover saved request");
    expect(h.review).toBeDefined();
    expect(fixture.request.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
    h.unmount();
  });
  it("passes the recovered reviewed revision floor into every exact-source reload", async () => {
    const saved = { ...validRecovery(), expectedRevision: 7 };
    storage.set(storageKey, JSON.stringify(saved));
    const h = harness();
    await h.settle();
    expect(h.props.target!.expectedRevision).toBe(4);
    h.props.onReloadTarget = vi.fn(async () => ({ ...h.props.target!, expectedRevision: 8 }));
    await h.click("Reload exact source");
    expect(h.props.onReloadTarget).toHaveBeenNthCalledWith(1, {
      blockId: saved.blockId,
      sourceDigest: saved.sourceDigest,
      expectedRevision: 7,
    });
    expect(JSON.parse(storage.get(storageKey)!).expectedRevision).toBe(8);
    await h.click("Reload exact source");
    expect(h.props.onReloadTarget).toHaveBeenNthCalledWith(2, {
      blockId: saved.blockId,
      sourceDigest: saved.sourceDigest,
      expectedRevision: 8,
    });
    h.unmount();
  });
  it("fences a changed source language and requires explicit same-source reload/review", async () => {
    const h = harness();
    await h.settle();
    await h.click("Generate discussion suggestions");
    await h.reviewAndChoose();
    const changed = structuredClone(h.props.target!);
    changed.source.body[0]!.lang = "de";
    changed.sourceDigest = presentationQuestionSuggestionsSourceDigest(changed.source);
    changed.expectedRevision = 5;
    h.props.target = changed;
    h.render();
    await h.settle();
    expect(h.button("Insert reviewed question").props.disabled).toBe(true);
    expect(
      h.nodes.some(
        (node) =>
          node.props.role === "status" &&
          node.props.children ===
            "The source changed. Discard this proposal, then generate suggestions from the current saved slide.",
      ),
    ).toBe(true);
    (h.props.onReloadTarget as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Exact source changed"),
    );
    await h.click("Reload exact source");
    expect(h.props.onInserted).not.toHaveBeenCalled();
    expect(h.review).toBeDefined();
    h.unmount();
  });
  it("explains that a recovered proposal needs its exact source reloaded before insertion", async () => {
    const saved = validRecovery();
    storage.set(storageKey, JSON.stringify(saved));
    currentJob = saved.jobId;
    const h = harness();
    h.props.target = null;
    h.render();
    await h.settle();
    await h.click("Recover saved request");
    expect(h.button("Insert reviewed question").props.disabled).toBe(true);
    expect(
      h.nodes.some(
        (node) =>
          node.props.role === "status" &&
          node.props.children === "Reload exact source before inserting this proposal.",
      ),
    ).toBe(true);
    h.unmount();
  });
  it("requests source reload and renewed review for an unrelated saved revision change", async () => {
    const h = harness();
    await h.settle();
    await h.click("Generate discussion suggestions");
    await h.reviewAndChoose();
    h.props.target = { ...h.props.target!, expectedRevision: 5 };
    h.render();
    await h.settle();
    expect(h.button("Insert reviewed question").props.disabled).toBe(true);
    expect(
      h.nodes.some(
        (node) =>
          node.props.role === "status" &&
          node.props.children ===
            "The saved deck revision changed. Reload exact source and review both questions again before inserting.",
      ),
    ).toBe(true);
    expect(
      h.nodes.some(
        (node) =>
          node.props.role === "status" &&
          String(node.props.children).startsWith("The source changed."),
      ),
    ).toBe(false);
    await h.click("Reload exact source");
    expect(h.review!.props.reviewed).toBe(false);
    expect(h.button("Insert reviewed question").props.disabled).toBe(true);
    await h.reviewAndChoose();
    expect(h.button("Insert reviewed question").props.disabled).toBe(false);
    h.unmount();
  });
  it("handles Escape and restores focus without inserting or discarding retained proposals", async () => {
    const h = harness();
    await h.settle();
    await h.click("Generate discussion suggestions");
    const retained = storage.get(storageKey);
    const event = { preventDefault: vi.fn() };
    (h.dialog!.props.onCancel as (event: unknown) => void)(event);
    h.flush();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.props.onInserted).not.toHaveBeenCalled();
    expect(storage.get(storageKey)).toBe(retained);
    expect(trigger.focus).toHaveBeenCalledOnce();
    h.unmount();
  });
  it.each(["body", "documentElement"] as const)(
    "returns to the visible resume control when reopening leaves %s as the focus sentinel",
    async (sentinel) => {
      const body = new FocusTarget();
      const documentElement = new FocusTarget();
      const roots = { body, documentElement };
      const querySelector = vi.fn(() => trigger);
      vi.stubGlobal("document", { ...roots, activeElement: roots[sentinel], querySelector });
      const h = harness();
      await h.settle();
      await h.click("Generate discussion suggestions");
      const retained = storage.get(storageKey);
      await h.click("Close");
      expect(h.props.onInserted).not.toHaveBeenCalled();
      expect(storage.get(storageKey)).toBe(retained);
      expect(querySelector).toHaveBeenCalledWith(
        "[data-question-suggestions-resume], [data-question-suggestions-trigger]",
      );
      expect(trigger.focus).toHaveBeenCalledOnce();
      expect(body.focus).not.toHaveBeenCalled();
      expect(documentElement.focus).not.toHaveBeenCalled();
      h.unmount();
    },
  );
  it("reloads authoritative state before clearing an invalid record and retains it on failed reads", async () => {
    storage.set(storageKey, "{malformed");
    storage.set("another-receipt", "preserved");
    const h = harness();
    await h.settle();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    expect(tab.sessionStorage.removeItem).not.toHaveBeenCalled();
    h.acknowledgeInvalid();
    (h.props.onReloadForInvalidRecovery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("GET unavailable"),
    );
    await h.click("Reload saved deck and clear invalid recovery");
    expect(storage.get(storageKey)).toBe("{malformed");
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    expect(h.props.onClose).not.toHaveBeenCalled();
    await h.click("Reload saved deck and clear invalid recovery");
    expect(h.props.onReloadForInvalidRecovery).toHaveBeenCalledTimes(2);
    expect(storage.has(storageKey)).toBe(false);
    expect(storage.get("another-receipt")).toBe("preserved");
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(false);
    expect(h.props.onClose).toHaveBeenCalledOnce();
    h.unmount();
  });
  it("does not unlock on denied storage removal and provides a retry", async () => {
    storage.set(storageKey, "{malformed");
    const h = harness();
    await h.settle();
    h.acknowledgeInvalid();
    tab.sessionStorage.removeItem.mockImplementationOnce(() => {
      throw new Error("Storage denied");
    });
    await h.click("Reload saved deck and clear invalid recovery");
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    expect(storage.has(storageKey)).toBe(true);
    expect(h.props.onClose).not.toHaveBeenCalled();
    await h.click("Reload saved deck and clear invalid recovery");
    expect(storage.has(storageKey)).toBe(false);
    h.unmount();
  });
  it("can retry a storage read error without automatically unlocking", async () => {
    tab.sessionStorage.getItem.mockImplementationOnce(() => {
      throw new Error("Read denied");
    });
    const h = harness();
    await h.settle();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    h.acknowledgeInvalid();
    await h.click("Reload saved deck and clear invalid recovery");
    expect(h.props.onReloadForInvalidRecovery).toHaveBeenCalledOnce();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(false);
    h.unmount();
  });
  it("restores a valid uncertain insertion appearing during invalid-record reload instead of clearing it", async () => {
    storage.set(storageKey, "{malformed");
    const h = harness();
    await h.settle();
    h.acknowledgeInvalid();
    let finish: () => void = () => undefined;
    h.props.onReloadForInvalidRecovery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    (h.button("Reload saved deck and clear invalid recovery").props.onClick as () => void)();
    await h.settle();
    const valid = JSON.stringify(validRecovery(true));
    storage.set(storageKey, valid);
    finish();
    await h.settle();
    expect(storage.get(storageKey)).toBe(valid);
    expect(tab.sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    expect(h.button("Retry exact insertion")).toBeDefined();
    expect(h.props.onClose).not.toHaveBeenCalled();
    h.unmount();
  });
  it("passes an immediate auth fence into invalid-record reload before parent adoption", async () => {
    storage.set(storageKey, "{malformed");
    const h = harness();
    await h.settle();
    h.acknowledgeInvalid();
    let finish: () => void = () => undefined;
    let canContinue: () => boolean = () => true;
    h.props.onReloadForInvalidRecovery = vi.fn((current) => {
      canContinue = current;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    (h.button("Reload saved deck and clear invalid recovery").props.onClick as () => void)();
    await h.settle();
    tab.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(canContinue()).toBe(false);
    finish();
    await h.settle();
    expect(storage.has(storageKey)).toBe(true);
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(true);
    expect(h.props.onClose).not.toHaveBeenCalled();
    h.unmount();
  });
  it("shows both complete prompts/excerpts and fixed opinion settings with per-node source languages", () => {
    const markup = renderToStaticMarkup(
      <QuestionSuggestionsProposalReview
        proposal={proposal}
        suggestionId={id(31)}
        reviewed={false}
        disabled={false}
        onSelect={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    for (const question of proposal.suggestions) {
      expect(markup).toContain(question.prompt);
      expect(markup).toContain(question.citations[0]!.excerpt);
    }
    expect(markup).toContain(PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING);
    expect(markup).toContain("0 points");
    expect(markup).toContain("confidence off");
    expect(markup).toContain("no correct answer");
    expect(markup).toContain("no linked recheck");
    expect(markup).toContain('lang="en"');
    expect(markup).toContain('lang="fr"');
    expect(markup).not.toContain("PRIVATE_NOTES");
    expect(markup).toContain("I reviewed both complete questions");
  });
  it("renders complete source and authored markup as literal text without links or HTML injection", () => {
    const copy = structuredClone(source);
    copy.title.text = '<script>alert("literal")</script>';
    copy.body[0]!.text = "https://example.test/source\n<img src=x onerror=alert(1)>";
    const markup = renderToStaticMarkup(<QuestionSuggestionsSourceReview source={copy} />);
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<a ");
    expect(markup).toContain("https://example.test/source");
  });
  it("hides private proposal/source after permission loss and prevents generation", async () => {
    const h = harness();
    await h.settle();
    await h.click("Generate discussion suggestions");
    h.props.canEdit = false;
    h.render();
    await h.settle();
    expect(h.review).toBeUndefined();
    expect(h.nodes.some((node) => node.type === QuestionSuggestionsSourceReview)).toBe(false);
    expect(h.props.onInserted).not.toHaveBeenCalled();
    h.unmount();
  });
});
