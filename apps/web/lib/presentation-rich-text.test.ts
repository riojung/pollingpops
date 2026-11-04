import { describe, expect, it } from "vitest";
import {
  PresentationRichTextSchema,
  plainTextToPresentationRichText,
  presentationRichTextToPlainText,
} from "@openround/contracts";
import {
  editNativeRichText,
  linkNativeRichText,
  nativeRichTextSelectionHasMark,
  setNativeRichTextParagraphKind,
  toggleNativeRichTextMark,
} from "./presentation-rich-text";

const plain = plainTextToPresentationRichText;

describe("native rich-text range operations", () => {
  it("formats only selected characters and toggles emphasis without destroying links or other marks", () => {
    const initial = plain("First decision");
    const bold = toggleNativeRichTextMark(initial, 6, 14, "bold");
    expect(bold.paragraphs[0]!.runs).toEqual([
      { text: "First " },
      { text: "decision", bold: true },
    ]);
    const linked = linkNativeRichText(bold, 6, 14, "https://example.com/decision");
    const emphasized = toggleNativeRichTextMark(linked, 6, 9, "italic");
    expect(emphasized.paragraphs[0]!.runs).toEqual([
      { text: "First " },
      { text: "dec", bold: true, italic: true, href: "https://example.com/decision" },
      { text: "ision", bold: true, href: "https://example.com/decision" },
    ]);
    expect(presentationRichTextToPlainText(emphasized)).toBe("First decision");
    expect(nativeRichTextSelectionHasMark(emphasized, 6, 14, "bold")).toBe(true);
    expect(nativeRichTextSelectionHasMark(emphasized, 0, 14, "bold")).toBe(false);
    const unbold = toggleNativeRichTextMark(emphasized, 6, 14, "bold");
    expect(unbold.paragraphs[0]!.runs[1]).toEqual({
      text: "dec",
      italic: true,
      href: "https://example.com/decision",
    });
    expect(initial).toEqual(plain("First decision"));
  });

  it("does not format a collapsed range and never splits a surrogate pair", () => {
    const initial = plain("A😀B");
    expect(toggleNativeRichTextMark(initial, 1, 1, "bold")).toBe(initial);
    expect(toggleNativeRichTextMark(initial, 2, 3, "bold").paragraphs[0]!.runs).toEqual([
      { text: "A" },
      { text: "😀", bold: true },
      { text: "B" },
    ]);
    expect(toggleNativeRichTextMark(initial, -10, 100, "bold").paragraphs[0]!.runs).toEqual([
      { text: "A😀B", bold: true },
    ]);
  });

  it("sets one or multiple paragraph styles without formatting the next paragraph at the range boundary", () => {
    const initial = plain("One\nTwo\nThree");
    const bullet = setNativeRichTextParagraphKind(initial, 0, 7, "bullet");
    expect(bullet.paragraphs.map((paragraph) => paragraph.kind)).toEqual([
      "bullet",
      "bullet",
      "paragraph",
    ]);
    const numbered = setNativeRichTextParagraphKind(bullet, 8, 8, "numbered");
    expect(numbered.paragraphs.map((paragraph) => paragraph.kind)).toEqual([
      "bullet",
      "bullet",
      "numbered",
    ]);
    expect(presentationRichTextToPlainText(numbered)).toBe("One\nTwo\nThree");
  });

  it("removes links from the selected range and rejects unsafe addresses before changing content", () => {
    const initial = linkNativeRichText(plain("Read more"), 0, 9, "https://example.com");
    expect(linkNativeRichText(initial, 0, 4, null).paragraphs[0]!.runs).toEqual([
      { text: "Read" },
      { text: " more", href: "https://example.com" },
    ]);
    for (const address of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://user:secret@example.com",
      "//example.com",
    ]) {
      expect(() => linkNativeRichText(initial, 0, 4, address)).toThrow(/complete http/);
    }
  });
});

describe("native rich-text plain edits", () => {
  it("uses the real edit range to distinguish identical characters with different marks", () => {
    const initial = toggleNativeRichTextMark(plain("aa"), 0, 1, "bold");
    const deleteFirst = editNativeRichText(initial, "a", { start: 0, end: 1 });
    const deleteLast = editNativeRichText(initial, "a", { start: 1, end: 2 });
    expect(deleteFirst.paragraphs[0]!.runs).toEqual([{ text: "a" }]);
    expect(deleteLast.paragraphs[0]!.runs).toEqual([{ text: "a", bold: true }]);
    expect(editNativeRichText(initial, "aaa", { start: 0, end: 0 }).paragraphs[0]!.runs).toEqual([
      { text: "aa", bold: true },
      { text: "a" },
    ]);
    expect(() => editNativeRichText(initial, "different", { start: 0, end: 1 })).toThrow(
      /matched to its selection/,
    );
  });

  it("keeps the surviving paragraph's style when repeated text is deleted before it", () => {
    const initial = setNativeRichTextParagraphKind(plain("a\na"), 0, 1, "bullet");
    const remaining = editNativeRichText(initial, "a", { start: 0, end: 2 });
    expect(remaining).toEqual({ paragraphs: [{ kind: "paragraph", runs: [{ text: "a" }] }] });
    expect(
      editNativeRichText(initial, "a\n", { start: 2, end: 3 }).paragraphs.map(
        (paragraph) => paragraph.kind,
      ),
    ).toEqual(["bullet", "paragraph"]);
  });

  it("preserves unaffected runs through insertions, deletions and replacements", () => {
    const initial = toggleNativeRichTextMark(plain("Start bold end"), 6, 10, "bold");
    const inserted = editNativeRichText(initial, "Start bold! end");
    expect(inserted.paragraphs[0]!.runs).toEqual([
      { text: "Start " },
      { text: "bold!", bold: true },
      { text: " end" },
    ]);
    const prefixed = editNativeRichText(inserted, "New Start bold! end");
    expect(prefixed.paragraphs[0]!.runs).toEqual([
      { text: "New Start " },
      { text: "bold!", bold: true },
      { text: " end" },
    ]);
    const replaced = editNativeRichText(prefixed, "New Start strong! end");
    expect(replaced.paragraphs[0]!.runs).toEqual([
      { text: "New Start " },
      { text: "strong!", bold: true },
      { text: " end" },
    ]);
    expect(editNativeRichText(replaced, "New Start strong! end")).toBe(replaced);
  });

  it("extends links only within the same linked run, not after a link or into pasted markup", () => {
    const initial = linkNativeRichText(plain("Read more"), 0, 4, "https://example.com");
    const within = editNativeRichText(initial, "ReXad more");
    expect(within.paragraphs[0]!.runs[0]).toEqual({ text: "ReXad", href: "https://example.com" });
    const after = editNativeRichText(initial, "Read! more");
    expect(after.paragraphs[0]!.runs).toEqual([
      { text: "Read", href: "https://example.com" },
      { text: "! more" },
    ]);
    const pasted = editNativeRichText(initial, "Read more<script>bad()</script>");
    expect(presentationRichTextToPlainText(pasted)).toBe("Read more<script>bad()</script>");
    expect(pasted.paragraphs[0]!.runs.at(-1)!.href).toBeUndefined();
  });

  it("preserves paragraph types when adding lines, deleting a boundary or clearing the node", () => {
    const initial = setNativeRichTextParagraphKind(plain("First\nSecond\nLast"), 0, 12, "bullet");
    const split = editNativeRichText(initial, "First\nNew\nSecond\nLast");
    expect(split.paragraphs.map((paragraph) => paragraph.kind)).toEqual([
      "bullet",
      "bullet",
      "bullet",
      "paragraph",
    ]);
    const merged = editNativeRichText(initial, "FirstSecond\nLast");
    expect(merged.paragraphs.map((paragraph) => paragraph.kind)).toEqual(["bullet", "paragraph"]);
    const empty = editNativeRichText(initial, "");
    expect(empty).toEqual({ paragraphs: [{ kind: "bullet", runs: [{ text: "" }] }] });
    expect(PresentationRichTextSchema.parse(empty)).toEqual(empty);
  });

  it("normalizes clipboard newlines, preserves blank lines and handles replacement Unicode code points", () => {
    expect(
      presentationRichTextToPlainText(editNativeRichText(plain("before"), "One\r\n\r\nTwo\r")),
    ).toBe("One\n\nTwo\n");
    const initial = toggleNativeRichTextMark(plain("😀"), 0, 2, "bold");
    expect(presentationRichTextToPlainText(editNativeRichText(initial, "😁"))).toBe("😁");
    expect(presentationRichTextToPlainText(editNativeRichText(initial, "X😀"))).toBe("X😀");
  });

  it("rejects oversized or unsupported input instead of truncating a pasted value", () => {
    expect(() => editNativeRichText(plain("Saved"), "X".repeat(4001))).toThrow();
    expect(() => editNativeRichText(plain("Saved"), "X\n".repeat(101))).toThrow();
    expect(() => editNativeRichText(plain("Saved"), "Bad\u0000value")).toThrow();
  });
});
