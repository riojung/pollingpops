import {
  PresentationScenePrototypeSchema,
  type PresentationScenePrototype,
  type PresentationScenePrototypeFrame,
} from "@openround/contracts";
import { presentationSceneFixtures } from "./presentation-scene-fixtures";

export const PRESENTATION_SCENE_STORAGE_KEY = "pollingpops:scene-lab:workspace:v1";
export const PRESENTATION_SCENE_WORKSPACE_MAX_BYTES = 1024 * 1024;

export interface PresentationSceneWorkspace {
  artifactType: "presentation_scene_lab_workspace";
  schemaVersion: 1;
  activeFixtureId: string;
  decks: Array<{
    fixtureId: string;
    activeSlideId: string;
    slides: PresentationScenePrototype[];
  }>;
}

export function createPresentationSceneWorkspace(): PresentationSceneWorkspace {
  return {
    artifactType: "presentation_scene_lab_workspace",
    schemaVersion: 1,
    activeFixtureId: presentationSceneFixtures[0]!.id,
    decks: presentationSceneFixtures.map((fixture) => ({
      fixtureId: fixture.id,
      activeSlideId: fixture.slides[0]!.id,
      slides: structuredClone(fixture.slides),
    })),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keysMatch(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Only bundled task material belongs here; production recovery/private media never does. */
export function parsePresentationSceneWorkspace(raw: string): PresentationSceneWorkspace {
  if (
    raw.length > PRESENTATION_SCENE_WORKSPACE_MAX_BYTES ||
    new TextEncoder().encode(raw).byteLength > PRESENTATION_SCENE_WORKSPACE_MAX_BYTES
  ) {
    throw new Error("Saved prototype exceeds the local size limit.");
  }
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    !keysMatch(value, ["artifactType", "schemaVersion", "activeFixtureId", "decks"]) ||
    value.artifactType !== "presentation_scene_lab_workspace" ||
    value.schemaVersion !== 1 ||
    !presentationSceneFixtures.some((fixture) => fixture.id === value.activeFixtureId) ||
    !Array.isArray(value.decks) ||
    value.decks.length !== presentationSceneFixtures.length
  ) {
    throw new Error("Saved prototype has an unsupported workspace format.");
  }
  const seen = new Set<string>();
  const decks = value.decks.map((candidate: unknown) => {
    if (!object(candidate) || !keysMatch(candidate, ["fixtureId", "activeSlideId", "slides"])) {
      throw new Error("Saved prototype has an invalid deck.");
    }
    const fixture = presentationSceneFixtures.find((item) => item.id === candidate.fixtureId);
    if (
      !fixture ||
      seen.has(fixture.id) ||
      !Array.isArray(candidate.slides) ||
      candidate.slides.length !== fixture.slides.length
    ) {
      throw new Error("Saved prototype does not match the bundled task decks.");
    }
    seen.add(fixture.id);
    const slides = candidate.slides.map((slide: unknown, index: number) => {
      const parsed = PresentationScenePrototypeSchema.parse(slide);
      if (
        parsed.id !== fixture.slides[index]!.id ||
        parsed.nodes.some((node) => node.type === "image" && node.asset.kind !== "bundled_fixture")
      ) {
        throw new Error("Only the bundled prototype slides and images can be saved locally.");
      }
      return parsed;
    });
    if (!slides.some((slide) => slide.id === candidate.activeSlideId)) {
      throw new Error("Saved prototype has an invalid selected slide.");
    }
    return { fixtureId: fixture.id, activeSlideId: candidate.activeSlideId as string, slides };
  });
  return {
    artifactType: "presentation_scene_lab_workspace",
    schemaVersion: 1,
    activeFixtureId: value.activeFixtureId as string,
    decks,
  };
}

export function serializePresentationSceneWorkspace(workspace: PresentationSceneWorkspace) {
  const raw = JSON.stringify(workspace);
  parsePresentationSceneWorkspace(raw);
  return raw;
}

export function boundPrototypeFrame(frame: PresentationScenePrototypeFrame) {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  const width = Math.max(1, Math.min(100, finite(frame.width, 1)));
  const height = Math.max(1, Math.min(100, finite(frame.height, 1)));
  return {
    x: Math.max(0, Math.min(100 - width, finite(frame.x, 0))),
    y: Math.max(0, Math.min(100 - height, finite(frame.y, 0))),
    width,
    height,
  };
}
