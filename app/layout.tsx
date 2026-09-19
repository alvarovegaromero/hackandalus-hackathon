import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crisis Command Center",
  description:
    "Agentic command center for crisis management. HappyRobot challenge for HackSpain 2026.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
