import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';

import { checkRateLimit, type RateLimitName } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { MessagingError } from './authorization';
import type { ApiErrorBody } from './types';

/**
 * Shared plumbing for the messaging route handlers, so each one is about its
 * own logic rather than about error shapes and status codes.
 */

export async function requireUser(): Promise<{ id: string; email: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new MessagingError(401, 'Sign in to continue.');
  return { id: user.id, email: user.email ?? null };
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new MessagingError(400, 'Expected a JSON body.');
  }

  return schema.parse(json);
}

export async function enforceRateLimit(
  name: RateLimitName,
  userId: string,
  scope?: string,
): Promise<void> {
  const result = await checkRateLimit(name, userId, scope);
  if (!result.allowed) {
    throw new MessagingError(
      429,
      `Too many requests. Try again in ${Math.ceil((result.resetAt - Date.now()) / 1000)} seconds.`,
    );
  }
}

/**
 * Turns anything thrown in a handler into a response.
 *
 * Unexpected errors become a generic 500 with no detail. A database error
 * message can name tables, columns, and constraints, and on a product where the
 * schema encodes who may see which deal, that is a description of the security
 * model handed to whoever triggered the error.
 */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof MessagingError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || 'body';
      fields[key] ??= issue.message;
    }
    return NextResponse.json({ error: 'That request was not valid.', fields }, { status: 400 });
  }

  console.error('[messaging] unhandled error', error);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}
