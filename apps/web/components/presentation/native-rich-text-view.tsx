"use client";

import { useNativeTextOverflow } from "./use-native-text-overflow";
import { Fragment, type ReactNode } from "react";
import {
  isSafePresentationLink,
  type PresentationRichText,
  type PresentationRichTextRun,
} from "@openround/contracts";
import styles from "./native-scene.module.css";

function runs(items: PresentationRichTextRun[], editing: boolean): ReactNode {
  return items.map((run, index) => {
    let content: ReactNode = run.text;
    if (run.bold) content = <strong>{content}</strong>;
    if (run.italic) content = <em>{content}</em>;
    if (run.href && isSafePresentationLink(run.href)) {
      content = (
        <a
          href={run.href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          onClick={editing ? (event) => event.preventDefault() : undefined}
          onAuxClick={editing ? (event) => event.preventDefault() : undefined}
        >
          {content}
        </a>
      );
    }
    return <Fragment key={index}>{content}</Fragment>;
  });
}

export function NativeRichTextView({
  richText,
  title = false,
  editing = false,
  layoutKey = "",
}: {
  richText: PresentationRichText;
  title?: boolean;
  editing?: boolean;
  layoutKey?: string;
}) {
  const scroll = useNativeTextOverflow(JSON.stringify([richText, title, layoutKey]));
  if (title) {
    return (
      <h1 className={styles.richTitle} {...scroll}>
        {richText.paragraphs.map((paragraph, index) => (
          <Fragment key={index}>
            {index ? <br /> : null}
            {runs(paragraph.runs, editing)}
          </Fragment>
        ))}
      </h1>
    );
  }
  const content: ReactNode[] = [];
  for (let index = 0; index < richText.paragraphs.length;) {
    const paragraph = richText.paragraphs[index]!;
    if (paragraph.kind === "paragraph") {
      content.push(
        <p key={index}>
          {runs(paragraph.runs, editing)}
          {paragraph.runs.every((run) => !run.text) ? <br /> : null}
        </p>,
      );
      index += 1;
      continue;
    }
    const start = index;
    const items: ReactNode[] = [];
    while (
      index < richText.paragraphs.length &&
      richText.paragraphs[index]!.kind === paragraph.kind
    ) {
      items.push(<li key={index}>{runs(richText.paragraphs[index]!.runs, editing)}</li>);
      index += 1;
    }
    content.push(
      paragraph.kind === "bullet" ? <ul key={start}>{items}</ul> : <ol key={start}>{items}</ol>,
    );
  }
  return (
    <div className={styles.richBody} {...scroll}>
      {content}
    </div>
  );
}
