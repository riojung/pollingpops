import type { Metadata } from "next";
import { SolutionsOverviewPage } from "../../components/public-product-pages";

export const metadata: Metadata = {
  title: "Solutions for meetings, teaching, training, and events",
  description:
    "Plan purposeful participation with Polling Pops. Explore practical poll, quiz, Q&A, feedback, and follow-up workflows for your next gathering.",
  alternates: { canonical: "/solutions" },
  openGraph: {
    title: "Find your next audience moment · Polling Pops",
    description:
      "Practical workflows for team meetings, teaching, workshops, events, and town halls.",
    url: "/solutions",
  },
};

export default function SolutionsPage() {
  return <SolutionsOverviewPage />;
}
