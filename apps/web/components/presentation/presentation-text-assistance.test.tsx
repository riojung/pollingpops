import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as ApiModule from "../../lib/api";
import { ApiClientError } from "../../lib/api";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
  type PresentationTextAssistanceProposal,
  PRESENTATION_TEXT_LANGUAGES,
  presentationTextAssistanceProposalHash,
  type CreatePresentationTextAssistanceJob,
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
} from "./presentation-text-assistance";
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
    expect(markup).toContain("approved-provider / bounded-model");
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
    expect(markup).toContain("Translation — French");
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
});
