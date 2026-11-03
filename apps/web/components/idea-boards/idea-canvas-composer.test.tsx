import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema, type CanvasObject } from "@openround/contracts";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { emptyIdeaDraft, type IdeaDraft } from "./idea-composer";
import { IdeaCanvasComposer } from "./idea-canvas-composer";
import { ideaCanvasDraft } from "./idea-canvas-model";
import { CanvasSurface } from "../canvas-boards/canvas-surface";
import { CanvasToolPalette } from "../canvas-boards/canvas-tool-palette";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const fixtures = vi.hoisted(() => ({ hooks: null as Hooks | null, upload: vi.fn() }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!fixtures.hooks) return react.useState(initial);
      const hooks = fixtures.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (next: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (old: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!fixtures.hooks) return react.useRef(initial);
      const hooks = fixtures.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useId: () => (fixtures.hooks ? `private-${fixtures.hooks.cursor++}` : react.useId()),
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (fixtures.hooks) fixtures.hooks.effects.push(effect);
      else react.useEffect(effect, dependencies);
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: keyof typeof english) => english[key] ?? key }),
}));
vi.mock("../../lib/idea-board-client", () => ({ uploadIdeaBoardImage: fixtures.upload }));
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
const objectId = "00000000-0000-4000-8000-000000000001";
const boardId = "00000000-0000-4000-8000-000000000002";
const note = CanvasObjectSchema.parse({
  id: objectId,
  type: "sticky",
  x: 100,
  y: 150,
  width: 220,
  height: 160,
  text: "Private existing note",
  version: 1,
});
function harness(initial = emptyIdeaDraft(), context: CanvasObject[] = []) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let value = initial,
    disabled = false,
    tree: ReactNode;
  let status: {
    collectionClosed?: boolean;
    submitting?: boolean;
    submissionError?: string;
    onRetry?: () => void;
  } = {};
  const change = vi.fn((next: IdeaDraft) => {
    value = next;
  });
  const submit = vi.fn(),
    uploading = vi.fn(),
    close = vi.fn();
  const view = {
    change,
    submit,
    uploading,
    close,
    value: () => value,
    setDisabled: (next: boolean) => {
      disabled = next;
    },
    setStatus: (next: typeof status) => {
      status = next;
    },
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      fixtures.hooks = hooks;
      try {
        tree = IdeaCanvasComposer({
          value,
          onChange: change,
          onSubmit: submit,
          onUploading: uploading,
          onClose: close,
          boardId,
          guestToken: "ab".repeat(32),
          publishedContext: context,
          imagesAvailable: true,
          disabled,
          ...status,
        });
      } finally {
        fixtures.hooks = null;
      }
      return renderToStaticMarkup(tree);
    },
    find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
      const result = find(tree, predicate);
      if (!result) throw new Error("Composer control missing");
      return result;
    },
    surface() {
      return view.find((element) => element.type === CanvasSurface);
    },
    button(label: string) {
      return view.find(
        (element) =>
          element.type === "button" &&
          (element.props["aria-label"] === label || element.props.children === label),
      );
    },
    effect(index: number) {
      hooks.effects[index]!();
    },
  };
  return view;
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
afterEach(() => {
  fixtures.hooks = null;
  fixtures.upload.mockReset();
});

describe("native participant canvas composer", () => {
  it("edits a selected private link through its explicit action while retaining identity, placement and thumbnail media", async () => {
    const linkId = "00000000-0000-4000-8000-000000000003";
    const imageId = "00000000-0000-4000-8000-000000000004";
    const mediaId = "00000000-0000-4000-8000-000000000005";
    const originalUrl = "https://example.com/original";
    const link = CanvasObjectSchema.parse({
      ...note,
      id: linkId,
      type: "link",
      x: 420,
      y: 260,
      width: 280,
      height: 120,
      rotation: 12,
      url: originalUrl,
      text: "Original private caption",
    });
    const image = CanvasObjectSchema.parse({
      ...note,
      id: imageId,
      type: "image",
      x: 50,
      y: 50,
      mediaId,
      altText: "Retained private thumbnail",
      text: "",
    });
    const otherLinks = [
      "00000000-0000-4000-8000-000000000006",
      "00000000-0000-4000-8000-000000000007",
    ].map((id, index) =>
      CanvasObjectSchema.parse({
        ...link,
        id,
        x: 800,
        y: 100 + index * 180,
        url: `https://example.com/unrelated-${index}`,
        text: `Unrelated link ${index}`,
      }),
    );
    const initial = ideaCanvasDraft(
      {
        ...emptyIdeaDraft(),
        body: "Independent composition title",
        attachments: [{ mediaId, alt: image.type === "image" ? image.altText : "" }],
        links: [{ url: originalUrl, label: link.text, imageMediaId: mediaId }],
      },
      [note, image, link, ...otherLinks],
    );
    if (initial.error) throw new Error(initial.error);
    const before = structuredClone(initial.draft);
    const context = CanvasObjectSchema.parse({
      ...link,
      url: "https://example.com/published-reference",
      text: "Protected workshop link",
      visibility: "published",
    });
    const contextBefore = structuredClone(context);
    const view = harness(initial.draft, [context]);
    view.render();
    expect(view.button("Add link").props.disabled).toBe(true);
    (view.surface().props.onSelect as (id: string) => void)(`context:${linkId}`);
    expect(view.render()).not.toContain('aria-label="Edit: Link"');
    (view.surface().props.onSelect as (id: string) => void)(linkId);
    view.render();
    const edit = view.button("Edit: Link");
    expect(edit.props.disabled).toBe(false);
    expect(edit.props["aria-haspopup"]).toBe("dialog");
    const focus = vi.fn();
    (edit.props.onClick as (event: unknown) => void)({ currentTarget: { focus } });
    expect(focus).toHaveBeenCalledOnce();
    view.render();
    const urlInput = () =>
      view.find((element) => element.type === "input" && element.props.type === "url");
    const captionInput = () =>
      view.find((element) => element.type === "input" && element.props.maxLength === 160);
    expect(urlInput().props.value).toBe(originalUrl);
    expect(captionInput().props.value).toBe("Original private caption");
    expect(view.button("Use link").props.disabled).toBe(false);
    (urlInput().props.onChange as (event: unknown) => void)({
      target: { value: "javascript:alert(1)" },
    });
    view.render();
    const save = () =>
      (view.find((element) => element.type === "form").props.onSubmit as (event: unknown) => void)({
        preventDefault: vi.fn(),
      });
    save();
    await settle();
    view.render();
    expect(view.change).not.toHaveBeenCalled();
    expect(view.value()).toEqual(before);
    const updatedUrl = "https://example.com/revised?chapter=2";
    (urlInput().props.onChange as (event: unknown) => void)({ target: { value: updatedUrl } });
    (captionInput().props.onChange as (event: unknown) => void)({
      target: { value: "Revised private caption" },
    });
    view.render();
    save();
    await settle();
    view.render();
    const after = view.value();
    const originalNode = before.canvas!.objects.find((object) => object.id === linkId)!;
    expect(after.canvas!.objects.find((object) => object.id === linkId)).toEqual({
      ...originalNode,
      url: updatedUrl,
      text: "Revised private caption",
    });
    expect(after.canvas!.objects).toHaveLength(before.canvas!.objects.length);
    expect(after.canvas!.objects.filter((object) => object.id !== linkId)).toEqual(
      before.canvas!.objects.filter((object) => object.id !== linkId),
    );
    expect({ ...after.canvas, objects: [] }).toEqual({ ...before.canvas, objects: [] });
    expect(after.attachments).toEqual(before.attachments);
    expect(after.links.find((item) => item.url === updatedUrl)).toEqual({
      url: updatedUrl,
      label: "Revised private caption",
      imageMediaId: mediaId,
    });
    expect(after.links.filter((item) => item.url !== updatedUrl)).toEqual(
      before.links.filter((item) => item.url !== originalUrl),
    );
    expect(after.body).toBe(before.body);
    expect(after.canvas!.objects.some((object) => object.id.startsWith("context:"))).toBe(false);
    expect(context).toEqual(contextBefore);
    expect(
      (view.surface().props.objects as CanvasObject[]).find(
        (object) => object.id === `context:${linkId}`,
      ),
    ).toMatchObject({
      text: "Protected workshop link",
      url: "https://example.com/published-reference",
    });
    expect(view.submit).not.toHaveBeenCalled();
    expect(fixtures.upload).not.toHaveBeenCalled();
    view.setDisabled(true);
    view.render();
    expect(view.button("Edit: Link").props.disabled).toBe(true);
  });
  it("distinguishes submission progress from a closed collection and offers exact retry inside the frozen dialog", () => {
    const initial = ideaCanvasDraft(emptyIdeaDraft(), [note]);
    if (initial.error) throw new Error(initial.error);
    const snapshot = structuredClone(initial.draft);
    const view = harness(initial.draft);
    const retry = vi.fn();
    view.setDisabled(true);
    view.setStatus({ submitting: true });
    const pending = view.render();
    expect(pending).toContain("Submitting…");
    expect(pending).not.toContain("Idea submissions are closed for this round.");
    expect(
      view.find(
        (element) => element.props.role === "status" && element.props.children === "Submitting…",
      ),
    ).toBeDefined();
    expect(view.button("Submitting…").props.disabled).toBe(true);
    expect(view.surface().props.canEdit).toBe(false);
    expect(view.button("Back to workshop").props.disabled).toBe(false);

    view.setStatus({ submissionError: english["boards.error"], onRetry: retry });
    const failed = view.render();
    expect(failed).toContain(english["boards.error"]);
    expect(failed).not.toContain("Idea submissions are closed for this round.");
    expect(failed).not.toContain("Submitting…");
    expect(view.button("Retry").props.disabled).toBe(false);
    expect(view.button("Submit idea").props.disabled).toBe(true);
    (view.button("Retry").props.onClick as () => void)();
    expect(retry).toHaveBeenCalledOnce();
    expect(retry.mock.calls[0]).toEqual([]);
    expect(view.change).not.toHaveBeenCalled();
    expect(view.submit).not.toHaveBeenCalled();
    expect(view.value()).toEqual(snapshot);

    view.setStatus({ submitting: true, submissionError: english["boards.error"], onRetry: retry });
    view.render();
    expect(view.button("Retry").props.disabled).toBe(true);
    (view.button("Retry").props.onClick as () => void)();
    expect(retry).toHaveBeenCalledOnce();
    view.setStatus({ collectionClosed: true });
    const closed = view.render();
    expect(closed).toContain("Idea submissions are closed for this round.");
    expect(closed).not.toContain("Submitting…");
    expect(view.value()).toEqual(snapshot);
    expect(view.change).not.toHaveBeenCalled();
  });
  it("keeps published context outside all private mutation and selection callbacks even on ID collision", async () => {
    const result = ideaCanvasDraft(emptyIdeaDraft(), [note]);
    if (result.error) throw new Error(result.error);
    const context = CanvasObjectSchema.parse({
      ...note,
      text: "Protected workshop context",
      visibility: "published" as const,
    });
    const view = harness(result.draft, [context]);
    view.render();
    const surface = view.surface();
    const rendered = surface.props.objects as CanvasObject[];
    expect(rendered.map((object) => object.id)).toEqual([`context:${note.id}`, note.id]);
    const editable = surface.props.isObjectEditable as (object: CanvasObject) => boolean;
    expect(editable(rendered[0]!)).toBe(false);
    expect(editable(rendered[1]!)).toBe(true);
    (surface.props.onSelect as (id: string) => void)(rendered[0]!.id);
    view.render();
    expect(view.surface().props.selectedIds).toEqual([]);
    expect(
      await (
        view.surface().props.onTransform as (ids: string[], transform: unknown) => Promise<boolean>
      )([rendered[0]!.id], { type: "move", dx: 10, dy: 10 }),
    ).toBe(false);
    expect(
      await (
        view.surface().props.onCreateConnector as (from: unknown, to: unknown) => Promise<boolean>
      )({ objectId: rendered[0]!.id, x: 100, y: 100 }, { objectId: null, x: 200, y: 200 }),
    ).toBe(false);
    expect(view.change).not.toHaveBeenCalled();
    (view.button("Back to workshop").props.onClick as () => void)();
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.value()).toEqual(result.draft);
  });
  it("uses real inline text and placement callbacks, locks submission during editing and submits an explicit final snapshot", async () => {
    const view = harness();
    view.render();
    (
      view.find((element) => element.type === CanvasToolPalette).props.onAdd as (
        type: string,
      ) => void
    )("sticky");
    view.render();
    const created = (view.surface().props.objects as CanvasObject[])[0]!;
    expect(view.surface().props.editTextRequest).toMatchObject({ id: created.id });
    expect(view.value().body).toBe("");
    expect(
      await (
        view.surface().props.onCommitText as (
          object: CanvasObject,
          text: string,
        ) => Promise<boolean>
      )(created, "A real participant idea"),
    ).toBe(true);
    view.render();
    expect(view.value().body).toBe("A real participant idea");
    (view.surface().props.onTextEditingChange as (value: boolean) => void)(true);
    view.render();
    expect(view.button("Submit idea").props.disabled).toBe(true);
    (view.surface().props.onTextEditingChange as (value: boolean) => void)(false);
    view.render();
    const input = view.find(
      (element) => element.type === "input" && element.props.maxLength === 1000,
    );
    (input.props.onChange as (event: unknown) => void)({
      target: { value: "Independent idea title" },
    });
    view.render();
    expect(
      await (
        view.surface().props.onTransform as (ids: string[], transform: unknown) => Promise<boolean>
      )([created.id], { type: "move", dx: 25, dy: 30 }),
    ).toBe(true);
    view.render();
    (view.button("Submit idea").props.onClick as () => void)();
    expect(view.submit).toHaveBeenCalledOnce();
    const submitted = view.submit.mock.calls[0]![0] as IdeaDraft;
    expect(submitted.body).toBe("Independent idea title");
    expect(submitted.canvas).toEqual(view.value().canvas);
    expect(submitted.canvas!.objects[0]).toMatchObject({
      id: created.id,
      type: "sticky",
      text: "A real participant idea",
    });
    (view.button("Undo").props.onClick as () => void)();
    view.render();
    expect(view.value().canvas!.x).toBe(submitted.canvas!.x - 25);
    (view.button("Redo").props.onClick as () => void)();
    view.render();
    expect(view.value().canvas).toEqual(submitted.canvas);
  });
  it("aborts a private upload on external disable and refuses a late attachment from an abort-ignoring transport", async () => {
    let resolve!: (media: { mediaId: string; altText: string }) => void;
    fixtures.upload.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = harness();
    view.render();
    (view.button("Add image").props.onClick as () => void)();
    view.render();
    (
      view.find((element) => element.type === "input" && element.props.maxLength === 300).props
        .onChange as (event: unknown) => void
    )({ target: { value: "A private diagram" } });
    (
      view.find((element) => element.type === "input" && element.props.type === "file").props
        .onChange as (event: unknown) => void
    )({ target: { files: [{ type: "image/png", name: "diagram.png", size: 12 }] } });
    view.render();
    (view.find((element) => element.type === "form").props.onSubmit as (event: unknown) => void)({
      preventDefault: vi.fn(),
    });
    await settle();
    expect(view.uploading).toHaveBeenCalledWith(true);
    const signal = fixtures.upload.mock.calls[0]![4] as AbortSignal;
    view.setDisabled(true);
    view.render();
    view.effect(2);
    expect(signal.aborted).toBe(true);
    expect(view.uploading).toHaveBeenLastCalledWith(false);
    resolve({ mediaId: "00000000-0000-4000-8000-000000000099", altText: "A private diagram" });
    await settle();
    view.render();
    expect(view.change).not.toHaveBeenCalled();
    expect(view.value().attachments).toEqual([]);
    expect(view.button("Back to workshop").props.disabled).toBe(false);
  });
  it("retains a frozen inline buffer in the private draft without reopening editing or submitting it", async () => {
    const initial = ideaCanvasDraft(emptyIdeaDraft(), [note]);
    if (initial.error) throw new Error(initial.error);
    const view = harness(initial.draft, [{ ...note, visibility: "published" }]);
    view.render();
    const original = (view.surface().props.objects as CanvasObject[]).find(
      (object) => object.id === note.id,
    )!;
    (view.surface().props.onTextEditingChange as (editing: boolean) => void)(true);
    view.render();
    view.setDisabled(true);
    view.render();
    expect(view.surface().props.canEdit).toBe(false);
    const retained = view.surface().props.onRetainText as (
      object: CanvasObject,
      text: string,
    ) => void;
    retained({ ...original, id: `context:${original.id}` }, "Cannot replace context");
    retained({ ...original, version: original.version + 1 }, "Cannot replace newer content");
    expect(view.change).not.toHaveBeenCalled();
    retained(original, "Private buffer kept when collection closes");
    (view.surface().props.onTextEditingChange as (editing: boolean) => void)(false);
    view.render();
    expect(view.value().canvas!.objects.find((object) => object.id === note.id)?.text).toBe(
      "Private buffer kept when collection closes",
    );
    const changes = view.change.mock.calls.length;
    retained(original, "A repeated old buffer cannot overwrite the retained version");
    expect(view.change).toHaveBeenCalledTimes(changes);
    expect(
      await (
        view.surface().props.onCommitText as (
          object: CanvasObject,
          text: string,
        ) => Promise<boolean>
      )(original, "Normal editing remains closed"),
    ).toBe(false);
    expect(
      await (
        view.surface().props.onTransform as (ids: string[], transform: unknown) => Promise<boolean>
      )([original.id], { type: "move", dx: 50, dy: 50 }),
    ).toBe(false);
    expect(view.button("Submit idea").props.disabled).toBe(true);
    (view.button("Submit idea").props.onClick as () => void)();
    expect(view.submit).not.toHaveBeenCalled();
    (view.button("Back to workshop").props.onClick as () => void)();
    expect(view.close).toHaveBeenCalledOnce();
    const reopened = harness(view.value());
    reopened.render();
    expect(
      (reopened.surface().props.objects as CanvasObject[]).find((object) => object.id === note.id)
        ?.text,
    ).toBe("Private buffer kept when collection closes");
  });
});
