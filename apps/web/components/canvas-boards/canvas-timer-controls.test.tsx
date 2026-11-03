import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasTimerControls, type CanvasTimerControlsProps } from "./canvas-timer-controls";
import { canvasTimerRemaining } from "./canvas-timer";
import { facilitationFixture } from "./canvas-facilitation-test-fixtures";
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useId: () => "timer-controls-test",
}));
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
function harness(overrides: Partial<CanvasTimerControlsProps> = {}) {
  const command = vi.fn(),
    minutes = vi.fn();
  const props: CanvasTimerControlsProps = {
    timer: facilitationFixture.timer,
    serverNow: facilitationFixture.serverNow,
    minutes: 5,
    onMinutes: minutes,
    canControl: true,
    onCommand: command,
    ...overrides,
  };
  minutes.mockImplementation((value) => {
    props.minutes = value;
  });
  let tree: ReactNode;
  const view = {
    command,
    minutes,
    render(next: Partial<CanvasTimerControlsProps> = {}) {
      Object.assign(props, next);
      tree = CanvasTimerControls(props);
      return renderToStaticMarkup(tree);
    },
    button(label: string) {
      const button = find(
        tree,
        (element) =>
          element.type === "button" &&
          (element.props["aria-label"] === label || element.props.children === label),
      );
      if (!button) throw new Error("Missing button: " + label);
      return button.props;
    },
    click(label: string) {
      (view.button(label).onClick as () => void)();
      return view.render();
    },
    input(value: number) {
      const input = find(tree, (element) => element.type === "input")!;
      (input.props.onChange as (event: unknown) => void)({
        currentTarget: { valueAsNumber: value },
      });
      return view.render();
    },
    submit() {
      const form = find(tree, (element) => element.type === "form")!;
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    },
  };
  view.render();
  return view;
}
describe("server-authoritative timer controls", () => {
  it("offers bounded duration steps, editable minutes and presets before starting once", () => {
    const view = harness();
    expect(view.render()).toContain("05:00");
    view.click("Increase duration");
    expect(view.minutes).toHaveBeenLastCalledWith(6);
    view.click("Decrease duration");
    expect(view.minutes).toHaveBeenLastCalledWith(5);
    view.input(12);
    expect(view.minutes).toHaveBeenLastCalledWith(12);
    view.click("5 min");
    expect(view.minutes).toHaveBeenLastCalledWith(5);
    expect(view.command).not.toHaveBeenCalled();
    view.submit();
    expect(view.command).toHaveBeenCalledWith({
      type: "timer_start",
      expectedRevision: 0,
      durationSeconds: 300,
    });
    view.render({ minutes: 1 });
    expect(view.button("Decrease duration").disabled).toBe(true);
    view.render({ minutes: 120 });
    expect(view.button("Increase duration").disabled).toBe(true);
  });
  it.each([Number.NaN, 0, 121, 1.5])(
    "does not issue a timer command for invalid minutes %s",
    (minutes) => {
      const view = harness({ minutes });
      expect(view.button("Start timer").disabled).toBe(true);
      view.submit();
      expect(view.command).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["running", "Pause timer", "timer_pause"],
    ["paused", "Resume timer", "timer_resume"],
  ] as const)(
    "offers one primary action for a %s timer and hides setup controls",
    (status, label, type) => {
      const view = harness({
        timer: {
          ...facilitationFixture.timer,
          status,
          revision: 7,
          durationSeconds: 300,
          remainingMs: 180_000,
          deadlineAt: status === "running" ? "2026-11-01T12:03:00.000Z" : null,
        },
      });
      const html = view.render();
      expect(html).not.toContain('type="number"');
      expect(html).not.toContain("Quick durations");
      expect(view.button(label).disabled).toBe(false);
      view.submit();
      expect(view.command).toHaveBeenLastCalledWith({ type, expectedRevision: 7 });
      view.click("Reset timer");
      expect(view.command).toHaveBeenLastCalledWith({ type: "timer_reset", expectedRevision: 7 });
    },
  );
  it("keeps failed/saving commands disabled and viewers limited to the display", () => {
    const blocked = harness({ disabled: true });
    blocked.submit();
    expect(blocked.command).not.toHaveBeenCalled();
    expect(blocked.button("Start timer").disabled).toBe(true);
    const viewer = harness({ canControl: false });
    const html = viewer.render();
    expect(html).toContain('role="timer"');
    expect(html).toContain("00:00");
    expect(html).not.toContain("05:00");
    expect(html).not.toContain("Ready when you are");
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });
  it("derives elapsed progress from the server timer without issuing local finish commands", () => {
    const timer = {
      ...facilitationFixture.timer,
      status: "running" as const,
      durationSeconds: 300,
      remainingMs: 200_000,
      deadlineAt: "2026-11-01T12:03:20.000Z",
    };
    expect(canvasTimerRemaining(timer, facilitationFixture.serverNow, 10_000)).toBe(190_000);
    const view = harness({ timer });
    expect(view.render()).toContain('aria-valuenow="33"');
    const html = view.render({
      timer: { ...timer, remainingMs: 0, deadlineAt: facilitationFixture.serverNow },
    });
    expect(html).toContain("00:00");
    expect(html).toContain("Time is up");
    expect(view.command).not.toHaveBeenCalled();
  });
});
