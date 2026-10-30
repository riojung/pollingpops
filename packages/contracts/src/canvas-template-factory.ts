import { CanvasObjectCreateSchema, type CanvasObjectCreate } from "./canvas-boards";
import { getCanvasTemplate, type CanvasTemplateId } from "./canvas-template-catalog";

/** IDs belong to the caller; no clocks, random sources, network calls, or guest content. */
export function instantiateCanvasTemplate(
  templateId: CanvasTemplateId,
  allocateId: () => string,
): CanvasObjectCreate[] {
  const template = getCanvasTemplate(templateId);
  const objects: CanvasObjectCreate[] = [];
  const ids = new Set<string>();
  function add(input: Record<string, unknown>) {
    const id = allocateId();
    if (ids.has(id)) throw new Error("Template object IDs must be unique");
    const object = CanvasObjectCreateSchema.parse({
      id,
      visibility: "published",
      color: "white",
      ...input,
    });
    ids.add(id);
    objects.push(object);
    return id;
  }
  add({ type: "text", x: 40, y: 30, width: 1600, height: 80, text: template.title, zIndex: 1 });
  const columns = template.sections.length === 4 ? 2 : 3;
  template.sections.forEach((section, index) => {
    const x = 40 + (index % columns) * 560;
    const y = 150 + Math.floor(index / columns) * 580;
    const parentId = add({
      type: "frame",
      x,
      y,
      width: 520,
      height: 540,
      text: section.title,
      zIndex: -1,
    });
    add({
      type: "text",
      x: x + 25,
      y: y + 70,
      width: 470,
      height: 100,
      text: section.guidance,
      parentId,
      zIndex: 1,
    });
    section.prompts.forEach((prompt, note) => {
      add({
        type: "sticky",
        x: x + 30 + note * 245,
        y: y + 230,
        width: 220,
        height: 230,
        text: prompt,
        color: section.color,
        parentId,
        zIndex: 2,
      });
    });
  });
  if (objects.length > 40) throw new Error("Canvas templates may contain at most 40 objects");
  return objects;
}
