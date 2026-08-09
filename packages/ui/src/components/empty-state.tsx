import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * Every table and feed in the product needs one of these. An empty dashboard
 * with no explanation reads as a broken dashboard, which is expensive on a
 * platform where the first session decides whether someone trusts it.
 */
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Primary action — the one thing that resolves the emptiness. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border-default flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="bg-surface-sunken text-text-muted flex h-10 w-10 items-center justify-center rounded-full">
          <Icon aria-hidden className="h-5 w-5" />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-text-primary text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-text-muted mx-auto max-w-sm text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
