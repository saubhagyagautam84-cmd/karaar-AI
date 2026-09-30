import type { Metadata, Viewport } from "next";
import "@fontsource-variable/rubik";
import "@fontsource-variable/dm-sans";
import { AgreementsProvider } from "@/lib/store";
import { ServiceWorker } from "@/components/ServiceWorker";
import { A11yScript } from "@/components/A11y";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Karaar AI · Bolo. Pakka Karo.", template: "%s · Karaar AI" },
  description: "Voice-first, verifiable agreements for Bharat's informal workforce, built on India's Digital Public Infrastructure.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Karaar AI", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#FFFDF9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <A11yScript />
      </head>
      <body className="font-sans">
        <ServiceWorker />
        <AgreementsProvider>{children}</AgreementsProvider>
      </body>
    </html>
  );
}
