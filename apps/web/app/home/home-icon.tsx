import type { ReactNode } from "react";

export type HomeIconName =
  | "work"
  | "liveSession"
  | "assignmentClosing"
  | "readyResult"
  | "draft"
  | "round"
  | "presentation"
  | "survey"
  | "idea_board"
  | "canvas"
  | "arrow";

const paths: Record<HomeIconName, ReactNode> = {
  work: (
    <>
      <rect x="3" y="5" width="5" height="14" rx="1.5" />
      <rect x="10" y="5" width="5" height="14" rx="1.5" />
      <path d="m18 5 3 14" />
    </>
  ),
  liveSession: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M9 9a4.2 4.2 0 0 0 0 6M15 9a4.2 4.2 0 0 1 0 6" />
    </>
  ),
  assignmentClosing: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V3h6v2M8.5 10h7m-7 4H12m2 3 1.5 1.5 3-3" />
    </>
  ),
  readyResult: (
    <>
      <path d="M4 20V10m6 10V4m6 16v-7m6 7H2" />
    </>
  ),
  draft: (
    <>
      <path d="M13 4H5v16h14v-8m-11 4 1-4 8-8 3 3-8 8-4 1Z" />
    </>
  ),
  round: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1" />
    </>
  ),
  presentation: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M12 17v4m-4 0h8M7 9h10M7 12h6" />
    </>
  ),
  survey: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="m8 8 1 1 2-2m2 1h3m-8 5 1 1 2-2m2 1h3m-8 5h8" />
    </>
  ),
  idea_board: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11m6-11v11" />
    </>
  ),
  canvas: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m6 16 4-4 3 3 5-6" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
};

export function HomeIcon({ name }: { name: HomeIconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
