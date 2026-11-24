import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND_NAME } from "@/lib/appBrand";

export const metadata: Metadata = {
  title: BRAND_NAME,
  applicationName: BRAND_NAME,
  description: "Create images and videos with the best AI models, in one place.",
  openGraph: { siteName: BRAND_NAME },
};

export const viewport: Viewport = { themeColor: "#0b0b10" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
