import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const fontSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s - ScaleUp Portfolio Reporting",
    default: "ScaleUp Portfolio Reporting",
  },
  description: "Monthly portfolio reporting for ScaleUp Malaysia and its investee companies.",
  applicationName: "ScaleUp Portfolio Reporting",
  // Private, authenticated application.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster richColors closeButton position="top-right" theme="light" />
      </body>
    </html>
  );
}
