import type { Metadata } from "next";
import "./globals.css";
import "./landing.css";

const title = "Far0 · When danger shifts, help must follow.";
const description =
  "Far0 helps emergency teams adapt priorities and coordinate resources as a crisis evolves, keeping people at risk at the center of the response. HackSpain 2026.";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "Far0",
    images: [
      {
        url: "/media/faro-poster.jpg",
        width: 1920,
        height: 1080,
        alt: "Far0 lighthouse with a green beam",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/media/faro-poster.jpg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="lp">{children}</div>
      </body>
    </html>
  );
}
