import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./_components/nav";

export const metadata: Metadata = {
  title: "GapAudit — Service Gap Console",
  description: "Audits completed AI support work for unresolved customer and operational gaps",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
