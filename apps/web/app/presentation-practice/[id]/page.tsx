import type { Metadata } from "next";
import { PresentationPracticePage } from "../../../components/presentation-practice/practice-page";

export const metadata: Metadata = {
  title: "Private practice assignment",
  description: "A private presentation practice assignment.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: { title: "Practice assignment", description: "A private practice assignment." },
  twitter: { title: "Practice assignment", description: "A private practice assignment." },
};
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PresentationPracticePage key={id} assignmentId={id} />;
}
