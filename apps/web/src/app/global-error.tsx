'use client';

/**
 * The last resort: an error in the root layout itself.
 *
 * This one replaces `<html>`, so it cannot use the app's layout, its fonts, or
 * its design tokens — the stylesheet may be the thing that failed. Everything
 * here is inline for that reason, and it looks plainer than the rest of the
 * product on purpose.
 *
 * Same rule as the page-level boundary: the message is fixed, never the error's,
 * because whatever broke may have had a deal room's contents in scope.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '1.5rem',
          background: '#fff',
          color: '#111',
        }}
      >
        <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>This page did not load</h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: '#555' }}>
            Something failed before the page could start. Reloading usually fixes it. If it does
            not, the reference below will tell support which failure this was.
          </p>
          {error.digest ? (
            <p style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#777' }}>
              Reference {error.digest}
            </p>
          ) : null}
          {/*
            A plain anchor rather than next/link, and the lint rule is wrong
            here. `Link` navigates on the client, which keeps the broken
            application shell alive — and the shell is what just failed. A hard
            load is the only thing that can actually recover.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: '1rem',
              padding: '0.5rem 0.875rem',
              border: '1px solid #ccc',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              color: '#111',
              textDecoration: 'none',
            }}
          >
            Reload
          </a>
        </div>
      </body>
    </html>
  );
}
