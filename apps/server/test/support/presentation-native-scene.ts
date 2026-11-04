import { randomUUID } from "node:crypto";

export function richTextSceneBlock(mediaIds: string[] = [], title = "Native evidence") {
  const block = nativeSceneBlock(mediaIds, title);
  const body = {
    id: "rich-body",
    type: "text" as const,
    role: "body" as const,
    text: "Review the evidence\nChoose an owner",
    richText: {
      paragraphs: [
        {
          kind: "paragraph" as const,
          runs: [{ text: "Review the evidence", bold: true as const }],
        },
        {
          kind: "bullet" as const,
          runs: [{ text: "Choose an owner", href: "https://example.com/next" }],
        },
      ],
    },
    frame: { x: 5, y: 60, width: 90, height: 15 },
  };
  return {
    ...block,
    scene: {
      ...block.scene,
      schemaVersion: 2 as const,
      nodes: [...block.scene.nodes, body],
      readingOrder: [...block.scene.readingOrder, body.id],
    },
  };
}

export function nativeSceneBlock(mediaIds: string[] = [], title = "Native evidence") {
  const nodes = [
    {
      id: "title",
      type: "text" as const,
      role: "title" as const,
      text: title,
      frame: { x: 5, y: 5, width: 90, height: 15 },
    },
    ...mediaIds.map((mediaId, index) => ({
      id: `image-${index}`,
      type: "image" as const,
      mediaId,
      altText: `Evidence diagram ${index + 1}`,
      frame: { x: 5 + index * 40, y: 25, width: 35, height: 45 },
    })),
    {
      id: "shape",
      type: "shape" as const,
      shape: "rectangle" as const,
      color: "blue" as const,
      label: "Discuss the result",
      frame: { x: 10, y: 80, width: 70, height: 15 },
    },
    {
      id: "connector",
      type: "connector" as const,
      from: { nodeId: "title", anchor: "bottom" as const },
      to: { nodeId: "shape", anchor: "top" as const },
      label: "supports",
      color: "blue" as const,
    },
  ];
  return {
    id: randomUUID(),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE native speaker note",
    citations: [{ locator: "PRIVATE locator", excerpt: "PRIVATE native citation" }],
    sourceDisclosure: {
      sourceName: "PRIVATE source",
      sourceDigest: "a".repeat(64),
      provider: "PRIVATE provider",
      model: "PRIVATE model",
    },
    scene: {
      schemaVersion: 1 as const,
      aspectRatio: "16:9" as const,
      nodes,
      readingOrder: nodes.map(({ id }) => id),
    },
  };
}
