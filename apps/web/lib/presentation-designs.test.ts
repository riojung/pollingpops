import { describe, expect, it } from "vitest";
import {
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationSceneSchema,
  contentSlideMediaFrame,
  preparePresentationPublication,
  resolveContentSlideFrames,
  type PresentationDraft,
  type PresentationScene,
} from "@openround/contracts";
import { createContentBlock, createQuestionBlock } from "./presentation-builder";
import { createNativeContentBlock } from "./presentation-native-scene";
import { resolvePresentationActivityDesign } from "./presentation-activity-design";
import {
  DESIGN_LAYOUTS,
  PRESENTATION_DESIGNS,
  applyPresentationDesign,
  createDesignDraft,
  createDesignSlide,
  isPresentationDesignId,
  summarizePresentationDesign,
  type PresentationDesignDraftCopy,
  type PresentationDesignSlideCopy,
} from "./presentation-designs";

function createIds(seed = 0) {
  let sequence = seed;
  return () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
}
const slideCopy: PresentationDesignSlideCopy = {
  title: "Your presentation",
  body: "Make room for one clear idea and the supporting detail your audience needs.",
  eyebrow: "Your section",
  leftTitle: "First point",
  leftBody: "Add the first supporting detail.",
  rightTitle: "Second point",
  rightBody: "Add the second supporting detail.",
  imageLabel: "Add your image",
  dataCaption: "Illustrative sample data",
  dataHeaders: ["Sample", "Value"],
  dataRows: [
    ["A", "24"],
    ["B", "36"],
    ["C", "48"],
  ],
  speakerNotes: "Replace this example with your own material.",
};
function draftCopy(): PresentationDesignDraftCopy {
  return {
    title: "A presentation design",
    description: "An editable collection of layouts.",
    slides: Object.fromEntries(
      DESIGN_LAYOUTS.map((id) => [id, { ...slideCopy, title: `${slideCopy.title}: ${id}` }]),
    ) as PresentationDesignDraftCopy["slides"],
  };
}
function draft(
  blocks: PresentationDraft["blocks"],
  schemaVersion: PresentationDraft["schemaVersion"] = 4,
): PresentationDraft {
  return {
    title: "Keep the title",
    description: "Keep the description",
    schemaVersion,
    experiencePreset: { id: "focus", version: 1 },
    blocks,
  };
}
function native(block: PresentationDraft["blocks"][number]): PresentationScene {
  if (block.kind !== "content" || !block.scene) throw new Error("Expected native content");
  return block.scene;
}

describe("original presentation design catalog", () => {
  it("has eight independent visual families and eight coordinated layout recipes each", () => {
    expect(PRESENTATION_DESIGNS).toHaveLength(8);
    expect(DESIGN_LAYOUTS).toHaveLength(8);
    expect(new Set(PRESENTATION_DESIGNS.map((design) => JSON.stringify(design.design))).size).toBe(
      8,
    );
    expect(new Set(PRESENTATION_DESIGNS.map((design) => design.id)).size).toBe(8);
    const covers = PRESENTATION_DESIGNS.map((design) =>
      native(createDesignSlide(design.id, "cover", slideCopy)),
    );
    expect(
      new Set(
        covers.map((scene) =>
          JSON.stringify(scene.nodes.map((node) => ("frame" in node ? node.frame : null))),
        ),
      ).size,
    ).toBe(8);
    expect(isPresentationDesignId("blueprint")).toBe(true);
    expect(isPresentationDesignId("native-startup-pitch")).toBe(false);
    expect(isPresentationDesignId("__proto__")).toBe(false);
  });

  it.each(PRESENTATION_DESIGNS)(
    "$id produces eight publication-ready native layouts without external assets",
    (design) => {
      const copy = draftCopy();
      const original = structuredClone(copy);
      const first = createDesignDraft(design.id, copy, createIds());
      const second = createDesignDraft(design.id, copy, createIds(1_000));
      expect(first.schemaVersion).toBe(8);
      expect(first.blocks).toHaveLength(8);
      expect(
        PresentationContentSchema.safeParse(preparePresentationPublication(first)).success,
      ).toBe(true);
      for (const block of first.blocks) {
        const scene = native(block);
        expect(PresentationSceneSchema.safeParse(scene).success).toBe(true);
        expect(scene.design).toEqual(design.design);
        expect(
          scene.nodes.filter((node) => node.type === "text" && node.role === "title"),
        ).toHaveLength(1);
        expect(scene.nodes.some((node) => node.type === "image")).toBe(false);
        expect(scene.nodes.length).toBeLessThanOrEqual(5);
      }
      const ids = first.blocks.flatMap((block) => [
        block.id,
        ...native(block).nodes.map((node) => node.id),
      ]);
      expect(new Set(ids).size).toBe(ids.length);
      const nextIds = new Set(
        second.blocks.flatMap((block) => [block.id, ...native(block).nodes.map((node) => node.id)]),
      );
      expect(ids.every((id) => !nextIds.has(id))).toBe(true);
      expect(copy).toEqual(original);
    },
  );

  it("uses caller-authored localized words throughout every recipe and never mutates copy", () => {
    const localized: PresentationDesignSlideCopy = {
      title: "발표 제목",
      body: "핵심 아이디어",
      eyebrow: "새 섹션",
      leftTitle: "첫 번째",
      leftBody: "첫 번째 설명",
      rightTitle: "두 번째",
      rightBody: "두 번째 설명",
      imageLabel: "이미지 추가",
      dataCaption: "예시 데이터",
      dataHeaders: ["항목", "값"],
      dataRows: [["가", "24"]],
    };
    const snapshot = structuredClone(localized);
    for (const layout of DESIGN_LAYOUTS) {
      const scene = native(createDesignSlide("editorial", layout, localized));
      for (const node of scene.nodes) {
        if (node.type === "text") expect(node.text).not.toMatch(/[a-z]/iu);
        if (node.type === "shape") expect(node.label).not.toMatch(/[a-z]/iu);
        if (node.type === "table") expect(node.caption).toBe(localized.dataCaption);
      }
    }
    expect(localized).toEqual(snapshot);
  });

  it("has deterministic preview IDs when supplied and rejects incompatible copy without truncation", () => {
    expect(createDesignDraft("canvas", draftCopy(), createIds())).toEqual(
      createDesignDraft("canvas", draftCopy(), createIds()),
    );
    expect(() =>
      createDesignSlide("studio", "cover", { ...slideCopy, title: "x".repeat(161) }),
    ).toThrow();
    expect(() =>
      createDesignSlide("studio", "data", { ...slideCopy, dataHeaders: ["", "Value"] }),
    ).toThrow();
    expect(() => createDesignSlide("unrecognized" as never, "cover", slideCopy)).toThrow(
      /not found/,
    );
  });
});

describe("content-preserving design application", () => {
  it("converts ordinary slides using their existing IDs, media, metadata and resolved frames", () => {
    const ordinary = createContentBlock("media");
    ordinary.textElements[0]!.text = "Keep the title";
    ordinary.textElements[1]!.text = "Keep the body";
    ordinary.mediaId = createIds(900)();
    ordinary.mediaAlt = "Keep this alternative text";
    ordinary.speakerNotes = "Private cue";
    ordinary.citations = [{ locator: "Page 7", excerpt: "Retain the citation" }];
    ordinary.sourceDisclosure = {
      sourceName: "Source",
      sourceDigest: "a".repeat(64),
      provider: "Source provider",
      model: "source-v1",
    };
    const source = draft([ordinary], 2);
    const snapshot = structuredClone(source);
    const frames = resolveContentSlideFrames(ordinary);
    const result = applyPresentationDesign(source, "blueprint", { scope: "deck" });
    expect(result.summary).toMatchObject({
      ordinarySlides: 1,
      convertedSlides: 1,
      changedSlides: 1,
      eligibleSlides: 1,
    });
    expect(result.draft.schemaVersion).toBe(7);
    const block = result.draft.blocks[0]!;
    const scene = native(block);
    expect(block).toMatchObject({ ...ordinary, textElements: [], mediaId: null, mediaAlt: null });
    for (const element of ordinary.textElements)
      expect(scene.nodes).toContainEqual({
        id: element.id,
        type: "text",
        role: element.role,
        text: element.text,
        frame: frames[element.id],
      });
    expect(scene.nodes).toContainEqual({
      id: `${ordinary.id}:image`,
      type: "image",
      mediaId: ordinary.mediaId,
      altText: ordinary.mediaAlt,
      frame: contentSlideMediaFrame,
    });
    expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
    expect(source).toEqual(snapshot);
    expect(result.draft.title).toBe(source.title);
    expect(result.draft.description).toBe(source.description);
  });

  it("retains rich text, language, groups, interactions, source imports, frames and native node references", () => {
    const block = createNativeContentBlock();
    const scene = block.scene!;
    const title = scene.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    title.text = "제목";
    title.lang = "ko";
    title.richText = { paragraphs: [{ kind: "paragraph", runs: [{ text: "제목", bold: true }] }] };
    const body = {
      id: "public-reveal",
      type: "reveal" as const,
      scope: "local" as const,
      label: "More",
      body: "Keep all the content",
      frame: { x: 8, y: 40, width: 60, height: 30 },
    };
    scene.nodes.push(body);
    scene.readingOrder.push(body.id);
    scene.groups = [{ id: "group", nodeIds: [title.id, body.id] }];
    scene.schemaVersion = 7;
    block.hidden = true;
    block.sourceDisclosure = {
      sourceName: "Imported.pdf",
      sourceDigest: "b".repeat(64),
      provider: "Polling Pops",
      model: "visual-import-v1",
    };
    const source = draft([block], 16);
    source.sections = [{ id: createIds(800)(), title: "Keep section", blockIds: [block.id] }];
    expect(PresentationDraftSchema.safeParse(source).success).toBe(true);
    const snapshot = structuredClone(source);
    const result = applyPresentationDesign(source, "terracotta", { scope: "deck" });
    const changed = native(result.draft.blocks[0]!);
    expect(result.summary.importedSlides).toBe(1);
    expect(result.draft.schemaVersion).toBe(16);
    expect(result.draft.sections).toBe(source.sections);
    expect(changed.nodes).toBe(scene.nodes);
    expect(changed.readingOrder).toBe(scene.readingOrder);
    expect(changed.groups).toBe(scene.groups);
    expect(changed.schemaVersion).toBe(7);
    expect(result.draft.blocks[0]).toMatchObject({
      hidden: true,
      sourceDisclosure: block.sourceDisclosure,
    });
    expect(source).toEqual(snapshot);
  });

  it("preserves each native motion background and the motion ordinary slides already inherit", () => {
    const moving = createDesignSlide("studio", "body", slideCopy);
    moving.scene = {
      ...moving.scene!,
      schemaVersion: 8,
      design: { ...moving.scene!.design!, motionBackground: "waves" },
    };
    const ordinary = createContentBlock();
    const other = createDesignSlide("studio", "cover", slideCopy);
    other.scene = {
      ...other.scene!,
      schemaVersion: 8,
      design: { ...other.scene!.design!, motionBackground: "stars" },
    };
    const source = draft([moving, ordinary, other], 17);
    source.sections = [];
    const result = applyPresentationDesign(source, "midnight", { scope: "deck" });
    expect(result.draft.schemaVersion).toBe(17);
    expect(result.draft.blocks.map((block) => native(block).design?.motionBackground)).toEqual([
      "waves",
      "waves",
      "stars",
    ]);
    expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
    expect(applyPresentationDesign(result.draft, "midnight", { scope: "deck" }).draft).toBe(
      result.draft,
    );
  });

  it("retains motion borrowed by unstyled native slides before and after an anchor while respecting explicit static barriers", () => {
    const before = createNativeContentBlock();
    const moving = createDesignSlide("studio", "cover", slideCopy);
    moving.scene = {
      ...moving.scene!,
      schemaVersion: 8,
      design: { ...moving.scene!.design!, motionBackground: "waves" },
    };
    const after = createNativeContentBlock();
    const barrier = createDesignSlide("studio", "body", slideCopy);
    const behindBarrier = createNativeContentBlock();
    const source = draft([before, moving, after, barrier, behindBarrier], 17);
    source.sections = [];
    const snapshot = structuredClone(source);

    for (const target of [before, after]) {
      const result = applyPresentationDesign(source, "midnight", {
        scope: "slide",
        blockId: target.id,
      });
      const styled = result.draft.blocks.find((block) => block.id === target.id)!;
      expect(native(styled).design?.motionBackground).toBe("waves");
      expect(native(styled).schemaVersion).toBe(8);
      expect(native(styled).nodes).toBe(target.scene!.nodes);
      expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
    }

    const result = applyPresentationDesign(source, "midnight", { scope: "deck" });
    expect(result.draft.blocks.map((block) => native(block).design?.motionBackground)).toEqual([
      "waves",
      "waves",
      "waves",
      undefined,
      undefined,
    ]);
    expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
    expect(source).toEqual(snapshot);
  });

  it("limits current-slide changes by identity and preserves questions, answers and other slide objects", () => {
    const first = createNativeContentBlock();
    const second = createNativeContentBlock();
    const question = createQuestionBlock("poll");
    const source = draft([first, question, second]);
    const result = applyPresentationDesign(source, "signal", {
      scope: "slide",
      blockId: second.id.toUpperCase(),
    });
    expect(result.summary).toMatchObject({
      eligibleSlides: 1,
      changedSlides: 1,
      activitySlides: 0,
    });
    expect(result.draft.blocks[0]).toBe(first);
    expect(result.draft.blocks[1]).toBe(question);
    expect(native(result.draft.blocks[2]!).design).toEqual(
      PRESENTATION_DESIGNS.find((design) => design.id === "signal")!.design,
    );
    const full = applyPresentationDesign(source, "signal", { scope: "deck" });
    expect(full.draft.blocks[1]).toBe(question);
    expect(resolvePresentationActivityDesign(full.draft.blocks, question.id).theme).toBe("sunset");
  });

  it("returns original references for repeated styles, missing targets and unsupported activity scopes", () => {
    const question = createQuestionBlock("poll");
    const content = createDesignSlide("studio", "cover", slideCopy);
    const source = draft([question, content], 7);
    expect(summarizePresentationDesign(source, { scope: "deck" })).toEqual({
      nativeSlides: 1,
      ordinarySlides: 0,
      activitySlides: 1,
      importedSlides: 0,
      eligibleSlides: 1,
    });
    for (const options of [
      { scope: "deck" as const },
      { scope: "slide" as const, blockId: question.id },
      { scope: "slide" as const, blockId: "missing" },
      { scope: "slide" as const },
    ]) {
      const result = applyPresentationDesign(source, "studio", options);
      expect(result.draft).toBe(source);
      expect(result.summary.changedSlides).toBe(0);
    }
    const onlyActivity = draft([question], 2);
    expect(applyPresentationDesign(onlyActivity, "canvas", { scope: "deck" })).toMatchObject({
      draft: onlyActivity,
      summary: { eligibleSlides: 0, changedSlides: 0 },
    });
  });

  it("validates an entire bulk edit atomically against the document byte budget", () => {
    const source = draft(
      Array.from({ length: 32 }, () => {
        const block = createNativeContentBlock();
        for (let index = 0; index < 24; index++) {
          const id = `${block.id}:body:${index}`;
          block.scene!.nodes.push({
            id,
            type: "text",
            role: "body",
            text: "x".repeat(4_000),
            frame: { x: 8, y: 35, width: 84, height: 40 },
          });
          block.scene!.readingOrder.push(id);
        }
        return block;
      }),
    );
    let excess =
      new TextEncoder().encode(JSON.stringify(source)).byteLength -
      (PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES - 1);
    expect(excess).toBeGreaterThan(0);
    for (const block of [...source.blocks].reverse()) {
      for (const node of [...native(block).nodes].reverse()) {
        if (node.type !== "text" || node.role !== "body" || excess <= 0) continue;
        const removed = Math.min(excess, node.text.length);
        node.text = node.text.slice(removed);
        excess -= removed;
      }
    }
    expect(PresentationDraftSchema.safeParse(source).success).toBe(true);
    const snapshot = JSON.stringify(source);
    expect(() => applyPresentationDesign(source, "monograph", { scope: "deck" })).toThrow(/3 MiB/);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});
