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
  | "timer"
  | "export"
  | "workshop"
  | "fit"
  | "fit-selection"
  | "minus"
  | "plus"
  | "shapes"
  | "sliders"
  | "templates"
  | "upload-svg"
  | "highlighter"
  | "eraser"
  | "close"
  | "bold"
  | "italic"
  | "underline"
  | "align-left"
  | "align-center"
  | "align-right"
  | "palette"
  | "lock"
  | "unlock"
  | "copy"
  | "trash"
  | "more"
  | "back"
  | "image"
  | "link"
  | "share"
  | "present"
  | "info";

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
  timer: "M9 2h6m-3 0v3m6 1 2-2M12 9v5l3 2M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  export: "M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7",
  workshop: "M4 4h16v12H4V4Zm8 12v5m-5 0 5-3 5 3M8 8h8m-8 4h5",
  fit: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M9 9h6v6H9V9Z",
  "fit-selection": "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M8 12h8m-4-4v8",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  shapes: "M3 3h8v8H3Zm13 0 5 8H11Zm5 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 15h7v7H3Z",
  sliders: "M4 6h5m4 0h7M4 12h9m4 0h3M4 18h3m4 0h9M9 3v6m4 0V3m0 6v6m4-6v6M7 15v6m4-6v6",
  templates: "M3 4h18v16H3Zm0 5h18M10 9v11M6 6h.1M9 6h.1",
  "upload-svg": "M4 6v14h16V6M12 14V2m-4 4 4-4 4 4M7 17l3-3 3 2 3-3 2 4",
  highlighter: "m7 13 8-9 5 5-9 8-4-4Zm1 1-3 3 3 3 3-3M3 22h13",
  eraser:
    "m3 14 10-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3L11 22H7l-4-4a3 3 0 0 1 0-4Zm5-5 9 9M11 22h10",
  close: "m6 6 12 12M18 6 6 18",
  bold: "M7 3h6a4.5 4.5 0 0 1 0 9H7V3Zm0 9h7a4.5 4.5 0 0 1 0 9H7v-9Z",
  italic: "M10 3h9M5 21h9M15 3 9 21",
  underline: "M6 3v9a6 6 0 0 0 12 0V3M4 22h16",
  "align-left": "M4 5h16M4 10h10M4 15h16M4 20h10",
  "align-center": "M4 5h16M7 10h10M4 15h16M7 20h10",
  "align-right": "M4 5h16M10 10h10M4 15h16M10 20h10",
  palette:
    "M12 3C6 3 2 7 2 12s4 9 9 9h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h3c6 0 4-11-6-11ZM7 8h.1M12 6h.1M17 9h.1M6 13h.1",
  lock: "M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4m-3 5v2",
  unlock: "M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0m-3 9v2",
  copy: "M8 8h13v13H8V8ZM4 16H3V3h13v1",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  more: "M5 12h.1M12 12h.1M19 12h.1",
  back: "m10 5-7 7 7 7M3 12h18",
  image: "M3 4h18v16H3V4Zm0 12 5-5 5 5 4-4 4 4M17 8h.1",
  link: "m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1",
  share: "M3 21v-2a6 6 0 0 1 12 0v2M12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M19 5v8m-4-4h8",
  present: "M3 4h18v13H3V4Zm9 13v4m-5 0 5-4 5 4M9 8l6 3-6 3V8Z",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10h.1",
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
