import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  DEAL_STRUCTURE_LABELS,
  GROWTH_TREND_LABELS,
  INDUSTRY_PROFILES,
  LISTING_STATUS_LABELS,
  OWNER_DEPENDENCE_LABELS,
  formatBand,
  type IndustryKey,
} from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';

import { FullProfile } from '@/features/listings/full-profile';
import { NdaPanel } from '@/features/listings/nda-panel';
import { loadListing } from '@/features/listings/queries';
import { SaveButton } from '@/features/listings/save-button';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Listing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  if (actor.platformRoles.length === 0) redirect('/onboarding');

  const { listingId } = await params;
  const view = await loadListing(listingId);

  // Indistinguishable from a listing that does not exist. A 403 here would
  // confirm that a business with this id is for sale, which is the fact the
  // whole teaser split exists to withhold.
  if (!view) notFound();

  const { teaser, profile, nda, controls } = view;
  const industry = INDUSTRY_PROFILES[teaser.industry as IndustryKey];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <p className="text-text-muted text-sm">
        <Link href="/listings" className="underline underline-offset-4">
          Back to listings
        </Link>
      </p>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-3xl font-semibold">{teaser.headline}</h1>
            <p className="text-text-muted text-sm">
              {industry?.label ?? teaser.industry}
              {teaser.jurisdictionName ? ` · ${teaser.jurisdictionName}` : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={teaser.status === 'live' ? 'success' : 'neutral'}>
              {LISTING_STATUS_LABELS[teaser.status]}
            </Badge>
            {!controls ? <SaveButton listingId={teaser.id} saved={teaser.saved} /> : null}
          </div>
        </div>

        {controls ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/listings/${teaser.id}/edit`}>Manage this listing</Link>
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {teaser.summary ? (
            <p className="text-text-secondary whitespace-pre-wrap text-sm">{teaser.summary}</p>
          ) : null}

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Row label="Revenue" value={formatBand(teaser.revenueBand)} numeric />
            <Row label="Earnings" value={formatBand(teaser.earningsBand)} numeric />
            <Row label="Asking price" value={formatBand(teaser.askingBand)} numeric />
            <Row label="Structure" value={DEAL_STRUCTURE_LABELS[teaser.dealStructure]} />
            <Row
              label="Employees"
              value={teaser.employeeCount === null ? 'Not stated' : String(teaser.employeeCount)}
              numeric
            />
            <Row
              label="Years trading"
              value={
                teaser.yearsInBusiness === null ? 'Not stated' : String(teaser.yearsInBusiness)
              }
              numeric
            />
            <Row
              label="Growth"
              value={teaser.growthTrend ? GROWTH_TREND_LABELS[teaser.growthTrend] : 'Not stated'}
            />
            <Row
              label="Owner involvement"
              value={
                teaser.ownerDependence
                  ? OWNER_DEPENDENCE_LABELS[teaser.ownerDependence]
                  : 'Not stated'
              }
            />
            <Row
              label="Real estate"
              value={teaser.realEstateIncluded ? 'Included' : 'Not included'}
            />
            {teaser.reasonForSale ? (
              <Row label="Reason for sale" value={teaser.reasonForSale} />
            ) : null}
          </dl>

          <p className="text-text-muted text-xs">
            Figures are ranges as published by the seller, not exact amounts, and Cairn has not
            verified them.
          </p>
        </CardContent>
      </Card>

      {/*
        The gate. `profile` is non-null only because Postgres returned a row,
        which it does only for the seller's side or a buyer with an executed,
        in-force NDA. This page does not decide that; it renders what came back.
      */}
      {controls ? null : <NdaPanel listingId={teaser.id} nda={nda} />}

      {profile ? <FullProfile profile={profile} /> : null}
    </main>
  );
}

function Row({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt className="text-text-muted text-xs">{label}</dt>
      <dd className={numeric ? 'font-mono tabular-nums' : undefined}>{value}</dd>
    </div>
  );
}
