import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crisis Command Center",
  description: "Centro de mando agéntico para la gestión de crisis. Reto HappyRobot de HackSpain 2026."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
