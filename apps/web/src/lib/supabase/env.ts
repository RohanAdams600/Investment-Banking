/**
 * Supabase environment access.
 *
 * Read through these accessors rather than `process.env` directly, so a missing
 * variable fails at the boundary with a message naming what to set — instead of
 * surfacing as an opaque "Invalid URL" three layers into the client library.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        'Copy .env.example to .env.local and fill it in — see docs/environment.md.',
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The service role key bypasses Row Level Security entirely.
 *
 * The guard below is not defensive padding — `NEXT_PUBLIC_`-prefixed values are
 * inlined into the client bundle by Next, so a key that ends up on the browser
 * hands every reader unrestricted read and write access to every table. This
 * throws rather than warns because there is no degraded mode worth having.
 */
export function supabaseServiceRoleKey(): string {
  if (typeof window !== 'undefined') {
    throw new Error('The Supabase service role key must never be read in the browser.');
  }
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Whether Supabase is configured at all. Lets pages that do not require a
 * session render during early development and in CI, where no project exists.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
