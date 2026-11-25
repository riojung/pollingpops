import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearningSequenceLab } from "./learning-sequence-lab";

export const metadata: Metadata = {
  title: "Learning sequence lab",
  robots: { index: false, follow: false },
};

export default function LearningSequenceLabPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <LearningSequenceLab />;
}
