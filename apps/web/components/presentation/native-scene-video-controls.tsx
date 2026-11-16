"use client";

import { useState } from "react";
import {
  PresentationSceneDraftSchema,
  type PresentationScene,
  type SupportedLocale,
} from "@openround/contracts";
import { createNativeVideoLink } from "../../lib/presentation-native-video";
import {
  nativeTextVideoCopy,
  nativeTextVideoValidationFeedback,
  type NativeTextVideoFeedback,
} from "./native-text-video-copy";
import styles from "./native-scene.module.css";

export function NativeSceneVideoControls({
  scene,
  canAdd,
  onChange,
  onSelect,
  locale = "en-CA",
}: {
  scene: PresentationScene;
  canAdd: boolean;
  onChange: (scene: PresentationScene) => boolean | void;
  onSelect: (id: string) => void;
  locale?: SupportedLocale;
}) {
  const copy = nativeTextVideoCopy(locale);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<NativeTextVideoFeedback | null>(null);
  function add() {
    if (!canAdd) return;
    let next: PresentationScene;
    let id: string;
    try {
      const node = createNativeVideoLink(title, url, transcript);
      id = node.id;
      const parsed = PresentationSceneDraftSchema.safeParse({
        ...scene,
        schemaVersion: scene.schemaVersion >= 2 ? scene.schemaVersion : 2,
        nodes: [...scene.nodes, node],
        readingOrder: [...scene.readingOrder, node.id],
      });
      if (!parsed.success) {
        setError({
          key: "This link exceeds the slide’s limits. Shorten the links or remove some content, then try again.",
        });
        return;
      }
      next = parsed.data;
    } catch (caught) {
      setError(nativeTextVideoValidationFeedback(caught, "Check the video and transcript links."));
      return;
    }
    setError(null);
    if (onChange(next) === false) {
      setError({
        key: "The Presentation could not accept this link. Your entries are retained; reduce content and try again.",
      });
      return;
    }
    onSelect(id);
    setTitle("");
    setUrl("");
    setTranscript("");
  }
  return (
    <fieldset lang={locale} className={styles.designControls}>
      <legend>{copy("External video")}</legend>
      <div className={styles.designFields}>
        <label>
          {copy("Video title")}
          <input
            lang=""
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {copy("Video HTTPS link")}
          <input
            lang=""
            type="url"
            maxLength={2048}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label>
          {copy("Captions or transcript HTTPS link")}
          <input
            lang=""
            type="url"
            maxLength={2048}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!canAdd || !title.trim() || !url.trim() || !transcript.trim()}
          onClick={add}
        >
          {copy("Add external video link")}
        </button>
      </div>
      <p className={styles.help}>
        {copy(
          "Add a video destination and a captions or transcript fallback. The slide shows both links. Playback opens on the external site when the audience chooses the link; availability is not checked here.",
        )}
      </p>
      {error ? (
        <p className={styles.formatError} role="alert" lang={error.key ? locale : "en-CA"}>
          {error.key ? copy(error.key) : error.diagnostic}
        </p>
      ) : null}
    </fieldset>
  );
}
