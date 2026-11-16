import type { Metadata } from "next";
import { SharedLibraryReader } from "../../../../components/workspace/library-sharing/shared-reader";

export const metadata: Metadata = {
  title: "Shared library content",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedLibraryReader key={id} shareId={id} />;
}
