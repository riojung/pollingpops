import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PresentationScenePrototypeLab } from "../../../components/presentation-prototype/scene-prototype";

export const metadata: Metadata = {
  title: "Presentation scene lab",
  robots: { index: false, follow: false },
};

export default function PresentationSceneLabPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PresentationScenePrototypeLab />;
}
