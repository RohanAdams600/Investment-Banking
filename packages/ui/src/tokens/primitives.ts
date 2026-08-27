/**
 * Primitive color values — the raw palette.
 *
 * These are the only place in the codebase where a literal hex color may appear.
 * Everything else references a semantic role (see `semantic.ts`), which in turn
 * resolves to a CSS variable. Swapping the palette therefore means editing this
 * file and re-running `pnpm --filter @ib/ui tokens:build`, with no component changes.
 *
 * ## Why this is not navy and gold
 *
 * It was. Navy with a champagne accent is the palette every financial product
 * reaches for, which is exactly the problem: it is what a template produces, and
 * a marketplace that looks like a template is asking to be trusted with somebody's
 * life's work while looking like it was assembled in an afternoon.
 *
 * These colors come from the name instead. An ashlar is dressed, squared stone,
 * so the grounds are warm limestone rather than cool grey, the ink is a
 * near-black with a green cast rather than a blue one, and the single accent is
 * weathered copper — the metal that actually appears on old masonry. Nothing in
 * lower-middle-market M&A looks like this, because everyone in it copied each
 * other's navy.
 *
 * Warm neutrals are also a practical choice, not only an aesthetic one. This
 * product is read for long stretches by people comparing numbers, and a paper
 * ground is easier to sit with than a blue-white one.
 */

export const palette = {
  /**
   * Ink. Near-black with a green cast, which is what stops it reading as the
   * blue-black every other financial product uses.
   */
  slate: {
    50: '#F2F4F2',
    100: '#E2E7E4',
    200: '#C4CCC8',
    300: '#9FAAA5',
    400: '#78847E',
    500: '#57635D',
    600: '#3F4A45',
    700: '#2E3A38',
    800: '#242D2B',
    900: '#1F2421',
  },

  /**
   * Warm limestone. The page ground, the rules, the quiet text.
   *
   * Deliberately not a cool grey: a warm neutral makes the whole product read as
   * printed rather than rendered, and it is the single change that does most of
   * the work here.
   */
  stone: {
    50: '#FAF8F4',
    100: '#F7F4EF',
    200: '#EFEAE1',
    300: '#E0D9CD',
    400: '#C9BFAE',
    500: '#A99C87',
    600: '#877B68',
    700: '#6A5F50',
    800: '#4C443A',
    900: '#2E2A24',
  },

  /**
   * Weathered copper. One accent, used sparingly — eyebrows, rules, the
   * verified mark, a single emphasis per screen. Never a surface.
   *
   * 600 on stone-100 measures about 6.2:1, so it is legible as text rather than
   * decoration only.
   */
  copper: {
    50: '#FBF4EF',
    100: '#F4E6DA',
    200: '#E7CBB4',
    300: '#D6AA88',
    400: '#C08A63',
    500: '#A66E48',
    600: '#8C5A3C',
    700: '#71482F',
    800: '#543624',
    900: '#382418',
  },

  success: {
    /* Lifted for dark grounds — the 500 was drawn to sit on paper. */
    300: '#8FBF9C',
    50: '#EEF4EE',
    100: '#D5E5D6',
    500: '#3E7A4E',
    600: '#336440',
    700: '#264C31',
  },

  warning: {
    /* Lifted for dark grounds — the 500 was drawn to sit on paper. */
    300: '#D9B570',
    50: '#FBF3E4',
    100: '#F2E2BF',
    500: '#A67C2E',
    600: '#8A6525',
    700: '#6A4D1C',
  },

  danger: {
    /* Lifted for dark grounds — the 500 was drawn to sit on paper. */
    300: '#E39182',
    50: '#FAEDE9',
    100: '#F0D3CB',
    500: '#A33A28',
    600: '#8A2F20',
    700: '#6B2418',
  },

  info: {
    /* Lifted for dark grounds — the 500 was drawn to sit on paper. */
    300: '#8FB8C0',
    50: '#EDF2F3',
    100: '#D3E0E3',
    500: '#3D6F7A',
    600: '#325B64',
    700: '#26454C',
  },

  white: '#FFFFFF',
  black: '#000000',
} as const;

export type Palette = typeof palette;
export type PaletteFamily = keyof Palette;
