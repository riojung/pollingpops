import { describe, expect, it } from "vitest";
import { PresentationDraftSchema, type PresentationContent } from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationAssignmentRepository,
  PRESENTATION_STYLED_SCHEMA_VERSION,
  UnsupportedArtifactSchemaVersionError,
  upcastPresentationDraft,
  upcastPresentationContent,
  upcastPresentationSessionContent,
} from "../src/index.js";
import { expectAdvancedInteractionConformance } from "./support/presentation-advanced-interaction-conformance.js";
import {
  persistStyledPresentation,
  styledPresentationContent,
  styledContentHash,
} from "./support/presentation-styled-scene-conformance.js";

describe("durable styled Presentation artifacts", () => {
  it("explicitly supports matching document18 in draft, publication and session registries without rewriting bytes", () => {
    expect(PRESENTATION_STYLED_SCHEMA_VERSION).toBe(18);
    const source = styledPresentationContent();
    const bytes = JSON.stringify(source);
    for (const parse of [
      upcastPresentationDraft,
      upcastPresentationContent,
      upcastPresentationSessionContent,
    ]) {
      expect(parse(JSON.parse(bytes), 18)).toEqual(source);
      expect(styledContentHash(parse(JSON.parse(bytes), 18))).toBe(styledContentHash(source));
      expect(() => parse(source, 17)).toThrow(/matching embedded/);
      expect(() => parse({ ...source, schemaVersion: 17 }, 17)).toThrow(/version 18/);
      expect(() => parse(source, 19)).toThrow(UnsupportedArtifactSchemaVersionError);
    }
    expect(JSON.stringify(source)).toBe(bytes);
  });

  it("preserves styled drafts/history/publications, legacy frozen versions, private shares and reading assignments", async () => {
    const repository = new MemoryRepository();
    const f = await persistStyledPresentation(repository);
    expect(
      (await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id))?.draft,
    ).toEqual(f.content);
    expect(
      (await f.presentations.listPresentationHistory(f.actor.workspaceId, f.presentation.id))[0],
    ).toMatchObject({ draftSchemaVersion: 18, draft: f.content });
    expect(
      await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id),
    ).toMatchObject({
      contentSchemaVersion: 18,
      content: f.content,
      contentHash: styledContentHash(f.content),
    });
    expect(
      await f.presentations.getPresentationVersion(f.actor.workspaceId, f.legacyVersion.id),
    ).toEqual(f.legacyVersion);
    const request = { ...f.request(), versionId: f.version.id };
    const share = (await f.shares.createShare(request)).share;
    expect(
      (await f.shares.getPublicShare(share.id, request.tokenHash, f.now))?.version.content,
    ).toEqual(f.content);
    const assignments = createPresentationAssignmentRepository(repository);
    const assignment = (await assignments.createAssignment(request)).assignment;
    expect(
      (await assignments.getPublicAssignment(assignment.id, request.tokenHash, f.now))?.version
        .content,
    ).toEqual(f.content);
    const conformance = await expectAdvancedInteractionConformance({
      repository: f.sessions,
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      presentationVersionId: f.version.id,
      createdBy: f.actor.userId,
      content: f.content,
    });
    expect((await f.sessions.getSessionById(conformance.session.id))?.content).toEqual(f.content);
  });

  it("rejects hidden session content and new styles disguised in old scenes while allowing incomplete drafts", () => {
    const hidden = styledPresentationContent();
    Object.assign(hidden.blocks[0]!, { hidden: true });
    expect(upcastPresentationDraft(hidden, 18).blocks[0]).toMatchObject({ hidden: true });
    expect(() => upcastPresentationSessionContent(hidden, 18)).toThrow();
    const old = styledPresentationContent();
    const block = old.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected scene");
    block.scene.schemaVersion = 8;
    expect(() => upcastPresentationDraft(old, 18)).toThrow(/scene schema version 9/);
  });

  it("retains strict style fields, publication semantics and scene budgets", () => {
    const invalid: Array<(content: PresentationContent) => void> = [
      (content) => {
        Object.assign(content.blocks[0]!.kind === "content" && content.blocks[0]!.scene!.design!, {
          palette: "url(evil)",
        });
      },
      ...[
        { size: 145 },
        { size: 11 },
        { weight: 450 },
        { align: "justify" },
        { font: "url(evil)" },
        { leading: 0.8 },
        { color: "white" },
        { unsupported: true },
        null,
      ].map((typography) => (content: PresentationContent) => {
        const block = content.blocks[0]!;
        if (block.kind === "content") Object.assign(block.scene!.nodes[0]!, { typography });
      }),
      (content) => {
        const block = content.blocks[0]!;
        if (block.kind === "content")
          Object.assign(block.scene!.nodes.at(-1)!, { appearance: { fill: "#fff" } });
      },
      (content) => {
        const block = content.blocks[0]!;
        if (block.kind === "content")
          Object.assign(block.scene!.nodes.at(-1)!, { decorative: "true" });
      },
    ];
    for (const edit of invalid) {
      const content = styledPresentationContent();
      edit(content);
      expect(() => upcastPresentationDraft(content, 18)).toThrow();
    }
    const empty = styledPresentationContent();
    const block = empty.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected scene");
    const title = block.scene.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    title.text = "";
    block.scene.nodes = [title, block.scene.nodes.at(-1)!];
    block.scene.readingOrder = block.scene.nodes.map((node) => node.id);
    expect(PresentationDraftSchema.safeParse(empty).success).toBe(true);
    expect(() => upcastPresentationContent(empty, 18)).toThrow(/Add text/);
  });
});
