/**
 * Tailwind preset. Every app in the workspace extends this rather than
 * declaring its own theme, so the marketing site and the authenticated app
 * cannot drift apart.
 *
 * Consumed as:
 *   import preset from '@ib/ui/tailwind-preset';
 *   export default { presets: [preset], content: [...] } satisfies Config;
 */

import type { Config } from 'tailwindcss';
import { palette } from './primitives';
import { colorRoles } from './semantic';
import { fontFamilies, fontSizes, fontWeights } from './typography';
import { elevation, motion, radii, spacingExtensions, zIndex } from './layout';
import { roleColor } from './utils';

/** Semantic roles, each pointing at its CSS variable. These are the ones to use. */
const semanticColors = Object.fromEntries(
  Object.keys(colorRoles).map((role) => [role, roleColor(role)]),
) as Record<keyof typeof colorRoles, string>;

const preset = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [],
  theme: {
    extend: {
      colors: {
        ...semanticColors,
        // Primitives stay reachable (`bg-violet-500`) for the rare case that needs
        // a specific step — charts, illustrations, brand surfaces. Prefer roles.
        obsidian: palette.obsidian,
        mist: palette.mist,
        violet: palette.violet,
      },
      fontFamily: fontFamilies,
      fontSize: fontSizes,
      fontWeight: fontWeights,
      spacing: spacingExtensions,
      borderRadius: radii,
      boxShadow: elevation,
      zIndex,
      transitionDuration: {
        fast: motion.duration.fast,
        DEFAULT: motion.duration.base,
        base: motion.duration.base,
        slow: motion.duration.slow,
      },
      transitionTimingFunction: {
        DEFAULT: motion.easing.standard,
        standard: motion.easing.standard,
        enter: motion.easing.enter,
        exit: motion.easing.exit,
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up-fade': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /** Loading skeletons — a sweep, not a pulse. Less noisy on dense tables. */
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': `fade-in ${motion.duration.base} ${motion.easing.enter}`,
        'slide-up-fade': `slide-up-fade ${motion.duration.base} ${motion.easing.enter}`,
        shimmer: `shimmer 1.6s ${motion.easing.standard} infinite`,
      },
    },
  },
  plugins: [],
} satisfies Config;

export default preset;
