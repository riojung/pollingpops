export type CanvasToolIconName =
  | "select"
  | "hand"
  | "sticky"
  | "text"
  | "rect"
  | "ellipse"
  | "frame"
  | "diamond"
  | "parallelogram"
  | "connector"
  | "marquee"
  | "pen"
  | "undo"
  | "redo"
  | "objects"
  | "facilitation"
  | "export"
  | "workshop"
  | "fit"
  | "fit-selection"
  | "minus"
  | "plus";

const paths: Record<CanvasToolIconName, string> = {
  select: "m5 3 14 9-7 1.5L9 20 5 3Z",
  hand: "M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-2a1.5 1.5 0 0 1 3 0v5c0 4-2.5 7-6 7h-1c-2 0-3.5-1-4.5-2.5L4 13a1.5 1.5 0 0 1 2.3-1.9L8 13",
  sticky: "M5 4h14v11l-5 5H5V4Zm9 16v-5h5M8 8h8M8 11h5",
  text: "M5 6V4h14v2M12 4v16M8 20h8",
  rect: "M5 5h14v14H5V5Z",
  ellipse: "M21 12a9 7 0 1 1-18 0 9 7 0 0 1 18 0Z",
  frame: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M8 8h8v8H8V8Z",
  diamond: "m12 3 9 9-9 9-9-9 9-9Z",
  parallelogram: "M8 5h13l-5 14H3L8 5Z",
  connector: "M4 18V7h15m-5-5 5 5-5 5M2 18h4v4H2v-4Z",
  marquee: "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M4 11v2m16-2v2M11 4h2m-2 16h2",
  pen: "m5 16 11-11 3 3L8 19l-4 1 1-4Zm9-9 3 3M5 16l3 3",
  undo: "m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12",
  redo: "m16 5 5 5-5 5M21 10H11a6 6 0 0 0 0 12",
  objects: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  facilitation: "M4 4h16v12H9l-5 4V4Zm4 4h8m-8 4h5",
  export: "M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7",
  workshop: "M4 4h16v12H4V4Zm8 12v5m-5 0 5-3 5 3M8 8h8m-8 4h5",
  fit: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M9 9h6v6H9V9Z",
  "fit-selection": "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M8 12h8m-4-4v8",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
};

/** Decorative, locally authored line icons; the parent button supplies its localized name. */
export function CanvasToolIcon({ name }: { name: CanvasToolIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
