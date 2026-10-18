import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handshake — peer-to-peer marketplace",
  description: "Explore peer-to-peer offers with private receipt verification and transparent on-chain settlement.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
