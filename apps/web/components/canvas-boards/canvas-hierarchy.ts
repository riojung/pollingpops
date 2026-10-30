import type { CanvasObject } from "@openround/contracts";
import { connectorPoint, type CanvasBounds } from "./canvas-geometry";

export function canvasAncestors(objects: readonly CanvasObject[], object: CanvasObject) {
  const found: CanvasObject[] = [],
    seen = new Set([object.id]);
  let parentId = object.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = objects.find((item) => item.id === parentId);
    if (!parent) break;
    found.push(parent);
    parentId = parent.parentId;
  }
  return found;
}
export function canvasDescendants(objects: readonly CanvasObject[], ids: readonly string[]) {
  const wanted = new Set(ids);
  for (let count = 0; count < objects.length; count++) {
    let changed = false;
    for (const object of objects)
      if (object.parentId && wanted.has(object.parentId) && !wanted.has(object.id)) {
        wanted.add(object.id);
        changed = true;
      }
    if (!changed) break;
  }
  return objects.filter((object) => wanted.has(object.id));
}
export function canvasSelectionRoots(objects: readonly CanvasObject[], ids: readonly string[]) {
  const selected = new Set(ids);
  return objects.filter(
    (object) =>
      selected.has(object.id) &&
      !canvasAncestors(objects, object).some((parent) => selected.has(parent.id)),
  );
}
export function canvasGroupId(object: CanvasObject) {
  return (object as CanvasObject & { geometricGroupId?: string | null }).geometricGroupId ?? null;
}
export function canvasSelectionPeers(objects: readonly CanvasObject[], ids: readonly string[]) {
  const wanted = new Set(ids);
  const groups = new Set(
    objects
      .filter((object) => wanted.has(object.id))
      .map(canvasGroupId)
      .filter(Boolean),
  );
  return objects
    .filter(
      (object) =>
        wanted.has(object.id) || (canvasGroupId(object) && groups.has(canvasGroupId(object))),
    )
    .map((object) => object.id);
}
/** Expand group peers and frame descendants until stable, with each object included once. */
export function canvasSelectionClosure(objects: readonly CanvasObject[], ids: readonly string[]) {
  const wanted = new Set(ids);
  for (let count = 0; count < objects.length; count++) {
    const groups = new Set(
      objects
        .filter((object) => wanted.has(object.id))
        .map(canvasGroupId)
        .filter(Boolean),
    );
    let changed = false;
    for (const object of objects)
      if (
        !wanted.has(object.id) &&
        ((object.parentId && wanted.has(object.parentId)) ||
          (canvasGroupId(object) && groups.has(canvasGroupId(object))))
      ) {
        wanted.add(object.id);
        changed = true;
      }
    if (!changed) break;
  }
  return objects.filter((object) => wanted.has(object.id));
}
export function canvasObjectBounds(
  object: CanvasObject,
  objects: readonly CanvasObject[],
): CanvasBounds {
  if (object.type === "connector") {
    const a = connectorPoint(object.from, objects),
      b = connectorPoint(object.to, objects);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.max(1, Math.abs(a.x - b.x)),
      height: Math.max(1, Math.abs(a.y - b.y)),
    };
  }
  const radians = (object.rotation * Math.PI) / 180;
  const width =
    Math.abs(object.width * Math.cos(radians)) + Math.abs(object.height * Math.sin(radians));
  const height =
    Math.abs(object.width * Math.sin(radians)) + Math.abs(object.height * Math.cos(radians));
  return {
    x: object.x + (object.width - width) / 2,
    y: object.y + (object.height - height) / 2,
    width,
    height,
  };
}
export function canvasSelectionBounds(
  objects: readonly CanvasObject[],
  ids: readonly string[],
): CanvasBounds | null {
  const selected = canvasSelectionClosure(objects, ids);
  if (!selected.length) return null;
  const bounds = selected.map((object) => canvasObjectBounds(object, objects));
  const x = Math.min(...bounds.map((item) => item.x)),
    y = Math.min(...bounds.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(1, Math.max(...bounds.map((item) => item.x + item.width)) - x),
    height: Math.max(1, Math.max(...bounds.map((item) => item.y + item.height)) - y),
  };
}
