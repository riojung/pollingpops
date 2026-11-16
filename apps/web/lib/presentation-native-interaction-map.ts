import {
  isSafePresentationLink,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";

export type NativeInteractionNode = Extract<
  PresentationSceneNode,
  { type: "reveal" | "link" | "hotspot" | "dialog" | "navigation" }
>;
type ImageNode = Extract<PresentationSceneNode, { type: "image" }>;
type NavigationTargets = readonly { id: string; title: string }[];

export interface NativeInteractionMapItem {
  node: NativeInteractionNode;
  ordinal: number;
  label: string;
  kind: string;
  trigger: string;
  result: string;
  audience: string;
  issues: string[];
  targetLabel: string;
  imageTarget?: ImageNode;
}

const kinds: Record<NativeInteractionNode["type"], string> = {
  reveal: "Reveal panel",
  link: "External link",
  hotspot: "Image hotspot",
  dialog: "Detail dialog",
  navigation: "Slide link",
};

export function describeNativeInteraction(
  scene: PresentationScene,
  node: NativeInteractionNode,
  navigationTargets: readonly { id: string; title: string }[],
) {
  const issues: string[] = [];
  if (!node.label.trim()) issues.push("Add a clear button or link label.");
  const label = node.label.trim() || "the interaction";
  let trigger = `Choose “${label}”.`;
  let result: string;
  let audience = "Each viewer opens this on their own screen.";
  if (node.type === "reveal") {
    result = "Show or hide the panel’s audience content.";
    if (!node.body.trim()) issues.push("Add the audience content to reveal.");
    if (node.scope === "broadcast") {
      trigger = `The facilitator chooses “${label}” during a live session.`;
      audience = "Live: reveal for everyone. Preview and shared links: this screen only.";
    }
  } else if (node.type === "link") {
    result = isSafePresentationLink(node.href)
      ? `Open ${node.href} in a new tab.`
      : "Open the linked website in a new tab.";
    audience = "The person following the link leaves for an external website in a new tab.";
    if (!isSafePresentationLink(node.href)) issues.push("Add a complete, safe HTTP or HTTPS URL.");
  } else if (node.type === "navigation") {
    const target = navigationTargets.find(
      (candidate) => candidate.id.toLowerCase() === node.targetBlockId?.toLowerCase(),
    );
    result = target ? `Go to “${target.title}”.` : "Go to the chosen slide or activity.";
    trigger = `The facilitator chooses “${label}” live; readers choose it in their shared copy.`;
    audience = "Live: move everyone. Preview and shared links: move this reader only.";
    if (!target) issues.push("Choose an available target slide or activity.");
  } else {
    result = `Open the detail dialog${node.detailTitle.trim() ? ` “${node.detailTitle}”` : ""}.`;
    if (!node.detailTitle.trim()) issues.push("Add a detail title.");
    if (!node.body.trim()) issues.push("Add the audience content for the dialog.");
    if (node.type === "hotspot") {
      const image = scene.nodes.find((candidate) => candidate.id === node.imageNodeId);
      if (image?.type === "image") {
        trigger = `Choose “${label}” on ${image.altText?.trim() || "the linked image"}.`;
        if (
          (image.rotation ?? 0) !== 0 ||
          (node.rotation ?? 0) !== 0 ||
          node.frame.x < image.frame.x ||
          node.frame.y < image.frame.y ||
          node.frame.x + node.frame.width > image.frame.x + image.frame.width ||
          node.frame.y + node.frame.height > image.frame.y + image.frame.height
        )
          issues.push("Keep the hotspot inside its unrotated image.");
      } else issues.push("Choose the image for this hotspot.");
    }
  }
  return { trigger, result, audience, issues };
}

/** Read-only authoring cues follow semantic order and retain the original scene objects. */
export function nativeInteractionMapItems(
  scene: PresentationScene,
  navigationTargets: NavigationTargets = [],
): NativeInteractionMapItem[] {
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const items: NativeInteractionMapItem[] = [];
  for (const id of scene.readingOrder) {
    const node = nodes.get(id);
    if (
      !node ||
      (node.type !== "reveal" &&
        node.type !== "link" &&
        node.type !== "hotspot" &&
        node.type !== "dialog" &&
        node.type !== "navigation")
    )
      continue;
    const action = node;
    const summary = describeNativeInteraction(scene, action, navigationTargets);
    const target =
      action.type === "navigation"
        ? navigationTargets.find(
            (candidate) => candidate.id.toLowerCase() === action.targetBlockId?.toLowerCase(),
          )
        : undefined;
    let imageTarget: ImageNode | undefined;
    if (action.type === "hotspot") {
      const image = nodes.get(action.imageNodeId ?? "");
      if (
        image?.type === "image" &&
        (image.rotation ?? 0) === 0 &&
        (action.rotation ?? 0) === 0 &&
        action.frame.x >= image.frame.x &&
        action.frame.y >= image.frame.y &&
        action.frame.x + action.frame.width <= image.frame.x + image.frame.width &&
        action.frame.y + action.frame.height <= image.frame.y + image.frame.height
      )
        imageTarget = image;
    }
    const targetLabel =
      action.type === "reveal"
        ? "Audience content in this panel"
        : action.type === "navigation"
          ? (target?.title ?? "Choose a slide or activity")
          : action.type === "link"
            ? "External website"
            : action.detailTitle.trim() || "Detail dialog";
    items.push({
      node: action,
      ordinal: items.length + 1,
      label: action.label.trim() || kinds[action.type],
      kind: kinds[action.type],
      ...summary,
      targetLabel,
      ...(imageTarget ? { imageTarget } : {}),
    });
  }
  return items;
}
