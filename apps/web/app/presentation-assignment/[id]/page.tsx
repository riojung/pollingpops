import type { Metadata } from "next";
import { PresentationAssignmentPage } from "../../../components/presentation-assignments/assignment-page";
export const metadata: Metadata = {
  title: "Private reading assignment",
  description: "A private presentation reading assignment.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: { title: "Reading assignment", description: "A private reading assignment." },
  twitter: { title: "Reading assignment", description: "A private reading assignment." },
};
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PresentationAssignmentPage key={id} assignmentId={id} />;
}
