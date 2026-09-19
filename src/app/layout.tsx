import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARO · Crisis Command Center",
  description:
    "Agentic command center for crisis management in Sierra Bermeja. HappyRobot challenge for HackSpain 2026.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
