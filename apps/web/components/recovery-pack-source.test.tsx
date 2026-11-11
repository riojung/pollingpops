import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packSourceCopy } from "../lib/i18n/pack-source-copy";
import { sourcePackFixtures } from "../test-utils/recovery-pack-source";
import {
  PackSourceContentView,
  RecoveryPackSourceProposalPanel,
  RecoveryPackSourceReviewPanel,
} from "./recovery-pack-source";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mountedHooks = vi.hoisted(() => ({ current: null as Hooks | null }));
vi.mock("react", async (original) => {
  const actual = await original<typeof ReactModule>();
  return {
    ...actual,
    useId: () => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useId();
      const index = hooks.cursor++;
      hooks.slots[index] ??= `mounted-${index}`;
      return hooks.slots[index];
    },
    useRef: <T,>(initial: T) => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      const hooks = mountedHooks.current;
      if (!hooks) return actual.useEffect(effect, dependencies);
      const index = hooks.cursor++,
        previous = hooks.dependencies.get(index);
      if (
        !hooks.dependencies.has(index) ||
        !dependencies ||
        dependencies.some((value, i) => value !== previous?.[i])
      )
        hooks.effects.push({ index, effect });
      hooks.dependencies.set(index, dependencies);
    },
  };
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? nodeText(node.props.children) : "";
}
const mounted = new Set<{ close: () => void }>();
function mount<Props>(Component: (props: Props) => ReactNode, initial: Props) {
  let props = initial;
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  function render(next = props) {
    props = next;
    hooks.cursor = 0;
    hooks.effects = [];
    mountedHooks.current = hooks;
    let tree: ReactNode;
    try {
      tree = Component(props);
    } finally {
      mountedHooks.current = null;
    }
    const nodes = elements(tree);
    for (const node of nodes) {
      const ref = node.props.ref as { current?: unknown } | undefined;
      if (ref && typeof ref === "object" && !ref.current) ref.current = { focus: vi.fn() };
    }
    for (const { index, effect } of hooks.effects) {
      hooks.cleanups.get(index)?.();
      hooks.cleanups.set(index, effect());
    }
    return nodes;
  }
  const view = {
    render,
    text: () => nodeText(render()[0]),
    button(label: string) {
      const button = render().find(
        (node) => node.type === "button" && nodeText(node.props.children as ReactNode) === label,
      );
      expect(button, label).toBeDefined();
      return button!;
    },
    click(label: string) {
      const button = view.button(label);
      expect(button.props.disabled).not.toBe(true);
      (button.props.onClick as () => void)();
    },
    close() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(view);
    },
  };
  mounted.add(view);
  render();
  return view;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  for (const view of [...mounted]) view.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("source Pack review components", () => {
  it("shows every item and global citation, full answer keys, and source excerpts as wrapping plaintext", () => {
    const { draft } = sourcePackFixtures();
    const markup = renderToStaticMarkup(<PackSourceContentView draft={draft} />);
    for (const visible of [
      "Source diagnostic",
      "Source linked recheck",
      "Private explanation",
      "Facilitator guidance",
      "Global Pack citations",
      'Accepted value: <span lang="">4</span>',
      "Source digest:",
      "paragraph 1",
    ])
      expect(markup).toContain(visible);
    expect(markup.match(/Divide a whole into two equal groups/g)).toHaveLength(4);
    expect(markup).toContain("&lt;script&gt;plain text&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("min-width:0;overflow-wrap:anywhere");
    // Proposal and saved review can be open together: nested items must not
    // produce duplicate landmarks with the same source-item names.
    expect(markup.match(/<section[^>]*role="group"/g)).toHaveLength(3);
  });

  it.each(["dirty", "viewer", "paused", "unchecked"])(
    "blocks %s approval while the saved source stays readable",
    (mode) => {
      const { pack, draft } = sourcePackFixtures();
      const markup = renderToStaticMarkup(
        <RecoveryPackSourceReviewPanel
          pack={pack}
          draft={draft}
          dirty={mode === "dirty"}
          invalidated={false}
          canEdit={mode !== "viewer" && mode !== "paused"}
          busy={false}
          contentChecked={false}
          citationsChecked={false}
          onContentChecked={vi.fn()}
          onCitationsChecked={vi.fn()}
          onApprove={vi.fn()}
        />,
      );
      expect(markup).toContain("Review complete Pack content and every citation");
      expect(markup).toContain(
        "I reviewed the full saved content, answer keys, and facilitator guidance.",
      );
      expect(markup).toContain("I verified every citation and excerpt against the source.");
      expect(markup).toMatch(/disabled=""[^>]*>Approve saved content and citations/);
      expect(markup).not.toContain('checked=""');
      if (mode === "dirty") expect(markup).toContain("Save your edits before reviewing");
      if (mode === "paused" || mode === "viewer")
        expect(markup).toContain("paused Pack authoring prevents approval");
    },
  );

  it("invalidates a prior approval immediately on edits, and keeps manual Pack behavior unchanged", () => {
    const { approvedPack, draft, pack } = sourcePackFixtures();
    const props = {
      draft,
      dirty: false,
      invalidated: false,
      canEdit: true,
      busy: false,
      contentChecked: false,
      citationsChecked: false,
      onContentChecked: vi.fn(),
      onCitationsChecked: vi.fn(),
      onApprove: vi.fn(),
    };
    expect(
      renderToStaticMarkup(<RecoveryPackSourceReviewPanel {...props} pack={approvedPack} />),
    ).toContain("has content and citation approval");
    expect(
      renderToStaticMarkup(
        <RecoveryPackSourceReviewPanel {...props} pack={approvedPack} invalidated />,
      ),
    ).toContain("needs content and citation approval");
    expect(
      renderToStaticMarkup(<RecoveryPackSourceReviewPanel {...props} pack={approvedPack} dirty />),
    ).toContain("Save your edits");
    const manual = { ...pack };
    delete manual.sourceReview;
    expect(renderToStaticMarkup(<RecoveryPackSourceReviewPanel {...props} pack={manual} />)).toBe(
      "",
    );
  });

  it("fetches no proposal on render and exposes a read-only review action for viewers", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { job } = sourcePackFixtures();
    const target = {
      disabled: false,
      beforeCreate: vi.fn(),
      onCreated: vi.fn(),
      onBusyChange: vi.fn(),
    };
    const markup = renderToStaticMarkup(
      <RecoveryPackSourceProposalPanel job={job} canEdit={false} target={target} />,
    );
    expect(markup).toContain("Review Pack source proposal");
    expect(markup).not.toContain("Create source Pack draft</button>");
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});

describe("mounted source proposal and explicit review across locale changes", () => {
  it("retains a pending source, checks current permission in captured controls, and retries exact bytes using current callbacks", async () => {
    const { job, proposal, pack } = sourcePackFixtures();
    const preview = deferred<Response>();
    const firstCreate = deferred<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(preview.promise)
      .mockReturnValueOnce(firstCreate.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ pack })));
    vi.stubGlobal("fetch", fetch);
    const target = {
      disabled: false,
      beforeCreate: vi.fn(() => true),
      onCreated: vi.fn(),
      onBusyChange: vi.fn(),
    };
    const props = { job, canEdit: true, target, locale: "en-CA" as const };
    const view = mount<Parameters<typeof RecoveryPackSourceProposalPanel>[0]>(
      RecoveryPackSourceProposalPanel,
      props,
    );
    view.click("Review Pack source proposal");
    expect(fetch).toHaveBeenCalledTimes(1);
    const signal = fetch.mock.calls[0]![1].signal as AbortSignal;
    view.render({ ...props, locale: "ko-KR" });
    expect(view.text()).toContain(packSourceCopy("ko-KR")("Loading the source Pack proposal…"));
    expect(signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    preview.resolve(new Response(JSON.stringify({ proposal })));
    await vi.waitFor(() =>
      expect(view.button(packSourceCopy("ko-KR")("Create source Pack draft")).props.disabled).toBe(
        false,
      ),
    );
    const capturedCreate = view.button(packSourceCopy("ko-KR")("Create source Pack draft")).props
      .onClick as () => void;
    view.render({ ...props, locale: "de-DE", canEdit: false });
    capturedCreate();
    expect(fetch).toHaveBeenCalledTimes(1);
    const currentTarget = { ...target, onCreated: vi.fn(), onBusyChange: vi.fn() };
    view.render({ ...props, target: currentTarget, locale: "ko-KR" });
    view.click(packSourceCopy("ko-KR")("Create source Pack draft"));
    const creationSignal = fetch.mock.calls[1]![1].signal as AbortSignal;
    view.render({ ...props, target: currentTarget, locale: "de-DE" });
    expect(view.text()).toContain(packSourceCopy("de-DE")("Creating an unpublished Pack draft…"));
    expect(creationSignal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    firstCreate.reject(new Error("Unrecognized private diagnostic <raw>"));
    await vi.waitFor(() => expect(view.text()).toContain("Unrecognized private diagnostic <raw>"));
    const alert = view.render().find((node) => node.props.role === "alert")!;
    expect(alert.props.lang).toBe("en-CA");
    view.click(packSourceCopy("de-DE")("Retry creating source Pack draft"));
    await vi.waitFor(() => expect(currentTarget.onCreated).toHaveBeenCalledWith(pack));
    expect(target.onCreated).not.toHaveBeenCalled();
    expect(fetch.mock.calls[1]![1].body).toBe(fetch.mock.calls[2]![1].body);
    const request = JSON.parse(fetch.mock.calls[2]![1].body);
    expect(request.draft).toEqual(proposal.draft);
    expect(request.expectedContentHash).toBe(proposal.contentHash);
    expect(request).not.toHaveProperty("locale");
    expect(currentTarget.onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(proposal.draft).toEqual(sourcePackFixtures().draft);
  });

  it("keeps approval checks, mandatory review and authored text across locale rerenders", () => {
    const { pack, draft } = sourcePackFixtures();
    const props = {
      pack,
      draft,
      dirty: false,
      invalidated: false,
      canEdit: true,
      busy: false,
      contentChecked: true,
      citationsChecked: true,
      onContentChecked: vi.fn(),
      onCitationsChecked: vi.fn(),
      onApprove: vi.fn(),
      locale: "en-CA" as const,
    };
    const view = mount<Parameters<typeof RecoveryPackSourceReviewPanel>[0]>(
      RecoveryPackSourceReviewPanel,
      props,
    );
    view.render({ ...props, locale: "ko-KR" });
    expect(
      view
        .render()
        .filter((node) => node.type === "input")
        .map((node) => node.props.checked),
    ).toEqual([true, true]);
    expect(props.onApprove).not.toHaveBeenCalled();
    expect(view.text()).toContain(
      packSourceCopy("ko-KR")(
        "Saved revision {revision} needs content and citation approval before publishing.",
        { revision: pack.draftRevision },
      ),
    );
    view.render({ ...props, locale: "de-DE", canEdit: false });
    expect(view.render().find((node) => node.type === "fieldset")!.props.disabled).toBe(true);
    expect(view.text()).toContain(
      packSourceCopy("de-DE")(
        "Source review is readable. Your workspace role or paused Pack authoring prevents approval.",
      ),
    );
    expect(props.onContentChecked).not.toHaveBeenCalled();
    expect(props.onCitationsChecked).not.toHaveBeenCalled();
    expect(pack.sourceReview?.approved).toBe(false);
  });

  it("preserves authored content even when it exactly matches system controls or enum values", () => {
    const { draft } = sourcePackFixtures();
    draft.title = "Create source Pack draft";
    draft.description = "Source content and citation review";
    draft.interventions[0]!.title = "diagnostic";
    draft.interventions[0]!.body = "Global Pack citations";
    draft.citations[0]!.excerpt = "Approve saved content and citations";
    const before = structuredClone(draft);
    const markup = renderToStaticMarkup(<PackSourceContentView draft={draft} locale="ko-KR" />);
    for (const text of [
      draft.title,
      draft.description,
      draft.interventions[0]!.body,
      draft.citations[0]!.excerpt,
    ])
      expect(markup).toContain(`lang="">${text}<`);
    expect(markup).toContain(packSourceCopy("ko-KR")("Source diagnostic"));
    expect(draft).toEqual(before);
  });
});
