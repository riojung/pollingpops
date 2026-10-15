import type { Metadata } from "next";
import { PublicSessionSummary } from "../../../components/session-summary/public-summary";

export const metadata: Metadata = {
  title: "Session summary",
  description: "An aggregate session summary shared by its organizer.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: { title: "Session summary", description: "An aggregate session summary." },
  twitter: { title: "Session summary", description: "An aggregate session summary." },
};

export default async function SharedSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicSessionSummary shareId={id} />;
}
