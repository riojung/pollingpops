"use client";

import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { GuardedLink } from "./navigation-guard";

type NavigationLinkProps = ComponentProps<typeof GuardedLink> & {
  match?: "exact" | "section";
};

/** Keep navigation as a native link while exposing the current destination. */
export function NavigationLink({
  className,
  href,
  match = "exact",
  ...props
}: NavigationLinkProps) {
  const pathname = usePathname();
  const target = typeof href === "string" ? href.split(/[?#]/, 1)[0] : href.pathname;
  const fragment = typeof href === "string" ? href.includes("#") : Boolean(href.hash);
  const current =
    !fragment &&
    Boolean(
      pathname &&
      target &&
      (pathname === target || (match === "section" && pathname.startsWith(`${target}/`))),
    );

  return (
    <GuardedLink
      {...props}
      aria-current={props["aria-current"] ?? (current ? "page" : undefined)}
      className={["navigation-control", className].filter(Boolean).join(" ")}
      href={href}
    />
  );
}
