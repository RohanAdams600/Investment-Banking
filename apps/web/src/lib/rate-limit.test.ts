import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RATE_LIMITS,
  checkAnonymousRateLimit,
  checkRateLimit,
  isSharedRateLimiterConfigured,
  setRateLimiter,
  type RateLimiter,
} from './rate-limit';

/** Records every key it is asked about, so the keying itself can be asserted. */
class RecordingLimiter implements RateLimiter {
  keys: string[] = [];
  counts = new Map<string, number>();

  async check(key: string, limit: number, windowMs: number) {
    this.keys.push(key);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: Date.now() + windowMs };
  }
}

describe('rate limiting', () => {
  let recorder: RecordingLimiter;

  beforeEach(() => {
    recorder = new RecordingLimiter();
    setRateLimiter(recorder);
  });

  it('keys authenticated limits on the account, not the address', async () => {
    await checkRateLimit('sendMessage', 'user-a', 'conversation-1');
    await checkRateLimit('sendMessage', 'user-b', 'conversation-1');

    expect(recorder.keys).toEqual([
      'sendMessage:user-a:conversation-1',
      'sendMessage:user-b:conversation-1',
    ]);
  });

  it('keeps anonymous keys in a separate namespace', async () => {
    /*
     * Otherwise a caller could present a user id as their "address" and consume
     * that account's budget for an unrelated action — or, worse, an address that
     * happens to match a user id would collide with a real person's limit.
     */
    await checkRateLimit('sendMessage', 'shared-value', undefined);
    await checkAnonymousRateLimit('interestSubmission', 'shared-value');

    expect(recorder.keys[0]).not.toBe(recorder.keys[1]);
    expect(recorder.keys[1]).toContain(':anon:');
  });

  it('refuses once the named limit is passed', async () => {
    const { limit } = RATE_LIMITS.interestSubmission;

    for (let i = 0; i < limit; i += 1) {
      const result = await checkAnonymousRateLimit('interestSubmission', '203.0.113.1');
      expect(result.allowed, `request ${i + 1} of ${limit}`).toBe(true);
    }

    const overflow = await checkAnonymousRateLimit('interestSubmission', '203.0.113.1');
    expect(overflow.allowed).toBe(false);
  });

  it('holds one budget per principal', async () => {
    const { limit } = RATE_LIMITS.interestSubmission;
    for (let i = 0; i < limit + 1; i += 1) {
      await checkAnonymousRateLimit('interestSubmission', 'exhausted');
    }

    const other = await checkAnonymousRateLimit('interestSubmission', 'fresh');
    expect(other.allowed).toBe(true);
  });

  it('covers the endpoints that take a credential from outside the browser', () => {
    // The MCP route had no limit at all until this audit. A limit removed from
    // RATE_LIMITS would fail to compile at the call site; a limit removed from
    // the *route* would not, so its existence is asserted here as well.
    expect(RATE_LIMITS.mcpRequest.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.mcpRequest.windowMs).toBeGreaterThan(0);
  });

  describe('whether the limits are real', () => {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    afterEach(() => {
      if (url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = url;
      if (token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = token;
    });

    it('reports false when either half of the configuration is missing', () => {
      /*
       * Both, not either. A URL with no token produces a limiter that fails
       * every request; the in-process fallback at least serves traffic. This is
       * the value preflight fails a strict run on.
       */
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      expect(isSharedRateLimiterConfigured()).toBe(false);

      process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
      expect(isSharedRateLimiterConfigured()).toBe(false);

      process.env.UPSTASH_REDIS_REST_TOKEN = '   ';
      expect(isSharedRateLimiterConfigured()).toBe(false);

      process.env.UPSTASH_REDIS_REST_TOKEN = 'a-token';
      expect(isSharedRateLimiterConfigured()).toBe(true);
    });
  });
});
