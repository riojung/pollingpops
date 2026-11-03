import {
  CanvasObjectSchema,
  IdeaBoardCanvasSchema,
  IDEA_BOARD_MAX_CANVAS_OBJECTS,
  IDEA_BOARD_MAX_CANVAS_BYTES,
  IDEA_BOARD_MAX_CANVAS_POINTS,
  type CanvasObject,
  type CanvasObjectCreate,
  type CanvasObjectPatchSchema,
  type IdeaBoardCanvas,
  type IdeaBoardCanvasObject,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import {
  canvasObjectBounds,
  canvasSelectionClosure,
  canvasSelectionRoots,
  canvasAncestors,
} from "../canvas-boards/canvas-hierarchy";
import { canvasTransformPatches, type CanvasTransform } from "../canvas-boards/canvas-productivity";
import type { IdeaDraft } from "./idea-composer";

type Patch = ReturnType<typeof CanvasObjectPatchSchema.parse>;
export type IdeaCanvasError = "invalid" | "limit";
export type IdeaCanvasResult =
  { draft: IdeaDraft; error: null } | { draft: IdeaDraft | null; error: IdeaCanvasError };

export function ideaCanvasObject(input: CanvasObjectCreate | IdeaBoardCanvasObject): CanvasObject {
  if (input.type === "idea_ref") throw new Error("A private draft cannot create protected ideas");
  return CanvasObjectSchema.parse({ ...input, visibility: "team", version: 1 });
}

function translate(object: CanvasObject, dx: number, dy: number): CanvasObject {
  return CanvasObjectSchema.parse({
    ...object,
    x: object.x + dx,
    y: object.y + dy,
    ...(object.type === "pen" ? { points: object.points.map(([x, y]) => [x + dx, y + dy]) } : {}),
    ...(object.type === "connector"
      ? {
          from: { ...object.from, x: object.from.x + dx, y: object.from.y + dy },
          to: { ...object.to, x: object.to.x + dx, y: object.to.y + dy },
        }
      : {}),
  });
}

/** Restore only the participant's content. Published context is never part of this document. */
export function importIdeaCanvasDraft(value: IdeaDraft, allocateId = clientUuid): CanvasObject[] {
  if (value.canvasDraft)
    return value.canvasDraft.map((object) => {
      if (object.type === "idea_ref" || object.idea !== undefined)
        throw new Error("Protected context is not a private draft");
      return CanvasObjectSchema.parse({ ...object, visibility: "team" });
    });
  const objects: CanvasObject[] = value.canvas
    ? value.canvas.objects.map((object) =>
        translate(ideaCanvasObject(object), value.canvas!.x, value.canvas!.y),
      )
    : [];
  if (value.canvas === undefined) {
    if (value.body.trim())
      objects.push(
        ideaCanvasObject({
          id: allocateId(),
          type: "sticky",
          text: value.body,
          x: 40,
          y: 40,
          width: 260,
          height: 180,
          color: "yellow",
        } as CanvasObjectCreate),
      );
    for (const element of value.sketch?.elements ?? []) {
      const style = {
        id: element.id,
        color: element.color === "ink" ? ("black" as const) : element.color,
        strokeWidth: element.strokeWidth,
      };
      if (element.type === "rect" || element.type === "ellipse")
        objects.push(
          ideaCanvasObject({
            ...style,
            type: element.type,
            x: element.x + 40,
            y: element.y + 260,
            width: element.width,
            height: element.height,
            text: "",
          } as CanvasObjectCreate),
        );
      else if (element.type === "text")
        objects.push(
          ideaCanvasObject({
            ...style,
            type: "text",
            x: element.x + 40,
            y: element.y + 260 - element.fontSize,
            width: Math.max(80, Math.min(1000, element.text.length * element.fontSize * 0.6)),
            height: element.fontSize * 1.5,
            fontSize: element.fontSize,
            text: element.text,
          } as CanvasObjectCreate),
        );
      else if (element.type === "freehand") {
        const points = element.points.map(([x, y]) => [x + 40, y + 260] as [number, number]);
        const x = Math.min(...points.map(([x]) => x)),
          y = Math.min(...points.map(([, y]) => y));
        objects.push(
          ideaCanvasObject({
            ...style,
            type: "pen",
            x,
            y,
            width: Math.max(1, Math.max(...points.map(([x]) => x)) - x),
            height: Math.max(1, Math.max(...points.map(([, y]) => y)) - y),
            points,
          } as CanvasObjectCreate),
        );
      } else
        objects.push(
          ideaCanvasObject({
            ...style,
            type: "connector",
            x: Math.min(element.x1, element.x2) + 40,
            y: Math.min(element.y1, element.y2) + 260,
            width: Math.max(1, Math.abs(element.x2 - element.x1)),
            height: Math.max(1, Math.abs(element.y2 - element.y1)),
            from: { objectId: null, anchor: "center", x: element.x1 + 40, y: element.y1 + 260 },
            to: { objectId: null, anchor: "center", x: element.x2 + 40, y: element.y2 + 260 },
            endMarker: element.type === "arrow" ? "arrow" : "none",
            lineColor: style.color,
          } as CanvasObjectCreate),
        );
    }
  }
  const right = objects.length
    ? Math.max(...objects.map((object) => object.x + object.width)) + 40
    : 40;
  value.attachments.forEach((attachment, index) => {
    if (!objects.some((object) => object.type === "image" && object.mediaId === attachment.mediaId))
      objects.push(
        ideaCanvasObject({
          id: allocateId(),
          type: "image",
          mediaId: attachment.mediaId,
          altText: attachment.alt,
          x: right,
          y: 40 + index * 240,
          width: 300,
          height: 210,
        } as CanvasObjectCreate),
      );
  });
  value.links.forEach((link, index) => {
    if (!objects.some((object) => object.type === "link" && object.url === link.url))
      objects.push(
        ideaCanvasObject({
          id: allocateId(),
          type: "link",
          url: link.url,
          text: link.label ?? "",
          x: right + (value.attachments.length ? 340 : 0),
          y: 40 + index * 140,
          width: 280,
          height: 110,
        } as CanvasObjectCreate),
      );
  });
  return objects;
}

export function ideaCanvasTitle(objects: readonly CanvasObject[]) {
  return (
    objects
      .find(
        (object) =>
          ["sticky", "text", "rect", "ellipse", "diamond", "parallelogram"].includes(object.type) &&
          object.text.trim(),
      )
      ?.text.trim()
      .slice(0, 1000) ?? ""
  );
}

/** Native world geometry is normalized once, preserving absolute submission placement. */
export function serializeIdeaCanvas(objects: readonly CanvasObject[]): IdeaBoardCanvas | null {
  if (!objects.length) return null;
  if (objects.some((object) => object.type === "idea_ref"))
    throw new Error("Protected context cannot be submitted");
  const bounds = objects.map((object) => canvasObjectBounds(object, objects));
  const x = Math.floor(
    Math.min(...bounds.map((bound) => bound.x), ...objects.map((object) => object.x)),
  );
  const y = Math.floor(
    Math.min(...bounds.map((bound) => bound.y), ...objects.map((object) => object.y)),
  );
  const width = Math.max(
    1,
    Math.ceil(
      Math.max(
        ...bounds.map((bound) => bound.x + bound.width),
        ...objects.map((object) => object.x + object.width),
      ),
    ) - x,
  );
  const height = Math.max(
    1,
    Math.ceil(
      Math.max(
        ...bounds.map((bound) => bound.y + bound.height),
        ...objects.map((object) => object.y + object.height),
      ),
    ) - y,
  );
  return IdeaBoardCanvasSchema.parse({
    schemaVersion: 1,
    x,
    y,
    width,
    height,
    objects: objects.map((object) => {
      const shifted = translate(object, -x, -y);
      const { version, visibility, idea, ...content } = shifted;
      void version;
      void visibility;
      void idea;
      return content;
    }),
  });
}

function contentDraft(
  value: IdeaDraft,
  objects: readonly CanvasObject[],
  canvas: IdeaBoardCanvas | null,
): IdeaDraft | null {
  const attachments = objects
    .flatMap((object) =>
      object.type === "image" ? [{ mediaId: object.mediaId, alt: object.altText }] : [],
    )
    .filter(
      (attachment, index, all) =>
        all.findIndex((item) => item.mediaId === attachment.mediaId) === index,
    );
  const links = objects
    .flatMap((object) => {
      if (object.type !== "link") return [];
      const previous = value.links.find((link) => link.url === object.url);
      return [
        {
          url: object.url,
          ...(object.text.trim() ? { label: object.text.trim().slice(0, 160) } : {}),
          ...(previous?.imageMediaId &&
          attachments.some((attachment) => attachment.mediaId === previous.imageMediaId)
            ? { imageMediaId: previous.imageMediaId }
            : {}),
        },
      ];
    })
    .filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index);
  if (attachments.length > 3 || links.length > 3) return null;
  const { canvasDraft, ...previous } = value;
  void canvasDraft;
  return {
    ...previous,
    body: value.body.trim() ? value.body : ideaCanvasTitle(objects),
    attachments,
    links,
    sketch: null,
    canvas,
  };
}

function onlyAggregateLimit(error: unknown) {
  if (
    !error ||
    typeof error !== "object" ||
    !("issues" in error) ||
    !Array.isArray(error.issues) ||
    !error.issues.length
  )
    return false;
  return error.issues.every(
    (entry: { code?: string; maximum?: number; path?: unknown[]; message?: string }) =>
      (entry.code === "too_big" &&
        entry.maximum === IDEA_BOARD_MAX_CANVAS_OBJECTS &&
        entry.path?.length === 1 &&
        entry.path[0] === "objects") ||
      entry.message === "Use up to 1,024 canvas drawing points" ||
      entry.message === "This canvas submission is too large",
  );
}

export function ideaCanvasDraft(
  value: IdeaDraft,
  objects: readonly CanvasObject[],
  retainedObjectLimit = 32,
): IdeaCanvasResult {
  try {
    const draft = contentDraft(value, objects, serializeIdeaCanvas(objects));
    return draft ? { draft, error: null } : { draft: null, error: "limit" };
  } catch (caught) {
    const points = objects.reduce(
      (count, object) => count + (object.type === "pen" ? object.points.length : 0),
      0,
    );
    const bytes = new TextEncoder().encode(JSON.stringify(objects)).byteLength;
    const error =
      objects.length > IDEA_BOARD_MAX_CANVAS_OBJECTS ||
      points > IDEA_BOARD_MAX_CANVAS_POINTS ||
      bytes > IDEA_BOARD_MAX_CANVAS_BYTES
        ? "limit"
        : "invalid";
    const legacyCount =
      value.canvas === undefined
        ? Number(Boolean(value.body.trim())) +
          (value.sketch?.elements.length ?? 0) +
          value.attachments.length +
          value.links.length
        : 0;
    const bound = Math.max(32, retainedObjectLimit, value.canvasDraft?.length ?? 0, legacyCount);
    const canRetain = Boolean(value.canvasDraft) || legacyCount > 32 || retainedObjectLimit > 32;
    // Aggregate-only legacy overflow remains a bounded memory draft. Malformed geometry,
    // external references and protected objects never enter this recovery representation.
    if (
      canRetain &&
      objects.length <= bound &&
      onlyAggregateLimit(caught) &&
      objects.every(
        (object) =>
          object.type !== "idea_ref" &&
          object.idea === undefined &&
          CanvasObjectSchema.safeParse(object).success,
      )
    ) {
      const draft = contentDraft(value, objects, value.canvas ?? null);
      if (draft)
        return { draft: { ...draft, canvasDraft: structuredClone([...objects]) }, error: "limit" };
    }
    return { draft: null, error };
  }
}

function owned(objects: readonly CanvasObject[], ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.some((id) => !objects.some((object) => object.id === id)))
    return null;
  return canvasSelectionClosure(objects, unique);
}

export function patchIdeaCanvas(
  objects: CanvasObject[],
  ids: readonly string[],
  patch: Patch,
  allowLocked = false,
): CanvasObject[] | null {
  const selected = owned(objects, ids);
  if (
    !selected ||
    (!allowLocked &&
      selected.some(
        (object) =>
          object.locked || canvasAncestors(objects, object).some((parent) => parent.locked),
      ))
  )
    return null;
  const wanted = new Set(ids);
  try {
    return objects.map((object) => {
      if (!wanted.has(object.id)) return object;
      const next = { ...patch };
      if (object.type === "connector" && next.color) {
        next.lineColor = next.color;
        delete next.color;
      }
      const content: Record<string, unknown> = { ...object, ...next, version: object.version + 1 };
      if (content.type !== "rect") delete content.shapeVariant;
      return CanvasObjectSchema.parse(content);
    });
  } catch {
    return null;
  }
}

export function transformIdeaCanvas(
  objects: CanvasObject[],
  ids: readonly string[],
  transform: CanvasTransform,
): CanvasObject[] | null {
  const selected = owned(objects, ids);
  if (
    !selected ||
    selected.some(
      (object) => object.locked || canvasAncestors(objects, object).some((parent) => parent.locked),
    )
  )
    return null;
  try {
    const patches = canvasTransformPatches(
      objects,
      selected.map((object) => object.id),
      transform,
    );
    return objects.map((object) =>
      patches.has(object.id)
        ? CanvasObjectSchema.parse({
            ...object,
            ...patches.get(object.id),
            version: object.version + 1,
          })
        : object,
    );
  } catch {
    return null;
  }
}

export function deleteIdeaCanvas(
  objects: CanvasObject[],
  ids: readonly string[],
): CanvasObject[] | null {
  const selected = owned(objects, ids);
  if (
    !selected ||
    selected.some(
      (object) => object.locked || canvasAncestors(objects, object).some((parent) => parent.locked),
    )
  )
    return null;
  const removed = new Set(selected.map((object) => object.id));
  return objects.filter(
    (object) =>
      !removed.has(object.id) &&
      (object.type !== "connector" ||
        ((!object.from.objectId || !removed.has(object.from.objectId)) &&
          (!object.to.objectId || !removed.has(object.to.objectId)))),
  );
}

export function duplicateIdeaCanvas(
  objects: CanvasObject[],
  ids: readonly string[],
  allocateId = clientUuid,
): CanvasObject[] | null {
  const selected = owned(objects, ids);
  if (
    !selected ||
    selected.some(
      (object) => object.locked || canvasAncestors(objects, object).some((parent) => parent.locked),
    )
  )
    return null;
  try {
    const mapping = new Map(selected.map((object) => [object.id, allocateId()]));
    const groups = new Map(
      selected
        .filter((object) => object.geometricGroupId)
        .map((object) => [object.geometricGroupId!, allocateId()]),
    );
    return [
      ...objects,
      ...selected.map((object) => {
        const shifted = translate(object, 28, 28);
        return CanvasObjectSchema.parse({
          ...shifted,
          id: mapping.get(object.id),
          version: 1,
          parentId: mapping.get(object.parentId ?? "") ?? object.parentId,
          geometricGroupId: groups.get(object.geometricGroupId ?? "") ?? null,
          ...(object.type === "connector"
            ? {
                from: {
                  ...(shifted.type === "connector" ? shifted.from : object.from),
                  objectId: mapping.get(object.from.objectId ?? "") ?? object.from.objectId,
                },
                to: {
                  ...(shifted.type === "connector" ? shifted.to : object.to),
                  objectId: mapping.get(object.to.objectId ?? "") ?? object.to.objectId,
                },
              }
            : {}),
        });
      }),
    ];
  } catch {
    return null;
  }
}

export type IdeaCanvasAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export function arrangeIdeaCanvas(
  objects: CanvasObject[],
  ids: readonly string[],
  alignment: IdeaCanvasAlignment,
): CanvasObject[] | null {
  const selected = owned(objects, ids);
  if (
    !selected ||
    selected.some(
      (object) => object.locked || canvasAncestors(objects, object).some((parent) => parent.locked),
    )
  )
    return null;
  const roots = canvasSelectionRoots(
    objects,
    selected.map((object) => object.id),
  );
  const units = new Map<string, CanvasObject[]>();
  for (const object of roots) {
    const key = object.geometricGroupId ?? object.id;
    units.set(key, [...(units.get(key) ?? []), object]);
  }
  const rows = [...units.values()];
  if (rows.length < 2) return null;
  const bounds = rows.map((unit) => {
    const boxes = unit.map((object) => canvasObjectBounds(object, objects));
    const x = Math.min(...boxes.map((box) => box.x)),
      y = Math.min(...boxes.map((box) => box.y));
    return {
      x,
      y,
      width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
      height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
    };
  });
  const left = Math.min(...bounds.map((bound) => bound.x)),
    right = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const top = Math.min(...bounds.map((bound) => bound.y)),
    bottom = Math.max(...bounds.map((bound) => bound.y + bound.height));
  let next = objects;
  for (const [index, unit] of rows.entries()) {
    const bound = bounds[index]!;
    const dx =
      alignment === "left"
        ? left - bound.x
        : alignment === "center"
          ? (left + right - bound.width) / 2 - bound.x
          : alignment === "right"
            ? right - bound.x - bound.width
            : 0;
    const dy =
      alignment === "top"
        ? top - bound.y
        : alignment === "middle"
          ? (top + bottom - bound.height) / 2 - bound.y
          : alignment === "bottom"
            ? bottom - bound.y - bound.height
            : 0;
    const transformed = transformIdeaCanvas(
      next,
      unit.map((object) => object.id),
      { type: "move", dx, dy },
    );
    if (!transformed) return null;
    next = transformed;
  }
  return next;
}

export function groupIdeaCanvas(
  objects: CanvasObject[],
  ids: readonly string[],
  ungroup = false,
): CanvasObject[] | null {
  const selected = owned(objects, ids);
  if (
    !selected ||
    selected.some(
      (object) => object.locked || canvasAncestors(objects, object).some((parent) => parent.locked),
    )
  )
    return null;
  const roots = canvasSelectionRoots(
    objects,
    selected.map((object) => object.id),
  );
  if (!ungroup && (roots.length < 2 || new Set(roots.map((object) => object.parentId)).size > 1))
    return null;
  const wanted = new Set(roots.map((object) => object.id));
  const group = ungroup ? null : clientUuid();
  return objects.map((object) =>
    wanted.has(object.id)
      ? { ...object, geometricGroupId: group, version: object.version + 1 }
      : object,
  );
}
