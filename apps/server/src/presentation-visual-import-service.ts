import { createHash, randomUUID } from "node:crypto";
import {
  type CreatePresentationVisualImport,
  type InsertPresentationVisualImport,
  type PresentationBlockDraft,
  PresentationDraftSchema,
} from "@openround/contracts";
import {
  createPresentationVisualImportRepository,
  type CreatorContext,
  type PresentationRepository,
  type Repository,
} from "@openround/db";
import type { MalwareScanner } from "./malware-scanner.js";
import type { StorageService } from "./storage.js";
import { presentationVisualConversionAvailable } from "./presentation-visual-converter.js";

export class PresentationVisualImportError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PresentationVisualImportError";
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function visualImportUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = (8 + (Number.parseInt(hex[16]!, 16) & 3)).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export class PresentationVisualImportService {
  readonly imports;
  constructor(
    private readonly repository: Repository,
    private readonly presentations: PresentationRepository,
    private readonly storage: StorageService,
    private readonly scanner: MalwareScanner | null,
  ) {
    this.imports = createPresentationVisualImportRepository(repository);
  }

  get available() {
    return (
      this.storage.mediaUploadsEnabled &&
      this.scanner !== null &&
      presentationVisualConversionAvailable()
    );
  }

  async create(
    creator: CreatorContext,
    presentationId: string,
    input: CreatePresentationVisualImport,
    allowNewWrites = true,
  ) {
    const presentation = await this.presentations.getPresentation(
      creator.workspaceId,
      presentationId,
    );
    if (!presentation)
      throw new PresentationVisualImportError("NOT_FOUND", 404, "Presentation not found");
    const files = input.files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      bytes: Buffer.from(file.base64, "base64"),
    }));
    const sourceDigest = hash(
      files.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        digest: createHash("sha256").update(file.bytes).digest("hex"),
      })),
    );
    const prior = await this.imports.findByRequest(
      creator.workspaceId,
      presentationId,
      input.requestId.toLowerCase(),
    );
    if (prior) {
      if (prior.requestHash !== sourceDigest)
        throw new PresentationVisualImportError(
          "CONFLICT",
          409,
          "This import request key belongs to a different source",
        );
      return prior.job;
    }
    if (!allowNewWrites)
      throw new PresentationVisualImportError(
        "FEATURE_UNAVAILABLE",
        403,
        "Presentation authoring is unavailable for this workspace",
      );
    if (presentation.status === "archived")
      throw new PresentationVisualImportError(
        "CONFLICT",
        409,
        "Restore this presentation before importing slides",
      );
    if (!this.available || !this.scanner)
      throw new PresentationVisualImportError(
        "DEPENDENCY_UNAVAILABLE",
        503,
        "Visual import is temporarily unavailable. Try again later.",
      );
    if (!(await this.repository.getOperationalFeatures()).mediaUploads)
      throw new PresentationVisualImportError(
        "DEPENDENCY_UNAVAILABLE",
        503,
        "Media uploads are temporarily unavailable",
      );

    // Scan the bounded source before retaining any original, independently of AI authoring.
    for (const file of files) {
      let clean: boolean;
      try {
        clean = (await this.scanner.scan(file.bytes)).clean;
      } catch {
        throw new PresentationVisualImportError(
          "DEPENDENCY_UNAVAILABLE",
          503,
          "The source security scan is temporarily unavailable",
        );
      }
      if (!clean)
        throw new PresentationVisualImportError(
          "VALIDATION_ERROR",
          422,
          "The source did not pass its security scan. Export a new file and try again.",
        );
    }
    const result = await this.imports.create({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      presentationId,
      createdBy: creator.userId,
      requestId: input.requestId.toLowerCase(),
      requestHash: sourceDigest,
      sourceDigest,
      files,
    });
    return result.job;
  }

  async insert(
    creator: CreatorContext,
    presentationId: string,
    jobId: string,
    input: InsertPresentationVisualImport,
    allowNewWrites = true,
  ) {
    jobId = jobId.toLowerCase();
    const draftHash = hash({ kind: "visual-import", jobId, ...input });
    const insertedBlockIds = input.pages.flatMap((page) => [
      visualImportUuid(`${jobId}:${input.mutationId}:visual:${page.pageNumber}`),
      visualImportUuid(`${jobId}:${input.mutationId}:reading:${page.pageNumber}`),
    ]);
    const receipt = await this.presentations.recoverPresentationDraftMutation({
      workspaceId: creator.workspaceId,
      presentationId,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      draftHash,
    });
    if (receipt)
      return {
        presentation: {
          ...receipt,
          hasUnpublishedChanges:
            receipt.currentVersionId === null ||
            receipt.publishedDraftRevision !== receipt.draftRevision,
        },
        insertedBlockIds,
      };
    if (!allowNewWrites)
      throw new PresentationVisualImportError(
        "FEATURE_UNAVAILABLE",
        403,
        "Presentation authoring is unavailable for this workspace",
      );
    const [presentation, job] = await Promise.all([
      this.presentations.getPresentation(creator.workspaceId, presentationId),
      this.imports.get(creator.workspaceId, presentationId, jobId),
    ]);
    if (!presentation || !job)
      throw new PresentationVisualImportError(
        "NOT_FOUND",
        404,
        "Presentation or visual import not found",
      );
    if (presentation.status === "archived")
      throw new PresentationVisualImportError(
        "CONFLICT",
        409,
        "Restore this presentation before importing slides",
      );
    if (job.status !== "ready")
      throw new PresentationVisualImportError(
        "CONFLICT",
        409,
        "Wait for conversion to finish before inserting pages",
      );
    const selected = input.pages.map((selection) => {
      const page = job.pages.find((candidate) => candidate.pageNumber === selection.pageNumber);
      if (!page)
        throw new PresentationVisualImportError(
          "VALIDATION_ERROR",
          422,
          "Select pages from this conversion preview",
        );
      return { selection, page };
    });
    const inserted: PresentationBlockDraft[] = selected.flatMap(({ selection, page }) => {
      const visualId = visualImportUuid(`${job.id}:${input.mutationId}:visual:${page.pageNumber}`);
      const readingId = visualImportUuid(
        `${job.id}:${input.mutationId}:reading:${page.pageNumber}`,
      );
      const disclosure = {
        sourceName: job.sourceName,
        sourceDigest: job.sourceDigest,
        provider: "Polling Pops",
        model: "visual-import-v1",
        conversionNotes: [
          `Source page ${page.pageNumber}; visual slide with an author-reviewed reading slide.`,
          "Raster image fitted to the stage; objects, animation, links, audio and video are not imported.",
        ],
      };
      const base = {
        kind: "content" as const,
        layout: "title_body" as const,
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "",
        sourceDisclosure: disclosure,
      };
      const title = (id: string) => ({
        id: `${id}:title`,
        type: "text" as const,
        role: "title" as const,
        text: selection.title,
        frame: { x: 3, y: 2, width: 94, height: 10 },
      });
      return [
        {
          ...base,
          id: visualId,
          scene: {
            schemaVersion: 1,
            aspectRatio: "16:9",
            nodes: [
              title(visualId),
              {
                id: `${visualId}:image`,
                type: "image",
                mediaId: page.mediaId,
                altText: selection.alternativeText,
                frame: { x: 0, y: 14, width: 100, height: 86 },
              },
            ],
            readingOrder: [`${visualId}:title`, `${visualId}:image`],
          },
        },
        {
          ...base,
          id: readingId,
          scene: {
            schemaVersion: 1,
            aspectRatio: "16:9",
            nodes: [
              title(readingId),
              {
                id: `${readingId}:body`,
                type: "text",
                role: "body",
                text: selection.accessibleText,
                frame: { x: 5, y: 18, width: 90, height: 76 },
              },
            ],
            readingOrder: [`${readingId}:title`, `${readingId}:body`],
          },
        },
      ];
    });
    const blocks = [...presentation.draft.blocks];
    // The durable draft mutation receipt owns retry semantics, even after later edits.
    if (!inserted.some((block) => blocks.some((existing) => existing.id === block.id))) {
      const anchor =
        input.afterBlockId === null
          ? blocks.length - 1
          : blocks.findIndex((block) => block.id === input.afterBlockId);
      if (input.afterBlockId !== null && anchor < 0)
        throw new PresentationVisualImportError(
          "VALIDATION_ERROR",
          422,
          "Choose an insertion point in this presentation",
        );
      const starter = blocks[0];
      const replaceEmptyStarter =
        blocks.length === 1 &&
        starter?.kind === "content" &&
        !starter.scene &&
        !starter.hidden &&
        !starter.mediaId &&
        !starter.speakerNotes &&
        !starter.sourceDisclosure &&
        !starter.citations?.length &&
        !starter.textElements.some((element) => element.text.trim());
      if (blocks.length + inserted.length > 200)
        throw new PresentationVisualImportError(
          "VALIDATION_ERROR",
          422,
          "Select fewer pages. Each page adds a visual and a reading slide, within the 200-block limit.",
        );
      if (replaceEmptyStarter) blocks.splice(0, 1, ...inserted);
      else blocks.splice(anchor + 1, 0, ...inserted);
    }
    const draft = PresentationDraftSchema.parse({
      ...presentation.draft,
      schemaVersion: Math.max(4, presentation.draft.schemaVersion),
      blocks,
    });
    const updated = await this.presentations.updatePresentationDraft({
      workspaceId: creator.workspaceId,
      presentationId,
      draft,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      editorId: creator.userId,
      visualImportId: job.id,
      draftHash,
    });
    if (!updated)
      throw new PresentationVisualImportError("NOT_FOUND", 404, "Presentation not found");
    return {
      presentation: {
        ...updated,
        hasUnpublishedChanges:
          updated.currentVersionId === null ||
          updated.publishedDraftRevision !== updated.draftRevision,
      },
      insertedBlockIds,
    };
  }
}
