import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qudani Rekod",
  description: "Report harian dan rekod modal bulanan.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ms">
      <body className="antialiased">{children}</body>
    </html>
  );
}
