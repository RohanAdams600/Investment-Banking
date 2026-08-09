import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';

import { cn } from '../lib/cn';

/**
 * Every interactive element in the product implements the same six states:
 * default, hover, active, focus-visible, disabled, loading. They are encoded
 * here once so the rest of the app inherits them rather than re-deciding.
 *
 * `accent` is the gold variant. It is intentionally listed last and should
 * appear at most once per screen — see docs/brand/brand-guide.md.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded font-medium',
    'transition-colors duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active',
        secondary:
          'border border-border-default bg-surface text-text-primary hover:bg-surface-sunken hover:border-border-strong active:bg-surface-sunken',
        ghost: 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
        danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
        accent: 'bg-accent text-accent-fg hover:bg-gold-600 active:bg-gold-700',
      },
      size: {
        sm: 'h-8 px-3 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5',
        md: 'h-9 px-4 text-sm [&_svg]:h-4 [&_svg]:w-4',
        lg: 'h-11 px-6 text-base [&_svg]:h-4 [&_svg]:w-4',
        icon: 'h-9 w-9 [&_svg]:h-4 [&_svg]:w-4',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a Next.js `<Link>`) instead of a `<button>`. */
  asChild?: boolean;
  /**
   * Shows a spinner and blocks interaction. Kept distinct from `disabled` so
   * screen readers announce "busy" rather than an unexplained disabled control.
   */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="animate-spin" /> : null}
      {/* `Slottable` marks which child the slotted element should replace. Without
          it, `asChild` sees the spinner and the children as two roots and throws. */}
      <Slottable>{children}</Slottable>
    </Comp>
  );
});

export { buttonVariants };
