"use client";

import { useState, type ReactNode } from "react";
import { EditorIcon, type EditorIconName } from "./presentation-editor-chrome";
import styles from "./native-inspector-section.module.css";

/** Local disclosure state never becomes part of the authored slide or its history. */
export function NativeInspectorSection({
  title,
  icon,
  name,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: EditorIconName;
  name: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={styles.section}
      data-native-inspector-group={name}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.heading}>
        <EditorIcon name={icon} />
        <span>{title}</span>
        <span className={styles.chevron}>
          <EditorIcon name="chevron-down" />
        </span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
