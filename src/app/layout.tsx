import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARO · SKETCH Dashboard",
  description:
    "Prototype crisis dashboard with demo scenario data and partially connected controls.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <aside
          aria-label="Prototype notice"
          className="border-b-2 border-amber-700 bg-amber-100 px-4 py-3 text-amber-950"
        >
          <p className="font-bold tracking-wide">SKETCH — Prototype dashboard</p>
          <p className="text-sm">
            Exploratory interface with demo scenario data and partially connected controls. Not an
            operational emergency response system.
          </p>
        </aside>
        {children}
      </body>
    </html>
  );
}
