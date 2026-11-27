import type { Metadata } from "next";
import { libraryScope } from "../../../../components/workspace/library-sharing/client";
import { SharedLibraryReader } from "../../../../components/workspace/library-sharing/shared-reader";
import { readLibraryDateRange } from "../../../../lib/library-controls";

export const metadata: Metadata = {
  title: "Shared library content",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { scope, dateFrom, dateTo }] = await Promise.all([params, searchParams]);
  const sourceScope = libraryScope(typeof scope === "string" ? scope : null);
  const dateRange = readLibraryDateRange(
    new URLSearchParams({
      dateFrom: typeof dateFrom === "string" ? dateFrom : "",
      dateTo: typeof dateTo === "string" ? dateTo : "",
    }),
  );
  return (
    <SharedLibraryReader
      key={id}
      shareId={id}
      returnContext={{ scope: sourceScope === "workspace" ? "shared" : sourceScope, dateRange }}
    />
  );
}
