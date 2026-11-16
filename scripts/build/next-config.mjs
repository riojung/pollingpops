import process from "node:process";

/** Dedicated compiler outputs prevent browser fixtures from deleting a product build. */
export function nextOutputDirectory(app, env = process.env) {
  if (!["web", "control"].includes(app)) throw new Error("Unknown Next application");
  const explicit = env.OPENROUND_NEXT_DIST_DIR;
  if (explicit !== undefined && !/^\.next(?:-[a-z0-9][a-z0-9-]{0,63})?$/.test(explicit))
    throw new Error("OPENROUND_NEXT_DIST_DIR must be .next or a bounded .next-<name> directory");
  const canvas = app === "web" ? env.CANVAS_COLLAB_DIST_DIR : undefined;
  if (canvas !== undefined && !/^\.next-canvas-capacity(?:-[a-z0-9-]{1,48})?$/.test(canvas))
    throw new Error("CANVAS_COLLAB_DIST_DIR must name a dedicated .next-canvas-capacity directory");
  const legacy =
    app === "web" && env.PLAYWRIGHT_BUSINESS === "true"
      ? ".next-business"
      : app === "control" && env.PLAYWRIGHT_CONTROL === "true"
        ? ".next-control-test"
        : undefined;
  const selected = [explicit, canvas, legacy].filter((value) => value !== undefined);
  if (new Set(selected).size > 1) throw new Error("Conflicting Next output directory selectors");
  return selected[0] ?? ".next";
}
