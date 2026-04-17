import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { siteConfig } from "@/config/site";
import CustomCursor from "@/components/CustomCursor";

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
    <html lang="en" className="dark">
      <body className={`${outfit.className} bg-slate-950 text-slate-50 antialiased`}>
        <CustomCursor />
        {children}
      </body>
    </html>
  );
}
