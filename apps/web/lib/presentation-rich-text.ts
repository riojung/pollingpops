import {
  PresentationRichTextSchema,
  isSafePresentationLink,
  presentationRichTextToPlainText,
  type PresentationRichText,
  type PresentationRichTextParagraph,
  type PresentationRichTextRun,
} from "@openround/contracts";

type Marks = Omit<PresentationRichTextRun, "text">;
type Kind = PresentationRichTextParagraph["kind"];
type Cell = { text: string; marks: Marks; kind: Kind; nextKind?: Kind };

function sameMarks(left: Marks, right: Marks) {
  return left.bold === right.bold && left.italic === right.italic && left.href === right.href;
}

function cells(richText: PresentationRichText): Cell[] {
  return richText.paragraphs.flatMap((paragraph, index) => [
    ...paragraph.runs.flatMap(({ text, ...marks }) =>
      Array.from(text, (text) => ({ text, marks, kind: paragraph.kind })),
    ),
    ...(index < richText.paragraphs.length - 1
      ? [
          {
            text: "\n",
            marks: {},
            kind: paragraph.kind,
            nextKind: richText.paragraphs[index + 1]!.kind,
          },
        ]
      : []),
  ]);
}

function assemble(input: Cell[], emptyKind: Kind): PresentationRichText {
  const paragraphs: PresentationRichTextParagraph[] = [];
  let kind = emptyKind;
  let runs: PresentationRichTextRun[] = [];
  for (const cell of input) {
    if (cell.text === "\n") {
      paragraphs.push({
        kind: runs.length ? kind : cell.kind,
        runs: runs.length ? runs : [{ text: "" }],
      });
      runs = [];
      kind = cell.nextKind ?? cell.kind;
      continue;
    }
    if (!runs.length) kind = cell.kind;
    const previous = runs.at(-1);
    if (previous && sameMarks(previous, cell.marks)) previous.text += cell.text;
    else runs.push({ text: cell.text, ...cell.marks });
  }
  paragraphs.push({ kind, runs: runs.length ? runs : [{ text: "" }] });
  return PresentationRichTextSchema.parse({ paragraphs });
}

function offset(text: string, value: number, end: boolean) {
  let result = Math.max(0, Math.min(text.length, Number.isFinite(value) ? Math.trunc(value) : 0));
  // Never split a Unicode code point into two independently formatted DOM text nodes.
  if (
    result > 0 &&
    result < text.length &&
    /[\uD800-\uDBFF]/.test(text[result - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[result]!)
  )
    result += end ? 1 : -1;
  return result;
}

function range(text: string, start: number, end: number) {
  return [
    offset(text, Math.min(start, end), false),
    offset(text, Math.max(start, end), true),
  ] as const;
}

function mapSelection(
  richText: PresentationRichText,
  start: number,
  end: number,
  update: (marks: Marks) => Marks,
) {
  const [from, to] = range(presentationRichTextToPlainText(richText), start, end);
  if (from === to) return richText;
  let index = 0;
  const updated = cells(richText).map((cell) => {
    const begin = index;
    index += cell.text.length;
    return cell.text !== "\n" && begin < to && index > from
      ? { ...cell, marks: update(cell.marks) }
      : cell;
  });
  return assemble(updated, richText.paragraphs[0]!.kind);
}

export function nativeRichTextSelectionHasMark(
  richText: PresentationRichText,
  start: number,
  end: number,
  mark: "bold" | "italic",
): boolean {
  const [from, to] = range(presentationRichTextToPlainText(richText), start, end);
  let index = 0;
  const selected = cells(richText).filter((cell) => {
    const begin = index;
    index += cell.text.length;
    return cell.text !== "\n" && begin < to && index > from;
  });
  return selected.length > 0 && selected.every((cell) => cell.marks[mark]);
}

export function toggleNativeRichTextMark(
  richText: PresentationRichText,
  start: number,
  end: number,
  mark: "bold" | "italic",
): PresentationRichText {
  const remove = nativeRichTextSelectionHasMark(richText, start, end, mark);
  return mapSelection(richText, start, end, (marks) => {
    const result = { ...marks };
    if (remove) delete result[mark];
    else result[mark] = true;
    return result;
  });
}

export function linkNativeRichText(
  richText: PresentationRichText,
  start: number,
  end: number,
  href: string | null,
): PresentationRichText {
  if (href !== null && !isSafePresentationLink(href))
    throw new Error("Enter a complete http:// or https:// link without a username or password.");
  return mapSelection(richText, start, end, (marks) => {
    const result = { ...marks };
    if (href === null) delete result.href;
    else result.href = href;
    return result;
  });
}

export function setNativeRichTextParagraphKind(
  richText: PresentationRichText,
  start: number,
  end: number,
  kind: Kind,
): PresentationRichText {
  const [from, to] = range(presentationRichTextToPlainText(richText), start, end);
  let index = 0;
  return PresentationRichTextSchema.parse({
    paragraphs: richText.paragraphs.map((paragraph) => {
      const begin = index;
      index += paragraph.runs.reduce((length, run) => length + run.text.length, 0);
      const finish = index;
      index += 1;
      const included = from === to ? from >= begin && from <= finish : begin < to && finish >= from;
      return included ? { ...paragraph, kind } : paragraph;
    }),
  });
}

/** A textarea replacement keeps unchanged spans; pasted HTML never enters this model. */
export function editNativeRichText(
  richText: PresentationRichText,
  value: string,
  change?: { start: number; end: number },
): PresentationRichText {
  const nextText = value.replace(/\r\n?/g, "\n");
  const previousText = presentationRichTextToPlainText(richText);
  if (nextText === previousText) return richText;
  let prefix: number;
  let oldEnd: number;
  let suffix: number;
  if (change) {
    [prefix, oldEnd] = range(previousText, change.start, change.end);
    suffix = previousText.length - oldEnd;
    if (
      nextText.length < prefix + suffix ||
      previousText.slice(0, prefix) !== nextText.slice(0, prefix) ||
      previousText.slice(oldEnd) !== nextText.slice(nextText.length - suffix)
    ) {
      throw new Error(
        "This text change could not be matched to its selection. Try the edit again.",
      );
    }
  } else {
    prefix = 0;
    while (
      prefix < previousText.length &&
      prefix < nextText.length &&
      previousText[prefix] === nextText[prefix]
    )
      prefix += 1;
    prefix = offset(previousText, prefix, false);
    suffix = 0;
    while (
      suffix < previousText.length - prefix &&
      suffix < nextText.length - prefix &&
      previousText[previousText.length - suffix - 1] === nextText[nextText.length - suffix - 1]
    )
      suffix += 1;
    oldEnd = offset(previousText, previousText.length - suffix, true);
    suffix = previousText.length - oldEnd;
  }
  const input = cells(richText);
  let index = 0;
  const before: Cell[] = [];
  const after: Cell[] = [];
  for (const cell of input) {
    const begin = index;
    index += cell.text.length;
    if (index <= prefix) before.push(cell);
    if (begin >= oldEnd) after.push(cell);
  }
  const left = before.at(-1);
  const right = input[before.length];
  const kind =
    left?.text === "\n"
      ? (left.nextKind ?? left.kind)
      : (left?.kind ?? right?.kind ?? richText.paragraphs[0]!.kind);
  const replacing = oldEnd > prefix;
  const marks: Marks = {
    ...(replacing && right && right.text !== "\n"
      ? right?.marks
      : left && left.text !== "\n"
        ? left?.marks
        : right?.marks),
  };
  // Continuing emphasis is useful. A link extends only when insertion is inside the same link.
  if (!replacing && (!left?.marks.href || left.marks.href !== right?.marks.href)) delete marks.href;
  const inserted = Array.from(nextText.slice(prefix, nextText.length - suffix), (text) => ({
    text,
    marks: { ...marks },
    kind,
    ...(text === "\n" ? { nextKind: kind } : {}),
  }));
  return assemble([...before, ...inserted, ...after], kind);
}
