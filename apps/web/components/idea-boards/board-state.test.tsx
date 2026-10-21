import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as IdeaBoardClientModule from "../../lib/idea-board-client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import { boardFixture, boardGuestFixture, boardId } from "../../test-utils/idea-board";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { BoardHost } from "./board-host";
import { BoardGuest } from "./board-guest";
import { IdeaComposer, type IdeaDraft } from "./idea-composer";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const fixtures = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  hostRead: vi.fn(),
  publicRead: vi.fn(),
  guestRead: vi.fn(),
  command: vi.fn(),
  submitIdea: vi.fn(),
  uploadImage: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!fixtures.hooks) return react.useState(initial);
      const hooks = fixtures.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!fixtures.hooks) return react.useRef(initial);
      const hooks = fixtures.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback) => {
      if (fixtures.hooks) fixtures.hooks.effects.push(effect);
      else react.useEffect(effect);
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: keyof typeof english, values: Record<string, string | number> = {}) =>
      (english[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
        String(values[name] ?? `{${name}}`),
      ),
  }),
}));
vi.mock("../workspace/workspace-provider", () => ({
  useWorkspace: () => ({ creator: { workspaceId: "workspace", role: "owner" }, canEdit: true }),
}));
vi.mock("../workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../brand", () => ({ Brand: () => <span>Polling Pops</span> }));
vi.mock("../../lib/idea-board-client", async (importOriginal) => ({
  ...(await importOriginal<typeof IdeaBoardClientModule>()),
  fetchIdeaBoard: fixtures.hostRead,
  fetchPublicIdeaBoard: fixtures.publicRead,
  fetchGuestIdeaBoard: fixtures.guestRead,
  commandIdeaBoard: fixtures.command,
  submitBoardIdea: fixtures.submitIdea,
  uploadIdeaBoardImage: fixtures.uploadImage,
}));

function harness(render: () => ReactElement) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  const cleanup: Array<() => void> = [];
  return {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      fixtures.hooks = hooks;
      try {
        tree = render();
      } finally {
        fixtures.hooks = null;
      }
      return renderToStaticMarkup(tree);
    },
    mount() {
      for (const effect of hooks.effects) {
        const result = effect();
        if (result) cleanup.push(result);
      }
    },
    find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
      function visit(node: ReactNode): ReactElement<Record<string, unknown>> | undefined {
        if (Array.isArray(node)) {
          for (const child of node) {
            const found = visit(child);
            if (found) return found;
          }
          return;
        }
        if (!isValidElement<Record<string, unknown>>(node)) return;
        return predicate(node) ? node : visit(node.props.children as ReactNode);
      }
      const result = visit(tree);
      if (!result) throw new Error("Control missing");
      return result;
    },
    unmount() {
      cleanup.forEach((effect) => effect());
    },
  };
}
async function settle() {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubGlobal("window", {
    location: { origin: "http://localhost" },
    localStorage: { getItem: () => "ab".repeat(32) },
  });
});
afterEach(() => {
  fixtures.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("idea board async state", () => {
  it.each([
    { name: "a server failure", failure: new ApiClientError("Try again", "INTERNAL_ERROR", 503) },
    { name: "an unknown network outcome", failure: new TypeError("Connection lost") },
  ])("retries the original rich idea snapshot after $name", async ({ failure }) => {
    fixtures.publicRead.mockResolvedValue(boardFixture);
    fixtures.guestRead.mockResolvedValue(boardGuestFixture);
    let rejectSubmission!: (error: unknown) => void;
    fixtures.submitIdea
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSubmission = reject;
          }),
      )
      .mockResolvedValueOnce(boardGuestFixture);
    const imageId = "00000000-0000-4000-8000-000000000010";
    const draft: IdeaDraft = {
      body: "  Explain the rich idea  ",
      attachments: [{ mediaId: imageId, alt: "An already uploaded diagram" }],
      links: [
        { url: "https://example.com/post", label: "A useful caption", imageMediaId: imageId },
      ],
      sketch: {
        schemaVersion: 1,
        width: 1000,
        height: 600,
        elements: [
          {
            id: "00000000-0000-4000-8000-000000000011",
            type: "text",
            x: 30,
            y: 40,
            text: "Original diagram label",
            color: "blue",
            strokeWidth: 2,
            fontSize: 24,
          },
          {
            id: "00000000-0000-4000-8000-000000000012",
            type: "freehand",
            color: "ink",
            strokeWidth: 4,
            points: [
              [10, 20],
              [30, 40],
            ],
          },
        ],
      },
    };
    const expectedDraft = structuredClone(draft);
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    const initialComposer = view.find((element) => element.type === IdeaComposer);
    (initialComposer.props.onChange as (value: IdeaDraft) => void)(draft);
    view.render();
    const composer = view.find((element) => element.type === IdeaComposer);
    (composer.props.onSubmit as () => void)();
    expect(fixtures.submitIdea).toHaveBeenCalledTimes(1);
    const originalInput = fixtures.submitIdea.mock.calls[0]![2];
    const expectedInput = {
      schemaVersion: 1,
      idempotencyKey: originalInput.idempotencyKey,
      ...expectedDraft,
      body: expectedDraft.body.trim(),
    };
    expect(originalInput.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(originalInput).toEqual(expectedInput);

    // Parent state keeps its own submission intent even if a caller later mutates the draft.
    draft.body = "Changed after starting";
    draft.attachments[0]!.alt = "Changed image description";
    draft.attachments.push({ mediaId: "00000000-0000-4000-8000-000000000013", alt: "New image" });
    draft.links[0]!.label = "Changed caption";
    draft.links[0]!.imageMediaId = "00000000-0000-4000-8000-000000000013";
    const originalText = draft.sketch!.elements[0]!;
    if (originalText.type === "text") originalText.text = "Changed drawing text";
    const originalStroke = draft.sketch!.elements[1]!;
    if (originalStroke.type === "freehand") originalStroke.points[0]![0] = 999;
    draft.sketch!.elements.reverse();
    expect(originalInput).toEqual(expectedInput);
    rejectSubmission(failure);
    await settle();
    expect(view.render()).toContain("The request could not finish");
    expect(view.find((element) => element.type === IdeaComposer).props.disabled).toBe(true);
    const retry = view.find(
      (element) => element.type === "button" && element.props.children === "Retry",
    );
    (retry.props.onClick as () => void)();
    await settle();
    expect(fixtures.submitIdea).toHaveBeenCalledTimes(2);
    expect(fixtures.submitIdea.mock.calls[1]![2]).toEqual(expectedInput);
    expect(fixtures.submitIdea.mock.calls[1]![2].idempotencyKey).toBe(originalInput.idempotencyKey);
    expect(fixtures.uploadImage).not.toHaveBeenCalled();
    expect(view.render()).toContain(english["boards.submitted"]);
    expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual({
      body: "",
      attachments: [],
      links: [],
      sketch: null,
    });
    view.unmount();
  });

  it("preserves a rejected stale command and rebases it only after an explicit retry", async () => {
    const group = { id: "00000000-0000-4000-8000-000000000008", name: "Synthetic group" };
    const initial = { ...boardFixture, groups: [group] };
    fixtures.hostRead.mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, revision: 5 });
    fixtures.command
      .mockRejectedValueOnce(new ApiClientError("Changed", "STALE_DRAFT", 409))
      .mockResolvedValue({
        ...initial,
        revision: 6,
        ideas: [{ ...initial.ideas[0]!, groupId: group.id }],
      });
    const view = harness(() => BoardHost({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    const select = view.find((element) => element.type === "select");
    (select.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: group.id },
    });
    await settle();
    expect(fixtures.command).toHaveBeenCalledTimes(1);
    expect(view.render()).toContain("The request could not finish");
    const retry = view.find(
      (element) => element.type === "button" && element.props.children === "Retry",
    );
    (retry.props.onClick as () => void)();
    await settle();
    expect(fixtures.command).toHaveBeenCalledTimes(2);
    const original = fixtures.command.mock.calls[0]![1];
    const retried = fixtures.command.mock.calls[1]![1];
    expect(original.expectedRevision).toBe(1);
    expect(retried.expectedRevision).toBe(5);
    expect(retried.command).toEqual(original.command);
    expect(retried.idempotencyKey).not.toBe(original.idempotencyKey);
    expect(view.render()).toContain('value="00000000-0000-4000-8000-000000000008" selected=""');
    view.unmount();
  });

  it.each(["host", "guest"] as const)(
    "keeps revalidating a closed %s board and clears retained text after deletion",
    async (kind) => {
      const closed = { ...boardFixture, status: "closed" as const, countsVisible: true };
      const missing = new ApiClientError("Deleted", "NOT_FOUND", 404);
      fixtures.hostRead.mockResolvedValueOnce(closed).mockRejectedValue(missing);
      fixtures.publicRead.mockResolvedValueOnce(closed).mockRejectedValue(missing);
      fixtures.guestRead.mockResolvedValue({ ...boardGuestFixture, board: closed });
      const view = harness(() =>
        kind === "host" ? BoardHost({ id: boardId }) : BoardGuest({ id: boardId }),
      );
      view.render();
      view.mount();
      await settle();
      expect(view.render()).toContain("Synthetic accessible idea");
      await vi.advanceTimersByTimeAsync(5_000);
      await settle();
      expect(view.render()).not.toContain("Synthetic accessible idea");
      view.unmount();
    },
  );

  it.each(["host", "guest"] as const)(
    "clears a closed %s board when an explicit refresh reports expiry",
    async (kind) => {
      const closed = { ...boardFixture, status: "closed" as const, countsVisible: true };
      const expired = new ApiClientError("Expired", "NOT_FOUND", 410);
      fixtures.hostRead.mockResolvedValueOnce(closed).mockRejectedValue(expired);
      fixtures.publicRead.mockResolvedValueOnce(closed).mockRejectedValue(expired);
      fixtures.guestRead.mockResolvedValue({ ...boardGuestFixture, board: closed });
      const view = harness(() =>
        kind === "host" ? BoardHost({ id: boardId }) : BoardGuest({ id: boardId }),
      );
      view.render();
      view.mount();
      await settle();
      expect(view.render()).toContain("Synthetic accessible idea");
      const refresh = view.find(
        (element) => element.type === "button" && element.props.children === "Refresh",
      );
      (refresh.props.onClick as () => void)();
      await settle();
      expect(view.render()).not.toContain("Synthetic accessible idea");
      view.unmount();
    },
  );
});
