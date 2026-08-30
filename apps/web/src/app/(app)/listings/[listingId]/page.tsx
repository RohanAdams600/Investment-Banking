import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
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
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  VerifiedBadge,
} from '@ib/ui';

import { ListingAnalytics } from '@/features/analytics/listing-analytics';
import { listingAnalytics } from '@/features/analytics/queries';
import { FullProfile } from '@/features/listings/full-profile';
import { PipelinePanel } from '@/features/pipeline/pipeline-panel';
import { loadPipelineState } from '@/features/pipeline/queries';
import { NdaPanel } from '@/features/listings/nda-panel';
import { listingViews, loadListing } from '@/features/listings/queries';
import { SaveButton } from '@/features/listings/save-button';
import { loadRepresentative } from '@/features/matching/queries';
import { getActor } from '@/lib/auth/actor';
import {
  requireConfidentialAssurance,
  StepUpRequiredError,
  STEP_UP_ACTIONS,
} from '@/lib/auth/assurance';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Listing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/*
 * The tabs, and what decides which exist.
 *
 * Documents and Activity are seller-side: the vault and the pipeline both quote
 * the confidential figures back, which is right for the person whose business it
 * is and wrong for anybody else. A buyer sees Overview and Financials, and
 * Financials is empty until their NDA is executed — the page renders what
 * Postgres returned rather than deciding for itself.
 */
type TabKey = 'overview' | 'financials' | 'activity';

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  const query = await searchParams;
  const requested = typeof query.tab === 'string' ? query.tab : 'overview';

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'financials', label: 'Financials' },
    /*
     * No Documents tab, deliberately. The vault is per-deal, not per-listing —
     * it lives at /deals/[dealId]/documents because a document is released to a
     * specific counterparty under a specific agreement, not published against a
     * listing. A tab here would have nothing to render, and an empty tab is
     * worse than an absent one: it promises a place to put things.
     */
    ...(controls
      ? ([{ key: 'activity', label: 'Activity' }] as { key: TabKey; label: string }[])
      : []),
  ];

  // An unknown or unauthorised tab falls back rather than 404ing. A stale link
  // to a tab that no longer applies to you should show the listing, not an
  // error — and it must not reveal that the tab exists for somebody else.
  const tab: TabKey = tabs.some((t) => t.key === requested) ? (requested as TabKey) : 'overview';

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

  /*
   * Seller-side only, and only on the tab that draws it — the daily series is
   * thirty rows plus every NDA on the listing, which is not worth fetching to
   * render an Overview tab that does not show it.
   */
  const analytics = controls && tab === 'activity' ? await listingAnalytics(listingId) : null;

  /*
   * A second factor before somebody else's confidential half.
   *
   * Only for a buyer. A seller looking at their own financials is not reaching
   * anyone else's data, and making them re-authenticate to read their own
   * business would be friction with nothing behind it.
   *
   * The database has already decided whether `profile` exists at all — this
   * does not widen or narrow that. It decides whether a session that is
   * entitled to the row is trusted enough to render it, which is a different
   * question and the one a stolen cookie fails.
   */
  let confidentialChallenge: { message: string; canStepUp: boolean } | null = null;
  if (profile && !controls) {
    try {
      await requireConfidentialAssurance(STEP_UP_ACTIONS.confidentialProfile);
    } catch (error) {
      if (!(error instanceof StepUpRequiredError)) throw error;
      confidentialChallenge = { message: error.message, canStepUp: error.canStepUp };
    }
  }

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

      <Tabs
        tabs={tabs}
        active={tab}
        basePath={`/listings/${teaser.id}`}
        as={Link}
        className="mt-2"
      />

      {tab === 'overview' ? (
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
                <p className="text-text-secondary whitespace-pre-wrap text-sm">
                  {teaser.background}
                </p>
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
      ) : null}

      {tab === 'overview' && representative && !controls ? (
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
      {tab === 'overview' && !controls ? <NdaPanel listingId={teaser.id} nda={nda} /> : null}

      {/*
        The pipeline's own account of this listing: what is wrong with it, what
        it might be worth, and how many buyers it was scored against. Seller-side
        only — the findings quote the confidential figures back, which is fine
        for the person whose business it is and nobody else.
      */}
      {tab === 'activity' && controls ? (
        <div className="space-y-6">
          {/*
            The numbers first, the pipeline's narrative second. A seller opening
            this tab wants to know whether anything is happening before they
            want to know what the matcher thought about it.
          */}
          {analytics ? <ListingAnalytics analytics={analytics} /> : null}
          <PipelinePanel listingId={teaser.id} steps={pipelineSteps} />
        </div>
      ) : null}

      {/*
        The gate. `profile` is non-null only because Postgres returned a row,
        which it does only for the seller's side or a buyer holding an executed,
        in-force NDA. The tab decides where it appears; it does not decide
        whether the caller may see it.
      */}
      {tab === 'financials' ? (
        profile && confidentialChallenge ? (
          <Card>
            <CardContent className="space-y-3 py-10">
              <h2 className="font-display text-lg font-semibold">
                {confidentialChallenge.canStepUp
                  ? 'Confirm it is you'
                  : 'Two-factor authentication required'}
              </h2>
              <p className="text-text-secondary max-w-xl text-sm leading-relaxed">
                {confidentialChallenge.message}
              </p>
              <Button asChild>
                <Link href="/settings/security">
                  {confidentialChallenge.canStepUp ? 'Confirm' : 'Set it up'}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : profile ? (
          <FullProfile profile={profile} />
        ) : (
          <Card>
            <CardContent className="space-y-2 py-10">
              <h2 className="font-display text-lg font-semibold">
                Behind the confidentiality gate
              </h2>
              <p className="text-text-secondary max-w-xl text-sm leading-relaxed">
                The exact financials, the company name and the customer detail open once the seller
                has issued you a confidentiality agreement and you have signed it. Request access
                from the Overview tab.
              </p>
            </CardContent>
          </Card>
        )
      ) : null}
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
