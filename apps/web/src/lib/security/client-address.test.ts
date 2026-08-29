import { describe, expect, it, vi } from 'vitest';

const headerStore = { value: new Map<string, string>() };

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => headerStore.value.get(name.toLowerCase()) ?? null,
  }),
}));

const { clientAddress } = await import('./client-address');

function withHeaders(entries: Record<string, string>) {
  headerStore.value = new Map(
    Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

/**
 * The header parsing that decides whether an address-keyed limit means
 * anything.
 *
 * `x-forwarded-for` is a list the client can prepend to. Reading its first
 * entry — the obvious implementation, and the one most code contains — lets an
 * attacker mint a fresh identity per request, at which point the limit is
 * decoration. These tests exist because that bug is invisible: the limiter runs,
 * the counter increments, and nothing is ever refused.
 */
describe('clientAddress', () => {
  it('prefers the header the platform sets', async () => {
    withHeaders({
      'x-vercel-forwarded-for': '203.0.113.7',
      'x-forwarded-for': '198.51.100.1, 203.0.113.7',
    });
    expect(await clientAddress()).toBe('203.0.113.7');
  });

  it('takes the last hop of x-forwarded-for, never the first', async () => {
    // The first entry is whatever the client sent. The last is what the edge
    // appended, and is the only value in the chain the client could not choose.
    withHeaders({ 'x-forwarded-for': '10.0.0.1, 172.16.0.1, 203.0.113.9' });
    expect(await clientAddress()).toBe('203.0.113.9');
  });

  it('cannot be given a fresh identity by a spoofed prefix', async () => {
    const first = await (async () => {
      withHeaders({ 'x-forwarded-for': 'attacker-choice-1, 203.0.113.9' });
      return clientAddress();
    })();

    const second = await (async () => {
      withHeaders({ 'x-forwarded-for': 'attacker-choice-2, 203.0.113.9' });
      return clientAddress();
    })();

    // Both requests key to the same bucket, which is the entire point.
    expect(first).toBe(second);
  });

  it('falls back to one shared bucket rather than to a unique value', async () => {
    /*
     * Deliberately not a random value or a timestamp. Those would look like a
     * working limiter while giving every caller their own budget — the exact
     * failure this file exists to prevent, reintroduced by a "sensible" default.
     */
    withHeaders({});
    expect(await clientAddress()).toBe('unknown');
    withHeaders({});
    expect(await clientAddress()).toBe('unknown');
  });

  it('ignores an empty or whitespace header', async () => {
    withHeaders({ 'x-vercel-forwarded-for': '   ', 'x-forwarded-for': '' });
    expect(await clientAddress()).toBe('unknown');
  });
});
