import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/site";
import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: `${SITE_NAME}: check if a website is down worldwide`, template: `%s | ${SITE_NAME}` },
    description: `${SITE_TAGLINE} Test any website from real home, mobile and data-center connections in dozens of countries, and see exactly where and why it fails.`,
    openGraph: { siteName: SITE_NAME, type: "website" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-page text-ink">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="2" />
                <path d="M2 12h20M12 2c3 3.2 3 16.8 0 20M12 2c-3 3.2-3 16.8 0 20" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
              </svg>
              {SITE_NAME}
            </Link>
            <nav className="text-sm text-ink-2">
              <Link href="/#how-it-works" className="hover:text-ink">
                How it works
              </Link>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">
          {children}
        </main>
        <footer className="border-t border-line py-6 text-center text-xs text-muted">
          <p>
            Measurements by the{" "}
            <a href="https://globalping.io" className="underline hover:text-ink" rel="noopener">
              Globalping
            </a>{" "}
            probe network. Results reflect the probes available at the time of each check.
          </p>
        </footer>
      </body>
    </html>
  );
}
