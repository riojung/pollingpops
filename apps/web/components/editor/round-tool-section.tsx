import type { ReactNode } from "react";
import styles from "./round-tools.module.css";

/** Native disclosure state is local UI state and never changes question history. */
export function RoundToolSection({
  title,
  children,
  defaultOpen = false,
  description,
  id,
  className,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  description?: string;
  id?: string;
  className?: string;
}) {
  return (
    <details
      className={`${styles.section}${className ? ` ${className}` : ""}`}
      id={id}
      open={defaultOpen || undefined}
    >
      <summary className={styles.sectionHeading}>
        <span>{title}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
          <path
            d="m4 6 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </summary>
      <div className={styles.sectionBody}>
        {description ? <p className={styles.help}>{description}</p> : null}
        {children}
      </div>
    </details>
  );
}
