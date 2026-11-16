import type { ReactNode } from "react";
import styles from "./workspace-signals.module.css";

export type WorkspaceStateTone = "warning" | "positive" | "active" | "danger" | "neutral";
type WorkspaceKind = "round" | "presentation" | "survey" | "practice";
type WorkspaceAction = "host" | "resume" | "edit" | "result" | "assign";
type SignalIcon =
  "pencil" | "clock" | "check" | "archive" | "alert" | "live" | "lock" | "pause" | "unknown";

const stateTones: Readonly<Record<string, WorkspaceStateTone>> = {
  draft: "warning",
  pending: "warning",
  processing: "warning",
  scheduled: "warning",
  changed: "warning",
  organizing: "warning",
  voting: "warning",
  frozen: "warning",
  published: "positive",
  ready: "positive",
  active: "active",
  live: "active",
  open: "active",
  collecting: "active",
  expired: "danger",
  failed: "danger",
  overdue: "danger",
  finished: "neutral",
  closed: "neutral",
  completed: "neutral",
  archived: "neutral",
};

const stateIcons: Readonly<Record<string, SignalIcon>> = {
  draft: "pencil",
  changed: "pencil",
  pending: "clock",
  processing: "clock",
  scheduled: "clock",
  organizing: "clock",
  voting: "clock",
  frozen: "lock",
  published: "check",
  ready: "check",
  active: "live",
  live: "live",
  open: "live",
  collecting: "live",
  expired: "alert",
  failed: "alert",
  overdue: "alert",
  finished: "check",
  closed: "pause",
  completed: "check",
  archived: "archive",
};

export function workspaceStateTone(status: string): WorkspaceStateTone {
  const normalized = status.trim().toLowerCase();
  return Object.hasOwn(stateTones, normalized) ? stateTones[normalized]! : "neutral";
}

function SignalGlyph({ icon }: { icon: SignalIcon }) {
  switch (icon) {
    case "pencil":
      return <path d="m15 4 5 5M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z" />;
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "check":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m8 12 3 3 5-6" />
        </>
      );
    case "archive":
      return <path d="M4 4h16v4H4zM6 8v12h12V8M10 12h4" />;
    case "alert":
      return (
        <>
          <path d="m12 3 10 17H2zM12 9v4" />
          <circle cx="12" cy="16.5" r=".7" fill="currentColor" stroke="none" />
        </>
      );
    case "live":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" />
        </>
      );
    case "lock":
      return <path d="M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3M12 14v3" />;
    case "pause":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M9 8v8M15 8v8" />
        </>
      );
    case "unknown":
      return <circle cx="12" cy="12" r="7" />;
  }
}

export function WorkspaceStatus({
  status,
  children,
  className,
}: {
  status: string;
  children: ReactNode;
  className?: string;
}) {
  const normalized = status.trim().toLowerCase();
  const icon = Object.hasOwn(stateIcons, normalized) ? stateIcons[normalized]! : "unknown";
  return (
    <span
      className={[styles.status, className].filter(Boolean).join(" ")}
      data-status={status}
      data-tone={status}
      data-state-tone={workspaceStateTone(status)}
    >
      <svg
        aria-hidden="true"
        className={styles.statusIcon}
        data-icon={icon}
        fill="none"
        focusable="false"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
      >
        <SignalGlyph icon={icon} />
      </svg>
      {children}
    </span>
  );
}

export function WorkspaceKindIcon({ kind }: { kind: WorkspaceKind }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.kindIcon}
      data-kind={kind}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {kind === "round" ? (
        <>
          <path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" />
        </>
      ) : kind === "presentation" ? (
        <path d="M3 4h18v13H3zM12 17v4M7 21h10M7 9h10M7 12h6" />
      ) : kind === "survey" ? (
        <path d="M5 3h14v18H5zM8 8l1 1 2-2M13 8h3M8 14l1 1 2-2M13 14h3" />
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" />
        </>
      )}
    </svg>
  );
}

export function WorkspaceActionIcon({ action }: { action: WorkspaceAction }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.actionIcon}
      data-action={action}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {action === "host" ? (
        <path d="m8 4 12 8-12 8z" />
      ) : action === "resume" ? (
        <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6M11 8l5 4-5 4z" />
      ) : action === "edit" ? (
        <SignalGlyph icon="pencil" />
      ) : action === "result" ? (
        <path d="M4 20h16M6 16v-4M12 16V4M18 16V8" />
      ) : (
        <path d="M14 4h6v6M20 4l-9 9M20 14v6H4V4h6" />
      )}
    </svg>
  );
}
