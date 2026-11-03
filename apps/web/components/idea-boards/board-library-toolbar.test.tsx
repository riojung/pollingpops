import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { BoardLibraryToolbar, type BoardLibraryToolbarProps } from "./board-library-toolbar";
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ t: (key: keyof typeof english) => english[key] ?? key }),
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
function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}
function harness(overrides: Partial<BoardLibraryToolbarProps> = {}) {
  const onScopeChange = vi.fn(),
    onSearchChange = vi.fn(),
    onCreate = vi.fn();
  const props: BoardLibraryToolbarProps = {
    scope: "all",
    search: "",
    canCreate: true,
    onScopeChange,
    onSearchChange,
    onCreate,
    ...overrides,
  };
  const tree = BoardLibraryToolbar(props);
  return {
    onScopeChange,
    onSearchChange,
    onCreate,
    html: renderToStaticMarkup(tree),
    button(label: string) {
      const button = find(
        tree,
        (element) =>
          element.type === "button" && textOf(element.props.children as ReactNode) === label,
      );
      if (!button) throw new Error("Missing button: " + label);
      return button.props;
    },
    input: find(tree, (element) => element.type === "input")!.props,
    form: find(tree, (element) => element.type === "form")!.props,
  };
}
describe("board library toolbar", () => {
  it("keeps named scope controls, search landmark and creation in one toolbar", () => {
    const view = harness({ scope: "shared", search: "Planning" });
    expect(view.html).toContain('role="toolbar" aria-label="Idea boards"');
    expect(view.html).toContain('role="search" aria-label="Search boards"');
    expect(view.button("All boards")["aria-pressed"]).toBe(false);
    expect(view.button("Shared with me")["aria-pressed"]).toBe(true);
    for (const label of ["All boards", "Owned", "Shared with me", "Archived", "New board"])
      expect(view.button(label).type).toBe("button");
    expect(view.input.maxLength).toBe(160);
    expect(view.input.value).toBe("Planning");
  });
  it("forwards scope and raw search changes without altering query behavior or submitting a page", () => {
    const view = harness();
    (view.button("Owned").onClick as () => void)();
    expect(view.onScopeChange).toHaveBeenCalledWith("owned");
    (view.input.onChange as (event: unknown) => void)({ target: { value: "  Étude planning  " } });
    expect(view.onSearchChange).toHaveBeenCalledWith("  Étude planning  ");
    const preventDefault = vi.fn();
    (view.form.onSubmit as (event: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
  it("focuses the persistent New board opener before creation captures its return target", () => {
    const ref = { current: null },
      order: string[] = [];
    const onCreate = vi.fn(() => order.push("create"));
    const view = harness({ createButtonRef: ref, onCreate });
    expect(view.button("New board").ref).toBe(ref);
    (view.button("New board").onClick as (event: unknown) => void)({
      currentTarget: { focus: () => order.push("focus") },
    });
    expect(order).toEqual(["focus", "create"]);
    expect(onCreate).toHaveBeenCalledOnce();
  });
  it("disables mutations while busy and omits creation when the workspace cannot create", () => {
    const view = harness({ disabled: true });
    for (const label of ["All boards", "Owned", "Shared with me", "Archived", "New board"])
      expect(view.button(label).disabled).toBe(true);
    expect(view.input.disabled).toBe(true);
    (view.button("Owned").onClick as () => void)();
    (view.input.onChange as (event: unknown) => void)({ target: { value: "ignored" } });
    const focus = vi.fn();
    (view.button("New board").onClick as (event: unknown) => void)({ currentTarget: { focus } });
    expect(view.onScopeChange).not.toHaveBeenCalled();
    expect(view.onSearchChange).not.toHaveBeenCalled();
    expect(view.onCreate).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(harness({ canCreate: false }).html).not.toContain("New board");
  });
});
