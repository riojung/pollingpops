"use client";

import {
  LibraryDiscovery,
  type LibraryManagementType,
} from "../library-discovery/library-discovery";
import type { SharedLibraryScope } from "./client";

/** Shared discovery keeps each share's authoritative resource-specific actions. */
export function SharedLibrary({
  scope,
  type = "all",
}: {
  scope: SharedLibraryScope;
  type?: LibraryManagementType;
}) {
  return <LibraryDiscovery scope={scope} type={type} />;
}
