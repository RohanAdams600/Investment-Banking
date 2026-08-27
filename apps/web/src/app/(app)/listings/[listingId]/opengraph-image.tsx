import { ImageResponse } from 'next/og';
import { INDUSTRY_PROFILES, brand, formatBand, type IndustryKey } from '@ib/core';

import { loadListing } from '@/features/listings/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * The card one listing renders as when somebody shares it.
 *
 * ## What it may say
 *
 * The teaser and nothing else — industry, state, and the published bands. That
 * is not a design constraint, it is the same rule the rest of the product runs
 * on, applied to the one surface that leaves the site entirely. A share card is
 * fetched by LinkedIn, cached by Slack, and rendered to people who have signed
 * nothing; putting a legal name or an exact figure here would defeat the whole
 * confidentiality model in the single place nobody would think to check.
 *
 * `getListingTeaser` returns a `ListingTeaser`, which is a different type from
 * the confidential profile — so the compiler refuses to hand this function a
 * legal name even if somebody tried.
 */

export const alt = 'A business for sale';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#1F2421';
const PAPER = '#F7F4EF';
const COPPER = '#8C5A3C';
const MUTED = '#6A5F50';
const RULE = '#E0D9CD';

export default async function ListingOpengraphImage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;

  /*
   * `loadListing` returns the confidential half too, when the caller has passed
   * the gate. Destructured to the teaser immediately and the rest discarded —
   * and a share card has no session anyway, so the profile is always null here.
   * Reading only the teaser is belt and braces on the one surface that leaves
   * the site.
   */
  const view = isSupabaseConfigured() ? await loadListing(listingId).catch(() => null) : null;
  const teaser = view?.teaser ?? null;

  const industry = teaser ? INDUSTRY_PROFILES[teaser.industry as IndustryKey]?.label : null;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: PAPER,
        padding: '64px 72px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <svg width="34" height="39" viewBox="0 0 26 30">
          <rect x="2" y="21" width="22" height="6" rx="1" fill={INK} />
          <rect x="5" y="13.5" width="16" height="6" rx="1" fill={INK} />
          <rect x="8" y="7" width="10" height="5" rx="1" fill={INK} />
          <path d="M13 0 L18 5 H8 Z" fill={COPPER} />
        </svg>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 18,
            letterSpacing: 5,
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          {brand.name} · Business for sale
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 54, lineHeight: 1.15, color: INK, maxWidth: 1000 }}>
          {teaser?.headline ?? 'A business for sale'}
        </div>
        {industry || teaser?.jurisdictionName ? (
          <div style={{ display: 'flex', fontSize: 26, color: MUTED, marginTop: 20 }}>
            {[industry, teaser?.jurisdictionName].filter(Boolean).join('  ·  ')}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', borderTop: `2px solid ${RULE}`, paddingTop: 28, gap: 64 }}>
        <Figure label="Revenue" value={teaser ? formatBand(teaser.revenueBand) : '—'} />
        <Figure label="Earnings" value={teaser ? formatBand(teaser.earningsBand) : '—'} />
        <Figure label="Asking" value={teaser ? formatBand(teaser.askingBand) : '—'} />
      </div>
    </div>,
    size,
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 15,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 30, color: INK, marginTop: 6 }}>{value}</div>
    </div>
  );
}
