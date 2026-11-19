"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LocalReturnPathSchema } from "@openround/contracts";
import { apiFetch, AUTH_CHANGE_EVENT } from "../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../lib/idle-session";

/** Only explicit, validated sign-in continuations can skip the sign-in page. */
export function publicCreatorDestination(href: string): string | null {
  if (!href.startsWith("/signin?")) return null;
  const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
  const destinations = query.getAll("returnTo");
  if (destinations.length !== 1) return null;
  const result = LocalReturnPathSchema.safeParse(destinations[0]);
  return result.success ? result.data : null;
}

/** Keep guest continuations usable before hydration and resume authenticated creators directly. */
export function PublicCreatorLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const destination = publicCreatorDestination(href);
  const needsSession = destination !== null;
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!needsSession) return;
    let active = true;
    let version = 0;
    function check() {
      const current = ++version;
      const request = apiFetch("/v1/auth/me").then(
        () => true,
        () => false,
      );
      pending.current = request;
      void request.then((signedIn) => {
        if (active && current === version) setAuthenticated(signedIn);
      });
    }
    function expired() {
      version += 1;
      pending.current = Promise.resolve(false);
      setAuthenticated(false);
    }
    check();
    window.addEventListener(AUTH_CHANGE_EVENT, check);
    window.addEventListener("focus", check);
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    window.addEventListener(SESSION_LOGOUT_EVENT, expired);
    return () => {
      active = false;
      window.removeEventListener(AUTH_CHANGE_EVENT, check);
      window.removeEventListener("focus", check);
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
      window.removeEventListener(SESSION_LOGOUT_EVENT, expired);
    };
  }, [needsSession]);

  return (
    <Link
      className={className}
      href={authenticated && destination ? destination : href}
      onClick={async (event) => {
        if (
          !destination ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        // Read the latest request even when a focus/auth-change refresh is still in flight.
        event.preventDefault();
        const anchor = event.currentTarget;
        let request = pending.current;
        let signedIn = request ? await request : false;
        while (pending.current && pending.current !== request) {
          request = pending.current;
          signedIn = await request;
        }
        if (anchor.isConnected) window.location.assign(signedIn ? destination : href);
      }}
    >
      {children}
    </Link>
  );
}
