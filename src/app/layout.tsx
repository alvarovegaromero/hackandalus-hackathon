import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Butterfish · Coordinación de crisis",
  description: "Panel de supervisión e intervención humana — HackSpain 2026",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
