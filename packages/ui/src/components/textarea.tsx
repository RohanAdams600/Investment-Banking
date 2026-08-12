import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  label?: string;
  hint?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, error, label, hint, id, rows = 4, ...props },
  ref,
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const hintId = `${textareaId}-hint`;
  const errorId = `${textareaId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={textareaId} className="text-text-primary block text-sm font-medium">
          {label}
        </label>
      ) : null}

      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'bg-surface text-text-primary w-full rounded border px-3 py-2 text-sm',
          'placeholder:text-text-muted',
          'duration-fast ease-standard transition-colors',
          'focus-visible:ring-ring focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2',
          'disabled:bg-surface-sunken disabled:text-text-muted disabled:cursor-not-allowed',
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
