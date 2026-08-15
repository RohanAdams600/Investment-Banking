'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from '@ib/ui';

/**
 * What a user sees when a page throws.
 *
 * Two rules, and the first one is specific to this product.
 *
 * **The message is never the error.** `error.message` on a page that reads a
 * deal room can contain a listing's legal name, a buyer's email, or the shape of
 * a query — Next redacts messages in production builds, but relying on that is
 * relying on a build flag to keep confidential data off a screen somebody might
 * screenshot into a support ticket. So the copy is fixed, and the only variable
 * shown is the digest, which is a hash Next generates for exactly this purpose.
 *
 * **There is always a way out.** A crash with no navigation is where a user
 * closes the tab, and on this product that can mean abandoning a half-finished
 * listing.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server-side log has the real error and the stack. This is the line to
    // wire to Sentry or whatever collects them — the digest is what ties this
    // screen to that entry.
    console.error('[error boundary]', error.digest ?? 'no digest');
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="The page did not load. Nothing you had saved is affected — this happened while reading, not while writing."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={reset}>
              Try again
            </Button>
            <Link
              href="/dashboard"
              className="border-border-default hover:border-border-strong rounded-md border px-3 py-1.5 text-sm"
            >
              Dashboard
            </Link>
            {error.digest ? (
              <span className="text-text-muted w-full pt-2 text-center font-mono text-xs">
                Reference {error.digest}
              </span>
            ) : null}
          </div>
        }
      />
    </main>
  );
}
