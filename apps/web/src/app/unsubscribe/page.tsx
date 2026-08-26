import type { Metadata } from 'next';
import Link from 'next/link';
import { brand, pageTitle } from '@ib/core';
import { Card, CardContent } from '@ib/ui';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: pageTitle('Email preferences'),
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  deal_activity: 'deal activity',
  new_matches: 'new matches',
  listing_status: 'listing updates',
  messages: 'messages',
};

/**
 * Opting out, from a link in an inbox.
 *
 * ## No sign-in, deliberately
 *
 * CAN-SPAM requires a working opt-out, and one that asks for a password first is
 * not working — the person who most wants out is the one who no longer remembers
 * having an account. The token in the link is the whole authorisation.
 *
 * ## One answer for every input
 *
 * A bad token, an expired token and a successful opt-out all render the same
 * page. Anything else turns this into an oracle for guessing tokens, and the
 * honest phrasing costs nothing: the person who actually clicked their own link
 * is told what they need to know either way.
 *
 * ## Why it does not unsubscribe on load
 *
 * Mail clients and security scanners fetch links in messages before a human sees
 * them. A GET that changes state would opt people out of emails they never
 * chose to leave. So the page confirms, and the button posts.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.t === 'string' ? params.t : '';
  const category = typeof params.c === 'string' ? params.c : '';
  const done = params.done === '1';

  const label = CATEGORY_LABELS[category] ?? 'these';

  async function unsubscribe(formData: FormData) {
    'use server';

    const submittedToken = String(formData.get('token') ?? '');
    const submittedCategory = String(formData.get('category') ?? '');

    if (isSupabaseConfigured() && submittedToken) {
      const service = createServiceRoleClient();
      // The answer is deliberately ignored. It reports whether the token
      // matched, and surfacing that would let somebody test guesses.
      await service.rpc('unsubscribe_by_token', {
        token: submittedToken,
        category: submittedCategory,
      });
    }

    const { redirect } = await import('next/navigation');
    redirect('/unsubscribe?done=1');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-16">
      <Card className="w-full">
        <CardContent className="space-y-4 py-8">
          {done ? (
            <>
              <h1 className="text-2xl font-semibold">You are unsubscribed</h1>
              <p className="text-text-secondary text-sm leading-relaxed">
                If that link was yours, you will stop receiving those emails. It can take a few
                minutes for anything already on its way to stop.
              </p>
              <p className="text-text-secondary text-sm leading-relaxed">
                You will still see everything in the application, and messages about a deal you are
                actively part of are unaffected unless you turned those off too. Everything can be
                changed under Settings once you sign in.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">Stop these emails?</h1>
              <p className="text-text-secondary text-sm leading-relaxed">
                This turns off {brand.name} emails about <strong>{label}</strong>. Nothing else
                changes — you keep your account, your listings and your deals, and you will still
                see every notification when you sign in.
              </p>

              <form action={unsubscribe}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="category" value={category} />
                <button
                  type="submit"
                  className="bg-primary text-primary-fg hover:bg-primary-hover rounded-md px-4 py-2 text-sm font-medium"
                >
                  Yes, stop sending them
                </button>
              </form>

              <p className="text-text-muted text-xs">
                Changed your mind? <Link href="/">Go to {brand.name}</Link> instead — nothing has
                happened yet.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
