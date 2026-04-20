import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { siteConfig } from "@/config/site";
import CustomCursor from "@/components/CustomCursor";

import SkipLink from "@/components/SkipLink";

const outfit = Outfit({ 
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: `${siteConfig.name} | ${siteConfig.tagline}`,
  description: siteConfig.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={{ backgroundColor: '#020617', colorScheme: 'dark' }}>
      <body 
        className={`${outfit.className} bg-slate-950 text-slate-50 antialiased`}
        style={{ backgroundColor: '#020617' }}
      >
        <SkipLink />
        <CustomCursor />
        {children}
      </body>
    </html>
  );
}
