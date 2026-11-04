import {
  PresentationRichTextSchema,
  presentationRichTextToPlainText,
  type PresentationSceneNode,
} from "@openround/contracts";
import { clientUuid } from "./uuid";

function externalHttps(value: string) {
  if (value.trim().length > 2048) throw new Error("Keep each HTTPS link within 2048 characters.");
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use an HTTPS link without embedded credentials.");
  return url.href;
}

/** Explicit links use the existing rich-text contract; no provider script or iframe is loaded. */
export function createNativeVideoLink(
  title: string,
  video: string,
  transcript: string,
): PresentationSceneNode {
  if (!title.trim() || title.trim().length > 160)
    throw new Error("Give the video a title of at most 160 characters.");
  const href = externalHttps(video);
  const transcriptHref = externalHttps(transcript);
  const richText = PresentationRichTextSchema.parse({
    paragraphs: [
      { kind: "paragraph", runs: [{ text: `External video: ${title.trim()} — ${href}`, href }] },
      {
        kind: "paragraph",
        runs: [{ text: `Captions / transcript: ${transcriptHref}`, href: transcriptHref }],
      },
      {
        kind: "paragraph",
        runs: [
          {
            text: "Opens on an external site after you follow the link. If playback is unavailable, use the captions or transcript link.",
          },
        ],
      },
    ],
  });
  return {
    id: clientUuid(),
    type: "text",
    role: "body",
    richText,
    text: presentationRichTextToPlainText(richText),
    frame: { x: 7, y: 35, width: 86, height: 55 },
  };
}
