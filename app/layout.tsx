import type { Metadata } from "next";
import "./globals.css";
import { SITE_NAME, resolveSiteUrl } from "@/lib/site";

const description = "Sell sponsor positions on your race kit. Numbered, priced, first come. Paid by card or USDC.";

export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteUrl()),
  title: SITE_NAME,
  description,
  openGraph: { type: "website", url: "/", siteName: SITE_NAME, title: SITE_NAME, description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,75..125,400..900;1,75..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <span className="reg tl"><span /></span>
        <span className="reg tr"><span /></span>
        <span className="reg bl"><span /></span>
        <span className="reg br"><span /></span>
        {children}
      </body>
    </html>
  );
}
