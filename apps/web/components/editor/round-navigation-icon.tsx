import type { QuestionType } from "@openround/contracts";

type NavigationIcon =
  | "back"
  | "outline"
  | "inspector"
  | "plus"
  | "search"
  | "close"
  | "up"
  | "down"
  | "duplicate"
  | "delete"
  | "more"
  | "image";
const paths: Record<NavigationIcon, string> = {
  back: "m14 5-7 7 7 7M7 12h13",
  outline: "M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01",
  inspector: "M4 4h16v16H4zM14 4v16M7 8h4M7 12h4",
  plus: "M12 5v14M5 12h14",
  search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  close: "m6 6 12 12M6 18 18 6",
  up: "m6 10 6-6 6 6M12 4v16",
  down: "m6 14 6 6 6-6M12 4v16",
  duplicate: "M8 8h12v12H8zM16 8V4H4v12h4",
  delete: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  image: "M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5M16 8h.01",
};

export function RoundNavigationIcon({ name }: { name: NavigationIcon }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const typeGlyphs: Record<QuestionType, string> = {
  single_select: "◉",
  true_false: "T/F",
  multi_select: "☑",
  numeric: "123",
  poll: "▥",
  rating: "☆",
  ranking: "↕",
  open_text: "Aa",
  word_cloud: "☁",
};

export function QuestionTypeGlyph({ type }: { type: QuestionType }) {
  return <span aria-hidden="true">{typeGlyphs[type]}</span>;
}
