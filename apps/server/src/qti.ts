import { randomUUID } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { z } from "zod";
import {
  QuestionDraftSchema,
  QuizContentSchema,
  QuizDraftSchema,
  RecoveryPackExportReportSchema,
  normalizeDecimalString,
  type ImportValidationReport,
  type QuestionDraft,
  type QuizDraft,
  type RecoveryPackExportReport,
} from "@openround/contracts";
import { isXml10CodePoint } from "./portable-text.js";

type ImportIssue = ImportValidationReport["errors"][number];

export interface QtiImportResult {
  draft: QuizDraft | null;
  validation: ImportValidationReport;
}

export interface QtiExportResult {
  archive: Buffer | null;
  validation: ImportValidationReport;
}

interface OpenRoundQtiMetadata {
  version: 1;
  sourceId: string;
  type: QuestionDraft["type"];
  purpose?: QuestionDraft["purpose"];
  confidence?: QuestionDraft["confidence"];
  delivery?: QuestionDraft["delivery"];
  conceptKeys?: string[];
  linkedRecheckSourceId?: string | null;
  timeLimitSeconds: number;
  basePoints: number;
  explanation: string;
  unit?: string | null;
  tolerance?: string;
  mediaOmitted?: boolean;
  choices?: Array<{
    qtiIdentifier: string;
    feedback?: string;
    misconceptionKey?: string;
  }>;
}

const OpenRoundQtiMetadataSchema = z.object({
  version: z.literal(1),
  sourceId: z.string().min(1).max(500),
  type: z.enum(["single_select", "true_false", "multi_select", "numeric", "rating", "poll"]),
  purpose: z.enum(["diagnostic", "practice", "opinion"]).optional(),
  confidence: z.enum(["off", "optional", "required"]).optional(),
  delivery: z.enum(["main", "recheck"]).optional(),
  conceptKeys: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  linkedRecheckSourceId: z.string().min(1).max(500).nullable().optional(),
  timeLimitSeconds: z.number().int().min(5).max(300),
  basePoints: z.number().int().min(0).max(10_000),
  explanation: z.string().max(1_000),
  unit: z.string().max(32).nullable().optional(),
  tolerance: z.string().max(64).optional(),
  mediaOmitted: z.boolean().optional(),
  choices: z
    .array(
      z.object({
        qtiIdentifier: z.string().min(1).max(500),
        feedback: z.string().max(500).optional(),
        misconceptionKey: z.string().trim().min(1).max(80).optional(),
      }),
    )
    .max(6)
    .optional(),
});

const QTI_NAMESPACE = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
const PACKAGE_NAMESPACE = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1";
const MAX_ARCHIVE_BYTES = 6_000_000;
const MAX_ENTRIES = 250;
const MAX_UNCOMPRESSED_BYTES = 20_000_000;
const MAX_XML_BYTES = 1_000_000;
const MAX_COMPRESSION_RATIO = 100;

const xmlParser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  cdataPropName: "#cdata",
  preserveOrder: true,
  removeNSPrefix: true,
  trimValues: false,
});

const XML_CONTENT = Symbol("ordered XML content");
type XmlSegment = { name: string; value: unknown };
type XmlObject = Record<string, unknown> & { [XML_CONTENT]: XmlSegment[] };

// Keep the structural shape used by manifest/response readers, but retain the
// parser's ordered segments for text extraction instead of grouping CDATA first.
function xmlObject(nodes: Array<Record<string, unknown>>, depth = 0): XmlObject {
  if (depth > 64) throw new Error("QTI XML exceeds the supported nesting depth");
  const result = Object.create(null) as XmlObject;
  const segments: XmlSegment[] = [];
  let text = "";
  for (const node of nodes) {
    for (const [name, children] of Object.entries(node)) {
      if (name === ":@") continue;
      if (name === "#text") {
        text += String(children);
        segments.push({ name, value: children });
        continue;
      }
      let value: unknown;
      if (name === "#cdata") {
        value = (children as Array<Record<string, unknown>>)
          .map((child) => String(child["#text"] ?? ""))
          .join("");
      } else {
        const child = xmlObject(children as Array<Record<string, unknown>>, depth + 1);
        const attributes = objectValue(node[":@"]);
        if (attributes) {
          for (const [key, value] of Object.entries(attributes)) {
            child[key] = typeof value === "string" ? value.trim() : value;
          }
        }
        const keys = Object.keys(child);
        value =
          keys.length === 0
            ? ""
            : keys.length === 1 && keys[0] === "#text"
              ? child["#text"]
              : child;
      }
      if (Object.hasOwn(result, name)) {
        const existing = result[name];
        if (Array.isArray(existing)) existing.push(value);
        else result[name] = [existing, value];
      } else result[name] = value;
      segments.push({ name, value });
    }
  }
  if (text.length) result["#text"] = text;
  Object.defineProperty(result, XML_CONTENT, { value: segments });
  return result;
}

function issue(
  severity: ImportIssue["severity"],
  code: string,
  message: string,
  details: Pick<ImportIssue, "row" | "field"> = {},
): ImportIssue {
  return { severity, code, message, ...details };
}

function validation(importedCheckpoints: number, issues: ImportIssue[]): ImportValidationReport {
  return {
    format: "qti3",
    importedCheckpoints,
    errors: issues.filter((candidate) => candidate.severity === "error"),
    warnings: issues.filter((candidate) => candidate.severity === "warning"),
  };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function xml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\r", "&#13;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function qtiIdentifier(prefix: string, value: string) {
  return `${prefix}_${value.replaceAll("-", "_").replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}

function qtiMetadata(question: QuestionDraft, choiceIdentifiers: string[]) {
  const metadata: OpenRoundQtiMetadata = {
    version: 1,
    sourceId: question.id,
    type: question.type,
    purpose: question.purpose,
    confidence: question.confidence,
    delivery: question.delivery,
    conceptKeys: question.conceptKeys,
    linkedRecheckSourceId: question.linkedRecheckQuestionId,
    timeLimitSeconds: question.timeLimitSeconds,
    basePoints: question.basePoints,
    explanation: question.explanation,
    mediaOmitted: Boolean(question.mediaId),
    ...(question.type === "numeric" ? { unit: question.unit, tolerance: question.tolerance } : {}),
    ...(question.type === "single_select" ||
    question.type === "true_false" ||
    question.type === "multi_select"
      ? {
          choices: question.choices.map((choice, index) => ({
            qtiIdentifier: choiceIdentifiers[index]!,
            ...(choice.feedback ? { feedback: choice.feedback } : {}),
            ...(choice.misconceptionKey ? { misconceptionKey: choice.misconceptionKey } : {}),
          })),
        }
      : {}),
  };
  return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
}

function decimalParts(value: string) {
  const normalized = normalizeDecimalString(value);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer = "0", fraction = ""] = unsigned.split(".");
  const amount = BigInt(`${integer}${fraction}` || "0") * (negative ? -1n : 1n);
  return { amount, scale: fraction.length };
}

function scaledDecimal(amount: bigint, scale: number) {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(scale + 1, "0");
  const integer = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return `${negative && amount !== 0n ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function numericBounds(expected: string, tolerance: string) {
  const expectedParts = decimalParts(expected);
  const toleranceParts = decimalParts(tolerance);
  const scale = Math.max(expectedParts.scale, toleranceParts.scale);
  const expectedScaled = expectedParts.amount * 10n ** BigInt(scale - expectedParts.scale);
  const toleranceScaled = toleranceParts.amount * 10n ** BigInt(scale - toleranceParts.scale);
  return {
    lower: scaledDecimal(expectedScaled - toleranceScaled, scale),
    upper: scaledDecimal(expectedScaled + toleranceScaled, scale),
  };
}

function itemXml(question: QuestionDraft, setTitle: string) {
  const itemId = qtiIdentifier("item", question.id);
  // Do not split a valid Unicode pair at the item-title truncation boundary.
  const title = `${setTitle}: ${question.prompt}`.slice(0, 160).replace(/[\uD800-\uDBFF]$/, "");
  const supportedChoice =
    question.type === "single_select" ||
    question.type === "true_false" ||
    question.type === "multi_select";
  const choiceIdentifiers = supportedChoice
    ? question.choices.map((choice) => qtiIdentifier("choice", choice.id))
    : [];
  const metadata = qtiMetadata(question, choiceIdentifiers);
  const metadataOutcome = `<qti-outcome-declaration identifier="OPENROUND_METADATA" cardinality="single" base-type="string"><qti-default-value><qti-value>${metadata}</qti-value></qti-default-value></qti-outcome-declaration>`;
  const scoreOutcome = `<qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>`;
  let responseDeclaration: string;
  let body: string;
  let processing: string;

  if (supportedChoice) {
    const correct = question.choices
      .map((choice, index) => (choice.isCorrect ? choiceIdentifiers[index] : null))
      .filter((identifier): identifier is string => Boolean(identifier));
    responseDeclaration = `<qti-response-declaration identifier="RESPONSE" cardinality="${question.type === "multi_select" ? "multiple" : "single"}" base-type="identifier"><qti-correct-response>${correct.map((identifier) => `<qti-value>${xml(identifier)}</qti-value>`).join("")}</qti-correct-response></qti-response-declaration>`;
    body = `<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="${question.type === "multi_select" ? correct.length : 1}"><qti-prompt>${xml(question.prompt)}</qti-prompt>${question.choices.map((choice, index) => `<qti-simple-choice identifier="${xml(choiceIdentifiers[index])}">${xml(choice.label)}</qti-simple-choice>`).join("")}</qti-choice-interaction></qti-item-body>`;
    processing = `<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>`;
  } else if (question.type === "numeric") {
    const expected = normalizeDecimalString(question.correctValue);
    const tolerance = normalizeDecimalString(question.tolerance);
    responseDeclaration = `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="float"><qti-correct-response><qti-value>${xml(expected)}</qti-value></qti-correct-response></qti-response-declaration>`;
    body = `<qti-item-body><p>${xml(question.prompt)}</p><p><qti-text-entry-interaction response-identifier="RESPONSE" expected-length="12"/>${question.unit ? ` ${xml(question.unit)}` : ""}</p></qti-item-body>`;
    if (tolerance === "0") {
      processing = `<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>`;
    } else {
      const { lower, upper } = numericBounds(expected, tolerance);
      processing = `<qti-response-processing><qti-response-condition><qti-response-if><qti-and><qti-gte><qti-variable identifier="RESPONSE"/><qti-base-value base-type="float">${xml(lower)}</qti-base-value></qti-gte><qti-lte><qti-variable identifier="RESPONSE"/><qti-base-value base-type="float">${xml(upper)}</qti-base-value></qti-lte></qti-and><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-if><qti-response-else><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0</qti-base-value></qti-set-outcome-value></qti-response-else></qti-response-condition></qti-response-processing>`;
    }
  } else {
    throw new Error(`Unsupported QTI checkpoint type ${question.type}`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<qti-assessment-item xmlns="${QTI_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${QTI_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd" identifier="${xml(itemId)}" title="${xml(title)}" adaptive="false" time-dependent="false" xml:lang="en">${responseDeclaration}${scoreOutcome}${metadataOutcome}${body}${processing}</qti-assessment-item>\n`;
}

function manifestXml(draft: QuizDraft, resources: Array<{ identifier: string; href: string }>) {
  const manifestId = qtiIdentifier("manifest", randomUUID());
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="${PACKAGE_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="${manifestId}" xsi:schemaLocation="${PACKAGE_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_imscpv1p2_v1p0.xsd">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    ${resources.map(({ identifier, href }) => `<resource identifier="${xml(identifier)}" type="imsqti_item_xmlv3p0" href="${xml(href)}"><file href="${xml(href)}"/></resource>`).join("\n    ")}
  </resources>
</manifest>
`;
}

async function zipBuffers(files: Array<{ path: string; content: Buffer }>) {
  const archive = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const file of files) {
    archive.addBuffer(file.content, file.path, {
      mtime: new Date("1980-01-01T00:00:00.000Z"),
      mode: 0o100644,
    });
  }
  archive.end();
  return completed;
}

export function qtiExportTextIssues(draft: QuizDraft): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const inspect = (text: string, field: string, row?: number) => {
    if ([...text].some((character) => !isXml10CodePoint(character.codePointAt(0)!))) {
      issues.push(
        issue(
          "error",
          "INVALID_QTI_TEXT",
          "This exported text contains characters forbidden by XML 1.0, including invalid Unicode surrogates. No QTI package is exported.",
          { field, ...(row ? { row } : {}) },
        ),
      );
    }
  };
  inspect(draft.title, "title");
  for (const [index, question] of draft.questions.entries()) {
    inspect(question.prompt, `questions.${index}.prompt`, index + 1);
    if ("choices" in question) {
      for (const [choiceIndex, choice] of question.choices.entries()) {
        inspect(choice.label, `questions.${index}.choices.${choiceIndex}.label`, index + 1);
      }
    }
    if (question.type === "numeric" && question.unit) {
      inspect(question.unit, `questions.${index}.unit`, index + 1);
    }
  }
  return issues;
}

export async function exportQtiPackage(
  draft: QuizDraft,
  options: { exportReport?: RecoveryPackExportReport } = {},
): Promise<QtiExportResult> {
  const issues: ImportIssue[] = qtiExportTextIssues(draft);
  const complete = QuizContentSchema.safeParse(draft);
  if (!complete.success) {
    for (const problem of complete.error.issues.slice(0, 50)) {
      issues.push(
        issue("error", "INCOMPLETE_CHECKPOINT_SET", problem.message, {
          field: problem.path.map(String).join("."),
          ...(problem.path[0] === "questions" && typeof problem.path[1] === "number"
            ? { row: problem.path[1] + 1 }
            : {}),
        }),
      );
    }
  }
  for (const [index, question] of draft.questions.entries()) {
    if (["rating", "poll", "ranking", "open_text", "word_cloud"].includes(question.type)) {
      issues.push(
        issue(
          "error",
          "UNSUPPORTED_QTI_CHECKPOINT",
          `${question.type.replaceAll("_", " ")} checkpoints are outside the Polling Pops QTI 3 profile.`,
          { row: index + 1, field: "type" },
        ),
      );
    }
    if (question.mediaId) {
      issues.push(
        issue(
          "warning",
          "QTI_MEDIA_OMITTED",
          "Private checkpoint media is not included in the QTI package.",
          { row: index + 1, field: "mediaId" },
        ),
      );
    }
  }
  if (issues.some((candidate) => candidate.severity === "error")) {
    return { archive: null, validation: validation(0, issues) };
  }

  const resources = draft.questions.map((question) => ({
    identifier: qtiIdentifier("resource", question.id),
    href: `items/${qtiIdentifier("item", question.id)}.xml`,
  }));
  const files = resources.map((resource, index) => ({
    path: resource.href,
    content: Buffer.from(itemXml(draft.questions[index]!, draft.title), "utf8"),
  }));
  files.unshift({
    path: "imsmanifest.xml",
    content: Buffer.from(manifestXml(draft, resources), "utf8"),
  });
  if (options.exportReport) {
    files.push({
      path: "openround-export-report.json",
      content: Buffer.from(
        `${JSON.stringify(RecoveryPackExportReportSchema.parse(options.exportReport), null, 2)}\n`,
        "utf8",
      ),
    });
  }
  return {
    archive: await zipBuffers(files),
    validation: validation(draft.questions.length, issues),
  };
}

function safeArchivePath(path: string) {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    throw new Error(`Unsafe archive path: ${path || "(empty)"}`);
  }
}

async function streamBuffer(stream: NodeJS.ReadableStream, maximum: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? Buffer.from(raw)
        : Buffer.from(raw as Uint8Array);
    size += chunk.length;
    if (size > maximum) throw new Error("Archive entry exceeds its allowed size");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readQtiArchive(data: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error("QTI package is not valid base64 data");
  }
  const buffer = Buffer.from(data, "base64");
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error("QTI package exceeds the 6 MB limit");
  if (buffer.subarray(0, 2).toString("binary") !== "PK") {
    throw new Error("QTI package must be a ZIP archive");
  }
  const archive = await yauzl.fromBufferPromise(buffer, {
    autoClose: true,
    decodeStrings: true,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  if (archive.entryCount > MAX_ENTRIES) {
    archive.close();
    throw new Error(`QTI package contains more than ${MAX_ENTRIES} entries`);
  }
  const files = new Map<string, Buffer>();
  let totalSize = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      safeArchivePath(entry.fileName);
      if (entry.fileName.endsWith("/")) continue;
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error(`Unsupported encrypted or compressed entry: ${entry.fileName}`);
      }
      totalSize += entry.uncompressedSize;
      if (totalSize > MAX_UNCOMPRESSED_BYTES) {
        throw new Error("QTI package exceeds the 20 MB expanded-size limit");
      }
      if (
        entry.uncompressedSize > 0 &&
        (entry.compressedSize === 0 ||
          entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
      ) {
        throw new Error(`Suspicious compression ratio for ${entry.fileName}`);
      }
      const isXml = entry.fileName.toLocaleLowerCase().endsWith(".xml");
      const entryLimit = isXml ? MAX_XML_BYTES : Math.min(entry.uncompressedSize, 5_000_000);
      const content = await streamBuffer(await archive.openReadStreamPromise(entry), entryLimit);
      if (content.length !== entry.uncompressedSize) {
        throw new Error(`Archive size mismatch for ${entry.fileName}`);
      }
      if (files.has(entry.fileName)) throw new Error(`Duplicate archive entry ${entry.fileName}`);
      files.set(entry.fileName, content);
    }
  } finally {
    if (archive.isOpen) archive.close();
  }
  return files;
}

function safeXmlDocument(content: Buffer, fileName: string) {
  if (content.includes(0)) throw new Error(`${fileName} contains a NUL byte`);
  const source = content.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error(`${fileName} contains a prohibited document type or entity declaration`);
  }
  if (/\b(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i.test(source)) {
    throw new Error(`${fileName} contains a prohibited remote resource reference`);
  }
  const wellFormed = XMLValidator.validate(source);
  if (wellFormed !== true) {
    throw new Error(
      `${fileName} is not well-formed XML (${wellFormed.err.msg} at ${wellFormed.err.line}:${wellFormed.err.col})`,
    );
  }
  let depth = 0;
  for (const match of source.matchAll(/<\/?[A-Za-z_][^>]*?>/g)) {
    const token = match[0];
    if (token.startsWith("</")) depth -= 1;
    else if (!token.endsWith("/>")) depth += 1;
    if (depth > 64) throw new Error(`${fileName} exceeds the XML nesting limit`);
    if (depth < 0) throw new Error(`${fileName} has malformed XML nesting`);
  }
  if (depth !== 0) throw new Error(`${fileName} has malformed XML nesting`);
  return {
    source,
    parsed: xmlObject(xmlParser.parse(source) as Array<Record<string, unknown>>),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findByKey(value: unknown, key: string, depth = 0): unknown {
  if (depth > 64) throw new Error("QTI item exceeds the supported nesting depth");
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findByKey(child, key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = objectValue(value);
  if (!object) return undefined;
  if (key in object) return object[key];
  for (const child of Object.values(object)) {
    const found = findByKey(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function xmlText(value: string) {
  // XML 1.0 predefined entities and character references only, in one pass. Never
  // resolve arbitrary entities or parse the decoded result as XML (including &amp;amp;).
  const predefined: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return value.replace(/&(?:amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g, (reference) => {
    const name = reference.slice(1, -1);
    if (!name.startsWith("#")) return predefined[name]!;
    const codePoint = name.startsWith("#x")
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    if (isXml10CodePoint(codePoint)) {
      return String.fromCodePoint(codePoint);
    }
    throw new Error("QTI text contains a prohibited XML character reference");
  });
}

function orderedTextContent(value: unknown, depth = 0, decodeEntities = true): string {
  if (depth > 64) throw new Error("QTI text exceeds the supported nesting depth");
  if (typeof value === "string" || typeof value === "number") {
    return decodeEntities ? xmlText(String(value)) : String(value);
  }
  if (Array.isArray(value)) {
    return value.map((child) => orderedTextContent(child, depth + 1, decodeEntities)).join(" ");
  }
  const object = objectValue(value);
  if (!object) return "";
  return (object as XmlObject)[XML_CONTENT].filter(
    ({ name: key }) =>
      key === "#text" ||
      key === "#cdata" ||
      key.startsWith("qti-") ||
      [
        "p",
        "div",
        "span",
        "em",
        "strong",
        "b",
        "i",
        "u",
        "small",
        "sub",
        "sup",
        "code",
        "pre",
        "blockquote",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "math",
        "mi",
        "mn",
        "mo",
        "mtext",
      ].includes(key),
  )
    .map(({ name, value: child }) => {
      const text = orderedTextContent(child, depth + 1, decodeEntities && name !== "#cdata");
      // Paragraph/list/table boundaries separate words; inline markup and CDATA
      // concatenate exactly as authored, including whitespace at their edges.
      return [
        "p",
        "div",
        "pre",
        "blockquote",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ].includes(name)
        ? ` ${text} `
        : text;
    })
    .join("");
}

function textContent(value: unknown): string {
  const text = orderedTextContent(value);
  // Do not normalize individual segments: doing so removes spaces at CDATA and
  // inline-element boundaries. Own-profile plain text keeps internal CR/CRLF.
  return typeof value === "object" ? text.replace(/\s+/g, " ").trim() : text.trim();
}

function numericPrompt(body: unknown, ownProfile: boolean) {
  const paragraphs = asArray(objectValue(body)?.p);
  // Our profile places the prompt and entry/unit in separate paragraphs. Do not
  // append the unit to the authored prompt; leave generalized external imports unchanged.
  if (
    ownProfile &&
    paragraphs.length === 2 &&
    !findByKey(paragraphs[0], "qti-text-entry-interaction") &&
    findByKey(paragraphs[1], "qti-text-entry-interaction")
  ) {
    return textContent(paragraphs[0]);
  }
  return textContent(findByKey(body, "p"));
}

function choiceLabel(choice: Record<string, unknown>, ownProfile: boolean) {
  // Own exports use literal text, not mixed markup. Preserve its authored internal
  // whitespace; keep external rich-text normalization and allowlists unchanged.
  if (
    ownProfile &&
    typeof choice["#text"] === "string" &&
    Object.keys(choice).every((key) => key === "identifier" || key === "#text")
  ) {
    return textContent(choice["#text"]);
  }
  return textContent(choice);
}

function outcomeValue(item: Record<string, unknown>, identifier: string) {
  const declarations = asArray(item["qti-outcome-declaration"]);
  const declaration = declarations
    .map(objectValue)
    .find((candidate) => candidate?.identifier === identifier);
  return declaration ? textContent(findByKey(declaration, "qti-value")) : "";
}

function responseDeclaration(item: Record<string, unknown>) {
  const declarations = asArray(item["qti-response-declaration"])
    .map(objectValue)
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  return declarations.find((candidate) => candidate.identifier === "RESPONSE") ?? declarations[0];
}

function parseMetadata(item: Record<string, unknown>): OpenRoundQtiMetadata | null {
  const encoded = outcomeValue(item, "OPENROUND_METADATA");
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    const metadata = OpenRoundQtiMetadataSchema.safeParse(parsed);
    return metadata.success ? metadata.data : null;
  } catch {
    return null;
  }
}

function parseQtiItem(content: Buffer, fileName: string, row: number, issues: ImportIssue[]) {
  const { source, parsed } = safeXmlDocument(content, fileName);
  const item = objectValue(parsed["qti-assessment-item"]);
  if (!item) throw new Error("Resource is not a QTI 3 assessment item");
  const response = responseDeclaration(item);
  if (!response) throw new Error("QTI item has no response declaration");
  const metadata = parseMetadata(item);
  if (outcomeValue(item, "OPENROUND_METADATA") && !metadata) {
    issues.push(
      issue(
        "warning",
        "INVALID_OPENROUND_QTI_METADATA",
        "Polling Pops metadata could not be read.",
        {
          row,
        },
      ),
    );
  }
  if (/<(?:img|object|audio|video)\b/i.test(source)) {
    issues.push(
      issue(
        "warning",
        "QTI_MEDIA_OMITTED",
        "Media in this QTI item is outside the current import profile and was not imported.",
        { row },
      ),
    );
  }
  const sourceId = metadata?.sourceId || String(item.identifier || fileName);
  const common = {
    id: randomUUID(),
    prompt: "",
    purpose: metadata?.purpose ?? "diagnostic",
    confidence: metadata?.confidence ?? "off",
    delivery: metadata?.delivery ?? "main",
    conceptKeys: metadata?.conceptKeys ?? [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: metadata?.timeLimitSeconds ?? 20,
    basePoints: metadata?.basePoints ?? 1_000,
    explanation: metadata?.explanation ?? "",
    mediaId: null,
    mediaAlt: null,
  };

  const choiceInteraction = objectValue(findByKey(item["qti-item-body"], "qti-choice-interaction"));
  let checkpoint: unknown;
  if (choiceInteraction) {
    const cardinality = String(response.cardinality ?? "single");
    if (cardinality !== "single" && cardinality !== "multiple") {
      throw new Error(`Unsupported choice response cardinality: ${cardinality}`);
    }
    if (response["base-type"] !== "identifier") {
      throw new Error("Choice interaction response must use identifier base type");
    }
    const simpleChoices = asArray(choiceInteraction["qti-simple-choice"])
      .map(objectValue)
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
    const correctIds = new Set(
      asArray(findByKey(response["qti-correct-response"], "qti-value")).flatMap((value) => {
        const text = textContent(value);
        return text ? [text] : [];
      }),
    );
    if (!correctIds.size) throw new Error("Choice interaction has no correct response");
    const choiceIds = simpleChoices.map((choice) => String(choice.identifier ?? ""));
    if (choiceIds.some((identifier) => !identifier)) {
      throw new Error("Every choice must have an identifier");
    }
    if (new Set(choiceIds).size !== choiceIds.length) {
      throw new Error("Choice identifiers must be unique within an item");
    }
    if ([...correctIds].some((identifier) => !choiceIds.includes(identifier))) {
      throw new Error("Correct response references a choice that does not exist");
    }
    const metadataChoices = new Map(
      (metadata?.choices ?? []).map((choice) => [choice.qtiIdentifier, choice]),
    );
    const labels = simpleChoices.map((choice) => choiceLabel(choice, Boolean(metadata)));
    const inferredTrueFalse =
      cardinality === "single" &&
      labels.length === 2 &&
      labels
        .map((label) => label.toLocaleLowerCase())
        .sort()
        .join("|") === "false|true";
    const type =
      metadata?.type === "true_false" ||
      metadata?.type === "single_select" ||
      metadata?.type === "multi_select"
        ? metadata.type
        : cardinality === "multiple"
          ? "multi_select"
          : inferredTrueFalse
            ? "true_false"
            : "single_select";
    if (
      metadata &&
      ((type === "multi_select" && cardinality !== "multiple") ||
        (type !== "multi_select" && cardinality !== "single"))
    ) {
      throw new Error("Polling Pops checkpoint type does not match the QTI response cardinality");
    }
    checkpoint = {
      ...common,
      type,
      prompt:
        textContent(choiceInteraction["qti-prompt"]) ||
        textContent(findByKey(item["qti-item-body"], "p")),
      choices: simpleChoices.map((choice, index) => {
        const identifier = String(choice.identifier ?? "");
        const extra = metadataChoices.get(identifier);
        return {
          id: randomUUID(),
          label: labels[index]!,
          isCorrect: correctIds.has(identifier),
          ...(extra?.feedback ? { feedback: extra.feedback } : {}),
          ...(extra?.misconceptionKey ? { misconceptionKey: extra.misconceptionKey } : {}),
        };
      }),
    };
  } else {
    const textEntry = findByKey(item["qti-item-body"], "qti-text-entry-interaction");
    if (!textEntry) {
      const interaction = source.match(/<qti-([a-z-]+-interaction)\b/i)?.[1] ?? "unknown";
      throw new Error(`Unsupported QTI interaction: ${interaction}`);
    }
    if (response["base-type"] !== "float" && response["base-type"] !== "integer") {
      throw new Error("Numeric text entry response must use float or integer base type");
    }
    if (metadata && metadata.type !== "numeric") {
      throw new Error("Polling Pops checkpoint type does not match the QTI numeric interaction");
    }
    const correctValue = textContent(findByKey(response["qti-correct-response"], "qti-value"));
    if (!correctValue) throw new Error("Numeric QTI item has no static correct response");
    checkpoint = {
      ...common,
      type: "numeric",
      prompt: numericPrompt(item["qti-item-body"], Boolean(metadata)),
      correctValue: normalizeDecimalString(correctValue),
      tolerance: normalizeDecimalString(metadata?.tolerance ?? "0"),
      unit: metadata?.unit ?? null,
    };
    if (!metadata?.tolerance) {
      issues.push(
        issue(
          "warning",
          "QTI_NUMERIC_TOLERANCE_DEFAULTED",
          "No Polling Pops tolerance metadata was present; tolerance was set to zero.",
          { row, field: "tolerance" },
        ),
      );
    }
  }
  const parsedCheckpoint = QuestionDraftSchema.safeParse(checkpoint);
  if (!parsedCheckpoint.success) {
    throw new Error(parsedCheckpoint.error.issues.map((problem) => problem.message).join("; "));
  }
  if (metadata?.mediaOmitted) {
    issues.push(
      issue(
        "warning",
        "QTI_MEDIA_OMITTED",
        "The source checkpoint had private media that was not included in the QTI package.",
        { row, field: "mediaId" },
      ),
    );
  }
  return {
    sourceId,
    linkedSourceId: metadata?.linkedRecheckSourceId ?? null,
    checkpoint: parsedCheckpoint.data,
  };
}

export async function importQtiPackage(data: string, title?: string): Promise<QtiImportResult> {
  const issues: ImportIssue[] = [
    issue(
      "warning",
      "PRESENTATION_DEFAULTED",
      "The QTI profile does not carry Polling Pops presentation metadata; General with the Focus preset was selected.",
    ),
  ];
  let files: Map<string, Buffer>;
  try {
    files = await readQtiArchive(data);
  } catch (error) {
    return {
      draft: null,
      validation: validation(0, [
        issue(
          "error",
          "INVALID_QTI_PACKAGE",
          error instanceof Error ? error.message : "The QTI package is invalid.",
        ),
      ]),
    };
  }
  const manifestBuffer = files.get("imsmanifest.xml");
  if (!manifestBuffer) {
    return {
      draft: null,
      validation: validation(0, [
        issue("error", "QTI_MANIFEST_MISSING", "The QTI package has no imsmanifest.xml file."),
      ]),
    };
  }

  let resources: Array<Record<string, unknown>>;
  try {
    const manifest = safeXmlDocument(manifestBuffer, "imsmanifest.xml").parsed;
    const root = objectValue(manifest.manifest);
    resources = asArray(objectValue(root?.resources)?.resource)
      .map(objectValue)
      .filter((resource): resource is Record<string, unknown> => Boolean(resource));
  } catch (error) {
    return {
      draft: null,
      validation: validation(0, [
        issue(
          "error",
          "INVALID_QTI_MANIFEST",
          error instanceof Error ? error.message : "The QTI manifest is invalid.",
        ),
      ]),
    };
  }

  const itemResources = resources.filter((resource) => {
    if (resource.type === "imsqti_item_xmlv3p0") return true;
    issues.push(
      issue(
        "warning",
        "UNSUPPORTED_QTI_RESOURCE",
        `Resource ${String(resource.identifier ?? resource.href ?? "unknown")} has unsupported type ${String(resource.type ?? "unknown")} and was not imported.`,
      ),
    );
    return false;
  });
  if (itemResources.length > 200) {
    return {
      draft: null,
      validation: validation(0, [
        ...issues,
        issue("error", "TOO_MANY_CHECKPOINTS", "QTI import supports at most 200 items."),
      ]),
    };
  }
  const parsedItems: Array<ReturnType<typeof parseQtiItem>> = [];
  for (const [index, resource] of itemResources.entries()) {
    const href = String(resource.href ?? "");
    try {
      safeArchivePath(href);
      const content = files.get(href);
      if (!content) throw new Error(`Manifest resource is missing: ${href}`);
      parsedItems.push(parseQtiItem(content, href, index + 1, issues));
    } catch (error) {
      issues.push(
        issue(
          "error",
          "INVALID_QTI_ITEM",
          error instanceof Error ? error.message : "QTI item is invalid.",
          { row: index + 1 },
        ),
      );
    }
  }
  if (!parsedItems.length && !issues.some((candidate) => candidate.severity === "error")) {
    issues.push(
      issue("error", "QTI_ITEMS_MISSING", "The QTI package contains no supported item resources."),
    );
  }
  const sourceIds = new Map<string, string>();
  for (const [index, item] of parsedItems.entries()) {
    if (sourceIds.has(item.sourceId)) {
      issues.push(
        issue(
          "error",
          "DUPLICATE_QTI_IDENTIFIER",
          `Duplicate QTI item identifier ${item.sourceId}.`,
          {
            row: index + 1,
          },
        ),
      );
    } else sourceIds.set(item.sourceId, item.checkpoint.id);
  }
  for (const [index, item] of parsedItems.entries()) {
    if (!item.linkedSourceId) continue;
    const linkedId = sourceIds.get(item.linkedSourceId);
    if (!linkedId) {
      issues.push(
        issue(
          "error",
          "QTI_LINKED_RECHECK_MISSING",
          `Linked recheck item ${item.linkedSourceId} is missing from the package.`,
          { row: index + 1, field: "linkedRecheckQuestionId" },
        ),
      );
    } else item.checkpoint.linkedRecheckQuestionId = linkedId;
  }
  if (issues.some((candidate) => candidate.severity === "error")) {
    return { draft: null, validation: validation(parsedItems.length, issues) };
  }
  const parsedDraft = QuizDraftSchema.safeParse({
    title: title ?? "Imported QTI checkpoint set",
    description: "Imported from a QTI 3 package",
    questions: parsedItems.map((item) => item.checkpoint),
  });
  if (!parsedDraft.success) {
    for (const problem of parsedDraft.error.issues) {
      issues.push(
        issue("error", "INVALID_QTI_CONTENT", problem.message, {
          field: problem.path.map(String).join("."),
        }),
      );
    }
    return { draft: null, validation: validation(parsedItems.length, issues) };
  }
  return {
    draft: parsedDraft.data,
    validation: validation(parsedDraft.data.questions.length, issues),
  };
}
