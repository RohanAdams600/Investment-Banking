import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter, Space_Grotesk } from 'next/font/google';
import { brand, pageTitle } from '@ib/core';

import '@ib/ui/tokens.css';
import './globals.css';

/**
 * Typefaces are bound to CSS variables here and referenced by the token system
 * (`packages/ui/src/tokens/typography.ts`). Swapping a face is a change in this
 * file only — no component references a font name directly.
 */
const display = Space_Grotesk({
  subsets: ['latin'],
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
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
