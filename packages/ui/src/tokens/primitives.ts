/**
 * Primitive color values — the raw palette.
 *
 * These are the only place in the codebase where a literal hex color may appear.
 * Everything else references a semantic role (see `semantic.ts`), which in turn
 * resolves to a CSS variable. Swapping the palette therefore means editing this
 * file and re-running `pnpm --filter @ib/ui tokens:build`, with no component changes.
 */

export const palette = {
  /** Deep navy / ink. Headers, primary nav, dark surfaces. */
  ink: {
    50: '#F5F7FA',
    100: '#E6EAF1',
    200: '#C4CCDA',
    300: '#96A3B9',
    400: '#5F6E88',
    500: '#3A4860',
    600: '#243247',
    700: '#172336',
    800: '#101A29',
    900: '#0B1220',
  },

  /** Institutional blue. Primary actions, links. */
  blue: {
    50: '#EEF3F9',
    100: '#D8E4F0',
    200: '#B0C6DF',
    300: '#82A3C8',
    400: '#5580AE',
    500: '#356291',
    600: '#1E3A5F',
    700: '#1A3352',
    800: '#142842',
    900: '#0F1E31',
  },

  /**
   * Champagne / gold. Premium accents only — badges, "Verified" marks,
   * a single highlighted CTA. Never a dominant surface color.
   */
  gold: {
    50: '#FBF7EE',
    100: '#F5ECD6',
    200: '#EBD9AE',
    300: '#DEC17F',
    400: '#D3B063',
    500: '#C9A24B',
    600: '#AB863A',
    700: '#86682C',
    800: '#614B1F',
    900: '#3D2F13',
  },

  /** 10-step neutral ramp, near-white to near-black, cool-tinted toward ink. */
  gray: {
    50: '#F8F9FB',
    100: '#EFF1F5',
    200: '#DFE3EA',
    300: '#C6CDD9',
    400: '#9AA5B7',
    500: '#6E7B90',
    600: '#525E71',
    700: '#3B4655',
    800: '#26303D',
    900: '#0B1220',
  },

  success: {
    50: '#ECF7F1',
    100: '#D0EBDF',
    500: '#1F8A5A',
    600: '#1A7449',
    700: '#145838',
  },

  warning: {
    50: '#FBF5E6',
    100: '#F4E7C2',
    500: '#B8860B',
    600: '#9C7009',
    700: '#785607',
  },

  danger: {
    50: '#FBEDEC',
    100: '#F5D4D1',
    500: '#B3261E',
    600: '#961F19',
    700: '#741813',
  },

  info: {
    50: '#EAF1F9',
    100: '#CCDEEF',
    500: '#2563A6',
    600: '#1F538C',
    700: '#18406C',
  },

  white: '#FFFFFF',
  black: '#000000',
} as const;

export type Palette = typeof palette;
export type PaletteFamily = keyof Palette;
