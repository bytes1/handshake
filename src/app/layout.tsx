import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handshake — peer-to-peer crypto",
  description: "Buy and sell crypto directly with people using the payment apps you already trust.",
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
