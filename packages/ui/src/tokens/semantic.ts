/**
 * Semantic color roles.
 *
 * Components reference roles (`bg-surface`, `text-muted`, `border-default`),
 * never primitives. Each role resolves to a CSS variable that carries a
 * different primitive value in light vs dark mode, so a component written once
 * is correct in both themes.
 */

import { palette } from './primitives';

export interface ColorRole {
  light: string;
  dark: string;
  /** Why this role exists and when to reach for it. */
  usage: string;
}

export const colorRoles = {
  // ---------------------------------------------------------------- surfaces
  canvas: {
    light: palette.stone[50],
    dark: palette.slate[900],
    usage: 'Page background, furthest back.',
  },
  surface: {
    light: palette.white,
    dark: palette.slate[800],
    usage: 'Default card / panel / table background.',
  },
  'surface-raised': {
    light: palette.white,
    dark: palette.slate[700],
    usage: 'Popovers, dropdowns, modals — anything floating above a surface.',
  },
  'surface-sunken': {
    light: palette.stone[100],
    dark: palette.slate[900],
    usage: 'Wells, code blocks, inset table headers.',
  },
  'surface-inverted': {
    light: palette.slate[900],
    dark: palette.stone[50],
    usage: 'Deliberate contrast blocks — marketing bands, tooltips.',
  },

  // ------------------------------------------------------------------- text
  'text-primary': {
    light: palette.slate[900],
    dark: palette.stone[50],
    usage: 'Body copy and headings.',
  },
  /*
   * Both are one step darker than the cool ramp they replaced, and that is not
   * a taste decision.
   *
   * A warm neutral is lighter at every step than the blue-grey equivalent, so a
   * one-for-one swap carried `text-muted` from 4.3:1 down to 2.54:1 — a real
   * WCAG failure, on the labels and timestamps that are already the hardest
   * thing on the page to read. Caught by measuring rather than by looking, which
   * is why `contrast.test.ts` now measures on every build.
   */
  'text-secondary': {
    light: palette.stone[800],
    dark: palette.stone[300],
    usage: 'Supporting copy, table cell secondary lines.',
  },
  'text-muted': {
    light: palette.stone[700],
    dark: palette.stone[400],
    usage: 'Labels, captions, placeholder, timestamps.',
  },
  'text-inverted': {
    light: palette.white,
    dark: palette.slate[900],
    usage: 'Text on `surface-inverted` or on a solid primary fill.',
  },

  // ---------------------------------------------------------------- borders
  'border-subtle': {
    light: palette.stone[200],
    dark: palette.slate[700],
    usage: 'Hairlines between rows, dividers.',
  },
  'border-default': {
    light: palette.stone[300],
    dark: palette.slate[600],
    usage: 'Input borders, card outlines.',
  },
  'border-strong': {
    light: palette.stone[400],
    dark: palette.stone[600],
    usage: 'Hovered inputs, emphasized separation.',
  },

  // ------------------------------------------------------------------ charts
  /*
   * Chart marks are their own roles, not a reuse of `accent`.
   *
   * Two reasons, and the second is the one that bites. First, a mark sits on a
   * card rather than on the page, so it is judged against a different ground
   * than any text role. Second — and this is why the light and dark values are
   * *different steps* rather than the same colour — a chart mark has to clear
   * 3:1 against its own surface in each theme, and no single step does:
   * copper 500 is 4.25:1 on white and 2.78:1 on the dark card; copper 400 is
   * 2.98:1 on white and 3.97:1 on the dark card. Flipping one value between
   * themes would ship an illegible chart in one of them.
   *
   * Measured with the same contrast maths as `contrast.test.ts`, which asserts
   * both of these.
   */
  'chart-mark': {
    light: palette.copper[500],
    dark: palette.copper[400],
    usage: 'The data itself — bars, lines, dots. Never used for text.',
  },
  'chart-mark-soft': {
    light: palette.copper[200],
    dark: palette.copper[800],
    usage: 'Context behind the current period: a sparkline’s earlier days, an unfilled track.',
  },
  'chart-grid': {
    light: palette.stone[200],
    dark: palette.slate[700],
    usage: 'Gridlines and axis rules. Deliberately recessive — this is not data.',
  },

  // ---------------------------------------------------------- primary action
  /*
   * The primary action is ink, not a brand colour.
   *
   * There is deliberately no blue in this palette. A near-black button on warm
   * paper is the most confident control available and needs no hue to justify
   * itself; reaching for a blue here would have quietly reintroduced the look
   * the repalette exists to leave behind. Copper stays the accent, which means
   * it keeps its meaning — a screen with one copper element has one thing worth
   * looking at.
   */
  primary: {
    light: palette.slate[800],
    dark: palette.stone[100],
    usage: 'Primary buttons, active nav, links.',
  },
  'primary-hover': {
    light: palette.slate[900],
    dark: palette.white,
    usage: 'Primary action hover state.',
  },
  'primary-active': {
    light: palette.slate[700],
    dark: palette.stone[200],
    usage: 'Primary action pressed state.',
  },
  'primary-subtle': {
    light: palette.stone[200],
    dark: palette.slate[700],
    usage: 'Tinted background for selected rows, active filter chips.',
  },
  'primary-fg': {
    light: palette.stone[50],
    dark: palette.slate[900],
    usage: 'Foreground on a solid primary fill.',
  },

  // ------------------------------------------------------------------ accent
  accent: {
    light: palette.copper[600],
    dark: palette.copper[400],
    usage:
      'Weathered copper. Eyebrows, rules, the verified mark, one emphasis per screen. Never a surface.',
  },
  'accent-subtle': {
    light: palette.copper[50],
    dark: palette.copper[900],
    usage: 'Accent-tinted background behind a badge or callout.',
  },
  'accent-fg': {
    light: palette.stone[50],
    dark: palette.stone[50],
    usage:
      'Foreground on a solid accent fill. Copper is dark enough to take light text, unlike the gold it replaced.',
  },

  // --------------------------------------------------------------- semantic
  success: { light: palette.success[500], dark: palette.success[300], usage: 'Positive state.' },
  'success-subtle': {
    light: palette.success[50],
    dark: palette.success[700],
    usage: 'Success banner background.',
  },
  warning: { light: palette.warning[500], dark: palette.warning[300], usage: 'Caution state.' },
  'warning-subtle': {
    light: palette.warning[50],
    dark: palette.warning[700],
    usage: 'Warning banner background.',
  },
  danger: { light: palette.danger[500], dark: palette.danger[300], usage: 'Destructive / error.' },
  'danger-subtle': {
    light: palette.danger[50],
    dark: palette.danger[700],
    usage: 'Error banner background.',
  },
  info: { light: palette.info[500], dark: palette.info[300], usage: 'Neutral informational.' },
  'info-subtle': {
    light: palette.info[50],
    dark: palette.info[700],
    usage: 'Info banner background — also the default AI-disclaimer surface.',
  },

  // ------------------------------------------------------------------- misc
  /*
   * The focus ring is the one place a system colour beats a brand colour.
   *
   * Copper would have been the obvious substitute for the blue that was here,
   * and it is the wrong answer: the accent's job is that one copper element on
   * a screen is the thing worth looking at, and a ring that borrows it makes
   * every focused input compete with that. The muted teal reads as machinery
   * rather than brand, which is what a focus ring should be.
   */
  ring: {
    light: palette.info[500],
    dark: palette.info[100],
    usage:
      'Focus ring. Must stay visible against every surface role, and must not be mistaken for the accent.',
  },
  overlay: {
    light: palette.slate[900],
    dark: palette.black,
    usage: 'Modal scrim — always applied at reduced opacity.',
  },
} as const satisfies Record<string, ColorRole>;

export type ColorRoleName = keyof typeof colorRoles;
