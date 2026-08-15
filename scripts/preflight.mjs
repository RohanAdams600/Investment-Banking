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

const strict = process.argv.includes('--strict');

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
