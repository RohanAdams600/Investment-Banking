import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  DEAL_STRUCTURE_LABELS,
  GROWTH_TREND_LABELS,
  INDUSTRY_PROFILES,
  LISTING_STATUS_LABELS,
  OWNER_DEPENDENCE_LABELS,
  brand,
  formatBand,
  type IndustryKey,
} from '@ib/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, VerifiedBadge } from '@ib/ui';

import { FullProfile } from '@/features/listings/full-profile';
import { PipelinePanel } from '@/features/pipeline/pipeline-panel';
import { loadPipelineState } from '@/features/pipeline/queries';
import { NdaPanel } from '@/features/listings/nda-panel';
import { listingViews, loadListing } from '@/features/listings/queries';
import { SaveButton } from '@/features/listings/save-button';
import { loadRepresentative } from '@/features/matching/queries';
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

  // Who is selling. The business is anonymous; the person representing it is
  // not — a buyer needs somebody to call, and a deal offered by nobody in
  // particular does not get taken seriously.
  const representative = await loadRepresentative(listingId);

  // Only the seller's side gets this. `listing_pipeline_state()` checks control
  // inside its own body, so a buyer calling it gets nothing — but not asking at
  // all keeps the buyer's page from carrying a shape it has no use for.
  const pipelineSteps = controls ? await loadPipelineState(listingId) : [];

  /*
   * Only fetched for the person who controls the listing. The policy would
   * return zeroes to anybody else anyway, but not asking is clearer than asking
   * and discarding — and it saves a round trip on every buyer's page load.
   */
  const views = controls ? await listingViews(listingId) : null;

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

        {controls && views ? (
          <Card>
            <CardHeader>
              <CardTitle>Who has looked</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="flex gap-10">
                <div>
                  <dt className="text-text-muted text-2xs font-mono uppercase tracking-[0.12em]">
                    Last 30 days
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{views.last30Days}</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-2xs font-mono uppercase tracking-[0.12em]">
                    Last 7 days
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{views.last7Days}</dd>
                </div>
              </dl>
              <p className="text-text-muted text-sm leading-relaxed">
                Page views, not people — the same visitor returning counts twice. Nothing is
                recorded about who looked, deliberately: browsing a confidential marketplace should
                not leave a trail. Buyers never see this number.
              </p>
            </CardContent>
          </Card>
        ) : null}

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

          {teaser.background ? (
            <div className="border-border-subtle space-y-1 border-l-2 pl-4">
              <h3 className="text-text-muted text-xs font-medium uppercase tracking-wide">
                How the business got here
              </h3>
              <p className="text-text-secondary whitespace-pre-wrap text-sm">{teaser.background}</p>
            </div>
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
            Figures are ranges as published by the seller, not exact amounts, and {brand.name} has
            not verified them.
          </p>
        </CardContent>
      </Card>

      {representative && !controls ? (
        <Card>
          <CardHeader>
            <CardTitle>Represented by</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              {representative.fullName ?? 'Seller'}
              {representative.verificationStatus === 'verified' ? <VerifiedBadge /> : null}
            </p>
            {representative.firmName ? (
              <p className="text-text-muted text-sm">{representative.firmName}</p>
            ) : null}
            <p className="text-text-muted text-xs">
              Message them through the deal room once you have signed the confidentiality agreement.
              {brand.name} is the platform, not your broker or your advisor.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/*
        The gate. `profile` is non-null only because Postgres returned a row,
        which it does only for the seller's side or a buyer with an executed,
        in-force NDA. This page does not decide that; it renders what came back.
      */}
      {controls ? null : <NdaPanel listingId={teaser.id} nda={nda} />}

      {/*
        The pipeline's own account of this listing: what is wrong with it, what
        it might be worth, and how many buyers it was scored against. Seller-side
        only — the findings quote the confidential figures back, which is fine
        for the person whose business it is and nobody else.
      */}
      {controls ? <PipelinePanel listingId={teaser.id} steps={pipelineSteps} /> : null}

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
