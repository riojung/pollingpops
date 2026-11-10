"use client";

import { useEffect, useState } from "react";

export interface CountdownLabels {
  seconds: (seconds: number) => string;
  remaining: (seconds: number) => string;
  paused: string;
  timeUp: string;
}

const englishLabels: CountdownLabels = {
  seconds: (seconds) => `${seconds}s`,
  remaining: (seconds) => `${seconds} seconds remaining`,
  paused: "Paused",
  timeUp: "Time is up",
};

export function Countdown({
  deadline,
  labels = englishLabels,
}: {
  deadline: string | null;
  labels?: CountdownLabels;
}) {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, new Date(deadline).getTime() - Date.now()) : 0,
  );

  useEffect(() => {
    const update = () =>
      setRemaining(deadline ? Math.max(0, new Date(deadline).getTime() - Date.now()) : 0);
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [deadline]);

  const seconds = Math.ceil(remaining / 1_000);
  const announcement =
    seconds === 10 || seconds === 5
      ? labels.remaining(seconds)
      : seconds === 0 && deadline
        ? labels.timeUp
        : "";
  return (
    <>
      <span aria-live="off" className="countdown" role="timer">
        {deadline ? labels.seconds(seconds) : labels.paused}
      </span>
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
