import type { Metadata } from "next";
import "./globals.css";
import "./dashboard-theme.css";

export const metadata: Metadata = {
  title: "Dashboard | Far0",
  description:
    "Prototype crisis dashboard with demo scenario data and partially connected controls.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
