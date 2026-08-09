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

const PLACEHOLDER_NAME = 'ACME Capital Markets';

function readBrandConfig(): BrandConfig {
  const parsed = brandSchema.safeParse({
    name: process.env.NEXT_PUBLIC_BRAND_NAME ?? PLACEHOLDER_NAME,
    legalName: process.env.BRAND_LEGAL_NAME ?? `${PLACEHOLDER_NAME}, Inc.`,
    tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE ?? 'Where deals find capital.',
    url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    supportEmail: process.env.BRAND_SUPPORT_EMAIL ?? 'support@example.com',
    mailingAddress: process.env.BRAND_MAILING_ADDRESS ?? 'Address pending — see docs/brand',
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

/** True while the brand name is still the placeholder — used to gate launch checks. */
export const isBrandPlaceholder = brand.name === PLACEHOLDER_NAME;

/** `"Deal Room" -> "Deal Room | ACME Capital Markets"` */
export function pageTitle(title?: string): string {
  return title ? `${title} | ${brand.name}` : `${brand.name} — ${brand.tagline}`;
}

export { brandSchema, PLACEHOLDER_NAME };
