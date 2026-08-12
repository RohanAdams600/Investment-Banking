import { z } from 'zod';
import { INDUSTRY_KEYS, LISTING_STATUSES } from '@ib/core';

/**
 * Validation for listings.
 *
 * Zod is the outermost gate and the database constraints are the innermost, and
 * they deliberately agree — the headline is 10–200 characters in both, the bands
 * are ordered in both. A payload rejected here would also have been rejected
 * there; the difference is that here the user gets a sentence they can act on
 * instead of a constraint violation.
 *
 * What validation is *not* doing: deciding who may write. That is the RLS
 * policy's job and the capability check's job. Nothing in this file is a
 * security control.
 */

export const uuidSchema = z.string().uuid('Not a valid identifier.');

/** Dollars in the form, integer cents in the database. */
const moneyField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9.]/g, ''))
  .transform((value) => (value === '' ? null : Math.round(Number(value) * 100)))
  .refine((value) => value === null || (Number.isSafeInteger(value) && value >= 0), {
    message: 'Enter a positive amount.',
  });

/** Percent in the form, 0–1 fraction in the database. */
const percentField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9.]/g, ''))
  .transform((value) => (value === '' ? null : Number(value) / 100))
  .refine((value) => value === null || (value >= 0 && value <= 1), {
    message: 'Enter a percentage between 0 and 100.',
  });

const countField = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value)))
  .refine(
    (value) => value === null || (Number.isInteger(value) && value >= 0 && value < 1_000_000),
    {
      message: 'Enter a whole number.',
    },
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value));

/**
 * The teaser.
 *
 * Everything here ends up publicly readable by any signed-in user the moment
 * the listing goes live, so the shape of this schema is the disclosure
 * boundary. Adding a field is a decision about what a competitor may learn.
 */
export const teaserSchema = z
  .object({
    headline: z
      .string()
      .trim()
      .min(10, 'Give the headline at least 10 characters.')
      .max(200, 'Keep the headline under 200 characters.'),
    summary: optionalText(4000),
    industry: z.enum(INDUSTRY_KEYS as [string, ...string[]], {
      errorMap: () => ({ message: 'Choose an industry.' }),
    }),
    jurisdictionCode: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'Choose a state.'),

    revenueBandLow: moneyField,
    revenueBandHigh: moneyField,
    earningsBandLow: moneyField,
    earningsBandHigh: moneyField,
    askingBandLow: moneyField,
    askingBandHigh: moneyField,

    dealStructure: z.enum(['asset', 'stock']),
    employeeCount: countField,
    yearsInBusiness: countField,
    growthTrend: z.enum(['declining', 'flat', 'growing', 'rapid']).nullable().optional(),
    realEstateIncluded: z.boolean(),
    ownerDependence: z.enum(['absentee', 'moderate', 'critical']).nullable().optional(),
    reasonForSale: optionalText(500),

    firmId: uuidSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const bands: Array<[string, number | null, number | null]> = [
      ['revenueBandHigh', data.revenueBandLow, data.revenueBandHigh],
      ['earningsBandHigh', data.earningsBandLow, data.earningsBandHigh],
      ['askingBandHigh', data.askingBandLow, data.askingBandHigh],
    ];

    for (const [path, low, high] of bands) {
      if (low !== null && high !== null && high < low) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: 'The top of the band must be at least the bottom.',
        });
      }
    }
  });

/** The confidential half. Never rendered to anyone outside the NDA gate. */
export const fullProfileSchema = z.object({
  legalName: z.string().trim().min(1, 'The legal name is required.').max(300),
  tradingName: optionalText(300),
  addressLine1: optionalText(300),
  addressLine2: optionalText(300),
  city: optionalText(200),
  postalCode: optionalText(20),
  website: optionalText(500),

  revenueCents: moneyField,
  earningsCents: moneyField,
  askingPriceCents: moneyField,

  customerConcentration: percentField,
  recurringRevenueShare: percentField,

  keyCustomers: optionalText(4000),
  competitivePosition: optionalText(4000),
  growthOpportunities: optionalText(4000),
  knownRisks: optionalText(4000),
});

export const financialYearSchema = z.object({
  listingId: uuidSchema,
  fiscalYear: z
    .string()
    .trim()
    .transform((value) => Number(value))
    .refine((value) => Number.isInteger(value) && value >= 1900 && value <= 2200, {
      message: 'Enter a four-digit year.',
    }),
  revenueCents: moneyField.refine((value) => value !== null, 'Revenue is required.'),
  // Not `moneyField`: a loss-making year is a fact, not an input error, so
  // earnings may be negative where revenue may not.
  ebitdaCents: z
    .string()
    .trim()
    .transform((value) => value.replace(/[^0-9.-]/g, ''))
    .transform((value) => (value === '' ? null : Math.round(Number(value) * 100)))
    .refine((value) => value === null || Number.isSafeInteger(value), 'Enter an amount.'),
  sdeCents: z
    .string()
    .trim()
    .transform((value) => value.replace(/[^0-9.-]/g, ''))
    .transform((value) => (value === '' ? null : Math.round(Number(value) * 100)))
    .refine((value) => value === null || Number.isSafeInteger(value), 'Enter an amount.'),
  addbacksCents: moneyField,
});

export const statusChangeSchema = z.object({
  listingId: uuidSchema,
  status: z.enum(LISTING_STATUSES as [string, ...string[]]),
});

export const ndaSchema = z.object({
  listingId: uuidSchema,
});

export const ndaDecisionSchema = z.object({
  ndaId: uuidSchema,
  /** How long the buyer's access lasts, in months. Null means no expiry. */
  expiresInMonths: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= 120), {
      message: 'Choose between 1 and 120 months.',
    }),
});

export const saveListingSchema = z.object({
  listingId: uuidSchema,
  saved: z.boolean(),
});
