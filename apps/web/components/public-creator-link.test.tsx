import type { MouseEvent, ReactElement } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: null as boolean | null,
  pending: { current: null as Promise<boolean> | null },
  effect: null as (() => (() => void) | undefined) | null,
  api: vi.fn(),
  assign: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useState: () => [
    state.authenticated,
    (value: boolean | null) => {
      state.authenticated = value;
    },
  ],
  useRef: () => state.pending,
  useEffect: (effect: () => (() => void) | undefined) => {
    state.effect = effect;
  },
}));
vi.mock("../lib/api", () => ({
  apiFetch: state.api,
  AUTH_CHANGE_EVENT: "pollingpops:auth-change",
  SESSION_EXPIRED_EVENT: "pollingpops:session-expired",
  SESSION_LOGOUT_EVENT: "pollingpops:session-logout",
}));

import { PublicCreatorLink, publicCreatorDestination } from "./public-creator-link";
import { PUBLIC_PRODUCT_CTA_HREF } from "../lib/public-product-content";
import {
  publicExampleContinueHref,
  publicExamples,
  publicExampleDestination,
} from "../lib/public-examples";

type LinkProps = { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => Promise<void> };
let cleanup: (() => void) | undefined;
function link(href = PUBLIC_PRODUCT_CTA_HREF) {
  return PublicCreatorLink({ href, children: "Continue" }) as ReactElement<LinkProps>;
}
function click() {
  return {
    button: 0,
    currentTarget: { isConnected: true },
    preventDefault: vi.fn(),
  } as unknown as MouseEvent<HTMLAnchorElement>;
}

describe("session-aware public creator links", () => {
  beforeEach(() => {
    state.authenticated = null;
    state.pending.current = null;
    state.effect = null;
    state.api.mockReset();
    state.assign.mockReset();
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { location: { assign: state.assign } }),
    );
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
  });

  it("keeps the guest signup continuation available in initial HTML", () => {
    expect(
      renderToStaticMarkup(
        <PublicCreatorLink href={PUBLIC_PRODUCT_CTA_HREF}>Create</PublicCreatorLink>,
      ),
    ).toContain('href="/signin?mode=signup&amp;returnTo=%2Fcreate"');
    expect(state.api).not.toHaveBeenCalled();
  });

  it("uses /create after resolving an existing session", async () => {
    state.api.mockResolvedValue({});
    link();
    cleanup = state.effect?.();
    await state.pending.current;
    expect(link().props.href).toBe("/create");
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("retains a guest's exact template continuation", async () => {
    state.api.mockRejectedValue({ status: 401 });
    const href = publicExampleContinueHref(publicExamples[0]!);
    link(href);
    cleanup = state.effect?.();
    await state.pending.current;
    expect(link(href).props.href).toBe(href);
  });

  it("preserves every selected source, collection and board destination for existing sessions", async () => {
    state.authenticated = true;
    for (const example of publicExamples) {
      expect(link(publicExampleContinueHref(example)).props.href).toBe(
        publicExampleDestination(example),
      );
    }
  });

  it("waits for the session on a quick click instead of restarting authentication", async () => {
    let resolve!: (value: unknown) => void;
    state.api.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const rendered = link();
    cleanup = state.effect?.();
    const event = click();
    const navigation = rendered.props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(state.assign).not.toHaveBeenCalled();
    resolve({});
    await navigation;
    expect(state.assign).toHaveBeenCalledWith("/create");
  });

  it("rechecks changed authentication and falls back to sign-in", async () => {
    state.api.mockResolvedValueOnce({}).mockRejectedValueOnce({ status: 401 });
    link();
    cleanup = state.effect?.();
    await state.pending.current;
    expect(link().props.href).toBe("/create");
    window.dispatchEvent(new Event("pollingpops:auth-change"));
    await state.pending.current;
    expect(link().props.href).toBe(PUBLIC_PRODUCT_CTA_HREF);
  });

  it("does not restore a session from a late response after expiry", async () => {
    let resolve!: (value: unknown) => void;
    state.api.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    link();
    cleanup = state.effect?.();
    const oldRequest = state.pending.current;
    window.dispatchEvent(new Event("pollingpops:session-expired"));
    resolve({});
    await oldRequest;
    expect(link().props.href).toBe(PUBLIC_PRODUCT_CTA_HREF);
  });

  it("waits for a pending focus refresh after signing in in another tab", async () => {
    let resolve!: (value: unknown) => void;
    state.api.mockRejectedValueOnce({ status: 401 }).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    link();
    cleanup = state.effect?.();
    await state.pending.current;
    expect(state.authenticated).toBe(false);
    window.dispatchEvent(new Event("focus"));
    const event = click();
    const navigation = link().props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(state.assign).not.toHaveBeenCalled();
    resolve({});
    await navigation;
    expect(state.assign).toHaveBeenCalledWith("/create");
  });

  it.each([
    "/examples",
    "/signin?returnTo=https%3A%2F%2Fevil.example",
    "/signin?returnTo=%2F%2Fevil.example",
    "/signin?returnTo=%2Fcreate&returnTo=%2Faccount",
  ])("does not skip sign-in for an invalid or unrelated continuation: %s", (href) => {
    expect(publicCreatorDestination(href)).toBeNull();
  });
});
