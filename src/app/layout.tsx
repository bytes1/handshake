import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handshake — peer-to-peer demo marketplace",
  description: "Use the Handshake Preview testnet marketplace and verify demo receipt emails.",
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
