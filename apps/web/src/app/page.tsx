import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { brand, isBrandPlaceholder } from '@ib/core';
import { Badge, Button, Card, CardContent, CardDescription, CardTitle } from '@ib/ui';

/**
 * Placeholder root. The marketing site (Section 2 of the spec) replaces this
 * once brand and jurisdiction decisions are settled; it will live in an
 * `app/(marketing)` route group so it can be statically generated separately
 * from the authenticated app.
 */
export default function HomePage() {
  return (
    <main className="py-30 mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6">
      <div className="space-y-4">
        {isBrandPlaceholder ? (
          <Badge variant="warning">Placeholder brand — name not yet selected</Badge>
        ) : null}

        <h1 className="text-4xl font-semibold">{brand.name}</h1>
        <p className="text-text-secondary max-w-xl text-lg">{brand.tagline}</p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <CardTitle>Foundations are in place</CardTitle>
          <CardDescription>
            Design tokens, the shared component library, and the documentation skeleton are built.
            The marketing site, data model, and platform modules follow the sequence in{' '}
            <code className="bg-surface-sunken rounded px-1 py-0.5 text-xs">docs/roadmap.md</code>.
          </CardDescription>
          <div className="pt-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/foundations">
                View the design system
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
