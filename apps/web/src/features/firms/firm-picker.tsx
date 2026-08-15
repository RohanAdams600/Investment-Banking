import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { EmptyState } from '@ib/ui';

import type { FirmOption } from '@/features/deals/types';

/**
 * "Which firm are you doing this as?"
 *
 * Shown only to somebody who belongs to more than one, which is a small
 * minority — so it is a full-page question rather than a dropdown tucked in a
 * corner. Getting this wrong files a seller's documents against the wrong
 * brokerage, and that is worth one deliberate click.
 *
 * Links rather than a form, so the choice lands in the URL. A broker who
 * bookmarks `/crm?firm=…` gets the same pipeline back tomorrow, and a link
 * pasted to a colleague at the same firm opens what the sender meant.
 */
export function FirmPicker({
  options,
  basePath,
  what,
}: {
  options: FirmOption[];
  /** Where the choice goes, e.g. `/crm`. */
  basePath: string;
  /** What is about to happen, in the user's words: "your pipeline", "this document". */
  what: string;
}) {
  return (
    <EmptyState
      icon={Building2}
      title="Which firm?"
      description={`You belong to more than one, and ${what} has to belong to exactly one of them. Pick one — the choice stays in the address bar, so a bookmark brings you back here.`}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {options.map((option) => (
            <Link
              key={option.id}
              href={`${basePath}?firm=${option.id}`}
              className="border-border-default hover:border-border-strong rounded-md border px-3 py-1.5 text-sm"
            >
              {option.name}
            </Link>
          ))}
        </div>
      }
    />
  );
}

/**
 * The quieter version, for a page that has already resolved a firm.
 *
 * A line saying which one, and a way to change it. Absent entirely for the
 * single-firm majority, because telling somebody with one firm which firm they
 * are in is noise.
 */
export function FirmBadge({
  firm,
  options,
  basePath,
}: {
  firm: FirmOption;
  options: FirmOption[];
  basePath: string;
}) {
  if (options.length < 2) return null;

  return (
    <p className="text-text-muted text-xs">
      Acting as <span className="text-text-secondary font-medium">{firm.name}</span> ·{' '}
      {options
        .filter((option) => option.id !== firm.id)
        .map((option) => (
          <Link
            key={option.id}
            href={`${basePath}?firm=${option.id}`}
            className="underline underline-offset-4"
          >
            switch to {option.name}
          </Link>
        ))}
    </p>
  );
}
