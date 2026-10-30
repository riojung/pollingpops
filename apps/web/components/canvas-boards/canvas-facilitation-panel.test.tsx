import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasFacilitationPanel } from "./canvas-facilitation-panel";
import type { useCanvasFacilitation } from "./use-canvas-facilitation";
import { facilitationFixture as initial } from "./canvas-facilitation-test-fixtures";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  state: null as unknown as ReturnType<typeof useCanvasFacilitation>,
  execute: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
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
    useEffect: (effect: ReactModule.EffectCallback, deps?: readonly unknown[]) => {
      if (mocked.hooks) mocked.hooks.effects.push(effect);
      else react.useEffect(effect, deps);
    },
  };
});
vi.mock("./use-canvas-facilitation", () => ({ useCanvasFacilitation: () => mocked.state }));
vi.mock("../navigation-guard", () => ({ useNavigationBlocker: vi.fn() }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, predicate);
      if (result) return result;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  return {
    render(board = canvasBoard) {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      try {
        const root = CanvasFacilitationPanel({
          board,
          selectedIds: [canvasObject.id],
          onPlan: async () => true,
        });
        tree = (root.type as (props: unknown) => ReactNode)(root.props);
      } finally {
        mocked.hooks = null;
      }
      return renderToStaticMarkup(tree);
    },
    button(label: string) {
      const result = find(tree, (node) => node.type === "button" && node.props.children === label);
      if (!result) throw new Error(`Missing button ${label}`);
      return result.props;
    },
    textarea() {
      return find(tree, (node) => node.type === "textarea")!.props;
    },
    form() {
      return find(tree, (node) => node.type === "form")!.props;
    },
  };
}
async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.resetAllMocks();
  mocked.state = {
    view: initial,
    loading: false,
    saving: false,
    error: null,
    failure: null,
    refresh: vi.fn(),
    execute: mocked.execute,
    discard: mocked.discard,
  };
});
afterEach(() => {
  mocked.hooks = null;
});
describe("facilitation role controls and retained drafts", () => {
  it("keeps comments plain, lets members edit only their own messages, and gives viewers no mutation controls", () => {
    const view = harness();
    mocked.state.view = {
      ...initial,
      actorId: initial.boardId,
      threads: [
        {
          ...initial.threads[0]!,
          messages: [{ ...initial.threads[0]!.messages[0]!, text: "<script>private()</script>" }],
        },
      ],
      capabilities: {
        comment: false,
        moderateComments: false,
        controlTimer: false,
        saveVersion: false,
        deleteVersion: false,
      },
    };
    const html = view.render();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(">Edit</button>");
    expect(html).not.toContain(">Delete</button>");
    expect(html).not.toContain(">Resolve</button>");
    expect(html).not.toContain(">Comment on selected object</button>");
    (view.button("Timer").onClick as () => void)();
    expect(view.render()).not.toContain(">Start timer</button>");
    (view.button("Saved versions").onClick as () => void)();
    const versions = view.render();
    expect(versions).toContain(">Preview</button>");
    expect(versions).not.toContain(">Save version</button>");
    expect(versions).not.toContain(">Delete saved version</button>");
  });
  it("retains failed local text through conflict, role loss and anchor deletion until explicit discard", async () => {
    const view = harness();
    view.render();
    (view.button("Comment on selected object").onClick as () => void)();
    view.render();
    (view.textarea().onChange as (event: unknown) => void)({
      target: { value: "My unsent proposal" },
    });
    view.render();
    mocked.execute.mockImplementation(async (command) => {
      mocked.state.failure = {
        id: canvasBoard.id,
        operation: { schemaVersion: 1, operationId: initial.versions[0]!.id, command },
        conflict: true,
      };
      return false;
    });
    (view.form().onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    await settle();
    expect(view.render()).toContain("My unsent proposal");
    expect(view.textarea().readOnly).toBe(true);
    expect(view.button("Review and resend").disabled).toBe(false);
    mocked.state.view = { ...initial, capabilities: { ...initial.capabilities, comment: false } };
    view.render();
    expect(view.button("Review and resend").disabled).toBe(true);
    expect(view.textarea().value).toBe("My unsent proposal");
    const html = view.render({ ...canvasBoard, objects: [] });
    expect(html).toContain("Object no longer available.");
    expect(view.textarea().value).toBe("My unsent proposal");
    (view.button("Discard draft").onClick as () => void)();
    expect(view.render()).not.toContain("My unsent proposal");
    expect(mocked.discard).toHaveBeenCalled();
    expect(mocked.execute).toHaveBeenCalledOnce();
  });
});
