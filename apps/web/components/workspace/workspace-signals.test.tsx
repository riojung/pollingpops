import { readFileSync } from "node:fs";
import { Children } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WorkspaceActionIcon,
  WorkspaceKindIcon,
  WorkspaceStatus,
  workspaceStateTone,
} from "./workspace-signals";

const statuses = {
  warning: [
    "draft",
    "pending",
    "processing",
    "scheduled",
    "changed",
    "organizing",
    "voting",
    "frozen",
  ],
  positive: ["published", "ready"],
  active: ["active", "live", "open", "collecting"],
  danger: ["expired", "failed", "overdue"],
  neutral: ["finished", "closed", "completed", "archived", "unknown"],
} as const;

describe("workspace state signals", () => {
  it.each(Object.entries(statuses))("maps known %s states consistently", (tone, values) => {
    for (const status of values) {
      expect(workspaceStateTone(status)).toBe(tone);
      const markup = renderToStaticMarkup(
        <WorkspaceStatus status={status}>Localized label</WorkspaceStatus>,
      );
      expect(markup).toContain(`data-status="${status}"`);
      expect(markup).toContain(`data-tone="${status}"`);
      expect(markup).toContain(`data-state-tone="${tone}"`);
    }
  });

  it.each(["future_status", "constructor", "__proto__", "toString", ""])(
    "keeps forward-compatible status %s neutral",
    (status) => {
      expect(workspaceStateTone(status)).toBe("neutral");
      const markup = renderToStaticMarkup(
        <WorkspaceStatus status={status}>Future label</WorkspaceStatus>,
      );
      expect(markup).toContain('data-state-tone="neutral"');
      expect(markup).toContain('data-icon="unknown"');
    },
  );

  it("normalizes the tone without rewriting the authoritative raw state", () => {
    const markup = renderToStaticMarkup(<WorkspaceStatus status=" DRAFT ">下書き</WorkspaceStatus>);
    expect(markup).toContain('data-status=" DRAFT "');
    expect(markup).toContain('data-tone=" DRAFT "');
    expect(markup).toContain('data-state-tone="warning"');
    expect(markup).toContain('data-icon="pencil"');
  });

  it.each(["下書き", "Brouillon", "مسودة", "Draft"])(
    "preserves the visible translated label %s as its only accessible text",
    (label) => {
      const status = WorkspaceStatus({
        className: "existing-compact-badge",
        status: "draft",
        children: label,
      });
      expect(status.type).toBe("span");
      expect(Children.toArray(status.props.children)).toEqual([
        expect.objectContaining({
          type: "svg",
          props: expect.objectContaining({ "aria-hidden": "true", focusable: "false" }),
        }),
        label,
      ]);
      const markup = renderToStaticMarkup(status);
      expect(markup).toContain("existing-compact-badge");
      expect(markup).toMatch(/<svg aria-hidden="true"[^>]*focusable="false"/);
      expect(markup).not.toMatch(/aria-label=|<title\b|role="status"/);
      expect(markup).toContain(`</svg>${label}</span>`);
    },
  );

  it.each([
    ["draft", "pencil"],
    ["scheduled", "clock"],
    ["published", "check"],
    ["active", "live"],
    ["archived", "archive"],
    ["failed", "alert"],
    ["frozen", "lock"],
  ])("gives %s a decorative %s cue", (status, icon) => {
    const markup = renderToStaticMarkup(<WorkspaceStatus status={status}>Label</WorkspaceStatus>);
    expect(markup).toContain(`data-icon="${icon}"`);
  });

  it("keeps kind and action icons decorative without adding accessible names", () => {
    const icons = [
      ...(["round", "presentation", "survey", "practice"] as const).map((kind) =>
        WorkspaceKindIcon({ kind }),
      ),
      ...(["host", "resume", "edit", "result", "assign"] as const).map((action) =>
        WorkspaceActionIcon({ action }),
      ),
    ];
    for (const icon of icons) {
      expect(icon.type).toBe("svg");
      expect(icon.props).toMatchObject({ "aria-hidden": "true", focusable: "false" });
      expect(icon.props).not.toHaveProperty("aria-label");
      expect(icon.props).not.toHaveProperty("aria-labelledby");
    }
    const markup = icons.map((icon) => renderToStaticMarkup(icon)).join("");
    expect(markup.match(/<svg aria-hidden="true"/g)).toHaveLength(9);
    expect(markup.match(/focusable="false"/g)).toHaveLength(9);
    expect(markup).not.toMatch(/aria-label=|aria-labelledby=|<title\b/);
  });
});

const themeCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const signalCss = readFileSync(new URL("./workspace-signals.module.css", import.meta.url), "utf8");

function declarations(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  if (!body) throw new Error(`Missing palette selector ${selector}`);
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]),
  );
}

function color(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`Missing palette token ${name}`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return alias ? color(tokens, alias) : value;
}

function luminance(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex))
    throw new Error(`Expected an opaque palette color, received ${hex}`);
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

describe.each([":root", 'html[data-color-mode="dark"]'])(
  "workspace signal contrast in %s",
  (theme) => {
    const tokens = { ...declarations(themeCss, ":root"), ...declarations(themeCss, theme) };

    it("keeps completed and unknown state labels readable on their neutral surface", () => {
      expect(
        contrast(color(tokens, "--ui-text-subtle"), color(tokens, "--ui-surface-soft")),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it.each(["success", "warning", "info", "danger", "violet"])(
      "keeps %s status labels above 4.5:1",
      (tone) => {
        expect(
          contrast(color(tokens, `--ui-${tone}-text`), color(tokens, `--ui-${tone}-bg`)),
        ).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each(["round", "presentation", "survey", "practice"])(
      "keeps %s type text readable on its selected tab and neutral card",
      (kind) => {
        const foreground = color(tokens, `--ui-kind-${kind}-text`);
        expect(contrast(foreground, color(tokens, `--ui-kind-${kind}-bg`))).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrast(foreground, color(tokens, "--ui-surface"))).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each(["host", "resume", "edit", "delete"])(
      "keeps %s action text above 4.5:1 on its actual fill",
      (action) => {
        const actionTokens = {
          ...tokens,
          ...declarations(signalCss, `.action[data-action="${action}"]`),
        };
        expect(
          contrast(
            color(actionTokens, "--workspace-action-ink"),
            color(actionTokens, "--workspace-action-bg"),
          ),
        ).toBeGreaterThanOrEqual(4.5);
      },
    );
  },
);
