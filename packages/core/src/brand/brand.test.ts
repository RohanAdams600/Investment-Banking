import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { brand, brandDefaults, pageTitle } from './index';

/**
 * The brand name lives in one environment variable, and this file is how that
 * stays true.
 *
 * `packages/core/src/brand/index.ts` has claimed since the first commit that the
 * company name "is deliberately NOT hard-coded anywhere in the codebase". It was
 * not true. Renaming from Cairn to Ashlar turned up fourteen literal "Cairn"
 * strings — eight of them in copy a customer reads, including a disclosure on
 * the listing page and a card title in the admin panel.
 *
 * That is the expensive kind of wrong: the claim in the comment is exactly what
 * stops anybody checking. A rename that misses a disclosure leaves the old
 * company's name on a legal notice, which is worse than leaving it on a heading.
 *
 * So the invariant is asserted rather than asserted-in-prose. The scan runs over
 * committed sources via `git grep`, which is fast and has no opinion about
 * whether a match is in a comment or a JSX string — both are wrong.
 */

/** Names this repository has shipped under. A rename appends; it never replaces. */
const FORMER_AND_CURRENT_NAMES = ['Cairn', 'Ashlar'];

function gitGrep(pattern: string, pathspecs: string[]): string[] {
  try {
    return execFileSync('git', ['grep', '-n', '-I', '-w', pattern, '--', ...pathspecs], {
      cwd: new URL('../../../../', import.meta.url).pathname,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    // git grep exits 1 with no output when nothing matched, which is the
    // passing case. Anything else is a broken scan and should surface.
    const failure = error as { status?: number; stdout?: string };
    if (failure.status === 1 && !failure.stdout) return [];
    throw error;
  }
}

/**
 * Everything a user could read, plus the schema. Test fixtures are excluded on
 * purpose — a firm called "Ridge Brokerage" in a row of seed data is not a brand
 * surface, and forbidding proper nouns there would be noise.
 */
const USER_FACING = [
  'apps/web/src/**/*.ts',
  'apps/web/src/**/*.tsx',
  'apps/web/src/**/*.svg',
  'packages/ui/src/**/*.ts',
  'packages/ui/src/**/*.tsx',
  ':!**/*.test.ts',
  ':!**/*.test.tsx',
];

describe('brand configuration', () => {
  it('reads the name from configuration rather than a literal', () => {
    expect(brand.name).toBe(brandDefaults.name);
    expect(brand.name.length).toBeGreaterThan(0);
  });

  it('builds titles that name the product and say what it is', () => {
    // The bare title is a search result read by somebody who has never heard of
    // us. "Ashlar" alone tells them nothing.
    expect(pageTitle()).toBe(`${brand.name} — ${brand.tagline}`);
    expect(pageTitle('Deal room')).toBe(`Deal room | ${brand.name}`);
    expect(brand.tagline.split(' ').length).toBeGreaterThan(2);
  });

  it('hard-codes no company name anywhere a user can read', () => {
    const offenders = FORMER_AND_CURRENT_NAMES.flatMap((name) => gitGrep(name, USER_FACING));

    expect(
      offenders,
      `Use {brand.name} instead of the literal. Found:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('hard-codes no company name in a migration or a policy', () => {
    // A brand name baked into a check constraint or a policy comment survives
    // the rename and then contradicts the product for the rest of its life.
    const offenders = FORMER_AND_CURRENT_NAMES.flatMap((name) =>
      gitGrep(name, ['supabase/migrations/*.sql']),
    );

    expect(offenders, `Found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
