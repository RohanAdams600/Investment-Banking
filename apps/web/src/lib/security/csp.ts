/**
 * The Content Security Policy.
 *
 * `docs/security.md` has carried this as a known gap since step 1, with a
 * specific reason: *a permissive placeholder CSP is worse than none, because it
 * looks like coverage.* The gap could not close until the real third-party
 * origins were known, and now they are — there is exactly one, Supabase, and
 * the AI providers are called server-side where no browser policy applies.
 *
 * ## Rolled out report-only first, on purpose
 *
 * A CSP that breaks the application in production is a worse outage than no CSP
 * is a vulnerability. `CSP_ENFORCE` decides which header this goes out as, and
 * it defaults to report-only. That is not the same failure the original note
 * warned about: a report-only policy is labelled, in the header name itself, as
 * not yet enforcing. A permissive enforcing one claims a protection it does not
 * provide.
 *
 * The rollout is: deploy report-only, walk the app, read the violations, then
 * set `CSP_ENFORCE=true`. `docs/deployment.md` carries it as a launch item.
 *
 * ## Nonces rather than 'unsafe-inline' for scripts
 *
 * Next injects inline scripts for hydration, so a script-src of `'self'` alone
 * breaks the app and `'unsafe-inline'` gives up most of what a CSP is for —
 * inline script execution is the thing XSS needs. The middleware mints a nonce
 * per request and Next applies it to its own tags, which is the documented
 * pattern and the only one that leaves the policy meaning something.
 *
 * `'strict-dynamic'` is included so scripts loaded *by* a nonced script inherit
 * trust. Without it, Next's chunk loading fails under a nonce policy.
 *
 * Styles still allow `'unsafe-inline'`, and that is a deliberate, smaller
 * concession: Next and Tailwind both emit inline style attributes, there is no
 * nonce plumbing for them, and injected CSS is a far weaker primitive than
 * injected script. Worth writing down rather than leaving for somebody to
 * discover.
 */

export interface CspOptions {
  nonce: string;
  /** The Supabase project URL, e.g. `https://abc.supabase.co`. */
  supabaseUrl?: string | null;
  /** Loosens the policy for the dev server's websocket and eval-based HMR. */
  development?: boolean;
}

/**
 * The origins a browser is allowed to talk to.
 *
 * Derived from the Supabase URL rather than hard-coded, so a project rename or
 * a self-hosted deployment does not silently produce a policy that blocks the
 * database. Returns both the https origin and its websocket form — realtime
 * subscriptions use `wss:` against the same host, and a policy that forgets it
 * breaks the deal room's live messages in a way that looks like a bug in the
 * messages.
 */
export function supabaseOrigins(supabaseUrl: string | null | undefined): string[] {
  if (!supabaseUrl) return [];

  try {
    const url = new URL(supabaseUrl);
    const https = `${url.protocol}//${url.host}`;
    const wss = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
    return [https, wss];
  } catch {
    // A malformed URL yields no origins rather than a wildcard. The app is
    // already broken in that state; the policy should not paper over it.
    return [];
  }
}

export function buildCsp(options: CspOptions): string {
  const supabase = supabaseOrigins(options.supabaseUrl);
  const [supabaseHttps] = supabase;

  const scriptSrc = [
    `'nonce-${options.nonce}'`,
    // Lets Next's chunk loader run: scripts loaded by a trusted script inherit
    // trust, which is what makes a nonce policy workable at all.
    `'strict-dynamic'`,
    // Ignored by browsers that understand strict-dynamic; kept for the ones
    // that do not, where it degrades to same-origin rather than to nothing.
    `'self'`,
    // The dev server compiles with eval. Never in production.
    ...(options.development ? [`'unsafe-eval'`] : []),
  ];

  const connectSrc = [
    `'self'`,
    ...supabase,
    // Next's dev-time HMR websocket.
    ...(options.development ? ['ws:'] : []),
  ];

  const directives: Record<string, string[]> = {
    'default-src': [`'self'`],
    'script-src': scriptSrc,
    // See the note above: a smaller concession than the script one, and made
    // knowingly.
    'style-src': [`'self'`, `'unsafe-inline'`],
    // `blob:` is for the vault's downloads; `data:` for inline icons. Supabase
    // storage serves signed URLs from the project origin.
    'img-src': [`'self'`, 'data:', 'blob:', ...(supabaseHttps ? [supabaseHttps] : [])],
    'font-src': [`'self'`, 'data:'],
    'connect-src': connectSrc,
    // Nothing on this platform embeds anything, and nothing may embed it.
    'frame-src': [`'none'`],
    'frame-ancestors': [`'none'`],
    'object-src': [`'none'`],
    'base-uri': [`'self'`],
    // Stops a form on a compromised page posting a deal room's contents
    // somewhere else.
    'form-action': [`'self'`],
  };

  const parts = Object.entries(directives).map(
    ([directive, values]) => `${directive} ${values.join(' ')}`,
  );

  if (!options.development) {
    // Mixed content is a downgrade attack on a product that moves confidential
    // documents. Not set in development, where localhost is http.
    parts.push('upgrade-insecure-requests');
  }

  return parts.join('; ');
}

/**
 * Which header to send it as.
 *
 * The default is report-only, and flipping it is a deployment decision rather
 * than a code change — see the rollout note above.
 */
export function cspHeaderName(enforce: boolean): string {
  return enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}

export function isCspEnforced(): boolean {
  return process.env.CSP_ENFORCE === 'true';
}
