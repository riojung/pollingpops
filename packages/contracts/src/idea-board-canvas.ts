import { z } from "zod";
import { CanvasObjectCreateV4Schema } from "./canvas-content-v4";

export const IDEA_BOARD_MAX_CANVAS_OBJECTS = 32;
export const IDEA_BOARD_MAX_CANVAS_BYTES = 32 * 1024;
export const IDEA_BOARD_MAX_CANVAS_POINTS = 1_024;
export const IDEA_BOARD_MAX_RENDERED_OBJECTS = 200;

// Submission content is independent of scene publication and never grants shared-canvas authority.
export const IdeaBoardCanvasObjectSchema = z.discriminatedUnion("type", [
  CanvasObjectCreateV4Schema.options[0].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[1].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[2].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[3].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[4].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[5].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[6].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[7].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[9].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[10].omit({ visibility: true }),
  CanvasObjectCreateV4Schema.options[11].omit({ visibility: true }),
]);
export type IdeaBoardCanvasObject = z.infer<typeof IdeaBoardCanvasObjectSchema>;

// A named public boundary keeps scene-bearing workshop/canvas declaration graphs bounded.
export interface IdeaBoardCanvas {
  schemaVersion: 1;
  x: number;
  y: number;
  width: number;
  height: number;
  objects: IdeaBoardCanvasObject[];
}

const world = z.number().finite().min(-100_000).max(100_000);
const dimension = z.number().finite().min(1).max(10_000);
export const IdeaBoardCanvasSchema: z.ZodType<IdeaBoardCanvas> = z
  .object({
    schemaVersion: z.literal(1),
    x: world,
    y: world,
    width: dimension,
    height: dimension,
    objects: z.array(IdeaBoardCanvasObjectSchema).min(1).max(IDEA_BOARD_MAX_CANVAS_OBJECTS),
  })
  .strict()
  .superRefine((scene, context) => {
    const issue = (message: string, index?: number) =>
      context.addIssue({
        code: "custom",
        message,
        path: index === undefined ? [] : ["objects", index],
      });
    const ids = new Map(scene.objects.map((object) => [object.id, object]));
    if (ids.size !== scene.objects.length) issue("Use unique canvas object identifiers");
    const inside = (x: number, y: number, tolerance = 0) =>
      x >= -tolerance &&
      y >= -tolerance &&
      x <= scene.width + tolerance &&
      y <= scene.height + tolerance;
    let points = 0;
    const groups = new Map<string, string | null>();
    for (const [index, object] of scene.objects.entries()) {
      const angle = (object.rotation * Math.PI) / 180;
      const cx = object.x + object.width / 2;
      const cy = object.y + object.height / 2;
      if (
        object.x < 0 ||
        object.y < 0 ||
        [
          [0, 0],
          [object.width, 0],
          [0, object.height],
          [object.width, object.height],
        ].some(([x, y]) => {
          const dx = x! - object.width / 2;
          const dy = y! - object.height / 2;
          return !inside(
            cx + dx * Math.cos(angle) - dy * Math.sin(angle),
            cy + dx * Math.sin(angle) + dy * Math.cos(angle),
            1e-7,
          );
        })
      )
        issue("Keep canvas objects inside their submission", index);
      if (object.parentId) {
        const parent = ids.get(object.parentId);
        if (parent?.type !== "frame" || parent.id === object.id)
          issue("Choose a frame in this submission as the parent", index);
      }
      const seen = new Set([object.id]);
      let parentId = object.parentId;
      while (parentId) {
        if (seen.has(parentId)) {
          issue("Frame relationships cannot contain cycles", index);
          break;
        }
        seen.add(parentId);
        parentId = ids.get(parentId)?.parentId ?? null;
      }
      if (object.geometricGroupId) {
        if (
          groups.has(object.geometricGroupId) &&
          groups.get(object.geometricGroupId) !== object.parentId
        )
          issue("Group objects within the same frame", index);
        groups.set(object.geometricGroupId, object.parentId);
      }
      if (object.type === "connector")
        for (const endpoint of [object.from, object.to]) {
          if (!inside(endpoint.x, endpoint.y))
            issue("Keep connector endpoints inside their submission", index);
          if (endpoint.objectId && (!ids.has(endpoint.objectId) || endpoint.objectId === object.id))
            issue("Choose a connector endpoint in this submission", index);
        }
      if (object.type === "pen") {
        points += object.points.length;
        if (object.points.some(([x, y]) => !inside(x, y)))
          issue("Keep drawing points inside their submission", index);
      }
    }
    if (points > IDEA_BOARD_MAX_CANVAS_POINTS) issue("Use up to 1,024 canvas drawing points");
    if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > IDEA_BOARD_MAX_CANVAS_BYTES)
      issue("This canvas submission is too large");
  });
