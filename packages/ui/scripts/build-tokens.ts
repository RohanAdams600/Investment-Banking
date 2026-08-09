/**
 * Generates `src/styles/tokens.css` from the TypeScript token source.
 *
 * The generated file is committed so that the app has no build-time dependency
 * on this script; run `pnpm --filter @ib/ui tokens:build` after editing any
 * token file. CI verifies the committed output is current (`tokens:check`),
 * which is what stops the TS source and the CSS from silently diverging.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { colorRoles } from '../src/tokens/semantic';
import { elevation, motion, radii, zIndex } from '../src/tokens/layout';
import { cssVarName, hexToRgbChannels } from '../src/tokens/utils';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../src/styles/tokens.css');

function colorBlock(mode: 'light' | 'dark'): string {
  return Object.entries(colorRoles)
    .map(([role, def]) => `  ${cssVarName(role)}: ${hexToRgbChannels(def[mode])};`)
    .join('\n');
}

function staticBlock(): string {
  const lines: string[] = [];

  for (const [name, value] of Object.entries(radii)) {
    lines.push(`  --radius-${name === 'DEFAULT' ? 'base' : name}: ${value};`);
  }
  for (const [name, value] of Object.entries(elevation)) {
    lines.push(`  --shadow-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(motion.duration)) {
    lines.push(`  --duration-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(motion.easing)) {
    lines.push(`  --ease-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(zIndex)) {
    lines.push(`  --z-${name}: ${value};`);
  }

  return lines.join('\n');
}

function render(): string {
  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source of truth: packages/ui/src/tokens/*.ts
 * Regenerate with: pnpm --filter @ib/ui tokens:build
 *
 * Theme resolution has three states, and all three are covered below:
 *   1. no attribute        -> light palette on :root, dark via prefers-color-scheme
 *   2. data-theme="light"  -> forced light, wins over the media query
 *   3. data-theme="dark"   -> forced dark, wins over the media query
 */

:root {
  color-scheme: light;

${colorBlock('light')}

${staticBlock()}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;

${colorBlock('dark')
  .split('\n')
  .map((l) => `  ${l}`)
  .join('\n')}
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;

${colorBlock('dark')}
}
`;
}

const css = render();

const isCheck = process.argv.includes('--check');
if (isCheck) {
  let existing = '';
  try {
    existing = readFileSync(OUT_PATH, 'utf8');
  } catch {
    console.error('tokens.css is missing. Run: pnpm --filter @ib/ui tokens:build');
    process.exit(1);
  }
  if (existing !== css) {
    console.error(
      'tokens.css is out of date with the TypeScript token source.\n' +
        'Run: pnpm --filter @ib/ui tokens:build',
    );
    process.exit(1);
  }
  console.log('tokens.css is up to date.');
} else {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, css, 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
}
