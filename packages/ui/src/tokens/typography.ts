/**
 * Type system.
 *
 * Three families, each with a job:
 *  - display: marketing hero and section headers. Gravitas.
 *  - sans:    the application itself — dashboards, tables, forms. Legibility.
 *  - mono:    financial figures, so digits align in columns.
 *
 * Families are wired through CSS variables set by `next/font` in the app, so the
 * concrete typeface can change without touching this file's consumers.
 */

/**
 * Token collections are declared with `satisfies` rather than `as const`.
 * `as const` would make every array readonly, and Tailwind's `Config` type
 * expects mutable arrays — the preset would fail to typecheck. `satisfies`
 * still preserves the literal keys, so `FontSizeToken` stays a union.
 */
export const fontFamilies = {
  display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
  sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
} satisfies Record<string, string[]>;

/** [fontSize, { lineHeight, letterSpacing }] — Tailwind `fontSize` token shape. */
type FontSizeValue = [string, { lineHeight: string; letterSpacing?: string }];

export const fontSizes = {
  '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }], // 11px — table micro-labels
  xs: ['0.75rem', { lineHeight: '1.125rem', letterSpacing: '0.01em' }], // 12px
  sm: ['0.875rem', { lineHeight: '1.375rem' }], // 14px — dense table body
  base: ['1rem', { lineHeight: '1.625rem' }], // 16px — default body
  lg: ['1.125rem', { lineHeight: '1.75rem' }], // 18px
  xl: ['1.25rem', { lineHeight: '1.875rem' }], // 20px
  '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em' }], // 24px
  '3xl': ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.015em' }], // 32px
  '4xl': ['2.5rem', { lineHeight: '3rem', letterSpacing: '-0.02em' }], // 40px
  '5xl': ['3.5rem', { lineHeight: '3.75rem', letterSpacing: '-0.025em' }], // 56px — hero only
} satisfies Record<string, FontSizeValue>;

export const fontWeights = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} satisfies Record<string, string>;

export type FontSizeToken = keyof typeof fontSizes;
