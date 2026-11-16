import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type ContentSlideDraft,
  type SupportedLocale,
} from "@openround/contracts";
import { questionStartersCopy } from "../../lib/i18n/question-starters-copy";
import {
  createNativeContentBlock,
  createNativeDialogNode,
} from "../../lib/presentation-native-scene";
import { createPresentationQuestionStarters } from "../../lib/presentation-question-starters";
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
  deferState: boolean;
  pendingState: Map<number, unknown>;
}
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null }));
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
        (next: T | ((current: T) => T)) => {
          const before = (
            hooks.pendingState.has(index)
              ? hooks.pendingState.get(index)
              : hooks.slots[index]!.value
          ) as T;
          const value = typeof next === "function" ? (next as (current: T) => T)(before) : next;
          if (!Object.is(before, value)) hooks.dirty = true;
          if (hooks.deferState) hooks.pendingState.set(index, value);
          else hooks.slots[index]!.value = value;
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
      hooks.slots[index] ??= { value: `question-review-${index}` };
      return hooks.slots[index]!.value;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
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
  PresentationQuestionStarters,
  QuestionStarterPreview,
  QuestionStarterSourceReview,
} from "./presentation-question-starters";
function elements(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}
function textContent(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(tree)) return textContent(tree.props.children);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
function sourceBlock(): ContentSlideDraft {
  const block = createNativeContentBlock();
  const title = block.scene!.nodes[0]!;
  if (title.type !== "text") throw new Error("Expected title");
  title.text = "Plan the next step";
  title.lang = "en";
  block.scene!.schemaVersion = 7;
  block.scene!.nodes.push({
    id: "Body:ExactCase",
    type: "text",
    role: "body",
    text: "First exact point\nSecond exact point\nThird exact point",
    lang: "fr",
    frame: { x: 10, y: 35, width: 80, height: 50 },
  });
  block.scene!.readingOrder.push("Body:ExactCase");
  block.speakerNotes = "PRIVATE_NOTES_NEVER_SOURCE";
  block.citations = [
    { locator: "https://private.example/evidence", excerpt: "PRIVATE_IMPORT_EVIDENCE" },
  ];
  block.sourceDisclosure = {
    sourceName: "Private source",
    sourceDigest: "a".repeat(64),
    provider: "original-provider",
    model: "original-model",
    conversionNotes: ["PRIVATE_CONVERSION_DETAIL"],
  };
  return block;
}
function harness(locale?: SupportedLocale) {
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    effects: [],
    dirty: true,
    deferState: false,
    pendingState: new Map(),
  };
  const props: ComponentProps<typeof PresentationQuestionStarters> = {
    block: sourceBlock(),
    sourceKey: "actor:deck:slide",
    onInsert: vi.fn(),
    disabled: false,
    locale,
  };
  const trigger = { disabled: false, isConnected: true, focus: vi.fn() };
  const nativeDialog = {
    open: false,
    showModal: vi.fn(() => {
      nativeDialog.open = true;
    }),
    close: vi.fn(() => {
      nativeDialog.open = false;
    }),
  };
  let tree: ReactNode;
  let dialogRef: { current: unknown } | undefined;
  const render = () => {
    hooks.cursor = 0;
    hooks.dirty = false;
    fixture.hooks = hooks;
    try {
      tree = PresentationQuestionStarters(props);
    } finally {
      fixture.hooks = null;
    }
    const nodes = elements(tree);
    const button = nodes.find((node) => node.type === "button" && node.props.ref)!;
    trigger.disabled = Boolean(button.props.disabled);
    (button.props.ref as { current: unknown }).current = trigger;
    const dialog = nodes.find((node) => node.type === "dialog");
    if (dialog) {
      dialogRef = dialog.props.ref as { current: unknown };
      dialogRef.current = nativeDialog;
    } else if (dialogRef) dialogRef.current = null;
    for (const effect of hooks.effects.splice(0)) effect();
  };
  const flush = () => {
    for (let index = 0; index < 12; index++) if (hooks.dirty) render();
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
    render,
    flush,
    button,
    trigger,
    nativeDialog,
    get nodes() {
      return elements(tree);
    },
    get dialog() {
      return elements(tree).find((node) => node.type === "dialog");
    },
    open() {
      (
        button(questionStartersCopy(props.locale)("Question starters")).props.onClick as () => void
      )();
      flush();
    },
    choose(id: string) {
      const radio = elements(tree).find(
        (node) => node.type === "input" && node.props.value === id,
      )!;
      (radio.props.onChange as () => void)();
      flush();
    },
    deferState(work: () => void) {
      hooks.deferState = true;
      try {
        work();
      } finally {
        hooks.deferState = false;
      }
    },
    commitDeferredState() {
      for (const [index, value] of hooks.pendingState) hooks.slots[index]!.value = value;
      hooks.pendingState.clear();
      hooks.dirty = true;
      flush();
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
describe("reviewed local question starters", () => {
  it("opens a native modal with one radio choice and complete review without inserting or calling a service", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const h = harness();
    h.open();
    expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
    expect(h.dialog?.props.open).toBeUndefined();
    expect(h.dialog?.props["aria-modal"]).toBe("true");
    expect(
      h.nodes.some(
        (node) => node.type === "h2" && node.props.children === "Review question starters",
      ),
    ).toBe(true);
    const radios = h.nodes.filter((node) => node.type === "input" && node.props.type === "radio");
    expect(radios.map((node) => node.props.value)).toEqual(["discussion", "clarity", "priority"]);
    expect(radios.filter((node) => node.props.checked)).toHaveLength(1);
    expect(h.nodes.some((node) => node.type === QuestionStarterPreview)).toBe(true);
    expect(h.nodes.some((node) => node.type === QuestionStarterSourceReview)).toBe(true);
    expect(JSON.stringify(h.nodes)).toContain("No AI service or allowance is used");
    expect(h.props.onInsert).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("changes selection without reopening the modal and inserts the exact selected starter once", () => {
    const h = harness();
    const before = structuredClone(h.props.block);
    h.open();
    h.choose("priority");
    expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
    const insert = h.button("Insert reviewed question").props.onClick as () => void;
    insert();
    insert();
    h.flush();
    expect(h.props.onInsert).toHaveBeenCalledOnce();
    expect((h.props.onInsert as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      createPresentationQuestionStarters(before).find((starter) => starter.id === "priority"),
    ]);
    expect(h.props.block).toEqual(before);
    expect(h.dialog).toBeUndefined();
  });
  it("retains a queued selection through an older-state render while rejecting its stale insert handler", () => {
    const h = harness();
    h.open();
    const staleInsert = h.button("Insert reviewed question").props.onClick as () => void;
    // Refs already contain the new selection while React can still render older state.
    h.deferState(() => h.choose("priority"));
    staleInsert();
    expect(h.props.onInsert).not.toHaveBeenCalled();
    h.commitDeferredState();
    expect(h.nativeDialog.open).toBe(true);
    expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
    expect(
      h.nodes.find((node) => node.type === "input" && node.props.value === "priority")?.props
        .checked,
    ).toBe(true);
    expect(h.button("Insert reviewed question").props.disabled).toBe(false);
    (h.button("Insert reviewed question").props.onClick as () => void)();
    h.flush();
    expect(h.props.onInsert).toHaveBeenCalledOnce();
    expect((h.props.onInsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].id).toBe("priority");
    expect(h.dialog).toBeUndefined();
  });
  it("cancels and handles Escape without insertion, restoring focus to its trigger", () => {
    const h = harness();
    h.open();
    const event = { preventDefault: vi.fn() };
    (h.dialog!.props.onCancel as (event: unknown) => void)(event);
    h.flush();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.props.onInsert).not.toHaveBeenCalled();
    expect(h.trigger.focus).toHaveBeenCalled();
    expect(h.nativeDialog.close).toHaveBeenCalledOnce();
    h.open();
    (h.button("Cancel").props.onClick as () => void)();
    h.flush();
    expect(h.props.onInsert).not.toHaveBeenCalled();
  });
  it("retains the review and concrete choice when the parent rejects insertion", () => {
    const h = harness();
    (h.props.onInsert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    h.open();
    h.choose("clarity");
    (h.button("Insert reviewed question").props.onClick as () => void)();
    h.flush();
    expect(h.dialog).toBeDefined();
    expect(h.nativeDialog.open).toBe(true);
    expect(h.nodes.some((node) => node.props.role === "alert")).toBe(true);
    expect(
      h.nodes.find((node) => node.type === "input" && node.props.value === "clarity")?.props
        .checked,
    ).toBe(true);
    (h.button("Insert reviewed question").props.onClick as () => void)();
    h.flush();
    expect(h.dialog).toBeUndefined();
    expect(h.props.onInsert).toHaveBeenCalledTimes(2);
  });
  it.each(["text", "language", "reading-order", "hidden", "source-key", "permission"] as const)(
    "fences stale insertion when %s changes",
    (change) => {
      const h = harness();
      h.open();
      const insert = h.button("Insert reviewed question").props.onClick as () => void;
      const next = structuredClone(h.props.block);
      if (change === "text") {
        const node = next.scene!.nodes[1]!;
        if (node.type === "text") node.text += " changed";
      } else if (change === "language") {
        const node = next.scene!.nodes[1]!;
        if (node.type === "text") node.lang = "de";
      } else if (change === "reading-order") next.scene!.readingOrder.reverse();
      else if (change === "hidden") next.hidden = true;
      else if (change === "source-key") h.props.sourceKey = "other-actor:deck:slide";
      else h.props.disabled = true;
      h.props.block = next;
      h.render();
      insert();
      h.flush();
      expect(h.props.onInsert).not.toHaveBeenCalled();
      expect(h.dialog).toBeUndefined();
    },
  );
  it("keeps a reviewed source valid through frame-only and private-note changes", () => {
    const h = harness();
    h.open();
    const next = structuredClone(h.props.block);
    const node = next.scene!.nodes[1]!;
    if (node.type !== "text") throw new Error("Expected body");
    node.frame.x += 1;
    next.speakerNotes = "Changed private note";
    h.props.block = next;
    h.render();
    h.flush();
    expect(h.dialog).toBeDefined();
    (h.button("Insert reviewed question").props.onClick as () => void)();
    h.flush();
    expect(h.props.onInsert).toHaveBeenCalledOnce();
  });
  it("rejects an old selection's insert event and events arriving after unmount", () => {
    const h = harness();
    h.open();
    const stale = h.button("Insert reviewed question").props.onClick as () => void;
    h.choose("clarity");
    stale();
    expect(h.props.onInsert).not.toHaveBeenCalled();
    const current = h.button("Insert reviewed question").props.onClick as () => void;
    h.unmount();
    current();
    expect(h.props.onInsert).not.toHaveBeenCalled();
  });
  it("declines hidden sources without replacing them with another slide", () => {
    const h = harness();
    h.props.block = { ...h.props.block, hidden: true };
    h.render();
    expect(h.button("Question starters").props.disabled).toBe(true);
    (h.button("Question starters").props.onClick as () => void)();
    h.flush();
    expect(h.dialog).toBeUndefined();
    expect(h.props.onInsert).not.toHaveBeenCalled();
  });
  it("previews complete private source text in authored language/order without notes, imported evidence or closed details", () => {
    const block = sourceBlock();
    const detail = createNativeDialogNode();
    detail.label = "PRIVATE_DETAIL_LABEL";
    detail.body = "PRIVATE_CLOSED_DETAIL";
    block.scene!.nodes.push(detail);
    block.scene!.readingOrder.push(detail.id);
    block.scene!.readingOrder.reverse();
    const starter = createPresentationQuestionStarters(block)[0]!;
    const markup = renderToStaticMarkup(<QuestionStarterSourceReview source={starter.source} />);
    expect(markup).toContain("First exact point\nSecond exact point\nThird exact point");
    expect(markup).toContain("Plan the next step");
    expect(markup.indexOf("First exact point")).toBeLessThan(markup.indexOf("Plan the next step"));
    expect(markup).toContain('lang="fr"');
    expect(markup).toContain('lang="en"');
    for (const privateText of [
      "PRIVATE_NOTES",
      "PRIVATE_IMPORT",
      "PRIVATE_CONVERSION",
      "https://private.example",
      "PRIVATE_CLOSED",
      "PRIVATE_DETAIL",
    ])
      expect(markup).not.toContain(privateText);
    expect(markup).toContain("does not independently verify");
  });
  it("shows full poll choices and rating bounds as unscored opinions without correctness controls", () => {
    const starters = createPresentationQuestionStarters(sourceBlock());
    const poll = starters.find((starter) => starter.id === "priority")!;
    const pollPreview = QuestionStarterPreview({ starter: poll });
    const pollMarkup = renderToStaticMarkup(pollPreview);
    expect(textContent(pollPreview)).toContain(poll.prompt);
    for (const choice of poll.choices!) expect(pollMarkup).toContain(choice);
    expect(pollMarkup).toContain("0 points");
    expect(pollMarkup).toContain("no correct answer");
    expect(pollMarkup).not.toContain("<input");
    const rating = starters.find((starter) => starter.id === "clarity")!;
    const ratingMarkup = renderToStaticMarkup(<QuestionStarterPreview starter={rating} />);
    expect(ratingMarkup).toContain(rating.rating!.minLabel);
    expect(ratingMarkup).toContain(rating.rating!.maxLabel);
    expect(ratingMarkup).toContain("1");
    expect(ratingMarkup).toContain("5");
  });
  it("keeps the full bounded source readable when no priority choices can be safely extracted", () => {
    const block = sourceBlock();
    const body = block.scene!.nodes[1]!;
    if (body.type !== "text") throw new Error("Expected body");
    body.text = "Long source ".repeat(400).slice(0, 3980) + "END_OF_SOURCE";
    const starter = createPresentationQuestionStarters(block)[0]!;
    const markup = renderToStaticMarkup(<QuestionStarterSourceReview source={starter.source} />);
    expect(markup).toContain(body.text);
    expect(markup).toContain("END_OF_SOURCE");
    expect(
      createPresentationQuestionStarters(block).some((candidate) => candidate.id === "priority"),
    ).toBe(false);
  });

  it.each(supportedLocales)(
    "changes only mounted review chrome when locale becomes %s",
    (locale) => {
      const h = harness();
      const before = structuredClone(h.props.block);
      h.open();
      h.choose("priority");
      const reviewed = h.nodes.find((node) => node.type === QuestionStarterPreview)!.props.starter;
      const originalInsert = h.button("Insert reviewed question").props.onClick as () => void;
      h.props.locale = locale;
      h.render();
      h.flush();
      const copy = questionStartersCopy(locale);
      expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
      expect(h.nativeDialog.close).not.toHaveBeenCalled();
      expect(h.nodes.find((node) => node.type === "section")!.props.lang).toBe(locale);
      expect(h.nodes.find((node) => node.type === "h2")!.props.children).toBe(
        copy("Review question starters"),
      );
      expect(h.button(copy("Insert reviewed question")).props.disabled).toBe(false);
      expect(h.nodes.find((node) => node.type === "input" && node.props.checked)!.props.value).toBe(
        "priority",
      );
      const preview = h.nodes.find((node) => node.type === QuestionStarterPreview)!;
      const source = h.nodes.find((node) => node.type === QuestionStarterSourceReview)!;
      expect(preview.props.starter).toBe(reviewed);
      expect(preview.props.locale).toBe(locale);
      expect(source.props.locale).toBe(locale);
      expect(
        h.nodes.filter((node) => node.type === "strong").map((node) => node.props.children),
      ).toEqual([copy("Discussion"), copy("Clarity rating"), copy("Priority poll")]);
      originalInsert();
      originalInsert();
      h.flush();
      expect(h.props.onInsert).toHaveBeenCalledOnce();
      expect((h.props.onInsert as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
        createPresentationQuestionStarters(before).find((starter) => starter.id === "priority"),
      ]);
      expect(h.props.block).toEqual(before);
      expect(h.dialog).toBeUndefined();
    },
  );

  it("retranslates retained raw feedback without replacing the review or selected English template", () => {
    const h = harness();
    (h.props.onInsert as ReturnType<typeof vi.fn>).mockReturnValue(false);
    h.open();
    h.choose("clarity");
    const starter = h.nodes.find((node) => node.type === QuestionStarterPreview)!.props.starter;
    (h.button("Insert reviewed question").props.onClick as () => void)();
    h.flush();
    const raw =
      "This question could not be inserted. Resolve outstanding draft changes or review the current slide, then try again.";
    for (const locale of ["ko-KR", "fr-FR", "en-CA"] as const) {
      h.props.locale = locale;
      h.render();
      h.flush();
      const alert = h.nodes.find((node) => node.props.role === "alert")!;
      expect(alert.props.children).toBe(questionStartersCopy(locale)(raw));
      expect(alert.props.lang).toBe(locale);
      expect(h.nodes.find((node) => node.type === QuestionStarterPreview)!.props.starter).toBe(
        starter,
      );
      expect(
        h.button(questionStartersCopy(locale)("Insert reviewed question")).props.disabled,
      ).toBe(false);
    }
    expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
    expect(h.nativeDialog.close).not.toHaveBeenCalled();
  });

  it.each(["Question preview", "PRIVATE_UNKNOWN_ERROR 原文"])(
    "keeps thrown diagnostic %s raw and English-attributed through a locale change",
    (raw) => {
      const h = harness("ko-KR");
      (h.props.onInsert as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error(raw);
      });
      h.open();
      (
        h.button(questionStartersCopy("ko-KR")("Insert reviewed question")).props
          .onClick as () => void
      )();
      h.flush();
      h.props.locale = "fr-FR";
      h.render();
      h.flush();
      const alert = h.nodes.find((node) => node.props.role === "alert")!;
      expect(alert.props.children).toBe(raw);
      expect(alert.props.lang).toBe("en-CA");
      expect(h.nativeDialog.open).toBe(true);
    },
  );

  it("localizes exact thrown insertion errors while retaining unknown non-Error fallback", () => {
    const h = harness("ko-KR");
    const raw = "This question identity is already in use. Open question starters again.";
    (h.props.onInsert as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => {
        throw new Error(raw);
      })
      .mockImplementationOnce(() => {
        throw null;
      });
    h.open();
    const insert = () =>
      (
        h.button(questionStartersCopy("ko-KR")("Insert reviewed question")).props
          .onClick as () => void
      )();
    insert();
    h.flush();
    expect(h.nodes.find((node) => node.props.role === "alert")!.props).toMatchObject({
      children: questionStartersCopy("ko-KR")(raw),
      lang: "ko-KR",
    });
    insert();
    h.flush();
    expect(h.nodes.find((node) => node.props.role === "alert")!.props).toMatchObject({
      children: questionStartersCopy("ko-KR")(
        "The question could not be inserted. Your presentation is retained.",
      ),
      lang: "ko-KR",
    });
  });

  it("keeps stale-source fencing during a locale change and pending-selection render", () => {
    const h = harness();
    h.open();
    const stale = h.button("Insert reviewed question").props.onClick as () => void;
    h.deferState(() => h.choose("priority"));
    h.props.locale = "ko-KR";
    h.render();
    stale();
    expect(h.props.onInsert).not.toHaveBeenCalled();
    h.commitDeferredState();
    const current = h.button(questionStartersCopy("ko-KR")("Insert reviewed question")).props
      .onClick as () => void;
    h.props.sourceKey = "another-author:deck:slide";
    h.props.locale = "fr-FR";
    h.render();
    current();
    h.flush();
    expect(h.props.onInsert).not.toHaveBeenCalled();
    expect(h.dialog).toBeUndefined();
  });

  it.each(supportedLocales)("localizes unsupported availability in %s", (locale) => {
    const h = harness(locale);
    h.props.block = { ...h.props.block, hidden: true };
    h.render();
    expect(h.button(questionStartersCopy(locale)("Question starters")).props.disabled).toBe(true);
    const reason = questionStartersCopy(locale)(
      "Choose a visible native slide with a nonblank title and body text.",
    );
    expect(
      h.nodes.some(
        (node) => node.type === "p" && node.props.children === reason && node.props.lang === locale,
      ),
    ).toBe(true);
  });

  it.each(supportedLocales)(
    "keeps source and generated text untouched under %s preview chrome",
    (locale) => {
      const block = sourceBlock();
      const title = block.scene!.nodes[0]!;
      const body = block.scene!.nodes[1]!;
      if (title.type !== "text" || body.type !== "text") throw new Error("Expected source text");
      // Authored text can exactly collide with catalog keys or feedback allowlist entries.
      title.text = "Question preview";
      title.lang = undefined;
      body.text = "Close\nChoose a visible native slide with a nonblank title and body text.";
      body.lang = undefined;
      const starters = createPresentationQuestionStarters(block);
      const snapshot = structuredClone(starters);
      const poll = starters.find((starter) => starter.id === "priority")!;
      const preview = QuestionStarterPreview({ starter: poll, locale });
      const source = QuestionStarterSourceReview({ source: poll.source, locale });
      const previewMarkup = renderToStaticMarkup(preview);
      const sourceMarkup = renderToStaticMarkup(source);
      expect(textContent(preview)).toContain(poll.prompt);
      expect(previewMarkup).toContain('lang="en-CA"');
      expect(previewMarkup).toContain('<span lang="">Question preview</span>');
      expect(previewMarkup).toContain('<li lang="">Close</li>');
      expect(previewMarkup).toContain(
        '<li lang="">Choose a visible native slide with a nonblank title and body text.</li>',
      );
      expect(sourceMarkup).toContain('lang=""');
      expect(textContent(source)).toContain(body.text);
      expect(textContent(source)).toContain(title.text);
      const rating = starters.find((starter) => starter.id === "clarity")!;
      const ratingPreview = QuestionStarterPreview({ starter: rating, locale });
      expect(
        elements(ratingPreview)
          .filter((node) => node.type === "dd")
          .every((node) => node.props.lang === "en-CA"),
      ).toBe(true);
      expect(textContent(ratingPreview)).toContain("Not clear yet");
      expect(textContent(ratingPreview)).toContain("Very clear");
      expect(starters).toEqual(snapshot);
    },
  );
  it("captures the opening language, retains it through a locale change and uses the new language on reopening", () => {
    const h = harness("ko-KR");
    h.open();
    const reviewed = h.nodes.find((node) => node.type === QuestionStarterPreview)!.props
      .starter as ReturnType<typeof createPresentationQuestionStarters>[number];
    expect(reviewed.creationLocale).toBe("ko-KR");
    expect(reviewed.prompt).toContain("어떤 질문이나 의견");
    h.props.locale = "fr-FR";
    h.render();
    h.flush();
    expect(h.nodes.find((node) => node.type === QuestionStarterPreview)!.props.starter).toBe(
      reviewed,
    );
    (
      h.button(questionStartersCopy("fr-FR")("Insert reviewed question")).props
        .onClick as () => void
    )();
    h.flush();
    expect(h.props.onInsert).toHaveBeenCalledWith(reviewed);
    h.open();
    const fresh = h.nodes.find((node) => node.type === QuestionStarterPreview)!.props
      .starter as typeof reviewed;
    expect(fresh.creationLocale).toBe("fr-FR");
    expect(fresh.prompt).toContain("Quelles questions");
  });
});
