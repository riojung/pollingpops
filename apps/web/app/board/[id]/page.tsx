import type { Metadata } from "next";
import { BoardGuest } from "../../../components/idea-boards/board-guest";

export const metadata: Metadata = {
  title: "Idea board",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function BoardGuestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoardGuest id={id} key={id} />;
}
