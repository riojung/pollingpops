import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as ApiModule from "../../lib/api";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  presentationAssistanceProposalHash,
  presentationAssistanceSourceDigest,
  supportedLocales,
  type CreatePresentationAssistanceJob,
  type PresentationAssistanceJob,
  type PresentationAssistanceProposal,
} from "@openround/contracts";
import { assistanceCopy } from "./assistance-copy";

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
          const previous = hooks.slots[index]!.value as T;
          const value = typeof next === "function" ? (next as (current: T) => T)(previous) : next;
          if (!Object.is(previous, value)) hooks.dirty = true;
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
import { AssistanceProposalReview, PresentationAssistance } from "./presentation-assistance";

const proposal: PresentationAssistanceProposal = {
  schemaVersion: 1,
  sourceName: "Customer interview outline",
  sourceDigest: "a".repeat(64),
  slides: [1, 2, 3].map((n) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    title: `Customer finding ${n}`,
    body: `Review finding ${n} with the team.`,
    citations: [
      { locator: `outline line ${n}`, excerpt: `Exact original evidence ${n}.` },
      {
        locator: "outline line 4",
        excerpt: "A second complete excerpt, including the limitation.",
      },
    ],
  })),
  generatedAt: "2026-11-05T12:00:00.000Z",
  provider: "approved-fixture",
  model: "bounded-text",
  reviewWarning: PRESENTATION_ASSISTANCE_REVIEW_WARNING,
};

describe("Outline assistance review", () => {
  it("shows all exact source excerpts alongside unverified slide text and explicit review controls", () => {
    const markup = renderToStaticMarkup(
      <AssistanceProposalReview
        proposal={proposal}
        selectedSlideIds={[proposal.slides[0]!.id]}
        reviewed={false}
        disabled={false}
        onSelect={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Review proposed slides"');
    expect(markup).toContain(PRESENTATION_ASSISTANCE_REVIEW_WARNING);
    expect(markup).toContain("citations do not verify the generated claims");
    for (const slide of proposal.slides) {
      expect(markup).toContain(slide.title);
      expect(markup).toContain(slide.body);
      for (const citation of slide.citations) {
        expect(markup).toContain(citation.locator);
        expect(markup).toContain(citation.excerpt);
      }
    }
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup).toContain(
      "I reviewed the selected slide text and exact excerpts, including any unsupported claims.",
    );
    expect(markup).toContain("Only selected slides will be inserted");
    expect(markup).not.toContain("Publish");
  });

  it("locks all review choices while recovering an uncertain insertion", () => {
    const markup = renderToStaticMarkup(
      <AssistanceProposalReview
        proposal={proposal}
        selectedSlideIds={proposal.slides.map((slide) => slide.id)}
        reviewed={true}
        disabled
        onSelect={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup.match(/checked=""/g)).toHaveLength(4);
  });

  it("exposes a named dialog, availability-first form and manual-editor explanation without requesting data during render", () => {
    const markup = renderToStaticMarkup(
      <PresentationAssistance
        presentationId="00000000-0000-4000-8000-000000000010"
        actorKey="actor:workspace"
        canEdit
        open
        expectedRevision={4}
        afterBlockId={null}
        onInserted={vi.fn()}
        onReloadDraft={vi.fn()}
        onClose={vi.fn()}
        onResumeRequired={vi.fn()}
        onPendingChange={vi.fn()}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-labelledby="presentation-assistance-title"');
    expect(markup).toContain("Checking AI availability and allowance");
    expect(markup).toMatch(/<fieldset disabled=""/);
    expect(markup).toContain('minLength="50"');
    expect(markup).toContain('maxLength="12000"');
    expect(markup).toContain("Ordinary slide creation and editing remain available without AI");
  });

  it("explains revoked editor permission and leaves generation disabled", () => {
    const markup = renderToStaticMarkup(
      <PresentationAssistance
        presentationId="00000000-0000-4000-8000-000000000010"
        actorKey="actor:workspace"
        canEdit={false}
        open
        expectedRevision={4}
        afterBlockId={null}
        onInserted={vi.fn()}
        onReloadDraft={vi.fn()}
        onClose={vi.fn()}
        onResumeRequired={vi.fn()}
        onPendingChange={vi.fn()}
      />,
    );
    expect(markup).toContain("Editor permission is required");
    expect(markup).toMatch(/<fieldset disabled=""/);
  });
});

const modalProps: ComponentProps<typeof PresentationAssistance> = {
  presentationId: "00000000-0000-4000-8000-000000000010",
  actorKey: "actor:workspace",
  canEdit: true,
  open: true,
  expectedRevision: 4,
  afterBlockId: null,
  onInserted: vi.fn(),
  onReloadDraft: vi.fn(),
  onClose: vi.fn(),
  onResumeRequired: vi.fn(),
  onPendingChange: vi.fn(),
};

it.each(supportedLocales)(
  "renders outline system copy and raw proposal boundaries in %s",
  (locale) => {
    const copy = assistanceCopy(locale);
    const collision = "Review proposed slides";
    const raw: PresentationAssistanceProposal = {
      ...proposal,
      provider: "Close",
      model: "Outline text",
      slides: proposal.slides.map((slide) => ({
        ...slide,
        title: collision,
        body: "Exact outline excerpts",
        citations: [{ locator: "Slides to insert", excerpt: "Create slide proposal" }],
      })),
    };
    const review = renderToStaticMarkup(
      <AssistanceProposalReview
        locale={locale}
        proposal={raw}
        selectedSlideIds={[raw.slides[0]!.id]}
        reviewed
        disabled={false}
        onSelect={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(review).toContain(`lang="${locale}"`);
    expect(review).toContain(`aria-label="${copy("Review proposed slides")}"`);
    expect(review).toContain(`<h4 lang="">${collision}</h4>`);
    expect(review).toMatch(/<p[^>]*lang="">Exact outline excerpts<\/p>/);
    expect(review).toContain('<ul lang=""><li><strong>Slides to insert</strong>');
    expect(review).toContain("<blockquote>Create slide proposal</blockquote>");
    expect(review).toContain('<span lang="">Close / Outline text</span>');
    expect(review).toContain(copy(PRESENTATION_ASSISTANCE_REVIEW_WARNING));
    const modal = renderToStaticMarkup(<PresentationAssistance {...modalProps} locale={locale} />);
    expect(modal).toContain(copy("Outline to slides"));
    expect(modal).toContain(copy("Checking AI availability and allowance…"));
    expect(modal).toContain(copy("Outline name"));
    expect(modal).toContain(copy("Create slide proposal"));
    expect(modal).toContain('lang=""');
  },
);

function elements(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}

function outlineModal(overrides: Partial<ComponentProps<typeof PresentationAssistance>> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], dirty: true };
  const props = {
    ...modalProps,
    onInserted: vi.fn(),
    onClose: vi.fn(),
    onReloadDraft: vi.fn(),
    onPendingChange: vi.fn(),
    onResumeRequired: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    hooks.dirty = false;
    fixture.hooks = hooks;
    try {
      tree = PresentationAssistance(props);
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
  const nodes = () => elements(tree);
  const button = (text: string) => {
    const result = nodes().find((node) => node.type === "button" && node.props.children === text);
    if (!result) throw new Error(`Missing button: ${text}`);
    return result;
  };
  return {
    props,
    render,
    settle,
    nodes,
    button,
    markup: () => renderToStaticMarkup(tree),
    review: () => {
      const result = nodes().find((node) => node.type === AssistanceProposalReview);
      if (!result) throw new Error("Missing proposal review");
      return result as ReactElement<ComponentProps<typeof AssistanceProposalReview>>;
    },
    change: (type: "input" | "textarea" | "select", value: string) => {
      const field = nodes().find((node) => node.type === type);
      if (!field) throw new Error(`Missing ${type}`);
      (field.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
    },
    generate: async () => {
      const form = nodes().find((node) => node.type === "form");
      if (!form) throw new Error("Missing outline form");
      (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
        preventDefault: vi.fn(),
      });
      await settle();
    },
    unmount: () => {
      for (const slot of hooks.slots) slot.cleanup?.();
    },
  };
}

const outline =
  "Review proposed slides\nOriginal source wording must remain unchanged with its limitation.";
const rawDiagnostic = "Network receipt {raw}: https://example.test?x=1&y=2";
const availableStatus = {
  enabled: true,
  monthlyLimit: 10,
  used: 2,
  remaining: 8,
  active: 0,
  maxActiveJobs: 2,
  minimumSlides: 3,
  maximumSlides: 8,
};

describe("outline locale changes with the real assistance controller", () => {
  let storage: Map<string, string>;
  let events: Map<string, () => void>;
  let job: PresentationAssistanceJob | null;
  beforeEach(() => {
    vi.clearAllMocks();
    job = null;
    storage = new Map();
    events = new Map();
    vi.stubGlobal("window", {
      addEventListener: (name: string, callback: () => void) => events.set(name, callback),
      removeEventListener: (name: string) => events.delete(name),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("document", { activeElement: null });
    fixture.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes("/status?")) return { status: availableStatus };
      if (path.includes("/jobs/")) {
        if (!job) throw new ApiClientError("Not found", "NOT_FOUND", 404);
        return { job };
      }
      if (path.endsWith("/jobs") && init?.method === "POST") {
        const input = JSON.parse(String(init.body)) as CreatePresentationAssistanceJob;
        const proposed: PresentationAssistanceProposal = {
          ...proposal,
          sourceName: input.sourceName,
          sourceDigest: presentationAssistanceSourceDigest(input.outline),
          slides: proposal.slides.map((slide) => ({ ...slide, title: "Review proposed slides" })),
        };
        job = {
          schemaVersion: 1,
          id: input.requestId,
          requestId: input.requestId,
          presentationId: input.presentationId,
          sourceName: input.sourceName,
          slideCount: input.slideCount,
          sourceDigest: proposed.sourceDigest,
          proposal: proposed,
          proposalHash: presentationAssistanceProposalHash(proposed),
          status: "ready",
          attempts: 1,
          error: null,
          createdAt: "2026-11-05T12:00:00.000Z",
          updatedAt: "2026-11-05T12:00:00.000Z",
          expiresAt: "2026-11-06T12:00:00.000Z",
        };
        return { job };
      }
      if (path.endsWith("/blocks/assistance-proposals")) throw new Error(rawDiagnostic);
      throw new Error(`Unexpected path ${path}`);
    });
  });
  afterEach(() => {
    fixture.hooks = null;
    vi.unstubAllGlobals();
  });

  async function generateProposal() {
    const modal = outlineModal({ locale: "ko-KR" });
    modal.render();
    await modal.settle();
    modal.change("input", "Review proposed slides");
    modal.change("textarea", outline);
    modal.render();
    await modal.generate();
    return modal;
  }

  it("preserves staged input and generates the same authored request after changing the mounted locale", async () => {
    const modal = outlineModal({ locale: "ko-KR" });
    modal.render();
    await modal.settle();
    modal.change("input", "Review proposed slides");
    modal.change("textarea", outline);
    modal.change("select", "3");
    modal.render();
    const reads = fixture.request.mock.calls.length;
    modal.props.locale = "de-DE";
    modal.render();
    await modal.settle();
    expect(fixture.request).toHaveBeenCalledTimes(reads);
    expect(modal.nodes().find((node) => node.type === "input")?.props.value).toBe(
      "Review proposed slides",
    );
    expect(modal.nodes().find((node) => node.type === "textarea")?.props.value).toBe(outline);
    await modal.generate();
    const create = fixture.request.mock.calls.find(
      ([path, init]) => String(path).endsWith("/jobs") && init?.method === "POST",
    );
    expect(JSON.parse(String(create?.[1].body))).toEqual({
      schemaVersion: 1,
      presentationId: modal.props.presentationId,
      requestId: job!.id,
      sourceName: "Review proposed slides",
      outline,
      slideCount: 3,
    });
    expect(modal.review().props.proposal.slides[0]!.title).toBe("Review proposed slides");
    expect(modal.markup()).toContain(assistanceCopy("de-DE")("Review proposed slides"));
    expect(modal.props.onInserted).not.toHaveBeenCalled();
    modal.unmount();
  });

  it("preserves selection, review, diagnostics and exact pending insertion bytes across locale and revision changes", async () => {
    const modal = await generateProposal();
    modal.review().props.onSelect(proposal.slides[0]!.id);
    modal.render();
    modal.review().props.onReview(true);
    modal.render();
    expect(modal.review().props.selectedSlideIds).toHaveLength(2);
    const storedBeforeLocale = [...storage.entries()];
    const callsBeforeLocale = fixture.request.mock.calls.length;
    modal.props.locale = "fr-FR";
    modal.render();
    await modal.settle();
    expect(modal.review().props.reviewed).toBe(true);
    expect(modal.review().props.selectedSlideIds).toEqual(
      proposal.slides.slice(1).map((slide) => slide.id),
    );
    expect([...storage.entries()]).toEqual(storedBeforeLocale);
    expect(fixture.request).toHaveBeenCalledTimes(callsBeforeLocale);
    const insert = modal.button(
      assistanceCopy("fr-FR")("Insert {count} reviewed slides", { count: 2 }),
    );
    expect(insert.props.disabled).toBe(false);
    (insert.props.onClick as () => void)();
    await modal.settle();
    const pendingBytes = [...storage.values()][0]!;
    const retained = JSON.parse(pendingBytes);
    expect(retained.insertBody).toBeTypeOf("string");
    expect(modal.markup()).toContain('role="alert" lang="en-CA"');
    expect(modal.markup()).toContain("Network receipt {raw}");
    modal.props.locale = "de-DE";
    modal.props.expectedRevision = 99;
    modal.props.afterBlockId = proposal.slides[0]!.id;
    modal.render();
    await modal.settle();
    expect([...storage.values()][0]).toBe(pendingBytes);
    expect(modal.review().props.disabled).toBe(true);
    expect(modal.review().props.reviewed).toBe(true);
    expect(modal.markup()).toContain(
      assistanceCopy("de-DE")(
        "Insertion was not confirmed. Retry the exact insertion before editing the deck or changing the selection.",
      ),
    );
    expect(modal.markup()).toContain('role="alert" lang="en-CA"');
    (modal.button(assistanceCopy("de-DE")("Retry exact insertion")).props.onClick as () => void)();
    await modal.settle();
    const insertCalls = fixture.request.mock.calls.filter(([path]) =>
      String(path).endsWith("/blocks/assistance-proposals"),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls.map(([, init]) => init.body)).toEqual([
      retained.insertBody,
      retained.insertBody,
    ]);
    expect(JSON.parse(retained.insertBody)).toMatchObject({
      expectedRevision: 4,
      afterBlockId: null,
      reviewed: true,
    });
    expect(modal.props.onInserted).not.toHaveBeenCalled();
    expect(
      fixture.request.mock.calls.filter(
        ([path, init]) => String(path).endsWith("/jobs") && init?.method === "POST",
      ),
    ).toHaveLength(1);
    modal.unmount();
  });

  it("retains stored recovery and frozen choices on remount while localizing recovery feedback", async () => {
    const modal = await generateProposal();
    modal.review().props.onReview(true);
    modal.render();
    (
      modal.button(assistanceCopy("ko-KR")("Insert {count} reviewed slides", { count: 3 })).props
        .onClick as () => void
    )();
    await modal.settle();
    modal.unmount();
    const recoveryBefore = [...storage.values()][0];
    const restored = outlineModal({ locale: "ja-JP" });
    restored.render();
    await restored.settle();
    expect(restored.props.onResumeRequired).toHaveBeenCalledOnce();
    expect(restored.review().props.disabled).toBe(true);
    expect(restored.review().props.selectedSlideIds).toEqual(
      proposal.slides.map((slide) => slide.id),
    );
    expect(restored.review().props.reviewed).toBe(false);
    expect([...storage.values()][0]).toBe(recoveryBefore);
    expect(restored.button(assistanceCopy("ja-JP")("Retry exact insertion")).props.disabled).toBe(
      false,
    );
    const before = fixture.request.mock.calls.length;
    restored.props.locale = "zh-TW";
    restored.render();
    await restored.settle();
    expect(fixture.request).toHaveBeenCalledTimes(before);
    expect([...storage.values()][0]).toBe(recoveryBefore);
    expect(restored.markup()).toContain('lang="zh-TW"');
    restored.unmount();
  });

  it.each([
    { ...availableStatus, enabled: false },
    { ...availableStatus, remaining: 0 },
    { ...availableStatus, active: 2 },
  ])(
    "keeps generation disabled and manual editing guidance in unavailable states",
    async (status) => {
      fixture.request.mockResolvedValue({ status });
      const modal = outlineModal({ locale: "ko-KR" });
      modal.render();
      await modal.settle();
      expect(modal.nodes().find((node) => node.type === "fieldset")?.props.disabled).toBe(true);
      expect(modal.markup()).toContain(
        assistanceCopy("ko-KR")(
          "Only the named outline is sent to the operator-configured provider. Ordinary slide creation and editing remain available without AI.",
        ),
      );
      expect(fixture.request.mock.calls.every(([path]) => String(path).includes("/status?"))).toBe(
        true,
      );
      modal.unmount();
    },
  );

  it.each([
    {
      message: "Slide assistance is temporarily unavailable. Your deck has not changed.",
      translated: true,
    },
    { message: "Operator diagnostic with provider token {raw}", translated: false },
  ])(
    "localizes verified failure messages and preserves rejection of unknown job error payloads",
    async ({ message, translated }) => {
      const modal = await generateProposal();
      job = {
        ...job!,
        status: "failed",
        proposal: null,
        proposalHash: null,
        error: { code: "PROVIDER_UNAVAILABLE", message },
      };
      (modal.button(assistanceCopy("ko-KR")("Recover proposal")).props.onClick as () => void)();
      await modal.settle();
      if (!translated) {
        expect(modal.markup()).toContain(
          assistanceCopy("ko-KR")(
            "The AI proposal receipt could not be verified. Retry the saved request.",
          ),
        );
        expect(modal.markup()).not.toContain(message);
        expect(modal.review().props.proposal).toBeTruthy();
        modal.unmount();
        return;
      }
      expect(modal.markup()).toContain(assistanceCopy("ko-KR")("Proposal failed."));
      expect(modal.markup()).toContain(
        `<span lang="ko-KR">${assistanceCopy("ko-KR")("Slide assistance is temporarily unavailable. Your deck has not changed.")}</span>`,
      );
      modal.unmount();
    },
  );

  it("keeps permission and sign-in fences active with localized labels", async () => {
    const revoked = outlineModal({ locale: "ko-KR", canEdit: false });
    revoked.render();
    await revoked.settle();
    expect(fixture.request).not.toHaveBeenCalled();
    expect(revoked.markup()).toContain(
      assistanceCopy("ko-KR")("Editor permission is required to generate or insert slides."),
    );
    expect(revoked.nodes().find((node) => node.type === "fieldset")?.props.disabled).toBe(true);
    revoked.unmount();
    const modal = await generateProposal();
    events.get(AUTH_CHANGE_EVENT)!();
    modal.render();
    await modal.settle();
    expect(storage.size).toBe(0);
    expect(modal.markup()).toContain(
      assistanceCopy("ko-KR")(
        "Your sign-in changed. Reload the editor before using AI assistance.",
      ),
    );
    const calls = fixture.request.mock.calls.length;
    modal.props.locale = "de-DE";
    modal.render();
    await modal.settle();
    expect(fixture.request).toHaveBeenCalledTimes(calls);
    expect(modal.markup()).toContain(
      assistanceCopy("de-DE")("Reload the editor after a sign-in change."),
    );
    expect(modal.nodes().find((node) => node.type === "fieldset")?.props.disabled).toBe(true);
    modal.unmount();
  });
});
