import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

/**
 * Loading placeholder. Dashboard tables must render skeletons rather than a
 * spinner, so the page does not reflow when data lands.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'bg-surface-sunken relative overflow-hidden rounded',
        'after:animate-shimmer after:absolute after:inset-0 after:-translate-x-full',
        'after:via-border-subtle/60 after:bg-gradient-to-r after:from-transparent after:to-transparent',
        'motion-reduce:after:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
