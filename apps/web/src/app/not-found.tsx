import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { EmptyState } from '@ib/ui';

/**
 * The page that is also the answer to "does this business exist".
 *
 * Most 404s on this platform are ordinary — a stale link, a typo. But a
 * meaningful share are a listing the caller is not allowed to see: `loadListing`
 * returns null for a listing that exists and is confidential, and the page calls
 * `notFound()` rather than showing a 403. That is deliberate, and it means the
 * wording here has to be careful.
 *
 * "You do not have access" would confirm that something is there. "We could not
 * find it" is true of both cases and distinguishes neither, which is the point.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
      <EmptyState
        icon={FileQuestion}
        title="We could not find that"
        description="The link may be old, or the page may have moved. If somebody sent you a listing, ask them to send it again — links to confidential listings are not permanent."
        action={
          <Link
            href="/dashboard"
            className="border-border-default hover:border-border-strong rounded-md border px-3 py-1.5 text-sm"
          >
            Back to your dashboard
          </Link>
        }
      />
    </main>
  );
}
