import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as ApiModule from "../../lib/api";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
  type PresentationTextAssistanceProposal,
  PRESENTATION_TEXT_LANGUAGES,
  presentationTextAssistanceProposalHash,
  type CreatePresentationTextAssistanceJob,
  supportedLocales,
} from "@openround/contracts";
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
        (next: T | ((current: T) => T)) => {
          const current = hooks.slots[index]!.value as T;
          const value = typeof next === "function" ? (next as (current: T) => T)(current) : next;
          if (!Object.is(current, value)) hooks.dirty = true;
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
  PresentationTextAssistance,
  TextAssistanceProposalReview,
  textAssistanceLanguageDisplay,
} from "./presentation-text-assistance";
import { textAssistanceCopy } from "./text-assistance-copy";
const originalText = "  Complete original wording\nwith evidence and a limitation.  ";
const text = "Shorter wording with a limitation.";
const proposal: PresentationTextAssistanceProposal = {
  schemaVersion: 1,
  blockId: "00000000-0000-4000-8000-000000000001",
  nodeId: "Imported NODE title",
  role: "body",
  operation: "shorten",
  originalText,
  text,
  sourceDigest: presentationTextAssistanceSourceDigest(originalText),
  outputDigest: presentationTextAssistanceSourceDigest(text),
  provider: "approved-provider",
  model: "bounded-model",
  generatedAt: "2026-11-06T12:00:00.000Z",
  reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
};
const props = {
  presentationId: "00000000-0000-4000-8000-000000000002",
  actorKey: "actor:workspace",
  canEdit: true,
  open: true,
  target: {
    blockId: proposal.blockId,
    nodeId: proposal.nodeId,
    role: proposal.role,
    operation: proposal.operation,
    text: originalText,
    expectedRevision: 4,
  },
  citations: [],
  onApplied: vi.fn(),
  onReloadTarget: vi.fn(),
  onReloadForInvalidRecovery: vi.fn(),
  onClose: vi.fn(),
  onPendingChange: vi.fn(),
  onRecoveryChange: vi.fn(),
};
describe("selected text assistance review", () => {
  it("shows complete original/proposed text and labels prior citations as unverified context", () => {
    const markup = renderToStaticMarkup(
      <TextAssistanceProposalReview
        proposal={proposal}
        citations={[{ locator: "outline line 2", excerpt: "Earlier source excerpt" }]}
        reviewed={false}
        disabled={false}
        onReview={vi.fn()}
      />,
    );
    expect(markup).toContain(originalText);
    expect(markup).toContain(text);
    expect(markup).toContain(PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING);
    expect(markup).toContain("Earlier source excerpt");
    expect(markup).toContain("They do not verify this proposed wording");
    expect(markup.replace(/<[^>]*>/g, "")).toContain("approved-provider / bounded-model");
    expect(markup).toContain('<span lang="">approved-provider</span>');
    expect(markup).toContain('type="checkbox"');
    expect(markup).not.toContain('checked=""');
    expect(markup).toContain("I reviewed the complete original and proposed wording");
  });
  it("disables review while an application acknowledgement is outstanding", () => {
    const markup = renderToStaticMarkup(
      <TextAssistanceProposalReview
        proposal={proposal}
        citations={[]}
        reviewed
        disabled
        onReview={vi.fn()}
      />,
    );
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*checked=""/);
  });
  it("opens an accessible availability-first review without automatically generating", () => {
    const markup = renderToStaticMarkup(<PresentationTextAssistance {...props} />);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="text-assistance-title"');
    expect(markup).toContain("Shorten text");
    expect(markup).toContain(originalText);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Generate shorter text proposal/);
    expect(markup).toContain("Speaker notes, other objects and citation excerpts are not sent");
    expect(props.onApplied).not.toHaveBeenCalled();
  });
  it("hides private text and prevents generation after editor permission is revoked", () => {
    const markup = renderToStaticMarkup(<PresentationTextAssistance {...props} canEdit={false} />);
    expect(markup).toContain("Editor permission is required");
    expect(markup).not.toContain(originalText);
    expect(markup).not.toContain("Generate shorter text proposal");
  });
  it("labels the reviewed target and annotates original/translated text independently", () => {
    const translation: PresentationTextAssistanceProposal = {
      ...proposal,
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: "en",
      text: "Texte traduit complet avec sa réserve.",
      outputDigest: presentationTextAssistanceSourceDigest(
        "Texte traduit complet avec sa réserve.",
      ),
    };
    const markup = renderToStaticMarkup(
      <TextAssistanceProposalReview
        proposal={translation}
        citations={[]}
        reviewed={false}
        disabled={false}
        onReview={vi.fn()}
      />,
    );
    expect(markup.replace(/<[^>]*>/g, "")).toContain("Translation — French");
    expect(markup).toContain("Target language:");
    expect(markup).toContain("French");
    expect(markup).toContain('lang="en"');
    expect(markup).toContain('lang="fr"');
    expect(markup).toContain(originalText);
    expect(markup).toContain(translation.text);
    expect(markup).toContain(
      "I reviewed the complete original and translated wording, including meaning, terminology, unsupported claims and existing citations.",
    );
    const unknown = renderToStaticMarkup(
      <TextAssistanceProposalReview
        proposal={{ ...translation, sourceLanguage: null }}
        citations={[]}
        reviewed={false}
        disabled={false}
        onReview={vi.fn()}
      />,
    );
    expect(unknown).toContain("Not marked");
    expect(unknown).toContain('lang=""');
  });
  it.each(supportedLocales)(
    "localizes the %s review while keeping authored collisions and provenance exact",
    (locale) => {
      const collision = {
        ...proposal,
        operation: "translate" as const,
        originalText: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
        text: "Review proposed text",
        sourceLanguage: "es" as const,
        targetLanguage: "fr" as const,
        provider: "Close",
        model: "Original text",
      };
      const before = structuredClone(collision);
      const markup = renderToStaticMarkup(
        <TextAssistanceProposalReview
          locale={locale}
          proposal={collision}
          citations={[{ locator: "Target language", excerpt: "Translate text" }]}
          reviewed
          disabled={false}
          onReview={vi.fn()}
        />,
      );
      expect(markup).toContain(
        `aria-label="${textAssistanceCopy(locale)("Review proposed text")}"`,
      );
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain(`lang="es">${collision.originalText}</p>`);
      expect(markup).toContain('lang="fr">Review proposed text</p>');
      expect(markup).toContain('<strong lang="">Target language</strong>');
      expect(markup).toContain('lang="">Translate text</blockquote>');
      expect(markup).toContain('<span lang="">Close</span>');
      expect(markup).toContain('<span lang="">Original text</span>');
      expect(markup).toContain(`<span lang="">${collision.generatedAt}</span>`);
      expect(markup).toContain(textAssistanceLanguageDisplay("fr", locale).text);
      expect(markup).toMatch(/<input[^>]*checked=""/);
      expect(collision).toEqual(before);
    },
  );
  it("uses English language labels only for the default or a missing display-name service", () => {
    expect(textAssistanceLanguageDisplay("zh-Hans")).toEqual({
      text: "Chinese (Simplified)",
      lang: "en-CA",
    });
    expect(textAssistanceLanguageDisplay("fr", "ko-KR")).toEqual({
      text: "프랑스어",
      lang: "ko-KR",
    });
    const displayNames = vi.spyOn(Intl, "DisplayNames").mockImplementation(() => {
      throw new Error("Unavailable");
    });
    try {
      expect(textAssistanceLanguageDisplay("fr", "ko-KR")).toEqual({
        text: "French",
        lang: "en-CA",
      });
    } finally {
      displayNames.mockRestore();
    }
  });
});

function elements(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}
function translationModal() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], dirty: true };
  const currentProps: ComponentProps<typeof PresentationTextAssistance> = {
    ...props,
    target: { ...props.target, operation: "translate", sourceLanguage: "en" },
    onPendingChange: vi.fn(),
    onRecoveryChange: vi.fn(),
    onApplied: vi.fn(),
    onClose: vi.fn(),
  };
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    hooks.dirty = false;
    fixture.hooks = hooks;
    try {
      tree = PresentationTextAssistance(currentProps);
    } finally {
      fixture.hooks = null;
    }
    for (const effect of hooks.effects.splice(0)) effect();
  };
  const settle = async () => {
    render();
    for (let index = 0; index < 30; index++) {
      if (hooks.dirty) render();
      await Promise.resolve();
    }
  };
  return {
    props: currentProps,
    render,
    settle,
    get nodes() {
      return elements(tree);
    },
    button(label: string) {
      const node = elements(tree).find(
        (node) => node.type === "button" && node.props.children === label,
      );
      if (!node) throw new Error(`Missing ${label}`);
      return node;
    },
  };
}
async function generateTranslation(h: ReturnType<typeof translationModal>) {
  await h.settle();
  const picker = h.nodes.find((node) => node.type === "select")!;
  (picker.props.onChange as (event: unknown) => void)({ target: { value: "fr" } });
  await h.settle();
  (
    h.button(textAssistanceCopy(h.props.locale)("Generate translation proposal")).props
      .onClick as () => void
  )();
  await h.settle();
}
describe("translation language selection and explicit review", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.clearAllMocks();
    storage = new Map();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("document", {
      activeElement: null,
      querySelector: vi.fn().mockReturnValue(null),
    });
    let job: unknown;
    fixture.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/status?"))
        return {
          status: {
            enabled: true,
            monthlyLimit: 10,
            used: 0,
            remaining: 10,
            active: 0,
            maxActiveJobs: 2,
          },
        };
      if (path.includes("/jobs/")) {
        if (!job) throw new ApiClientError("Not found", "NOT_FOUND", 404);
        return { job };
      }
      if (path.endsWith("/jobs") && init?.method === "POST") {
        const input = JSON.parse(String(init.body)) as CreatePresentationTextAssistanceJob;
        const proposed: PresentationTextAssistanceProposal = {
          ...proposal,
          blockId: input.blockId,
          nodeId: input.nodeId,
          operation: "translate",
          targetLanguage: input.targetLanguage,
          sourceLanguage: input.sourceLanguage,
          text: "Texte traduit complet avec sa réserve.",
          outputDigest: presentationTextAssistanceSourceDigest(
            "Texte traduit complet avec sa réserve.",
          ),
        };
        job = {
          schemaVersion: 1,
          id: input.requestId,
          requestId: input.requestId,
          presentationId: input.presentationId,
          blockId: input.blockId,
          nodeId: input.nodeId,
          operation: "translate",
          sourceRevision: input.expectedRevision,
          role: "body",
          sourceDigest: input.sourceDigest,
          status: "ready",
          attempts: 1,
          proposal: proposed,
          proposalHash: presentationTextAssistanceProposalHash(proposed),
          error: null,
          createdAt: "2026-11-06T12:00:00.000Z",
          updatedAt: "2026-11-06T12:00:00.000Z",
          expiresAt: "2026-11-07T12:00:00.000Z",
          targetLanguage: input.targetLanguage,
          sourceLanguage: input.sourceLanguage,
        };
        return { job };
      }
      throw new Error(`Unexpected ${path}`);
    });
  });
  afterEach(() => {
    fixture.hooks = null;
    vi.unstubAllGlobals();
  });
  it("requires a canonical explicit target choice, checks allowance, then locks that choice to the generated request", async () => {
    const h = translationModal();
    await h.settle();
    expect(
      h.nodes.some((node) => node.type === "h2" && node.props.children === "Translate text"),
    ).toBe(true);
    const picker = h.nodes.find((node) => node.type === "select")!;
    expect(picker.props.value).toBe("");
    expect(
      h.nodes
        .filter((node) => node.type === "option" && node.props.value !== "")
        .map((node) => node.props.value),
    ).toEqual(PRESENTATION_TEXT_LANGUAGES.map((language) => language.code));
    expect(
      h.nodes.find((node) => node.type === "option" && node.props.value === "en")?.props.disabled,
    ).toBe(true);
    expect(h.button("Generate translation proposal").props.disabled).toBe(true);
    expect(fixture.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    (picker.props.onChange as (event: unknown) => void)({ target: { value: "fr" } });
    await h.settle();
    expect(h.button("Generate translation proposal").props.disabled).toBe(false);
    (h.button("Generate translation proposal").props.onClick as () => void)();
    await h.settle();
    const creates = fixture.request.mock.calls.filter(
      ([path, init]) => path.endsWith("/jobs") && init?.method === "POST",
    );
    expect(creates).toHaveLength(1);
    expect(JSON.parse(creates[0]![1].body)).toMatchObject({
      targetLanguage: "fr",
      sourceLanguage: "en",
      operation: "translate",
    });
    expect(h.nodes.some((node) => node.type === "select")).toBe(false);
    expect(
      h.nodes.some(
        (node) =>
          node.type === TextAssistanceProposalReview &&
          (node.props.proposal as PresentationTextAssistanceProposal).targetLanguage === "fr",
      ),
    ).toBe(true);
    expect(h.button("Apply reviewed translation").props.disabled).toBe(true);
    (picker.props.onChange as (event: unknown) => void)({ target: { value: "es" } });
    await h.settle();
    expect(fixture.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      1,
    );
    expect([...storage.values()].join("\n")).not.toContain(originalText);
    expect([...storage.values()].join("\n")).not.toContain("Texte traduit");
    (h.button("Close").props.onClick as () => void)();
    expect(h.props.onClose).toHaveBeenCalledOnce();
    expect(h.props.onApplied).not.toHaveBeenCalled();
  });
  it("rejects noncanonical picker values instead of silently selecting another language", async () => {
    const h = translationModal();
    await h.settle();
    const picker = h.nodes.find((node) => node.type === "select")!;
    (picker.props.onChange as (event: unknown) => void)({ target: { value: "zh-CN" } });
    await h.settle();
    expect(h.nodes.find((node) => node.type === "select")?.props.value).toBe("");
    expect(h.button("Generate translation proposal").props.disabled).toBe(true);
    expect(fixture.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("keeps a pending create body, storage identity and canonical languages across mounted locale changes", async () => {
    const request = fixture.request.getMockImplementation()!;
    let rejectCreate!: (reason: Error) => void;
    let creates = 0;
    const bodies: string[] = [];
    let firstSignal: AbortSignal | undefined;
    fixture.request.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/jobs") && init?.method === "POST") {
        bodies.push(String(init.body));
        if (++creates === 1) {
          firstSignal = init.signal!;
          return new Promise((_resolve, reject) => {
            rejectCreate = reject;
          });
        }
      }
      return request(path, init);
    });
    const h = translationModal();
    h.props.locale = "ko-KR";
    await generateTranslation(h);
    const [key, raw] = [...storage][0]!;
    expect(key).toBe(`presentation-text-assistance:v1:${props.actorKey}:${props.presentationId}`);
    const calls = fixture.request.mock.calls.length;
    const pendingCalls = vi.mocked(h.props.onPendingChange).mock.calls.length;
    h.props.locale = "de-DE";
    await h.settle();
    expect(firstSignal?.aborted).toBe(false);
    expect(fixture.request).toHaveBeenCalledTimes(calls);
    expect(h.props.onPendingChange).toHaveBeenCalledTimes(pendingCalls);
    expect(storage.get(key)).toBe(raw);
    expect(h.nodes.find((node) => node.props.role === "dialog")?.props.lang).toBe("de-DE");
    rejectCreate(new Error("Unknown gateway <original> {language}"));
    await h.settle();
    expect(
      h.nodes.some(
        (node) =>
          node.props.role === "alert" &&
          node.props.lang === "en-CA" &&
          node.props.children === "Unknown gateway <original> {language}",
      ),
    ).toBe(true);
    (
      h.button(textAssistanceCopy("de-DE")("Recover or retry saved request")).props
        .onClick as () => void
    )();
    await h.settle();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: "en",
      nodeId: proposal.nodeId,
    });
    expect(bodies.join("")).not.toMatch(/ko-KR|de-DE|locale/);
    expect([...storage.keys()]).toEqual([key]);
    expect(JSON.parse(storage.get(key)!).createBody).toBe(bodies[0]);
    expect(h.nodes.find((node) => node.type === TextAssistanceProposalReview)?.props.locale).toBe(
      "de-DE",
    );
  });
  it("retains review across a locale change, passes exact recovery to reload, and retries the identical apply body", async () => {
    const request = fixture.request.getMockImplementation()!;
    const applyBodies: string[] = [];
    fixture.request.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/text-assistance/apply")) {
        applyBodies.push(String(init?.body));
        return Promise.reject(new Error("Apply acknowledgement lost"));
      }
      return request(path, init);
    });
    const h = translationModal();
    h.props.locale = "ko-KR";
    await generateTranslation(h);
    const review = () => h.nodes.find((node) => node.type === TextAssistanceProposalReview)!;
    (review().props.onReview as (value: boolean) => void)(true);
    await h.settle();
    const calls = fixture.request.mock.calls.length;
    h.props.locale = "de-DE";
    await h.settle();
    expect(fixture.request).toHaveBeenCalledTimes(calls);
    expect(review().props.reviewed).toBe(true);
    expect(h.button(textAssistanceCopy("de-DE")("Apply reviewed translation")).props.disabled).toBe(
      false,
    );
    const raw = [...storage.values()][0]!;
    h.props.onReloadTarget = vi.fn().mockResolvedValue({ ...h.props.target!, expectedRevision: 5 });
    (
      h.button(textAssistanceCopy("de-DE")("Reload exact target and review")).props
        .onClick as () => void
    )();
    await h.settle();
    expect(h.props.onReloadTarget).toHaveBeenCalledExactlyOnceWith(JSON.parse(raw));
    expect(review().props.reviewed).toBe(false);
    (review().props.onReview as (value: boolean) => void)(true);
    await h.settle();
    (
      h.button(textAssistanceCopy("de-DE")("Apply reviewed translation")).props
        .onClick as () => void
    )();
    await h.settle();
    const saved = [...storage.values()][0]!;
    expect(JSON.parse(saved).applyBody).toBe(applyBodies[0]);
    h.props.locale = "ja-JP";
    await h.settle();
    expect([...storage.values()][0]).toBe(saved);
    expect(review().props.reviewed).toBe(false);
    expect(review().props.disabled).toBe(true);
    (
      h.button(textAssistanceCopy("ja-JP")("Retry exact text application")).props
        .onClick as () => void
    )();
    await h.settle();
    expect(applyBodies).toHaveLength(2);
    expect(applyBodies[1]).toBe(applyBodies[0]);
    expect(JSON.parse(applyBodies[0]!)).toMatchObject({
      expectedRevision: 5,
      targetLanguage: "fr",
      sourceLanguage: "en",
      reviewed: true,
      nodeId: proposal.nodeId,
    });
    expect(applyBodies.join("")).not.toMatch(/ko-KR|de-DE|ja-JP|locale/);
    expect(h.props.onApplied).not.toHaveBeenCalled();
  });
  it("keeps the invalid-record acknowledgement and active reload across mounted locale changes", async () => {
    const key = `presentation-text-assistance:v1:${props.actorKey}:${props.presentationId}`;
    storage.set(key, "{invalid recovery");
    const h = translationModal();
    h.props.locale = "fr-FR";
    let finishReload!: () => void;
    h.props.onReloadForInvalidRecovery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReload = resolve;
        }),
    );
    await h.settle();
    const checkbox = () =>
      h.nodes.find((node) => node.type === "input" && node.props.type === "checkbox")!;
    (checkbox().props.onChange as (event: unknown) => void)({ target: { checked: true } });
    await h.settle();
    h.props.locale = "ko-KR";
    await h.settle();
    expect(checkbox().props.checked).toBe(true);
    expect(
      h.button(textAssistanceCopy("ko-KR")("Reload saved deck and clear invalid recovery")).props
        .disabled,
    ).toBe(false);
    (
      h.button(textAssistanceCopy("ko-KR")("Reload saved deck and clear invalid recovery")).props
        .onClick as () => void
    )();
    await h.settle();
    const mayContinue = vi.mocked(h.props.onReloadForInvalidRecovery).mock.calls[0]![0];
    expect(mayContinue()).toBe(true);
    h.props.locale = "de-DE";
    await h.settle();
    expect(checkbox().props.checked).toBe(true);
    expect(checkbox().props.disabled).toBe(true);
    expect(h.button(textAssistanceCopy("de-DE")("Reloading saved deck…")).props.disabled).toBe(
      true,
    );
    expect(storage.get(key)).toBe("{invalid recovery");
    expect(h.props.onReloadForInvalidRecovery).toHaveBeenCalledOnce();
    expect(mayContinue()).toBe(true);
    finishReload();
    await h.settle();
    expect(storage.has(key)).toBe(false);
    expect(h.props.onClose).toHaveBeenCalledOnce();
    expect(h.props.onPendingChange).toHaveBeenLastCalledWith(false);
    expect(h.props.onRecoveryChange).toHaveBeenLastCalledWith(false);
  });
  it.each(["permission", "auth"] as const)(
    "keeps %s invalidation guards active after switching locale",
    async (guard) => {
      const h = translationModal();
      await generateTranslation(h);
      const review = h.nodes.find((node) => node.type === TextAssistanceProposalReview)!;
      (review.props.onReview as (value: boolean) => void)(true);
      await h.settle();
      const apply = h.button("Apply reviewed translation");
      h.props.locale = "ko-KR";
      if (guard === "permission") h.props.canEdit = false;
      else {
        const authChanged = vi
          .mocked(window.addEventListener)
          .mock.calls.find(([name]) => name === AUTH_CHANGE_EVENT)![1] as () => void;
        authChanged();
      }
      await h.settle();
      const calls = fixture.request.mock.calls.length;
      (review.props.onReview as (value: boolean) => void)(true);
      (apply.props.onClick as () => void)();
      await h.settle();
      expect(fixture.request).toHaveBeenCalledTimes(calls);
      expect(h.props.onApplied).not.toHaveBeenCalled();
      expect(h.nodes.some((node) => node.type === TextAssistanceProposalReview)).toBe(false);
      expect(
        h.nodes.some((node) => node.type === "p" && node.props.children === originalText),
      ).toBe(false);
    },
  );
});
