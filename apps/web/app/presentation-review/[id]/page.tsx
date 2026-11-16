import type { Metadata } from "next";
import { PresentationReviewPage } from "../../../components/presentation-sharing/review-page";
export const metadata: Metadata = {
  title: "Private presentation review",
  description: "A presentation shared for private review.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: { title: "Presentation review", description: "A privately shared presentation." },
  twitter: { title: "Presentation review", description: "A privately shared presentation." },
};
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PresentationReviewPage key={id} shareId={id} />;
}
