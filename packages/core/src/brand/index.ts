import { z } from 'zod';

/**
 * Brand configuration.
 *
 * The company name is deliberately NOT hard-coded anywhere in the codebase.
 * Site titles, transactional email, generated PDFs, and legal footers all read
 * from here, so renaming the company is a single environment change plus a
 * logo swap — not a find-and-replace across the product.
 *
 * Naming is still an open business decision; see docs/brand/naming.md for the
 * shortlist. The placeholder below keeps the build green until it is settled.
 */

const brandSchema = z.object({
  /** Display name used in UI, email subjects, and document headers. */
  name: z.string().min(1),
  /** Full legal entity name used in contracts, ToS, and privacy policy. */
  legalName: z.string().min(1),
  /** Short tagline for the marketing hero and OG descriptions. */
  tagline: z.string().min(1),
  /** Canonical origin, used for absolute URLs in sitemaps, OG tags, and email. */
  url: z.string().url(),
  supportEmail: z.string().email(),
  /** Address disclosed in the footer and in CAN-SPAM-compliant email. */
  mailingAddress: z.string().min(1),
});

export type BrandConfig = z.infer<typeof brandSchema>;

/**
 * Development fallbacks. The name and tagline are settled; the entity name,
 * support address, and mailing address are not — they depend on incorporation,
 * which has not happened yet.
 */
const DEFAULTS = {
  name: 'Ashlar',
  /*
   * The tagline is the second half of the browser title and the fallback OG
   * description, so it has one job: say what this is to somebody who has never
   * heard of it. "Mark the way." was evocative and told a stranger nothing —
   * a search result reading that could have been a hiking app.
   */
  tagline: 'The marketplace for buying and selling businesses',
  legalName: 'Ashlar Markets, Inc.',
  url: 'http://localhost:3000',
  supportEmail: 'support@example.com',
  mailingAddress: 'Address pending — see docs/brand',
} as const;

/**
 * Values that must be replaced before launch. `mailingAddress` and
 * `supportEmail` appear in commercial email and in the site footer, where a
 * placeholder is not merely untidy — it is a disclosure that is wrong.
 */
const LAUNCH_BLOCKING_DEFAULTS = ['supportEmail', 'mailingAddress'] as const;

function readBrandConfig(): BrandConfig {
  const parsed = brandSchema.safeParse({
    name: process.env.NEXT_PUBLIC_BRAND_NAME ?? DEFAULTS.name,
    legalName: process.env.BRAND_LEGAL_NAME ?? DEFAULTS.legalName,
    tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE ?? DEFAULTS.tagline,
    url: process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULTS.url,
    supportEmail: process.env.BRAND_SUPPORT_EMAIL ?? DEFAULTS.supportEmail,
    mailingAddress: process.env.BRAND_MAILING_ADDRESS ?? DEFAULTS.mailingAddress,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid brand configuration:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }

  return parsed.data;
}

export const brand: BrandConfig = readBrandConfig();

/**
 * Fields still running on a development default. Empty is the launch condition.
 * Surfaced in the UI so a placeholder mailing address cannot quietly ship in a
 * footer or an email disclosure.
 */
export const unconfiguredBrandFields: string[] = LAUNCH_BLOCKING_DEFAULTS.filter(
  (field) => brand[field] === DEFAULTS[field],
);

export const isBrandFullyConfigured = unconfiguredBrandFields.length === 0;

/** `"Deal Room" -> "Deal Room | Ashlar"` */
export function pageTitle(title?: string): string {
  return title ? `${title} | ${brand.name}` : `${brand.name} — ${brand.tagline}`;
}

export { brandSchema, DEFAULTS as brandDefaults };
