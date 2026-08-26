#!/usr/bin/env node
/**
 * What is not configured yet.
 *
 * The gap between "the build passed" and "the website works" is entirely
 * configuration, and the failure mode is silent: a missing Supabase URL does not
 * break the build, it produces a site where signing in does nothing. This prints
 * the difference before a deploy rather than after one.
 *
 * Three levels, and the distinction matters more than the checks:
 *
 *   BLOCKING  — the site will not function. Exits non-zero.
 *   LAUNCH    — it functions, but must not face real customers like this.
 *   OPTIONAL  — a feature degrades. Worth knowing, never worth failing on.
 *
 * `--strict` promotes LAUNCH to blocking, which is what a production deploy
 * should run. The default is lenient so a developer starting up is not told
 * their mailing address is wrong.
 */

import { existsSync } from 'node:fs';

const strict = process.argv.includes('--strict');

/**
 * Next reads env files relative to the app directory, not the workspace root.
 * `apps/web/.env.local` is therefore the only one the running site sees.
 */
const APP_ENV = 'apps/web/.env.local';
const ROOT_ENV = '.env.local';

const BLOCKING = 'blocking';
const LAUNCH = 'launch';
const OPTIONAL = 'optional';

const isSet = (name) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '';
};

const checks = [
  {
    level: BLOCKING,
    name: 'Supabase URL',
    ok: () => isSet('NEXT_PUBLIC_SUPABASE_URL'),
    fix: 'Set NEXT_PUBLIC_SUPABASE_URL. Without it there is no database and no sign-in.',
  },
  {
    level: BLOCKING,
    name: 'Supabase anon key',
    ok: () => isSet('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    fix: 'Set NEXT_PUBLIC_SUPABASE_ANON_KEY. Safe to expose only because RLS is on every table.',
  },
  {
    level: BLOCKING,
    name: 'Supabase service role key',
    ok: () => isSet('SUPABASE_SERVICE_ROLE_KEY'),
    fix: 'Set SUPABASE_SERVICE_ROLE_KEY. The matcher, the audit log and the orchestrator need it. Server-side only — never NEXT_PUBLIC_.',
  },
  {
    level: BLOCKING,
    name: 'Service role key is not exposed to the browser',
    // The one check here that is about a mistake rather than an omission, and
    // the most expensive mistake in the file: a service-role key with a
    // NEXT_PUBLIC_ prefix is compiled into the client bundle and bypasses every
    // policy in the database for anybody who views source.
    ok: () =>
      !Object.keys(process.env).some(
        (key) => key.startsWith('NEXT_PUBLIC_') && /SERVICE_ROLE/i.test(key),
      ),
    fix: 'A service-role key is exposed with a NEXT_PUBLIC_ prefix. Remove it now — it bypasses Row Level Security for anybody who reads the page source.',
  },
  {
    level: BLOCKING,
    name: 'The env file is where Next will look for it',
    /*
     * The trap this exists for: `next dev` and `next build` read env files
     * relative to `apps/web`, so a `.env.local` at the workspace root is
     * invisible to the application. Preflight reads both, which used to mean it
     * reported every variable set while the running site rendered "Supabase is
     * not configured" — the two disagreeing, silently, in the direction that
     * makes you trust the wrong one.
     *
     * A root file is only a problem when there is no app-level file, because
     * then it is certainly the one somebody meant to be using.
     */
    ok: () => existsSync(APP_ENV) || !existsSync(ROOT_ENV),
    fix: `Move .env.local into apps/web/ — Next reads env files relative to the app, not the workspace root, so a root .env.local is loaded by this script and by nothing else:\n      mv .env.local apps/web/.env.local`,
  },
  {
    level: LAUNCH,
    name: 'Support email',
    ok: () => isSet('BRAND_SUPPORT_EMAIL') && !/example\.com$/.test(process.env.BRAND_SUPPORT_EMAIL ?? ''),
    fix: 'Set BRAND_SUPPORT_EMAIL to a real address. It appears in the footer and in commercial email.',
  },
  {
    level: LAUNCH,
    name: 'Mailing address',
    ok: () =>
      isSet('BRAND_MAILING_ADDRESS') &&
      !/example|pending/i.test(process.env.BRAND_MAILING_ADDRESS ?? ''),
    fix: 'Set BRAND_MAILING_ADDRESS. A physical address is required on commercial email under CAN-SPAM.',
  },
  {
    level: LAUNCH,
    name: 'Site URL is not localhost',
    ok: () => !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SITE_URL ?? 'localhost'),
    fix: 'Set NEXT_PUBLIC_SITE_URL to the real domain. It builds every link in an email and every canonical URL.',
  },
  {
    level: LAUNCH,
    name: 'Content Security Policy is enforced',
    ok: () => process.env.CSP_ENFORCE === 'true',
    fix: 'Deploy report-only first, walk every page, read the violations, then set CSP_ENFORCE=true.',
  },
  {
    level: OPTIONAL,
    name: 'Scheduled reminders',
    ok: () => isSet('CRON_SECRET'),
    fix: 'No CRON_SECRET, so /api/cron/due-tasks refuses every caller and nobody is reminded about a due task. Set it to a long random string and give the same value to whatever calls the route.',
  },
  {
    level: OPTIONAL,
    name: 'Search engine indexing',
    ok: () => process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true',
    fix: 'NEXT_PUBLIC_ALLOW_INDEXING is not "true", so robots.txt blocks everything. Correct for staging; wrong for the real site.',
  },
  {
    level: OPTIONAL,
    name: 'MCP server for external AI agents',
    /*
     * Optional, not blocking: the marketplace works completely without it. But
     * the failure is silent from the outside — an agent gets a 503 and its owner
     * concludes the integration is broken — so it is worth printing rather than
     * discovering from a support message.
     */
    ok: () => isSet('SUPABASE_JWT_SECRET'),
    fix: 'No SUPABASE_JWT_SECRET, so /api/mcp refuses every agent. Supabase → Settings → API → JWT Settings. Only needed if you are connecting an external AI agent.',
  },
  {
    level: OPTIONAL,
    name: 'AI provider',
    ok: () => isSet('ANTHROPIC_API_KEY') || isSet('OPENAI_API_KEY'),
    fix: 'No ANTHROPIC_API_KEY or OPENAI_API_KEY. Everything still works — matching falls back to its deterministic half and the thesis read is simply absent.',
  },
];

const failed = checks.filter((check) => !check.ok());

const bucket = (level) => failed.filter((check) => check.level === level);

const blocking = bucket(BLOCKING);
const launch = bucket(LAUNCH);
const optional = bucket(OPTIONAL);

const report = (title, list) => {
  if (list.length === 0) return;
  console.log(`\n${title}`);
  for (const check of list) {
    console.log(`  · ${check.name}`);
    console.log(`    ${check.fix}`);
  }
};

if (failed.length === 0) {
  console.log('Preflight: everything configured.');
  process.exit(0);
}

report('WILL NOT WORK', blocking);
report('NOT READY FOR REAL CUSTOMERS', launch);
report('DEGRADED, BUT FINE', optional);

const fatal = blocking.length > 0 || (strict && launch.length > 0);

console.log(
  `\n${checks.length - failed.length} of ${checks.length} checks passed.` +
    (fatal ? '' : ' Nothing blocking.'),
);

process.exit(fatal ? 1 : 0);
