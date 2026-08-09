/**
 * Non-color tokens: spacing, radius, elevation, motion, z-index.
 *
 * Spacing follows a 4px base grid. Tailwind's default numeric scale already
 * matches it, so we extend rather than replace — only the named additions below
 * are new. Every other scale here replaces Tailwind's default outright, because
 * a smaller vocabulary is what keeps a large surface area looking like one product.
 */

/** Additions to Tailwind's 4px-based spacing scale. */
export const spacingExtensions = {
  4.5: '1.125rem', // 18px — the gap that keeps showing up between a label and a dense control
  13: '3.25rem', // 52px
  15: '3.75rem', // 60px
  18: '4.5rem', // 72px
  22: '5.5rem', // 88px
  30: '7.5rem', // 120px — marketing section rhythm
  38: '9.5rem', // 152px
} as const;

/**
 * Border radius. Restrained on purpose — this is a financial product, not a
 * consumer app. Nothing above `xl` except full pills.
 */
export const radii = {
  none: '0px',
  sm: '0.1875rem', // 3px  — checkboxes, tags
  DEFAULT: '0.25rem', // 4px  — inputs, buttons
  md: '0.375rem', // 6px  — cards inside a panel
  lg: '0.5rem', // 8px  — panels, modals
  xl: '0.75rem', // 12px — marketing feature cards
  full: '9999px', // pills, avatars
} as const;

/**
 * Elevation. Shadows are tinted with ink rather than pure black so they read as
 * depth rather than dirt. Dark-mode shadows are handled by surface role changes
 * (`surface` -> `surface-raised`), not by heavier shadows.
 */
export const elevation = {
  none: 'none',
  xs: '0 1px 2px 0 rgb(11 18 32 / 0.04)',
  sm: '0 1px 3px 0 rgb(11 18 32 / 0.06), 0 1px 2px -1px rgb(11 18 32 / 0.06)',
  md: '0 4px 8px -2px rgb(11 18 32 / 0.08), 0 2px 4px -2px rgb(11 18 32 / 0.05)',
  lg: '0 12px 20px -4px rgb(11 18 32 / 0.10), 0 4px 8px -4px rgb(11 18 32 / 0.06)',
  xl: '0 24px 40px -8px rgb(11 18 32 / 0.14), 0 8px 16px -8px rgb(11 18 32 / 0.08)',
  /** Focus ring drawn as a shadow where an outline would clip. */
  focus: '0 0 0 3px rgb(53 98 145 / 0.35)',
} as const;

/**
 * Motion. Three durations and one easing curve, deliberately.
 * Anything that needs a fourth duration probably needs a different interaction.
 */
export const motion = {
  duration: {
    fast: '150ms', // hover, focus, color shifts
    base: '250ms', // dropdowns, tooltips, accordion
    slow: '400ms', // modals, drawers, page-level transitions
  },
  easing: {
    /** Standard curve — use this unless there is a reason not to. */
    standard: 'cubic-bezier(0.2, 0, 0.1, 1)',
    /** Entering the screen: decelerate. */
    enter: 'cubic-bezier(0, 0, 0.2, 1)',
    /** Leaving the screen: accelerate. */
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} as const;

/**
 * z-index. Named layers only — no bare numbers in components, so stacking bugs
 * are resolved here rather than by escalating magic numbers across files.
 */
export const zIndex = {
  base: '0',
  raised: '10',
  sticky: '20',
  header: '30',
  overlay: '40',
  modal: '50',
  popover: '60',
  toast: '70',
  tooltip: '80',
} as const;

export type RadiusToken = keyof typeof radii;
export type ElevationToken = keyof typeof elevation;
