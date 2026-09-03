import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The routes that must render dynamically, and why losing this is silent.
 *
 * ## The trap
 *
 * The Content Security Policy is nonce-based with `strict-dynamic`. The nonce
 * is minted per request in `src/middleware.ts` and Next stamps it onto its
 * script tags **during the render**. A statically prerendered page's HTML was
 * generated at build time, before any nonce existed, so it carries none — and
 * under `strict-dynamic` a script without the nonce is refused, with `'self'`
 * ignored.
 *
 * The result is a page that returns 200, looks correct in `view-source`, and is
 * completely dead in a browser: every script blocked, no hydration, no client
 * interactivity. Nothing in a build, a typecheck, a lint or any other test in
 * this repository notices. It was found by opening the pages with the console
 * attached, and only after the enforcement default was flipped.
 *
 * ## What this test does and does not prove
 *
 * It proves these five routes still declare `force-dynamic`. It does not prove
 * a *new* page is safe — that cannot be decided from the source, because it
 * depends on whether Next chose to prerender it, which depends on everything
 * the page transitively imports.
 *
 * So the rule for a new page with client JavaScript is: check the build output.
 * A `○` next to the route means static, which means every script on it will be
 * refused in production. `ƒ` is fine. That instruction is here rather than in a
 * document nobody opens.
 */

const REQUIRE_DYNAMIC = [
  'page.tsx',
  'sell/page.tsx',
  'pricing/page.tsx',
  '(auth)/sign-in/page.tsx',
  '(auth)/sign-up/page.tsx',
];

describe('routes that must not be statically prerendered', () => {
  for (const relative of REQUIRE_DYNAMIC) {
    it(`${relative} declares force-dynamic`, () => {
      const source = readFileSync(new URL(relative, import.meta.url).pathname, 'utf8');

      /*
       * Matched loosely on purpose. The point is that the export exists at all,
       * not that it is formatted a particular way — a test that fails on
       * whitespace teaches people to delete tests.
       */
      expect(
        /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(source),
        `${relative} lost its force-dynamic export. Under an enforcing CSP every ` +
          `script on this page will be refused and it will render as dead HTML. ` +
          `See the note at the top of this file.`,
      ).toBe(true);
    });
  }
});
