'use client';

import { useEffect, useRef, useState } from 'react';
import type { Answer, Question } from '@ib/core';
import { Button, Input, Textarea, cn } from '@ib/ui';

/**
 * One question, filling the screen.
 *
 * The interaction rules that make this feel quick rather than laborious:
 *
 *   - **Choosing an option advances.** On a single-choice question the click is
 *     the answer and the answer is the submit. Making somebody click "next"
 *     after choosing is one interaction too many, twelve times over.
 *   - **Enter advances everywhere else.** Typed answers keep hands on the
 *     keyboard.
 *   - **Focus moves to the new question.** Otherwise a keyboard user is left on
 *     a button that no longer exists and a screen reader announces nothing.
 *   - **Nothing animates for longer than it takes to read.** The transition is
 *     there to show that something moved, not to be admired.
 */
export function QuestionScreen({
  question,
  value,
  onChange,
  onNext,
  onBack,
  canGoBack,
  isLast,
  error,
}: {
  question: Question;
  value: Answer;
  onChange: (value: Answer) => void;
  onNext: () => void;
  onBack: () => void;
  canGoBack: boolean;
  isLast: boolean;
  error: string | null;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Moves focus to the question when it changes, so the flow is followable
  // without a mouse and screen readers announce the new prompt.
  useEffect(() => {
    headingRef.current?.focus();
  }, [question.id]);

  const selected = Array.isArray(value) ? value : [];

  function toggle(optionValue: string) {
    const next = selected.includes(optionValue)
      ? selected.filter((v) => v !== optionValue)
      : [...selected, optionValue];
    onChange(next);
  }

  return (
    <div
      key={question.id}
      className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-200"
    >
      <div className="space-y-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
        >
          {question.prompt}
        </h2>
        {question.help ? (
          <p className="text-text-muted max-w-prose text-sm">{question.help}</p>
        ) : null}
      </div>

      <div className="space-y-3">
        {question.type === 'single' ? (
          <div role="radiogroup" aria-label={question.prompt} className="grid gap-2">
            {(question.options ?? []).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={value === option.value}
                onClick={() => {
                  onChange(option.value);
                  // The choice is the submit. See the note above.
                  onNext();
                }}
                className={choiceClass(value === option.value)}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                {option.description ? (
                  <span className="text-text-muted mt-0.5 block text-xs">{option.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {question.type === 'multi' ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {(question.options ?? []).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="checkbox"
                  aria-checked={selected.includes(option.value)}
                  onClick={() => toggle(option.value)}
                  className={choiceClass(selected.includes(option.value))}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="text-text-muted mt-0.5 block text-xs">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {question.maxSelections ? (
              <p className="text-text-muted text-xs" aria-live="polite">
                {selected.length} of {question.maxSelections} chosen
              </p>
            ) : null}
          </>
        ) : null}

        {question.type === 'scale' ? (
          <ScaleInput question={question} value={value} onChange={onChange} onNext={onNext} />
        ) : null}

        {isTextual(question) ? (
          <TextualInput question={question} value={value} onChange={onChange} onNext={onNext} />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        {/* Single-choice advances on click, so a next button would be dead weight. */}
        {question.type !== 'single' ? (
          <Button type="button" onClick={onNext}>
            {isLast ? 'Finish' : 'Continue'}
          </Button>
        ) : null}

        {canGoBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        ) : null}

        {!question.required && question.type !== 'single' ? (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              onNext();
            }}
            className="text-text-muted hover:text-text-primary text-sm underline underline-offset-4"
          >
            Skip
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ScaleInput({
  question,
  value,
  onChange,
  onNext,
}: {
  question: Question;
  value: Answer;
  onChange: (value: Answer) => void;
  onNext: () => void;
}) {
  const min = question.min ?? 1;
  const max = question.max ?? 5;
  const points = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={question.prompt} className="flex gap-2">
        {points.map((point) => (
          <button
            key={point}
            type="button"
            role="radio"
            aria-checked={value === point}
            aria-label={`${point} out of ${max}`}
            onClick={() => {
              onChange(point);
              onNext();
            }}
            className={cn(
              'h-12 flex-1 rounded border text-sm font-medium transition-colors',
              'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2',
              value === point
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border-default bg-surface hover:border-border-strong',
            )}
          >
            {point}
          </button>
        ))}
      </div>
      {question.scaleLabels ? (
        <div className="text-text-muted flex justify-between text-xs">
          <span>{question.scaleLabels.low}</span>
          <span>{question.scaleLabels.high}</span>
        </div>
      ) : null}
    </div>
  );
}

function TextualInput({
  question,
  value,
  onChange,
  onNext,
}: {
  question: Question;
  value: Answer;
  onChange: (value: Answer) => void;
  onNext: () => void;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));

  // Resets when the question changes — the component is reused across screens.
  useEffect(() => {
    setText(value === null || value === undefined ? '' : String(value));
  }, [question.id, value]);

  const shared = {
    autoFocus: true,
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setText(e.target.value);
      onChange(e.target.value);
    },
    placeholder: question.placeholder,
  };

  if (question.type === 'longtext') {
    return (
      <Textarea
        {...shared}
        rows={6}
        maxLength={question.max ?? 4000}
        aria-label={question.prompt}
      />
    );
  }

  const prefix = question.type === 'money' ? '$' : null;
  const suffix = question.type === 'percent' ? '%' : null;

  return (
    <div className="flex items-center gap-2">
      {prefix ? <span className="text-text-muted text-lg">{prefix}</span> : null}
      <Input
        {...shared}
        aria-label={question.prompt}
        inputMode={question.type === 'text' ? undefined : 'decimal'}
        numeric={question.type !== 'text'}
        className="h-12 text-lg"
        onKeyDown={(event) => {
          // Enter advances. Shift+Enter is left alone for anything multiline.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onNext();
          }
        }}
      />
      {suffix ? <span className="text-text-muted text-lg">{suffix}</span> : null}
    </div>
  );
}

function isTextual(question: Question): boolean {
  return ['text', 'longtext', 'money', 'number', 'percent'].includes(question.type);
}

function choiceClass(active: boolean): string {
  return cn(
    'rounded-md border p-4 text-left transition-colors',
    'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2',
    active
      ? 'border-primary bg-primary-subtle'
      : 'border-border-default bg-surface hover:border-border-strong hover:bg-surface-sunken',
  );
}
