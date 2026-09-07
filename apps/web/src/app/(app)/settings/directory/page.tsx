import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can, pageTitle } from '@ib/core';

import { FirmProfileForm, type ProfileDraft } from '@/features/brokers/profile-form';
import { getActor } from '@/lib/auth/actor';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = { title: pageTitle('Directory profile') };

/*
 * Dynamic: it reads the session and the firm's own row, and the enforcing
 * nonce CSP requires a dynamic render anyway.
 */
export const dynamic = 'force-dynamic';

/**
 * Where a firm writes its directory entry.
 *
 * The public half of the directory shipped without this, which meant the table
 * had no way to be filled and the directory could never populate. Worth naming
 * rather than quietly adding: a read surface without its write surface is not a
 * half-built feature, it is a feature that cannot work.
 *
 * Reached from settings rather than from a top-level nav item. A firm edits this
 * once and then rarely, which is exactly what settings is for, and the bar is
 * already at its cap.
 */
export default async function DirectoryProfilePage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  /*
   * A firm administrator, and the database agrees.
   *
   * This check decides what to render; the policy on `firm_profiles` decides
   * what may be written. Both, deliberately: without the first, somebody with a
   * buy-side role sees a form that will fail, which reads as a broken product
   * rather than as a permission.
   */
  const administered = actor.firmMemberships.filter(
    (m) => m.role === 'owner' || m.role === 'admin',
  );

  if (administered.length === 0 || !can(actor, 'listing:manage_for_client')) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-6 py-12">
        <h1 className="text-2xl font-semibold">Directory profile</h1>
        <p className="text-text-secondary text-sm leading-relaxed">
          The directory lists firms that run deals for clients, and a profile is written by somebody
          who administers the firm. If you advise on deals and have not set a firm up yet, pick the
          intermediary role in{' '}
          <Link href="/onboarding" className="text-accent underline underline-offset-4">
            onboarding
          </Link>{' '}
          and create one — then this page is yours.
        </p>
      </main>
    );
  }

  const firmId = administered[0]!.firmId;
  const supabase = await createClient();

  const [{ data: firm }, { data: profile }] = await Promise.all([
    supabase.from('firms').select('name').eq('id', firmId).maybeSingle(),
    supabase
      .from('firm_profiles')
      .select(
        'slug, is_published, headline, about, website, contact_email, established_year, industries, jurisdictions',
      )
      .eq('firm_id', firmId)
      .maybeSingle(),
  ]);

  const row = (profile ?? {}) as Record<string, unknown>;

  const draft: ProfileDraft = {
    headline: (row.headline as string) ?? '',
    about: (row.about as string) ?? '',
    website: (row.website as string) ?? '',
    contactEmail: (row.contact_email as string) ?? '',
    establishedYear: row.established_year ? String(row.established_year) : '',
    industries: (row.industries as string[]) ?? [],
    jurisdictions: (row.jurisdictions as string[]) ?? [],
    isPublished: Boolean(row.is_published),
    slug: (row.slug as string) ?? null,
  };

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Directory profile</h1>
        <p className="text-text-secondary max-w-2xl text-sm leading-relaxed">
          A page in the{' '}
          <Link href="/brokers" className="text-accent underline underline-offset-4">
            public directory
          </Link>{' '}
          for {(firm as { name?: string } | null)?.name ?? 'your firm'}. It costs nothing, does not
          require a listing, and stays hidden until you publish it. Everything on it is yours — we
          do not rank firms, rate them, or add anything you did not write.
        </p>
      </header>

      <FirmProfileForm
        firmId={firmId}
        firmName={(firm as { name?: string } | null)?.name ?? 'your firm'}
        draft={draft}
      />
    </main>
  );
}
