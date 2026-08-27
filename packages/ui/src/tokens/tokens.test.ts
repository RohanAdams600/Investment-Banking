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
    expect(palette.stone[50]).toBe('#FAF8F4');
    expect(palette.stone[900]).toBe('#2E2A24');
  });

  it('keeps the neutral ramp warm', () => {
    /*
     * The single change that does most of the work in this palette.
     *
     * A cool grey ground is what every financial product uses and what a
     * template produces; a warm one reads as printed rather than rendered, and
     * this product is read for long stretches by people comparing numbers.
     *
     * "Warm" is checkable: the red channel must exceed the blue channel at every
     * step. A future edit that quietly cools the ramp back toward blue-grey
     * fails here rather than being noticed months later as "it looks generic
     * again".
     */
    for (const [step, hex] of Object.entries(palette.stone)) {
      const r = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(r, `stone.${step} (${hex}) should be warm`).toBeGreaterThan(b);
    }
  });

  it('has no blue family at all', () => {
    // Reaching for a blue is how this palette reverts. The primary action is
    // ink and the accent is copper; neither needs a hue to justify itself.
    expect(palette).not.toHaveProperty('blue');
    expect(palette).not.toHaveProperty('gold');
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
