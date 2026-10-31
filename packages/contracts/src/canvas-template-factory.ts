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
  if (templateId === "flow-to-action") {
    add({ type: "text", x: 40, y: 30, width: 1360, height: 80, text: template.title, zIndex: 1 });
    const parentId = add({
      type: "frame",
      x: 40,
      y: 150,
      width: 1360,
      height: 650,
      text: "A path to review together",
      zIndex: -1,
    });
    add({
      type: "text",
      x: 80,
      y: 200,
      width: 1280,
      height: 60,
      text: "Edit each step and label each route. These are starting prompts, not submitted responses.",
      parentId,
      zIndex: 1,
    });
    const input = add({
      type: "parallelogram",
      x: 80,
      y: 310,
      width: 230,
      height: 130,
      text: "Input to consider",
      color: "blue",
      parentId,
      zIndex: 1,
    });
    const review = add({
      type: "rect",
      x: 410,
      y: 310,
      width: 230,
      height: 130,
      text: "Review information",
      color: "blue",
      parentId,
      zIndex: 1,
    });
    const decision = add({
      type: "diamond",
      x: 760,
      y: 280,
      width: 280,
      height: 190,
      text: "Ready to continue?",
      color: "yellow",
      parentId,
      zIndex: 1,
    });
    const action = add({
      type: "rect",
      x: 1120,
      y: 310,
      width: 230,
      height: 130,
      text: "Take the next action",
      color: "green",
      parentId,
      zIndex: 1,
    });
    const gather = add({
      type: "rect",
      x: 785,
      y: 620,
      width: 230,
      height: 130,
      text: "Gather missing information",
      color: "pink",
      parentId,
      zIndex: 1,
    });
    const connect = (
      from: string,
      to: string,
      fromAnchor: string,
      toAnchor: string,
      text: string,
    ) =>
      add({
        type: "connector",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        parentId,
        text,
        from: { objectId: from, x: 0, y: 0, anchor: fromAnchor },
        to: { objectId: to, x: 0, y: 0, anchor: toAnchor },
        routing: "straight",
        zIndex: 0,
      });
    connect(input, review, "right", "left", "Read");
    connect(review, decision, "right", "left", "Check");
    connect(decision, action, "right", "left", "Yes");
    connect(decision, gather, "bottom", "top", "Not yet");
    return objects;
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
