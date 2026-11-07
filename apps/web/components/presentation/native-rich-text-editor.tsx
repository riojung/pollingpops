"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  PresentationSceneNodeSchema,
  presentationRichTextToPlainText,
  type PresentationRichText,
  type PresentationSceneNode,
} from "@openround/contracts";
import {
  editNativeRichText,
  linkNativeRichText,
  nativeRichTextSelectionHasMark,
  setNativeRichTextParagraphKind,
  toggleNativeRichTextMark,
} from "../../lib/presentation-rich-text";
import styles from "./native-scene.module.css";

type TextNode = Extract<PresentationSceneNode, { type: "text" }>;

export function NativeRichTextEditor({
  node,
  onChange,
  onUndo,
  onRedo,
}: {
  node: TextNode;
  onChange: (node: TextNode, field?: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const range = useRef({ start: 0, end: 0 });
  const beforeInput = useRef<{ text: string; start: number; end: number } | null>(null);
  const consumedHistoryInput = useRef<string | null>(null);
  const pendingRestore = useRef<number | null>(null);
  const restoreEpoch = useRef(0);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const richText = node.richText!;
  const label = node.role === "title" ? "Native slide title" : "Node text";
  const hasSelection = selection.end > selection.start;

  const cancelRestore = useCallback(() => {
    if (pendingRestore.current === null) return;
    restoreEpoch.current += 1;
    cancelAnimationFrame(pendingRestore.current);
    pendingRestore.current = null;
  }, []);

  useEffect(
    () => () => {
      restoreEpoch.current += 1;
      if (pendingRestore.current !== null) cancelAnimationFrame(pendingRestore.current);
      pendingRestore.current = null;
    },
    [],
  );

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const rememberInput = (event: Event) => {
      cancelRestore();
      const inputType = (event as InputEvent).inputType;
      if (inputType === "historyUndo" || inputType === "historyRedo") {
        event.preventDefault();
        beforeInput.current = null;
        // Some browsers deliver input after an uncancelable beforeinput. Consume it without
        // treating its plain value as a new rich-text edit or invoking document history twice.
        consumedHistoryInput.current = inputType;
        const action = inputType === "historyUndo" ? onUndo : onRedo;
        if (action) {
          setError("");
          action();
        } else {
          setError("Undo and Redo are unavailable in this view.");
        }
        return;
      }
      consumedHistoryInput.current = null;
      beforeInput.current = {
        text: node.text,
        start: element.selectionStart,
        end: element.selectionEnd,
      };
    };
    const rememberSelection = () => {
      // A blurred textarea can report its old DOM range after a toolbar input takes focus.
      // Keep the last deliberate text selection for that toolbar operation.
      if (document.activeElement !== element) return;
      const next = { start: element.selectionStart, end: element.selectionEnd };
      if (next.start !== range.current.start || next.end !== range.current.end) cancelRestore();
      range.current = next;
      setSelection((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    };
    element.addEventListener("beforeinput", rememberInput);
    element.addEventListener("select", rememberSelection);
    // A replacement textarea can receive restored focus/range before its passive effects mount.
    rememberSelection();
    return () => {
      element.removeEventListener("beforeinput", rememberInput);
      element.removeEventListener("select", rememberSelection);
    };
  }, [node.text, onUndo, onRedo, cancelRestore]);

  function history(redo: boolean) {
    beforeInput.current = null;
    const action = redo ? onRedo : onUndo;
    if (action) {
      setError("");
      action();
    } else {
      setError("Undo and Redo are unavailable in this view.");
    }
  }

  function remember(event: SyntheticEvent<HTMLTextAreaElement>) {
    cancelRestore();
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    range.current = { start, end };
    setSelection({ start, end });
  }
  function apply(update: () => PresentationRichText, field?: string, restore = true) {
    try {
      const richText = update();
      const next = PresentationSceneNodeSchema.parse({
        ...node,
        text: presentationRichTextToPlainText(richText),
        richText,
      }) as TextNode;
      setError("");
      if (JSON.stringify(next) !== JSON.stringify(node)) onChange(next, field);
      if (restore) {
        const { start, end } = range.current;
        cancelRestore();
        const epoch = restoreEpoch.current;
        // Formatting controls may take focus, but they operate on the remembered text range.
        pendingRestore.current = requestAnimationFrame(() => {
          if (epoch !== restoreEpoch.current) return;
          pendingRestore.current = null;
          const element = input.current;
          if (!element) return;
          element.focus({ preventScroll: true });
          element.setSelectionRange(start, end);
          const next = { start: element.selectionStart, end: element.selectionEnd };
          range.current = next;
          setSelection((current) =>
            current.start === next.start && current.end === next.end ? current : next,
          );
        });
      }
    } catch (caught) {
      setError(
        caught instanceof Error && !("issues" in caught)
          ? caught.message
          : "This text change exceeds the formatting limits or contains unsupported characters. Shorten it or remove some formatting and try again.",
      );
    }
  }
  function mark(kind: "bold" | "italic") {
    apply(() => toggleNativeRichTextMark(richText, range.current.start, range.current.end, kind));
  }
  return (
    <div
      className={styles.richEditor}
      onFocusCapture={cancelRestore}
      onBlurCapture={cancelRestore}
      onPointerDownCapture={cancelRestore}
      onKeyDownCapture={cancelRestore}
    >
      <label>
        {label}
        <textarea
          lang={node.lang}
          ref={input}
          data-native-text-input="true"
          aria-label={label}
          maxLength={node.role === "title" ? 160 : 4000}
          value={node.text}
          onSelect={remember}
          onKeyUp={remember}
          onPointerUp={remember}
          onKeyDown={(event) => {
            if (event.altKey || (!event.metaKey && !event.ctrlKey)) return;
            const key = event.key.toLowerCase();
            if (key === "z" || (event.ctrlKey && key === "y")) {
              event.preventDefault();
              event.stopPropagation();
              consumedHistoryInput.current = null;
              history(key === "y" || event.shiftKey);
            }
          }}
          onChange={(event) => {
            cancelRestore();
            const value = event.target.value;
            const native = event.nativeEvent as InputEvent;
            if (native.inputType === "historyUndo" || native.inputType === "historyRedo") {
              const consumed = consumedHistoryInput.current === native.inputType;
              consumedHistoryInput.current = null;
              beforeInput.current = null;
              if (!consumed) history(native.inputType === "historyRedo");
              return;
            }
            consumedHistoryInput.current = null;
            const caret = event.currentTarget.selectionStart;
            const previous = beforeInput.current;
            beforeInput.current = null;
            let change =
              previous?.text === node.text
                ? { start: previous.start, end: previous.end }
                : { ...range.current };
            const removedLength = node.text.length - value.length;
            if (native.inputType?.startsWith("insert") && typeof native.data === "string") {
              const insertedLength = native.data.replace(/\r\n?/g, "\n").length;
              change = { start: caret - insertedLength, end: caret + removedLength };
            } else if (
              removedLength > 0 &&
              (change.start === change.end || native.inputType?.startsWith("delete"))
            ) {
              change = { start: caret, end: caret + removedLength };
            }
            remember(event);
            apply(() => editNativeRichText(richText, value, change), "text", false);
          }}
          onPaste={(event) => {
            cancelRestore();
            // A textarea accepts text only. Explicitly ignore HTML clipboard payloads.
            event.preventDefault();
            if (!event.clipboardData.types.includes("text/plain")) return;
            const element = event.currentTarget;
            const pasted = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
            const start = element.selectionStart;
            const end = element.selectionEnd;
            const value = node.text.slice(0, start) + pasted + node.text.slice(end);
            range.current = { start: start + pasted.length, end: start + pasted.length };
            setSelection(range.current);
            beforeInput.current = null;
            apply(() => editNativeRichText(richText, value, { start, end }), "text");
          }}
        />
      </label>
      <div className={styles.formatToolbar} aria-label="Text formatting">
        <button
          type="button"
          disabled={!hasSelection}
          aria-pressed={nativeRichTextSelectionHasMark(
            richText,
            selection.start,
            selection.end,
            "bold",
          )}
          onClick={() => mark("bold")}
        >
          Bold
        </button>
        <button
          type="button"
          disabled={!hasSelection}
          aria-pressed={nativeRichTextSelectionHasMark(
            richText,
            selection.start,
            selection.end,
            "italic",
          )}
          onClick={() => mark("italic")}
        >
          Italic
        </button>
        <label>
          Paragraph style
          <select
            aria-label="Paragraph style"
            value=""
            onChange={(event) => {
              const kind = event.target.value as "paragraph" | "bullet" | "numbered";
              if (!kind) return;
              apply(() =>
                setNativeRichTextParagraphKind(
                  richText,
                  range.current.start,
                  range.current.end,
                  kind,
                ),
              );
            }}
          >
            <option value="">Choose for selected paragraphs</option>
            <option value="paragraph">Paragraph</option>
            {node.role !== "title" ? <option value="bullet">Bulleted list</option> : null}
            {node.role !== "title" ? <option value="numbered">Numbered list</option> : null}
          </select>
        </label>
      </div>
      <label>
        Link address
        <input
          aria-label="Link address"
          type="url"
          placeholder="https://example.com"
          maxLength={2048}
          value={link}
          onChange={(event) => setLink(event.target.value)}
        />
      </label>
      <div className={styles.formatToolbar}>
        <button
          type="button"
          disabled={!hasSelection || !link}
          onClick={() =>
            apply(() => linkNativeRichText(richText, range.current.start, range.current.end, link))
          }
        >
          Apply link
        </button>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={() =>
            apply(() => linkNativeRichText(richText, range.current.start, range.current.end, null))
          }
        >
          Remove link
        </button>
        <button
          type="button"
          onClick={() => {
            const { richText: _richText, ...plain } = node;
            void _richText;
            setError("");
            onChange(plain);
          }}
        >
          Remove formatting
        </button>
      </div>
      <p className={styles.help}>
        Select text before applying emphasis or a link. Paragraph style applies to the current or
        selected paragraphs. Pasting adds plain text; existing text keeps its formatting. Links open
        in a new tab when presenting or previewing.
      </p>
      {error ? (
        <p role="alert" className={styles.formatError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
