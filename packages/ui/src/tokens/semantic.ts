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
    light: palette.gray[50],
    dark: palette.ink[900],
    usage: 'Page background, furthest back.',
  },
  surface: {
    light: palette.white,
    dark: palette.ink[800],
    usage: 'Default card / panel / table background.',
  },
  'surface-raised': {
    light: palette.white,
    dark: palette.ink[700],
    usage: 'Popovers, dropdowns, modals — anything floating above a surface.',
  },
  'surface-sunken': {
    light: palette.gray[100],
    dark: palette.ink[900],
    usage: 'Wells, code blocks, inset table headers.',
  },
  'surface-inverted': {
    light: palette.ink[900],
    dark: palette.gray[50],
    usage: 'Deliberate contrast blocks — marketing bands, tooltips.',
  },

  // ------------------------------------------------------------------- text
  'text-primary': {
    light: palette.ink[900],
    dark: palette.gray[50],
    usage: 'Body copy and headings.',
  },
  'text-secondary': {
    light: palette.gray[700],
    dark: palette.gray[300],
    usage: 'Supporting copy, table cell secondary lines.',
  },
  'text-muted': {
    light: palette.gray[500],
    dark: palette.gray[400],
    usage: 'Labels, captions, placeholder, timestamps.',
  },
  'text-inverted': {
    light: palette.white,
    dark: palette.ink[900],
    usage: 'Text on `surface-inverted` or on a solid primary fill.',
  },

  // ---------------------------------------------------------------- borders
  'border-subtle': {
    light: palette.gray[200],
    dark: palette.ink[700],
    usage: 'Hairlines between rows, dividers.',
  },
  'border-default': {
    light: palette.gray[300],
    dark: palette.ink[600],
    usage: 'Input borders, card outlines.',
  },
  'border-strong': {
    light: palette.gray[400],
    dark: palette.gray[600],
    usage: 'Hovered inputs, emphasized separation.',
  },

  // ---------------------------------------------------------- primary action
  primary: {
    light: palette.blue[600],
    dark: palette.blue[400],
    usage: 'Primary buttons, active nav, links.',
  },
  'primary-hover': {
    light: palette.blue[700],
    dark: palette.blue[300],
    usage: 'Primary action hover state.',
  },
  'primary-active': {
    light: palette.blue[800],
    dark: palette.blue[200],
    usage: 'Primary action pressed state.',
  },
  'primary-subtle': {
    light: palette.blue[50],
    dark: palette.blue[900],
    usage: 'Tinted background for selected rows, active filter chips.',
  },
  'primary-fg': {
    light: palette.white,
    dark: palette.ink[900],
    usage: 'Foreground on a solid primary fill.',
  },

  // ------------------------------------------------------------------ accent
  accent: {
    light: palette.gold[500],
    dark: palette.gold[400],
    usage: 'Premium accent — Verified badges, one hero CTA. Use sparingly.',
  },
  'accent-subtle': {
    light: palette.gold[50],
    dark: palette.gold[900],
    usage: 'Accent-tinted background behind a badge or callout.',
  },
  'accent-fg': {
    light: palette.ink[900],
    dark: palette.ink[900],
    usage: 'Foreground on a solid accent fill (gold needs dark text in both themes).',
  },

  // --------------------------------------------------------------- semantic
  success: { light: palette.success[500], dark: palette.success[500], usage: 'Positive state.' },
  'success-subtle': {
    light: palette.success[50],
    dark: palette.success[700],
    usage: 'Success banner background.',
  },
  warning: { light: palette.warning[500], dark: palette.warning[500], usage: 'Caution state.' },
  'warning-subtle': {
    light: palette.warning[50],
    dark: palette.warning[700],
    usage: 'Warning banner background.',
  },
  danger: { light: palette.danger[500], dark: palette.danger[500], usage: 'Destructive / error.' },
  'danger-subtle': {
    light: palette.danger[50],
    dark: palette.danger[700],
    usage: 'Error banner background.',
  },
  info: { light: palette.info[500], dark: palette.info[500], usage: 'Neutral informational.' },
  'info-subtle': {
    light: palette.info[50],
    dark: palette.info[700],
    usage: 'Info banner background — also the default AI-disclaimer surface.',
  },

  // ------------------------------------------------------------------- misc
  ring: {
    light: palette.blue[500],
    dark: palette.blue[300],
    usage: 'Focus ring. Must stay visible against every surface role.',
  },
  overlay: {
    light: palette.ink[900],
    dark: palette.black,
    usage: 'Modal scrim — always applied at reduced opacity.',
  },
} as const satisfies Record<string, ColorRole>;

export type ColorRoleName = keyof typeof colorRoles;
