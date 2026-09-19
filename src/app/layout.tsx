import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Butterfish · Crisis Coordination",
  description: "Human supervision and intervention dashboard — HackSpain 2026",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
