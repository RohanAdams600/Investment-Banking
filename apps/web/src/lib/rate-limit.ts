import 'server-only';

/**
 * Rate limiting.
 *
 * The interface is the point of this module. The default implementation is an
 * in-process fixed window, which is honest about what it is: it works on a
 * single instance and does not survive a restart. On Vercel, where each region
 * and each cold start gets its own memory, it is closer to a speed bump than a
 * limit.
 *
 * That is deliberate rather than an oversight. Building the seam first means the
 * swap is one implementation of `RateLimiter`, and every call site already
 * routes through it — rather than a later sweep to find every endpoint that
 * needed limiting.
 *
 * ## The shared implementation
 *
 * `UpstashRateLimiter` below is that swap, and it is selected automatically
 * when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set.
 * Until they are, every limit in this application is a comment: on a platform
 * that runs each request in its own isolate, an in-process counter starts at
 * zero every time, so an attacker never meets a window at all.
 *
 * That was previously written down in a comment and in a deployment doc, which
 * is not a control. `pnpm preflight --strict` now fails without a shared
 * limiter, so a production deploy cannot quietly ship believing it is limited.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** When the window resets, as epoch milliseconds. */
  resetAt: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

interface Window {
  count: number;
  resetAt: number;
}

class InMemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, Window>();

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const window = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, window);
      this.sweep(now);
      return { allowed: true, remaining: limit - 1, resetAt: window.resetAt };
    }

    existing.count += 1;
    return {
      allowed: existing.count <= limit,
      remaining: Math.max(0, limit - existing.count),
      resetAt: existing.resetAt,
    };
  }

  /** Without this the map grows for every key ever seen. */
  private sweep(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * A counter every instance shares, over Upstash's REST API.
 *
 * REST rather than a Redis client on purpose: this runs in serverless functions
 * that are frozen between invocations, where a pooled TCP connection is a
 * liability rather than an optimisation, and it adds no dependency to audit.
 *
 * The window is fixed rather than sliding. A fixed window lets through up to
 * twice the limit across a boundary — 30 at 0:59 and 30 at 1:01 — and that is
 * an accepted, bounded overshoot. A sliding log would be exact and would cost a
 * sorted set per key; the thing being defended against here is a script running
 * flat out, and that is caught either way.
 *
 * ## Failure is closed for writes and open for reads
 *
 * If Upstash is unreachable, `check` throws rather than returning `allowed`.
 * Callers decide: `enforceRateLimit` turns it into a 429, so an outage at the
 * limiter degrades into refusing writes rather than silently removing every
 * limit in the product at the moment infrastructure is already unhappy.
 */
class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const seconds = Math.max(1, Math.ceil(windowMs / 1000));

    /*
     * INCR then EXPIRE with NX, pipelined.
     *
     * NX is what makes the window fixed rather than perpetually extended: the
     * TTL is set once, when the key is created, so a client that keeps hitting
     * the endpoint cannot keep pushing its own reset further away.
     */
    const response = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(seconds), 'NX'],
        ['PTTL', key],
      ]),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Rate limiter unavailable (${response.status}).`);
    }

    const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(results[0]?.result ?? 0);
    const pttl = Number(results[2]?.result ?? -1);

    if (!Number.isFinite(count) || count <= 0) {
      throw new Error('Rate limiter returned an unusable count.');
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      // A negative PTTL means no expiry was read back; fall forward a full
      // window rather than telling the caller to retry immediately.
      resetAt: Date.now() + (pttl > 0 ? pttl : windowMs),
    };
  }
}

/**
 * Whether the limits in this file are real on this deployment.
 *
 * Read by `/api/health` and by preflight, which fails a strict run without it.
 * The distinction matters more than it looks: with the in-process limiter every
 * number in `RATE_LIMITS` is decoration on any platform that does not pin a
 * process, and the deploy gives no sign of it.
 */
export function isSharedRateLimiterConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function initialLimiter(): RateLimiter {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (url && token) return new UpstashRateLimiter(url.replace(/\/$/, ''), token);
  return new InMemoryRateLimiter();
}

let limiter: RateLimiter = initialLimiter();

/** Swap in another implementation at startup, or in a test. */
export function setRateLimiter(next: RateLimiter): void {
  limiter = next;
}

/**
 * Named limits, so a route asks for "sending messages" rather than inventing
 * numbers inline and drifting from every other route.
 */
export const RATE_LIMITS = {
  /** Bursty by nature — people type fast in a live negotiation. */
  sendMessage: { limit: 30, windowMs: 60_000 },
  editMessage: { limit: 20, windowMs: 60_000 },
  /** Changing who can read a deal room deserves a much tighter bound. */
  membershipChange: { limit: 10, windowMs: 60_000 },
  /** Exporting a transcript is rare and worth noticing. */
  exportTranscript: { limit: 3, windowMs: 3_600_000 },
  /** Bringing a business to market. Nobody legitimately does this in bulk. */
  createListing: { limit: 10, windowMs: 3_600_000 },
  /**
   * Saving a search. Loose, because saving several in one sitting is exactly
   * what a serious buyer does on their first visit — but bounded, because each
   * one is a standing subscription to an email the platform sends.
   */
  saveSearch: { limit: 30, windowMs: 3_600_000 },
  /**
   * Requesting access to a full profile. Tight on purpose: a scripted client
   * requesting an NDA on every listing on the platform is the reconnaissance
   * step of exactly the harvesting attack the teaser split exists to prevent.
   */
  ndaRequest: { limit: 20, windowMs: 3_600_000 },
  /**
   * Rescoring reads every active buyer's criteria against a listing's
   * confidential figures. It is the most expensive thing a user can trigger,
   * and the answer barely changes minute to minute.
   */
  recomputeMatches: { limit: 6, windowMs: 3_600_000 },
  /**
   * Drafting outreach. Tight because the failure mode is a seller generating a
   * thousand messages and approving them without reading — which is exactly the
   * behaviour the approval step exists to prevent.
   */
  outreachDraft: { limit: 30, windowMs: 3_600_000 },
  /**
   * One MCP request. Keyed on the presented credential rather than the account,
   * so a leaked token burns its own budget and not its owner's.
   *
   * Generous, because an agent working through a task legitimately makes many
   * calls in a row, and low enough that a script cannot use a valid token to
   * walk the whole market. This was the only externally-credentialed endpoint
   * in the product with no limit at all.
   */
  mcpRequest: { limit: 120, windowMs: 60_000 },
  /**
   * A pre-launch interest submission, keyed on client address.
   *
   * The only unauthenticated write in the product, so there is no account to
   * key on. Tight: a person fills this in once, and the failure mode is a
   * mailing list full of forged addresses that then have to be emailed.
   */
  interestSubmission: { limit: 5, windowMs: 3_600_000 },
  /** Submitting funding evidence for review. A person does this rarely. */
  verificationSubmission: { limit: 10, windowMs: 3_600_000 },
  /**
   * Opening one document in the viewer.
   *
   * Keyed per document as well as per user, so reading one file repeatedly
   * while working through it does not consume the budget for the rest of the
   * room. A client looping this is either broken or harvesting a data room page
   * by page, which is the pattern the vault exists to make expensive.
   */
  documentView: { limit: 60, windowMs: 3_600_000 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Keys are scoped per user and per action. Never key on IP alone for
 * authenticated endpoints — an office behind one address would throttle
 * everyone in it because one person was busy.
 */
export async function checkRateLimit(
  name: RateLimitName,
  userId: string,
  scope?: string,
): Promise<RateLimitResult> {
  const { limit, windowMs } = RATE_LIMITS[name];
  const key = scope ? `${name}:${userId}:${scope}` : `${name}:${userId}`;
  return limiter.check(key, limit, windowMs);
}

/**
 * The same check for a caller with no account.
 *
 * `principal` is whatever identifies them — a client address, or the digest of
 * a bearer token. Never the token itself: keys reach the limiter's storage and
 * its logs, and a credential written to either is a credential that has leaked.
 *
 * Kept as a separate function rather than widening `checkRateLimit`, because
 * the comment above that one is a rule worth keeping enforceable: authenticated
 * endpoints key on the account, and an IP-keyed limit on one of those would
 * throttle a whole office because one person was busy.
 */
export async function checkAnonymousRateLimit(
  name: RateLimitName,
  principal: string,
): Promise<RateLimitResult> {
  const { limit, windowMs } = RATE_LIMITS[name];
  return limiter.check(`${name}:anon:${principal}`, limit, windowMs);
}
