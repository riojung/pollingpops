import { isValidElement, type ReactElement } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationThumbnailImage,
  ThumbnailImagePlaceholder,
} from "./presentation-thumbnail-image";
import type { ThumbnailMediaSnapshot } from "./presentation-thumbnail-media";
const fixture = vi.hoisted(() => ({
  reads: [] as {
    scope: unknown;
    mediaId: string;
    emit: (snapshot: ThumbnailMediaSnapshot) => void;
    release: ReturnType<typeof vi.fn>;
    imageFailed: ReturnType<typeof vi.fn>;
  }[],
  hooks: null as { cursor: number; slots: unknown[]; effects: (() => void)[] } | null,
}));
vi.mock("./presentation-thumbnail-media", () => ({
  readPresentationThumbnailMedia: (
    scope: unknown,
    mediaId: string,
    emit: (snapshot: ThumbnailMediaSnapshot) => void,
  ) => {
    const read = { scope, mediaId, emit, release: vi.fn(), imageFailed: vi.fn() };
    fixture.reads.push(read);
    return read;
  },
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (value: T) => {
          hooks.slots[index] = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (callback: () => void | (() => void), deps: unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(callback, deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (previous && previous.deps.every((value, i) => value === deps[i])) return;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index] = { deps, cleanup: callback() };
      });
    },
  };
});
afterEach(() => {
  fixture.hooks = null;
  fixture.reads.splice(0);
});

describe("private thumbnail image component", () => {
  it("never serializes a signed URL or starts authorization during server rendering", () => {
    const markup = renderToStaticMarkup(
      <PresentationThumbnailImage
        scope={{ actorKey: "private-actor:workspace", presentationId: "private-deck" }}
        mediaId="private-media"
        altText="Private reference"
      />,
    );
    expect(markup).toContain('data-thumbnail-image-state="loading"');
    expect(markup).not.toContain("private-actor");
    expect(markup).not.toContain("private-deck");
    expect(markup).not.toContain("private-media");
    expect(markup).not.toContain("<img");
    expect(fixture.reads).toHaveLength(0);
  });

  it("renders the authorized image without overriding shared crop styles and clears stale context immediately", () => {
    const hooks = { cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] };
    let scope = { actorKey: "first:workspace", presentationId: "deck-a" };
    let tree: ReactElement<Record<string, any>>;
    function render(flush = true) {
      hooks.cursor = 0;
      fixture.hooks = hooks;
      try {
        tree = PresentationThumbnailImage({ scope, mediaId: "image", altText: "Reference" });
      } finally {
        fixture.hooks = null;
      }
      if (flush) hooks.effects.splice(0).forEach((effect) => effect());
    }
    render();
    fixture.reads[0]!.emit({ status: "ready", source: "https://storage.example/old-actor" });
    render();
    expect(tree!.type).toBe("img");
    expect(tree!.props.src).toBe("https://storage.example/old-actor");
    expect(tree!.props.referrerPolicy).toBe("no-referrer");
    expect(tree!.props.style).toBeUndefined();
    tree!.props.onError();
    expect(fixture.reads[0]!.imageFailed).toHaveBeenCalledWith("https://storage.example/old-actor");
    // Ordinary parent edits and fresh equivalent scope objects retain the mounted read.
    scope = { ...scope };
    render();
    render();
    expect(fixture.reads).toHaveLength(1);
    scope = { actorKey: "second:workspace", presentationId: "deck-b" };
    render(false);
    expect(tree!.type).toBe(ThumbnailImagePlaceholder);
    hooks.effects.splice(0).forEach((effect) => effect());
    expect(fixture.reads[0]!.release).toHaveBeenCalledOnce();
    fixture.reads[0]!.emit({ status: "ready", source: "https://storage.example/late-old-actor" });
    render();
    expect(tree!.type).toBe(ThumbnailImagePlaceholder);
    fixture.reads[1]!.emit({ status: "ready", source: "https://storage.example/new-actor" });
    render();
    expect(tree!.props.src).toBe("https://storage.example/new-actor");
    fixture.reads[1]!.emit({ status: "unavailable" });
    render();
    expect(isValidElement(tree!)).toBe(true);
    expect(tree!.type).toBe(ThumbnailImagePlaceholder);
    expect(tree!.props.failed).toBe(true);
    hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.());
    expect(fixture.reads[1]!.release).toHaveBeenCalledOnce();
  });
});
