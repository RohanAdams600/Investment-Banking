import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  label?: string;
  hint?: ReactNode;
}

/**
 * A native `<select>`, styled to match `Input`.
 *
 * Native rather than a custom listbox on purpose. A styled div pretending to be
 * a select has to reimplement keyboard navigation, type-ahead, screen reader
 * semantics, and the mobile picker — and gets at least one of them wrong. Where
 * the product needs a combobox with search (industry pickers with a hundred
 * entries), that is a different component with a different name, not this one
 * quietly growing.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, error, label, hint, id, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={selectId} className="text-text-primary block text-sm font-medium">
          {label}
        </label>
      ) : null}

      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'bg-surface text-text-primary h-9 w-full rounded border px-3 text-sm',
          'duration-fast ease-standard transition-colors',
          'focus-visible:ring-ring focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2',
          'disabled:bg-surface-sunken disabled:text-text-muted disabled:cursor-not-allowed',
          error
            ? 'border-danger focus-visible:ring-danger/40'
            : 'border-border-default hover:border-border-strong',
          className,
        )}
        {...props}
      >
        {children}
      </select>

      {hint && !error ? (
        <p id={hintId} className="text-text-muted text-xs">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
});
