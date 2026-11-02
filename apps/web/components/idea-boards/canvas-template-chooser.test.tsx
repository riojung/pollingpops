import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANVAS_TEMPLATE_IDS, getCanvasTemplate, supportedLocales } from "@openround/contracts";
import { canvasTemplateMessages } from "../../lib/i18n/canvas-template-messages";
import {
  canvasTemplateBrowserEnglishMessages,
  canvasTemplateBrowserMessages,
} from "../../lib/i18n/canvas-template-browser-messages";
import { CanvasTemplateChooser } from "./canvas-template-chooser";
const locale = vi.hoisted(() => ({ value: "en-CA" as (typeof supportedLocales)[number] }));
interface Hooks {
  cursor: number;
  slots: unknown[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: locale.value }) }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useId();
      const index = hooks.cursor++;
      hooks.slots[index] ??= `browser-${index}`;
      return hooks.slots[index];
    },
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
  };
});
afterEach(() => {
  mocked.hooks = null;
  locale.value = "en-CA";
});

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join("");
  return isValidElement<Record<string, unknown>>(node)
    ? content(node.props.children as ReactNode)
    : "";
}

function browserHarness(value: (typeof CANVAS_TEMPLATE_IDS)[number] | null = null) {
  const hooks: Hooks = { cursor: 0, slots: [] };
  const onChange = vi.fn();
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      const browser = CanvasTemplateChooser({ value, onChange, browse: true });
      if (!isValidElement<Record<string, unknown>>(browser) || typeof browser.type !== "function")
        throw new Error("Expected the template browser component");
      tree = (browser.type as (props: Record<string, unknown>) => ReactNode)(browser.props);
    } finally {
      mocked.hooks = null;
    }
    return tree;
  };
  const find = (predicate: (element: ReactElement<Record<string, unknown>>) => boolean) => {
    const result = elements(tree).find(predicate);
    if (!result) throw new Error("Expected browser control");
    return result;
  };
  const change = (element: ReactElement<Record<string, unknown>>, next: string) => {
    (element.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: next },
    });
    render();
  };
  const search = (next: string) =>
    change(
      find((element) => element.type === "input"),
      next,
    );
  const chooseCategory = (next: string) =>
    change(
      find((element) => element.type === "select"),
      next,
    );
  const click = (name: string) => {
    const button = find((element) => element.type === "button" && content(element) === name);
    (button.props.onClick as () => void)();
    render();
  };
  const titles = () =>
    elements(tree)
      .filter((element) => element.type === "button" && element.props["aria-labelledby"])
      .map((button) =>
        content(find((element) => element.props.id === button.props["aria-labelledby"])),
      );
  const status = () => content(find((element) => element.props.role === "status"));
  render();
  return {
    render,
    find,
    search,
    chooseCategory,
    click,
    titles,
    status,
    onChange,
    tree: () => tree,
  };
}

describe("starter chooser", () => {
  it.each(supportedLocales)(
    "localizes picker controls and identifies the authored language in %s",
    (value) => {
      locale.value = value;
      const html = renderToStaticMarkup(
        <CanvasTemplateChooser value={null} onChange={() => undefined} />,
      );
      const copy = canvasTemplateMessages(value);
      expect(html).toContain(copy.choose);
      expect(html).toContain(copy.blank);
      expect(html).toContain(copy.english);
      expect(html).toContain('lang="en"');
      expect(html).toContain('aria-pressed="true"');
      expect(html).not.toContain(copy.previewHelp);
    },
  );
  it("keeps every choice named and described while selecting only the requested blank or starter", () => {
    locale.value = "en-CA";
    const onChange = vi.fn();
    const ids = [null, ...CANVAS_TEMPLATE_IDS];
    for (const selected of ids) {
      const tree = CanvasTemplateChooser({ value: selected, onChange });
      const all = elements(tree);
      const buttons = all.filter((element) => element.type === "button");
      expect(buttons).toHaveLength(ids.length);
      expect(buttons.filter((button) => button.props["aria-pressed"])).toHaveLength(1);
      for (const [index, button] of buttons.entries()) {
        const id = ids[index]!;
        const label = all.find((element) => element.props.id === button.props["aria-labelledby"]);
        expect(content(label)).toBe(
          id ? getCanvasTemplate(id).title : canvasTemplateMessages("en-CA").blank,
        );
        const descriptions = String(button.props["aria-describedby"])
          .split(" ")
          .map((reference) => all.find((element) => element.props.id === reference));
        expect(descriptions.every(Boolean)).toBe(true);
        expect(descriptions.map(content).join(" ")).toContain(
          id ? getCanvasTemplate(id).description : canvasTemplateMessages("en-CA").blankHelp,
        );
        expect(button.props.type).toBe("button");
        expect(button.props["aria-pressed"]).toBe(id === selected);
        onChange.mockClear();
        (button.props.onClick as () => void)();
        expect(onChange).toHaveBeenCalledExactlyOnceWith(id);
      }
    }
  });
  it("provides original decorative SVG thumbnails for blank and every starter without remote assets", () => {
    locale.value = "en-CA";
    const html = renderToStaticMarkup(
      <CanvasTemplateChooser value={null} onChange={() => undefined} />,
    );
    for (const id of ["blank", ...CANVAS_TEMPLATE_IDS])
      expect(html).toContain(`data-starter-thumbnail="${id}" aria-hidden="true"`);
    expect(html.match(/data-starter-thumbnail=/g)).toHaveLength(CANVAS_TEMPLATE_IDS.length + 1);
    expect(html).toContain('data-section-color="purple"');
    expect(html).not.toMatch(/<(?:img|image)\b|https?:\/\//);
  });
  it.each(CANVAS_TEMPLATE_IDS)(
    "previews all authored sections and note prompts before creating %s",
    (id) => {
      locale.value = "en-CA";
      const html = renderToStaticMarkup(
        <CanvasTemplateChooser value={id} onChange={() => undefined} />,
      );
      const template = getCanvasTemplate(id);
      expect(html).toContain("<details");
      expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
      expect(html).toContain('<summary aria-labelledby="canvas-starter-preview"');
      expect(html).toContain('aria-describedby="canvas-starter-preview-selection"');
      expect(html).toContain(canvasTemplateMessages("en-CA").previewHelp);
      for (const section of template.sections) {
        expect(html).toContain(section.title);
        expect(html).toContain(section.guidance);
        for (const prompt of section.prompts) expect(html).toContain(prompt);
      }
    },
  );
});

describe("template browsing", () => {
  it("adds browsing only when requested and starts with every starter plus blank", () => {
    const compact = renderToStaticMarkup(
      <CanvasTemplateChooser value={null} onChange={() => undefined} />,
    );
    expect(compact).not.toContain('type="search"');
    expect(compact).not.toContain("<select");
    const browser = browserHarness();
    expect(browser.status()).toBe("9 templates");
    expect(browser.titles()).toEqual([
      "Blank board",
      ...CANVAS_TEMPLATE_IDS.map((id) => getCanvasTemplate(id).title),
    ]);
    const search = browser.find((element) => element.type === "input");
    expect(search.props.type).toBe("search");
    expect(search.props.maxLength).toBe(160);
    expect(content(browser.find((element) => element.type === "label"))).toBe("Search templates");
    expect(browser.onChange).not.toHaveBeenCalled();
  });

  it("searches normalized titles, descriptions, localized use cases and blank", () => {
    const browser = browserHarness();
    browser.search("  ＰＲＯＪＥＣＴ ＫＩＣＫＯＦＦ  ");
    expect(browser.titles()).toEqual(["Project kickoff"]);
    browser.search("OBSERVATIONS");
    expect(browser.titles()).toEqual(["Evidence review"]);
    locale.value = "fr-FR";
    browser.render();
    browser.search("PLANIFICATION DE PROJET");
    expect(browser.titles()).toEqual(["Project kickoff", "Next-step studio"]);
    browser.search("retrospective");
    expect(browser.titles()).toEqual(["Experience retrospective"]);
    browser.search("tableau vierge");
    expect(browser.titles()).toEqual(["Tableau vierge"]);
    expect(browser.status()).toBe("1 modèles");
    expect(browser.onChange).not.toHaveBeenCalled();
  });

  it("keeps desktop and mobile filters synchronized and resets both without selecting a template", () => {
    const browser = browserHarness("flow-to-action");
    const project = browser.find(
      (element) =>
        element.type === "button" &&
        content(element.props.children as ReactNode) === "Project planning2",
    );
    (project.props.onClick as () => void)();
    browser.render();
    expect(browser.find((element) => element.type === "select").props.value).toBe("project");
    expect(browser.titles()).toEqual(["Project kickoff", "Next-step studio"]);
    browser.search("decision");
    expect(browser.status()).toBe("0 templates");
    expect(browser.titles()).toEqual([]);
    expect(content(browser.tree())).toContain("No matching templates");
    expect(
      elements(browser.tree()).filter(
        (element) => element.type === "button" && content(element) === "Reset filters",
      ),
    ).toHaveLength(1);
    browser.click("Reset filters");
    expect(browser.status()).toBe("9 templates");
    expect(browser.find((element) => element.type === "input").props.value).toBe("");
    expect(browser.find((element) => element.type === "select").props.value).toBe("all");
    browser.chooseCategory("learning");
    expect(browser.titles()).toEqual(["Learning reflection"]);
    const selectedCategory = browser.find(
      (element) => element.type === "button" && content(element) === "Learning reflection1",
    );
    expect(selectedCategory.props["aria-pressed"]).toBe(true);
    expect(browser.onChange).not.toHaveBeenCalled();
  });

  it("keeps the selected preview when filtered out and changes only on an explicit starter action", () => {
    const browser = browserHarness("flow-to-action");
    browser.search("project kickoff");
    const preview = elements(browser.tree()).find(
      (element) => element.props.id === "flow-to-action",
    );
    expect(preview).toBeDefined();
    const button = browser.find(
      (element) => element.type === "button" && Boolean(element.props["aria-labelledby"]),
    );
    const descriptions = String(button.props["aria-describedby"]).split(" ");
    expect(descriptions).toHaveLength(2);
    expect(
      descriptions
        .map((id) => content(browser.find((element) => element.props.id === id)))
        .join(" "),
    ).toContain(getCanvasTemplate("project-kickoff").description);
    (button.props.onClick as () => void)();
    expect(browser.onChange).toHaveBeenCalledExactlyOnceWith("project-kickoff");
  });

  it("keeps accessibility references unique when multiple chooser dialogs coexist", () => {
    const html = renderToStaticMarkup(
      <>
        <CanvasTemplateChooser value="project-kickoff" onChange={() => undefined} />
        <CanvasTemplateChooser browse value="project-kickoff" onChange={() => undefined} />
        <CanvasTemplateChooser browse value="flow-to-action" onChange={() => undefined} />
      </>,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
    expect(new Set(ids).size).toBe(ids.length);
    const references = [...html.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g)].flatMap(
      (match) => match[1]!.split(" "),
    );
    expect(references.length).toBeGreaterThan(30);
    expect(references.every((id) => ids.includes(id))).toBe(true);
  });

  it.each(supportedLocales)("provides complete browsing controls in %s", (value) => {
    locale.value = value;
    const copy = canvasTemplateBrowserMessages(value);
    expect(Object.keys(copy)).toEqual(Object.keys(canvasTemplateBrowserEnglishMessages));
    expect(
      Object.values(copy).every((text) => typeof text === "string" && text.trim().length > 0),
    ).toBe(true);
    expect(copy.results).toContain("{count}");
    const html = renderToStaticMarkup(
      <CanvasTemplateChooser browse value={null} onChange={() => undefined} />,
    );
    expect(html).toContain(copy.heading);
    expect(html).toContain(copy.search);
    expect(html).toContain(copy.categories);
    expect(html).toContain(copy.all);
  });
});
