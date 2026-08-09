import type { Config } from 'tailwindcss';
import preset from '@ib/ui/tailwind-preset';

/**
 * The app declares no theme of its own — every token comes from the shared
 * preset in `packages/ui`. If a value is missing here, add it to the preset so
 * the marketing site and the authenticated app stay in step.
 */
export default {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx,mdx}',
    // The shared library's own classes must be scanned too, or its styles are
    // purged out of the production build.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
