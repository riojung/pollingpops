import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as IdeaBoardClientModule from "../../lib/idea-board-client";
import type { IdeaBoardGuestView } from "@openround/contracts";
import { CanvasBoardGuestViewSchema, IdeaBoardCanvasSchema } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import { boardFixture, boardGuestFixture, boardId } from "../../test-utils/idea-board";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { BoardHost } from "./board-host";
import { BoardGuest } from "./board-guest";
import { emptyIdeaDraft, IdeaComposer, type IdeaDraft } from "./idea-composer";
import { IdeaBoardIdeas } from "./idea-list";
import { PublishedWorkshopCanvas } from "../canvas-boards/workshop-canvas-bridge";
import { IdeaCanvasComposer } from "./idea-canvas-composer";

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
  submitVotes: vi.fn(),
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
  submitBoardVotes: fixtures.submitVotes,
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
  it("defaults desktop participation open, keeps its draft mounted, and respects explicit collapse", async () => {
    Object.assign(window, { innerWidth: 1280, matchMedia: () => ({ matches: true }) });
    fixtures.publicRead.mockResolvedValue(boardFixture);
    fixtures.guestRead.mockResolvedValue(boardGuestFixture);
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    const draft = { ...emptyIdeaDraft(), body: "Private draft that survives closing the panel" };
    (
      view.find((element) => element.type === IdeaComposer).props.onChange as (
        draft: IdeaDraft,
      ) => void
    )(draft);
    view.render();
    const availability = view.find((element) => element.type === PublishedWorkshopCanvas).props
      .onAvailabilityChange as (available: boolean) => void;
    availability(true);
    view.render();
    expect(view.find((element) => element.type === "main").props["data-canvas"]).toBe(true);
    expect(view.find((element) => element.type === "aside").props.hidden).toBe(false);
    const trigger = view.find(
      (element) =>
        element.type === "button" &&
        element.props["aria-label"] ===
          "Your participation Submit idea — Close participation panel",
    );
    const focus = vi.fn();
    (trigger.props.ref as { current: unknown }).current = { focus };
    expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual(draft);
    (
      view.find(
        (element) =>
          element.type === "button" &&
          element.props["aria-label"] ===
            "Your participation Submit idea — Close participation panel",
      ).props.onClick as () => void
    )();
    view.render();
    expect(view.find((element) => element.type === "aside").props.hidden).toBe(true);
    expect(view.render()).toContain("Continue your idea");
    expect(focus).toHaveBeenCalledOnce();
    expect(fixtures.submitIdea).not.toHaveBeenCalled();
    availability(false);
    view.render();
    availability(true);
    view.render();
    expect(view.find((element) => element.type === "aside").props.hidden).toBe(true);
    const open = view.find(
      (element) =>
        element.type === "button" && element.props["aria-label"] === "Continue your idea",
    );
    (open.props.onClick as () => void)();
    view.render();
    expect(() => view.find((element) => element.type === IdeaComposer)).toThrow("Control missing");
    const renderCanvas = view.find((element) => element.type === PublishedWorkshopCanvas).props
      .renderCanvas as (context: unknown) => ReactElement<Record<string, unknown>>;
    const composer = renderCanvas({
      board: CanvasBoardGuestViewSchema.parse({
        schemaVersion: 4,
        id: boardId,
        sourceBoardId: boardId,
        canvasSeq: 1,
        status: "active",
        objects: [],
        sourceBoard: boardGuestFixture.board,
      }),
      onInteract: vi.fn(),
    });
    expect(composer.type).toBe(IdeaCanvasComposer);
    expect(composer.props.value).toEqual(draft);
    (composer.props.onClose as () => void)();
    expect(view.render()).toContain("Continue your idea");
    view.unmount();
  });
  it("submits the final private canvas atomically and retries its exact intent inside the editor", async () => {
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
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    (
      view.find((element) => element.type === PublishedWorkshopCanvas).props
        .onAvailabilityChange as (value: boolean) => void
    )(true);
    view.render();
    (
      view.find(
        (element) => element.type === "button" && element.props["aria-label"] === "Create an idea",
      ).props.onClick as () => void
    )();
    view.render();
    const currentComposer = () => {
      const renderCanvas = view.find((element) => element.type === PublishedWorkshopCanvas).props
        .renderCanvas as (context: unknown) => ReactElement<Record<string, unknown>>;
      return renderCanvas({
        board: CanvasBoardGuestViewSchema.parse({
          schemaVersion: 4,
          id: boardId,
          sourceBoardId: boardId,
          canvasSeq: 1,
          status: "active",
          objects: [],
          sourceBoard: boardGuestFixture.board,
        }),
        onInteract: vi.fn(),
      });
    };
    const composer = currentComposer();
    const canvas = IdeaBoardCanvasSchema.parse({
      schemaVersion: 1,
      x: 400,
      y: 300,
      width: 200,
      height: 160,
      objects: [
        {
          id: "00000000-0000-4000-8000-000000000033",
          type: "sticky",
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          text: "Fresh visual idea",
        },
      ],
    });
    const finalDraft = { ...emptyIdeaDraft(), body: "Fresh composition title", canvas };
    (composer.props.onChange as (value: IdeaDraft) => void)(finalDraft);
    (composer.props.onSubmit as (value: IdeaDraft) => void)(finalDraft);
    expect(fixtures.submitIdea).toHaveBeenCalledOnce();
    expect(fixtures.submitIdea.mock.calls[0]![2]).toMatchObject({
      body: finalDraft.body,
      canvas,
      roundNumber: 1,
    });
    expect(fixtures.submitIdea.mock.calls[0]![2].canvas).not.toBe(canvas);
    expect(fixtures.submitIdea.mock.calls[0]![2].canvas.objects).not.toBe(canvas.objects);
    const expectedInput = structuredClone(fixtures.submitIdea.mock.calls[0]![2]);
    view.render();
    expect(currentComposer().props).toMatchObject({
      disabled: true,
      collectionClosed: false,
      submitting: true,
    });
    rejectSubmission(new ApiClientError("Try again", "INTERNAL_ERROR", 503));
    await settle();
    view.render();
    const retryComposer = currentComposer();
    expect(retryComposer.props).toMatchObject({
      disabled: true,
      collectionClosed: false,
      submitting: false,
      submissionError: english["boards.error"],
    });
    expect(retryComposer.props.value).toEqual(finalDraft);
    (retryComposer.props.onRetry as () => void)();
    await settle();
    expect(fixtures.submitIdea.mock.calls[1]![2]).toEqual(expectedInput);
    expect(view.render()).toContain(english["boards.submitted"]);
    view.unmount();
  });
  it("keeps focused mobile intake visible when the first published canvas arrives", async () => {
    Object.assign(window, { innerWidth: 390, matchMedia: () => ({ matches: false }) });
    const input = { value: "An idea being composed" };
    vi.stubGlobal("document", { activeElement: input });
    fixtures.publicRead.mockResolvedValue(boardFixture);
    fixtures.guestRead.mockResolvedValue(boardGuestFixture);
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    (view.find((element) => element.type === "aside").props.ref as { current: unknown }).current = {
      contains: (node: unknown) => node === input,
    };
    (
      view.find((element) => element.type === PublishedWorkshopCanvas).props
        .onAvailabilityChange as (available: boolean) => void
    )(true);
    view.render();
    expect(view.find((element) => element.type === "aside").props.hidden).toBe(false);
    expect(view.find((element) => element.type === "aside").props.inert).toBe(false);
    expect(document.activeElement).toBe(input);
    view.unmount();
  });
  it("offers a visible named participation action and phase cue when mobile intake starts collapsed", async () => {
    Object.assign(window, { innerWidth: 320, matchMedia: () => ({ matches: false }) });
    fixtures.publicRead.mockResolvedValue(boardFixture);
    fixtures.guestRead.mockResolvedValue(boardGuestFixture);
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    (
      view.find((element) => element.type === PublishedWorkshopCanvas).props
        .onAvailabilityChange as (available: boolean) => void
    )(true);
    view.render();
    expect(view.find((element) => element.type === "aside").props.hidden).toBe(true);
    const trigger = view.find(
      (element) =>
        element.type === "button" &&
        element.props["aria-label"] === "Your participation Submit idea — Open participation panel",
    );
    const markup = renderToStaticMarkup(trigger);
    expect(markup).toContain("Your participation");
    expect(markup).toContain("Submit idea");
    expect(trigger.props["aria-expanded"]).toBe(false);
    (trigger.props.onClick as () => void)();
    view.render();
    expect(view.find((element) => element.type === "aside").props.hidden).toBe(false);
    view.unmount();
  });
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
      roundNumber: boardGuestFixture.board.roundNumber,
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
    expect(fixtures.submitIdea.mock.calls[1]![3]).not.toBe(fixtures.submitIdea.mock.calls[0]![3]);
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

  it.each([
    { kind: "idea", late: "success" },
    { kind: "idea", late: "failure" },
    { kind: "votes", late: "success" },
    { kind: "votes", late: "failure" },
  ] as const)(
    "retires a hung $kind on round change and ignores its late $late while a new request is pending",
    async ({ kind, late }) => {
      const first: IdeaBoardGuestView = {
        ...boardGuestFixture,
        board: {
          ...boardGuestFixture.board,
          status: kind === "idea" ? "collecting" : "voting",
          roundNumber: 1,
          revision: 3,
        },
      };
      const second: IdeaBoardGuestView = {
        ...first,
        revision: 1,
        board: { ...first.board, title: "Reopened current round", roundNumber: 2, revision: 5 },
      };
      const ideaId = boardFixture.ideas[0]!.id;
      const receipt: IdeaBoardGuestView = {
        ...second,
        revision: kind === "votes" ? 2 : second.revision,
        hasVoted: kind === "votes",
        votedIdeaIds: kind === "votes" ? [ideaId] : [],
      };
      let resolveOld!: (value: IdeaBoardGuestView) => void;
      let rejectOld!: (error: unknown) => void;
      let resolveNew!: (value: IdeaBoardGuestView) => void;
      const submit = kind === "idea" ? fixtures.submitIdea : fixtures.submitVotes;
      // Deliberately ignore abort, modelling an already accepted request or an unresponsive
      // transport. Retirement must not depend on its promise settling.
      submit
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              resolveOld = resolve;
              rejectOld = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveNew = resolve;
            }),
        );
      fixtures.publicRead.mockResolvedValue(first.board);
      fixtures.guestRead.mockResolvedValue(first);
      const view = harness(() => BoardGuest({ id: boardId }));
      const draft = {
        ...emptyIdeaDraft(),
        body: "Private draft retained while the old request hangs",
      };
      function selectIdea() {
        (
          view.find((element) => element.type === IdeaBoardIdeas).props.onSelect as (
            id: string,
            checked: boolean,
          ) => void
        )(ideaId, true);
      }
      function submitCurrent() {
        if (kind === "idea")
          (view.find((element) => element.type === IdeaComposer).props.onSubmit as () => void)();
        else
          (
            view.find((element) => element.type === "form").props.onSubmit as (
              event: unknown,
            ) => void
          )({ preventDefault: vi.fn() });
      }
      function isDisabled() {
        return view.find(
          (element) => element.type === (kind === "idea" ? IdeaComposer : IdeaBoardIdeas),
        ).props.disabled;
      }
      view.render();
      view.mount();
      await settle();
      view.render();
      const pollSignal = fixtures.guestRead.mock.calls[0]![2] as AbortSignal;
      if (kind === "idea")
        (
          view.find((element) => element.type === IdeaComposer).props.onChange as (
            draft: IdeaDraft,
          ) => void
        )(draft);
      else selectIdea();
      view.render();
      submitCurrent();
      view.render();
      expect(submit).toHaveBeenCalledOnce();
      expect(isDisabled()).toBe(true);
      const oldSignal = submit.mock.calls[0]![3] as AbortSignal;
      expect(oldSignal).not.toBe(pollSignal);

      fixtures.publicRead.mockResolvedValue(second.board);
      fixtures.guestRead.mockResolvedValue(second);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(view.render()).toContain("Reopened current round");
      expect(oldSignal.aborted).toBe(true);
      expect(pollSignal.aborted).toBe(false);
      expect(fixtures.guestRead.mock.calls.at(-1)![2]).toBe(pollSignal);
      expect(isDisabled()).toBe(false);
      if (kind === "idea")
        expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual(draft);
      else {
        expect(view.find((element) => element.type === IdeaBoardIdeas).props.selected).toEqual([]);
        selectIdea();
        view.render();
      }
      // Start the new-round request before resolving or rejecting the hung old one.
      submitCurrent();
      view.render();
      expect(submit).toHaveBeenCalledTimes(2);
      const nextInput = structuredClone(submit.mock.calls[1]![2]);
      expect(nextInput.roundNumber).toBe(2);
      expect(nextInput.idempotencyKey).not.toBe(submit.mock.calls[0]![2].idempotencyKey);
      const nextSignal = submit.mock.calls[1]![3] as AbortSignal;
      expect(nextSignal).not.toBe(oldSignal);
      expect(isDisabled()).toBe(true);

      if (late === "success")
        resolveOld({
          ...first,
          hasVoted: kind === "votes",
          votedIdeaIds: kind === "votes" ? [ideaId] : [],
        });
      else rejectOld(new ApiClientError("Late old request failure", "INTERNAL_ERROR", 503));
      await settle();
      const markup = view.render();
      expect(markup).not.toContain(english["boards.error"]);
      expect(markup).not.toContain(english["boards.submitted"]);
      expect(markup).not.toContain(english["boards.voteReceipt"]);
      expect(markup).toContain("Reopened current round");
      expect(isDisabled()).toBe(true);
      expect(nextSignal.aborted).toBe(false);
      expect(submit.mock.calls[1]![2]).toEqual(nextInput);
      // A late old finally must not release the current request's UI lock or ownership.
      submitCurrent();
      view.render();
      expect(submit).toHaveBeenCalledTimes(2);
      expect(isDisabled()).toBe(true);
      resolveNew(receipt);
      await settle();
      const saved = view.render();
      expect(saved).toContain(english[kind === "idea" ? "boards.submitted" : "boards.voteReceipt"]);
      expect(
        view.find(
          (element) => element.type === "button" && element.props["aria-label"] === "Refresh",
        ).props.disabled,
      ).toBe(false);
      if (kind === "idea")
        expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual(
          emptyIdeaDraft(),
        );
      expect(submit).toHaveBeenCalledTimes(2);
      view.unmount();
    },
  );

  it("retries an unknown same-round ballot outcome with the exact envelope and a new mutation signal", async () => {
    const current: IdeaBoardGuestView = {
      ...boardGuestFixture,
      revision: 3,
      board: { ...boardGuestFixture.board, status: "voting", roundNumber: 2, revision: 7 },
    };
    const ideaId = boardFixture.ideas[0]!.id;
    fixtures.publicRead.mockResolvedValue(current.board);
    fixtures.guestRead.mockResolvedValue(current);
    fixtures.submitVotes
      .mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockResolvedValueOnce({ ...current, revision: 4, hasVoted: true, votedIdeaIds: [ideaId] });
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    (
      view.find((element) => element.type === IdeaBoardIdeas).props.onSelect as (
        id: string,
        checked: boolean,
      ) => void
    )(ideaId, true);
    view.render();
    (view.find((element) => element.type === "form").props.onSubmit as (event: unknown) => void)({
      preventDefault: vi.fn(),
    });
    await settle();
    expect(view.render()).toContain(english["boards.error"]);
    expect(view.find((element) => element.type === IdeaBoardIdeas).props.disabled).toBe(true);
    const original = structuredClone(fixtures.submitVotes.mock.calls[0]![2]);
    expect(original).toMatchObject({ expectedRevision: 3, roundNumber: 2, ideaIds: [ideaId] });
    (
      view.find((element) => element.type === "button" && element.props.children === "Retry").props
        .onClick as () => void
    )();
    await settle();
    expect(fixtures.submitVotes).toHaveBeenCalledTimes(2);
    expect(fixtures.submitVotes.mock.calls[1]![2]).toEqual(original);
    expect(fixtures.submitVotes.mock.calls[1]![3]).not.toBe(fixtures.submitVotes.mock.calls[0]![3]);
    expect(view.render()).toContain(english["boards.voteReceipt"]);
    view.unmount();
  });

  it("keeps the private draft across a reopened round and ignores a late old idea receipt", async () => {
    const first = {
      ...boardGuestFixture,
      board: { ...boardGuestFixture.board, roundNumber: 1, revision: 3 },
      hasVoted: false,
    };
    const second = {
      ...boardGuestFixture,
      revision: 1,
      hasVoted: false,
      board: { ...boardGuestFixture.board, roundNumber: 2, revision: 5 },
    };
    fixtures.publicRead.mockResolvedValue(first.board);
    fixtures.guestRead.mockResolvedValue(first);
    let resolveOld!: (value: IdeaBoardGuestView) => void;
    fixtures.submitIdea
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(second);
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    const draft = { ...emptyIdeaDraft(), body: "A private idea kept through reopening" };
    (
      view.find((element) => element.type === IdeaComposer).props.onChange as (
        draft: IdeaDraft,
      ) => void
    )(draft);
    view.render();
    (view.find((element) => element.type === IdeaComposer).props.onSubmit as () => void)();
    expect(fixtures.submitIdea.mock.calls[0]![2].roundNumber).toBe(1);
    fixtures.publicRead.mockResolvedValue(second.board);
    fixtures.guestRead.mockResolvedValue(second);
    await vi.advanceTimersByTimeAsync(5_000);
    view.render();
    expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual(draft);
    resolveOld(first);
    await settle();
    expect(view.render()).not.toContain(english["boards.submitted"]);
    expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual(draft);
    (view.find((element) => element.type === IdeaComposer).props.onSubmit as () => void)();
    await settle();
    expect(fixtures.submitIdea.mock.calls[1]![2]).toMatchObject({
      body: draft.body,
      roundNumber: 2,
    });
    expect(fixtures.submitIdea.mock.calls[1]![2].idempotencyKey).not.toBe(
      fixtures.submitIdea.mock.calls[0]![2].idempotencyKey,
    );
    view.unmount();
  });

  it("acknowledges an exact same-round idea receipt overtaken by a newer board poll", async () => {
    const first = { ...boardGuestFixture, board: { ...boardGuestFixture.board, revision: 3 } };
    const newer = { ...first, board: { ...first.board, revision: 4, title: "Newest board title" } };
    fixtures.publicRead.mockResolvedValue(first.board);
    fixtures.guestRead.mockResolvedValue(first);
    let resolveReceipt!: (value: IdeaBoardGuestView) => void;
    fixtures.submitIdea.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReceipt = resolve;
        }),
    );
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    view.render();
    (
      view.find((element) => element.type === IdeaComposer).props.onChange as (
        value: IdeaDraft,
      ) => void
    )({ ...emptyIdeaDraft(), body: "Known successful idea" });
    view.render();
    (view.find((element) => element.type === IdeaComposer).props.onSubmit as () => void)();
    fixtures.publicRead.mockResolvedValue(newer.board);
    fixtures.guestRead.mockResolvedValue(newer);
    await vi.advanceTimersByTimeAsync(5_000);
    view.render();
    resolveReceipt(first);
    await settle();
    expect(view.render()).toContain("Newest board title");
    expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual(
      emptyIdeaDraft(),
    );
    expect(view.find((element) => element.type === IdeaComposer).props.disabled).toBe(false);
    expect(fixtures.submitIdea).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("retires a hung acknowledgement refresh without leaving loading or releasing the next mutation", async () => {
    const first = { ...boardGuestFixture, board: { ...boardGuestFixture.board, revision: 3 } };
    const newer = { ...first, board: { ...first.board, revision: 4 } };
    const reopened = {
      ...first,
      revision: 1,
      board: { ...first.board, roundNumber: 2, revision: 5, title: "Current reopened workspace" },
    };
    let resolveOldReceipt!: (value: IdeaBoardGuestView) => void;
    let resolveOldRefresh!: (value: IdeaBoardGuestView["board"]) => void;
    let resolveCurrentReceipt!: (value: IdeaBoardGuestView) => void;
    fixtures.submitIdea
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldReceipt = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCurrentReceipt = resolve;
          }),
      );
    fixtures.publicRead.mockResolvedValue(first.board);
    fixtures.guestRead.mockResolvedValue(first);
    const view = harness(() => BoardGuest({ id: boardId }));
    function submitDraft(body: string) {
      (
        view.find((element) => element.type === IdeaComposer).props.onChange as (
          draft: IdeaDraft,
        ) => void
      )({ ...emptyIdeaDraft(), body });
      view.render();
      (view.find((element) => element.type === IdeaComposer).props.onSubmit as () => void)();
    }
    view.render();
    view.mount();
    await settle();
    view.render();
    submitDraft("Accepted before its board snapshot became stale");
    fixtures.publicRead.mockResolvedValue(newer.board);
    fixtures.guestRead.mockResolvedValue(newer);
    await vi.advanceTimersByTimeAsync(5_000);
    view.render();
    // The exact successful acknowledgement starts reconciliation under the same mutation.
    fixtures.publicRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldRefresh = resolve;
        }),
    );
    resolveOldReceipt(first);
    await settle();
    expect(view.render()).toContain(english["boards.loading"]);
    const refreshSignal = fixtures.publicRead.mock.calls.at(-1)![1] as AbortSignal;
    expect(refreshSignal).toBe(fixtures.submitIdea.mock.calls[0]![3]);
    fixtures.publicRead.mockResolvedValue(reopened.board);
    fixtures.guestRead.mockResolvedValue(reopened);
    await vi.advanceTimersByTimeAsync(5_000);
    const reopenedMarkup = view.render();
    expect(refreshSignal.aborted).toBe(true);
    expect(reopenedMarkup).not.toContain(english["boards.loading"]);
    expect(view.find((element) => element.type === IdeaComposer).props.disabled).toBe(false);
    submitDraft("New request owns the lock");
    view.render();
    expect(fixtures.submitIdea).toHaveBeenCalledTimes(2);
    expect(view.find((element) => element.type === IdeaComposer).props.disabled).toBe(true);
    // This obsolete read ignores cancellation and settles after the next write begins.
    resolveOldRefresh(first.board);
    await settle();
    const currentMarkup = view.render();
    expect(currentMarkup).toContain("Current reopened workspace");
    expect(currentMarkup).not.toContain(english["boards.loading"]);
    expect(view.find((element) => element.type === IdeaComposer).props.disabled).toBe(true);
    expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual({
      ...emptyIdeaDraft(),
      body: "New request owns the lock",
    });
    resolveCurrentReceipt(reopened);
    await settle();
    view.render();
    expect(view.find((element) => element.type === IdeaComposer).props.disabled).toBe(false);
    expect(view.find((element) => element.type === IdeaComposer).props.value).toEqual(
      emptyIdeaDraft(),
    );
    view.unmount();
  });

  it("allows a fresh ballot after reopening, retains current choices on poll, and rejects late old-round responses", async () => {
    const first = {
      ...boardGuestFixture,
      revision: 1,
      hasVoted: true,
      votedIdeaIds: [boardFixture.ideas[0]!.id],
      board: { ...boardGuestFixture.board, status: "closed" as const, roundNumber: 1, revision: 4 },
    };
    const second = {
      ...boardGuestFixture,
      revision: 2,
      hasVoted: false,
      board: { ...boardGuestFixture.board, status: "voting" as const, roundNumber: 2, revision: 7 },
    };
    fixtures.publicRead.mockResolvedValue(first.board);
    fixtures.guestRead.mockResolvedValue(first);
    let resolveOld!: (value: IdeaBoardGuestView) => void;
    fixtures.submitVotes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const view = harness(() => BoardGuest({ id: boardId }));
    view.render();
    view.mount();
    await settle();
    expect(view.render()).toContain(english["boards.voteReceipt"]);
    fixtures.publicRead.mockResolvedValue(second.board);
    fixtures.guestRead.mockResolvedValue(second);
    await vi.advanceTimersByTimeAsync(5_000);
    view.render();
    const ideaId = boardFixture.ideas[0]!.id;
    (
      view.find((element) => element.type === IdeaBoardIdeas).props.onSelect as (
        id: string,
        checked: boolean,
      ) => void
    )(ideaId, true);
    fixtures.guestRead.mockResolvedValue({ ...second, revision: 3 });
    await vi.advanceTimersByTimeAsync(5_000);
    view.render();
    expect(view.find((element) => element.type === IdeaBoardIdeas).props.selected).toEqual([
      ideaId,
    ]);
    (view.find((element) => element.type === "form").props.onSubmit as (event: unknown) => void)({
      preventDefault: vi.fn(),
    });
    expect(fixtures.submitVotes.mock.calls[0]![2]).toMatchObject({
      expectedRevision: 3,
      roundNumber: 2,
      ideaIds: [ideaId],
    });
    const third = {
      ...second,
      revision: 4,
      board: { ...second.board, roundNumber: 3, revision: 9 },
    };
    fixtures.publicRead.mockResolvedValue(third.board);
    fixtures.guestRead.mockResolvedValue(third);
    await vi.advanceTimersByTimeAsync(5_000);
    view.render();
    expect(view.find((element) => element.type === IdeaBoardIdeas).props.selected).toEqual([]);
    resolveOld({ ...first, revision: 4, board: second.board });
    await settle();
    expect(view.render()).not.toContain(english["boards.voteReceipt"]);
    expect(view.find((element) => element.type === IdeaBoardIdeas).props.selected).toEqual([]);
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
        (element) =>
          element.type === "button" &&
          (kind === "guest"
            ? element.props["aria-label"] === "Refresh"
            : element.props.children === "Refresh"),
      );
      (refresh.props.onClick as () => void)();
      await settle();
      expect(view.render()).not.toContain("Synthetic accessible idea");
      view.unmount();
    },
  );
});
