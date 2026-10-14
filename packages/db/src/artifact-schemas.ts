import {
  PresentationContentSchema,
  PresentationDraftSchema,
  QuizContentSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackDraftSchema,
  migratePresentationV1,
  requiresExtendedRoundResponses,
  hasRankingQuestions,
  hasTextOpinionQuestions,
  type PresentationContent,
  type PresentationDraft,
  type QuizDraft,
  type RecoveryPackContent,
  type RecoveryPackDraft,
} from "@openround/contracts";

export const ROUND_DRAFT_SCHEMA_VERSION = 1;
export const ROUND_CONTENT_SCHEMA_VERSION = 1;
export const ROUND_EXTENDED_RESPONSE_SCHEMA_VERSION = 2;
export const ROUND_RANKING_SCHEMA_VERSION = 3;
export const ROUND_TEXT_OPINION_SCHEMA_VERSION = 4;
export function roundArtifactSchemaVersion(content: QuizDraft): 1 | 2 | 3 | 4 {
  return hasTextOpinionQuestions(content)
    ? 4
    : hasRankingQuestions(content)
      ? 3
      : requiresExtendedRoundResponses(content)
        ? 2
        : 1;
}
function assertLegacyRoundResponses(content: QuizDraft): QuizDraft {
  assertPreRankingRound(content);
  if (requiresExtendedRoundResponses(content)) {
    throw new Error("Multiple-selection polls require Round artifact schema version 2");
  }
  return content;
}
function assertPreRankingRound(content: QuizDraft): QuizDraft {
  assertPreTextRound(content);
  if (hasRankingQuestions(content))
    throw new Error("Rankings require Round artifact schema version 3");
  return content;
}
function assertPreTextRound(content: QuizDraft): QuizDraft {
  if (hasTextOpinionQuestions(content))
    throw new Error("Text opinions require Round artifact schema version 4");
  return content;
}
export const PRESENTATION_DRAFT_SCHEMA_VERSION = 2;
export const PRESENTATION_CONTENT_SCHEMA_VERSION = 2;
/** Complete frozen Pack baselines opt into v3; pre-existing question provenance stays valid in v2. */
export const PRESENTATION_RECOVERY_PACK_SCHEMA_VERSION = 3;
export const RECOVERY_PACK_DRAFT_SCHEMA_VERSION = 1;
export const RECOVERY_PACK_CONTENT_SCHEMA_VERSION = 1;

export type PersistedArtifactType = "round" | "presentation" | "recovery_pack";
export type PersistedArtifactDocument = "draft" | "content";

/**
 * Raised before parsing when persisted JSON declares a version for which this process has no
 * deterministic upcaster. Keeping this distinct from contract validation failures lets callers
 * distinguish a deploy-order problem from corrupt persisted data.
 */
export class UnsupportedArtifactSchemaVersionError extends Error {
  readonly code = "UNSUPPORTED_ARTIFACT_SCHEMA_VERSION";

  constructor(
    public readonly artifactType: PersistedArtifactType,
    public readonly document: PersistedArtifactDocument,
    public readonly schemaVersion: unknown,
    public readonly supportedVersions: readonly number[],
  ) {
    super(
      `Unsupported ${artifactType} ${document} schema version ${String(schemaVersion)}; supported versions: ${supportedVersions.join(", ")}`,
    );
    this.name = "UnsupportedArtifactSchemaVersionError";
  }
}

type Upcaster<T> = (value: unknown) => T;

function resolveUpcaster<T>(
  artifactType: PersistedArtifactType,
  document: PersistedArtifactDocument,
  schemaVersion: unknown,
  upcasters: ReadonlyMap<number, Upcaster<T>>,
): Upcaster<T> {
  // Version columns were introduced after the original tables. Treat an absent in-memory value as
  // v1, matching the database migration defaults, but never silently guess for another value.
  const version = schemaVersion == null ? 1 : schemaVersion;
  const upcaster =
    typeof version === "number" && Number.isInteger(version) ? upcasters.get(version) : undefined;
  if (!upcaster) {
    throw new UnsupportedArtifactSchemaVersionError(artifactType, document, schemaVersion, [
      ...upcasters.keys(),
    ]);
  }
  return upcaster;
}

function parseVersioned<T>(
  artifactType: PersistedArtifactType,
  document: PersistedArtifactDocument,
  value: unknown,
  schemaVersion: unknown,
  upcasters: ReadonlyMap<number, Upcaster<T>>,
): T {
  return resolveUpcaster(artifactType, document, schemaVersion, upcasters)(value);
}

const roundDraftUpcasters = new Map<number, Upcaster<QuizDraft>>([
  [ROUND_DRAFT_SCHEMA_VERSION, (value) => assertLegacyRoundResponses(QuizDraftSchema.parse(value))],
  [
    ROUND_EXTENDED_RESPONSE_SCHEMA_VERSION,
    (value) => assertPreRankingRound(QuizDraftSchema.parse(value)),
  ],
  [ROUND_RANKING_SCHEMA_VERSION, (value) => assertPreTextRound(QuizDraftSchema.parse(value))],
  [ROUND_TEXT_OPINION_SCHEMA_VERSION, (value) => QuizDraftSchema.parse(value)],
]);

const roundContentUpcasters = new Map<number, Upcaster<QuizDraft>>([
  [
    ROUND_CONTENT_SCHEMA_VERSION,
    (value) => assertLegacyRoundResponses(QuizContentSchema.parse(value)),
  ],
  [
    ROUND_EXTENDED_RESPONSE_SCHEMA_VERSION,
    (value) => assertPreRankingRound(QuizContentSchema.parse(value)),
  ],
  [ROUND_RANKING_SCHEMA_VERSION, (value) => assertPreTextRound(QuizContentSchema.parse(value))],
  [ROUND_TEXT_OPINION_SCHEMA_VERSION, (value) => QuizContentSchema.parse(value)],
]);

const recoveryPackDraftUpcasters = new Map<number, Upcaster<RecoveryPackDraft>>([
  [RECOVERY_PACK_DRAFT_SCHEMA_VERSION, (value) => RecoveryPackDraftSchema.parse(value)],
]);
const recoveryPackContentUpcasters = new Map<number, Upcaster<RecoveryPackContent>>([
  [RECOVERY_PACK_CONTENT_SCHEMA_VERSION, (value) => RecoveryPackContentSchema.parse(value)],
]);

const presentationDraftUpcasters = new Map<number, Upcaster<PresentationDraft>>([
  [
    1,
    (value) =>
      PresentationDraftSchema.parse(withPresentationSchemaVersion(migratePresentationV1(value), 2)),
  ],
  [
    PRESENTATION_DRAFT_SCHEMA_VERSION,
    (value) => PresentationDraftSchema.parse(withPresentationSchemaVersion(value, 2)),
  ],
  [
    PRESENTATION_RECOVERY_PACK_SCHEMA_VERSION,
    (value) => PresentationDraftSchema.parse(withPresentationSchemaVersion(value, 3)),
  ],
]);

const presentationContentUpcasters = new Map<number, Upcaster<PresentationContent>>([
  [
    1,
    (value) =>
      PresentationContentSchema.parse(
        withPresentationSchemaVersion(migratePresentationV1(value), 2),
      ),
  ],
  [
    PRESENTATION_CONTENT_SCHEMA_VERSION,
    (value) => PresentationContentSchema.parse(withPresentationSchemaVersion(value, 2)),
  ],
  [
    PRESENTATION_RECOVERY_PACK_SCHEMA_VERSION,
    (value) => PresentationContentSchema.parse(withPresentationSchemaVersion(value, 3)),
  ],
]);

function withPresentationSchemaVersion(value: unknown, version: number): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { ...value, schemaVersion: version };
}

export function upcastRoundDraft(value: unknown, schemaVersion?: unknown): QuizDraft {
  return parseVersioned("round", "draft", value, schemaVersion, roundDraftUpcasters);
}

export function upcastRoundContent(value: unknown, schemaVersion?: unknown): QuizDraft {
  return parseVersioned("round", "content", value, schemaVersion, roundContentUpcasters);
}

/** Bounded metadata reads must not guess the interpretation of an unsupported stored version. */
export function assertRoundContentSchemaVersion(schemaVersion: unknown): void {
  resolveUpcaster("round", "content", schemaVersion, roundContentUpcasters);
}

export function upcastRecoveryPackDraft(
  value: unknown,
  schemaVersion?: unknown,
): RecoveryPackDraft {
  return parseVersioned("recovery_pack", "draft", value, schemaVersion, recoveryPackDraftUpcasters);
}

export function upcastRecoveryPackContent(
  value: unknown,
  schemaVersion?: unknown,
): RecoveryPackContent {
  return parseVersioned(
    "recovery_pack",
    "content",
    value,
    schemaVersion,
    recoveryPackContentUpcasters,
  );
}

export function upcastPresentationDraft(
  value: unknown,
  schemaVersion?: unknown,
): PresentationDraft {
  return parseVersioned("presentation", "draft", value, schemaVersion, presentationDraftUpcasters);
}

export function upcastPresentationContent(
  value: unknown,
  schemaVersion?: unknown,
): PresentationContent {
  return parseVersioned(
    "presentation",
    "content",
    value,
    schemaVersion,
    presentationContentUpcasters,
  );
}

/**
 * Legacy live snapshots used draft validation, including partially authored old snapshots.
 * Preserve that read path, but validate session-only metadata with the frozen content contract
 * so it cannot be stripped by the authoring parser or restore invalid live insertion metadata.
 */
export function upcastPresentationSessionContent(
  value: unknown,
  schemaVersion?: unknown,
): PresentationContent {
  if (
    value &&
    typeof value === "object" &&
    ("liveQuickCheck" in value || "livePublishedQuestions" in value)
  ) {
    return upcastPresentationContent(value, schemaVersion);
  }
  return upcastPresentationDraft(value, schemaVersion) as PresentationContent;
}
