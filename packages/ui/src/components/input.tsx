import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Renders an error border and wires `aria-invalid`/`aria-describedby`. */
  error?: string;
  label?: string;
  hint?: ReactNode;
  /** Right-aligns and tabular-aligns the value. Use for currency and multiples. */
  numeric?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, label, hint, numeric = false, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-text-primary block text-sm font-medium">
          {label}
        </label>
      ) : null}

      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'bg-surface text-text-primary h-9 w-full rounded border px-3 text-sm',
          'placeholder:text-text-muted',
          'duration-fast ease-standard transition-colors',
          'focus-visible:ring-ring focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2',
          'disabled:bg-surface-sunken disabled:text-text-muted disabled:cursor-not-allowed',
          numeric && 'text-right font-mono tabular-nums',
          error
            ? 'border-danger focus-visible:ring-danger/40'
            : 'border-border-default hover:border-border-strong',
          className,
        )}
        {...props}
      />

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
