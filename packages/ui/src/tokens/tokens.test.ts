import { describe, expect, it } from 'vitest';

import { colorRoles } from './semantic';
import { palette } from './primitives';
import { fontSizes } from './typography';
import { cssVarName, hexToRgbChannels, roleColor } from './utils';

describe('hexToRgbChannels', () => {
  it('converts 6-digit hex to space-separated channels', () => {
    expect(hexToRgbChannels('#1E3A5F')).toBe('30 58 95');
  });

  it('expands 3-digit shorthand', () => {
    expect(hexToRgbChannels('#FFF')).toBe('255 255 255');
  });

  it('accepts values with no leading hash and mixed case', () => {
    expect(hexToRgbChannels('c9a24b')).toBe('201 162 75');
  });

  it('rejects malformed input instead of emitting NaN channels', () => {
    // A NaN here would produce `rgb(NaN NaN NaN)` — a silently invisible
    // element rather than a build failure, which is far harder to trace.
    expect(() => hexToRgbChannels('#12345')).toThrow(/Invalid hex color/);
    expect(() => hexToRgbChannels('navy')).toThrow(/Invalid hex color/);
  });
});

describe('color roles', () => {
  it('defines a light and dark value for every role', () => {
    for (const [role, def] of Object.entries(colorRoles)) {
      expect(def.light, `${role}.light`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(def.dark, `${role}.dark`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('documents the intended usage of every role', () => {
    // Undocumented roles get misused, which is how a design system drifts.
    for (const [role, def] of Object.entries(colorRoles)) {
      expect(def.usage.length, `${role}.usage`).toBeGreaterThan(10);
    }
  });

  it('produces Tailwind color values that support the opacity modifier', () => {
    expect(roleColor('surface')).toBe('rgb(var(--color-surface) / <alpha-value>)');
    expect(cssVarName('text-muted')).toBe('--color-text-muted');
  });

  it('anchors the neutral ramp to the specified endpoints', () => {
    expect(palette.mist[50]).toBe('#FBFAFD');
    expect(palette.mist[900]).toBe('#292434');
  });

  it('gives every neutral a violet cast rather than leaving it grey', () => {
    /*
     * The single change that does most of the work in this palette.
     *
     * Obsidian is volcanic glass: black with a violet sheen, not a neutral
     * black. If the grounds and the accent do not share that cast, the violet
     * reads as a colour that was dropped on top of a grey product rather than
     * one the product is made of — which is what a theme swap looks like, and
     * what this is not.
     *
     * "Violet cast" is checkable at every step of both dark and neutral ramps:
     * blue must exceed green, and red must sit between them. A future edit that
     * quietly flattens the ramp back toward grey, or tips it into the blue-grey
     * every other financial product uses, fails here rather than being noticed
     * months later as "it looks generic again".
     */
    for (const family of ['obsidian', 'mist'] as const) {
      for (const [step, hex] of Object.entries(palette[family])) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        expect(b, `${family}.${step} (${hex}) should lean violet, not green`).toBeGreaterThan(g);
        expect(r, `${family}.${step} (${hex}) should sit between blue and green`).toBeGreaterThan(g);
        expect(r, `${family}.${step} (${hex}) should not out-run blue into red`).toBeLessThan(b);
      }
    }
  });

  it('keeps the deepest ground darker than the ordinary dark surface', () => {
    // 950 is the hero slab and the closing band; 900 is the dark card that sits
    // on it. Collapsing the two would make the page one flat field.
    const lum = (hex: string) =>
      [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    expect(lum(palette.obsidian[950])).toBeLessThan(lum(palette.obsidian[900]));
  });

  it('has no second brand hue', () => {
    /*
     * Reaching for a blue, or keeping the old copper alongside the violet, is
     * how this palette reverts. One accent is the whole discipline: a screen
     * with one violet element has one thing worth looking at, and a screen with
     * two brand hues has none.
     */
    expect(palette).not.toHaveProperty('blue');
    expect(palette).not.toHaveProperty('gold');
    expect(palette).not.toHaveProperty('copper');
  });
});

describe('type scale', () => {
  it('pairs every size with an explicit line height', () => {
    for (const [token, [size, config]] of Object.entries(fontSizes)) {
      expect(size, `${token} size`).toMatch(/rem$/);
      expect(config.lineHeight, `${token} lineHeight`).toMatch(/rem$/);
    }
  });
});
