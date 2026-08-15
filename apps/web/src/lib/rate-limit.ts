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
 * That is deliberate rather than an oversight. A shared limiter needs Redis or
 * Upstash, which is infrastructure this project has not chosen yet. Building
 * the seam now means the swap is one implementation of `RateLimiter`, and every
 * call site already routes through it — rather than a later sweep to find every
 * endpoint that needed limiting.
 *
 * Wire the real one in `docs/deployment.md` before launch. Until then, treat
 * these limits as protection against a stuck client, not against an attacker.
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

let limiter: RateLimiter = new InMemoryRateLimiter();

/** Swap in a shared implementation (Redis, Upstash) at startup. */
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
