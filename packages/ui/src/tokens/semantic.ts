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
    light: palette.mist[50],
    dark: palette.obsidian[900],
    usage: 'Page background, furthest back.',
  },
  surface: {
    light: palette.white,
    dark: palette.obsidian[800],
    usage: 'Default card / panel / table background.',
  },
  'surface-raised': {
    light: palette.white,
    dark: palette.obsidian[700],
    usage: 'Popovers, dropdowns, modals — anything floating above a surface.',
  },
  'surface-sunken': {
    light: palette.mist[100],
    dark: palette.obsidian[900],
    usage: 'Wells, code blocks, inset table headers.',
  },
  'surface-inverted': {
    light: palette.obsidian[900],
    dark: palette.mist[50],
    usage: 'Deliberate contrast blocks — marketing bands, tooltips.',
  },

  // ------------------------------------------------------------------- text
  'text-primary': {
    light: palette.obsidian[900],
    dark: palette.mist[50],
    usage: 'Body copy and headings.',
  },
  /*
   * Both are one step darker than the cool ramp they replaced, and that is not
   * a taste decision.
   *
   * A violet-cast neutral is lighter at every step than the blue-grey equivalent, so a
   * one-for-one swap carried `text-muted` from 4.3:1 down to 2.54:1 — a real
   * WCAG failure, on the labels and timestamps that are already the hardest
   * thing on the page to read. Caught by measuring rather than by looking, which
   * is why `contrast.test.ts` now measures on every build.
   */
  'text-secondary': {
    light: palette.mist[800],
    dark: palette.mist[300],
    usage: 'Supporting copy, table cell secondary lines.',
  },
  'text-muted': {
    light: palette.mist[700],
    dark: palette.mist[400],
    usage: 'Labels, captions, placeholder, timestamps.',
  },
  'text-inverted': {
    light: palette.white,
    dark: palette.obsidian[900],
    usage: 'Text on `surface-inverted` or on a solid primary fill.',
  },

  // ---------------------------------------------------------------- borders
  'border-subtle': {
    light: palette.mist[200],
    dark: palette.obsidian[700],
    usage: 'Hairlines between rows, dividers.',
  },
  'border-default': {
    light: palette.mist[300],
    dark: palette.obsidian[600],
    usage: 'Input borders, card outlines.',
  },
  'border-strong': {
    light: palette.mist[400],
    dark: palette.mist[600],
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
   * violet 500 is 4.80:1 on white and below the bar on the dark card; violet 400
   * is under 3:1 on white and 5.10:1 on the dark card. Flipping one value between
   * themes would ship an illegible chart in one of them.
   *
   * Measured with the same contrast maths as `contrast.test.ts`, which asserts
   * both of these.
   */
  'chart-mark': {
    light: palette.violet[500],
    dark: palette.violet[400],
    usage: 'The data itself — bars, lines, dots. Never used for text.',
  },
  'chart-mark-soft': {
    light: palette.violet[200],
    dark: palette.violet[800],
    usage: 'Context behind the current period: a sparkline’s earlier days, an unfilled track.',
  },
  /*
   * The second line on a chart, and why it is ink rather than a second hue.
   *
   * This palette carries one hue and one cast of neutral — there is no second hue in
   * it at all — so two colours drawn from it collapse under the normal-vision
   * separation check: violet against mist measures far below the floor, as copper against stone did — ΔE 11.7 in light and 14.5
   * in dark, against a floor of 15. Full-colour readers cannot reliably tell
   * those two lines apart, and secondary encoding does not excuse that one.
   *
   * So charts with two series use emphasis rather than category: the series
   * that matters takes `chart-mark`, and its context takes near-black ink in
   * light and near-white in dark. That pair measures ΔE 34.7 and 30.1. Reading
   * as neutral is the point, not a defect.
   *
   * Different steps per theme for the same reason `chart-mark` is: each has to
   * clear 3:1 against its own surface, and no single value does both.
   */
  'chart-context': {
    light: palette.obsidian[900],
    dark: palette.mist[100],
    usage: 'The supporting series on a two-line chart. Deliberately neutral against the accent.',
  },
  'chart-grid': {
    light: palette.mist[200],
    dark: palette.obsidian[700],
    usage: 'Gridlines and axis rules. Deliberately recessive — this is not data.',
  },

  // ---------------------------------------------------------- primary action
  /*
   * The primary action is ink, not a brand colour.
   *
   * There is deliberately no blue in this palette. A near-black button on pale
   * ground is the most confident control available and needs no hue to justify
   * itself; reaching for a blue here would have quietly reintroduced the look
   * the repalette exists to leave behind. Violet stays the accent, which means
   * it keeps its meaning — a screen with one violet element has one thing worth
   * looking at.
   */
  primary: {
    light: palette.obsidian[800],
    dark: palette.mist[100],
    usage: 'Primary buttons, active nav, links.',
  },
  'primary-hover': {
    light: palette.obsidian[900],
    dark: palette.white,
    usage: 'Primary action hover state.',
  },
  'primary-active': {
    light: palette.obsidian[700],
    dark: palette.mist[200],
    usage: 'Primary action pressed state.',
  },
  'primary-subtle': {
    light: palette.mist[200],
    dark: palette.obsidian[700],
    usage: 'Tinted background for selected rows, active filter chips.',
  },
  'primary-fg': {
    light: palette.mist[50],
    dark: palette.obsidian[900],
    usage: 'Foreground on a solid primary fill.',
  },

  // ------------------------------------------------------------------ accent
  accent: {
    light: palette.violet[600],
    dark: palette.violet[400],
    usage:
      'Violet, the one accent. Eyebrows, rules, the verified mark, one emphasis per screen. Never a surface.',
  },
  'accent-subtle': {
    light: palette.violet[50],
    dark: palette.violet[900],
    usage: 'Accent-tinted background behind a badge or callout.',
  },
  'accent-fg': {
    light: palette.mist[50],
    dark: palette.mist[50],
    usage:
      'Foreground on a solid accent fill. Violet 600 is dark enough to take light text; 400 is not, which is why the fill uses the darker step.',
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
   * Violet would have been the obvious substitute for the blue that was here,
   * and it is the wrong answer: the accent's job is that one violet element on
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
    light: palette.obsidian[900],
    dark: palette.black,
    usage: 'Modal scrim — always applied at reduced opacity.',
  },
} as const satisfies Record<string, ColorRole>;

export type ColorRoleName = keyof typeof colorRoles;
