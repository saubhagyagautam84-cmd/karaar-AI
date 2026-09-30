import type { Metadata, Viewport } from "next";
import Link from "next/link";
import DemoBar from "@/components/DemoBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karaar AI",
  description: "Bolo. Pakka Karo. A confirmed record of your spoken agreement.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e8772e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-saffron">Karaar AI</span>
              <span className="hidden text-sm text-muted sm:inline">
                Bolo. Pakka Karo.
              </span>
            </Link>
            <nav className="flex gap-4 text-sm font-medium">
              <Link href="/record" className="hover:text-saffron">
                Record
              </Link>
              <Link href="/dashboard" className="hover:text-saffron">
                Dashboard
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="space-y-2 border-t border-line px-4 py-4 text-center text-xs text-muted">
          <p>
            A confirmed record of your agreement, built on India&apos;s Digital
            Public Infrastructure.
          </p>
          <DemoBar />
        </footer>
      </body>
    </html>
  );
}
