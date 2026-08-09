'use client';

import { createBrowserClient } from '@supabase/ssr';

import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * Supabase client for Client Components.
 *
 * Anon key only. Every query is subject to Row Level Security, which is what
 * makes shipping this key to the browser safe — and why a table with RLS
 * disabled is not a minor oversight but a public dataset.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
