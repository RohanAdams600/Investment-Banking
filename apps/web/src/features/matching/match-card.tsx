import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { INDUSTRY_PROFILES, formatBand, matchStrength, type IndustryKey } from '@ib/core';
import { Badge, Card, CardContent } from '@ib/ui';

import { SaveButton } from '@/features/listings/save-button';
import type { MatchedListing } from './types';

/**
 * One ranked match.
 *
 * The score is never shown on its own. The specification is explicit that every
 * "AI recommends" surface shows its reasoning, and the reason is sound: a buyer
 * told a business is an 84% fit and not why is being asked to trust a black box
 * about the largest purchase of their career.
 *
 * The reasons rendered here were redacted when they were written — they are
 * derived from the seller's confidential figures and carry none of them.
 */
export function MatchCard({ match }: { match: MatchedListing }) {
  const { teaser, score, excluded, reasons, exclusionReasons } = match;
  const industry = INDUSTRY_PROFILES[teaser.industry as IndustryKey];

  const positives = reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);

  return (
    <Card className="hover:border-border-default transition-colors">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/listings/${teaser.id}`} className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium">{teaser.headline}</h2>
            <p className="text-text-muted mt-0.5 text-xs">
              {industry?.label ?? teaser.industry}
              {teaser.jurisdictionName ? ` · ${teaser.jurisdictionName}` : ''}
            </p>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={excluded ? 'neutral' : scoreVariant(score)}>
              {excluded ? 'Filtered out' : `${score}% fit`}
            </Badge>
            <SaveButton listingId={teaser.id} saved={teaser.saved} />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-x-4 text-xs">
          <Figure label="Revenue" value={formatBand(teaser.revenueBand)} />
          <Figure label="Earnings" value={formatBand(teaser.earningsBand)} />
          <Figure label="Asking" value={formatBand(teaser.askingBand)} />
        </dl>

        {excluded ? (
          <div className="border-border-subtle border-t pt-3">
            <p className="text-text-muted text-xs">
              Ruled out by limits you set, not by the seller:
            </p>
            <ul className="text-text-secondary mt-1 space-y-0.5 text-xs">
              {exclusionReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : positives.length > 0 ? (
          <div className="border-border-subtle border-t pt-3">
            <h3 className="text-text-muted mb-1 text-xs font-medium">Why this scored well</h3>
            <ul className="text-text-secondary space-y-0.5 text-xs">
              {positives.slice(0, 3).map((reason) => (
                <li key={reason.label}>
                  <span className="font-medium">{reason.label}</span> — {reason.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
          The model's read of what the buyer wrote, kept visually and
          structurally apart from the arithmetic above. Blending the two into one
          number would make neither explainable, and the deterministic half is
          the one that is reproducible.
        */}
        {match.aiRationale ? (
          <div className="border-border-subtle border-t pt-3">
            <h3 className="text-text-muted mb-1 flex items-center gap-1.5 text-xs font-medium">
              <Sparkles className="h-3 w-3" aria-hidden />
              Against your written thesis
              {match.aiScore !== null ? ` — ${match.aiScore}%` : ''}
            </h3>
            <p className="text-text-secondary text-xs">{match.aiRationale}</p>
            <p className="text-text-muted mt-1 text-xs">
              AI-generated from your thesis and the public listing. Informational only.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function scoreVariant(score: number): 'success' | 'info' | 'neutral' {
  // The bands live in @ib/core because the notifier uses the same ones. Two
  // independent 70s is how a product ends up emailing about matches it draws
  // in grey.
  switch (matchStrength(score)) {
    case 'strong':
      return 'success';
    case 'possible':
      return 'info';
    default:
      return 'neutral';
  }
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
