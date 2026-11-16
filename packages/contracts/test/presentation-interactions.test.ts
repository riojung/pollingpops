import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PRESENTATION_INTERACTION_SCENE_SCHEMA_VERSION,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  createPresentationDesignScene,
  migratePresentationV1,
  type PresentationSceneDraft,
} from "../src/index";

function scene(): PresentationSceneDraft {
  return {
    schemaVersion: 5,
    aspectRatio: "16:9",
    design: { theme: "ocean", font: "serif", spacing: "compact" },
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Explore",
        frame: { x: 8, y: 8, width: 84, height: 20 },
      },
      {
        id: "reveal",
        type: "reveal",
        scope: "local",
        label: "Show evidence",
        body: "Public audience evidence\nReview the result.",
        frame: { x: 8, y: 35, width: 38, height: 25 },
        rotation: 10,
      },
      {
        id: "link",
        type: "link",
        label: "Read the source",
        href: "https://example.com/source",
        frame: { x: 55, y: 35, width: 38, height: 25 },
      },
    ],
    readingOrder: ["title", "reveal", "link"],
    groups: [{ id: "controls", nodeIds: ["reveal", "link"] }],
  };
}
function deck() {
  return {
    title: "Interactions",
    schemaVersion: 11,
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Presenter only",
        scene: scene(),
      },
    ],
  };
}
function changedNode(fields: Record<string, unknown>, index = 1) {
  const value = scene();
  return {
    ...value,
    nodes: value.nodes.map((node, position) =>
      position === index ? { ...node, ...fields } : node,
    ),
  };
}

const extraSlashSafeLinks = [
  "https:///example.com",
  "https:////example.com/path?contact=a@b#c@d",
  "HTTP://///example.com:00000080/path",
  "https:////[::1]:00000443/source",
  "https:////例え.テスト/資料",
  "https:////%65xample.com:00000443/source",
  "https://@example.com/",
  "https://:@example.com/",
  "https:////:@example.com/",
];
const extraSlashUnsafeLinks = [
  "https:///user@example.com",
  "https:////user@example.com/",
  "https:////:password@example.com/",
  "https:////@@example.com/",
  "https:////user:password@example.com",
  "http:////user:password@[::1]",
  "https:////",
  "https:////?host=example.com",
  "https:////#example.com",
  "https:////example.com:65536",
  "https:////example.com\\bad",
  "https:////example.com/\u0085",
  "javascript:////example.com",
  "data:////example.com",
  "ftp:////example.com",
];

const percentHostSafeLinks = [
  "https://%65xample.com/source",
  "https://%65xample%2Ecom/source",
  "https://%C3%A9xample.com/source",
  "https://%e4%be%8b%e3%81%88%2e%e3%83%86%e3%82%b9%e3%83%88/source",
  "HTTPS:////:@%65xample%2Ecom:00000443/source",
  "https://%EF%BB%BFexample.com/source",
  "https://exa%C2%ADmple.com/source",
  "https://%E2%80%8Bexample.com/source",
  "https://%EF%BC%A5xample.com/source",
  "https://example%E3%80%82com/source",
  "https://example.com/source%zz?escaped=%#tail%0",
  "https://example.com/%00/%FF/%2F?part=%C3%28",
];
const percentHostUnsafeLinks = [
  {
    category: "malformed escapes",
    hrefs: [
      "https://%",
      "https://%0",
      "https://%zz.example",
      "https://%g0.example",
      "https://%0g.example",
      "https://example%.com",
      "https:////:@%zz.example/source",
    ],
  },
  {
    category: "invalid UTF8",
    hrefs: [
      "https://%C3.example/source",
      "https://%C3%28.example/source",
      "https://%E2%82.example/source",
      "https://%E2%28%A1.example/source",
      "https://%ED%A0%80.example/source",
      "https://%C0%AF.example/source",
      "https://%F0%80%80%80.example/source",
      "https://%80.example/source",
      "https://%FF.example/source",
    ],
  },
  {
    category: "forbidden decoded host characters",
    hrefs: [
      "https://prefix%00.example/source",
      "https://prefix%01.example/source",
      "https://prefix%02.example/source",
      "https://prefix%03.example/source",
      "https://prefix%04.example/source",
      "https://prefix%05.example/source",
      "https://prefix%06.example/source",
      "https://prefix%07.example/source",
      "https://prefix%08.example/source",
      "https://prefix%09.example/source",
      "https://prefix%0A.example/source",
      "https://prefix%0B.example/source",
      "https://prefix%0C.example/source",
      "https://prefix%0D.example/source",
      "https://prefix%0E.example/source",
      "https://prefix%0F.example/source",
      "https://prefix%10.example/source",
      "https://prefix%11.example/source",
      "https://prefix%12.example/source",
      "https://prefix%13.example/source",
      "https://prefix%14.example/source",
      "https://prefix%15.example/source",
      "https://prefix%16.example/source",
      "https://prefix%17.example/source",
      "https://prefix%18.example/source",
      "https://prefix%19.example/source",
      "https://prefix%1A.example/source",
      "https://prefix%1B.example/source",
      "https://prefix%1C.example/source",
      "https://prefix%1D.example/source",
      "https://prefix%1E.example/source",
      "https://prefix%1F.example/source",
      "https://prefix%20.example/source",
      "https://prefix%23.example/source",
      "https://prefix%25.example/source",
      "https://prefix%2F.example/source",
      "https://prefix%3A.example/source",
      "https://prefix%3C.example/source",
      "https://prefix%3E.example/source",
      "https://prefix%3F.example/source",
      "https://prefix%40.example/source",
      "https://prefix%5B.example/source",
      "https://prefix%5C.example/source",
      "https://prefix%5D.example/source",
      "https://prefix%5E.example/source",
      "https://prefix%7C.example/source",
      "https://prefix%7F.example/source",
      "https://%C2%80.example/source",
      "https://%C2%85.example/source",
      "https://%252F.example/source",
      "https://%2565xample.com/source",
    ],
  },
  {
    category: "mapped forbidden Unicode",
    hrefs: [
      "https://%C2%A0example.com/source",
      "https://%EF%BC%8Fexample.com/source",
      "https://%EF%BC%85example.com/source",
      "https://%EF%BC%A0example.com/source",
    ],
  },
  {
    category: "empty IDNA host",
    hrefs: ["https://%EF%BB%BF/source", "https://%C2%AD/source", "https://%E2%80%8B/source"],
  },
].flatMap((group) => group.hrefs);

function richTextScene(href: string): PresentationSceneDraft {
  return {
    schemaVersion: 4,
    aspectRatio: "16:9",
    nodes: [
      scene().nodes[0]!,
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Read the source",
        frame: { x: 8, y: 35, width: 84, height: 25 },
        richText: {
          paragraphs: [{ kind: "paragraph", runs: [{ text: "Read the source", href }] }],
        },
      },
    ],
    readingOrder: ["title", "body"],
  };
}

describe("Presentation local reveal and external link nodes", () => {
  it("opts into scene5/document11 while retaining local scope, stable IDs and public panel bodies", () => {
    expect(PRESENTATION_INTERACTION_SCENE_SCHEMA_VERSION).toBe(5);
    const content = PresentationContentSchema.parse(deck());
    const slide = content.blocks[0]!;
    expect(slide.kind).toBe("content");
    const publicSlide = { ...slide };
    delete (publicSlide as { speakerNotes?: string }).speakerNotes;
    expect(PresentationLiveContentBlockSchema.parse(publicSlide).scene).toEqual(scene());
    expect(content.blocks[0]).toMatchObject({
      scene: {
        readingOrder: ["title", "reveal", "link"],
        nodes: [expect.anything(), { ...scene().nodes[1] }, expect.anything()],
      },
    });
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10])
        expect(schema.safeParse({ ...deck(), schemaVersion }).success).toBe(false);
    }
    for (const schemaVersion of [1, 2, 3, 4])
      expect(PresentationSceneDraftSchema.safeParse({ ...scene(), schemaVersion }).success).toBe(
        false,
      );
  });

  it("allows incomplete authoring and requires accessible panel labels, bodies and safe links to publish", () => {
    for (const [index, fields] of [
      [1, { label: "" }],
      [1, { body: "\t\n" }],
      [2, { label: " " }],
      [2, { href: "" }],
    ] as const) {
      const draft = changedNode(fields, index);
      expect(PresentationSceneDraftSchema.safeParse(draft).success).toBe(true);
      expect(PresentationSceneSchema.safeParse(draft).success).toBe(false);
    }
    expect(PresentationSceneSchema.safeParse(scene()).success).toBe(true);
  });

  it.each([
    "https://example.com",
    "HTTP://example.com:8080/path?q=1#more",
    "https://[::1]/",
    "https://例え.テスト/資料",
    ...extraSlashSafeLinks,
    ...percentHostSafeLinks,
  ])("accepts existing safe link policy: %s", (href) => {
    expect(PresentationSceneSchema.safeParse(changedNode({ href }, 2)).success).toBe(true);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "/slide/2",
    "#slide",
    "//example.com",
    "https://name:password@example.com",
    "https://name@example.com",
    " https://example.com",
    "https://exa mple.com",
    "https://example.com\\x",
    "https://example.com/\u0085",
    "https://",
    "https://example.com:99999",
    ...extraSlashUnsafeLinks,
    ...percentHostUnsafeLinks,
  ])("rejects unsafe link %s even in drafts", (href) => {
    expect(PresentationSceneDraftSchema.safeParse(changedNode({ href }, 2)).success).toBe(false);
  });

  it.each([...extraSlashSafeLinks, ...percentHostSafeLinks])(
    "retains a pre-existing rich-text URL through scene4 to scene5 upgrade: %s",
    (href) => {
      const legacy = PresentationSceneSchema.parse(richTextScene(href));
      const upgraded = PresentationSceneSchema.parse({ ...legacy, schemaVersion: 5 });
      expect(upgraded).toEqual({ ...legacy, schemaVersion: 5 });
      expect(JSON.stringify(upgraded.nodes)).toBe(JSON.stringify(legacy.nodes));
      const body = upgraded.nodes[1]!;
      expect(body).toMatchObject({ richText: { paragraphs: [{ runs: [{ href }] }] } });
    },
  );

  it.each([...extraSlashUnsafeLinks, ...percentHostUnsafeLinks])(
    "rejects unsafe rich-text URLs before and after scene upgrade: %s",
    (href) => {
      for (const schemaVersion of [4, 5])
        expect(
          PresentationSceneDraftSchema.safeParse({ ...richTextScene(href), schemaVersion }).success,
        ).toBe(false);
    },
  );

  it("rejects unsupported behavior, styling and overlong or unsafe plain text", () => {
    for (const extra of [
      { scope: "session" },
      { script: "alert(1)" },
      { html: "<b>body</b>" },
      { targetId: "title" },
      { action: "navigate" },
      { style: { color: "red" } },
      { label: "a".repeat(121) },
      { body: "b".repeat(4001) },
      { body: "unsafe\u0007" },
      { label: "unsafe\u007f" },
    ])
      expect(PresentationSceneDraftSchema.safeParse(changedNode(extra)).success).toBe(false);
    for (const extra of [
      { href: `https://example.com/${"x".repeat(2048)}` },
      { target: "_self" },
      { onClick: "alert(1)" },
      { label: "a".repeat(121) },
    ])
      expect(PresentationSceneDraftSchema.safeParse(changedNode(extra, 2)).success).toBe(false);
    // Markup-like user text stays a plain string, without an HTML interpretation.
    expect(
      PresentationSceneSchema.parse(changedNode({ body: "<strong>Evidence</strong>" })).nodes[1],
    ).toMatchObject({ body: "<strong>Evidence</strong>" });
  });

  it("matches existing plain-text code point bounds for Unicode labels and bodies", () => {
    for (const [field, maximum] of [
      ["label", 120],
      ["body", 4000],
    ] as const) {
      expect(
        PresentationSceneSchema.safeParse(changedNode({ [field]: "😀".repeat(maximum) })).success,
      ).toBe(true);
      expect(
        PresentationSceneDraftSchema.safeParse(changedNode({ [field]: "😀".repeat(maximum + 1) }))
          .success,
      ).toBe(false);
    }
  });

  it("retains node count, geometry, unique IDs and complete reading order fences", () => {
    for (const invalid of [
      { ...scene(), readingOrder: ["title", "reveal", "reveal"] },
      changedNode({ id: "title" }),
      changedNode({ rotation: 45, frame: { x: 0, y: 0, width: 100, height: 100 } }),
      changedNode({ frame: { x: 90, y: 40, width: 20, height: 20 } }),
      {
        ...scene(),
        nodes: Array.from({ length: 51 }, (_, index) => ({
          ...scene().nodes[1],
          id: `reveal-${index}`,
        })),
      },
    ])
      expect(PresentationSceneDraftSchema.safeParse(invalid).success).toBe(false);
  });

  it("preserves defaults and historical bytes when readers parse old documents", () => {
    expect(createPresentationDesignScene("title", "body").schemaVersion).toBe(3);
    expect(PresentationDraftSchema.parse({ title: "Old", blocks: [] }).schemaVersion).toBe(2);
    const oldScene = {
      ...scene(),
      schemaVersion: 4,
      nodes: [scene().nodes[0]],
      readingOrder: ["title"],
    };
    delete (oldScene as Partial<typeof oldScene>).groups;
    const old = PresentationContentSchema.parse({
      ...deck(),
      schemaVersion: 8,
      blocks: [{ ...deck().blocks[0]!, scene: oldScene }],
    });
    const bytes = JSON.stringify(old);
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(JSON.stringify(PresentationContentSchema.parse(JSON.parse(bytes)))).toBe(bytes);
    expect(
      createHash("sha256")
        .update(JSON.stringify(migratePresentationV1(old)))
        .digest("hex"),
    ).toBe(hash);
    expect(migratePresentationV1(PresentationContentSchema.parse(deck()))).toMatchObject({
      schemaVersion: 11,
    });
  });
});
