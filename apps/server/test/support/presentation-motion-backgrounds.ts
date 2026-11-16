import { createHash, randomUUID } from "node:crypto";
import { PresentationContentSchema } from "@openround/contracts";
import type { presentationSharingFixture } from "../../../../packages/db/test/support/presentation-sharing-conformance.js";

/** Freeze the motion token beside recognizable private authoring and answer sentinels. */
export async function publishMotionBackgroundFixture(
  fixture: Awaited<ReturnType<typeof presentationSharingFixture>>,
) {
  const content = PresentationContentSchema.parse({
    ...fixture.content,
    schemaVersion: 17,
    blocks: fixture.content.blocks.map((block) =>
      block.kind !== "content"
        ? block
        : {
            ...block,
            textElements: [],
            mediaId: null,
            mediaAlt: null,
            citations: [{ locator: "PRIVATE_SOURCE", excerpt: "PRIVATE_EXCERPT" }],
            scene: {
              schemaVersion: 8,
              aspectRatio: "16:9",
              design: {
                theme: "ocean",
                font: "serif",
                spacing: "compact",
                motionBackground: "ribbons",
              },
              nodes: [
                {
                  id: "title",
                  type: "text",
                  role: "title",
                  text: "Public motion slide",
                  frame: { x: 5, y: 5, width: 90, height: 20 },
                },
              ],
              readingOrder: ["title"],
            },
          },
    ),
  });
  await fixture.presentations.updatePresentationDraft({
    workspaceId: fixture.actor.workspaceId,
    presentationId: fixture.presentation.id,
    draft: content,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId: fixture.actor.userId,
    draftHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  });
  const version = await fixture.presentations.publishPresentation(
    {
      ...fixture.version,
      id: randomUUID(),
      version: 2,
      sourceDraftRevision: 1,
      contentSchemaVersion: 17,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    },
    1,
  );
  return { ...fixture, content, version };
}
