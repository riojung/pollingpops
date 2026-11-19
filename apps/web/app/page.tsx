import type { Metadata } from "next";
import { PublicHome } from "../components/public-home";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export const metadata: Metadata = {
  title: "Polling Pops — Make every voice pop.",
  description:
    "Bring people into the conversation with live polls, quizzes, Q&A, word clouds, interactive presentations, surveys, and idea boards. Join in a browser without a participant account.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <PublicHome />
      </main>
      <SiteFooter />
    </>
  );
}
