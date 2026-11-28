import { useSyncExternalStore } from "react";

export const EXPERIENCE_PREFERENCES_KEY = "openround:experience-preferences";

const motionQuery = "(prefers-reduced-motion: reduce)";
const serverFalse = () => false;
const noopSubscribe = () => () => {};

export function getExperienceMotionReduced() {
  if (typeof window === "undefined") return false;
  if (
    window.matchMedia?.(motionQuery).matches ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.openroundMotion === "reduced")
  )
    return true;
  try {
    const preferences = JSON.parse(
      window.localStorage.getItem(EXPERIENCE_PREFERENCES_KEY) ?? "null",
    );
    return preferences?.reducedMotion === true;
  } catch {
    return false;
  }
}

function subscribeReduced(listener: () => void) {
  const query = window.matchMedia?.(motionQuery);
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key === EXPERIENCE_PREFERENCES_KEY) listener();
  }
  query?.addEventListener("change", listener);
  window.addEventListener("storage", onStorage);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-openround-motion"],
  });
  return () => {
    query?.removeEventListener("change", listener);
    window.removeEventListener("storage", onStorage);
    observer.disconnect();
  };
}

export function useExperienceMotionReduced(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribeReduced : noopSubscribe,
    enabled ? getExperienceMotionReduced : serverFalse,
    serverFalse,
  );
}
