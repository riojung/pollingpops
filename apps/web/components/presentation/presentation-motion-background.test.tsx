import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_MOTION_BACKGROUND_PRESETS,
  type PresentationScene,
} from "@openround/contracts";
import { NativeSceneView } from "./native-scene-view";
import { ContentSlideView } from "./content-slide-view";
import { PresentationActivitySlide } from "./presentation-activity-slide";
import {
  PRESENTATION_MOTION_PAUSE_KEY,
  PresentationMotionBackground,
  getPresentationMotionPaused,
  setPresentationMotionPaused,
} from "./presentation-motion-background";

vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("./use-native-text-overflow", () => ({ useNativeTextOverflow: () => ({}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  setPresentationMotionPaused(false);
});

function scene(): PresentationScene {
  return {
    schemaVersion: 8,
    aspectRatio: "16:9",
    design: { theme: "midnight", font: "sans", spacing: "relaxed", motionBackground: "aurora" },
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "A clear decision",
        frame: { x: 8, y: 8, width: 84, height: 25 },
      },
    ],
    readingOrder: ["title"],
  };
}

describe("Presentation background playback", () => {
  it.each(PRESENTATION_MOTION_BACKGROUND_PRESETS)(
    "renders %s as bounded decorative artwork, still before visibility is known",
    (preset) => {
      const html = renderToStaticMarkup(
        <PresentationMotionBackground preset={preset} theme="midnight" />,
      );
      expect(html).toContain(`data-motion-background="${preset}"`);
      expect(html).toContain('data-motion-playing="false"');
      expect(html).toContain('aria-hidden="true"');
      expect(html.match(/<span/g)).toHaveLength(4);
      expect(html).not.toMatch(/<video|<iframe|<canvas|https?:|url\(/);
    },
  );

  it("keeps native slide thumbnails still and controls outside the authored slide", () => {
    const source = scene();
    const original = structuredClone(source);
    const html = renderToStaticMarkup(<NativeSceneView scene={source} />);
    expect(html).toContain('data-motion-background="aurora"');
    expect(html).toContain("Pause background motion");
    expect(html.indexOf("data-motion-controls")).toBeGreaterThan(html.indexOf("</article>"));
    const thumbnail = renderToStaticMarkup(<NativeSceneView scene={source} staticThumbnail />);
    expect(thumbnail).toContain('data-motion-static="true"');
    expect(thumbnail).not.toContain("data-motion-controls");
    expect(source).toEqual(original);
  });

  it("preserves inherited motion in ordinary slides and unscored activities", () => {
    const design = scene().design!;
    const html = renderToStaticMarkup(
      <ContentSlideView
        block={{
          id: "ordinary",
          layout: "title_body",
          textElements: [
            {
              id: "title",
              role: "title",
              text: "Original content",
              region: "top_center",
              order: 0,
            },
          ],
        }}
        designOverride={design}
        variant="preview"
      />,
    );
    expect(html).toContain('data-motion-background="aurora"');
    expect(html).toContain("Original content");
    const activity = renderToStaticMarkup(
      <PresentationActivitySlide
        design={design}
        question={{
          type: "poll",
          prompt: "What should we discuss?",
          timeLimitSeconds: 20,
          choices: [
            { id: "one", label: "First idea" },
            { id: "two", label: "Second idea" },
          ],
        }}
      />,
    );
    expect(activity).toContain('data-motion-background="aurora"');
    expect(activity).toContain("Pause background motion");
    const thumb = renderToStaticMarkup(
      <PresentationActivitySlide
        design={design}
        staticThumbnail
        question={{ type: "rating", prompt: "How clear is the plan?", timeLimitSeconds: 20 }}
      />,
    );
    expect(thumb).toContain('data-motion-static="true"');
    expect(thumb).not.toContain("data-motion-controls");
  });

  it("does not add background artwork or controls to existing static slides", () => {
    const source = scene();
    delete source.design!.motionBackground;
    expect(renderToStaticMarkup(<NativeSceneView scene={source} />)).not.toContain("data-motion-");
  });

  it("saves pause only as a local preference and notifies other mounted slides", () => {
    const setItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem }, dispatchEvent });
    setPresentationMotionPaused(true);
    expect(setItem).toHaveBeenCalledWith(PRESENTATION_MOTION_PAUSE_KEY, "true");
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "polling-pops:presentation-motion-preference" }),
    );
    setPresentationMotionPaused(false);
    expect(setItem).toHaveBeenLastCalledWith(PRESENTATION_MOTION_PAUSE_KEY, "false");
  });

  it("keeps playback controls usable if storage is denied", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Storage denied");
      },
      dispatchEvent,
    });
    expect(() => setPresentationMotionPaused(true)).not.toThrow();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    setPresentationMotionPaused(false);
  });

  it("honors Pause when storage is readable but quota blocks writes", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "false",
        setItem: () => {
          throw new Error("Quota exceeded");
        },
      },
      dispatchEvent: vi.fn(),
    });
    setPresentationMotionPaused(true);
    expect(getPresentationMotionPaused()).toBe(true);
    setPresentationMotionPaused(false);
    expect(getPresentationMotionPaused()).toBe(false);
  });

  it("clears its temporary override after storage writes recover", () => {
    let stored = "false";
    const setItem = vi.fn((_key: string, _value: string): void => {
      throw new Error("Quota exceeded");
    });
    vi.stubGlobal("window", {
      localStorage: { getItem: () => stored, setItem },
      dispatchEvent: vi.fn(),
    });
    setPresentationMotionPaused(true);
    expect(getPresentationMotionPaused()).toBe(true);
    setItem.mockImplementation((_key, value) => {
      stored = value;
    });
    setPresentationMotionPaused(false);
    expect(stored).toBe("false");
    stored = "true";
    expect(getPresentationMotionPaused()).toBe(true);
  });
});
