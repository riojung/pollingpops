import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { englishMessages, translate, type MessageKey } from "../../lib/i18n/catalog";

type Disclosure = { open: boolean };
type CapturedLink = {
  href: string;
  onClick?: (event: { currentTarget: { closest: (selector: string) => Disclosure } }) => void;
  onNavigate?: () => void;
};
const capture = vi.hoisted(() => ({ links: [] as CapturedLink[] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/results" }));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: MessageKey) => translate(englishMessages, key) }),
}));
vi.mock("./workspace-provider", () => ({ useWorkspace: () => ({ productFeatures: {} }) }));
vi.mock("../navigation-guard", () => ({
  useConfirmNavigation: () => () => true,
  GuardedLink: ({ children, ...props }: CapturedLink & { children?: ReactNode }) => {
    capture.links.push(props);
    return <a href={props.href}>{children}</a>;
  },
}));

import { WorkspaceNav } from "./workspace-shell";
beforeEach(() => {
  capture.links = [];
});
describe("mobile More navigation", () => {
  it("keeps the focused destination visible until guarded navigation is accepted", () => {
    renderToStaticMarkup(<WorkspaceNav mobile />);
    const link = capture.links.find((item) => item.href === "/results");
    expect(link).toBeDefined();
    const disclosure = { open: true };
    link!.onClick!({ currentTarget: { closest: () => disclosure } });
    // A cancelled GuardedLink does not invoke onNavigate: focus remains in the open menu.
    expect(disclosure.open).toBe(true);
    link!.onNavigate!();
    expect(disclosure.open).toBe(false);
  });
});
