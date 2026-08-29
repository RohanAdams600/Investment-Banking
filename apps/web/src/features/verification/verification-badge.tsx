import { VERIFICATION_DISCLAIMER, describeBadge, type VerificationBadge } from '@ib/core';
import { Badge } from '@ib/ui';

/**
 * How a buyer's funding review appears to a seller.
 *
 * One component, used everywhere a badge is shown, because the wording is the
 * feature. Two surfaces describing the same review differently is two different
 * promises about what the platform checked.
 *
 * `null` renders too, and renders as something other than a failure — a seller
 * reading a missing badge as a rejection harms the buyer, who did nothing.
 */
export function FundingBadge({
  badge,
  detail = true,
}: {
  badge: VerificationBadge | null;
  detail?: boolean;
}) {
  const display = describeBadge(badge);

  return (
    <div className="space-y-1">
      <Badge variant={display.tone}>{display.label}</Badge>
      {detail ? (
        <p className="text-text-muted max-w-prose text-xs leading-relaxed">{display.detail}</p>
      ) : null}
    </div>
  );
}

/**
 * The qualification that travels with the badge.
 *
 * Separate so a page showing several badges carries it once rather than under
 * every row, and exported from the same file so it is hard to render one
 * without noticing the other exists.
 */
export function FundingDisclaimer() {
  return (
    <p className="text-text-muted max-w-prose text-xs leading-relaxed">{VERIFICATION_DISCLAIMER}</p>
  );
}
