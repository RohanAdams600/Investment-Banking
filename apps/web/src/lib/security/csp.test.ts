import { afterEach, describe, expect, it } from 'vitest';

import { buildCsp, cspHeaderName, isCspEnforced, supabaseOrigins } from './csp';

const NONCE = 'abc123';
const SUPABASE = 'https://treltiukpuxhnzuplegu.supabase.co';

const policy = (over: Partial<Parameters<typeof buildCsp>[0]> = {}) =>
  buildCsp({ nonce: NONCE, supabaseUrl: SUPABASE, ...over });

/** Pulls one directive's value out of a policy string. */
function directive(csp: string, name: string): string | null {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ?? null;
}

describe('supabaseOrigins', () => {
  it('returns the https origin and its websocket form', () => {
    // Realtime subscriptions use wss against the same host. A policy that
    // forgets it breaks the deal room's live messages in a way that looks like
    // a bug in the messages.
    expect(supabaseOrigins(SUPABASE)).toEqual([
      'https://treltiukpuxhnzuplegu.supabase.co',
      'wss://treltiukpuxhnzuplegu.supabase.co',
    ]);
  });

  it('handles a self-hosted http origin', () => {
    expect(supabaseOrigins('http://localhost:54321')).toEqual([
      'http://localhost:54321',
      'ws://localhost:54321',
    ]);
  });

  it('yields nothing rather than a wildcard for a malformed URL', () => {
    // The app is already broken in that state. The policy should not paper
    // over it by opening up.
    expect(supabaseOrigins('not a url')).toEqual([]);
    expect(supabaseOrigins(null)).toEqual([]);
    expect(supabaseOrigins(undefined)).toEqual([]);
  });
});

describe('buildCsp', () => {
  it('carries the nonce into script-src', () => {
    expect(directive(policy(), 'script-src')).toContain(`'nonce-${NONCE}'`);
  });

  it('never allows inline scripts', () => {
    // The whole point. Inline script execution is what XSS needs, and
    // 'unsafe-inline' in script-src gives up most of what a CSP is for.
    expect(directive(policy(), 'script-src')).not.toContain('unsafe-inline');
  });

  it('never allows eval in production', () => {
    expect(policy({ development: false })).not.toContain('unsafe-eval');
  });

  it('allows eval only for the dev server', () => {
    expect(directive(policy({ development: true }), 'script-src')).toContain(`'unsafe-eval'`);
  });

  it('includes strict-dynamic, without which Next cannot load its chunks', () => {
    expect(directive(policy(), 'script-src')).toContain(`'strict-dynamic'`);
  });

  it('lets the browser reach Supabase over both https and websockets', () => {
    const connect = directive(policy(), 'connect-src') ?? '';
    expect(connect).toContain('https://treltiukpuxhnzuplegu.supabase.co');
    expect(connect).toContain('wss://treltiukpuxhnzuplegu.supabase.co');
  });

  it('does not name the AI providers, because the browser never calls them', () => {
    // Every model call goes through the server-side router. A connect-src entry
    // for api.anthropic.com would be a standing invitation to make one from the
    // client, which is also where the API key would then have to be.
    const csp = policy();
    expect(csp).not.toContain('anthropic.com');
    expect(csp).not.toContain('openai.com');
  });

  it('forbids being framed, and forbids framing anything', () => {
    expect(directive(policy(), 'frame-ancestors')).toBe(`frame-ancestors 'none'`);
    expect(directive(policy(), 'frame-src')).toBe(`frame-src 'none'`);
  });

  it('locks down object-src and base-uri', () => {
    expect(directive(policy(), 'object-src')).toBe(`object-src 'none'`);
    expect(directive(policy(), 'base-uri')).toBe(`base-uri 'self'`);
  });

  it('stops a compromised page posting a deal room somewhere else', () => {
    expect(directive(policy(), 'form-action')).toBe(`form-action 'self'`);
  });

  it('allows blob: images, which the vault needs for downloads', () => {
    expect(directive(policy(), 'img-src')).toContain('blob:');
  });

  it('upgrades insecure requests in an enforced production policy', () => {
    expect(policy({ development: false, enforced: true })).toContain('upgrade-insecure-requests');
  });

  it('leaves it out in development, where localhost is http', () => {
    expect(policy({ development: true, enforced: true })).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it('leaves it out of a report-only policy', () => {
    /*
     * Browsers ignore this directive when it arrives report-only, and log a
     * console warning saying so — on every page load, for every visitor. It
     * bought nothing and was noisy, and a directive that is present but inert
     * reads like coverage to anyone auditing the header.
     *
     * Found by rendering the site in a real browser and reading the console,
     * which is the only way this class of thing gets found.
     */
    expect(policy({ development: false, enforced: false })).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it('contains no wildcard source anywhere', () => {
    // A single `*` turns the whole policy into decoration, and it is the kind
    // of thing that gets added to fix one broken image.
    const csp = policy();
    for (const part of csp.split(';')) {
      expect(part.trim().split(/\s+/).slice(1)).not.toContain('*');
    }
  });

  it('still produces a usable policy with no Supabase configured', () => {
    // CI builds with no secrets. A policy that threw here would fail the build
    // for a reason unrelated to the change being built.
    const csp = policy({ supabaseUrl: null });
    expect(directive(csp, 'connect-src')).toBe(`connect-src 'self'`);
    expect(directive(csp, 'default-src')).toBe(`default-src 'self'`);
  });
});

describe('cspHeaderName', () => {
  it('reports rather than enforces by default', () => {
    // A CSP that breaks production is a worse outage than no CSP is a
    // vulnerability. Report-only says so in the header name, which is not the
    // same failure as a permissive enforcing policy that claims a protection it
    // does not provide.
    expect(cspHeaderName(false)).toBe('Content-Security-Policy-Report-Only');
  });

  it('enforces when asked', () => {
    expect(cspHeaderName(true)).toBe('Content-Security-Policy');
  });
});

describe('isCspEnforced', () => {
  const original = process.env.CSP_ENFORCE;
  afterEach(() => {
    if (original === undefined) delete process.env.CSP_ENFORCE;
    else process.env.CSP_ENFORCE = original;
  });

  it('enforces when the variable is absent', () => {
    /*
     * The whole point of the inversion, and the reason it is a test rather than
     * a comment.
     *
     * This read `=== 'true'`, so a deployment that forgot the variable shipped
     * a policy that enforced nothing — and said nothing about it. Forgetting a
     * variable is the single likeliest thing to happen to a deployment, and it
     * must not be what silently removes a control. Anybody tempted to restore
     * the old default has to delete this test to do it.
     */
    delete process.env.CSP_ENFORCE;
    expect(isCspEnforced()).toBe(true);
  });

  it('enforces for any value except the exact opt-out', () => {
    // A typo must fail safe. `CSP_ENFORCE=flase` enforces.
    for (const value of ['true', 'yes', '1', '', 'flase', 'FALSE', 'no']) {
      process.env.CSP_ENFORCE = value;
      expect(isCspEnforced(), `CSP_ENFORCE=${value}`).toBe(true);
    }
  });

  it('reports the escape hatch only for a deliberate lowercase false', () => {
    process.env.CSP_ENFORCE = 'false';
    expect(isCspEnforced()).toBe(false);
    expect(cspHeaderName(isCspEnforced())).toBe('Content-Security-Policy-Report-Only');
  });
});
