import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Countdown, type CountdownLabels } from "./countdown";
import { followupCopy } from "../lib/i18n/followup-copy";

const copy = followupCopy("ko-KR");
const korean: CountdownLabels = {
  seconds: (seconds) => copy("{seconds}s", { seconds }),
  remaining: (seconds) => copy("{seconds} seconds remaining", { seconds }),
  paused: copy("Paused"),
  timeUp: copy("Time is up"),
};
describe("countdown localized presentation", () => {
  it("retains default English for existing callers", () => {
    expect(renderToStaticMarkup(<Countdown deadline={null} />)).toContain("Paused");
    expect(renderToStaticMarkup(<Countdown deadline="2000-01-01T00:00:00.000Z" />)).toContain(
      "Time is up",
    );
  });
  it("renders Korean paused and expired states without changing timer semantics", () => {
    const paused = renderToStaticMarkup(<Countdown deadline={null} labels={korean} />);
    expect(paused).toContain('role="timer">일시 정지됨');
    expect(paused).not.toContain("시간이 다 되었습니다");
    const expired = renderToStaticMarkup(
      <Countdown deadline="2000-01-01T00:00:00.000Z" labels={korean} />,
    );
    expect(expired).toContain('role="timer">0초');
    expect(expired).toContain('aria-live="polite" class="sr-only">시간이 다 되었습니다');
    expect(expired).not.toContain("Time is up");
  });
  it("announces the existing ten-second threshold in Korean", () => {
    const deadline = new Date(Date.now() + 10_000).toISOString();
    const markup = renderToStaticMarkup(<Countdown deadline={deadline} labels={korean} />);
    expect(markup).toContain('role="timer">10초');
    expect(markup).toContain('aria-live="polite" class="sr-only">10초 남음');
    expect(markup).not.toContain("seconds remaining");
  });
});
