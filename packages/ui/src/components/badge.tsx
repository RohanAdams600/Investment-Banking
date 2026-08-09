import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { BadgeCheck } from 'lucide-react';

import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide',
  {
    variants: {
      variant: {
        neutral: 'border-border-default bg-surface-sunken text-text-secondary',
        primary: 'border-primary/20 bg-primary-subtle text-primary',
        success: 'border-success/25 bg-success-subtle text-success',
        warning: 'border-warning/30 bg-warning-subtle text-warning',
        danger: 'border-danger/25 bg-danger-subtle text-danger',
        info: 'border-info/25 bg-info-subtle text-info',
        /** Reserved for verification and premium status. Do not use decoratively. */
        accent: 'border-accent/35 bg-accent-subtle text-gold-700',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * The platform's verification mark. Its own component so that "what does
 * verified mean" has exactly one implementation to audit — see the admin
 * verification workflow in docs/architecture.md.
 */
export function VerifiedBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <Badge variant="accent" className={className} {...props}>
      <BadgeCheck aria-hidden className="h-3 w-3" />
      Verified
    </Badge>
  );
}

export { badgeVariants };
