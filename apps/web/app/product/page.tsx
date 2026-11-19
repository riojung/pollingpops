import type { Metadata } from "next";
import { ProductOverviewPage } from "../../components/public-product-pages";

export const metadata: Metadata = {
  title: "Product · Live participation and useful follow-through",
  description:
    "Explore Polling Pops live polls, quizzes, word clouds, Q&A, presentations, Surveys, idea boards, practice, and reports. Find the format for your next session.",
  alternates: { canonical: "/product" },
  openGraph: {
    title: "The Polling Pops toolkit",
    description:
      "Bring people into the conversation and use the evidence to choose what happens next.",
    url: "/product",
  },
};

export default function ProductPage() {
  return <ProductOverviewPage />;
}
