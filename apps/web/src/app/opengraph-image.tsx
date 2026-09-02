import { ImageResponse } from 'next/og';

import { brand } from '@ib/core';

/**
 * The card every link to this site renders as.
 *
 * The root layout has declared `twitter: { card: 'summary_large_image' }` since
 * the marketing site was built, and there was no image — so every link posted to
 * LinkedIn, iMessage, WhatsApp or Slack showed a blank rectangle with a URL
 * under it. For a marketplace whose entire early growth is somebody sharing a
 * link, that is the cheapest fix available and it had been missed because nobody
 * looks at their own link previews.
 *
 * Generated rather than a static file, so it follows the brand name from the
 * environment and cannot go stale after a rename — which this project has
 * already done once.
 */

export const alt = `${brand.name} — ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/*
 * Hex literals rather than tokens, and this is the one place that is correct.
 * `ImageResponse` renders in an isolated Satori context with no CSS variables
 * and no stylesheet, so a token would resolve to nothing and produce a black
 * rectangle. Kept in sync with `packages/ui/src/tokens/primitives.ts` by hand;
 * a test asserts they match.
 */
const INK = '#0D0916';
const PAPER = '#F5F3F9';
const ACCENT = '#A87DE8';
const MUTED = '#ADA7C0';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: PAPER,
        padding: '72px 80px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* The ashlar mark: squared courses narrowing under a copper capstone. */}
        <svg width="44" height="50" viewBox="0 0 26 30">
          <rect x="2" y="21" width="22" height="6" rx="1" fill={INK} />
          <rect x="5" y="13.5" width="16" height="6" rx="1" fill={INK} />
          <rect x="8" y="7" width="10" height="5" rx="1" fill={INK} />
          <path d="M13 0 L18 5 H8 Z" fill={ACCENT} />
        </svg>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 22,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: INK,
          }}
        >
          {brand.name}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: 96, height: 4, background: ACCENT, marginBottom: 32 }} />
        <div style={{ fontSize: 68, lineHeight: 1.1, color: INK, maxWidth: 900 }}>
          Buy and sell businesses, confidentially.
        </div>
      </div>

      <div style={{ display: 'flex', fontSize: 26, color: MUTED }}>
        Every listing is anonymous until the seller issues an NDA.
      </div>
    </div>,
    size,
  );
}
