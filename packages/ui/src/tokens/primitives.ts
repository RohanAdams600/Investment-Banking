/**
 * Primitive color values — the raw palette.
 *
 * These are the only place in the codebase where a literal hex color may appear.
 * Everything else references a semantic role (see `semantic.ts`), which in turn
 * resolves to a CSS variable. Swapping the palette therefore means editing this
 * file and re-running `pnpm --filter @ib/ui tokens:build`, with no component
 * changes — which is how this repalette was done.
 *
 * ## Why obsidian and violet
 *
 * It was navy and gold, then limestone and copper. Navy is what every financial
 * product reaches for, and a marketplace that looks like a template is asking to
 * be trusted with somebody's life's work while looking like it was assembled in
 * an afternoon. Limestone and copper solved that and had a different problem: it
 * read as quiet and printed, which is right for a document and wrong for a place
 * you are meant to arrive at and start searching.
 *
 * Obsidian is volcanic glass — black, but not a neutral black: it carries a
 * violet sheen at the edges, which is exactly the relationship this palette
 * needs between its ground and its accent. So the ink is a near-black with a
 * violet cast rather than a green or blue one, the neutrals are cooled just
 * enough to sit under it without turning grey-blue, and the single accent is the
 * violet the ground already implies.
 *
 * The name still fits. An ashlar is dressed, squared stone; obsidian ashlar is
 * polished black block, and the coursed-masonry motif in the hero reads better
 * on black than it did on limestone.
 *
 * ## The rule that has not changed
 *
 * One accent. Violet is for eyebrows, rules, the verified mark and a single
 * emphasis per screen — never a surface, never a second brand colour. A screen
 * with one violet element has one thing worth looking at; a screen with nine has
 * none. `contrast.test.ts` holds the measurable half of this.
 */

export const palette = {
  /**
   * Obsidian. The ink, and every dark ground in the product.
   *
   * Near-black with a violet cast: blue exceeds green at every step, and red
   * sits between them, which is what gives volcanic glass its sheen rather than
   * reading as a flat neutral or as the blue-black of a bank. 950 is the deepest
   * ground — the hero slab and the closing band — and 900 is the ordinary dark
   * surface, so the two can sit next to each other without either disappearing.
   */
  obsidian: {
    50: '#F5F4F8',
    100: '#E8E6EF',
    200: '#CFCBDC',
    300: '#ADA7C0',
    400: '#857EA0',
    500: '#625A7D',
    600: '#4A4360',
    700: '#363048',
    800: '#251F35',
    900: '#171227',
    950: '#0D0916',
  },

  /**
   * Mist. The page ground, the rules, the quiet text.
   *
   * Cool, but only just: a faint violet tint at every step so the light theme
   * belongs to the same palette as the dark one, without tipping into the
   * blue-grey that every other financial product uses. Blue exceeds red here
   * too, which is the checkable version of that intent.
   */
  mist: {
    50: '#FBFAFD',
    100: '#F5F3F9',
    200: '#EAE7F1',
    300: '#D8D4E3',
    400: '#B6B0C6',
    500: '#918AA5',
    600: '#726B85',
    700: '#575064',
    800: '#413B4D',
    900: '#292434',
  },

  /**
   * Violet. One accent, used sparingly.
   *
   * 600 is the step that carries text on a light ground — it measures past the
   * 4.5:1 body threshold on both `canvas` and `surface`, so the accent can be a
   * link and an eyebrow rather than decoration only. 400 is its counterpart on
   * a dark ground. Both are held by `contrast.test.ts`.
   */
  violet: {
    50: '#F8F4FE',
    100: '#EFE7FC',
    200: '#DECDF9',
    300: '#C4A5F2',
    400: '#A87DE8',
    500: '#8B54DA',
    600: '#7130BE',
    700: '#5A2599',
    800: '#441C75',
    900: '#2D124F',
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
