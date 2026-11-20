import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExperienceTheme } from "@openround/experience";
import type { BrandTheme } from "@openround/contracts";
import { COLOR_MODE_APPLIED_EVENT, COLOR_MODE_STORAGE_KEY } from "../../lib/color-mode";
import {
  INTERFACE_THEME_CHANGE_EVENT,
  INTERFACE_THEME_STORAGE_KEY,
} from "../../lib/interface-theme";
import { appearanceMessages } from "../../lib/i18n/appearance-messages";
import {
  InterfaceWorkspacePreview,
  PersonalInterfaceSettings,
  selectedWorkspacePreset,
  WorkspaceBrandSettings,
  WorkspaceLivePreview,
} from "./appearance-settings";

const hooks = vi.hoisted(() => ({
  capture: false,
  cursor: 0,
  states: [] as unknown[],
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (loadOriginal) => {
  const original = await loadOriginal<typeof ReactModule>();
  return {
    ...original,
    useState: <T,>(initial: T) => {
      if (!hooks.capture) return original.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = initial;
      return [
        hooks.states[index],
        (value: T | ((previous: T) => T)) => {
          hooks.states[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(hooks.states[index] as T)
              : value;
        },
      ];
    },
    useEffect: (effect: () => void | (() => void)) => {
      if (hooks.capture && hooks.effects.length === 0) hooks.effects.push(effect);
    },
  };
});
vi.mock("../../components/locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === "function") {
    return [
      node,
      ...elements((node.type as (props: Record<string, unknown>) => ReactNode)(node.props)),
    ];
  }
  return [node, ...elements(node.props.children as ReactNode)];
}
function content(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement<Record<string, unknown>>(node)
    ? content(node.props.children as ReactNode)
    : "";
}
function button(nodes: Element[], label: string) {
  const found = nodes.find((node) => node.type === "button" && content(node) === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
function click(node: Element) {
  (node.props.onClick as () => void)();
}

let browser: EventTarget & {
  localStorage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
  matchMedia: ReturnType<typeof vi.fn>;
};
let root: {
  dataset: Record<string, string>;
  style: {
    colorScheme: string;
    setProperty: ReturnType<typeof vi.fn>;
    removeProperty: ReturnType<typeof vi.fn>;
  };
};
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: vi.fn((key: string) => stored.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
    },
    matchMedia: vi.fn(() => ({ matches: false })),
  });
  root = {
    dataset: { colorMode: "light", colorModePreference: "system", interfaceTheme: "classic" },
    style: { colorScheme: "light", setProperty: vi.fn(), removeProperty: vi.fn() },
  };
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", { documentElement: root });
});
afterEach(() => {
  hooks.capture = false;
  hooks.cursor = 0;
  hooks.states = [];
  hooks.effects = [];
  vi.unstubAllGlobals();
});

function renderPersonal() {
  hooks.capture = true;
  hooks.cursor = 0;
  return elements(PersonalInterfaceSettings());
}
function mountPersonal() {
  renderPersonal();
  const cleanup = hooks.effects[0]?.();
  return cleanup;
}

const brand: BrandTheme = {
  organizationName: "Acme",
  primaryColor: "#17334A",
  accentColor: "#006B80",
  colorMode: "light",
};

describe("personal interface gallery", () => {
  it("keeps exploration and Light/Dark/comparison inspection isolated until explicit Apply", () => {
    mountPersonal();
    let nodes = renderPersonal();
    expect(
      nodes.filter((node) => node.type === "button" && content(node).startsWith("Ocean")),
    ).toHaveLength(1);
    click(nodes.find((node) => node.type === "button" && content(node).startsWith("Ocean"))!);
    nodes = renderPersonal();
    const inspection = nodes.find(
      (node) => node.props["aria-label"] === "Preview — Your interface",
    )!;
    click(button(elements(inspection), "Dark"));
    nodes = renderPersonal();
    expect(nodes.filter((node) => node.props["data-preview-mode"])).toHaveLength(1);
    expect(nodes.find((node) => node.props["data-preview-mode"])?.props["data-preview-mode"]).toBe(
      "dark",
    );
    click(
      button(
        elements(nodes.find((node) => node.props["aria-label"] === "Preview — Your interface")!),
        "Light",
      ),
    );
    nodes = renderPersonal();
    expect(nodes.find((node) => node.props["data-preview-mode"])?.props["data-preview-mode"]).toBe(
      "light",
    );
    click(
      button(
        elements(nodes.find((node) => node.props["aria-label"] === "Preview — Your interface")!),
        "Side by side",
      ),
    );
    nodes = renderPersonal();
    expect(nodes.filter((node) => node.props["data-preview-mode"])).toHaveLength(2);
    expect(browser.localStorage.setItem).not.toHaveBeenCalled();
    expect(root.dataset).toEqual({
      colorMode: "light",
      colorModePreference: "system",
      interfaceTheme: "classic",
    });
    click(button(nodes, "Apply to my interface"));
    expect(stored.get(INTERFACE_THEME_STORAGE_KEY)).toBe("ocean");
    expect(stored.get(COLOR_MODE_STORAGE_KEY)).toBe("system");
    expect(root.dataset.interfaceTheme).toBe("ocean");
    expect(button(renderPersonal(), "Apply to my interface").props.disabled).toBe(true);
  });

  it("discards family and appearance edits without writing a preference", () => {
    stored.set(INTERFACE_THEME_STORAGE_KEY, "violet");
    stored.set(COLOR_MODE_STORAGE_KEY, "dark");
    mountPersonal();
    let nodes = renderPersonal();
    click(nodes.find((node) => node.type === "button" && content(node).startsWith("Forest"))!);
    nodes = renderPersonal();
    const modeField = nodes.find(
      (node) => node.type === "fieldset" && content(node).startsWith("Interface appearance"),
    )!;
    click(button(elements(modeField), "Light"));
    click(button(renderPersonal(), "Discard changes"));
    nodes = renderPersonal();
    expect(
      nodes.find((node) => node.type === "button" && content(node).startsWith("Violet"))?.props[
        "aria-pressed"
      ],
    ).toBe(true);
    expect(
      button(
        elements(
          nodes.find(
            (node) => node.type === "fieldset" && content(node).startsWith("Interface appearance"),
          )!,
        ),
        "Dark",
      ).props["aria-pressed"],
    ).toBe(true);
    expect(browser.localStorage.setItem).not.toHaveBeenCalled();
    expect(button(nodes, "Apply to my interface").props.disabled).toBe(true);
  });

  it("follows external applied changes, preserves exploration drafts, and cleans up subscriptions", () => {
    const cleanup = mountPersonal();
    stored.set(INTERFACE_THEME_STORAGE_KEY, "slate");
    browser.dispatchEvent(new Event(INTERFACE_THEME_CHANGE_EVENT));
    let nodes = renderPersonal();
    expect(
      nodes.find((node) => node.type === "button" && content(node).startsWith("Slate"))?.props[
        "aria-pressed"
      ],
    ).toBe(true);
    click(nodes.find((node) => node.type === "button" && content(node).startsWith("Sand"))!);
    stored.set(COLOR_MODE_STORAGE_KEY, "dark");
    browser.dispatchEvent(new Event(COLOR_MODE_APPLIED_EVENT));
    nodes = renderPersonal();
    expect(
      nodes.find((node) => node.type === "button" && content(node).startsWith("Sand"))?.props[
        "aria-pressed"
      ],
    ).toBe(true);
    click(button(nodes, "Discard changes"));
    nodes = renderPersonal();
    expect(
      button(
        elements(
          nodes.find(
            (node) => node.type === "fieldset" && content(node).startsWith("Interface appearance"),
          )!,
        ),
        "Dark",
      ).props["aria-pressed"],
    ).toBe(true);
    if (typeof cleanup !== "function") throw new Error("Expected cleanup");
    cleanup();
    stored.set(INTERFACE_THEME_STORAGE_KEY, "ocean");
    browser.dispatchEvent(new Event(INTERFACE_THEME_CHANGE_EVENT));
    expect(
      renderPersonal().find((node) => node.type === "button" && content(node).startsWith("Slate"))
        ?.props["aria-pressed"],
    ).toBe(true);
  });
});

describe("workspace live brand gallery", () => {
  it.each([true, false])(
    "describes live-brand availability to viewers with entitlement %s",
    (entitled) => {
      hooks.capture = true;
      const onChange = vi.fn();
      const onSave = vi.fn();
      const nodes = elements(
        WorkspaceBrandSettings({
          theme: brand,
          savedTheme: brand,
          canManage: false,
          entitled,
          busy: false,
          onChange,
          onSave,
          onReset: vi.fn(),
        }),
      );
      const { brandSaveUnavailable } = appearanceMessages("en-CA");
      const managerCanSave = "A workspace manager can save";
      expect(content(nodes[0])).toContain(entitled ? managerCanSave : brandSaveUnavailable);
      expect(content(nodes[0])).not.toContain(entitled ? brandSaveUnavailable : managerCanSave);
      click(nodes.find((node) => node.type === "button" && content(node).startsWith("Forest"))!);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryColor: "#183C31",
          accentColor: "#176B50",
          colorMode: "light",
        }),
      );
      expect(button(nodes, "Save workspace brand").props.disabled).toBe(true);
      expect(
        nodes.some((node) => node.type === "button" && content(node) === "Use default live brand"),
      ).toBe(false);
      const preventDefault = vi.fn();
      (nodes.find((node) => node.type === "form")!.props.onSubmit as (event: unknown) => void)({
        preventDefault,
      });
      expect(onSave).not.toHaveBeenCalled();
      expect(preventDefault).toHaveBeenCalledOnce();
    },
  );

  it("preserves both custom legacy colors on mode edits and requires both colors to match a palette", () => {
    const legacy = { organizationName: "Acme", primaryColor: "#183C31", accentColor: "#AC2855" };
    expect(selectedWorkspacePreset(legacy)).toBeUndefined();
    expect(
      selectedWorkspacePreset({ ...brand, primaryColor: "#17334a", accentColor: "#006b80" }),
    ).toBe("ocean");
    hooks.capture = true;
    const onChange = vi.fn();
    const nodes = elements(
      WorkspaceBrandSettings({
        theme: legacy,
        savedTheme: legacy,
        canManage: true,
        entitled: true,
        busy: false,
        onChange,
        onSave: vi.fn(),
        onReset: vi.fn(),
      }),
    );
    expect(button(nodes, "Save workspace brand").props.disabled).toBe(true);
    const modeField = nodes.find(
      (node) => node.type === "fieldset" && content(node).startsWith("Live appearance"),
    )!;
    click(button(elements(modeField), "Dark"));
    expect(onChange).toHaveBeenCalledWith({ ...legacy, colorMode: "dark" });
  });

  it("enforces entitlement and busy gates, and submits an eligible explicit mode draft", () => {
    hooks.capture = true;
    const onSave = vi.fn();
    const props = {
      theme: { ...brand, colorMode: "dark" as const },
      savedTheme: brand,
      canManage: true,
      entitled: true,
      busy: false,
      onChange: vi.fn(),
      onSave,
      onReset: vi.fn(),
    };
    const nodes = elements(WorkspaceBrandSettings(props));
    expect(content(nodes[0])).not.toContain(appearanceMessages("en-CA").brandSaveUnavailable);
    expect(button(nodes, "Save workspace brand").props.disabled).toBe(false);
    const event = { preventDefault: vi.fn() };
    (nodes.find((node) => node.type === "form")!.props.onSubmit as (event: unknown) => void)(event);
    expect(onSave).toHaveBeenCalledWith(event);
    hooks.cursor = 0;
    const unavailable = elements(WorkspaceBrandSettings({ ...props, entitled: false }));
    expect(content(unavailable[0])).toContain(
      "You can preview themes. Saving a live brand is unavailable in this workspace.",
    );
    expect(content(unavailable[0])).not.toContain("A workspace manager can save");
    expect(button(unavailable, "Save workspace brand").props.disabled).toBe(true);
    expect(button(unavailable, "Use default live brand").props.disabled).toBe(false);
    hooks.cursor = 0;
    expect(
      button(elements(WorkspaceBrandSettings({ ...props, busy: true })), "Saving…").props.disabled,
    ).toBe(true);
  });

  it.each([{ primaryColor: "#FFFFFF" }, { accentColor: "#EEEEEE" }, { organizationName: "   " }])(
    "shows invalid brand draft feedback and prevents saving %j",
    (patch) => {
      hooks.capture = true;
      const onSave = vi.fn();
      const nodes = elements(
        WorkspaceBrandSettings({
          theme: { ...brand, ...patch },
          savedTheme: brand,
          canManage: true,
          entitled: true,
          busy: false,
          onChange: vi.fn(),
          onSave,
          onReset: vi.fn(),
        }),
      );
      expect(button(nodes, "Save workspace brand").props.disabled).toBe(true);
      expect(nodes.some((node) => node.props.role === "alert")).toBe(true);
      const event = { preventDefault: vi.fn() };
      (nodes.find((node) => node.type === "form")!.props.onSubmit as (event: unknown) => void)(
        event,
      );
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it("uses resolved real light/dark tokens with distinct canvas colors and primary fills", () => {
    const copy = appearanceMessages("en-CA");
    const styles = (["light", "dark"] as const).map((mode) => {
      const preview = WorkspaceLivePreview({ theme: brand, mode, copy });
      const snapshot = resolveExperienceTheme({
        category: "general",
        presetId: "pops",
        brandTheme: { ...brand, colorMode: mode },
      });
      expect(preview.props.style["--experience-canvas"]).toBe(snapshot.tokens.canvas);
      expect(preview.props.style["--experience-primary-fill"]).toBe(
        snapshot.tokens.primaryFill ?? snapshot.tokens.primary,
      );
      expect(preview.props.style["--experience-accent"]).toBe(snapshot.tokens.accent);
      const html = renderToStaticMarkup(preview);
      expect(html).toContain("482 913");
      expect(html).toContain("Live results");
      expect(html).not.toMatch(/<(button|input|a)[\s>]/);
      return preview.props.style;
    });
    expect(styles[0]["--experience-canvas"]).not.toBe(styles[1]["--experience-canvas"]);
    expect(
      renderToStaticMarkup(<InterfaceWorkspacePreview id="ocean" mode="dark" copy={copy} />),
    ).not.toMatch(/<(button|input|a)[\s>]/);
  });
});
