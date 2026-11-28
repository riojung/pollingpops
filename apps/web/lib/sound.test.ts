import { resolveExperienceTheme } from "@openround/experience";
import { afterEach, describe, expect, it, vi } from "vitest";

const livelyTheme = resolveExperienceTheme({ category: "icebreaker", soundEnabled: true });
const subtleTheme = resolveExperienceTheme({ category: "education", soundEnabled: true });

function audioBrowser() {
  const notes: {
    type: string;
    frequency: { value: number };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const createOscillator = vi.fn(() => {
    const note = {
      type: "",
      frequency: { value: 0 },
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    notes.push(note);
    return note;
  });
  const context = Object.assign(new EventTarget(), {
    state: "suspended",
    currentTime: 2,
    destination: {},
    createOscillator,
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    resume: vi.fn(async () => {
      context.state = "running";
    }),
  });
  const AudioContext = vi.fn(function () {
    return context;
  });
  const document = {
    hidden: false,
    documentElement: { dataset: { openroundMuted: "false", openroundMotion: "reduced" } },
  };
  vi.stubGlobal("window", { AudioContext });
  vi.stubGlobal("document", document);
  return { AudioContext, context, document, notes };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("presenter sound", () => {
  it("reports when the projector needs to activate or resume its browser audio", async () => {
    const { context } = audioBrowser();
    const { getSoundCuesStatus, subscribeSoundCues, unlockSoundCues } = await import("./sound");
    const onChange = vi.fn();
    const unsubscribe = subscribeSoundCues(onChange);
    expect(getSoundCuesStatus()).toBe("needs-activation");
    await unlockSoundCues();
    expect(getSoundCuesStatus()).toBe("ready");
    expect(onChange).toHaveBeenCalledTimes(1);
    context.state = "suspended";
    context.dispatchEvent(new Event("statechange"));
    expect(getSoundCuesStatus()).toBe("needs-activation");
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    context.dispatchEvent(new Event("statechange"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("waits for sound to be unlocked and honors the room and browser controls", async () => {
    const { AudioContext, context, document, notes } = audioBrowser();
    const { playPresenterCue, unlockSoundCues } = await import("./sound");
    playPresenterCue(livelyTheme, "open");
    expect(AudioContext).not.toHaveBeenCalled();
    await unlockSoundCues();
    playPresenterCue({ ...livelyTheme, soundEnabled: false }, "open");
    playPresenterCue({ ...livelyTheme, soundCue: "none" }, "open");
    document.documentElement.dataset.openroundMuted = "true";
    playPresenterCue(livelyTheme, "lock");
    document.documentElement.dataset.openroundMuted = "false";
    document.hidden = true;
    playPresenterCue(livelyTheme, "reveal");
    document.hidden = false;
    context.state = "suspended";
    playPresenterCue(livelyTheme, "finish");
    expect(notes).toHaveLength(0);
  });

  it("plays short, distinct motifs and keeps reduced motion independent of sound", async () => {
    const { notes } = audioBrowser();
    const { playPresenterCue, unlockSoundCues } = await import("./sound");
    await unlockSoundCues();

    const frequencies = () => notes.splice(0).map((note) => note.frequency.value);
    playPresenterCue(subtleTheme, "open");
    expect(notes.every((note) => note.type === "sine")).toBe(true);
    expect(frequencies()).toEqual([523.25, 659.25]);
    playPresenterCue(livelyTheme, "lock");
    expect(frequencies()).toEqual([392]);
    playPresenterCue(livelyTheme, "reveal");
    expect(frequencies()).toEqual([587.33, 783.99]);
    playPresenterCue(livelyTheme, "finish");
    expect(notes.every((note) => note.type === "triangle")).toBe(true);
    expect(notes[0]?.start).toHaveBeenCalledWith(2);
    expect(notes[2]?.stop.mock.calls[0]?.[0]).toBeLessThan(2.35);
    expect(frequencies()).toEqual([523.25, 659.25, 783.99]);
  });

  it("keeps unsupported or rejected audio silent", async () => {
    const { unlockSoundCues, playPresenterCue } = await import("./sound");
    vi.stubGlobal("window", {});
    await expect(unlockSoundCues()).resolves.toBeUndefined();
    const { context, notes } = audioBrowser();
    context.resume.mockRejectedValueOnce(new Error("Audio permission denied"));
    await expect(unlockSoundCues()).resolves.toBeUndefined();
    playPresenterCue(livelyTheme, "finish");
    expect(notes).toHaveLength(0);
  });
});
