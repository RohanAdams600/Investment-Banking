/**
 * Token plumbing shared by the Tailwind preset and the CSS generator.
 *
 * Colors are emitted as space-separated RGB *channels* rather than finished
 * `rgb()` strings. That is what lets Tailwind's opacity modifiers keep working
 * against CSS-variable-backed colors — `bg-surface/60` expands to
 * `rgb(var(--color-surface) / 0.6)`, which is only valid if the variable holds
 * `255 255 255` and not `rgb(255,255,255)`.
 */

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#1E3A5F` -> `30 58 95`. Accepts 3- or 6-digit hex, with or without `#`. */
export function hexToRgbChannels(hex: string): string {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid hex color: "${hex}". Expected #RGB or #RRGGBB.`);
  }

  let digits = match[1] as string;
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((d) => d + d)
      .join('');
  }

  const int = Number.parseInt(digits, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;

  return `${r} ${g} ${b}`;
}

/** `text-muted` -> `--color-text-muted`. */
export function cssVarName(role: string): string {
  return `--color-${role}`;
}

/**
 * Builds the Tailwind color value for a role, wired to its CSS variable with
 * alpha support. Returns a function so Tailwind can inject `<alpha-value>`.
 */
export function roleColor(role: string) {
  return `rgb(var(${cssVarName(role)}) / <alpha-value>)`;
}
