import { SiteHeader } from '@/features/navigation/site-header';
import { unreadCount } from '@/features/notifications/queries';
import { getActor } from '@/lib/auth/actor';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * The signed-in shell.
 *
 * A route group rather than a path segment: `(app)` changes no URL, so
 * `/dashboard` is still `/dashboard`. What it buys is a layout boundary — the
 * header reads the session, reading a cookie makes a subtree dynamic, and this
 * keeps that cost off the marketing page, the legal pages and the sign-in form,
 * which have no use for a nav and are better served static.
 *
 * ## What this layout does not do
 *
 * It does not gate. It would be the obvious place — one `redirect('/sign-in')`
 * instead of the same line in fourteen pages — and it would be wrong, because a
 * layout in the App Router does not re-run on every client-side navigation
 * within its subtree. A check here would be a check that runs sometimes, which
 * is worse than one that never runs: it looks like protection. Every page keeps
 * its own redirect, every action re-checks, and the database refuses regardless.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const header = await maybeHeader();

  return (
    <>
      {header}
      {/*
        `tabIndex={-1}` is what makes the header's "Skip to content" link work.
        Without it the browser scrolls to this element but leaves focus in the
        header, so the next Tab lands back on the first nav link — the skip
        link skips nothing.
      */}
      <div id="main" tabIndex={-1}>
        {children}
      </div>
    </>
  );
}

/**
 * The header, or nothing.
 *
 * Nothing in two cases. Without Supabase there is no session to read, and the
 * pages underneath already say so. Without an actor the visitor is signed out
 * or mid-redirect to `/sign-in`, and a nav bar whose every link bounces to the
 * sign-in form is worse than no nav bar.
 */
async function maybeHeader() {
  if (!isSupabaseConfigured()) return null;

  const actor = await getActor();
  if (!actor) return null;

  return <SiteHeader actor={actor} unread={await unreadCount()} />;
}
