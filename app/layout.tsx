import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crisis Command Center",
  description: "Agentic crisis management demo for HackSpain HappyRobot challenge"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
