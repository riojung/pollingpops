import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "Polling Pops Admin",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
