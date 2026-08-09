import type { Metadata } from 'next';
import { FileSearch } from 'lucide-react';
import {
  AIDisclaimer,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Skeleton,
  VerifiedBadge,
} from '@ib/ui';
import { colorRoles, elevation, fontSizes, radii } from '@ib/ui/tokens';
import { formatMoney, formatMoneyCompact } from '@ib/core';

export const metadata: Metadata = {
  title: 'Foundations',
  description: 'Living reference for design tokens and shared components.',
};

/**
 * Living style guide.
 *
 * This page renders straight from the token source, so it cannot drift from
 * what the components actually use — if a role is added to `semantic.ts` it
 * shows up here automatically. It is the reference a designer and an engineer
 * can both point at during review.
 */
export default function FoundationsPage() {
  return (
    <main className="space-y-15 py-18 mx-auto max-w-5xl px-6">
      <header className="space-y-2">
        <p className="text-2xs text-text-muted font-medium uppercase tracking-wide">
          Design system
        </p>
        <h1 className="text-4xl font-semibold">Foundations</h1>
        <p className="text-text-secondary max-w-2xl">
          Tokens are defined once in <code className="text-sm">packages/ui/src/tokens</code> and
          consumed everywhere through semantic roles. Components reference roles, never raw hex
          values, which is what lets the palette change without touching a component.
        </p>
      </header>

      <Section title="Color roles" description="Each swatch is live — it reads its CSS variable.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(colorRoles).map(([role, def]) => (
            <div
              key={role}
              className="border-border-subtle flex items-start gap-3 rounded-md border p-3"
            >
              <span
                className="border-border-default mt-0.5 h-9 w-9 shrink-0 rounded border"
                style={{ backgroundColor: `rgb(var(--color-${role}))` }}
              />
              <div className="min-w-0 space-y-0.5">
                <p className="text-text-primary truncate font-mono text-xs">{role}</p>
                <p className="text-2xs text-text-muted leading-snug">{def.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Type scale"
        description="Display face for headings, UI sans for everything else."
      >
        <div className="space-y-3">
          {Object.entries(fontSizes).map(([token, [size]]) => (
            <div
              key={token}
              className="border-border-subtle flex items-baseline gap-4 border-b pb-3"
            >
              <span className="text-text-muted w-16 shrink-0 font-mono text-xs">{token}</span>
              <span className="text-text-muted w-20 shrink-0 font-mono text-xs">{size}</span>
              <span style={{ fontSize: size }} className="truncate">
                Lower middle market M&amp;A
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Financial figures"
        description="Monetary values are stored as integer cents and rendered with tabular digits so columns align."
      >
        <Card>
          <CardContent className="space-y-2">
            {[475_000_050, 12_500_000, 87_500, 3_200_000_00].map((cents) => (
              <div
                key={cents}
                className="border-border-subtle flex justify-between border-b py-1.5 last:border-0"
              >
                <span className="text-text-muted text-sm">{cents.toLocaleString()} cents</span>
                <span className="flex gap-6">
                  <span className="font-tabular text-sm">{formatMoney(cents)}</span>
                  <span className="font-tabular text-text-secondary w-16 text-right text-sm">
                    {formatMoneyCompact(cents)}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Buttons"
        description="Six states each: default, hover, active, focus, disabled, loading."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="accent">Accent</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Badges" description="Accent is reserved for verification and premium status.">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Draft</Badge>
          <Badge variant="primary">Live</Badge>
          <Badge variant="info">Under LOI</Badge>
          <Badge variant="warning">Pending review</Badge>
          <Badge variant="success">Closed</Badge>
          <Badge variant="danger">Withdrawn</Badge>
          <VerifiedBadge />
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Company name" placeholder="Acme Industrial Services" />
          <Input
            label="Asking price"
            numeric
            placeholder="4,750,000"
            hint="USD, excluding real estate"
          />
          <Input
            label="Contact email"
            defaultValue="not-an-email"
            error="Enter a valid email address."
          />
          <Input label="Listing ID" defaultValue="LST-00421" disabled />
        </div>
      </Section>

      <Section
        title="AI disclaimers"
        description="Mandatory on every AI surface. The regulated variants carry fixed wording that callers cannot override."
      >
        <div className="space-y-3">
          <AIDisclaimer variant="valuation" />
          <AIDisclaimer variant="match" />
          <AIDisclaimer variant="tax" />
          <AIDisclaimer variant="general" layout="inline" />
        </div>
      </Section>

      <Section title="Loading and empty states">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Loading</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>

          <EmptyState
            icon={FileSearch}
            title="No listings match these filters"
            description="Widen the revenue range or clear the geography filter to see more results."
            action={
              <Button variant="secondary" size="sm">
                Clear filters
              </Button>
            }
          />
        </div>
      </Section>

      <Section title="Radius and elevation">
        <div className="flex flex-wrap gap-4">
          {Object.entries(radii)
            .filter(([name]) => name !== 'none')
            .map(([name, value]) => (
              <div key={name} className="space-y-1 text-center">
                <div
                  className="border-border-default bg-surface-sunken h-16 w-16 border"
                  style={{ borderRadius: value }}
                />
                <p className="text-2xs text-text-muted font-mono">{name}</p>
              </div>
            ))}
        </div>

        <div className="flex flex-wrap gap-6 pt-4">
          {Object.entries(elevation)
            .filter(([name]) => name !== 'none' && name !== 'focus')
            .map(([name, value]) => (
              <div key={name} className="space-y-1 text-center">
                <div className="bg-surface h-16 w-16 rounded-md" style={{ boxShadow: value }} />
                <p className="text-2xs text-text-muted font-mono">{name}</p>
              </div>
            ))}
        </div>
      </Section>
    </main>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {description ? <p className="text-text-muted max-w-2xl text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
