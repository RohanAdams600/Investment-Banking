import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter, Source_Serif_4 } from 'next/font/google';
import { brand, pageTitle } from '@ib/core';

import { SiteFooter } from '@/features/marketing/site-footer';

import '@ib/ui/tokens.css';
import './globals.css';

/**
 * Typefaces are bound to CSS variables here and referenced by the token system
 * (`packages/ui/src/tokens/typography.ts`). Swapping a face is a change in this
 * file only — no component references a font name directly.
 */
/*
 * The display face carries the product's seriousness, and it was wrong.
 *
 * `packages/ui/src/tokens/typography.ts` declares display as a serif — "marketing
 * hero and section headers. Gravitas." — and the app supplied Space Grotesk, a
 * geometric sans that reads as a developer-tools startup. The token's own
 * fallback stack (`ui-serif, Georgia, serif`) had been disagreeing with the
 * loaded font since the first commit.
 *
 * Source Serif 4 was drawn for sustained professional reading and holds up at
 * both 56px in a hero and 20px in a card title. Deliberately not one of the
 * high-contrast display serifs that signal "luxury brand" — this is a document,
 * not a perfume advertisement.
 */
const display = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: {
    default: pageTitle(),
    template: `%s | ${brand.name}`,
  },
  description: brand.tagline,
  openGraph: {
    type: 'website',
    siteName: brand.name,
    url: brand.url,
  },
  twitter: { card: 'summary_large_image' },
  robots: {
    // Placeholder brand and pre-launch content should not be indexed. Flip this
    // via NEXT_PUBLIC_ALLOW_INDEXING once the marketing site is real.
    index: process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true',
    follow: process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      {/*
        The footer is in the root layout rather than per page, because the
        disclosure it carries ("not your broker, not your attorney") is only
        worth anything if it is on every page — including the ones somebody
        lands on from a search result.
      */}
      <body className="flex min-h-screen flex-col font-sans">
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
