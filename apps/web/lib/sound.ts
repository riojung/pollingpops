import type { ExperienceThemeSnapshot } from "@openround/contracts";

const cueNotes = {
  open: [523.25, 659.25],
  lock: [392],
  reveal: [587.33, 783.99],
  finish: [523.25, 659.25, 783.99],
} as const;

export type PresenterCue = keyof typeof cueNotes;

let sharedContext: AudioContext | null = null;
const soundCuesListeners = new Set<() => void>();

export function getSoundCuesStatus() {
  if (typeof window === "undefined" || !window.AudioContext) return "unavailable";
  return sharedContext?.state === "running" ? "ready" : "needs-activation";
}

export function subscribeSoundCues(listener: () => void) {
  soundCuesListeners.add(listener);
  return () => {
    soundCuesListeners.delete(listener);
  };
}

function notifySoundCuesStatus() {
  for (const listener of soundCuesListeners) listener();
}

export async function unlockSoundCues() {
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    if (!sharedContext || sharedContext.state === "closed") {
      sharedContext?.removeEventListener("statechange", notifySoundCuesStatus);
      sharedContext = new window.AudioContext();
      sharedContext.addEventListener("statechange", notifySoundCuesStatus);
    }
    if (sharedContext.state !== "running") await sharedContext.resume();
  } catch {
    // Sound is optional and the browser may decline to start it.
  } finally {
    notifySoundCuesStatus();
  }
}

export function playPresenterCue(
  theme: ExperienceThemeSnapshot | null | undefined,
  cue: PresenterCue,
) {
  const context = sharedContext;
  if (
    !theme?.soundEnabled ||
    theme.soundCue === "none" ||
    context?.state !== "running" ||
    document.hidden ||
    document.documentElement.dataset.openroundMuted !== "false"
  ) {
    return;
  }

  const lively = theme.soundCue === "celebration";
  const now = context.currentTime;
  try {
    for (const [index, frequency] of cueNotes[cue].entries()) {
      const start = now + index * 0.075;
      const end = start + (cue === "lock" ? 0.09 : 0.14);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = lively ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(lively ? 0.055 : 0.027, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end);
    }
  } catch {
    // Losing the audio device mid-cue must not interrupt the live display.
  }
}
